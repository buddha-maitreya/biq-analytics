/**
 * CSV Data Connector — imports data from CSV text with smart column auto-detection.
 *
 * Parses CSV inline (no external library) with support for quoted fields,
 * auto-detects column mappings using fuzzy alias matching, and processes
 * records in configurable batches.
 */

import type { DataConnector, ConnectorConfig, SyncOptions, SyncResult } from "./types";
import { normalizeProduct, normalizeOrder, normalizeCustomer } from "../normalizer";
import { db, products, orders, customers } from "@db/index";
import { eq } from "drizzle-orm";

// ── Column alias mappings ────────────────────────────────────

const PRODUCT_ALIASES: Record<string, string[]> = {
  name: ["name", "product_name", "item_name", "description"],
  sku: ["sku", "product_code", "item_code", "code", "barcode"],
  price: ["price", "selling_price", "unit_price", "sale_price"],
  costPrice: ["cost", "cost_price", "purchase_price"],
  quantity: ["quantity", "qty", "stock", "on_hand", "stock_quantity"],
  category: ["category", "category_name", "department"],
  supplier_name: ["supplier", "supplier_name", "vendor"],
};

const CUSTOMER_ALIASES: Record<string, string[]> = {
  name: ["name", "customer_name", "full_name"],
  email: ["email", "customer_email"],
  phone: ["phone", "mobile", "telephone"],
  address: ["address", "street_address"],
};

const ORDER_ALIASES: Record<string, string[]> = {
  totalAmount: ["total", "amount", "order_total"],
  customerName: ["customer", "customer_name"],
  orderNumber: ["order_number", "order_id", "reference"],
  paymentMethod: ["payment_method", "payment_type"],
};

const ALL_ALIASES: Record<string, string[]> = {
  ...PRODUCT_ALIASES,
  ...CUSTOMER_ALIASES,
  ...ORDER_ALIASES,
};

// ── Auto-detect column mapping ──────────────────────────────

export function autoDetectMapping(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const normalizedHeaders = headers.map((h) => h.toLowerCase().trim().replace(/\s+/g, "_"));

  for (let i = 0; i < normalizedHeaders.length; i++) {
    const header = normalizedHeaders[i];
    for (const [field, aliases] of Object.entries(ALL_ALIASES)) {
      if (aliases.includes(header) && !Object.values(mapping).includes(field)) {
        mapping[headers[i]] = field;
        break;
      }
    }
  }

  return mapping;
}

// ── CSV Parser (inline, no external deps) ────────────────────

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        // Check for escaped quote ("")
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++; // skip next quote
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        fields.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
  }

  fields.push(current.trim());
  return fields;
}

function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 1) return { headers: [], rows: [] };

  const headers = parseCSVLine(lines[0]);
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const record: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      record[headers[j]] = values[j] ?? "";
    }
    rows.push(record);
  }

  return { headers, rows };
}

// ── CSV Connector ────────────────────────────────────────────

export class CsvConnector implements DataConnector {
  type = "csv" as const;
  displayName = "CSV File Import";

  async validate(config: ConnectorConfig): Promise<{ valid: boolean; error?: string }> {
    const csvText = config.settings.csvText as string | undefined;
    if (!csvText || typeof csvText !== "string") {
      return { valid: false, error: "Missing or invalid csvText in settings" };
    }

    const { headers, rows } = parseCSV(csvText);
    if (headers.length === 0) {
      return { valid: false, error: "CSV has no headers" };
    }
    if (rows.length === 0) {
      return { valid: false, error: "CSV has no data rows" };
    }

    return { valid: true };
  }

  async sync(config: ConnectorConfig, options?: SyncOptions): Promise<SyncResult> {
    const csvText = config.settings.csvText as string;
    const entityType = (config.settings.entityType as string) ?? "products";
    const batchSize = options?.batchSize ?? 100;
    const dryRun = options?.dryRun ?? false;
    const mode = options?.mode ?? "upsert";

    const { headers, rows } = parseCSV(csvText);

    // Build field mapping: explicit config overrides, then auto-detect
    const autoMapping = autoDetectMapping(headers);
    const fieldMapping = { ...autoMapping, ...(config.fieldMapping ?? {}) };

    let recordsCreated = 0;
    let recordsUpdated = 0;
    let recordsSkipped = 0;
    const errors: Array<{ row: number; field?: string; error: string }> = [];

    // Process in batches
    for (let batchStart = 0; batchStart < rows.length; batchStart += batchSize) {
      const batch = rows.slice(batchStart, batchStart + batchSize);

      for (let i = 0; i < batch.length; i++) {
        const rowIndex = batchStart + i + 1; // 1-based row number (excludes header)
        const raw = batch[i] as Record<string, unknown>;

        try {
          if (dryRun) {
            recordsSkipped++;
            continue;
          }

          const result = await this.processRow(entityType, raw, fieldMapping, mode);
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

      // Report progress
      options?.onProgress?.(Math.min(batchStart + batchSize, rows.length), rows.length);
    }

    return {
      success: errors.length === 0,
      recordsProcessed: rows.length,
      recordsCreated,
      recordsUpdated,
      recordsSkipped,
      errors,
      syncedAt: new Date(),
    };
  }

  private async processRow(
    entityType: string,
    raw: Record<string, unknown>,
    fieldMapping: Record<string, string>,
    mode: "create" | "update" | "upsert"
  ): Promise<"created" | "updated" | "skipped"> {
    switch (entityType) {
      case "products":
        return this.upsertProduct(raw, fieldMapping, mode);
      case "customers":
        return this.upsertCustomer(raw, fieldMapping, mode);
      case "orders":
        return this.upsertOrder(raw, fieldMapping, mode);
      default:
        return "skipped";
    }
  }

  private async upsertProduct(
    raw: Record<string, unknown>,
    fieldMapping: Record<string, string>,
    mode: "create" | "update" | "upsert"
  ): Promise<"created" | "updated" | "skipped"> {
    const normalized = normalizeProduct(raw, fieldMapping, "csv");

    if (!normalized.name) return "skipped";

    // Try to find existing by SKU or externalId
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
      sku: normalized.sku ?? `CSV-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
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
    mode: "create" | "update" | "upsert"
  ): Promise<"created" | "updated" | "skipped"> {
    const normalized = normalizeCustomer(raw, fieldMapping, "csv");

    if (!normalized.name) return "skipped";

    // Try to find existing by email or externalId
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
    mode: "create" | "update" | "upsert"
  ): Promise<"created" | "updated" | "skipped"> {
    const normalized = normalizeOrder(raw, fieldMapping, "csv");

    // Try to find existing by orderNumber or externalId
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
      orderNumber: normalized.orderNumber ?? `CSV-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
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
