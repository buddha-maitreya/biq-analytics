/**
 * Data Science Agent -- Database query tools
 *
 * queryDatabaseTool: Direct SQL execution for ad-hoc data lookups
 * getBusinessSnapshotTool: Quick business overview (totals, low stock, recent orders)
 *
 * Phase 6.1: Snapshot logic delegated to admin service for service-layer consistency.
 */

import { tool } from "ai";
import { z } from "zod";
import { db } from "@db/index";
import { dbRows, sanitizeRows } from "@db/rows";
import { sql } from "drizzle-orm";
import { validateReadOnlySQL } from "@lib/sql-safety";
import { createCache, CACHE_NS, CACHE_TTL, queryKey, type KVStore } from "@lib/cache";
import { getBusinessSnapshot } from "@services/admin";

export const queryDatabaseTool = tool({
  description: `Execute a read-only SQL query against the business database to answer data questions.
IMPORTANT: The database is PostgreSQL (NOT MySQL). You MUST use PostgreSQL syntax:
- Date math: NOW() - INTERVAL '30 days' (NOT DATE_SUB or DATE_ADD)
- String concat: || (NOT CONCAT())
- Boolean: TRUE/FALSE (NOT 1/0)
- ILIKE for case-insensitive LIKE
- EXTRACT(MONTH FROM date) or date_trunc('month', date)
- LIMIT/OFFSET (no LIMIT x,y syntax)
- Type casting: column::text or CAST(column AS text)
- String agg: STRING_AGG(col, ',') (NOT GROUP_CONCAT)
- Current date: CURRENT_DATE, CURRENT_TIMESTAMP, NOW()
Available tables: products, categories, warehouses, inventory, inventory_transactions, customers, orders, order_items, order_statuses, invoices, payments, users, notifications, tax_rules, asset_categories, assets, service_categories, services, service_bookings, booking_assets, booking_stock_allocations.
Key columns: products(id, sku, name, price, cost_price, unit, category_id, is_active, is_consumable, is_sellable), orders(id, order_number, customer_id, status_id, total_amount, created_at), order_items(order_id, item_type, product_id, service_id, description, quantity, unit_price, total_amount, start_date, end_date), inventory(product_id, warehouse_id, quantity), customers(id, name, email, phone), invoices(id, invoice_number, total_amount, paid_amount, status), assets(id, asset_code, name, category_id, condition_status, location, assigned_to_staff_id, is_active), services(id, service_code, name, category_id, base_price, pricing_model, capacity_limit, requires_asset, requires_stock), service_bookings(id, order_item_id, service_date, start_time, end_time, status, assigned_guide_id, assigned_vehicle_id).

CRITICAL PATTERNS:
- orders does NOT have a 'status' column. Order status is in order_statuses table. To filter by status: JOIN order_statuses os ON o.status_id = os.id WHERE os.name = 'completed'
- order_statuses.name values: pending, confirmed, processing, shipped, delivered, completed, cancelled, refunded
- For revenue: SUM(o.total_amount) from orders o JOIN order_statuses os ON o.status_id = os.id WHERE os.name IN ('completed','delivered','shipped') AND o.created_at >= date
- For date filtering: use orders.created_at, NEVER order_items.start_date (that is for service bookings only)
- invoices.status values: draft, sent, paid, overdue, cancelled
- payments tracks actual payments against invoices

Always use SELECT only. Use aggregations, JOINs, and GROUP BY as needed.`,
  parameters: z.object({
    query: z.string().describe("SQL SELECT query to execute"),
    explanation: z
      .string()
      .describe("What this query does in plain English"),
  }),
  execute: async ({ query, explanation }) => {
    const validation = validateReadOnlySQL(query);
    if (!validation.safe) {
      return { error: validation.reason, rows: [], rowCount: 0 };
    }

    try {
      const result = await db.execute(sql.raw(query));
      const rows = sanitizeRows(dbRows(result));
      return {
        explanation,
        rows: rows.slice(0, 100),
        rowCount: rows.length,
        truncated: rows.length > 100,
      };
    } catch (err: any) {
      return {
        error: `Query failed: ${err.message}`,
        rows: [],
        rowCount: 0,
      };
    }
  },
});

export const getBusinessSnapshotTool = tool({
  description:
    "Get a quick overview of the business state: total products, orders, customers, revenue, low stock items, recent orders. Use when users ask general questions like 'how is the business doing?' or 'give me an overview'.",
  parameters: z.object({
    includeRecentOrders: z
      .boolean()
      .default(true)
      .describe("Include the 5 most recent orders"),
    includeLowStock: z
      .boolean()
      .default(true)
      .describe("Include low stock alerts"),
  }),
  execute: async ({ includeRecentOrders, includeLowStock }) => {
    return getBusinessSnapshot({ includeRecentOrders, includeLowStock });
  },
});

/**
 * Create a cached version of the business snapshot tool.
 * When a KV store is available (from agent ctx), results are cached
 * for 60 seconds to avoid redundant aggregate queries.
 */
export function createCachedSnapshotTool(kv: KVStore) {
  const cache = createCache(kv);

  return tool({
    description:
      "Get a quick overview of the business state: total products, orders, customers, revenue, low stock items, recent orders. Use when users ask general questions like 'how is the business doing?' or 'give me an overview'.",
    parameters: z.object({
      includeRecentOrders: z
        .boolean()
        .default(true)
        .describe("Include the 5 most recent orders"),
      includeLowStock: z
        .boolean()
        .default(true)
        .describe("Include low stock alerts"),
    }),
    execute: async ({ includeRecentOrders, includeLowStock }) => {
      const key = queryKey("snapshot", String(includeRecentOrders), String(includeLowStock));
      return cache.getOrSet(
        CACHE_NS.QUERY,
        key,
        () => getBusinessSnapshot({ includeRecentOrders, includeLowStock }),
        { ttl: CACHE_TTL.SHORT }
      );
    },
  });
}
