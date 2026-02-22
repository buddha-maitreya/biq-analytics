import { createRouter, validator, sse, websocket } from "@agentuity/runtime";
import type { SSEStream } from "@agentuity/runtime";
import { s3 } from "bun";
import { errorMiddleware, ValidationError, NotFoundError } from "@lib/errors";
import { sessionMiddleware } from "@lib/auth";
import { verifyToken } from "@services/auth";
import type { AppUser as AuthUser } from "@lib/auth";
import { chatMessageSchema, chatFeedbackSchema } from "@lib/validation";
import { maskPII } from "@lib/pii";
import { dynamicRateLimit } from "@lib/rate-limit";
import {
  db,
  chatSessions,
  chatMessages,
  attachments as attachmentsTable,
} from "@db/index";
import { eq, desc, and } from "drizzle-orm";
import { streamText } from "ai";
import { getModel } from "@lib/ai";
import { getAgentConfigWithDefaults } from "@services/agent-configs";
import { getAISettings, type AISettings } from "@services/settings";
import { getAllTools, buildCustomToolsPromptSection } from "@agent/data-science/tools";
import { buildSystemPrompt } from "@agent/data-science/prompts/system";
import { SpanCollector, extractToolInvocations } from "@lib/tracing";
import { recordRoutingDecision } from "@services/routing-analytics";
import {
  getConversationContext,
  maybeCompressSummary,
} from "@services/chat";

// ────────────────────────────────────────────────────────────
// SSE session bus (per-session, per-deployment)
//
// Stores SDK SSEStream objects per session. When the Data Science
// Agent streams, we push events to all connected clients on that
// session (normally just one browser tab). Uses the SDK's sse()
// handler instead of a hand-rolled ReadableStream.
// ────────────────────────────────────────────────────────────

const sessionStreams = new Map<string, Set<SSEStream>>();

// Per-session AbortController for cancelling in-flight AI generations
const sessionAbortControllers = new Map<string, AbortController>();

function addStream(sessionId: string, stream: SSEStream) {
  let streams = sessionStreams.get(sessionId);
  if (!streams) {
    streams = new Set();
    sessionStreams.set(sessionId, streams);
  }
  streams.add(stream);
}

function removeStream(sessionId: string, stream: SSEStream) {
  const streams = sessionStreams.get(sessionId);
  if (streams) {
    streams.delete(stream);
    if (streams.size === 0) sessionStreams.delete(sessionId);
  }
}

function broadcast(sessionId: string, event: string, data: unknown) {
  const payload = JSON.stringify({ type: event, properties: data });

  // Broadcast to SSE streams
  const streams = sessionStreams.get(sessionId);
  if (streams) {
    for (const stream of streams) {
      stream.writeSSE({ data: payload }).catch(() => {
        // Stream may have been closed by the client
      });
    }
  }

  // Phase 2.3: Also broadcast to WebSocket connections
  const conns = wsConnections.get(sessionId);
  if (conns) {
    for (const ws of conns) {
      try {
        ws.send(payload);
      } catch {
        // WS may have been closed
      }
    }
  }
}

// ────────────────────────────────────────────────────────────
// Router
// ────────────────────────────────────────────────────────────

const chat = createRouter();
chat.use(errorMiddleware());

// Auth middleware for ALL routes (including SSE events).
// EventSource sends cookies automatically for same-origin requests,
// so cookie-based session auth works without query params.
chat.use("/chat/*", sessionMiddleware());

// ── Helper: extract user from context ────────────────────────
function getUser(c: any): AuthUser {
  return c.get("appUser" as any) as AuthUser;
}

// ════════════════════════════════════════════════════════════
// SESSION CRUD
// ════════════════════════════════════════════════════════════

/** POST /sessions — Create a new chat session */
chat.post("/chat/sessions", async (c) => {
  const user = getUser(c);

  const [session] = await db
    .insert(chatSessions)
    .values({
      userId: user.id,
      title: null,
      status: "active",
    })
    .returning();

  return c.json({ data: session }, 201);
});

/** GET /sessions — List user's chat sessions */
chat.get("/chat/sessions", async (c) => {
  const user = getUser(c);

  const sessions = await db.query.chatSessions.findMany({
    where: and(
      eq(chatSessions.userId, user.id),
      eq(chatSessions.status, "active")
    ),
    orderBy: [desc(chatSessions.updatedAt)],
    limit: 50,
  });

  return c.json({ data: sessions });
});

/** DELETE /sessions/:id — Delete (archive) a chat session */
chat.delete("/chat/sessions/:id", async (c) => {
  const user = getUser(c);
  const sessionId = c.req.param("id");

  const session = await db.query.chatSessions.findFirst({
    where: and(
      eq(chatSessions.id, sessionId),
      eq(chatSessions.userId, user.id)
    ),
  });

  if (!session) throw new NotFoundError("Chat session", sessionId);

  await db
    .update(chatSessions)
    .set({ status: "archived", updatedAt: new Date() })
    .where(eq(chatSessions.id, sessionId));

  return c.json({ data: { success: true } });
});

// ════════════════════════════════════════════════════════════
// MESSAGE HISTORY
// ════════════════════════════════════════════════════════════

/** GET /sessions/:id/messages — Paginated message history */
chat.get("/chat/sessions/:id/messages", async (c) => {
  const user = getUser(c);
  const sessionId = c.req.param("id");

  // Verify ownership
  const session = await db.query.chatSessions.findFirst({
    where: and(
      eq(chatSessions.id, sessionId),
      eq(chatSessions.userId, user.id)
    ),
  });
  if (!session) throw new NotFoundError("Chat session", sessionId);

  const messages = await db.query.chatMessages.findMany({
    where: eq(chatMessages.sessionId, sessionId),
    orderBy: [chatMessages.createdAt],
  });

  return c.json({ data: messages });
});

// ════════════════════════════════════════════════════════════
// SSE EVENT STREAM
// ════════════════════════════════════════════════════════════

/**
 * GET /sessions/:id/events — Server-Sent Events stream.
 *
 * Auth via cookie-based session middleware (EventSource sends cookies
 * automatically for same-origin requests — no query param needed).
 * Uses SDK sse() middleware for transport. Sends keepalive pings every 15s.
 * Events arrive when the user sends a message via POST /sessions/:id/send.
 *
 * IMPORTANT: The handler MUST be async and MUST await a promise that only
 * resolves when the client disconnects. If the handler returns/resolves,
 * the sse() middleware closes the stream — which causes the frontend's
 * EventSource to fire onerror and enter a reconnect loop, spamming
 * Agentuity sessions.
 */
chat.get("/chat/sessions/:id/events", sse(async (c, stream) => {
  const sessionId = c.req.param("id");
  const user = getUser(c);

  // Verify session ownership
  const session = await db.query.chatSessions.findFirst({
    where: and(
      eq(chatSessions.id, sessionId),
      eq(chatSessions.userId, user.id)
    ),
  });
  if (!session) {
    await stream.writeSSE({
      data: JSON.stringify({ type: "error", properties: { message: "Session not found" } }),
    });
    stream.close();
    return;
  }

  // Register stream in session bus
  addStream(sessionId, stream);

  // Send connected event
  await stream.writeSSE({
    data: JSON.stringify({ type: "session.connected", properties: { sessionId } }),
  });

  // Keepalive ping every 15s
  const pingInterval = setInterval(() => {
    stream.writeSSE({
      data: JSON.stringify({ type: "ping", properties: { ts: Date.now() } }),
    }).catch(() => {
      clearInterval(pingInterval);
    });
  }, 15_000);

  // Keep the handler alive until the client disconnects.
  // When the client closes the EventSource, stream.onAbort fires,
  // which resolves this promise and lets the handler return cleanly.
  await new Promise<void>((resolve) => {
    stream.onAbort(() => {
      clearInterval(pingInterval);
      removeStream(sessionId, stream);
      resolve();
    });
  });
}));

// ════════════════════════════════════════════════════════════
// SEND MESSAGE (fire-and-forget → events arrive via SSE)
// ════════════════════════════════════════════════════════════

/**
 * POST /sessions/:id/send — Send a user message.
 *
 * 1. Persists the user message
 * 2. Broadcasts session.status = busy
 * 3. Streams AI response, broadcasting tool.start / tool.result / message.delta
 * 4. Persists the assistant message
 * 5. Broadcasts message.done
 * 6. Auto-titles the session on first message
 */
chat.post("/chat/sessions/:id/send",
  dynamicRateLimit("rateLimitChat", { windowMs: 60_000, prefix: "chat-send", message: "Too many messages. Please wait a moment." }),
  validator({ input: chatMessageSchema }),
  async (c) => {
  const user = getUser(c);
  const sessionId = c.req.param("id");
  const { message, attachmentIds } = c.req.valid("json");

  if (typeof message !== "string") {
    throw new ValidationError("message must be a string");
  }

  // Verify ownership
  const session = await db.query.chatSessions.findFirst({
    where: and(
      eq(chatSessions.id, sessionId),
      eq(chatSessions.userId, user.id)
    ),
  });
  if (!session) throw new NotFoundError("Chat session", sessionId);

  // Resolve attachment metadata for image/document context
  let attachmentContext = "";
  if (attachmentIds?.length) {
    try {
      const rows = await db.query.attachments.findMany({
        where: and(
          eq(attachmentsTable.sessionId, sessionId),
        ),
      });
      const matched = rows.filter((r: any) => attachmentIds.includes(r.id));
      if (matched.length > 0) {
        const descriptions = matched.map((a: any) => {
          const isImage = a.contentType?.startsWith("image/");
          // Generate presigned S3 URL so the scan_document tool can access the file
          let downloadUrl = "";
          try {
            downloadUrl = s3.presign(a.s3Key, { expiresIn: 3600 });
          } catch {
            // S3 presign failed — tool won't be able to access the file directly
          }
          return `[Attached ${isImage ? "image" : "file"}: "${a.filename}" (${a.contentType}, ${Math.round((a.sizeBytes || 0) / 1024)}KB)${downloadUrl ? ` | URL: ${downloadUrl}` : ""}]`;
        });
        attachmentContext = "\n\n" + descriptions.join("\n") +
          "\n\nThe user has uploaded the above file(s). " +
          "If they contain barcodes, QR codes, invoices, or stock sheets, use the scan_document tool to process them — " +
          "pass the attachment URL shown above as the imageUrl parameter. " +
          "For other file types, describe what you know about the file and take the requested action.";
      }
    } catch {
      // Non-critical — continue without attachment context
    }
  }

  // Persist user message
  await db.insert(chatMessages).values({
    sessionId,
    role: "user",
    content: message + attachmentContext,
    ...(attachmentIds?.length ? { metadata: { attachmentIds } } : {}),
  });

  // Broadcast: session is busy
  broadcast(sessionId, "session.status", { status: "busy" });

  // Build conversation context (rolling summary + recent messages)
  const { summary, recentMessages } = await getConversationContext(sessionId);

  // Start streaming in background (events go to SSE bus)
  // c.waitUntil() keeps the runtime alive until the stream completes,
  // replacing the unsafe fire-and-forget .catch() pattern.
  const sandboxApi = (c as any).var?.sandbox;
  const kvStore = (c as any).var?.kv;
  const logger = (c as any).var?.logger;
  c.waitUntil(async () => {
    try {
      await processStream(sessionId, message, recentMessages, summary, session.title, sandboxApi, kvStore, logger, user.name);
    } catch (err: any) {
      broadcast(sessionId, "error", {
        message: err?.message || "Stream processing failed",
      });
    }
  });

  // Return immediately (fire-and-forget)
  return c.json({ data: { messageId: sessionId, status: "processing" } });
});

// ════════════════════════════════════════════════════════════
// CANCEL GENERATION
// ════════════════════════════════════════════════════════════

/**
 * POST /sessions/:id/cancel — Abort the in-flight AI generation.
 *
 * Aborts the AbortController for the session, which propagates to the
 * Vercel AI SDK's streamText() call. The SSE bus broadcasts a
 * session.status=idle and a message indicating cancellation.
 */
chat.post("/chat/sessions/:id/cancel", async (c) => {
  const sessionId = c.req.param("id");
  const controller = sessionAbortControllers.get(sessionId);
  if (controller) {
    controller.abort();
    sessionAbortControllers.delete(sessionId);
  }
  // Broadcast idle status so all connected clients update
  broadcast(sessionId, "session.status", { status: "idle" });
  broadcast(sessionId, "message.done", {
    messageId: `cancelled-${Date.now()}`,
    cancelled: true,
  });
  return c.json({ data: { status: "cancelled" } });
});

/**
 * Process the AI stream and broadcast SSE events.
 * Runs async after the HTTP response is sent.
 *
 * Phase 1.7: Streaming logic is now route-level (not in the agent).
 * The Agentuity SDK agents are strictly request/response — streaming
 * belongs at the route layer where we have access to c.var context.
 * This eliminates the anti-pattern of duplicating config loading.
 */
async function processStream(
  sessionId: string,
  message: string,
  history: Array<{ role: "user" | "assistant" | "system"; content: string }>,
  conversationSummary: string | undefined,
  sessionTitle: string | null,
  sandboxApi?: any,
  kv?: any,
  logger?: any,
  userName?: string
) {
  const streamStart = Date.now();

  // ── Abort controller for cancel/interrupt support ──
  const abortController = new AbortController();
  sessionAbortControllers.set(sessionId, abortController);

  // ── Load agent config (single source — same as agent handler setup) ──
  const agentConfig = await getAgentConfigWithDefaults("data-science");
  const cfg = (agentConfig.config ?? {}) as Record<string, unknown>;
  const maxSteps = agentConfig.maxSteps ?? 8;
  const sandboxTimeoutMs = (cfg.sandboxTimeoutMs as number) ?? 30_000;
  const modelId = agentConfig.modelOverride ?? "gpt-4o";
  const temperature = agentConfig.temperature
    ? parseFloat(agentConfig.temperature)
    : undefined;
  const routingExamples = cfg.routingExamples as any[] | undefined;

  let ai: AISettings | undefined;
  try {
    ai = await getAISettings();
  } catch {
    // Non-critical — system prompt will use defaults
  }

  // ── Build per-request tool set ──
  const allTools = await getAllTools(
    {
      sandboxApi,
      sandboxTimeoutMs,
      snapshotId: cfg.sandboxSnapshotId as string | undefined,
      runtime: (cfg.sandboxRuntime as any) ?? undefined,
      dependencies: cfg.sandboxDeps as string[] | undefined,
      memory: cfg.sandboxMemory as string | undefined,
    },
    kv
  );
  const customToolsSection = await buildCustomToolsPromptSection();

  // ── Build message array ──
  const messages: Array<{
    role: "user" | "assistant" | "system";
    content: string;
  }> = [];

  if (history?.length) {
    messages.push(...history);
  }
  messages.push({ role: "user", content: message });

  // ── Telemetry collector ──
  const collector = new SpanCollector("data-science", sessionId);

  // ── Stream the response ──
  const result = streamText({
    model: await getModel(modelId),
    ...(temperature !== undefined ? { temperature } : {}),
    system: buildSystemPrompt(conversationSummary, ai, customToolsSection, routingExamples, userName),
    messages,
    tools: allTools,
    maxSteps,
    abortSignal: abortController.signal,
    onFinish: async ({ steps, usage }) => {
      const durationMs = Date.now() - streamStart;

      // Record an LLM span for the stream
      collector.addSpan({
        spanType: "llm",
        spanName: "streamText",
        status: "ok",
        durationMs,
        startedAt: new Date(streamStart),
        attributes: { model: modelId, maxSteps, streaming: true },
      });

      // Extract and record tool invocations
      const toolInvocations = extractToolInvocations(
        steps as any,
        "data-science",
        sessionId
      );
      for (const inv of toolInvocations) {
        collector.addToolCall(inv);
      }

      // Record routing analytics
      const toolNames = [
        ...new Set(
          steps.flatMap(
            (s) => s.toolCalls?.map((tc: any) => tc.toolName) ?? []
          )
        ),
      ];
      if (toolNames.length > 0) {
        try {
          await recordRoutingDecision({
            sessionId,
            userMessage: message,
            toolsSelected: toolNames,
            strategy: toolNames.length > 1 ? "parallel" : "direct",
            latencyMs: durationMs,
          });
        } catch {
          // Non-critical
        }
      }

      try {
        await collector.flush();
      } catch {
        // Non-critical
      }

      logger?.info?.("Stream completed", {
        sessionId,
        model: modelId,
        durationMs,
        toolCount: toolNames.length,
      });
    },
  });

  // ── Iterate fullStream and broadcast SSE events ──
  const fullStream = result.fullStream;

  let fullText = "";
  const toolCalls: Array<{
    id: string;
    name: string;
    input: Record<string, unknown>;
    output?: unknown;
    status: string;
  }> = [];

  let aborted = false;
  try {
    for await (const chunk of fullStream) {
      // Check if aborted mid-stream
      if (abortController.signal.aborted) {
        aborted = true;
        break;
      }
      switch (chunk.type) {
        case "text-delta":
          // Phase 7.5: Mask PII in streaming text deltas
          const { masked: maskedDelta } = maskPII(chunk.textDelta);
          fullText += maskedDelta;
          broadcast(sessionId, "message.delta", {
            content: maskedDelta,
          });
          break;

        case "tool-call":
          // Tool call started
          broadcast(sessionId, "tool.start", {
            toolId: chunk.toolCallId,
            name: chunk.toolName,
            input: chunk.args,
          });
          toolCalls.push({
            id: chunk.toolCallId,
            name: chunk.toolName,
            input: chunk.args as Record<string, unknown>,
            status: "running",
          });
          break;

        case "tool-result":
          // Tool call completed
          broadcast(sessionId, "tool.result", {
            toolId: chunk.toolCallId,
            name: chunk.toolName,
            output: chunk.result,
          });
          // Update the matching tool call
          const tc = toolCalls.find((t) => t.id === chunk.toolCallId);
          if (tc) {
            tc.output = chunk.result;
            tc.status = "completed";
          }
          break;

        case "error":
          broadcast(sessionId, "error", {
            message: String((chunk as any).error ?? "Unknown error"),
          });
          break;
      }
    }
  } catch (err: any) {
    // AbortError is expected when user cancels — not a real error
    if (err?.name === "AbortError" || abortController.signal.aborted) {
      aborted = true;
      if (fullText) fullText += "\n\n*(Generation stopped by user)*";
    } else {
      throw err;
    }
  }

  // Get final text from awaiting the result
  try {
    const finalText = await result.text;
    if (finalText && finalText !== fullText) {
      fullText = finalText;
    }
  } catch {
    // Use accumulated text
  }

  // Get usage stats
  let tokenMeta: Record<string, unknown> | undefined;
  try {
    const usage = await result.usage;
    if (usage) {
      tokenMeta = {
        model: "gpt-4o",
        tokens: {
          prompt: usage.promptTokens,
          completion: usage.completionTokens,
        },
      };
    }
  } catch {
    // Non-critical
  }

  // Generate a message ID
  const messageId = crypto.randomUUID();

  // Persist assistant message
  try {
    await db.insert(chatMessages).values({
      id: messageId,
      sessionId,
      role: "assistant",
      content: fullText,
      toolCalls: toolCalls.length ? toolCalls : undefined,
      metadata: tokenMeta,
    });
  } catch {
    // Non-critical — message was already streamed to user
  }

  // Broadcast done
  broadcast(sessionId, "message.done", {
    messageId,
    toolCalls: toolCalls.length ? toolCalls : undefined,
    metadata: tokenMeta,
  });

  // Auto-title on first message
  if (!sessionTitle) {
    try {
      await autoTitleSession(sessionId, message);
    } catch {
      // Non-critical — session will remain untitled
    }
  }

  // Compress summary if message count exceeds threshold
  try {
    await maybeCompressSummary(sessionId);
  } catch {
    // Non-critical — summary compression can retry next message
  }

  // Update session timestamp
  try {
    await db
      .update(chatSessions)
      .set({ updatedAt: new Date() })
      .where(eq(chatSessions.id, sessionId));
  } catch {
    // Non-critical
  }

  // Clean up abort controller
  sessionAbortControllers.delete(sessionId);
}

/**
 * Auto-generate a session title from the first user message.
 * Uses a simple heuristic — first 60 chars, trimmed to last full word.
 */
async function autoTitleSession(
  sessionId: string,
  firstMessage: string
): Promise<void> {
  let title = firstMessage.trim().slice(0, 60);
  if (firstMessage.length > 60) {
    const lastSpace = title.lastIndexOf(" ");
    if (lastSpace > 30) title = title.slice(0, lastSpace);
    title += "…";
  }

  await db
    .update(chatSessions)
    .set({ title, updatedAt: new Date() })
    .where(eq(chatSessions.id, sessionId));
}

// ════════════════════════════════════════════════════════════
// FEEDBACK
// ════════════════════════════════════════════════════════════

/** POST /messages/:id/feedback — Thumbs up/down on a message */
chat.post("/chat/messages/:id/feedback", validator({ input: chatFeedbackSchema }), async (c) => {
  const messageId = c.req.param("id");
  const { rating } = c.req.valid("json");

  const msg = await db.query.chatMessages.findFirst({
    where: eq(chatMessages.id, messageId),
  });
  if (!msg) throw new NotFoundError("Chat message", messageId);

  const currentMeta = (msg.metadata as Record<string, unknown>) || {};
  await db
    .update(chatMessages)
    .set({
      metadata: { ...currentMeta, feedbackRating: rating },
      updatedAt: new Date(),
    })
    .where(eq(chatMessages.id, messageId));

  return c.json({ data: { success: true } });
});

// ════════════════════════════════════════════════════════════
// LEGACY COMPAT: POST / — fallback for old UI
// ════════════════════════════════════════════════════════════

chat.post("/chat", validator({ input: chatMessageSchema }), async (c) => {
  const { message } = c.req.valid("json");

  if (typeof message !== "string") {
    throw new ValidationError("message must be a string");
  }

  // Use data-science agent directly (non-streaming fallback)
  const dataScienceAgent = (await import("@agent/data-science")).default;
  const tempSessionId = crypto.randomUUID();

  const result = await dataScienceAgent.run({
    message,
    sessionId: tempSessionId,
  });

  return c.json({
    data: {
      reply: result.text ?? "I wasn't able to generate a response.",
      toolCalls: result.toolCalls,
    },
  });
});

// ════════════════════════════════════════════════════════════
// WEBSOCKET CHAT (Phase 2.3 — Bidirectional)
//
// Enables:
//   - Real-time message streaming (replaces SSE for WS clients)
//   - Cancel/interrupt signals from the client
//   - Client-side tool responses (browser → server tool result)
//
// Protocol (JSON messages):
//   Client → Server:
//     { type: "auth", token: "jwt..." }
//     { type: "send", sessionId: "...", message: "..." }
//     { type: "cancel", sessionId: "..." }
//     { type: "tool-response", toolId: "...", result: any }
//
//   Server → Client:
//     { type: "authenticated", userId: "..." }
//     { type: "session.status", status: "busy" | "idle" }
//     { type: "message.delta", content: "..." }
//     { type: "tool.start", toolId: "...", name: "...", input: {...} }
//     { type: "tool.result", toolId: "...", output: any }
//     { type: "message.done", messageId: "..." }
//     { type: "error", message: "..." }
// ════════════════════════════════════════════════════════════

/** Active WS connections keyed by sessionId */
const wsConnections = new Map<string, Set<any>>();

/** Pending client-side tool responses keyed by toolId */
const pendingToolResponses = new Map<
  string,
  { resolve: (result: unknown) => void; timeout: ReturnType<typeof setTimeout> }
>();

/**
 * Wait for a client-side tool response with a timeout.
 * Called by client-side tools when they need browser input.
 */
export function waitForClientToolResponse(
  toolId: string,
  timeoutMs: number = 30_000
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingToolResponses.delete(toolId);
      reject(new Error(`Client tool response timeout for ${toolId}`));
    }, timeoutMs);

    pendingToolResponses.set(toolId, { resolve, timeout });
  });
}

chat.get("/chat/ws", websocket((c, ws) => {
  let authed = false;
  let userId: string | null = null;
  let currentSessionId: string | null = null;

  ws.onOpen(() => {
    ws.send(JSON.stringify({ type: "connected", properties: { requiresAuth: true } }));
  });

  ws.onMessage(async (event) => {
    let data: any;
    try {
      data = JSON.parse(event.data as string);
    } catch {
      ws.send(JSON.stringify({ type: "error", properties: { message: "Invalid JSON" } }));
      return;
    }

    // ── Auth ──
    if (data.type === "auth") {
      const payload = await verifyToken(data.token);
      if (!payload) {
        ws.send(JSON.stringify({ type: "error", properties: { message: "Invalid token" } }));
        return;
      }
      authed = true;
      userId = payload.sub ?? null;
      ws.send(JSON.stringify({ type: "authenticated", properties: { userId } }));
      return;
    }

    // All other messages require auth
    if (!authed || !userId) {
      ws.send(JSON.stringify({ type: "error", properties: { message: "Not authenticated" } }));
      return;
    }

    // ── Send message ──
    if (data.type === "send") {
      const { sessionId, message: userMessage } = data;
      if (!sessionId || !userMessage) {
        ws.send(JSON.stringify({ type: "error", properties: { message: "sessionId and message required" } }));
        return;
      }

      // Verify session ownership
      const session = await db.query.chatSessions.findFirst({
        where: and(
          eq(chatSessions.id, sessionId),
          eq(chatSessions.userId, userId)
        ),
      });
      if (!session) {
        ws.send(JSON.stringify({ type: "error", properties: { message: "Session not found" } }));
        return;
      }

      // Track WS connection for this session
      currentSessionId = sessionId;
      let conns = wsConnections.get(sessionId);
      if (!conns) {
        conns = new Set();
        wsConnections.set(sessionId, conns);
      }
      conns.add(ws);

      // Persist user message
      await db.insert(chatMessages).values({
        sessionId,
        role: "user",
        content: userMessage,
      });

      // Broadcast busy (goes to both SSE and WS via unified broadcast)
      broadcast(sessionId, "session.status", { status: "busy" });

      // Build context and start streaming
      const { summary, recentMessages } = await getConversationContext(sessionId);

      processStream(
        sessionId,
        userMessage,
        recentMessages,
        summary,
        session.title,
        undefined, // sandboxApi
        undefined, // kv
        undefined, // logger
        undefined  // userName (not available in WS context)
      ).catch((err: any) => {
        broadcast(sessionId, "error", { message: err?.message || "Stream failed" });
      });

      return;
    }

    // ── Cancel ──
    if (data.type === "cancel") {
      const cancelSessionId = data.sessionId;
      const controller = sessionAbortControllers.get(cancelSessionId);
      if (controller) {
        controller.abort();
        sessionAbortControllers.delete(cancelSessionId);
      }
      broadcast(cancelSessionId, "session.status", { status: "idle" });
      ws.send(JSON.stringify({ type: "cancel.ack", properties: { sessionId: cancelSessionId } }));
      return;
    }

    // ── Client-side tool response ──
    if (data.type === "tool-response") {
      const { toolId, result } = data;
      const pending = pendingToolResponses.get(toolId);
      if (pending) {
        clearTimeout(pending.timeout);
        pending.resolve(result);
        pendingToolResponses.delete(toolId);
      }
      return;
    }
  });

  ws.onClose(() => {
    if (currentSessionId) {
      const conns = wsConnections.get(currentSessionId);
      if (conns) {
        conns.delete(ws);
        if (conns.size === 0) wsConnections.delete(currentSessionId);
      }
    }
  });
}));

// ════════════════════════════════════════════════════════════
// ATTACHMENT ROUTES (mounted here to ensure CLI discovery)
// ════════════════════════════════════════════════════════════

/**
 * Attachment upload and retrieval routes are defined in attachments.ts
 * but mounted through chat.ts to guarantee they're available in the
 * deployed app (the Agentuity CLI auto-discovers chat.ts reliably).
 */
import attachmentRoutes from "./attachments";
chat.route("/", attachmentRoutes);

export default chat;
