import { db, inventory, inventoryTransactions, products } from "@db/index";
import { eq, and, sql, lt, desc, asc } from "drizzle-orm";
import { config } from "@lib/config";
import {
  adjustInventorySchema,
  transferInventorySchema,
} from "@lib/validation";
import { NotFoundError, InsufficientStockError } from "@lib/errors";

/** Adjust stock level (add or remove) */
export async function adjustStock(data: unknown) {
  const parsed = adjustInventorySchema.parse(data);

  // Upsert inventory record
  const existing = await db.query.inventory.findFirst({
    where: and(
      eq(inventory.productId, parsed.productId),
      eq(inventory.warehouseId, parsed.warehouseId)
    ),
  });

  if (existing) {
    const newQty = existing.quantity + parsed.quantity;
    if (newQty < 0) {
      throw new InsufficientStockError(
        parsed.productId,
        Math.abs(parsed.quantity),
        existing.quantity
      );
    }

    await db
      .update(inventory)
      .set({ quantity: newQty })
      .where(eq(inventory.id, existing.id));
  } else {
    if (parsed.quantity < 0) {
      throw new InsufficientStockError(
        parsed.productId,
        Math.abs(parsed.quantity),
        0
      );
    }

    await db.insert(inventory).values({
      productId: parsed.productId,
      warehouseId: parsed.warehouseId,
      quantity: parsed.quantity,
    });
  }

  // Record transaction
  const [tx] = await db
    .insert(inventoryTransactions)
    .values({
      productId: parsed.productId,
      warehouseId: parsed.warehouseId,
      type: parsed.type,
      quantity: parsed.quantity,
      notes: parsed.notes,
      metadata: parsed.metadata,
    })
    .returning();

  return tx;
}

/** Transfer stock between warehouses */
export async function transferStock(data: unknown) {
  const parsed = transferInventorySchema.parse(data);

  // Check source stock
  const source = await db.query.inventory.findFirst({
    where: and(
      eq(inventory.productId, parsed.productId),
      eq(inventory.warehouseId, parsed.fromWarehouseId)
    ),
  });

  const available = source?.quantity ?? 0;
  if (available < parsed.quantity) {
    throw new InsufficientStockError(
      parsed.productId,
      parsed.quantity,
      available
    );
  }

  // Deduct from source
  await db
    .update(inventory)
    .set({ quantity: sql`${inventory.quantity} - ${parsed.quantity}` })
    .where(
      and(
        eq(inventory.productId, parsed.productId),
        eq(inventory.warehouseId, parsed.fromWarehouseId)
      )
    );

  // Add to destination (upsert)
  const dest = await db.query.inventory.findFirst({
    where: and(
      eq(inventory.productId, parsed.productId),
      eq(inventory.warehouseId, parsed.toWarehouseId)
    ),
  });

  if (dest) {
    await db
      .update(inventory)
      .set({ quantity: sql`${inventory.quantity} + ${parsed.quantity}` })
      .where(eq(inventory.id, dest.id));
  } else {
    await db.insert(inventory).values({
      productId: parsed.productId,
      warehouseId: parsed.toWarehouseId,
      quantity: parsed.quantity,
    });
  }

  // Record transactions for both sides
  await db.insert(inventoryTransactions).values([
    {
      productId: parsed.productId,
      warehouseId: parsed.fromWarehouseId,
      type: "transfer_out",
      quantity: -parsed.quantity,
      notes: parsed.notes,
    },
    {
      productId: parsed.productId,
      warehouseId: parsed.toWarehouseId,
      type: "transfer_in",
      quantity: parsed.quantity,
      notes: parsed.notes,
    },
  ]);

  return { transferred: parsed.quantity };
}

/** Get stock for a specific product + warehouse */
export async function getStock(productId: string, warehouseId: string) {
  const stock = await db.query.inventory.findFirst({
    where: and(
      eq(inventory.productId, productId),
      eq(inventory.warehouseId, warehouseId)
    ),
    with: { product: true, warehouse: true },
  });
  return stock ?? { productId, warehouseId, quantity: 0, reservedQuantity: 0 };
}

/** List stock levels for a product across all warehouses */
export async function getStockByProduct(productId: string) {
  return db.query.inventory.findMany({
    where: eq(inventory.productId, productId),
    with: { warehouse: true },
  });
}

/** List stock in a warehouse */
export async function getStockByWarehouse(warehouseId: string) {
  return db.query.inventory.findMany({
    where: eq(inventory.warehouseId, warehouseId),
    with: { product: true },
  });
}

/** Get products below their reorder point */
export async function getLowStockProducts(limit = 50) {
  const result = await db
    .select({
      productId: inventory.productId,
      warehouseId: inventory.warehouseId,
      quantity: inventory.quantity,
      productName: products.name,
      sku: products.sku,
      reorderPoint: products.reorderPoint,
      minStockLevel: products.minStockLevel,
    })
    .from(inventory)
    .innerJoin(products, eq(inventory.productId, products.id))
    .where(
      sql`${inventory.quantity} <= COALESCE(${products.reorderPoint}, ${products.minStockLevel}, 0)`
    )
    .orderBy(asc(inventory.quantity))
    .limit(limit);

  return result;
}

/** Get transaction history for a product */
export async function getTransactionHistory(
  productId: string,
  limit = 50
) {
  return db.query.inventoryTransactions.findMany({
    where: eq(inventoryTransactions.productId, productId),
    with: { warehouse: true },
    limit,
    orderBy: [desc(inventoryTransactions.createdAt)],
  });
}
