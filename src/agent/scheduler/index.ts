/**
 * Scheduler Agent -- Barrel export
 *
 * The SDK discovers agents by scanning for index.ts files in src/agent/.
 */

export { default } from "./agent";

// Phase 5.6 — Evals (SDK discovers named exports)
export { scheduleExecutionEval, taskDispatchEval } from "./eval";
