/**
 * Document Scanning Routes — OCR & Barcode Processing
 *
 * Endpoints for image-based document processing:
 *   POST /api/scan/barcode    — Scan barcode/QR code from image
 *   POST /api/scan/stock      — OCR stock sheet for bulk inventory import
 *   POST /api/scan/invoice    — OCR invoice for supplier data extraction
 */

import { createRouter, validator } from "@agentuity/runtime";
import { s } from "@agentuity/schema";
import { errorMiddleware } from "@lib/errors";
import { sessionMiddleware } from "@lib/auth";
import { dynamicRateLimit } from "@lib/rate-limit";
import scanner from "@agent/document-scanner";

// ── Request schema for all scan endpoints ───────────────────
const scanBodySchema = s.object({
  /** Base64-encoded image data (JPEG, PNG, or WebP) */
  imageData: s.optional(s.string()),
  /** URL to the image/document (alternative to imageData) */
  imageUrl: s.optional(s.string()),
  /** Optional context for improved recognition */
  context: s.optional(s.string()),
});

const router = createRouter();
router.use(errorMiddleware());
router.use(sessionMiddleware());

// ── Barcode/QR scanning ─────────────────────────────────────

router.post("/scan/barcode",
  dynamicRateLimit("rateLimitScan", { windowMs: 60_000, prefix: "scan", message: "Scanning rate limit reached. Please wait." }),
  validator({ input: scanBodySchema }),
  async (c) => {
  const { imageData, imageUrl, context } = c.req.valid("json");

  if (!imageData && !imageUrl) {
    return c.json({ error: "Provide imageData (base64) or imageUrl" }, 400);
  }

  const result = await scanner.run({
    mode: "barcode",
    imageData,
    imageUrl,
    context,
  });

  return c.json(result);
});

// ── Stock sheet OCR ─────────────────────────────────────────

router.post("/scan/stock",
  dynamicRateLimit("rateLimitScan", { windowMs: 60_000, prefix: "scan", message: "Scanning rate limit reached. Please wait." }),
  validator({ input: scanBodySchema }),
  async (c) => {
  const { imageData, imageUrl, context } = c.req.valid("json");

  if (!imageData && !imageUrl) {
    return c.json({ error: "Provide imageData (base64) or imageUrl" }, 400);
  }

  const result = await scanner.run({
    mode: "stock-sheet",
    imageData,
    imageUrl,
    context,
  });

  return c.json(result);
});

// ── Invoice OCR ─────────────────────────────────────────────

router.post("/scan/invoice",
  dynamicRateLimit("rateLimitScan", { windowMs: 60_000, prefix: "scan", message: "Scanning rate limit reached. Please wait." }),
  validator({ input: scanBodySchema }),
  async (c) => {
  const { imageData, imageUrl, context } = c.req.valid("json");

  if (!imageData && !imageUrl) {
    return c.json({ error: "Provide imageData (base64) or imageUrl" }, 400);
  }

  const result = await scanner.run({
    mode: "invoice",
    imageData,
    imageUrl,
    context,
  });

  return c.json(result);
});

export default router;
