/**
 * REST API Data Connector — fetches and imports data from configurable REST endpoints.
 *
 * Supports multiple auth modes (API key header, Bearer token, Basic auth),
 * configurable data path extraction, and batch processing of fetched records.
 */

import type { DataConnector, ConnectorConfig, SyncOptions, SyncResult } from "./types";
import { normalizeProduct, normalizeOrder, normalizeCustomer } from "../normalizer";
import { db, products, orders, customers } from "@db/index";
import { eq } from "drizzle-orm";

// ── REST Connector ───────────────────────────────────────────

export class RestConnector implements DataConnector {
  type = "rest" as const;
  displayName = "REST API Import";

  async validate(config: ConnectorConfig): Promise<{ valid: boolean; error?: string }> {
    const url = config.settings.url as string | undefined;
    if (!url || typeof url !== "string") {
      return { valid: false, error: "Missing or invalid URL in settings" };
    }

    try {
      new URL(url);
    } catch {
      return { valid: false, error: "Invalid URL format" };
    }

    const authType = config.settings.authType as string | undefined;
    if (authType) {
      if (!["apiKey", "bearer", "basic"].includes(authType)) {
        return { valid: false, error: `Unsupported auth type: ${authType}. Use apiKey, bearer, or basic.` };
      }

      if (authType === "apiKey" && !config.settings.apiKey) {
        return { valid: false, error: "apiKey auth requires an apiKey in settings" };
      }
      if (authType === "bearer" && !config.settings.token) {
        return { valid: false, error: "bearer auth requires a token in settings" };
      }
      if (authType === "basic" && (!config.settings.username || !config.settings.password)) {
        return { valid: false, error: "basic auth requires username and password in settings" };
      }
    }

    return { valid: true };
  }

  async sync(config: ConnectorConfig, options?: SyncOptions): Promise<SyncResult> {
    const url = config.settings.url as string;
    const entityType = (config.settings.entityType as string) ?? "products";
    const dataPath = config.settings.dataPath as string | undefined;
    const dryRun = options?.dryRun ?? false;
    const mode = options?.mode ?? "upsert";
    const batchSize = options?.batchSize ?? 100;

    // Build request headers with auth
    const headers: Record<string, string> = {
      "Accept": "application/json",
      ...(config.settings.headers as Record<string, string> ?? {}),
    };

    const authType = config.settings.authType as string | undefined;
    if (authType === "apiKey") {
      const headerName = (config.settings.apiKeyHeader as string) ?? "X-API-Key";
      headers[headerName] = config.settings.apiKey as string;
    } else if (authType === "bearer") {
      headers["Authorization"] = `Bearer ${config.settings.token as string}`;
    } else if (authType === "basic") {
      const credentials = btoa(`${config.settings.username}:${config.settings.password}`);
      headers["Authorization"] = `Basic ${credentials}`;
    }

    // Fetch data from REST API
    let records: unknown[];
    try {
      const response = await fetch(url, {
        method: (config.settings.method as string)?.toUpperCase() ?? "GET",
        headers,
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        return {
          success: false,
          recordsProcessed: 0,
          recordsCreated: 0,
          recordsUpdated: 0,
          recordsSkipped: 0,
          errors: [{ row: 0, error: `API returned HTTP ${response.status}: ${response.statusText}` }],
          syncedAt: new Date(),
        };
      }

      const json = await response.json();
      records = this.extractRecords(json, dataPath);
    } catch (err: any) {
      return {
        success: false,
        recordsProcessed: 0,
        recordsCreated: 0,
        recordsUpdated: 0,
        recordsSkipped: 0,
        errors: [{ row: 0, error: `Fetch failed: ${err?.message ?? "Unknown error"}` }],
        syncedAt: new Date(),
      };
    }

    // Process records in batches
    let recordsCreated = 0;
    let recordsUpdated = 0;
    let recordsSkipped = 0;
    const errors: Array<{ row: number; field?: string; error: string }> = [];

    for (let batchStart = 0; batchStart < records.length; batchStart += batchSize) {
      const batch = records.slice(batchStart, batchStart + batchSize);

      for (let i = 0; i < batch.length; i++) {
        const rowIndex = batchStart + i + 1;
        const raw = batch[i] as Record<string, unknown>;

        try {
          if (dryRun) {
            recordsSkipped++;
            continue;
          }

          const result = await this.processRow(entityType, raw, config.fieldMapping ?? {}, mode, "rest");
          if (result === "created") recordsCreated++;
          else if (result === "updated") recordsUpdated++;
          else recordsSkipped++;
        } catch (err: any) {
          errors.push({
            row: rowIndex,
            error: err?.message ?? "Unknown error",
          });
        }
      }

      options?.onProgress?.(Math.min(batchStart + batchSize, records.length), records.length);
    }

    return {
      success: errors.length === 0,
      recordsProcessed: records.length,
      recordsCreated,
      recordsUpdated,
      recordsSkipped,
      errors,
      syncedAt: new Date(),
    };
  }

  private extractRecords(data: unknown, dataPath?: string): unknown[] {
    if (!dataPath) {
      return Array.isArray(data) ? data : [data];
    }

    let current: any = data;
    for (const segment of dataPath.split(".")) {
      if (current && typeof current === "object" && segment in current) {
        current = current[segment];
      } else {
        return [];
      }
    }
    return Array.isArray(current) ? current : [current];
  }

  private async processRow(
    entityType: string,
    raw: Record<string, unknown>,
    fieldMapping: Record<string, string>,
    mode: "create" | "update" | "upsert",
    source: string
  ): Promise<"created" | "updated" | "skipped"> {
    switch (entityType) {
      case "products":
        return this.upsertProduct(raw, fieldMapping, mode, source);
      case "customers":
        return this.upsertCustomer(raw, fieldMapping, mode, source);
      case "orders":
        return this.upsertOrder(raw, fieldMapping, mode, source);
      default:
        return "skipped";
    }
  }

  private async upsertProduct(
    raw: Record<string, unknown>,
    fieldMapping: Record<string, string>,
    mode: "create" | "update" | "upsert",
    source: string
  ): Promise<"created" | "updated" | "skipped"> {
    const normalized = normalizeProduct(raw, fieldMapping, source);
    if (!normalized.name) return "skipped";

    if (normalized.sku) {
      const existing = await db.query.products.findFirst({
        where: eq(products.sku, normalized.sku),
      });

      if (existing && (mode === "update" || mode === "upsert")) {
        await db.update(products).set({
          name: normalized.name,
          price: normalized.sellingPrice !== undefined ? String(normalized.sellingPrice) : existing.price,
          costPrice: normalized.costPrice !== undefined ? String(normalized.costPrice) : existing.costPrice,
          unit: normalized.unit ?? existing.unit,
          supplierName: normalized.supplierName ?? existing.supplierName,
          externalId: normalized.externalId ?? existing.externalId,
          externalSource: normalized.externalSource ?? existing.externalSource,
          metadata: { ...((existing.metadata as Record<string, unknown>) ?? {}), ...normalized.metadata },
          updatedAt: new Date(),
        }).where(eq(products.id, existing.id));
        return "updated";
      } else if (existing) {
        return "skipped";
      }
    }

    if (mode === "update") return "skipped";

    await db.insert(products).values({
      name: normalized.name,
      sku: normalized.sku ?? `REST-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      price: String(normalized.sellingPrice ?? "0"),
      costPrice: normalized.costPrice !== undefined ? String(normalized.costPrice) : undefined,
      unit: normalized.unit ?? "piece",
      supplierName: normalized.supplierName,
      externalId: normalized.externalId,
      externalSource: normalized.externalSource,
      metadata: Object.keys(normalized.metadata).length > 0 ? normalized.metadata : undefined,
    });
    return "created";
  }

  private async upsertCustomer(
    raw: Record<string, unknown>,
    fieldMapping: Record<string, string>,
    mode: "create" | "update" | "upsert",
    source: string
  ): Promise<"created" | "updated" | "skipped"> {
    const normalized = normalizeCustomer(raw, fieldMapping, source);
    if (!normalized.name) return "skipped";

    if (normalized.email) {
      const existing = await db.query.customers.findFirst({
        where: eq(customers.email, normalized.email),
      });

      if (existing && (mode === "update" || mode === "upsert")) {
        await db.update(customers).set({
          name: normalized.name,
          phone: normalized.phone ?? existing.phone,
          address: normalized.address ?? existing.address,
          externalId: normalized.externalId ?? existing.externalId,
          externalSource: normalized.externalSource ?? existing.externalSource,
          metadata: { ...((existing.metadata as Record<string, unknown>) ?? {}), ...normalized.metadata },
          updatedAt: new Date(),
        }).where(eq(customers.id, existing.id));
        return "updated";
      } else if (existing) {
        return "skipped";
      }
    }

    if (mode === "update") return "skipped";

    await db.insert(customers).values({
      name: normalized.name,
      email: normalized.email,
      phone: normalized.phone,
      address: normalized.address,
      externalId: normalized.externalId,
      externalSource: normalized.externalSource,
      metadata: Object.keys(normalized.metadata).length > 0 ? normalized.metadata : undefined,
    });
    return "created";
  }

  private async upsertOrder(
    raw: Record<string, unknown>,
    fieldMapping: Record<string, string>,
    mode: "create" | "update" | "upsert",
    source: string
  ): Promise<"created" | "updated" | "skipped"> {
    const normalized = normalizeOrder(raw, fieldMapping, source);

    if (normalized.orderNumber) {
      const existing = await db.query.orders.findFirst({
        where: eq(orders.orderNumber, normalized.orderNumber),
      });

      if (existing && (mode === "update" || mode === "upsert")) {
        await db.update(orders).set({
          totalAmount: String(normalized.totalAmount),
          paymentMethod: normalized.paymentMethod ?? existing.paymentMethod,
          paymentReference: normalized.paymentReference ?? existing.paymentReference,
          notes: normalized.notes ?? existing.notes,
          externalId: normalized.externalId ?? existing.externalId,
          externalSource: normalized.externalSource ?? existing.externalSource,
          metadata: { ...((existing.metadata as Record<string, unknown>) ?? {}), ...normalized.metadata },
          updatedAt: new Date(),
        }).where(eq(orders.id, existing.id));
        return "updated";
      } else if (existing) {
        return "skipped";
      }
    }

    if (mode === "update") return "skipped";

    await db.insert(orders).values({
      orderNumber: normalized.orderNumber ?? `REST-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      totalAmount: String(normalized.totalAmount),
      paymentMethod: normalized.paymentMethod,
      paymentReference: normalized.paymentReference,
      notes: normalized.notes,
      externalId: normalized.externalId,
      externalSource: normalized.externalSource,
      metadata: Object.keys(normalized.metadata).length > 0 ? normalized.metadata : undefined,
    });
    return "created";
  }
}
