/**
 * Report Generator Agent -- Barrel export
 *
 * The SDK discovers agents by scanning for index.ts files in src/agent/.
 */

export { default } from "./agent";

// Phase 7.6 — Evals (SDK discovers named exports)
export {
  reportStructureEval,
  reportCompletenessEval,
  factualConsistencyEval,
} from "./eval";
