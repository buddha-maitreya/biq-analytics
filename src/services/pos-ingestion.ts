/**
 * POS Ingestion Service — core pipeline for processing external POS events.
 *
 * Flow:
 *   1. Identify vendor (from route param)
 *   2. Load vendor config from DB
 *   3. Adapter: normalize raw payload → PosTransaction
 *   4. Idempotency check: SELECT from pos_transactions WHERE (vendor, pos_tx_id)
 *   5. If duplicate: return early
 *   6. DB Transaction:
 *      a. INSERT pos_transactions (status: "received")
 *      b. Resolve products by SKU/barcode
 *      c. Create order + order items (via createOrder)
 *      d. UPDATE pos_transactions (status: "processed", order_id)
 *   7. Post-processing: check low-stock thresholds
 *   8. Return result
 *
 * This service replaces the original pos-webhook.ts for new integrations.
 * The old pos-webhook.ts is preserved for backward compatibility with
 * the generic webhook framework (POST /webhooks/:source).
 */

import { db, posTransactions, posVendorConfigs, products, customers, warehouses } from "@db/index";
import { eq, and } from "drizzle-orm";
import { createOrder } from "@services/orders";
import { getAdapter } from "@services/pos-adapters";
import type { PosTransaction, PosLineItem, PosBatchResult } from "@services/pos-adapters";
import { checkLowStockAlerts } from "@services/pos-alerts";
import { ValidationError, NotFoundError } from "@lib/errors";

// ── Types ───────────────────────────────────────────────────

export interface PosIngestionResult {
  status: "processed" | "duplicate" | "failed";
  posTransactionId: string;
  orderId?: string;
  orderNumber?: string;
  totalAmount?: string;
  itemsProcessed: number;
  itemsNotFound: string[];
  paymentStatus: string;
  error?: string;
}

// ── Vendor Config Lookup ────────────────────────────────────

/**
 * Load the active vendor config for a given vendor name.
 * Returns null if no config exists (vendor can still be processed with defaults).
 */
export async function getVendorConfig(vendor: string) {
  return db.query.posVendorConfigs.findFirst({
    where: and(
      eq(posVendorConfigs.vendor, vendor.toLowerCase()),
      eq(posVendorConfigs.isActive, true),
    ),
  });
}

// ── Product Resolution ──────────────────────────────────────

async function resolveProduct(item: PosLineItem) {
  if (item.productId) {
    return db.query.products.findFirst({
      where: eq(products.id, item.productId),
    });
  }
  if (item.sku) {
    return db.query.products.findFirst({
      where: eq(products.sku, item.sku),
    });
  }
  if (item.barcode) {
    return db.query.products.findFirst({
      where: eq(products.barcode, item.barcode),
    });
  }
  return null;
}

// ── Customer Resolution ─────────────────────────────────────

async function resolveCustomer(tx: PosTransaction): Promise<string | undefined> {
  if (!tx.customerId) return undefined;

  // Try as UUID first
  if (tx.customerId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
    const customer = await db.query.customers.findFirst({
      where: eq(customers.id, tx.customerId),
    });
    return customer?.id;
  }

  // Try as phone number
  const customer = await db.query.customers.findFirst({
    where: eq(customers.phone, tx.customerId),
  });
  return customer?.id;
}

// ── Warehouse Resolution ────────────────────────────────────

async function resolveWarehouse(
  locationId?: string,
  vendorDefaultWarehouseId?: string,
): Promise<string | undefined> {
  // 1. POS payload location → warehouse by code
  if (locationId) {
    const wh = await db.query.warehouses.findFirst({
      where: eq(warehouses.code, locationId),
    });
    if (wh) return wh.id;
  }

  // 2. Vendor config default warehouse
  if (vendorDefaultWarehouseId) return vendorDefaultWarehouseId;

  // 3. Deployment default warehouse
  const defaultWh = await db.query.warehouses.findFirst({
    where: eq(warehouses.isDefault, true),
  });
  return defaultWh?.id;
}

// ── Core Ingestion Pipeline ─────────────────────────────────

/**
 * Process a single POS event through the ingestion pipeline.
 */
export async function ingestPosEvent(
  rawPayload: unknown,
  vendor: string,
): Promise<PosIngestionResult> {
  // Step 1: Load vendor config
  const vendorConfig = await getVendorConfig(vendor);
  const fieldMapping = vendorConfig?.fieldMapping ?? undefined;

  // Step 2: Normalize payload via adapter
  const adapter = getAdapter(vendor);
  let normalized: PosTransaction;
  try {
    normalized = adapter.normalize(rawPayload, fieldMapping);
  } catch (err) {
    // Record the failed event
    const [failedTx] = await db
      .insert(posTransactions)
      .values({
        posVendor: vendor.toLowerCase(),
        posTxId: `failed_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        eventType: "sale",
        posPayload: rawPayload as Record<string, unknown>,
        status: "failed",
        vendorConfigId: vendorConfig?.id,
        errorMessage: err instanceof Error ? err.message : String(err),
      })
      .returning();

    return {
      status: "failed",
      posTransactionId: failedTx.id,
      itemsProcessed: 0,
      itemsNotFound: [],
      paymentStatus: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Step 3: Idempotency check
  const existing = await db.query.posTransactions.findFirst({
    where: and(
      eq(posTransactions.posVendor, normalized.posVendor),
      eq(posTransactions.posTxId, normalized.posTxId),
    ),
  });

  if (existing) {
    return {
      status: "duplicate",
      posTransactionId: existing.id,
      orderId: existing.orderId ?? undefined,
      itemsProcessed: 0,
      itemsNotFound: [],
      paymentStatus: existing.status,
    };
  }

  // Step 4: Resolve warehouse
  const warehouseId = await resolveWarehouse(
    normalized.locationId,
    vendorConfig?.defaultWarehouseId ?? undefined,
  );

  // Step 5: Insert pos_transaction record (status: "received")
  const [posTx] = await db
    .insert(posTransactions)
    .values({
      posVendor: normalized.posVendor,
      posTxId: normalized.posTxId,
      eventType: normalized.eventType,
      posPayload: normalized.rawPayload as Record<string, unknown>,
      status: "received",
      warehouseId,
      vendorConfigId: vendorConfig?.id,
      itemCount: normalized.items.length,
      totalAmount: String(normalized.totalAmount),
      paymentMethod: normalized.paymentMethod,
    })
    .returning();

  // Step 6: Resolve products and build order items
  const resolvedItems: Array<{
    productId: string;
    quantity: number;
    unitPrice?: number;
    discountAmount?: number;
  }> = [];
  const itemsNotFound: string[] = [];

  for (const item of normalized.items) {
    const product = await resolveProduct(item);
    if (!product) {
      const identifier = item.sku || item.barcode || item.productId || item.name;
      itemsNotFound.push(identifier);
      continue;
    }

    resolvedItems.push({
      productId: product.id,
      quantity: item.quantity,
      unitPrice: item.unitPrice || undefined,
      discountAmount: item.discountAmount || undefined,
    });
  }

  // If no products resolved, mark as failed
  if (resolvedItems.length === 0 && normalized.items.length > 0) {
    await db
      .update(posTransactions)
      .set({
        status: "failed",
        errorMessage: `No products resolved. Unknown: ${itemsNotFound.join(", ")}`,
      })
      .where(eq(posTransactions.id, posTx.id));

    return {
      status: "failed",
      posTransactionId: posTx.id,
      itemsProcessed: 0,
      itemsNotFound,
      paymentStatus: "failed",
      error: `No products could be resolved. Unknown identifiers: ${itemsNotFound.join(", ")}`,
    };
  }

  // Step 7: Resolve customer
  const customerId = await resolveCustomer(normalized);

  // Step 8: Create order via existing order service
  try {
    const order = await createOrder({
      customerId,
      warehouseId,
      items: resolvedItems,
      paymentMethod: normalized.paymentMethod,
      paymentReference: normalized.paymentReference,
      paymentStatus: "paid",
      notes: normalized.terminalId
        ? `POS sale from ${vendor} terminal ${normalized.terminalId}`
        : `POS sale from ${vendor}`,
      metadata: {
        posVendor: normalized.posVendor,
        posTxId: normalized.posTxId,
        posTerminalId: normalized.terminalId ?? null,
        posCashierId: normalized.cashierId ?? null,
        posTimestamp: normalized.timestamp.toISOString(),
        posTransactionId: posTx.id,
      },
    });

    // Step 9: Update pos_transaction with order link
    await db
      .update(posTransactions)
      .set({
        status: "processed",
        orderId: order.id,
        processedAt: new Date(),
      })
      .where(eq(posTransactions.id, posTx.id));

    // Step 10: Update vendor config stats
    if (vendorConfig) {
      await db
        .update(posVendorConfigs)
        .set({
          lastSyncAt: new Date(),
          totalTransactions: vendorConfig.totalTransactions + 1,
          errorCount: 0, // Reset error count on success
        })
        .where(eq(posVendorConfigs.id, vendorConfig.id));
    }

    // Step 11: Post-processing — check low-stock alerts (non-fatal)
    try {
      const productIds = resolvedItems.map((i) => i.productId);
      await checkLowStockAlerts(productIds, warehouseId);
    } catch {
      // Non-fatal — alert failures don't affect the transaction
    }

    return {
      status: "processed",
      posTransactionId: posTx.id,
      orderId: order.id,
      orderNumber: order.orderNumber,
      totalAmount: order.totalAmount,
      itemsProcessed: resolvedItems.length,
      itemsNotFound,
      paymentStatus: "paid",
    };
  } catch (err) {
    // Order creation failed — mark the transaction as failed
    await db
      .update(posTransactions)
      .set({
        status: "failed",
        errorMessage: err instanceof Error ? err.message : String(err),
      })
      .where(eq(posTransactions.id, posTx.id));

    // Increment vendor error count
    if (vendorConfig) {
      await db
        .update(posVendorConfigs)
        .set({ errorCount: vendorConfig.errorCount + 1 })
        .where(eq(posVendorConfigs.id, vendorConfig.id));
    }

    return {
      status: "failed",
      posTransactionId: posTx.id,
      itemsProcessed: 0,
      itemsNotFound,
      paymentStatus: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── Batch Ingestion ─────────────────────────────────────────

/**
 * Process a batch of POS events. Used for offline reconnect / historical import.
 * Events are processed sequentially in chronological order.
 */
export async function ingestPosBatch(
  events: unknown[],
  vendor: string,
): Promise<PosBatchResult> {
  const maxBatch = Number(process.env.POS_BATCH_MAX_EVENTS ?? 500);
  if (events.length > maxBatch) {
    throw new ValidationError(
      `Batch size ${events.length} exceeds maximum of ${maxBatch}`,
    );
  }

  const result: PosBatchResult = {
    total: events.length,
    processed: 0,
    duplicates: 0,
    failed: 0,
    errors: [],
  };

  for (let i = 0; i < events.length; i++) {
    try {
      const ingestionResult = await ingestPosEvent(events[i], vendor);
      if (ingestionResult.status === "processed") {
        result.processed++;
      } else if (ingestionResult.status === "duplicate") {
        result.duplicates++;
      } else {
        result.failed++;
        result.errors.push({ index: i, error: ingestionResult.error ?? "Unknown error" });
      }
    } catch (err) {
      result.failed++;
      result.errors.push({
        index: i,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}
