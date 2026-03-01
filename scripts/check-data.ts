import { db } from "@db/index";
import { sql } from "drizzle-orm";
import { dbRows } from "@db/rows";

async function check() {
  // Basic data checks
  const r1 = dbRows(await db.execute(sql`SELECT count(*) as c FROM products WHERE is_active = true`));
  console.log("Products:", JSON.stringify(r1));

  const r2 = dbRows(await db.execute(sql`SELECT count(*) as c, COALESCE(SUM(quantity), 0) as total_qty FROM inventory`));
  console.log("Inventory:", JSON.stringify(r2));

  // TEST: Does sql.raw() work with db.execute()? This is what the report-generator's fetch_data tool uses.
  console.log("\n--- Testing sql.raw() (report-generator fetch_data path) ---");
  
  const rawQuery1 = "SELECT COUNT(*) as total_products FROM products WHERE is_active = true";
  try {
    const rawResult = await db.execute(sql.raw(rawQuery1));
    const rows = Array.isArray(rawResult) ? rawResult : (rawResult as any).rows ?? [];
    console.log("sql.raw() products:", JSON.stringify(rows));
    console.log("  Array.isArray:", Array.isArray(rawResult));
    console.log("  typeof:", typeof rawResult);
    console.log("  has .rows:", rawResult && typeof rawResult === "object" && "rows" in rawResult);
  } catch (err: any) {
    console.error("sql.raw() FAILED:", err.message);
  }

  const rawQuery2 = `SELECT COUNT(*) as total_products, COALESCE(SUM(i.quantity), 0) as total_units, 
    COUNT(*) FILTER (WHERE i.quantity <= COALESCE(p.reorder_point, p.min_stock_level, 0) AND COALESCE(p.reorder_point, p.min_stock_level, 0) > 0) as low_stock_count,
    COUNT(*) FILTER (WHERE i.quantity = 0) as out_of_stock_count
    FROM inventory i JOIN products p ON p.id = i.product_id WHERE p.is_active = true`;
  try {
    const rawResult2 = await db.execute(sql.raw(rawQuery2));
    const rows2 = Array.isArray(rawResult2) ? rawResult2 : (rawResult2 as any).rows ?? [];
    console.log("sql.raw() inventory health:", JSON.stringify(rows2));
  } catch (err: any) {
    console.error("sql.raw() inventory FAILED:", err.message);
  }

  process.exit(0);
}

check().catch(e => { console.error(e.message); process.exit(1); });
