/**
 * Data Import Agent -- "The Importer"
 *
 * Handles scheduled data imports from external APIs,
 * file uploads, and webhook-triggered imports. Works with the
 * Scheduler Agent for periodic sync and the Webhook Receiver
 * for event-driven imports.
 *
 * Supported import sources (extensible via config):
 *   - REST API endpoints (configurable URL, headers, auth)
 *   - CSV/JSON file uploads (via object storage)
 *   - Webhook payloads (forwarded from webhook receiver)
 *
 * Import types:
 *   - products: Create/update products from external catalog
 *   - customers: Sync customer records from CRM
 *   - inventory: Update stock levels from warehouse system
 *   - orders: Import orders from e-commerce platform
 *
 * The agent uses KV storage for import state tracking (last sync
 * timestamp, cursor/offset for pagination, error counts).
 */

import { createAgent } from "@agentuity/runtime";
import { s } from "@agentuity/schema";
import { db } from "@db/index";
import { products, customers } from "@db/schema";
import { eq } from "drizzle-orm";
import { getAgentConfigWithDefaults } from "@services/agent-configs";

// ── Schemas ────────────────────────────────────────────────

const importSourceSchema = s.object({
  /** Source type: api, file, webhook */
  type: s.enum(["api", "file", "webhook"]),
  /** URL for API sources */
  url: s.optional(s.string()),
  /** HTTP headers for API auth */
  headers: s.optional(s.record(s.string(), s.string())),
  /** HTTP method */
  method: s.enum(["GET", "POST"]).describe("HTTP method (default: GET)"),
  /** JSON path to extract records from API response */
  dataPath: s.optional(s.string()),
  /** File path in object storage for file sources */
  filePath: s.optional(s.string()),
  /** Raw payload for webhook sources */
  payload: s.optional(s.unknown()),
});

export const inputSchema = s.object({
  /** What to import: products, customers, inventory, orders */
  importType: s.enum(["products", "customers", "inventory", "orders"]),
  /** Data source configuration */
  source: importSourceSchema,
  /** Whether to do a dry run (validate without writing) */
  dryRun: s.boolean().describe("Dry run mode (default: false)"),
  /** Maximum records to import per batch */
  batchSize: s.number().describe("Max records per batch (1-1000, default: 100)"),
  /** Import mode: create-only, update-only, or upsert */
  mode: s.enum(["create", "update", "upsert"]).describe("Import mode (default: upsert)"),
});

export const outputSchema = s.object({
  success: s.boolean(),
  importType: s.string(),
  recordsProcessed: s.number(),
  recordsCreated: s.number(),
  recordsUpdated: s.number(),
  recordsSkipped: s.number(),
  errors: s.array(s.object({
    row: s.number(),
    field: s.optional(s.string()),
    message: s.string(),
  })),
  durationMs: s.number(),
  dryRun: s.boolean(),
});

// ── Config ─────────────────────────────────────────────────

interface DataImportConfig {
  maxBatchSize: number;
  defaultTimeout: number;
}

// ── Agent ──────────────────────────────────────────────────

const agent = createAgent("data-import", {
  description:
    "Scheduled data import agent -- syncs products, customers, inventory, and orders from external systems via API, file upload, or webhook payload.",

  schema: { input: inputSchema, output: outputSchema },

  setup: async (): Promise<DataImportConfig> => {
    const agentConfig = await getAgentConfigWithDefaults("data-import");
    const cfg = (agentConfig.config ?? {}) as Record<string, unknown>;

    return {
      maxBatchSize: (cfg.maxBatchSize as number) ?? 1000,
      defaultTimeout: (cfg.defaultTimeoutMs as number) ?? 30_000,
    };
  },

  shutdown: async (_app, _config) => {
    // Graceful shutdown -- reserved for aborting in-flight imports
    // and flushing KV import state.
  },

  handler: async (ctx, input) => {
    const startTime = Date.now();

    if (!ctx.config) {
      ctx.logger.warn("ctx.config undefined — app setup may have failed");
      return {
        success: false,
        importType: input.importType,
        recordsProcessed: 0,
        recordsCreated: 0,
        recordsUpdated: 0,
        recordsSkipped: 0,
        errors: [{ row: 0, message: "Import unavailable — configuration not loaded. Please retry." }],
        durationMs: Date.now() - startTime,
        dryRun: input.dryRun,
      };
    }

    ctx.logger.info("Data import started", {
      importType: input.importType,
      sourceType: input.source.type,
      mode: input.mode,
      dryRun: input.dryRun,
    });

    // Track import state in KV for resume/deduplication
    const importId = crypto.randomUUID();
    const stateKey = `import:${input.importType}:latest`;

    try {
      await ctx.kv.set("imports", stateKey, {
        importId,
        status: "running",
        startedAt: new Date().toISOString(),
        importType: input.importType,
      }, { ttl: 86400 }); // 24h TTL
    } catch {
      // KV unavailable -- continue without state tracking
    }

    // ── Fetch data from source ──
    let records: unknown[] = [];

    try {
      switch (input.source.type) {
        case "api": {
          if (!input.source.url) {
            return errorResult(input, startTime, "API source requires a URL");
          }
          const response = await fetch(input.source.url, {
            method: input.source.method,
            headers: input.source.headers,
            signal: AbortSignal.timeout(ctx.config.defaultTimeout),
          });
          if (!response.ok) {
            return errorResult(input, startTime, `API returned ${response.status}`);
          }
          const json = await response.json();
          // Extract records using dataPath (e.g., "data.items")
          records = extractRecords(json, input.source.dataPath);
          break;
        }

        case "file": {
          if (!input.source.filePath) {
            return errorResult(input, startTime, "File source requires a filePath");
          }
          // Read from object storage via service abstraction
          const { get: getObject } = await import("../../services/object-storage");
          const content = await getObject(input.source.filePath);
          if (content === null) {
            return errorResult(input, startTime, `File not found: ${input.source.filePath}`);
          }

          // Auto-detect format
          if (input.source.filePath.endsWith(".json")) {
            const json = JSON.parse(content);
            records = Array.isArray(json) ? json : [json];
          } else if (input.source.filePath.endsWith(".csv")) {
            records = parseCSV(content);
          } else {
            return errorResult(input, startTime, "Unsupported file format (use .json or .csv)");
          }
          break;
        }

        case "webhook": {
          const payload = input.source.payload;
          if (Array.isArray(payload)) {
            records = payload;
          } else if (payload && typeof payload === "object") {
            records = [payload];
          } else {
            return errorResult(input, startTime, "Webhook source requires payload data");
          }
          break;
        }
      }
    } catch (err: any) {
      ctx.logger.error("Data fetch failed", {
        importType: input.importType,
        error: err.message,
      });
      return errorResult(input, startTime, `Data fetch failed: ${err.message}`);
    }

    // ── Apply batch limit ──
    const batch = records.slice(0, input.batchSize);
    ctx.logger.info("Records fetched", {
      total: records.length,
      batchSize: batch.length,
    });

    // ── Process records ──
    let created = 0;
    let updated = 0;
    let skipped = 0;
    const errors: Array<{ row: number; field?: string; message: string }> = [];

    for (let i = 0; i < batch.length; i++) {
      const record = batch[i] as Record<string, unknown>;
      try {
        if (input.dryRun) {
          // Validate only
          validateRecord(input.importType, record);
          skipped++;
          continue;
        }

        const result = await processRecord(
          input.importType,
          record,
          input.mode,
          ctx.logger
        );

        if (result === "created") created++;
        else if (result === "updated") updated++;
        else skipped++;
      } catch (err: any) {
        errors.push({
          row: i + 1,
          message: err.message || "Unknown error",
        });
      }
    }

    // ── Update import state ──
    const durationMs = Date.now() - startTime;
    try {
      await ctx.kv.set("imports", stateKey, {
        importId,
        status: "completed",
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs,
        recordsProcessed: batch.length,
        recordsCreated: created,
        recordsUpdated: updated,
        recordsSkipped: skipped,
        errorCount: errors.length,
      }, { ttl: 86400 * 7 }); // 7d TTL for completed imports
    } catch {
      // Non-critical
    }

    ctx.logger.info("Data import completed", {
      importType: input.importType,
      created,
      updated,
      skipped,
      errors: errors.length,
      durationMs,
    });

    // Publish completion event to queue for downstream consumers
    // (e.g. notifications, analytics, webhooks). Fails gracefully
    // if queue is not provisioned yet.
    ctx.waitUntil(async () => {
      try {
        await ctx.queue.publish("import-events", {
          event: "import.completed",
          importType: input.importType,
          success: errors.length === 0,
          recordsProcessed: batch.length,
          recordsCreated: created,
          recordsUpdated: updated,
          recordsSkipped: skipped,
          errorCount: errors.length,
          durationMs,
          dryRun: input.dryRun,
          completedAt: new Date().toISOString(),
        });
      } catch {
        // Queue not provisioned -- non-critical
      }
    });

    // Write durable audit stream for import traceability
    ctx.waitUntil(async () => {
      try {
        const auditStream = await ctx.stream.create("import-audit", {
          contentType: "application/json",
          metadata: {
            importId,
            importType: input.importType,
            sourceType: input.source.type,
          },
          ttl: 86400 * 30, // 30 days retention
        });
        await auditStream.write(JSON.stringify({
          importId,
          importType: input.importType,
          sourceType: input.source.type,
          mode: input.mode,
          dryRun: input.dryRun,
          recordsProcessed: batch.length,
          recordsCreated: created,
          recordsUpdated: updated,
          recordsSkipped: skipped,
          errors: errors.slice(0, 100),
          startedAt: new Date(startTime).toISOString(),
          completedAt: new Date().toISOString(),
          durationMs,
        }, null, 2));
        await auditStream.close();
      } catch {
        // Stream service unavailable -- non-critical
      }
    });

    return {
      success: errors.length === 0,
      importType: input.importType,
      recordsProcessed: batch.length,
      recordsCreated: created,
      recordsUpdated: updated,
      recordsSkipped: skipped,
      errors: errors.slice(0, 50), // Cap error list
      durationMs,
      dryRun: input.dryRun,
    };
  },
});

// ── Agent-level event listeners (per-agent telemetry) ──────
agent.addEventListener("started", (_event, _agentInfo, ctx) => {
  ctx.logger.info("[data-import] agent invocation started");
});

agent.addEventListener("completed", (_event, _agentInfo, ctx) => {
  ctx.logger.info("[data-import] agent invocation completed");
});

agent.addEventListener("errored", (_event, _agentInfo, ctx, error) => {
  ctx.logger.error("[data-import] agent invocation errored", {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
});

// ── Helper functions ───────────────────────────────────────

function errorResult(
  input: s.infer<typeof inputSchema>,
  startTime: number,
  message: string
) {
  return {
    success: false,
    importType: input.importType,
    recordsProcessed: 0,
    recordsCreated: 0,
    recordsUpdated: 0,
    recordsSkipped: 0,
    errors: [{ row: 0, message }],
    durationMs: Date.now() - startTime,
    dryRun: input.dryRun,
  };
}

function extractRecords(data: unknown, path?: string): unknown[] {
  if (!path) {
    return Array.isArray(data) ? data : [data];
  }

  let current: any = data;
  for (const segment of path.split(".")) {
    if (current && typeof current === "object" && segment in current) {
      current = current[segment];
    } else {
      return [];
    }
  }
  return Array.isArray(current) ? current : [current];
}

function parseCSV(content: string): Record<string, string>[] {
  const lines = content.trim().split("\n");
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  const records: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
    const record: Record<string, string> = {};
    headers.forEach((h, idx) => {
      record[h] = values[idx] ?? "";
    });
    records.push(record);
  }

  return records;
}

function validateRecord(importType: string, record: Record<string, unknown>): void {
  switch (importType) {
    case "products":
      if (!record.name) throw new Error("Product name is required");
      break;
    case "customers":
      if (!record.name) throw new Error("Customer name is required");
      break;
    case "inventory":
      if (!record.productId) throw new Error("Product ID is required for inventory");
      break;
    case "orders":
      if (!record.customerId) throw new Error("Customer ID is required for orders");
      break;
  }
}

async function processRecord(
  importType: string,
  record: Record<string, unknown>,
  mode: "create" | "update" | "upsert",
  logger: any
): Promise<"created" | "updated" | "skipped"> {
  switch (importType) {
    case "products":
      return processProductRecord(record, mode);
    case "customers":
      return processCustomerRecord(record, mode);
    default:
      logger?.warn?.("Unsupported import type for direct processing", { importType });
      return "skipped";
  }
}

async function processProductRecord(
  record: Record<string, unknown>,
  mode: "create" | "update" | "upsert"
): Promise<"created" | "updated" | "skipped"> {
  const sku = record.sku as string | undefined;

  if (sku) {
    // Try to find existing product by SKU
    const existing = await db.query.products.findFirst({
      where: eq(products.sku, sku),
    });

    if (existing && (mode === "update" || mode === "upsert")) {
      await db.update(products).set({
        name: (record.name as string) ?? existing.name,
        price: record.price !== undefined ? String(record.price) : existing.price,
        unit: (record.unit as string) ?? existing.unit,
        updatedAt: new Date(),
      }).where(eq(products.id, existing.id));
      return "updated";
    } else if (existing) {
      return "skipped";
    }
  }

  if (mode === "update") return "skipped";

  // Create new product
  await db.insert(products).values({
    name: record.name as string,
    sku: sku ?? `IMP-${Date.now()}`,
    price: String(record.price ?? "0"),
    unit: (record.unit as string) ?? "piece",
    description: (record.description as string) || null,
  });
  return "created";
}

async function processCustomerRecord(
  record: Record<string, unknown>,
  mode: "create" | "update" | "upsert"
): Promise<"created" | "updated" | "skipped"> {
  const email = record.email as string | undefined;

  if (email) {
    const existing = await db.query.customers.findFirst({
      where: eq(customers.email, email),
    });

    if (existing && (mode === "update" || mode === "upsert")) {
      await db.update(customers).set({
        name: (record.name as string) ?? existing.name,
        phone: (record.phone as string) ?? existing.phone,
        updatedAt: new Date(),
      }).where(eq(customers.id, existing.id));
      return "updated";
    } else if (existing) {
      return "skipped";
    }
  }

  if (mode === "update") return "skipped";

  await db.insert(customers).values({
    name: record.name as string,
    email: email ?? undefined,
    phone: (record.phone as string) ?? undefined,
  });
  return "created";
}

export default agent;
