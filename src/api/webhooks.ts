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
import { authMiddleware } from "@services/auth";
import { db, webhookSources as webhookSourcesTable, webhookEvents as webhookEventsTable } from "@db/index";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";

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

// ── Router ─────────────────────────────────────────────────

const webhooks = createRouter();
webhooks.use(errorMiddleware());

/**
 * POST /webhooks/:source — Receive a webhook event.
 * No auth middleware — webhooks are authenticated via signature.
 */
webhooks.post("/webhooks/:source", async (c) => {
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

  // Dispatch to handler
  const handleWebhook = async () => {
    try {
      // Dynamic agent dispatch — resolve the handler agent
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
      // Don't throw — webhook already accepted
    }
  };

  if (source.async) {
    // Process async — respond immediately
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

  return c.json({ received: true, eventId });
});

/**
 * GET /webhooks — List configured webhook sources and recent events (admin).
 */
webhooks.get("/webhooks", authMiddleware(), async (c) => {
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
const registerSchema = z.object({
  name: z.string().min(1).max(50),
  secret: z.string().optional(),
  signatureHeader: z.string().default("x-signature"),
  hashAlgorithm: z.string().default("sha256"),
  handler: z.string().default("data-science"),
  async: z.boolean().default(true),
});

webhooks.post("/webhooks/register", authMiddleware(), validator({ input: registerSchema }), async (c) => {
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
webhooks.delete("/webhooks/:source", authMiddleware(), async (c) => {
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
