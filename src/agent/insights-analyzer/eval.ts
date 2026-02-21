/**
 * Insights Analyzer Agent -- Evaluation Suite
 *
 * Phase 7.6: Quality evaluations for the statistical analysis agent.
 * Phase 7.7: Preset evals from @agentuity/evals for production monitoring.
 * Evals run automatically via `waitUntil()` after each response.
 */

import agent from "./agent";
import { safety, conciseness } from "@agentuity/evals";

/**
 * Insight Completeness: Ensures the analysis returned at least one insight
 * with all required fields populated.
 */
export const insightCompletenessEval = agent.createEval("insight-completeness", {
  description: "Verifies insights have all required fields and are non-empty",
  handler: async (_ctx, _input, output) => {
    const insights = output.insights ?? [];

    if (insights.length === 0) {
      return {
        passed: false,
        reason: "No insights generated",
        score: 0,
        metadata: { insightCount: 0 },
      };
    }

    // Check each insight has title, severity, description, recommendation
    const requiredFields = ["title", "severity", "description", "recommendation"];
    let completeCount = 0;
    for (const insight of insights) {
      const ins = insight as Record<string, unknown>;
      const hasAll = requiredFields.every(
        (f) => ins[f] && String(ins[f]).trim().length > 0
      );
      if (hasAll) completeCount++;
    }

    const ratio = completeCount / insights.length;
    return {
      passed: ratio >= 0.8,
      reason:
        ratio >= 1
          ? `All ${insights.length} insights are complete`
          : `${completeCount}/${insights.length} insights have all required fields`,
      score: ratio,
      metadata: { insightCount: insights.length, completeCount, ratio },
    };
  },
});

/**
 * Confidence Calibration: Checks that confidence scores are present
 * and within reasonable bounds (not always 0.5 or always 1.0).
 */
export const confidenceCalibrationEval = agent.createEval(
  "confidence-calibration",
  {
    description:
      "Verifies confidence scores are present, varied, and in valid range (0-1)",
    handler: async (_ctx, _input, output) => {
      const insights = output.insights ?? [];
      if (insights.length === 0) {
        return {
          passed: false,
          reason: "No insights to evaluate confidence",
          score: 0,
        };
      }

      const confidences = insights
        .map((i: any) => i.confidence)
        .filter((c: unknown) => typeof c === "number") as number[];

      if (confidences.length === 0) {
        return {
          passed: false,
          reason: "No confidence scores found in insights",
          score: 0,
          metadata: { insightCount: insights.length },
        };
      }

      // All scores should be 0-1
      const inRange = confidences.every((c) => c >= 0 && c <= 1);
      // Scores shouldn't all be identical (indicates computation issue)
      const allSame =
        confidences.length > 1 &&
        confidences.every((c) => c === confidences[0]);

      const passed = inRange && !allSame;
      return {
        passed,
        reason: !inRange
          ? "Confidence scores out of [0,1] range"
          : allSame
            ? `All ${confidences.length} scores are identical (${confidences[0]}) — may indicate computation issue`
            : `${confidences.length} confidence scores in valid range`,
        score: inRange && !allSame ? 1 : 0.3,
        metadata: {
          scores: confidences,
          min: Math.min(...confidences),
          max: Math.max(...confidences),
          allSame,
        },
      };
    },
  }
);

/**
 * Severity Distribution: Warns if all insights have the same severity,
 * which may indicate the analysis isn't differentiating urgency levels.
 */
export const severityDistributionEval = agent.createEval(
  "severity-distribution",
  {
    description:
      "Checks that severity ratings vary across insights (info/warning/critical)",
    handler: async (_ctx, _input, output) => {
      const insights = output.insights ?? [];
      if (insights.length <= 1) {
        return {
          passed: true,
          reason: "Single or no insight — severity distribution not applicable",
          metadata: { insightCount: insights.length },
        };
      }

      const severities = new Set(
        insights.map((i: any) => i.severity).filter(Boolean)
      );
      const passed = severities.size > 1;

      return {
        passed,
        reason: passed
          ? `${severities.size} distinct severity levels used`
          : `All ${insights.length} insights share the same severity — may lack nuance`,
        score: Math.min(severities.size / 3, 1),
        metadata: {
          distinctSeverities: Array.from(severities),
          insightCount: insights.length,
        },
      };
    },
  }
);

// ── Preset Evals from @agentuity/evals ──────────────────────
// LLM-as-judge production monitoring for insight quality.

export const safetyCheck = agent.createEval(
  safety({
    middleware: {
      transformInput: (input: any) => ({
        request: `${input.analysis} analysis for ${input.timeframeDays} days`,
      }),
      transformOutput: (output: any) => ({
        response: output.summary ?? "",
      }),
    },
  })
);

export const concisenessCheck = agent.createEval(
  conciseness({
    middleware: {
      transformInput: (input: any) => ({
        request: `${input.analysis} analysis`,
      }),
      transformOutput: (output: any) => ({
        response: output.summary ?? "",
      }),
    },
  })
);
