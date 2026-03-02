import { db } from "@db/index";
import { sql } from "drizzle-orm";
import { dbRows } from "@db/rows";

async function check() {
  console.log("=== Analytics Data Inventory ===\n");

  // Core table counts
  const tables = [
    "SELECT 'products' as t, COUNT(*)::int as cnt FROM products WHERE is_active = true",
    "SELECT 'inventory' as t, COUNT(*)::int as cnt FROM inventory",
    "SELECT 'sales' as t, COUNT(*)::int as cnt FROM sales",
    "SELECT 'orders' as t, COUNT(*)::int as cnt FROM orders",
    "SELECT 'order_items' as t, COUNT(*)::int as cnt FROM order_items",
    "SELECT 'customers' as t, COUNT(*)::int as cnt FROM customers",
  ];
  for (const q of tables) {
    try {
      const r = dbRows(await db.execute(sql.raw(q)));
      console.log(`  ${r[0]?.t}: ${r[0]?.cnt} rows`);
    } catch (e: any) {
      console.log(`  ERROR: ${e.message?.slice(0, 80)}`);
    }
  }

  // Sales date range
  try {
    const r = dbRows(await db.execute(sql`SELECT MIN(sale_date)::text as mn, MAX(sale_date)::text as mx FROM sales`));
    console.log(`\n  Sales date range: ${r[0]?.mn} → ${r[0]?.mx}`);
  } catch { console.log("\n  Sales date range: ERROR"); }

  // Sales with customer_id (needed for RFM, CLV)
  try {
    const r = dbRows(await db.execute(sql`SELECT COUNT(*)::int as cnt FROM sales WHERE customer_id IS NOT NULL`));
    console.log(`  Sales with customer_id: ${r[0]?.cnt}`);
  } catch { console.log("  customer_id: ERROR"); }

  // Sales with product_id (needed for ABC-XYZ)
  try {
    const r = dbRows(await db.execute(sql`SELECT COUNT(*)::int as cnt FROM sales WHERE product_id IS NOT NULL`));
    console.log(`  Sales with product_id: ${r[0]?.cnt}`);
  } catch { console.log("  product_id: ERROR"); }

  // Customers with >= 2 transactions (needed for CLV)
  try {
    const r = dbRows(await db.execute(sql`
      SELECT COUNT(*)::int as cnt FROM (
        SELECT customer_id FROM sales WHERE customer_id IS NOT NULL
        GROUP BY customer_id HAVING COUNT(*) >= 2
      ) sub
    `));
    console.log(`  Customers with ≥2 transactions (CLV): ${r[0]?.cnt}`);
  } catch { console.log("  CLV customers: ERROR"); }

  // Order items with product_id (needed for bundles)
  try {
    const r = dbRows(await db.execute(sql`SELECT COUNT(*)::int as cnt FROM order_items WHERE product_id IS NOT NULL`));
    console.log(`  Order items with product_id (bundles): ${r[0]?.cnt}`);
  } catch (e: any) { console.log(`  order_items: ERROR — ${e.message?.slice(0, 80)}`); }

  // Daily sales rows for last 90 days (what forecast.prophet uses)
  try {
    const r = dbRows(await db.execute(sql`
      SELECT COUNT(*)::int as cnt FROM (
        SELECT DATE(sale_date) FROM sales
        WHERE sale_date >= CURRENT_DATE - INTERVAL '90 days'
        GROUP BY DATE(sale_date)
      ) sub
    `));
    console.log(`  Daily sales rows (90d, for forecasts): ${r[0]?.cnt}`);
  } catch { console.log("  daily sales: ERROR"); }

  // POS transactions (needed for value_gap)
  try {
    const r = dbRows(await db.execute(sql`
      SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE pos_vendor = 'mpesa') as mpesa
      FROM pos_transactions
    `));
    console.log(`  POS transactions: ${r[0]?.total} total, ${r[0]?.mpesa} mpesa`);
  } catch (e: any) { console.log(`  pos_transactions: ERROR — ${e.message?.slice(0, 80)}`); }

  // Check what columns exist on sales (warehouse_name needed for geo_map)
  try {
    const r = dbRows(await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'sales' AND table_schema = 'public'
      ORDER BY ordinal_position
    `));
    console.log(`\n  Sales columns: ${r.map(x => x.column_name).join(', ')}`);
  } catch { console.log("\n  Sales columns: ERROR"); }

  console.log("\n=== Done ===");
  process.exit(0);
}

check().catch(e => { console.error(e.message); process.exit(1); });
