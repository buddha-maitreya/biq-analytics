/**
 * Chat Service — Conversation context, session management, message persistence
 *
 * Database operations for chat sessions and messages.
 * These are service-layer concerns (not agent logic) and are used
 * by both the chat API routes and the data-science agent.
 */

import { generateText } from "ai";
import { db, chatSessions, chatMessages } from "@db/index";
import { eq, desc, sql } from "drizzle-orm";
import { getModel } from "@lib/ai";
import { getAgentConfigWithDefaults } from "@services/agent-configs";
import { memoryCache } from "@lib/cache";

// ── Message Persistence ─────────────────────────────────────

/** Tool call entry shape stored in message metadata */
export interface ToolCallEntry {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output?: unknown;
  status: "completed" | "failed";
}

/** Parameters for persisting a chat message */
export interface SaveMessageInput {
  sessionId: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolCalls?: ToolCallEntry[];
  metadata?: Record<string, unknown>;
}

/**
 * Persist a chat message to the database.
 * Used by both the chat route (user messages) and agents (assistant messages).
 */
export async function saveChatMessage(input: SaveMessageInput): Promise<void> {
  await db.insert(chatMessages).values({
    sessionId: input.sessionId,
    role: input.role,
    content: input.content,
    toolCalls: input.toolCalls?.length ? input.toolCalls : undefined,
    metadata: input.metadata,
  });
}

// ── Defaults (can be overridden via agent_configs DB) ───────

const DEFAULT_RECENT_MESSAGE_COUNT = 10;
const DEFAULT_COMPRESSION_THRESHOLD = 20;
/** Below this message count, use extractive (no-LLM) compression */
const EXTRACTIVE_THRESHOLD = 35;

// ── Conversation Context ────────────────────────────────────

/**
 * Build conversation context for a session.
 * Returns the rolling summary (if any) and recent messages.
 */
export async function getConversationContext(sessionId: string): Promise<{
  summary: string | undefined;
  recentMessages: Array<{
    role: "user" | "assistant" | "system";
    content: string;
  }>;
}> {
  // Load config for recent message count
  const agentConfig = await getAgentConfigWithDefaults("data-science");
  const agentCfg = (agentConfig.config ?? {}) as Record<string, unknown>;
  const recentMessageCount =
    (agentCfg.recentMessageCount as number) ?? DEFAULT_RECENT_MESSAGE_COUNT;

  // Load session summary and recent messages in parallel (saves one DB round trip)
  const [session, messages] = await Promise.all([
    db.query.chatSessions.findFirst({
      where: eq(chatSessions.id, sessionId),
    }),
    db.query.chatMessages.findMany({
      where: eq(chatMessages.sessionId, sessionId),
      orderBy: [desc(chatMessages.createdAt)],
      limit: recentMessageCount,
    }),
  ]);

  const summary = (session?.metadata as Record<string, unknown>)?.summary as
    | string
    | undefined;

  const recentMessages = messages
    .reverse()
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content || "",
    }));

  return { summary, recentMessages };
}

// ── Summary Compression ─────────────────────────────────────

/**
 * Compress older messages into a rolling summary.
 * Called after each assistant response (non-blocking via waitUntil).
 *
 * Two-tier compression strategy (Phase 3.3):
 *   1. Extractive (no-LLM): For moderate conversations (20-35 messages),
 *      extracts key sentences as bullet points — free, instant, no API cost.
 *   2. LLM-based: For longer conversations (35+ messages), uses a cheap model
 *      for abstractive summarization — higher quality but costs a call.
 *
 * Only triggers when the message count exceeds the threshold.
 */
export async function maybeCompressSummary(
  sessionId: string
): Promise<void> {
  // Load config for thresholds
  const agentConfig = await getAgentConfigWithDefaults("data-science");
  const agentCfg = (agentConfig.config ?? {}) as Record<string, unknown>;
  const compressionThreshold =
    (agentCfg.compressionThreshold as number) ?? DEFAULT_COMPRESSION_THRESHOLD;
  const recentMessageCount =
    (agentCfg.recentMessageCount as number) ?? DEFAULT_RECENT_MESSAGE_COUNT;
  const compressionModel =
    (agentCfg.compressionModel as string) ?? "gpt-4o-mini";

  // Count total messages in session
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(chatMessages)
    .where(eq(chatMessages.sessionId, sessionId));

  const messageCount = Number(count);
  if (messageCount < compressionThreshold) return;

  // Load the existing summary
  const session = await db.query.chatSessions.findFirst({
    where: eq(chatSessions.id, sessionId),
  });
  const existingSummary = (session?.metadata as Record<string, unknown>)
    ?.summary as string | undefined;

  // Load all messages except the most recent N (which stay as raw context)
  const allMessages = await db.query.chatMessages.findMany({
    where: eq(chatMessages.sessionId, sessionId),
    orderBy: [desc(chatMessages.createdAt)],
  });
  const olderMessages = allMessages
    .reverse()
    .slice(0, -recentMessageCount)
    .filter((m) => m.role === "user" || m.role === "assistant");

  if (olderMessages.length < 5) return;

  let summaryText: string;

  if (messageCount < EXTRACTIVE_THRESHOLD) {
    // ── Tier 1: Extractive compression (no LLM call) ────────
    summaryText = extractiveSummarize(olderMessages, existingSummary);
  } else {
    // ── Tier 2: LLM-based abstractive compression ───────────
    const transcript = olderMessages
      .map((m) => `${m.role}: ${(m.content || "").slice(0, 500)}`)
      .join("\n");

    const compressPrompt = existingSummary
      ? `You are summarizing a business conversation. Here is the previous summary:\n\n${existingSummary}\n\nHere are additional messages since that summary:\n\n${transcript}\n\nProduce an updated summary that captures ALL key facts, decisions, data points, and context from the conversation. Be factual and concise. Use bullet points. Maximum 400 words.`
      : `You are summarizing a business conversation. Here are the messages:\n\n${transcript}\n\nProduce a concise summary capturing ALL key facts, decisions, data points, and context. Be factual. Use bullet points. Maximum 400 words.`;

    try {
      const { text } = await generateText({
        model: await getModel(compressionModel),
        prompt: compressPrompt,
      });
      summaryText = text;
    } catch {
      // LLM failed — fall back to extractive
      summaryText = extractiveSummarize(olderMessages, existingSummary);
    }
  }

  // Store in session metadata
  try {
    const currentMeta =
      (session?.metadata as Record<string, unknown>) || {};
    await db
      .update(chatSessions)
      .set({
        metadata: { ...currentMeta, summary: summaryText },
        updatedAt: new Date(),
      })
      .where(eq(chatSessions.id, sessionId));
  } catch {
    // Non-critical — summary compression failure doesn't block the user
  }
}

/**
 * Extractive summarization — extracts key sentences without LLM.
 *
 * Strategy:
 *   1. Keep user questions as-is (they define the topics)
 *   2. Extract the first sentence of each assistant response (usually the key finding)
 *   3. Merge with existing summary if present
 *   4. Cap at ~400 words
 */
function extractiveSummarize(
  messages: Array<{ role: string; content: string | null }>,
  existingSummary?: string
): string {
  const bullets: string[] = [];

  if (existingSummary) {
    bullets.push(`Previous context: ${existingSummary.slice(0, 300)}`);
  }

  for (const msg of messages) {
    const content = (msg.content || "").trim();
    if (!content) continue;

    if (msg.role === "user") {
      // Keep user queries as compact bullets
      const shortContent = content.length > 120 ? content.slice(0, 117) + "..." : content;
      bullets.push(`- User asked: ${shortContent}`);
    } else if (msg.role === "assistant") {
      // Extract first meaningful sentence from assistant response
      const firstSentence = content.split(/[.!?\n]/).find((s) => s.trim().length > 20);
      if (firstSentence) {
        const short = firstSentence.trim().slice(0, 150);
        bullets.push(`- ${short}`);
      }
    }
  }

  // Cap at ~400 words
  let result = bullets.join("\n");
  const words = result.split(/\s+/);
  if (words.length > 400) {
    result = words.slice(0, 400).join(" ") + "...";
  }

  return result;
}
