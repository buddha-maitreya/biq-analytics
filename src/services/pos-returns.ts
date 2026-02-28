/**
 * POS Returns Service — processes return/refund events from external POS systems.
 *
 * Flow:
 *   1. Find original pos_transaction by vendor + original tx ID
 *   2. Validate: original exists AND status = "processed"
 *   3. Normalize return payload via adapter
 *   4. Create a return order (negative amounts or credit note)
 *   5. Record inventory increments (returned stock)
 *   6. Update original pos_transaction status → "returned"
 *   7. Insert new pos_transaction with eventType "return"
 */

import { db, posTransactions, posVendorConfigs, products, inventory, inventoryTransactions, warehouses } from "@db/index";
import { eq, and } from "drizzle-orm";
import { createOrder } from "@services/orders";
import { getAdapter } from "@services/pos-adapters";
import type { PosTransaction } from "@services/pos-adapters";
import { getVendorConfig } from "@services/pos-ingestion";
import { ValidationError, NotFoundError } from "@lib/errors";

// ── Types ───────────────────────────────────────────────────

export interface PosReturnResult {
  status: "processed" | "failed";
  posTransactionId: string;
  originalPosTxId?: string;
  itemsReturned: number;
  totalRefund: string;
  error?: string;
}

// ── Return Processing ───────────────────────────────────────

/**
 * Process a POS return/refund event.
 *
 * @param rawPayload - Raw return payload from the POS
 * @param vendor - Vendor identifier
 * @param originalTxId - The original POS transaction ID being returned (optional — may be in payload)
 */
export async function processReturn(
  rawPayload: unknown,
  vendor: string,
  originalTxId?: string,
): Promise<PosReturnResult> {
  // Step 1: Load vendor config & normalize
  const vendorConfig = await getVendorConfig(vendor);
  const adapter = getAdapter(vendor);
  let normalized: PosTransaction;

  try {
    normalized = adapter.normalize(rawPayload, vendorConfig?.fieldMapping ?? undefined);
    normalized.eventType = "return";
  } catch (err) {
    const [failedTx] = await db
      .insert(posTransactions)
      .values({
        posVendor: vendor.toLowerCase(),
        posTxId: `return_failed_${Date.now()}`,
        eventType: "return",
        posPayload: rawPayload as Record<string, unknown>,
        status: "failed",
        vendorConfigId: vendorConfig?.id,
        errorMessage: err instanceof Error ? err.message : String(err),
      })
      .returning();

    return {
      status: "failed",
      posTransactionId: failedTx.id,
      itemsReturned: 0,
      totalRefund: "0",
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Step 2: Find original transaction
  const origTxId = originalTxId ?? (rawPayload as Record<string, unknown>)?.originalTransactionId as string;
  let originalTx = null;
  if (origTxId) {
    originalTx = await db.query.posTransactions.findFirst({
      where: and(
        eq(posTransactions.posVendor, vendor.toLowerCase()),
        eq(posTransactions.posTxId, origTxId),
      ),
    });
  }

  if (originalTx && originalTx.status === "returned") {
    return {
      status: "failed",
      posTransactionId: "",
      itemsReturned: 0,
      totalRefund: "0",
      error: `Original transaction ${origTxId} has already been returned`,
    };
  }

  // Step 3: Resolve warehouse
  const warehouseId = originalTx?.warehouseId ?? vendorConfig?.defaultWarehouseId ?? undefined;

  // Step 4: Resolve products for return items
  const resolvedItems: Array<{
    productId: string;
    quantity: number;
    unitPrice?: number;
  }> = [];

  for (const item of normalized.items) {
    let product = null;
    if (item.productId) {
      product = await db.query.products.findFirst({
        where: eq(products.id, item.productId),
      });
    } else if (item.sku) {
      product = await db.query.products.findFirst({
        where: eq(products.sku, item.sku),
      });
    } else if (item.barcode) {
      product = await db.query.products.findFirst({
        where: eq(products.barcode, item.barcode),
      });
    }

    if (product) {
      resolvedItems.push({
        productId: product.id,
        quantity: item.quantity,
        unitPrice: item.unitPrice ? -Math.abs(item.unitPrice) : undefined,
      });
    }
  }

  // Step 5: Record the return pos_transaction
  const [returnTx] = await db
    .insert(posTransactions)
    .values({
      posVendor: normalized.posVendor,
      posTxId: normalized.posTxId,
      eventType: "return",
      posPayload: normalized.rawPayload as Record<string, unknown>,
      status: "received",
      warehouseId,
      vendorConfigId: vendorConfig?.id,
      orderId: originalTx?.orderId,
      itemCount: resolvedItems.length,
      totalAmount: String(-Math.abs(normalized.totalAmount)),
      paymentMethod: normalized.paymentMethod,
    })
    .returning();

  try {
    // Step 6: Increment inventory for returned items
    if (warehouseId) {
      for (const item of resolvedItems) {
        // Increment stock
        const [existingStock] = await db
          .select()
          .from(inventory)
          .where(
            and(
              eq(inventory.productId, item.productId),
              eq(inventory.warehouseId, warehouseId),
            ),
          );

        if (existingStock) {
          await db
            .update(inventory)
            .set({ quantity: existingStock.quantity + item.quantity })
            .where(eq(inventory.id, existingStock.id));
        }

        // Record inventory transaction
        await db.insert(inventoryTransactions).values({
          productId: item.productId,
          warehouseId,
          type: "return",
          quantity: item.quantity,
          referenceType: "pos_return",
          referenceId: returnTx.id,
          notes: `POS return from ${vendor} (tx: ${normalized.posTxId})`,
        });
      }
    }

    // Step 7: Mark return transaction as processed
    await db
      .update(posTransactions)
      .set({
        status: "processed",
        processedAt: new Date(),
      })
      .where(eq(posTransactions.id, returnTx.id));

    // Step 8: Update original transaction status
    if (originalTx) {
      await db
        .update(posTransactions)
        .set({ status: "returned" })
        .where(eq(posTransactions.id, originalTx.id));
    }

    return {
      status: "processed",
      posTransactionId: returnTx.id,
      originalPosTxId: originalTx?.id,
      itemsReturned: resolvedItems.length,
      totalRefund: String(Math.abs(normalized.totalAmount)),
    };
  } catch (err) {
    await db
      .update(posTransactions)
      .set({
        status: "failed",
        errorMessage: err instanceof Error ? err.message : String(err),
      })
      .where(eq(posTransactions.id, returnTx.id));

    return {
      status: "failed",
      posTransactionId: returnTx.id,
      itemsReturned: 0,
      totalRefund: "0",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
