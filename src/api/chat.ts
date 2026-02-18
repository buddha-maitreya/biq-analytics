import { createRouter } from "@agentuity/runtime";
import { generateText } from "ai";
import { errorMiddleware, ValidationError } from "@lib/errors";
import { authMiddleware, verifyToken, getUserFromToken } from "@services/auth";
import type { AuthUser } from "@services/auth";
import {
  db,
  chatSessions,
  chatMessages,
} from "@db/index";
import { eq, desc, and, sql } from "drizzle-orm";
import { streamChat, getConversationContext, maybeCompressSummary } from "@agent/data-science";
import { getModel } from "@lib/ai";

const chat = createRouter();
chat.use(errorMiddleware());

/**
 * Generate a concise 4-6 word session title from the first user message.
 * Uses gpt-4o-mini (cheap & fast). Returns null on failure.
 */
async function generateSessionTitle(
  firstMessage: string
): Promise<string | null> {
  try {
    const { text } = await generateText({
      model: getModel("gpt-4o-mini"),
      prompt: `Generate a concise 4-6 word title for a business chat conversation that starts with this message. Return ONLY the title, no quotes, no punctuation at the end.\n\nUser message: "${firstMessage.slice(0, 200)}"`,
    });
    const title = text.trim().replace(/^["']|["']$/g, "");
    return title.length > 0 && title.length < 80 ? title : null;
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────────────
// Session Event Bus — in-memory pub/sub per session
//
// Adapted from Agentuity Coder's SSE proxy architecture.
// POST /send fires the agent and emits events to the bus.
// GET /events subscribes and streams events to the frontend.
// A short-lived buffer prevents events from being lost if
// the EventSource connects slightly after the agent starts.
// ────────────────────────────────────────────────────────────

type EventListener = (eventType: string, data: unknown) => void;

const sessionListeners = new Map<string, Set<EventListener>>();
const sessionEventBuffer = new Map<
  string,
  Array<{ type: string; data: unknown; ts: number }>
>();
const MAX_BUFFER = 200;
const BUFFER_TTL_MS = 30_000;

/**
 * Emit an SSE event to all subscribers of a session.
 * Also buffers the event for late-connecting EventSource clients.
 */
function emitSessionEvent(sessionId: string, type: string, data: unknown) {
  // Buffer
  let buffer = sessionEventBuffer.get(sessionId);
  if (!buffer) {
    buffer = [];
    sessionEventBuffer.set(sessionId, buffer);
  }
  buffer.push({ type, data, ts: Date.now() });
  if (buffer.length > MAX_BUFFER) buffer.shift();

  // Deliver to live listeners
  const listeners = sessionListeners.get(sessionId);
  if (listeners) {
    for (const fn of listeners) {
      fn(type, data);
    }
  }
}

/**
 * Subscribe to SSE events for a session. Replays any buffered
 * events (within TTL) before switching to live delivery.
 * Returns an unsubscribe function.
 */
function subscribeSession(
  sessionId: string,
  listener: EventListener
): () => void {
  // Replay buffered events (within TTL)
  const buffer = sessionEventBuffer.get(sessionId) || [];
  const now = Date.now();
  for (const entry of buffer) {
    if (now - entry.ts < BUFFER_TTL_MS) {
      listener(entry.type, entry.data);
    }
  }
  // Clear stale buffer after replay
  sessionEventBuffer.delete(sessionId);

  // Subscribe for live events
  let listeners = sessionListeners.get(sessionId);
  if (!listeners) {
    listeners = new Set();
    sessionListeners.set(sessionId, listeners);
  }
  listeners.add(listener);

  return () => {
    listeners!.delete(listener);
    if (listeners!.size === 0) {
      sessionListeners.delete(sessionId);
    }
  };
}

// ────────────────────────────────────────────────────────────
// Session CRUD (auth via middleware)
// ────────────────────────────────────────────────────────────

/** POST /chat/sessions — Create a new chat session */
chat.post("/chat/sessions", authMiddleware(), async (c) => {
  const authUser = c.get("authUser" as any) as AuthUser;
  const body = await c.req.json().catch(() => ({}));

  const [session] = await db
    .insert(chatSessions)
    .values({
      userId: authUser.id,
      title: body.title || null,
      status: "active",
    })
    .returning();

  return c.json({ data: session }, 201);
});

/** GET /chat/sessions — List user's chat sessions */
chat.get("/chat/sessions", authMiddleware(), async (c) => {
  const authUser = c.get("authUser" as any) as AuthUser;
  const status = c.req.query("status") || "active";

  const sessions = await db.query.chatSessions.findMany({
    where: and(
      eq(chatSessions.userId, authUser.id),
      eq(chatSessions.status, status)
    ),
    orderBy: [desc(chatSessions.updatedAt)],
    limit: 50,
  });

  return c.json({ data: sessions });
});

/** DELETE /chat/sessions/:id — Delete (archive) a chat session */
chat.delete("/chat/sessions/:id", authMiddleware(), async (c) => {
  const authUser = c.get("authUser" as any) as AuthUser;
  const sessionId = c.req.param("id");

  await db
    .update(chatSessions)
    .set({ status: "archived", updatedAt: new Date() })
    .where(
      and(
        eq(chatSessions.id, sessionId),
        eq(chatSessions.userId, authUser.id)
      )
    );

  return c.json({ success: true });
});

// ────────────────────────────────────────────────────────────
// Messages
// ────────────────────────────────────────────────────────────

/** GET /chat/sessions/:id/messages — Get messages for a session */
chat.get("/chat/sessions/:id/messages", authMiddleware(), async (c) => {
  const sessionId = c.req.param("id");
  const limit = parseInt(c.req.query("limit") || "50", 10);

  const messages = await db.query.chatMessages.findMany({
    where: eq(chatMessages.sessionId, sessionId),
    orderBy: [desc(chatMessages.createdAt)],
    limit: limit + 1,
  });

  const hasMore = messages.length > limit;
  const result = (hasMore ? messages.slice(0, limit) : messages).reverse();

  return c.json({ data: result, hasMore });
});

// ────────────────────────────────────────────────────────────
// POST /chat/sessions/:id/send — Fire-and-forget message send
//
// Adapted from Agentuity Coder's fire-and-forget session pattern.
// Persists the user message, returns immediately, then processes
// the agent response in an async IIFE. Events flow to the
// EventSource SSE endpoint via the session event bus.
// ────────────────────────────────────────────────────────────

chat.post("/chat/sessions/:id/send", authMiddleware(), async (c) => {
  const authUser = c.get("authUser" as any) as AuthUser;
  const sessionId = c.req.param("id");
  const { message } = await c.req.json();

  if (!message || typeof message !== "string") {
    throw new ValidationError("message is required and must be a string");
  }

  // Verify session belongs to user
  const session = await db.query.chatSessions.findFirst({
    where: and(
      eq(chatSessions.id, sessionId),
      eq(chatSessions.userId, authUser.id)
    ),
  });
  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }

  // Persist user message
  const [userMsg] = await db
    .insert(chatMessages)
    .values({ sessionId, role: "user", content: message })
    .returning();

  // Auto-generate session title from first message (LLM, background)
  if (!session.title && message.length > 0) {
    // Set an immediate fallback title, then upgrade async
    const fallback =
      message.length > 60 ? message.slice(0, 57) + "..." : message;
    db.update(chatSessions)
      .set({ title: fallback, updatedAt: new Date() })
      .where(eq(chatSessions.id, sessionId))
      .then(() =>
        generateSessionTitle(message).then(async (aiTitle) => {
          if (aiTitle) {
            await db
              .update(chatSessions)
              .set({ title: aiTitle, updatedAt: new Date() })
              .where(eq(chatSessions.id, sessionId));
          }
        })
      )
      .catch(() => {});
  }

  // --- Fire-and-forget: start agent processing ---
  // Response events flow through the session event bus →
  // picked up by the GET /events SSE endpoint.
  (async () => {
    try {
      emitSessionEvent(sessionId, "session.status", { status: "busy" });

      // Build conversation context with rolling summary
      const { summary, recentMessages } =
        await getConversationContext(sessionId);

      const stream = await streamChat(
        message,
        sessionId,
        recentMessages,
        summary
      );

      let fullText = "";

      // Iterate the fullStream — each chunk is emitted to the event bus.
      // This mirrors the Coder project's SSE proxy loop but generates
      // events directly instead of proxying a remote stream.
      for await (const part of stream.fullStream) {
        switch (part.type) {
          case "text-delta":
            fullText += part.textDelta;
            emitSessionEvent(sessionId, "message.delta", {
              content: part.textDelta,
            });
            break;

          case "tool-call":
            emitSessionEvent(sessionId, "tool.start", {
              toolId: part.toolCallId,
              name: part.toolName,
              input: part.args,
            });
            break;

          case "tool-result":
            emitSessionEvent(sessionId, "tool.result", {
              toolId: part.toolCallId,
              name: (part as any).toolName,
              output: part.result,
            });
            break;

          case "error":
            emitSessionEvent(sessionId, "error", {
              message:
                part.error instanceof Error
                  ? part.error.message
                  : String(part.error),
            });
            break;

          default:
            break;
        }
      }

      // Collect final tool calls for persistence
      const steps = await stream.steps;
      const usage = await stream.usage;
      const finalToolCalls: Array<{
        id: string;
        name: string;
        input: Record<string, unknown>;
        output?: unknown;
        status: "completed" | "error";
      }> = [];

      for (const step of steps) {
        if (step.toolCalls) {
          for (const tc of step.toolCalls) {
            const result = step.toolResults?.find(
              (tr: any) => tr.toolCallId === tc.toolCallId
            );
            finalToolCalls.push({
              id: tc.toolCallId,
              name: tc.toolName,
              input: tc.args as Record<string, unknown>,
              output: result?.result,
              status: result ? "completed" : "error",
            });
          }
        }
      }

      // Persist assistant message
      const [assistantMsg] = await db
        .insert(chatMessages)
        .values({
          sessionId,
          role: "assistant",
          content: fullText,
          toolCalls: finalToolCalls.length ? finalToolCalls : undefined,
          metadata: {
            model: "gpt-4o",
            tokens: usage
              ? {
                  prompt: usage.promptTokens,
                  completion: usage.completionTokens,
                }
              : undefined,
          },
        })
        .returning();

      // Update session timestamp
      await db
        .update(chatSessions)
        .set({ updatedAt: new Date() })
        .where(eq(chatSessions.id, sessionId));

      // Emit completion
      emitSessionEvent(sessionId, "message.done", {
        messageId: assistantMsg.id,
        toolCalls: finalToolCalls.length ? finalToolCalls : undefined,
      });

      emitSessionEvent(sessionId, "session.status", { status: "idle" });

      // Rolling summary compression (background, non-blocking)
      maybeCompressSummary(sessionId).catch(() => {});
    } catch (err: unknown) {
      emitSessionEvent(sessionId, "error", {
        message: err instanceof Error ? err.message : "Stream failed",
      });
      emitSessionEvent(sessionId, "session.status", { status: "idle" });
    }
  })();

  // Return immediately (fire-and-forget pattern from Coder)
  return c.json({ success: true, messageId: userMsg.id });
});

// ────────────────────────────────────────────────────────────
// GET /chat/sessions/:id/events — SSE event stream
//
// Adapted from Agentuity Coder's GET /:id/events SSE endpoint.
// Uses EventSource on the frontend. Auth via query param because
// EventSource doesn't support custom headers.
// Features: keepalive pings (15s), buffered event replay,
// proper cleanup on disconnect.
// ────────────────────────────────────────────────────────────

chat.get("/chat/sessions/:id/events", async (c) => {
  // Auth via query param (EventSource can't send custom headers)
  const token = c.req.query("token");
  if (!token) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const tokenPayload = await verifyToken(token);
  if (!tokenPayload || !tokenPayload.sub) {
    return c.json({ error: "Invalid or expired token" }, 401);
  }

  const sessionId = c.req.param("id");

  // Verify session belongs to this user
  const session = await db.query.chatSessions.findFirst({
    where: and(
      eq(chatSessions.id, sessionId),
      eq(chatSessions.userId, tokenPayload.sub)
    ),
  });
  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }

  // SSE stream with keepalive and event subscription
  let keepalive: ReturnType<typeof setInterval> | null = null;
  let unsubscribe: (() => void) | null = null;
  let closed = false;

  return c.newResponse(
    new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();

        // Safe write wrapper (mirrors Coder's safeWrite pattern)
        const write = (payload: { type: string; properties: unknown }) => {
          if (closed) return;
          try {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)
            );
          } catch {
            closed = true;
            cleanup();
          }
        };

        const cleanup = () => {
          closed = true;
          if (keepalive) {
            clearInterval(keepalive);
            keepalive = null;
          }
          unsubscribe?.();
        };

        // Keepalive ping every 15s (mirrors Coder's keepalive timer)
        keepalive = setInterval(() => {
          write({ type: "ping", properties: { ts: Date.now() } });
        }, 15_000);

        // Subscribe to session event bus
        unsubscribe = subscribeSession(
          sessionId,
          (eventType: string, data: unknown) => {
            write({ type: eventType, properties: data });
          }
        );

        // Send initial connection event
        write({
          type: "session.connected",
          properties: { sessionId },
        });
      },
      cancel() {
        closed = true;
        if (keepalive) {
          clearInterval(keepalive);
          keepalive = null;
        }
        unsubscribe?.();
      },
    }),
    {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    }
  );
});

// ────────────────────────────────────────────────────────────
// Feedback
// ────────────────────────────────────────────────────────────

/** POST /chat/messages/:id/feedback — Rate a message (thumbs up/down) */
chat.post("/chat/messages/:id/feedback", authMiddleware(), async (c) => {
  const messageId = c.req.param("id");
  const { rating } = await c.req.json();

  if (rating !== "up" && rating !== "down") {
    throw new ValidationError("rating must be 'up' or 'down'");
  }

  await db.execute(
    sql`UPDATE chat_messages SET metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({ feedbackRating: rating })}::jsonb WHERE id = ${messageId}`
  );

  return c.json({ success: true });
});

// ────────────────────────────────────────────────────────────
// Legacy endpoint (backward compat with existing assistant)
// ────────────────────────────────────────────────────────────

/** POST /chat — Simple request/response (non-streaming) */
chat.post("/chat", authMiddleware(), async (c) => {
  const { message } = await c.req.json();

  if (!message || typeof message !== "string") {
    throw new ValidationError("message is required and must be a string");
  }

  const dataScience = (await import("@agent/data-science")).default;
  const authUser = c.get("authUser" as any) as AuthUser;

  const [session] = await db
    .insert(chatSessions)
    .values({
      userId: authUser.id,
      title: message.slice(0, 80),
      status: "active",
    })
    .returning();

  const result = await dataScience.run({
    message,
    sessionId: session.id,
  });

  return c.json({
    data: {
      reply: result.text || "I wasn't able to generate a response.",
      data: result.toolCalls,
      suggestedActions: [],
    },
  });
});

export default chat;
