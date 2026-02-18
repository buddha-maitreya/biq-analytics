import { createRouter } from "@agentuity/runtime";
import { errorMiddleware, ValidationError, NotFoundError } from "@lib/errors";
import { authMiddleware, verifyToken } from "@services/auth";
import type { AuthUser } from "@services/auth";
import {
  db,
  chatSessions,
  chatMessages,
} from "@db/index";
import { eq, desc, and } from "drizzle-orm";
import {
  streamChat,
  getConversationContext,
  maybeCompressSummary,
} from "../agent/data-science/index";

// ────────────────────────────────────────────────────────────
// In-memory SSE event bus (per-session, per-deployment)
//
// Each active session has a Set of writable callbacks.
// When the Data Science Agent streams, we push events to all
// connected clients on that session (normally just one browser tab).
// ────────────────────────────────────────────────────────────

type SSEWriter = (event: string, data: unknown) => void;
const sessionBus = new Map<string, Set<SSEWriter>>();

function addWriter(sessionId: string, writer: SSEWriter) {
  let writers = sessionBus.get(sessionId);
  if (!writers) {
    writers = new Set();
    sessionBus.set(sessionId, writers);
  }
  writers.add(writer);
}

function removeWriter(sessionId: string, writer: SSEWriter) {
  const writers = sessionBus.get(sessionId);
  if (writers) {
    writers.delete(writer);
    if (writers.size === 0) sessionBus.delete(sessionId);
  }
}

function broadcast(sessionId: string, event: string, data: unknown) {
  const writers = sessionBus.get(sessionId);
  if (writers) {
    for (const write of writers) {
      try {
        write(event, data);
      } catch {
        // Writer may have been closed
      }
    }
  }
}

// ────────────────────────────────────────────────────────────
// Router
// ────────────────────────────────────────────────────────────

const chat = createRouter();
chat.use(errorMiddleware());

// Auth middleware for all routes EXCEPT SSE events endpoint
// (EventSource can't set headers — SSE uses query param auth)
chat.use("/chat/*", async (c, next) => {
  if (c.req.path.endsWith("/events")) {
    await next();
    return;
  }
  return authMiddleware()(c, next);
});

// ── Helper: extract user from context ────────────────────────
function getUser(c: any): AuthUser {
  return c.get("authUser" as any) as AuthUser;
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
 * Auth via query param ?token= (EventSource can't set headers).
 * Sends keepalive pings every 15s.
 * Events arrive when the user sends a message via POST /sessions/:id/send.
 */
chat.get("/chat/sessions/:id/events", async (c) => {
  const sessionId = c.req.param("id");

  // Auth from query param (EventSource limitation)
  const url = new URL(c.req.url);
  const token = url.searchParams.get("token");
  if (!token) {
    return c.json({ error: "Token required" }, 401);
  }

  const payload = await verifyToken(token);
  if (!payload) {
    return c.json({ error: "Invalid token" }, 401);
  }

  // Verify session ownership
  const session = await db.query.chatSessions.findFirst({
    where: and(
      eq(chatSessions.id, sessionId),
      eq(chatSessions.userId, payload.sub!)
    ),
  });
  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }

  // SSE response
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      function send(event: string, data: unknown) {
        const payload = JSON.stringify({ type: event, properties: data });
        controller.enqueue(
          encoder.encode(`data: ${payload}\n\n`)
        );
      }

      // Register writer
      addWriter(sessionId, send);

      // Send connected event
      send("session.connected", { sessionId });

      // Keepalive ping every 15s
      const pingInterval = setInterval(() => {
        try {
          send("ping", { ts: Date.now() });
        } catch {
          clearInterval(pingInterval);
        }
      }, 15_000);

      // Cleanup on close
      c.req.raw.signal.addEventListener("abort", () => {
        clearInterval(pingInterval);
        removeWriter(sessionId, send);
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});

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
chat.post("/chat/sessions/:id/send", async (c) => {
  const user = getUser(c);
  const sessionId = c.req.param("id");
  const { message } = await c.req.json();

  if (!message || typeof message !== "string") {
    throw new ValidationError("message is required and must be a string");
  }

  // Verify ownership
  const session = await db.query.chatSessions.findFirst({
    where: and(
      eq(chatSessions.id, sessionId),
      eq(chatSessions.userId, user.id)
    ),
  });
  if (!session) throw new NotFoundError("Chat session", sessionId);

  // Persist user message
  await db.insert(chatMessages).values({
    sessionId,
    role: "user",
    content: message,
  });

  // Broadcast: session is busy
  broadcast(sessionId, "session.status", { status: "busy" });

  // Build conversation context (rolling summary + recent messages)
  const { summary, recentMessages } = await getConversationContext(sessionId);

  // Start streaming (non-blocking — events go to SSE bus)
  processStream(sessionId, message, recentMessages, summary, session.title).catch(
    (err) => {
      broadcast(sessionId, "error", {
        message: err?.message || "Stream processing failed",
      });
    }
  );

  // Return immediately (fire-and-forget)
  return c.json({ data: { messageId: sessionId, status: "processing" } });
});

/**
 * Process the AI stream and broadcast SSE events.
 * Runs async after the HTTP response is sent.
 */
async function processStream(
  sessionId: string,
  message: string,
  history: Array<{ role: "user" | "assistant" | "system"; content: string }>,
  conversationSummary: string | undefined,
  sessionTitle: string | null
) {
  const result = await streamChat(message, sessionId, history, conversationSummary);
  const fullStream = result.fullStream;

  let fullText = "";
  const toolCalls: Array<{
    id: string;
    name: string;
    input: Record<string, unknown>;
    output?: unknown;
    status: string;
  }> = [];

  for await (const chunk of fullStream) {
    switch (chunk.type) {
      case "text-delta":
        fullText += chunk.textDelta;
        broadcast(sessionId, "message.delta", {
          content: chunk.textDelta,
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

  // Auto-title on first message (non-blocking)
  if (!sessionTitle) {
    autoTitleSession(sessionId, message).catch(() => {});
  }

  // Maybe compress summary (non-blocking)
  maybeCompressSummary(sessionId).catch(() => {});

  // Update session timestamp
  try {
    await db
      .update(chatSessions)
      .set({ updatedAt: new Date() })
      .where(eq(chatSessions.id, sessionId));
  } catch {
    // Non-critical
  }
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
chat.post("/chat/messages/:id/feedback", async (c) => {
  const messageId = c.req.param("id");
  const { rating } = await c.req.json();

  if (rating !== "up" && rating !== "down") {
    throw new ValidationError("rating must be 'up' or 'down'");
  }

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

chat.post("/chat", async (c) => {
  const { message } = await c.req.json();

  if (!message || typeof message !== "string") {
    throw new ValidationError("message is required and must be a string");
  }

  // Use data-science agent directly (non-streaming fallback)
  const dataScienceAgent = (await import("../agent/data-science/index")).default;
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

export default chat;
