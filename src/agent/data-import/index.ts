/**
 * Data Import Agent -- Barrel export
 *
 * The SDK discovers agents by scanning for index.ts files in src/agent/.
 * The actual agent implementation lives in agent.ts (with setup/shutdown
 * lifecycle, KV state tracking, queue publishing, durable audit streams,
 * and agent-level event listeners).
 */

export { default } from "./agent";

// Phase 7.6 -- Evals (SDK discovers named exports)
export {
  importOutputStructureEval,
  importErrorHandlingEval,
} from "./eval";

// Phase 7 — Workbench test prompts
export const welcome = () => ({
  welcome: "Welcome to the **Data Import Agent**.\nI handle bulk data imports from APIs, files, and webhooks for products, customers, inventory, and orders.",
  prompts: [
    {
      data: JSON.stringify({
        importType: "products",
        source: { type: "file", filePath: "imports/products.csv", method: "GET" },
        dryRun: true,
        batchSize: 50,
        mode: "upsert",
      }),
      contentType: "application/json",
    },
  ],
});

