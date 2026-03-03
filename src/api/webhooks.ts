/**
 * Webhook Receiver Framework — generic webhook handler route.
 *
 * Phase 5.5: Provides a configurable webhook receiver that accepts
 * incoming webhooks from external systems, verifies signatures,
 * and routes payloads to the appropriate handler or agent.
 *
 * Webhook sources are registered in the DB (webhook_sources table)
 * or configured via environment variables. Each source has:
 *   - name: Human-readable identifier (e.g., "stripe", "mpesa", "shopify")
 *   - secret: HMAC secret for signature verification
 *   - handler: Which agent or service to invoke
 *   - active: Whether the webhook is currently enabled
 *
 * Routes:
 *   POST /webhooks/:source   — Receive a webhook from an external system
 *   GET  /webhooks           — List configured webhook sources (admin)
 *
 * Usage:
 *   1. Register a webhook source via POST /admin/webhooks
 *   2. Configure the external system to POST to /api/webhooks/:source
 *   3. The framework verifies the signature, logs the event, and dispatches
 */

import { createRouter, validator } from "@agentuity/runtime";
import { errorMiddleware, NotFoundError, ValidationError } from "@lib/errors";
import { sessionMiddleware } from "@lib/auth";
import { dynamicRateLimit } from "@lib/rate-limit";
import { db, webhookSources as webhookSourcesTable, webhookEvents as webhookEventsTable } from "@db/index";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { handlePosSale } from "@services/pos-webhook";
import { normalizeProduct, normalizeOrder, normalizeCustomer } from "@services/normalizer";
import { products, orders, customers, inventory } from "@db/schema";

// ── Service Handler Registry ───────────────────────────────
// Maps handler names to service functions for non-agent webhook processing.
// Service handlers receive (payload, source, eventId) and return a result.
// If a handler name matches a registry entry, the service function is called
// directly instead of dispatching to an Agentuity agent.
type ServiceHandler = (payload: unknown, source: string, eventId: string) => Promise<unknown>;
const serviceHandlers: Record<string, ServiceHandler> = {
  pos: handlePosSale,
  sale_created: handleSaleCreated,
  product_updated: handleProductUpdated,
  inventory_adjusted: handleInventoryAdjusted,
  customer_created: handleCustomerCreated,
  customer_updated: handleCustomerUpdated,
};

// ── Types ──────────────────────────────────────────────────

export interface WebhookSource {
  name: string;
  /** HMAC secret for signature verification. Env var name or raw value. */
  secret?: string;
  /** Header name containing the HMAC signature */
  signatureHeader?: string;
  /** Hash algorithm for HMAC (sha256, sha1, etc.) */
  hashAlgorithm?: string;
  /** Agent or service to route the event to */
  handler: string;
  /** Whether to process synchronously or async */
  async?: boolean;
  /** Whether the source is active */
  active: boolean;
}

/** In-memory webhook source cache (loaded from env + DB at startup) */
const webhookSourceCache = new Map<string, WebhookSource>();
let cacheLoaded = false;

// ── Load webhook sources from env vars + DB ────────────────

function loadEnvWebhookSources() {
  // Pattern: WEBHOOK_{NAME}_SECRET, WEBHOOK_{NAME}_HANDLER
  // Example: WEBHOOK_STRIPE_SECRET=whsec_..., WEBHOOK_STRIPE_HANDLER=data-science
  const envKeys = Object.keys(process.env).filter((k) =>
    k.startsWith("WEBHOOK_") && k.endsWith("_SECRET")
  );

  for (const key of envKeys) {
    const name = key.replace("WEBHOOK_", "").replace("_SECRET", "").toLowerCase();
    const secret = process.env[key];
    const handler = process.env[`WEBHOOK_${name.toUpperCase()}_HANDLER`] ?? "data-science";
    const sigHeader = process.env[`WEBHOOK_${name.toUpperCase()}_SIG_HEADER`] ?? "x-signature";

    if (secret) {
      webhookSourceCache.set(name, {
        name,
        secret,
        signatureHeader: sigHeader,
        hashAlgorithm: "sha256",
        handler,
        async: true,
        active: true,
      });
    }
  }
}

async function loadDbWebhookSources() {
  try {
    const rows = await db
      .select()
      .from(webhookSourcesTable)
      .where(eq(webhookSourcesTable.isActive, true));

    for (const row of rows) {
      webhookSourceCache.set(row.name, {
        name: row.name,
        secret: row.secret ?? undefined,
        signatureHeader: row.signatureHeader ?? "x-signature",
        hashAlgorithm: row.hashAlgorithm ?? "sha256",
        handler: row.handler,
        async: row.isAsync,
        active: row.isActive,
      });
    }
  } catch {
    // DB may not be available yet (e.g., during build)
  }
}

async function ensureSourcesLoaded() {
  if (!cacheLoaded) {
    loadEnvWebhookSources();
    await loadDbWebhookSources();
    cacheLoaded = true;
  }
}

// Sources loaded lazily on first request (not at module init)

// ── Signature verification ─────────────────────────────────

async function verifyHmacSignature(
  payload: string,
  signature: string,
  secret: string,
  algorithm: string = "sha256"
): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: `SHA-${algorithm.replace("sha", "")}` },
      false,
      ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
    const computed = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // Constant-time comparison
    if (computed.length !== signature.length) return false;
    let mismatch = 0;
    for (let i = 0; i < computed.length; i++) {
      mismatch |= computed.charCodeAt(i) ^ signature.charCodeAt(i);
    }
    return mismatch === 0;
  } catch {
    return false;
  }
}

// ── Webhook event log (DB-backed) ──────────────────────────

interface WebhookEvent {
  id: string;
  source: string;
  receivedAt: string;
  status: "accepted" | "rejected" | "error";
  statusCode: number;
  handler: string;
  durationMs?: number;
  errorMessage?: string;
  payloadPreview?: string;
}

async function logEvent(event: WebhookEvent) {
  try {
    await db.insert(webhookEventsTable).values({
      id: event.id,
      source: event.source,
      status: event.status,
      statusCode: event.statusCode,
      handler: event.handler,
      durationMs: event.durationMs ?? null,
      errorMessage: event.errorMessage ?? null,
      payloadPreview: event.payloadPreview ?? null,
    });
  } catch {
    // Non-critical — don't fail the webhook
  }
}

// ── Generic Connector Event Handlers ───────────────────────

async function handleSaleCreated(payload: unknown, source: string, eventId: string): Promise<unknown> {
  const raw = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const normalized = normalizeOrder(raw, undefined, source);

  // Check for existing order by externalId or orderNumber
  if (normalized.externalId) {
    const existing = await db
      .select()
      .from(orders)
      .where(eq(orders.externalId, normalized.externalId))
      .limit(1);

    if (existing.length > 0) {
      await db.update(orders).set({
        totalAmount: String(normalized.totalAmount),
        paymentMethod: normalized.paymentMethod ?? existing[0].paymentMethod,
        paymentReference: normalized.paymentReference ?? existing[0].paymentReference,
        notes: normalized.notes ?? existing[0].notes,
        externalSource: normalized.externalSource ?? existing[0].externalSource,
        metadata: { ...((existing[0].metadata as Record<string, unknown>) ?? {}), ...normalized.metadata, webhookEventId: eventId },
        updatedAt: new Date(),
      }).where(eq(orders.id, existing[0].id));
      return { action: "updated", orderId: existing[0].id };
    }
  }

  // Create new order
  const [created] = await db.insert(orders).values({
    orderNumber: normalized.orderNumber ?? `WH-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    totalAmount: String(normalized.totalAmount),
    paymentMethod: normalized.paymentMethod,
    paymentReference: normalized.paymentReference,
    notes: normalized.notes,
    externalId: normalized.externalId,
    externalSource: normalized.externalSource,
    metadata: { ...normalized.metadata, webhookEventId: eventId },
  }).returning({ id: orders.id });

  return { action: "created", orderId: created.id };
}

async function handleProductUpdated(payload: unknown, source: string, eventId: string): Promise<unknown> {
  const raw = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const normalized = normalizeProduct(raw, undefined, source);

  // Check for existing product by externalId or SKU
  if (normalized.externalId) {
    const existing = await db
      .select()
      .from(products)
      .where(eq(products.externalId, normalized.externalId))
      .limit(1);

    if (existing.length > 0) {
      await db.update(products).set({
        name: normalized.name || existing[0].name,
        price: normalized.sellingPrice !== undefined ? String(normalized.sellingPrice) : existing[0].price,
        costPrice: normalized.costPrice !== undefined ? String(normalized.costPrice) : existing[0].costPrice,
        unit: normalized.unit ?? existing[0].unit,
        supplierName: normalized.supplierName ?? existing[0].supplierName,
        externalSource: normalized.externalSource ?? existing[0].externalSource,
        metadata: { ...((existing[0].metadata as Record<string, unknown>) ?? {}), ...normalized.metadata, webhookEventId: eventId },
        updatedAt: new Date(),
      }).where(eq(products.id, existing[0].id));
      return { action: "updated", productId: existing[0].id };
    }
  }

  if (normalized.sku) {
    const existing = await db
      .select()
      .from(products)
      .where(eq(products.sku, normalized.sku))
      .limit(1);

    if (existing.length > 0) {
      await db.update(products).set({
        name: normalized.name || existing[0].name,
        price: normalized.sellingPrice !== undefined ? String(normalized.sellingPrice) : existing[0].price,
        costPrice: normalized.costPrice !== undefined ? String(normalized.costPrice) : existing[0].costPrice,
        unit: normalized.unit ?? existing[0].unit,
        supplierName: normalized.supplierName ?? existing[0].supplierName,
        externalId: normalized.externalId ?? existing[0].externalId,
        externalSource: normalized.externalSource ?? existing[0].externalSource,
        metadata: { ...((existing[0].metadata as Record<string, unknown>) ?? {}), ...normalized.metadata, webhookEventId: eventId },
        updatedAt: new Date(),
      }).where(eq(products.id, existing[0].id));
      return { action: "updated", productId: existing[0].id };
    }
  }

  // Create new product
  const [created] = await db.insert(products).values({
    name: normalized.name || "Unknown Product",
    sku: normalized.sku ?? `WH-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    price: String(normalized.sellingPrice ?? "0"),
    costPrice: normalized.costPrice !== undefined ? String(normalized.costPrice) : undefined,
    unit: normalized.unit ?? "piece",
    supplierName: normalized.supplierName,
    externalId: normalized.externalId,
    externalSource: normalized.externalSource,
    metadata: { ...normalized.metadata, webhookEventId: eventId },
  }).returning({ id: products.id });

  return { action: "created", productId: created.id };
}

async function handleInventoryAdjusted(payload: unknown, source: string, eventId: string): Promise<unknown> {
  const raw = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;

  const sku = String(raw.sku ?? raw.product_code ?? "");
  const externalId = String(raw.id ?? raw.external_id ?? raw.externalId ?? "");
  const quantityChange = Number(raw.quantity ?? raw.qty ?? raw.adjustment ?? 0);

  if (!sku && !externalId) {
    return { action: "skipped", reason: "No product identifier (sku or externalId) provided" };
  }

  // Find product by externalId or SKU
  let product: { id: string; name: string } | undefined;
  if (externalId) {
    const results = await db
      .select({ id: products.id, name: products.name })
      .from(products)
      .where(eq(products.externalId, externalId))
      .limit(1);
    product = results[0];
  }
  if (!product && sku) {
    const results = await db
      .select({ id: products.id, name: products.name })
      .from(products)
      .where(eq(products.sku, sku))
      .limit(1);
    product = results[0];
  }

  if (!product) {
    return { action: "skipped", reason: `Product not found: sku=${sku}, externalId=${externalId}` };
  }

  // Find the first inventory record for this product and update quantity
  const invRecords = await db
    .select()
    .from(inventory)
    .where(eq(inventory.productId, product.id))
    .limit(1);

  if (invRecords.length > 0) {
    const newQty = invRecords[0].quantity + quantityChange;
    await db.update(inventory).set({
      quantity: newQty >= 0 ? newQty : 0,
      updatedAt: new Date(),
    }).where(eq(inventory.id, invRecords[0].id));
    return { action: "updated", productId: product.id, newQuantity: newQty >= 0 ? newQty : 0 };
  }

  return { action: "skipped", reason: "No inventory record found for product" };
}

async function handleCustomerCreated(payload: unknown, source: string, eventId: string): Promise<unknown> {
  const raw = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const normalized = normalizeCustomer(raw, undefined, source);

  // Check for existing customer by externalId or email
  if (normalized.externalId) {
    const existing = await db
      .select()
      .from(customers)
      .where(eq(customers.externalId, normalized.externalId))
      .limit(1);

    if (existing.length > 0) {
      return { action: "skipped", reason: "Customer with this externalId already exists", customerId: existing[0].id };
    }
  }

  if (normalized.email) {
    const existing = await db
      .select()
      .from(customers)
      .where(eq(customers.email, normalized.email))
      .limit(1);

    if (existing.length > 0) {
      return { action: "skipped", reason: "Customer with this email already exists", customerId: existing[0].id };
    }
  }

  // Create new customer
  const [created] = await db.insert(customers).values({
    name: normalized.name || "Unknown Customer",
    email: normalized.email,
    phone: normalized.phone,
    address: normalized.address,
    externalId: normalized.externalId,
    externalSource: normalized.externalSource,
    metadata: { ...normalized.metadata, webhookEventId: eventId },
  }).returning({ id: customers.id });

  return { action: "created", customerId: created.id };
}

async function handleCustomerUpdated(payload: unknown, source: string, eventId: string): Promise<unknown> {
  const raw = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const normalized = normalizeCustomer(raw, undefined, source);

  // Find existing customer by externalId or email
  let existing: (typeof customers.$inferSelect) | undefined;

  if (normalized.externalId) {
    const results = await db
      .select()
      .from(customers)
      .where(eq(customers.externalId, normalized.externalId))
      .limit(1);
    existing = results[0];
  }

  if (!existing && normalized.email) {
    const results = await db
      .select()
      .from(customers)
      .where(eq(customers.email, normalized.email))
      .limit(1);
    existing = results[0];
  }

  if (!existing) {
    // Create if not found (upsert behavior)
    const [created] = await db.insert(customers).values({
      name: normalized.name || "Unknown Customer",
      email: normalized.email,
      phone: normalized.phone,
      address: normalized.address,
      externalId: normalized.externalId,
      externalSource: normalized.externalSource,
      metadata: { ...normalized.metadata, webhookEventId: eventId },
    }).returning({ id: customers.id });

    return { action: "created", customerId: created.id };
  }

  // Update existing customer
  await db.update(customers).set({
    name: normalized.name || existing.name,
    phone: normalized.phone ?? existing.phone,
    address: normalized.address ?? existing.address,
    externalId: normalized.externalId ?? existing.externalId,
    externalSource: normalized.externalSource ?? existing.externalSource,
    metadata: { ...((existing.metadata as Record<string, unknown>) ?? {}), ...normalized.metadata, webhookEventId: eventId },
    updatedAt: new Date(),
  }).where(eq(customers.id, existing.id));

  return { action: "updated", customerId: existing.id };
}

// ── Router ─────────────────────────────────────────────────

const webhooks = createRouter();
webhooks.use(errorMiddleware());

/**
 * POST /webhooks/:source — Receive a webhook event.
 * No auth middleware — webhooks are authenticated via signature.
 */
webhooks.post("/webhooks/:source",
  dynamicRateLimit("rateLimitWebhook", { windowMs: 60_000, prefix: "webhook", message: "Webhook rate limit exceeded" }),
  async (c) => {
  const sourceName = c.req.param("source");
  const startTime = Date.now();
  const eventId = crypto.randomUUID();

  // Ensure sources are loaded from env + DB
  await ensureSourcesLoaded();

  // Find the webhook source config
  const source = webhookSourceCache.get(sourceName);
  if (!source || !source.active) {
    await logEvent({
      id: eventId,
      source: sourceName,
      receivedAt: new Date().toISOString(),
      status: "rejected",
      statusCode: 404,
      handler: "none",
    });
    throw new NotFoundError("Webhook source", sourceName);
  }

  // Read raw body for signature verification
  const rawBody = await c.req.text();

  // Verify signature if configured
  if (source.secret && source.signatureHeader) {
    const signature = c.req.header(source.signatureHeader) ?? "";
    // Strip common prefixes (e.g., "sha256=" from GitHub)
    const cleanSig = signature.replace(/^sha\d+=/, "");

    const resolvedSecret = process.env[source.secret] ?? source.secret;
    const valid = await verifyHmacSignature(
      rawBody,
      cleanSig,
      resolvedSecret,
      source.hashAlgorithm
    );

    if (!valid) {
      await logEvent({
        id: eventId,
        source: sourceName,
        receivedAt: new Date().toISOString(),
        status: "rejected",
        statusCode: 401,
        handler: source.handler,
      });
      return c.json({ error: "Invalid signature" }, 401);
    }
  }

  // Parse payload
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    payload = { raw: rawBody };
  }

  // Dispatch to handler — service registry first, then agent fallback
  let handlerResult: unknown = undefined;
  const handleWebhook = async () => {
    try {
      // Check service handler registry first
      const serviceHandler = serviceHandlers[source.handler];
      if (serviceHandler) {
        handlerResult = await serviceHandler(payload, sourceName, eventId);
        return;
      }

      // Fallback: dynamic agent dispatch
      const agentModule = await import(`@agent/${source.handler}`);
      const agent = agentModule.default;

      if (agent?.run) {
        await agent.run({
          message: `Webhook event from ${sourceName}`,
          sessionId: eventId,
          webhookPayload: payload,
          webhookSource: sourceName,
        });
      }
    } catch (err: any) {
      await logEvent({
        id: eventId,
        source: sourceName,
        receivedAt: new Date().toISOString(),
        status: "error",
        statusCode: 500,
        handler: source.handler,
        durationMs: Date.now() - startTime,
        errorMessage: err?.message,
      });
      // For service handlers (sync), rethrow so the caller gets the error
      if (serviceHandlers[source.handler]) throw err;
      // For agent handlers, don't throw — webhook already accepted
    }
  };

  if (source.async && !serviceHandlers[source.handler]) {
    // Process async — respond immediately (agents only, never services)
    c.waitUntil(handleWebhook);
  } else {
    await handleWebhook();
  }

  const payloadPreview = typeof payload === "string"
    ? payload.slice(0, 1024)
    : JSON.stringify(payload).slice(0, 1024);

  await logEvent({
    id: eventId,
    source: sourceName,
    receivedAt: new Date().toISOString(),
    status: "accepted",
    statusCode: 200,
    handler: source.handler,
    durationMs: Date.now() - startTime,
    payloadPreview,
  });

  return c.json({
    received: true,
    eventId,
    ...(handlerResult ? { data: handlerResult } : {}),
  });
});

/**
 * GET /webhooks — List configured webhook sources and recent events (admin).
 */
webhooks.get("/webhooks", sessionMiddleware(), async (c) => {
  await ensureSourcesLoaded();

  // Sources from cache (env + DB merged)
  const sources = Array.from(webhookSourceCache.values()).map((s) => ({
    name: s.name,
    handler: s.handler,
    active: s.active,
    hasSecret: !!s.secret,
    signatureHeader: s.signatureHeader,
  }));

  // Recent events from DB
  const recentEvents = await db
    .select()
    .from(webhookEventsTable)
    .orderBy(desc(webhookEventsTable.createdAt))
    .limit(20);

  return c.json({
    data: {
      sources,
      recentEvents,
    },
  });
});

/**
 * POST /webhooks/register — Register a new webhook source (admin).
 * Persists to DB and updates in-memory cache.
 */
export const registerSchema = z.object({
  name: z.string().min(1).max(50),
  secret: z.string().optional(),
  signatureHeader: z.string().default("x-signature"),
  hashAlgorithm: z.string().default("sha256"),
  handler: z.string().default("data-science"),
  async: z.boolean().default(true),
});

webhooks.post("/webhooks/register", sessionMiddleware(), validator({ input: registerSchema }), async (c) => {
  const body = c.req.valid("json");

  // Upsert into DB
  await db
    .insert(webhookSourcesTable)
    .values({
      name: body.name,
      secret: body.secret ?? null,
      signatureHeader: body.signatureHeader,
      hashAlgorithm: body.hashAlgorithm,
      handler: body.handler,
      isAsync: body.async,
      isActive: true,
    })
    .onConflictDoUpdate({
      target: webhookSourcesTable.name,
      set: {
        secret: body.secret ?? null,
        signatureHeader: body.signatureHeader,
        hashAlgorithm: body.hashAlgorithm,
        handler: body.handler,
        isAsync: body.async,
        isActive: true,
      },
    });

  // Update in-memory cache
  webhookSourceCache.set(body.name, {
    ...body,
    active: true,
  });

  return c.json({ data: { registered: true, name: body.name } }, 201);
});

/**
 * DELETE /webhooks/:source — Deactivate a webhook source (admin).
 * Updates DB and in-memory cache.
 */
webhooks.delete("/webhooks/:source", sessionMiddleware(), async (c) => {
  const sourceName = c.req.param("source");
  const source = webhookSourceCache.get(sourceName);
  if (!source) throw new NotFoundError("Webhook source", sourceName);

  // Deactivate in DB
  await db
    .update(webhookSourcesTable)
    .set({ isActive: false })
    .where(eq(webhookSourcesTable.name, sourceName));

  // Update in-memory cache
  source.active = false;
  return c.json({ data: { deactivated: true, name: sourceName } });
});

export default webhooks;
