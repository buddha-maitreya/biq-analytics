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
