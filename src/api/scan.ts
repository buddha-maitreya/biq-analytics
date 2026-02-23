/**
 * Scan API Routes — Unified barcode scan pipeline
 *
 * Endpoints:
 *   POST /api/scan              — Process a single barcode scan
 *   POST /api/scan/batch        — Process multiple scans (offline sync)
 *   GET  /api/scan/lookup/:code — Look up product by barcode
 *   GET  /api/scan/history      — Scan event history
 *   GET  /api/scan/events       — SSE stream for real-time stock updates
 *
 * All endpoints require authentication via sessionMiddleware.
 * The scan pipeline is device-agnostic: USB scanners, phone cameras,
 * warehouse handhelds, and API integrations all use POST /api/scan.
 */

import { createRouter, validator, sse } from "@agentuity/runtime";
import type { SSEStream } from "@agentuity/runtime";
import { s } from "@agentuity/schema";
import { errorMiddleware } from "@lib/errors";
import { sessionMiddleware, getAppUser, requirePermission } from "@lib/auth";
import { dynamicRateLimit } from "@lib/rate-limit";
import {
  processScan,
  processBatchScan,
  lookupBarcode,
  getScanHistory,
  scanRequestSchema,
  type ScanResult,
} from "@services/scan";

// ── SSE Stock Update Bus ─────────────────────────────────────
// All connected scanner clients receive real-time stock change
// events after any scan is processed. This uses the same
// SSEStream pattern as the chat module.

const scanStreams = new Set<SSEStream>();

function broadcastStockUpdate(data: {
  productId: string;
  productName: string;
  barcode: string;
  warehouseId: string;
  warehouseName: string;
  previousStock: number;
  newStock: number;
  scanType: string;
  userId: string;
}) {
  const payload = JSON.stringify({
    type: "stock_update",
    properties: data,
  });

  for (const stream of scanStreams) {
    stream.writeSSE({ data: payload }).catch(() => {
      scanStreams.delete(stream);
    });
  }
}

const router = createRouter();
router.use(errorMiddleware());
router.use(sessionMiddleware());

// ── POST /api/scan — Single barcode scan ────────────────────
// Accepts a barcode string from any input device and processes it
// through the full pipeline: log → lookup → transaction → stock update.

export const scanBodySchema = s.object({
  barcode: s.string(),
  warehouseId: s.string(),
  deviceType: s.optional(s.string()),
  quantity: s.optional(s.number()),
  scanType: s.optional(s.string()),
  notes: s.optional(s.string()),
  idempotencyKey: s.optional(s.string()),
});

router.post("/scan",
  dynamicRateLimit("rateLimitScan", {
    windowMs: 60_000,
    prefix: "scan-barcode",
    message: "Scanning rate limit reached. Please wait a moment.",
  }),
  validator({ input: scanBodySchema }),
  async (c) => {
    const user = getAppUser(c);
    if (!user) {
      return c.json({ error: "Authentication required", code: "UNAUTHORIZED" }, 401);
    }

    const body = c.req.valid("json");
    const result = await processScan(body as any, user.id);
    const status = result.success ? 200 : 422;

    // Broadcast stock update to all connected SSE clients
    // Duplicates already have success=false (ScanError), so no extra check needed
    if (result.success && "product" in result && result.product) {
      const scanResult = result as ScanResult;
      broadcastStockUpdate({
        productId: scanResult.product!.id,
        productName: scanResult.product!.name,
        barcode: scanResult.product!.barcode ?? "",
        warehouseId: body.warehouseId as string,
        warehouseName: "", // Resolved client-side from warehouse list
        previousStock: scanResult.previousStock ?? 0,
        newStock: scanResult.newStock ?? 0,
        scanType: (body.scanType as string) ?? "scan_add",
        userId: user.id,
      });
    }

    return c.json({ data: result }, status);
  }
);

// ── POST /api/scan/batch — Offline sync batch ───────────────
// Accepts an array of scans (queued offline) and processes them
// sequentially. Each scan is independent — one failure doesn't
// affect others. Every scan should include an idempotencyKey.

export const batchBodySchema = s.object({
  scans: s.array(s.object({
    barcode: s.string(),
    warehouseId: s.string(),
    deviceType: s.optional(s.string()),
    quantity: s.optional(s.number()),
    scanType: s.optional(s.string()),
    notes: s.optional(s.string()),
    idempotencyKey: s.optional(s.string()),
  })),
});

router.post("/scan/batch",
  dynamicRateLimit("rateLimitScan", {
    windowMs: 60_000,
    prefix: "scan-batch",
    message: "Batch scan rate limit reached. Please wait.",
  }),
  validator({ input: batchBodySchema }),
  async (c) => {
    const user = getAppUser(c);
    if (!user) {
      return c.json({ error: "Authentication required", code: "UNAUTHORIZED" }, 401);
    }

    const body = c.req.valid("json");
    const result = await processBatchScan({
      scans: body.scans as any[],
      userId: user.id,
    });

    return c.json({ data: result });
  }
);

// ── GET /api/scan/lookup/:code — Barcode product lookup ─────
// Instant product identification by barcode. Returns product
// details + stock levels across all warehouses. Used by POS
// input fields, scanner preview screens, and mobile apps.

router.get("/scan/lookup/:code", async (c) => {
  const barcode = c.req.param("code");
  if (!barcode) {
    return c.json({ error: "Barcode parameter required" }, 400);
  }

  const result = await lookupBarcode(decodeURIComponent(barcode));
  const status = result.found ? 200 : 404;
  return c.json({ data: result }, status);
});

// ── GET /api/scan/history — Scan event log ──────────────────
// Filterable scan history for audit trails and debugging.
// Query params: warehouseId, userId, status, barcode, limit, offset

router.get("/scan/history",
  requirePermission("inventory"),
  async (c) => {
    const { warehouseId, userId, status, barcode, limit, offset } = c.req.query();

    const result = await getScanHistory({
      warehouseId: warehouseId || undefined,
      userId: userId || undefined,
      status: status || undefined,
      barcode: barcode || undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });

    return c.json({ data: result });
  }
);

// ── GET /api/scan/events — SSE stock update stream ──────────
// Real-time stock change notifications. Scanner clients connect
// to this stream and receive events whenever any scan is processed.
// Uses the SDK's sse() middleware — same pattern as chat.ts.

router.get("/scan/events", sse(async (c, stream) => {
  // Register this client's stream
  scanStreams.add(stream);

  // Send connected confirmation
  await stream.writeSSE({
    data: JSON.stringify({ type: "connected", properties: { ts: Date.now() } }),
  });

  // Keepalive ping every 20s
  const pingInterval = setInterval(() => {
    stream.writeSSE({
      data: JSON.stringify({ type: "ping", properties: { ts: Date.now() } }),
    }).catch(() => {
      clearInterval(pingInterval);
      scanStreams.delete(stream);
    });
  }, 20_000);

  // Keep the handler alive until the client disconnects.
  await new Promise<void>((resolve) => {
    stream.onAbort(() => {
      clearInterval(pingInterval);
      scanStreams.delete(stream);
      resolve();
    });
  });
}));

export default router;
