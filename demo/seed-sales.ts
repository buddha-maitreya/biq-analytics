/**
 * Seed Script — Generate Sales from CSV Product Data
 *
 * Reads demo/data/ruskins_safaris_curio_shop.csv and generates
 * realistic sales records in KES (USD × 128 conversion rate).
 *
 * Each CSV product generates 1–5 sale transactions spread over
 * the last 180 days, assigned to retail branches (MAIN, MSA, LODGE).
 *
 * Prerequisites: Database must have schema migrated + warehouses seeded.
 *   Run: bunx drizzle-kit migrate
 *   Run: DATABASE_URL=<url> bun demo/seed-csv-data.ts  (if not already done)
 *
 * Usage:
 *   DATABASE_URL=<url> bun demo/seed-sales.ts
 */

import { createPostgresDrizzle } from "@agentuity/drizzle";
import { sql } from "drizzle-orm";
import { readFileSync } from "fs";
import { join } from "path";
import * as schema from "../src/db/schema";
import { sales, warehouses, products } from "../src/db/schema";

// ────────────────────────────────────────────────────────────
// Config
// ────────────────────────────────────────────────────────────
const USD_TO_KES = 128;
const CURRENCY = "KES";

// ────────────────────────────────────────────────────────────
// Database
// ────────────────────────────────────────────────────────────
const { db, close } = createPostgresDrizzle({ schema });

// ────────────────────────────────────────────────────────────
// CSV Parser
// ────────────────────────────────────────────────────────────
function parseCSV(filePath: string): Record<string, string>[] {
  const raw = readFileSync(filePath, "utf-8");
  const lines = raw.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j].trim()] = (values[j] ?? "").trim();
    }
    rows.push(row);
  }
  return rows;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────
function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Generate a random date within the last `days` days */
function randomDate(days: number): Date {
  const now = Date.now();
  const offset = Math.random() * days * 24 * 60 * 60 * 1000;
  return new Date(now - offset);
}

/** Round number to 2 decimal places */
function round2(n: number): string {
  return n.toFixed(2);
}

// ────────────────────────────────────────────────────────────
// Sales-specific data
// ────────────────────────────────────────────────────────────

const PAYMENT_METHODS = ["M-Pesa", "Cash", "Card", "Bank Transfer"];
const PAYMENT_WEIGHTS = [0.40, 0.30, 0.20, 0.10]; // cumulative: 40% mpesa, 30% cash, 20% card, 10% bank

function weightedPaymentMethod(): string {
  const r = Math.random();
  let cumulative = 0;
  for (let i = 0; i < PAYMENT_METHODS.length; i++) {
    cumulative += PAYMENT_WEIGHTS[i];
    if (r < cumulative) return PAYMENT_METHODS[i];
  }
  return PAYMENT_METHODS[0];
}

const CASHIER_NAMES = [
  "Grace Wanjiku",
  "Peter Omondi",
  "Faith Mwangi",
  "James Kariuki",
  "Mercy Atieno",
  "Samuel Kipchoge",
  "Lucy Njeri",
  "Daniel Mutua",
  "Esther Akinyi",
  "Joseph Kamau",
];

const CUSTOMER_NAMES = [
  "Walk-in Customer",
  "Walk-in Customer",
  "Walk-in Customer",   // 3x weight for walk-ins
  "Emma Schmidt",
  "Michael Chen",
  "Sophie Laurent",
  "Takashi Yamamoto",
  "Lisa Anderson",
  "Carlos Rodriguez",
  "Anna Petrov",
  "Robert Williams",
  "Maria Santos",
  "Hans Bergman",
  "Fatima Al-Rashid",
  "Benjamin Clark",
  "Yuki Tanaka",
  "Sarah van der Berg",
  "Aisha Mohammed",
  "Pierre Dubois",
  "Elena Kowalski",
  "David Okafor",
  "Isabella Rossi",
  "Priya Sharma",
];

// ────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────
async function main() {
  console.log("💰 Seeding sales data...\n");

  // Load CSV
  const csvPath = join(import.meta.dir, "data", "ruskins_safaris_curio_shop.csv");
  const csvRows = parseCSV(csvPath);
  console.log(`   📄 Loaded ${csvRows.length} products from CSV`);

  // Load warehouses from DB (retail only — not WH-01 storage)
  const allWarehouses = await db.select().from(warehouses);
  const retailWarehouses = allWarehouses.filter(
    (w) => w.code !== "WH-01" // Exclude storage warehouse
  );

  if (retailWarehouses.length === 0) {
    console.error("   ❌ No retail warehouses found. Run seed-csv-data.ts first.");
    await close();
    process.exit(1);
  }
  console.log(`   🏢 Found ${retailWarehouses.length} retail branches: ${retailWarehouses.map((w) => w.name).join(", ")}`);

  // Load existing products from DB (to get real product IDs)
  const allProducts = await db.select({ id: products.id, sku: products.sku }).from(products);
  const productIdMap = new Map(allProducts.map((p) => [p.sku, p.id]));
  console.log(`   📦 Found ${allProducts.length} products in database`);

  // Clear existing sales
  await db.delete(sales);
  console.log("   🧹 Cleared existing sales data");

  // Generate sales from CSV products
  const saleRows: Array<{
    saleNumber: string;
    productId: string | undefined;
    sku: string;
    productName: string;
    category: string;
    warehouseId: string;
    warehouseName: string;
    customerName: string;
    quantity: number;
    unitPrice: string;
    totalAmount: string;
    currency: string;
    paymentMethod: string;
    soldBy: string;
    saleDate: Date;
    metadata: Record<string, unknown>;
  }> = [];

  let saleCounter = 0;

  // Branch distribution weights (MAIN gets most sales)
  const mainWh = retailWarehouses.find((w) => w.code === "MAIN");
  const msaWh = retailWarehouses.find((w) => w.code === "MSA");
  const lodgeWh = retailWarehouses.find((w) => w.code === "LODGE");

  function pickWarehouse() {
    const r = Math.random();
    // 55% Main Showroom, 25% Mombasa, 20% Lodge
    if (r < 0.55 && mainWh) return mainWh;
    if (r < 0.80 && msaWh) return msaWh;
    if (lodgeWh) return lodgeWh;
    return randomChoice(retailWarehouses);
  }

  for (const row of csvRows) {
    const sku = row.SKU || "";
    const productName = row.Product_Name || "";
    const category = row.Category || "";
    const priceUSD = parseFloat(row.Unit_Price_USD || "0");

    if (!sku || priceUSD <= 0) continue;

    // Convert USD to KES
    const priceKES = priceUSD * USD_TO_KES;

    // Each product gets 1–5 sales over the last 180 days
    const numSales = randomInt(1, 5);

    for (let s = 0; s < numSales; s++) {
      saleCounter++;
      const saleNumber = `SLE-${String(saleCounter).padStart(6, "0")}`;
      const wh = pickWarehouse();
      const qty = randomInt(1, 8);
      const unitPrice = round2(priceKES);
      const totalAmount = round2(priceKES * qty);
      const customerName = randomChoice(CUSTOMER_NAMES);

      saleRows.push({
        saleNumber,
        productId: productIdMap.get(sku),
        sku,
        productName,
        category,
        warehouseId: wh.id,
        warehouseName: wh.name,
        customerName: customerName === "Walk-in Customer" ? "" : customerName,
        quantity: qty,
        unitPrice,
        totalAmount,
        currency: CURRENCY,
        paymentMethod: weightedPaymentMethod(),
        soldBy: randomChoice(CASHIER_NAMES),
        saleDate: randomDate(180),
        metadata: {
          originalPriceUSD: round2(priceUSD),
          conversionRate: USD_TO_KES,
          source: "csv-seed",
        },
      });
    }
  }

  console.log(`   📊 Generated ${saleRows.length} sales from ${csvRows.length} products`);
  console.log(`   💱 USD→KES conversion rate: ${USD_TO_KES}`);

  // Batch insert in chunks of 200
  const BATCH_SIZE = 200;
  let inserted = 0;
  for (let i = 0; i < saleRows.length; i += BATCH_SIZE) {
    const batch = saleRows.slice(i, i + BATCH_SIZE);
    await db.insert(sales).values(batch);
    inserted += batch.length;
    console.log(`   ✅ Inserted batch ${Math.ceil((i + 1) / BATCH_SIZE)} (${inserted}/${saleRows.length})`);
  }

  // Print summary
  const [{ totalRevenue }] = await db
    .select({ totalRevenue: sql<string>`coalesce(sum(total_amount), 0)` })
    .from(sales);
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(sales);

  console.log(`\n   ════════════════════════════════════════`);
  console.log(`   ✅ Sales seeded successfully!`);
  console.log(`   📊 Total sales: ${count}`);
  console.log(`   💰 Total revenue: KES ${Number(totalRevenue).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`   💱 Conversion: USD × ${USD_TO_KES} = KES`);
  console.log(`   ════════════════════════════════════════\n`);

  await close();
  console.log("Done!");
}

main().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
