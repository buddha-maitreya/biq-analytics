/**
 * Transfer Service — Inter-branch inventory transfer lifecycle
 *
 * Manages the full transfer order workflow:
 *   1. Create draft transfer order (departure scanning adds items)
 *   2. Dispatch — deduct source stock, mark in_transit
 *   3. Receive — destination accepts via scan or manual count
 *   4. Complete — credit destination stock, detect discrepancies
 *
 * Transfer orders are created by scan_transfer scans or directly
 * via the API. Stock is deducted from source on dispatch and
 * credited to destination ONLY on acceptance.
 */

import { z } from "zod";
import {
  db,
  products,
  inventory,
  inventoryTransactions,
  transferOrders,
  transferOrderItems,
  warehouses,
} from "@db/index";
import { eq, and, sql, inArray, desc, asc } from "drizzle-orm";
import { NotFoundError, InsufficientStockError } from "@lib/errors";

// ── Validation Schemas ──────────────────────────────────────

export const createTransferOrderSchema = z.object({
  fromWarehouseId: z.string().uuid(),
  toWarehouseId: z.string().uuid(),
  notes: z.string().max(1000).optional(),
  acceptanceMode: z.enum(["scan", "manual"]).optional().nullable(),
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.number().int().min(1),
  })).min(1),
});

export const addTransferItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().min(1).default(1),
});

export const receiveItemSchema = z.object({
  receivedQuantity: z.number().int().min(0),
  discrepancyReason: z.enum([
    "damaged", "missing", "wrong_item", "over_delivery", "other",
  ]).optional().nullable(),
  discrepancyNote: z.string().max(500).optional(),
});

export const receiveItemsSchema = z.object({
  items: z.array(z.object({
    itemId: z.string().uuid(),
    receivedQuantity: z.number().int().min(0),
    discrepancyReason: z.enum([
      "damaged", "missing", "wrong_item", "over_delivery", "other",
    ]).optional().nullable(),
    discrepancyNote: z.string().max(500).optional(),
  })),
});

// ── Transfer Order CRUD ─────────────────────────────────────

/**
 * Create a new transfer order in draft state.
 * Items can be added now or incrementally via addItem().
 */
export async function createTransferOrder(
  data: z.infer<typeof createTransferOrderSchema>,
  userId: string
) {
  const parsed = createTransferOrderSchema.parse(data);

  if (parsed.fromWarehouseId === parsed.toWarehouseId) {
    throw new Error("Source and destination warehouses must be different");
  }

  // Validate warehouses exist
  const [fromWh, toWh] = await Promise.all([
    db.query.warehouses.findFirst({ where: eq(warehouses.id, parsed.fromWarehouseId) }),
    db.query.warehouses.findFirst({ where: eq(warehouses.id, parsed.toWarehouseId) }),
  ]);
  if (!fromWh) throw new NotFoundError("Warehouse", parsed.fromWarehouseId);
  if (!toWh) throw new NotFoundError("Warehouse", parsed.toWarehouseId);

  // Validate products exist
  const productIds = parsed.items.map((i) => i.productId);
  const foundProducts = await db.query.products.findMany({
    where: inArray(products.id, productIds),
    columns: { id: true, name: true },
  });
  const foundSet = new Set(foundProducts.map((p) => p.id));
  for (const pid of productIds) {
    if (!foundSet.has(pid)) throw new NotFoundError("Product", pid);
  }

  const result = await db.transaction(async (tx) => {
    const [order] = await tx
      .insert(transferOrders)
      .values({
        fromWarehouseId: parsed.fromWarehouseId,
        toWarehouseId: parsed.toWarehouseId,
        status: "draft",
        acceptanceMode: parsed.acceptanceMode ?? null,
        initiatedBy: userId,
        notes: parsed.notes ?? null,
      })
      .returning();

    const itemValues = parsed.items.map((item) => ({
      transferOrderId: order.id,
      productId: item.productId,
      expectedQuantity: item.quantity,
      dispatchedQuantity: item.quantity,
    }));

    const items = await tx
      .insert(transferOrderItems)
      .values(itemValues)
      .returning();

    return { ...order, items };
  });

  return result;
}

/** Get a transfer order with all items and product details */
export async function getTransferOrder(id: string) {
  const order = await db.query.transferOrders.findFirst({
    where: eq(transferOrders.id, id),
    with: {
      fromWarehouse: true,
      toWarehouse: true,
      initiator: { columns: { id: true, name: true, email: true, role: true } },
      receiver: { columns: { id: true, name: true, email: true, role: true } },
      items: {
        with: {
          product: { columns: { id: true, name: true, sku: true, barcode: true, unit: true } },
        },
      },
    },
  });

  if (!order) throw new NotFoundError("Transfer Order", id);
  return order;
}

/** List transfer orders with filters */
export async function listTransferOrders(filters?: {
  status?: string;
  fromWarehouseId?: string;
  toWarehouseId?: string;
  limit?: number;
  offset?: number;
}) {
  const conditions: Array<ReturnType<typeof eq>> = [];
  if (filters?.status) conditions.push(eq(transferOrders.status, filters.status));
  if (filters?.fromWarehouseId) conditions.push(eq(transferOrders.fromWarehouseId, filters.fromWarehouseId));
  if (filters?.toWarehouseId) conditions.push(eq(transferOrders.toWarehouseId, filters.toWarehouseId));

  const limit = Math.min(filters?.limit ?? 50, 200);
  const offset = filters?.offset ?? 0;

  const orders = await db.query.transferOrders.findMany({
    where: conditions.length > 0 ? and(...conditions) : undefined,
    with: {
      fromWarehouse: { columns: { id: true, name: true, code: true } },
      toWarehouse: { columns: { id: true, name: true, code: true } },
      initiator: { columns: { id: true, name: true } },
      items: {
        with: {
          product: { columns: { id: true, name: true, sku: true, barcode: true, unit: true } },
        },
      },
    },
    orderBy: [desc(transferOrders.createdAt)],
    limit,
    offset,
  });

  return { orders, limit, offset };
}

/** Add an item to a draft transfer order */
export async function addTransferItem(
  orderId: string,
  data: z.infer<typeof addTransferItemSchema>
) {
  const parsed = addTransferItemSchema.parse(data);

  const order = await db.query.transferOrders.findFirst({
    where: eq(transferOrders.id, orderId),
  });
  if (!order) throw new NotFoundError("Transfer Order", orderId);
  if (order.status !== "draft") {
    throw new Error(`Cannot add items to a transfer order in "${order.status}" status`);
  }

  // Check if this product already exists in the order
  const existingItem = await db.query.transferOrderItems.findFirst({
    where: and(
      eq(transferOrderItems.transferOrderId, orderId),
      eq(transferOrderItems.productId, parsed.productId)
    ),
  });

  if (existingItem) {
    // Increment quantity
    const [updated] = await db
      .update(transferOrderItems)
      .set({
        expectedQuantity: sql`${transferOrderItems.expectedQuantity} + ${parsed.quantity}`,
        dispatchedQuantity: sql`${transferOrderItems.dispatchedQuantity} + ${parsed.quantity}`,
      })
      .where(eq(transferOrderItems.id, existingItem.id))
      .returning();
    return updated;
  }

  // New item
  const product = await db.query.products.findFirst({
    where: eq(products.id, parsed.productId),
    columns: { id: true },
  });
  if (!product) throw new NotFoundError("Product", parsed.productId);

  const [item] = await db
    .insert(transferOrderItems)
    .values({
      transferOrderId: orderId,
      productId: parsed.productId,
      expectedQuantity: parsed.quantity,
      dispatchedQuantity: parsed.quantity,
    })
    .returning();

  return item;
}

/** Remove an item from a draft transfer order */
export async function removeTransferItem(orderId: string, itemId: string) {
  const order = await db.query.transferOrders.findFirst({
    where: eq(transferOrders.id, orderId),
  });
  if (!order) throw new NotFoundError("Transfer Order", orderId);
  if (order.status !== "draft") {
    throw new Error(`Cannot remove items from a transfer order in "${order.status}" status`);
  }

  const [deleted] = await db
    .delete(transferOrderItems)
    .where(
      and(
        eq(transferOrderItems.id, itemId),
        eq(transferOrderItems.transferOrderId, orderId)
      )
    )
    .returning({ id: transferOrderItems.id });

  if (!deleted) throw new NotFoundError("Transfer Order Item", itemId);
  return deleted;
}

// ── Dispatch ────────────────────────────────────────────────

/**
 * Dispatch a transfer order.
 * Deducts stock from the source warehouse for each item and
 * records transfer_out transactions. Status moves to in_transit.
 */
export async function dispatchTransferOrder(
  orderId: string,
  userId: string
) {
  const order = await db.query.transferOrders.findFirst({
    where: eq(transferOrders.id, orderId),
    with: { items: true },
  });

  if (!order) throw new NotFoundError("Transfer Order", orderId);
  if (order.status !== "draft") {
    throw new Error(`Cannot dispatch a transfer order in "${order.status}" status`);
  }
  if (order.items.length === 0) {
    throw new Error("Cannot dispatch a transfer order with no items");
  }

  // Validate sufficient stock for all items
  for (const item of order.items) {
    const stock = await db.query.inventory.findFirst({
      where: and(
        eq(inventory.productId, item.productId),
        eq(inventory.warehouseId, order.fromWarehouseId)
      ),
    });
    const available = stock?.quantity ?? 0;
    if (available < item.dispatchedQuantity) {
      throw new InsufficientStockError(
        item.productId,
        item.dispatchedQuantity,
        available
      );
    }
  }

  // Deduct stock + record transactions in a transaction
  await db.transaction(async (tx) => {
    for (const item of order.items) {
      // Deduct from source
      await tx
        .update(inventory)
        .set({
          quantity: sql`${inventory.quantity} - ${item.dispatchedQuantity}`,
        })
        .where(
          and(
            eq(inventory.productId, item.productId),
            eq(inventory.warehouseId, order.fromWarehouseId)
          )
        );

      // Record transaction
      await tx.insert(inventoryTransactions).values({
        productId: item.productId,
        warehouseId: order.fromWarehouseId,
        type: "transfer_out",
        quantity: -item.dispatchedQuantity,
        referenceType: "transfer",
        referenceId: order.id,
        notes: `Transfer dispatch to warehouse`,
        performedBy: userId,
      });
    }

    // Update order status
    await tx
      .update(transferOrders)
      .set({
        status: "in_transit",
        dispatchedAt: new Date(),
      })
      .where(eq(transferOrders.id, orderId));
  });

  return getTransferOrder(orderId);
}

// ── Receive / Accept ────────────────────────────────────────

/**
 * Receive a single item from a transfer order.
 * Used in scan-to-accept mode (one barcode at a time) or manual entry.
 */
export async function receiveTransferItem(
  orderId: string,
  itemId: string,
  data: z.infer<typeof receiveItemSchema>,
  userId: string
) {
  const parsed = receiveItemSchema.parse(data);

  const order = await db.query.transferOrders.findFirst({
    where: eq(transferOrders.id, orderId),
  });
  if (!order) throw new NotFoundError("Transfer Order", orderId);
  if (order.status !== "in_transit" && order.status !== "received") {
    throw new Error(`Cannot receive items for a transfer in "${order.status}" status`);
  }

  const [item] = await db
    .update(transferOrderItems)
    .set({
      receivedQuantity: parsed.receivedQuantity,
      discrepancyReason: parsed.discrepancyReason ?? null,
      discrepancyNote: parsed.discrepancyNote ?? null,
      acceptedAt: new Date(),
      acceptedBy: userId,
    })
    .where(
      and(
        eq(transferOrderItems.id, itemId),
        eq(transferOrderItems.transferOrderId, orderId)
      )
    )
    .returning();

  if (!item) throw new NotFoundError("Transfer Order Item", itemId);
  return item;
}

/**
 * Receive a batch of items by barcode scan.
 * For each barcode, matches against item in the transfer order and
 * increments the receivedQuantity.
 */
export async function receiveTransferByBarcode(
  orderId: string,
  barcode: string,
  quantity: number,
  userId: string
) {
  const order = await db.query.transferOrders.findFirst({
    where: eq(transferOrders.id, orderId),
    with: {
      items: {
        with: {
          product: { columns: { id: true, barcode: true, name: true } },
        },
      },
    },
  });

  if (!order) throw new NotFoundError("Transfer Order", orderId);
  if (order.status !== "in_transit" && order.status !== "received") {
    throw new Error(`Cannot receive items for a transfer in "${order.status}" status`);
  }

  // Find the item matching this barcode
  const matchedItem = order.items.find(
    (i) => i.product?.barcode === barcode
  );

  if (!matchedItem) {
    return {
      success: false,
      error: `Barcode "${barcode}" is not in this transfer order`,
      errorCode: "BARCODE_NOT_IN_TRANSFER",
    };
  }

  // Increment receivedQuantity (supports incremental scanning)
  const currentReceived = matchedItem.receivedQuantity ?? 0;
  const newReceived = currentReceived + quantity;

  await db
    .update(transferOrderItems)
    .set({
      receivedQuantity: newReceived,
      acceptedAt: new Date(),
      acceptedBy: userId,
    })
    .where(eq(transferOrderItems.id, matchedItem.id));

  return {
    success: true,
    itemId: matchedItem.id,
    productId: matchedItem.productId,
    productName: matchedItem.product?.name ?? "",
    expectedQuantity: matchedItem.expectedQuantity,
    receivedQuantity: newReceived,
    remaining: Math.max(0, matchedItem.expectedQuantity - newReceived),
  };
}

/**
 * Receive all items in a batch (manual count mode).
 */
export async function receiveTransferItems(
  orderId: string,
  data: z.infer<typeof receiveItemsSchema>,
  userId: string
) {
  const parsed = receiveItemsSchema.parse(data);

  const order = await db.query.transferOrders.findFirst({
    where: eq(transferOrders.id, orderId),
  });
  if (!order) throw new NotFoundError("Transfer Order", orderId);
  if (order.status !== "in_transit" && order.status !== "received") {
    throw new Error(`Cannot receive items for a transfer in "${order.status}" status`);
  }

  const results = [];
  for (const item of parsed.items) {
    const [updated] = await db
      .update(transferOrderItems)
      .set({
        receivedQuantity: item.receivedQuantity,
        discrepancyReason: item.discrepancyReason ?? null,
        discrepancyNote: item.discrepancyNote ?? null,
        acceptedAt: new Date(),
        acceptedBy: userId,
      })
      .where(
        and(
          eq(transferOrderItems.id, item.itemId),
          eq(transferOrderItems.transferOrderId, orderId)
        )
      )
      .returning();

    if (updated) results.push(updated);
  }

  return results;
}

// ── Complete Transfer ───────────────────────────────────────

/**
 * Complete a transfer order.
 * Credits destination warehouse stock for received quantities.
 * Detects discrepancies (received ≠ expected) and sets final status.
 *
 * Only items with receivedQuantity set will be credited.
 * Must be called after all items have been received (scan or manual).
 */
export async function completeTransferOrder(
  orderId: string,
  userId: string
) {
  const order = await db.query.transferOrders.findFirst({
    where: eq(transferOrders.id, orderId),
    with: {
      items: {
        with: {
          product: { columns: { id: true, name: true, unit: true } },
        },
      },
    },
  });

  if (!order) throw new NotFoundError("Transfer Order", orderId);
  if (order.status !== "in_transit" && order.status !== "received") {
    throw new Error(`Cannot complete a transfer order in "${order.status}" status`);
  }

  // Check that all items have been processed
  const unreceived = order.items.filter((i) => i.receivedQuantity === null);
  if (unreceived.length > 0) {
    throw new Error(
      `${unreceived.length} item(s) have not been received yet. ` +
      `Receive all items before completing, or set receivedQuantity to 0 for missing items.`
    );
  }

  // Detect discrepancies
  let hasDiscrepancy = false;
  for (const item of order.items) {
    if (item.receivedQuantity !== item.expectedQuantity) {
      hasDiscrepancy = true;
      // Auto-set discrepancy reason if not already set
      if (!item.discrepancyReason && item.receivedQuantity !== null) {
        const reason = item.receivedQuantity < item.expectedQuantity
          ? "missing"
          : "over_delivery";
        await db
          .update(transferOrderItems)
          .set({ discrepancyReason: reason })
          .where(eq(transferOrderItems.id, item.id));
      }
    }
  }

  // Credit destination stock + record transactions
  await db.transaction(async (tx) => {
    for (const item of order.items) {
      const receivedQty = item.receivedQuantity ?? 0;
      if (receivedQty <= 0) continue;

      // Upsert destination inventory
      const destStock = await tx.query.inventory.findFirst({
        where: and(
          eq(inventory.productId, item.productId),
          eq(inventory.warehouseId, order.toWarehouseId)
        ),
      });

      if (destStock) {
        await tx
          .update(inventory)
          .set({
            quantity: sql`${inventory.quantity} + ${receivedQty}`,
          })
          .where(eq(inventory.id, destStock.id));
      } else {
        await tx.insert(inventory).values({
          productId: item.productId,
          warehouseId: order.toWarehouseId,
          quantity: receivedQty,
        });
      }

      // Record transfer_in transaction
      await tx.insert(inventoryTransactions).values({
        productId: item.productId,
        warehouseId: order.toWarehouseId,
        type: "transfer_in",
        quantity: receivedQty,
        referenceType: "transfer",
        referenceId: order.id,
        notes: `Transfer received from warehouse`,
        performedBy: userId,
      });
    }

    // Update order status
    const finalStatus = hasDiscrepancy
      ? "completed_with_discrepancy"
      : "received";

    await tx
      .update(transferOrders)
      .set({
        status: finalStatus,
        receivedBy: userId,
        receivedAt: new Date(),
      })
      .where(eq(transferOrders.id, orderId));
  });

  return getTransferOrder(orderId);
}

// ── Cancel Draft ────────────────────────────────────────────

/** Cancel a draft transfer order (no stock was deducted) */
export async function cancelTransferOrder(orderId: string) {
  const order = await db.query.transferOrders.findFirst({
    where: eq(transferOrders.id, orderId),
  });
  if (!order) throw new NotFoundError("Transfer Order", orderId);
  if (order.status !== "draft") {
    throw new Error(
      `Cannot cancel a transfer order in "${order.status}" status. ` +
      `Only draft orders can be cancelled.`
    );
  }

  // Delete items (cascade) and order
  await db.delete(transferOrderItems).where(
    eq(transferOrderItems.transferOrderId, orderId)
  );
  const [deleted] = await db
    .delete(transferOrders)
    .where(eq(transferOrders.id, orderId))
    .returning({ id: transferOrders.id });

  return deleted;
}

// ── Transfer Summary Stats ──────────────────────────────────

/** Get summary stats for transfer orders (for dashboard) */
export async function getTransferStats() {
  const stats = await db
    .select({
      status: transferOrders.status,
      count: sql<number>`count(*)::int`,
    })
    .from(transferOrders)
    .groupBy(transferOrders.status);

  const result: Record<string, number> = {};
  for (const row of stats) {
    result[row.status] = row.count;
  }

  return {
    draft: result.draft ?? 0,
    inTransit: result.in_transit ?? 0,
    received: result.received ?? 0,
    completedWithDiscrepancy: result.completed_with_discrepancy ?? 0,
    total: Object.values(result).reduce((sum, v) => sum + v, 0),
  };
}
