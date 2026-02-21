/**
 * Document Scanner Agent -- Barrel export
 *
 * The SDK discovers agents by scanning for index.ts files in src/agent/.
 */

export { default } from "./agent";

// Phase 7.6 — Evals
export { extractionAccuracyEval, inputValidationEval } from "./eval";

// Phase 7 — Workbench test prompts
export const welcome = () => ({
  welcome: "Welcome to the **Document Scanner** (The Scanner).\nI process images for barcode scanning, stock sheet OCR, and invoice extraction.",
  prompts: [
    {
      data: JSON.stringify({
        mode: "barcode",
        imageUrl: "https://example.com/barcode-sample.jpg",
      }),
      contentType: "application/json",
    },
    {
      data: JSON.stringify({
        mode: "invoice",
        imageUrl: "https://example.com/invoice-sample.jpg",
      }),
      contentType: "application/json",
    },
  ],
});
