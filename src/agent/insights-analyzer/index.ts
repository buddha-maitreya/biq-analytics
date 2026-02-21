/**
 * Insights Analyzer Agent -- Barrel export
 *
 * The SDK discovers agents by scanning for index.ts files in src/agent/.
 */

export { default } from "./agent";

// Phase 7.6 — Evals (SDK discovers named exports)
export {
  insightCompletenessEval,
  confidenceCalibrationEval,
  severityDistributionEval,
} from "./eval";

// Phase 7.7 — Preset evals from @agentuity/evals
export { safetyCheck, concisenessCheck } from "./eval";

// Phase 7 — Workbench test prompts
export const welcome = () => ({
  welcome: "Welcome to the **Insights Analyzer** (The Analyst).\nI perform statistical analysis on your business data using sandboxed code execution.",
  prompts: [
    {
      data: JSON.stringify({
        analysis: "sales-trends",
        timeframeDays: 30,
        limit: 10,
      }),
      contentType: "application/json",
    },
    {
      data: JSON.stringify({
        analysis: "anomaly-detection",
        timeframeDays: 7,
        limit: 5,
      }),
      contentType: "application/json",
    },
  ],
});
