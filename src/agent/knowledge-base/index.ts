/**
 * Knowledge Base Agent -- Barrel export
 *
 * The SDK discovers agents by scanning for index.ts files in src/agent/.
 * The actual agent implementation lives in agent.ts (with setup/shutdown
 * lifecycle, auto-chunking, KV document index, metadata filters, PII masking,
 * tracing, token tracking, output validation, and event listeners).
 */

export { default } from "./agent";

// Phase 7.6 -- Evals (SDK discovers named exports)
export {
  answerGroundednessEval,
  retrievalRelevanceEval,
  ingestSuccessEval,
} from "./eval";

// Phase 7.7 — Preset evals from @agentuity/evals
export { safetyCheck, piiCheck, completenessCheck } from "./eval";

// Phase 7 — Workbench test prompts
export const welcome = () => ({
  welcome: "Welcome to the **Knowledge Base** (The Librarian).\nI handle document storage, retrieval, and question-answering via vector search.",
  prompts: [
    {
      data: JSON.stringify({
        action: "query",
        question: "What is the company return policy?",
      }),
      contentType: "application/json",
    },
    {
      data: JSON.stringify({
        action: "list",
      }),
      contentType: "application/json",
    },
  ],
});
