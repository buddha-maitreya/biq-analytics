/**
 * Data Science Agent -- Evaluation Suite
 *
 * Phase 7.6: Quality evaluations for the orchestrator agent.
 * Evals run automatically via `waitUntil()` after each response --
 * they do NOT block the response to the user.
 *
 * SDK ref: agent.createEval(name, { description, handler })
 * Handler receives (ctx, input, output) and returns { passed, reason, score?, metadata? }
 */

import agent from "./agent";

/**
 * Response Quality: Ensures the agent produces a non-trivial response.
 * Checks minimum length and that the response doesn't look like an error dump.
 */
export const responseQualityEval = agent.createEval("response-quality", {
  description:
    "Verifies the agent response is a substantive, non-trivial answer",
  handler: async (_ctx, _input, output) => {
    const text = output.text ?? "";
    const len = text.length;

    // Minimum meaningful response length
    if (len < 20) {
      return {
        passed: false,
        reason: `Response too short (${len} chars)`,
        score: 0,
        metadata: { responseLength: len },
      };
    }

    // Check for common error patterns that shouldn't be returned as answers
    const errorPatterns = [
      /^(error|exception|failed):/i,
      /internal server error/i,
      /undefined is not/i,
    ];
    const looksLikeError = errorPatterns.some((p) => p.test(text));

    const score = looksLikeError ? 0.3 : Math.min(len / 200, 1);
    return {
      passed: !looksLikeError && len >= 20,
      reason: looksLikeError
        ? "Response looks like an unhandled error"
        : "Response quality acceptable",
      score,
      metadata: { responseLength: len, looksLikeError },
    };
  },
});

/**
 * Tool Usage: Checks whether the agent used tools when it should have.
 * A response without tool calls usually means the LLM answered from
 * general knowledge rather than querying the business database.
 */
export const toolUsageEval = agent.createEval("tool-usage", {
  description:
    "Verifies the agent used at least one tool for data-backed answers",
  handler: async (_ctx, input, output) => {
    const toolCalls = output.toolCalls ?? [];
    const message = (input.message ?? "").toLowerCase();

    // Conversational messages (greetings, thanks) don't need tools
    const conversational =
      /^(hi|hello|hey|thanks|thank you|ok|bye|goodbye)\b/i.test(message) ||
      message.length < 10;

    if (conversational) {
      return {
        passed: true,
        reason: "Conversational message -- tool usage not required",
        metadata: { toolCallCount: toolCalls.length, conversational: true },
      };
    }

    const passed = toolCalls.length > 0;
    return {
      passed,
      reason: passed
        ? `Used ${toolCalls.length} tool(s)`
        : "No tools used for a data question -- may have hallucinated",
      score: passed ? 1 : 0.2,
      metadata: {
        toolCallCount: toolCalls.length,
        toolNames: toolCalls.map((tc: any) => tc.name),
      },
    };
  },
});

/**
 * Response Groundedness: Checks that the response references specific
 * data (numbers, percentages, names) rather than vague generalities.
 */
export const groundednessEval = agent.createEval("groundedness", {
  description:
    "Checks that the response contains specific data points, not vague generalities",
  handler: async (_ctx, _input, output) => {
    const text = output.text ?? "";

    // Count data indicators: numbers, percentages, currency values, product names with caps
    const numberCount = (text.match(/\d+(\.\d+)?/g) || []).length;
    const percentCount = (text.match(/\d+(\.\d+)?%/g) || []).length;
    const currencyCount = (
      text.match(/\$[\d,]+|[\d,]+\s*(USD|KES|EUR|GBP)/g) || []
    ).length;

    const totalIndicators = numberCount + percentCount + currencyCount;

    // Short responses may not need many indicators
    const threshold = text.length > 200 ? 3 : 1;
    const passed = totalIndicators >= threshold;

    return {
      passed,
      reason: passed
        ? `Found ${totalIndicators} data indicators`
        : `Only ${totalIndicators} data indicator(s) -- response may be too vague`,
      score: Math.min(totalIndicators / 5, 1),
      metadata: { numberCount, percentCount, currencyCount, totalIndicators },
    };
  },
});

/**
 * Hallucination Detection: Checks whether the response contains claims
 * that aren't backed by tool results. A hallucinated response will contain
 * specific-sounding data (names, percentages, amounts) despite having
 * no tool calls, or will claim facts that contradict the tool outputs.
 */
export const hallucinationDetectionEval = agent.createEval("hallucination-detection", {
  description:
    "Detects likely hallucinations by comparing response claims against tool results",
  handler: async (_ctx, input, output) => {
    const text = output.text ?? "";
    const toolCalls = output.toolCalls ?? [];
    const message = (input.message ?? "").toLowerCase();

    // Conversational messages (greetings, thanks) don't need hallucination checks
    const conversational =
      /^(hi|hello|hey|thanks|thank you|ok|bye|goodbye)\b/i.test(message) ||
      message.length < 10;

    if (conversational) {
      return {
        passed: true,
        reason: "Conversational message -- hallucination check not applicable",
        score: 1,
        metadata: { conversational: true },
      };
    }

    // ── Check 1: Data claims without tool usage ──────────────
    // If the response references specific numbers/amounts but no tools were called,
    // those numbers likely came from LLM training data, not the business DB
    const hasSpecificData =
      (text.match(/\d{2,}/g) || []).length > 3 || // many numbers
      (text.match(/\$[\d,]+(\.\d{2})?/g) || []).length > 0 || // currency amounts
      (text.match(/\d+(\.\d+)?%/g) || []).length > 1; // percentages

    const noToolsButDataClaims = toolCalls.length === 0 && hasSpecificData;

    // ── Check 2: Hedging language that suggests uncertainty ──
    const hedgingPatterns = [
      /\bi (?:don'?t|do not) have (?:access|data)/i,
      /\bi (?:can'?t|cannot) (?:access|query|check)/i,
      /\bbased on (?:my|general) knowledge/i,
      /\btypically|usually|generally speaking/i,
      /\bI would estimate/i,
      /\bwithout access to/i,
      /\bI'm not sure/i,
      /\bassuming|presumably/i,
    ];
    const hedgingCount = hedgingPatterns.filter((p) => p.test(text)).length;
    const heavyHedging = hedgingCount >= 2;

    // ── Check 3: Contradictory claims ────────────────────────
    // Look for the response containing numbers that directly conflict with tool outputs
    let contradictionScore = 0;
    if (toolCalls.length > 0) {
      // Extract all numbers from tool results
      const toolOutputNumbers = new Set<string>();
      for (const tc of toolCalls) {
        const outputStr = JSON.stringify(tc.output ?? "");
        const nums = outputStr.match(/\d+(\.\d+)?/g) || [];
        nums.forEach((n) => toolOutputNumbers.add(n));
      }

      // Extract numbers from the response text
      const responseNumbers = text.match(/\b\d+(\.\d+)?\b/g) || [];

      // Count numbers in response that DON'T appear in tool results
      // (allowing for small formatting differences)
      const unbackedNumbers = responseNumbers.filter(
        (n) => n.length >= 3 && !toolOutputNumbers.has(n)
      );

      // High ratio of unbacked numbers = likely hallucination
      if (responseNumbers.length > 0) {
        contradictionScore = unbackedNumbers.length / responseNumbers.length;
      }
    }

    // ── Aggregate hallucination probability ──────────────────
    let hallucinationRisk = 0;
    const reasons: string[] = [];

    if (noToolsButDataClaims) {
      hallucinationRisk += 0.5;
      reasons.push("Contains specific data claims without tool usage");
    }
    if (heavyHedging) {
      hallucinationRisk += 0.3;
      reasons.push(`Heavy hedging language (${hedgingCount} patterns)`);
    }
    if (contradictionScore > 0.5) {
      hallucinationRisk += 0.2 * contradictionScore;
      reasons.push(
        `${Math.round(contradictionScore * 100)}% of response numbers not found in tool outputs`
      );
    }

    const passed = hallucinationRisk < 0.4;
    const score = Math.max(0, 1 - hallucinationRisk);

    return {
      passed,
      reason: passed
        ? "No significant hallucination indicators detected"
        : `Hallucination risk: ${reasons.join("; ")}`,
      score,
      metadata: {
        hallucinationRisk: Math.round(hallucinationRisk * 100) / 100,
        noToolsButDataClaims,
        hedgingCount,
        contradictionScore: Math.round(contradictionScore * 100) / 100,
        toolCallCount: toolCalls.length,
      },
    };
  },
});
