/**
 * Data Science Agent -- Barrel export
 *
 * Re-exports the agent default.
 * The SDK discovers agents by scanning for index.ts files in src/agent/.
 *
 * NOTE: getConversationContext and maybeCompressSummary have been moved
 * to src/services/chat.ts (they are DB service concerns, not agent logic).
 *
 * Phase 1.7: streamChat has been moved to src/api/chat.ts (route-level).
 * The Agentuity SDK agents are strictly request/response — streaming is
 * a route concern, not an agent concern. The route now has direct access
 * to c.var context (logger, tracer, kv, sandbox) instead of duplicating
 * config loading.
 */

export { default } from "./agent";

// Phase 7.6 — Evals (SDK discovers named exports)
export { responseQualityEval, toolUsageEval, groundednessEval, hallucinationDetectionEval } from "./eval";

// Phase 7.7 — Preset evals from @agentuity/evals
export { safetyCheck, piiCheck, politenessCheck } from "./eval";

// Phase 7 — Workbench test prompts
export const welcome = () => ({
  welcome: "Welcome to the **Data Science Assistant** (The Brain).\nI can analyze your business data, run statistical computations, generate reports, and answer questions about your inventory, sales, and customers.",
  prompts: [
    {
      data: JSON.stringify({
        message: "What were my top 5 selling products last month?",
        sessionId: "test-session-001",
      }),
      contentType: "application/json",
    },
    {
      data: JSON.stringify({
        message: "Show me a sales trend analysis for the last 30 days",
        sessionId: "test-session-002",
      }),
      contentType: "application/json",
    },
    {
      data: JSON.stringify({
        message: "Which products need to be restocked?",
        sessionId: "test-session-003",
      }),
      contentType: "application/json",
    },
  ],
});
