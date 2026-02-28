/**
 * POS Stock & Catalog Service — bidirectional sync support.
 *
 * - Stock query: external POS systems query our stock levels for display
 * - Catalog push: when products change, push updates to POS vendor webhooks
 */

import { db, products, inventory, warehouses, posVendorConfigs } from "@db/index";
import { eq, and, inArray } from "drizzle-orm";

// ── Types ───────────────────────────────────────────────────

export interface StockLevel {
  productId: string;
  sku: string;
  barcode: string | null;
  name: string;
  unit: string;
  price: string;
  quantity: number;
  reservedQuantity: number;
  reorderPoint: number;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
}

export interface CatalogItem {
  productId: string;
  sku: string;
  barcode: string | null;
  name: string;
  description: string | null;
  unit: string;
  price: string;
  costPrice: string | null;
  categoryId: string | null;
  isActive: boolean;
  imageUrl: string | null;
}

export interface CatalogPushResult {
  vendor: string;
  success: boolean;
  itemsPushed: number;
  error?: string;
}

// ── Stock Query ─────────────────────────────────────────────

/**
 * Query current stock levels for one or all products in a warehouse.
 */
export async function queryStock(options: {
  sku?: string;
  barcode?: string;
  warehouseCode?: string;
  warehouseId?: string;
}): Promise<StockLevel[]> {
  // Resolve warehouse
  let warehouseId = options.warehouseId;
  if (!warehouseId && options.warehouseCode) {
    const wh = await db.query.warehouses.findFirst({
      where: eq(warehouses.code, options.warehouseCode),
    });
    warehouseId = wh?.id;
  }
  if (!warehouseId) {
    const defaultWh = await db.query.warehouses.findFirst({
      where: eq(warehouses.isDefault, true),
    });
    warehouseId = defaultWh?.id;
  }
  if (!warehouseId) return [];

  // Get warehouse info
  const wh = await db.query.warehouses.findFirst({
    where: eq(warehouses.id, warehouseId),
  });
  if (!wh) return [];

  // Build product filter
  let product = null;
  if (options.sku) {
    product = await db.query.products.findFirst({
      where: eq(products.sku, options.sku),
    });
    if (!product) return [];
  } else if (options.barcode) {
    product = await db.query.products.findFirst({
      where: eq(products.barcode, options.barcode),
    });
    if (!product) return [];
  }

  // Query inventory
  const conditions = [eq(inventory.warehouseId, warehouseId)];
  if (product) {
    conditions.push(eq(inventory.productId, product.id));
  }

  const stockRows = await db.query.inventory.findMany({
    where: and(...conditions),
    with: {
      product: true,
    },
  });

  return stockRows.map((row) => ({
    productId: row.productId,
    sku: row.product.sku,
    barcode: row.product.barcode,
    name: row.product.name,
    unit: row.product.unit,
    price: row.product.price,
    quantity: row.quantity,
    reservedQuantity: row.reservedQuantity ?? 0,
    reorderPoint: row.product.reorderPoint ?? 0,
    warehouseId: wh.id,
    warehouseCode: wh.code,
    warehouseName: wh.name,
  }));
}

// ── Catalog Query ───────────────────────────────────────────

/**
 * Get the full product catalog (active products only).
 */
export async function getCatalog(): Promise<CatalogItem[]> {
  const allProducts = await db.query.products.findMany({
    where: eq(products.isActive, true),
  });

  return allProducts.map((p) => ({
    productId: p.id,
    sku: p.sku,
    barcode: p.barcode,
    name: p.name,
    description: p.description,
    unit: p.unit,
    price: p.price,
    costPrice: p.costPrice,
    categoryId: p.categoryId,
    isActive: p.isActive,
    imageUrl: p.imageUrl,
  }));
}

// ── Catalog Push ────────────────────────────────────────────

/**
 * Push current catalog to all active POS vendors that have a webhook URL configured.
 */
export async function pushCatalog(): Promise<CatalogPushResult[]> {
  const catalog = await getCatalog();
  if (catalog.length === 0) return [];

  // Get all active vendor configs with webhook URLs
  const vendors = await db.query.posVendorConfigs.findMany({
    where: and(
      eq(posVendorConfigs.isActive, true),
    ),
  });

  const results: CatalogPushResult[] = [];

  for (const vendor of vendors) {
    if (!vendor.webhookUrl) {
      results.push({
        vendor: vendor.vendor,
        success: false,
        itemsPushed: 0,
        error: "No webhook URL configured",
      });
      continue;
    }

    try {
      const response = await fetch(vendor.webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(vendor.authType === "bearer" && vendor.authSecret
            ? { Authorization: `Bearer ${vendor.authSecret}` }
            : {}),
        },
        body: JSON.stringify({
          type: "catalog_update",
          timestamp: new Date().toISOString(),
          items: catalog,
          total: catalog.length,
        }),
      });

      results.push({
        vendor: vendor.vendor,
        success: response.ok,
        itemsPushed: response.ok ? catalog.length : 0,
        error: response.ok ? undefined : `HTTP ${response.status}: ${response.statusText}`,
      });
    } catch (err) {
      results.push({
        vendor: vendor.vendor,
        success: false,
        itemsPushed: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}
