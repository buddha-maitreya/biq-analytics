/**
 * POS Integration Routes — webhook endpoints for external POS systems.
 *
 * Routes:
 *   POST /pos/ingest/:vendor         — Receive a single sale event
 *   POST /pos/ingest/:vendor/batch   — Batch sync (offline reconnect)
 *   POST /pos/return/:vendor         — Return/refund event
 *   GET  /pos/stock                  — Query current stock levels (POS catalog sync)
 *   GET  /pos/catalog                — Full product catalog
 *   POST /pos/catalog/push           — Push catalog updates to POS vendors
 *   GET  /pos/connections            — List configured POS vendor connections (admin)
 *   POST /pos/connections            — Add a new POS vendor connection (admin)
 *   PUT  /pos/connections/:id        — Update a POS vendor connection (admin)
 *   DELETE /pos/connections/:id      — Delete a POS vendor connection (admin)
 *   GET  /pos/transactions           — List POS transactions (admin)
 *
 * Authentication:
 *   - Ingest/return/stock/catalog routes: vendor-level auth via pos_vendor_configs
 *     (HMAC signature, bearer token, basic auth, or none)
 *   - Admin routes (connections, transactions): session-based auth (admin/super_admin)
 */

import { createRouter } from "@agentuity/runtime";
import { errorMiddleware, ValidationError, NotFoundError } from "@lib/errors";
import { sessionMiddleware } from "@lib/auth";
import { dynamicRateLimit } from "@lib/rate-limit";
import { db, posTransactions, posVendorConfigs } from "@db/index";
import { eq, desc, and, gte, lte, sql } from "drizzle-orm";
import { createHmac } from "crypto";
import { ingestPosEvent, ingestPosBatch, getVendorConfig } from "@services/pos-ingestion";
import { processReturn } from "@services/pos-returns";
import { queryStock, getCatalog, pushCatalog } from "@services/pos-stock";
import { getAdapter } from "@services/pos-adapters";

const router = createRouter();
router.use(errorMiddleware());

// ── Vendor Auth Middleware ───────────────────────────────────

/**
 * Authenticate incoming POS webhook requests against vendor config.
 * Supports HMAC, bearer, basic, and no-auth modes.
 */
async function verifyVendorAuth(
  vendor: string,
  request: Request,
  rawBody: string,
): Promise<boolean> {
  const config = await getVendorConfig(vendor);
  if (!config) return true; // No config = open (vendor not configured yet)
  if (config.authType === "none") return true;

  const secret = config.authSecret;
  if (!secret) return true; // No secret configured

  switch (config.authType) {
    case "hmac": {
      const sigHeader = config.signatureHeader ?? "x-signature";
      const signature = request.headers.get(sigHeader);
      if (!signature) return false;

      // Delegate to adapter-level verification when available (e.g. Paystack uses SHA-512)
      const adapter = getAdapter(vendor);
      if (adapter.verifySignature) {
        return adapter.verifySignature(rawBody, signature, secret);
      }

      // Default: HMAC SHA-256 verification
      const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
      const clean = signature.replace(/^sha256=/, "");
      // Constant-time comparison
      if (expected.length !== clean.length) return false;
      let mismatch = 0;
      for (let i = 0; i < expected.length; i++) {
        mismatch |= expected.charCodeAt(i) ^ clean.charCodeAt(i);
      }
      return mismatch === 0;
    }
    case "bearer": {
      const authHeader = request.headers.get("authorization");
      return authHeader === `Bearer ${secret}`;
    }
    case "basic": {
      const authHeader = request.headers.get("authorization");
      if (!authHeader?.startsWith("Basic ")) return false;
      const decoded = atob(authHeader.slice(6));
      // Secret format: "username:password"
      return decoded === secret;
    }
    default:
      return true;
  }
}

// ════════════════════════════════════════════════════════════
// POS Webhook Endpoints (external — vendor auth)
// ════════════════════════════════════════════════════════════

/**
 * POST /pos/ingest/:vendor — Receive a single POS sale event.
 */
router.post("/pos/ingest/:vendor", dynamicRateLimit("rateLimitWebhook", { windowMs: 60_000, prefix: "pos-ingest", message: "POS ingestion rate limit exceeded" }), async (c) => {
  const vendor = c.req.param("vendor");
  const rawBody = await c.req.text();

  // Vendor auth
  const authenticated = await verifyVendorAuth(vendor, c.req.raw, rawBody);
  if (!authenticated) {
    return c.json({ error: "Unauthorized — invalid signature or credentials" }, 401);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return c.json({ error: "Invalid JSON payload" }, 400);
  }

  const result = await ingestPosEvent(payload, vendor);
  const statusCode = result.status === "processed" ? 200
    : result.status === "duplicate" ? 200
    : 422;

  return c.json({ data: result }, statusCode);
});

/**
 * POST /pos/ingest/:vendor/batch — Batch sync (offline reconnect).
 */
router.post("/pos/ingest/:vendor/batch", dynamicRateLimit("rateLimitWebhook", { windowMs: 60_000, prefix: "pos-batch", message: "POS batch rate limit exceeded" }), async (c) => {
  const vendor = c.req.param("vendor");
  const rawBody = await c.req.text();

  const authenticated = await verifyVendorAuth(vendor, c.req.raw, rawBody);
  if (!authenticated) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  let body: { events?: unknown[] };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return c.json({ error: "Invalid JSON payload" }, 400);
  }

  if (!Array.isArray(body.events)) {
    return c.json({ error: "Missing 'events' array in request body" }, 400);
  }

  const result = await ingestPosBatch(body.events, vendor);
  return c.json({ data: result });
});

/**
 * POST /pos/return/:vendor — Process a POS return/refund.
 */
router.post("/pos/return/:vendor", dynamicRateLimit("rateLimitWebhook", { windowMs: 60_000, prefix: "pos-return", message: "POS return rate limit exceeded" }), async (c) => {
  const vendor = c.req.param("vendor");
  const rawBody = await c.req.text();

  const authenticated = await verifyVendorAuth(vendor, c.req.raw, rawBody);
  if (!authenticated) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return c.json({ error: "Invalid JSON payload" }, 400);
  }

  const originalTxId = payload.originalTransactionId as string | undefined;
  const result = await processReturn(payload, vendor, originalTxId);
  const statusCode = result.status === "processed" ? 200 : 422;

  return c.json({ data: result }, statusCode);
});

/**
 * GET /pos/stock — Query current stock levels.
 * Used by external POS systems for catalog sync.
 */
router.get("/pos/stock", dynamicRateLimit("rateLimitWebhook", { windowMs: 60_000, prefix: "pos-stock", message: "Stock query rate limit exceeded" }), async (c) => {
  const sku = c.req.query("sku");
  const barcode = c.req.query("barcode");
  const warehouse = c.req.query("warehouse");

  const levels = await queryStock({
    sku: sku || undefined,
    barcode: barcode || undefined,
    warehouseCode: warehouse || undefined,
  });

  return c.json({ data: levels });
});

/**
 * GET /pos/catalog — Full product catalog for POS sync.
 */
router.get("/pos/catalog", dynamicRateLimit("rateLimitWebhook", { windowMs: 60_000, prefix: "pos-catalog", message: "Catalog query rate limit exceeded" }), async (c) => {
  const catalog = await getCatalog();
  return c.json({ data: catalog, total: catalog.length });
});

/**
 * POST /pos/catalog/push — Push catalog updates to all active POS vendors.
 * Requires admin auth.
 */
router.post("/pos/catalog/push", sessionMiddleware(), async (c) => {
  const results = await pushCatalog();
  return c.json({ data: results });
});

// ════════════════════════════════════════════════════════════
// POS Admin Endpoints (session auth — admin-only)
// ════════════════════════════════════════════════════════════

/**
 * GET /pos/connections — List all POS vendor connections.
 */
router.get("/pos/connections", sessionMiddleware(), async (c) => {
  const connections = await db
    .select()
    .from(posVendorConfigs)
    .orderBy(desc(posVendorConfigs.createdAt));

  return c.json({ data: connections });
});

/**
 * POST /pos/connections — Add a new POS vendor connection.
 */
router.post("/pos/connections", sessionMiddleware(), async (c) => {
  const body = await c.req.json();

  if (!body.vendor || !body.displayName) {
    throw new ValidationError("vendor and displayName are required");
  }

  const [connection] = await db
    .insert(posVendorConfigs)
    .values({
      vendor: body.vendor,
      displayName: body.displayName,
      isActive: body.isActive ?? true,
      authType: body.authType ?? "none",
      authSecret: body.authSecret ?? null,
      signatureHeader: body.signatureHeader ?? null,
      fieldMapping: body.fieldMapping ?? null,
      webhookUrl: body.webhookUrl ?? null,
      defaultWarehouseId: body.defaultWarehouseId ?? null,
      settings: body.settings ?? null,
      metadata: body.metadata ?? null,
    })
    .returning();

  return c.json({ data: connection }, 201);
});

/**
 * PUT /pos/connections/:id — Update a POS vendor connection.
 */
router.put("/pos/connections/:id", sessionMiddleware(), async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();

  const existing = await db.query.posVendorConfigs.findFirst({
    where: eq(posVendorConfigs.id, id),
  });

  if (!existing) throw new NotFoundError("POS Connection", id);

  const [updated] = await db
    .update(posVendorConfigs)
    .set({
      vendor: body.vendor ?? existing.vendor,
      displayName: body.displayName ?? existing.displayName,
      isActive: body.isActive ?? existing.isActive,
      authType: body.authType ?? existing.authType,
      authSecret: body.authSecret !== undefined ? body.authSecret : existing.authSecret,
      signatureHeader: body.signatureHeader !== undefined ? body.signatureHeader : existing.signatureHeader,
      fieldMapping: body.fieldMapping !== undefined ? body.fieldMapping : existing.fieldMapping,
      webhookUrl: body.webhookUrl !== undefined ? body.webhookUrl : existing.webhookUrl,
      defaultWarehouseId: body.defaultWarehouseId !== undefined ? body.defaultWarehouseId : existing.defaultWarehouseId,
      settings: body.settings !== undefined ? body.settings : existing.settings,
      metadata: body.metadata !== undefined ? body.metadata : existing.metadata,
    })
    .where(eq(posVendorConfigs.id, id))
    .returning();

  return c.json({ data: updated });
});

/**
 * DELETE /pos/connections/:id — Delete a POS vendor connection.
 */
router.delete("/pos/connections/:id", sessionMiddleware(), async (c) => {
  const id = c.req.param("id");

  const existing = await db.query.posVendorConfigs.findFirst({
    where: eq(posVendorConfigs.id, id),
  });

  if (!existing) throw new NotFoundError("POS Connection", id);

  await db.delete(posVendorConfigs).where(eq(posVendorConfigs.id, id));
  return c.json({ deleted: true });
});

/**
 * GET /pos/transactions — List POS transactions with filtering.
 */
router.get("/pos/transactions", sessionMiddleware(), async (c) => {
  const vendor = c.req.query("vendor");
  const status = c.req.query("status");
  const startDate = c.req.query("startDate");
  const endDate = c.req.query("endDate");
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  const page = Math.max(Number(c.req.query("page") ?? 1), 1);
  const skip = (page - 1) * limit;

  const conditions = [];
  if (vendor) conditions.push(eq(posTransactions.posVendor, vendor));
  if (status) conditions.push(eq(posTransactions.status, status));
  if (startDate) conditions.push(gte(posTransactions.createdAt, new Date(startDate)));
  if (endDate) conditions.push(lte(posTransactions.createdAt, new Date(endDate)));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [transactions, [{ count }]] = await Promise.all([
    db
      .select()
      .from(posTransactions)
      .where(whereClause)
      .orderBy(desc(posTransactions.createdAt))
      .limit(limit)
      .offset(skip),
    db
      .select({ count: sql<number>`count(*)` })
      .from(posTransactions)
      .where(whereClause),
  ]);

  return c.json({
    data: transactions,
    pagination: {
      page,
      limit,
      total: Number(count),
      totalPages: Math.ceil(Number(count) / limit),
    },
  });
});

/**
 * GET /pos/transactions/:id — Get a single POS transaction with details.
 */
router.get("/pos/transactions/:id", sessionMiddleware(), async (c) => {
  const id = c.req.param("id");
  const tx = await db.query.posTransactions.findFirst({
    where: eq(posTransactions.id, id),
    with: {
      order: true,
      warehouse: true,
      vendorConfig: true,
    },
  });

  if (!tx) throw new NotFoundError("POS Transaction", id);
  return c.json({ data: tx });
});

/**
 * GET /pos/stats — POS integration dashboard stats.
 */
router.get("/pos/stats", sessionMiddleware(), async (c) => {
  const [
    [{ totalTransactions }],
    [{ processedCount }],
    [{ failedCount }],
    [{ duplicateCount }],
    vendors,
  ] = await Promise.all([
    db.select({ totalTransactions: sql<number>`count(*)` }).from(posTransactions),
    db.select({ processedCount: sql<number>`count(*)` }).from(posTransactions).where(eq(posTransactions.status, "processed")),
    db.select({ failedCount: sql<number>`count(*)` }).from(posTransactions).where(eq(posTransactions.status, "failed")),
    db.select({ duplicateCount: sql<number>`count(*)` }).from(posTransactions).where(eq(posTransactions.status, "duplicate")),
    db.select().from(posVendorConfigs).orderBy(desc(posVendorConfigs.createdAt)),
  ]);

  return c.json({
    data: {
      totalTransactions: Number(totalTransactions),
      processed: Number(processedCount),
      failed: Number(failedCount),
      duplicates: Number(duplicateCount),
      activeVendors: vendors.filter((v) => v.isActive).length,
      totalVendors: vendors.length,
      vendors: vendors.map((v) => ({
        id: v.id,
        vendor: v.vendor,
        displayName: v.displayName,
        isActive: v.isActive,
        lastSyncAt: v.lastSyncAt,
        errorCount: v.errorCount,
        totalTransactions: v.totalTransactions,
      })),
    },
  });
});

export default router;
