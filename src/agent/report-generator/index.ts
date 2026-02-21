/**
 * Report Generator Agent -- Barrel export
 *
 * The SDK discovers agents by scanning for index.ts files in src/agent/.
 * The actual agent implementation lives in agent.ts (with setup/shutdown
 * lifecycle, shared DB_SCHEMA, SQL safety, KV caching, PII masking,
 * tracing, token tracking, output validation, and event listeners).
 */

export { default } from "./agent";

// Phase 7.6 -- Evals (SDK discovers named exports)
export {
  reportStructureEval,
  reportCompletenessEval,
  factualConsistencyEval,
} from "./eval";

// Phase 7.7 — Preset evals from @agentuity/evals
export { concisenessCheck, formatCheck } from "./eval";

// Phase 7 — Workbench test prompts
export const welcome = () => ({
  welcome: "Welcome to the **Report Generator** (The Writer).\nI create professional narrative reports from your business data.",
  prompts: [
    {
      data: JSON.stringify({
        reportType: "sales-summary",
        format: "markdown",
      }),
      contentType: "application/json",
    },
    {
      data: JSON.stringify({
        reportType: "inventory-health",
        format: "markdown",
      }),
      contentType: "application/json",
    },
  ],
});
