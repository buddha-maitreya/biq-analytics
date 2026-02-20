/**
 * Token Budget Management — Phase 7.5
 *
 * Approximate token counting and budget enforcement for LLM calls.
 * Uses character-based estimation (1 token ≈ 4 characters for English text)
 * which is accurate to ±10% for most business text. No external tokenizer
 * dependency needed.
 *
 * Provides:
 *   - `estimateTokens(text)` — approximate token count
 *   - `enforceTokenBudget(text, budget)` — truncate if over budget
 *   - `createTokenTracker()` — per-request accumulator for tracking usage
 *   - Default budgets per agent role
 */

// ── Token Estimation ───────────────────────────────────────

/**
 * Approximate token count for a string.
 *
 * Uses the standard ≈4 chars/token heuristic. This is intentionally
 * simple — no tiktoken dependency, works offline, and is accurate
 * enough for budget enforcement (not billing).
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // Rough: 1 token ≈ 4 chars for English, slightly more for code/JSON
  return Math.ceil(text.length / 4);
}

/**
 * Estimate tokens for a chat message array (system + conversation).
 * Accounts for message framing overhead (~4 tokens per message).
 */
export function estimateConversationTokens(
  systemPrompt: string,
  messages: Array<{ role: string; content: string }>
): number {
  let total = estimateTokens(systemPrompt);
  for (const msg of messages) {
    total += estimateTokens(msg.content) + 4; // ~4 tokens overhead per message frame
  }
  return total;
}

// ── Budget Enforcement ─────────────────────────────────────

/** Default token budgets per agent. Configurable via agent_configs.config.tokenBudget */
export const DEFAULT_TOKEN_BUDGETS: Record<string, number> = {
  "data-science": 128_000, // GPT-4o context window
  "insights-analyzer": 64_000,
  "report-generator": 64_000,
  "knowledge-base": 32_000,
};

/**
 * Enforce a token budget on input text by truncating from the middle
 * if it exceeds the budget. Preserves the beginning (context) and
 * end (most recent content) of the text.
 *
 * @returns The (possibly truncated) text and whether truncation occurred
 */
export function enforceTokenBudget(
  text: string,
  budgetTokens: number
): { text: string; truncated: boolean; estimatedTokens: number } {
  const estimated = estimateTokens(text);
  if (estimated <= budgetTokens) {
    return { text, truncated: false, estimatedTokens: estimated };
  }

  // Truncate from the middle, preserving start and end
  const maxChars = budgetTokens * 4;
  const keepStart = Math.floor(maxChars * 0.6);
  const keepEnd = Math.floor(maxChars * 0.35);
  const truncated =
    text.slice(0, keepStart) +
    "\n\n[... content truncated to fit token budget ...]\n\n" +
    text.slice(-keepEnd);

  return {
    text: truncated,
    truncated: true,
    estimatedTokens: estimateTokens(truncated),
  };
}

/**
 * Truncate conversation history to fit within a token budget.
 * Removes oldest messages first (keeps system prompt + recent messages).
 */
export function truncateHistory(
  messages: Array<{ role: string; content: string }>,
  budgetTokens: number,
  systemPromptTokens: number = 0
): {
  messages: Array<{ role: string; content: string }>;
  removedCount: number;
} {
  let remaining = budgetTokens - systemPromptTokens;
  if (remaining <= 0)
    return { messages: [], removedCount: messages.length };

  // Walk from latest to oldest, accumulating token counts
  const kept: typeof messages = [];
  let tokensUsed = 0;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msgTokens = estimateTokens(messages[i].content) + 4;
    if (tokensUsed + msgTokens > remaining) break;
    tokensUsed += msgTokens;
    kept.unshift(messages[i]);
  }

  return {
    messages: kept,
    removedCount: messages.length - kept.length,
  };
}

// ── Token Tracker ──────────────────────────────────────────

/** Accumulates token usage across a multi-step agent request */
export interface TokenTracker {
  /** Add token usage from a single LLM call */
  add(promptTokens: number, completionTokens: number): void;
  /** Get total accumulated usage */
  totals(): {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    callCount: number;
  };
  /** Check if total is within budget */
  isWithinBudget(budget: number): boolean;
}

/**
 * Create a per-request token tracker.
 * Use to accumulate token usage across multi-step tool calls.
 */
export function createTokenTracker(): TokenTracker {
  let promptTotal = 0;
  let completionTotal = 0;
  let calls = 0;

  return {
    add(promptTokens: number, completionTokens: number) {
      promptTotal += promptTokens;
      completionTotal += completionTokens;
      calls++;
    },
    totals() {
      return {
        promptTokens: promptTotal,
        completionTokens: completionTotal,
        totalTokens: promptTotal + completionTotal,
        callCount: calls,
      };
    },
    isWithinBudget(budget: number) {
      return promptTotal + completionTotal <= budget;
    },
  };
}
