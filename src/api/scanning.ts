/**
 * Document Scanning Routes — OCR & Barcode Processing
 *
 * Endpoints for image-based document processing:
 *   POST /api/scan/barcode    — Scan barcode/QR code from image
 *   POST /api/scan/stock      — OCR stock sheet for bulk inventory import
 *   POST /api/scan/invoice    — OCR invoice for supplier data extraction
 */

import { createRouter } from "@agentuity/runtime";
import { errorMiddleware } from "@lib/errors";
import { authMiddleware } from "@services/auth";
import scanner from "@agent/document-scanner";

const router = createRouter();
router.use(errorMiddleware());
router.use(authMiddleware());

// ── Barcode/QR scanning ─────────────────────────────────────

router.post("/scan/barcode", async (c) => {
  const body = await c.req.json();
  const { imageData, imageUrl, context } = body;

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

router.post("/scan/stock", async (c) => {
  const body = await c.req.json();
  const { imageData, imageUrl, context } = body;

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

router.post("/scan/invoice", async (c) => {
  const body = await c.req.json();
  const { imageData, imageUrl, context } = body;

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
