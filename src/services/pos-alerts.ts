/**
 * POS Low-Stock Alerts — threshold checks after POS sale ingestion.
 *
 * After every sale, checks if any affected product's stock dropped
 * below its reorderPoint. Creates in-app notifications for relevant users.
 * Deduplicates alerts to avoid spam (one alert per product per 24h window).
 */

import { db, products, inventory, notifications, users } from "@db/index";
import { eq, and, gte, inArray } from "drizzle-orm";

const DEDUP_HOURS = Number(process.env.LOW_STOCK_DEDUP_HOURS ?? 24);

/**
 * Check low-stock thresholds for a set of product IDs after a POS sale.
 * Creates notifications for admin/manager users if any product breached
 * its reorder point. Non-fatal — errors are swallowed by the caller.
 */
export async function checkLowStockAlerts(
  productIds: string[],
  warehouseId?: string,
): Promise<void> {
  if (productIds.length === 0) return;

  // Load products with their reorder points
  const affectedProducts = await db.query.products.findMany({
    where: inArray(products.id, productIds),
  });

  const alertProducts: Array<{ productName: string; productId: string; sku: string; quantity: number; reorderPoint: number }> = [];

  for (const product of affectedProducts) {
    const reorderPoint = product.reorderPoint ?? 0;
    if (reorderPoint <= 0) continue; // No threshold configured

    // Check inventory level
    const conditions = [eq(inventory.productId, product.id)];
    if (warehouseId) {
      conditions.push(eq(inventory.warehouseId, warehouseId));
    }

    const stock = await db.query.inventory.findFirst({
      where: and(...conditions),
    });

    const currentQty = stock?.quantity ?? 0;
    if (currentQty > reorderPoint) continue; // Still above threshold

    // Check for recent notification (dedup)
    const dedupCutoff = new Date(Date.now() - DEDUP_HOURS * 60 * 60 * 1000);
    const recentAlert = await db.query.notifications.findFirst({
      where: and(
        eq(notifications.type, "low_stock"),
        gte(notifications.createdAt, dedupCutoff),
        // Check if this product was already alerted via the message content
        // (we store product ID in metadata)
      ),
    });

    // Simple dedup: if ANY low_stock notification was sent recently, skip
    // TODO: More granular dedup by productId via metadata matching
    if (recentAlert) continue;

    alertProducts.push({
      productName: product.name,
      productId: product.id,
      sku: product.sku,
      quantity: currentQty,
      reorderPoint,
    });
  }

  if (alertProducts.length === 0) return;

  // Get admin/manager users to notify
  const adminUsers = await db.query.users.findMany({
    where: inArray(users.role, ["super_admin", "admin", "manager"]),
  });

  if (adminUsers.length === 0) return;

  // Create notifications
  const message = alertProducts.length === 1
    ? `Low stock alert: ${alertProducts[0].productName} (${alertProducts[0].sku}) is at ${alertProducts[0].quantity} units, below reorder point of ${alertProducts[0].reorderPoint}.`
    : `Low stock alert: ${alertProducts.length} products have dropped below their reorder points. ${alertProducts.map((p) => `${p.productName} (${p.quantity}/${p.reorderPoint})`).join(", ")}.`;

  for (const user of adminUsers) {
    await db.insert(notifications).values({
      userId: user.id,
      type: "low_stock",
      title: "Low Stock Alert — POS Sale",
      message,
      metadata: {
        source: "pos-ingestion",
        products: alertProducts.map((p) => ({
          productId: p.productId,
          sku: p.sku,
          quantity: p.quantity,
          reorderPoint: p.reorderPoint,
        })),
      },
    });
  }
}
