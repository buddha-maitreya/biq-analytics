/**
 * Report Generator Agent -- Evaluation Suite
 *
 * Phase 7.6: Quality evaluations for the report writing agent.
 * Evals run automatically via `waitUntil()` after each response.
 */

import agent from "./agent";

/**
 * Report Structure: Checks that the report contains expected sections
 * (executive summary, metrics, recommendations, etc.).
 */
export const reportStructureEval = agent.createEval("report-structure", {
  description:
    "Verifies the report contains key structural elements (summary, metrics, recommendations)",
  handler: async (_ctx, _input, output) => {
    const content = (output.content ?? "").toLowerCase();
    const len = content.length;

    if (len < 100) {
      return {
        passed: false,
        reason: `Report too short (${len} chars)`,
        score: 0,
        metadata: { contentLength: len },
      };
    }

    // Check for expected structural sections
    const sections = {
      summary: /executive\s*summary|overview|highlights/i.test(content),
      metrics: /key\s*metrics|key\s*figures|\d+(\.\d+)?%/i.test(content),
      recommendations:
        /recommend|suggest|action\s*items?|next\s*steps?/i.test(content),
      data: /\d/.test(content), // Contains at least some numbers
    };

    const found = Object.values(sections).filter(Boolean).length;
    const total = Object.keys(sections).length;
    const score = found / total;

    return {
      passed: found >= 3,
      reason:
        found >= total
          ? "All structural sections present"
          : `${found}/${total} expected sections found`,
      score,
      metadata: { ...sections, contentLength: len },
    };
  },
});

/**
 * Report Completeness: Ensures the report has sufficient detail
 * and doesn't appear truncated or empty.
 */
export const reportCompletenessEval = agent.createEval("report-completeness", {
  description: "Checks that the report is complete and not truncated",
  handler: async (_ctx, _input, output) => {
    const content = output.content ?? "";
    const title = output.title ?? "";
    const len = content.length;

    // Reports should be substantial (200+ chars for even the shortest)
    const minLength = 200;
    if (len < minLength) {
      return {
        passed: false,
        reason: `Report content is only ${len} chars (minimum: ${minLength})`,
        score: len / minLength,
        metadata: { contentLength: len, title },
      };
    }

    // Check for truncation indicators
    const truncated =
      content.endsWith("...") ||
      content.endsWith("…") ||
      /\[truncated\]|\[continued\]/i.test(content);

    return {
      passed: !truncated,
      reason: truncated
        ? "Report appears truncated"
        : `Report complete (${len} chars)`,
      score: truncated ? 0.5 : 1,
      metadata: { contentLength: len, title, truncated },
    };
  },
});

/**
 * Factual Consistency: Verifies that the report title and type match
 * the requested report type (no misrouted reports).
 */
export const factualConsistencyEval = agent.createEval("factual-consistency", {
  description: "Checks that the report type and title match the request",
  handler: async (_ctx, input, output) => {
    const requestedType = input.reportType ?? "";
    const actualType = output.reportType ?? "";
    const title = output.title ?? "";

    const typeMatch =
      actualType === requestedType ||
      title.toLowerCase().includes(requestedType.replace(/-/g, " "));

    return {
      passed: typeMatch,
      reason: typeMatch
        ? `Report type matches request (${requestedType})`
        : `Type mismatch: requested "${requestedType}", got "${actualType}"`,
      score: typeMatch ? 1 : 0,
      metadata: { requestedType, actualType, title },
    };
  },
});
