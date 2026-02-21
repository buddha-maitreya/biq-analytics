/**
 * Seed Script — Enrich DB from CSV Demo Data
 *
 * Reads the two CSV files in demo/data/ and populates:
 *   1. Categories (from curio shop + safari dataset)
 *   2. Products (500 curio items as stock products)
 *   3. Services via products table (50 safari/service items as isSellable=true)
 *   4. Customers (30 realistic tourism customers)
 *   5. Warehouses (if none exist)
 *   6. Inventory (stock levels per product per warehouse)
 *   7. Inventory transactions (initial receipt records)
 *   8. Order statuses (if none exist)
 *   9. Orders (300 orders spread over 180 days, weighted toward recent)
 *  10. Order items (1-6 items per order)
 *  11. Invoices (for completed orders)
 *  12. Payments (for paid invoices)
 *
 * Prerequisites: Database must exist with schema migrated.
 *   Run: bunx drizzle-kit migrate
 *
 * Usage:
 *   DATABASE_URL=<your-url> bun demo/seed-csv-data.ts
 *
 * The script clears existing transactional data (orders, invoices, payments)
 * then re-seeds everything from the CSV files. Categories, products, warehouses,
 * customers, and inventory are upserted.
 */

import { createPostgresDrizzle } from "@agentuity/drizzle";
import { sql } from "drizzle-orm";
import { readFileSync } from "fs";
import { join } from "path";
import * as schema from "../src/db/schema";
import {
  categories,
  products,
  warehouses,
  inventory,
  inventoryTransactions,
  customers,
  orderStatuses,
  orders,
  orderItems,
  invoices,
  payments,
} from "../src/db/schema";

// ────────────────────────────────────────────────────────────
// Database
// ────────────────────────────────────────────────────────────
const { db, close } = createPostgresDrizzle({ schema });

// ────────────────────────────────────────────────────────────
// CSV parser (simple — handles quoted fields with commas)
// ────────────────────────────────────────────────────────────
function parseCSV(filePath: string): Record<string, string>[] {
  const raw = readFileSync(filePath, "utf-8");
  const lines = raw.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return [];

  // Parse header
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

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
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

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function fmtNum(n: number, decimals = 2): string {
  return n.toFixed(decimals);
}

function generateOrderNumber(index: number): string {
  return `ORD-${String(20260001 + index).padStart(8, "0")}`;
}

function generateInvoiceNumber(index: number): string {
  return `INV-${String(20260001 + index).padStart(8, "0")}`;
}

// ────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────
async function seed() {
  console.log("🌍 Seeding database from CSV demo data...\n");

  // ── Load CSV files ──
  const dataDir = join(import.meta.dir, "data");
  const curioRows = parseCSV(join(dataDir, "ruskins_safaris_curio_shop.csv"));
  const safariRows = parseCSV(join(dataDir, "ruskins_safaris_dataset.csv"));

  console.log(`   📦 Curio shop:   ${curioRows.length} products`);
  console.log(`   🦁 Safari data:  ${safariRows.length} items\n`);

  // ══════════════════════════════════════════════════════════
  // 0. CLEAN TRANSACTIONAL DATA (preserve structure tables)
  // ══════════════════════════════════════════════════════════
  console.log("🧹 Cleaning transactional data...");
  await db.execute(sql`DELETE FROM payments`);
  await db.execute(sql`DELETE FROM invoices`);
  await db.execute(sql`DELETE FROM order_items`);
  await db.execute(sql`DELETE FROM orders`);
  await db.execute(sql`DELETE FROM inventory_transactions`);
  await db.execute(sql`DELETE FROM inventory`);
  await db.execute(sql`DELETE FROM products`);
  await db.execute(sql`DELETE FROM categories`);
  console.log("   ✓ Cleaned orders, invoices, payments, inventory, products, categories\n");

  // ══════════════════════════════════════════════════════════
  // 1. WAREHOUSES (create if none exist)
  // ══════════════════════════════════════════════════════════
  console.log("🏢 Setting up warehouses...");
  const existingWarehouses = await db.select().from(warehouses);
  let allWarehouses: typeof existingWarehouses;

  if (existingWarehouses.length === 0) {
    allWarehouses = await db
      .insert(warehouses)
      .values([
        {
          name: "Main Showroom",
          code: "MAIN",
          address: "Kenyatta Avenue, Nairobi CBD",
          isDefault: true,
          metadata: { type: "retail", region: "nairobi" },
        },
        {
          name: "Warehouse & Storage",
          code: "WH-01",
          address: "Industrial Area, Nairobi",
          metadata: { type: "storage", region: "nairobi" },
        },
        {
          name: "Mombasa Branch",
          code: "MSA",
          address: "Moi Avenue, Mombasa",
          metadata: { type: "retail", region: "coast" },
        },
        {
          name: "Safari Lodge Gift Shop",
          code: "LODGE",
          address: "Masai Mara, Narok County",
          metadata: { type: "retail", region: "mara" },
        },
      ])
      .returning();
    console.log(`   ✓ Created ${allWarehouses.length} warehouses`);
  } else {
    allWarehouses = existingWarehouses;
    console.log(`   ✓ Using ${allWarehouses.length} existing warehouses`);
  }

  const mainWarehouse = allWarehouses.find((w) => w.code === "MAIN" || w.isDefault) ?? allWarehouses[0];

  // ══════════════════════════════════════════════════════════
  // 2. ORDER STATUSES (create if none exist)
  // ══════════════════════════════════════════════════════════
  console.log("📋 Setting up order statuses...");
  const existingStatuses = await db.select().from(orderStatuses);
  let allStatuses: typeof existingStatuses;

  if (existingStatuses.length === 0) {
    allStatuses = await db
      .insert(orderStatuses)
      .values([
        { name: "inquiry", label: "Inquiry", color: "#94a3b8", sortOrder: 1 },
        { name: "quoted", label: "Quoted", color: "#60a5fa", sortOrder: 2 },
        { name: "confirmed", label: "Confirmed", color: "#34d399", sortOrder: 3 },
        { name: "deposit_paid", label: "Deposit Paid", color: "#fbbf24", sortOrder: 4 },
        { name: "in_progress", label: "In Progress", color: "#a78bfa", sortOrder: 5 },
        { name: "completed", label: "Completed", color: "#22c55e", sortOrder: 6, isFinal: true },
        { name: "fully_paid", label: "Fully Paid", color: "#10b981", sortOrder: 7, isFinal: true },
        { name: "cancelled", label: "Cancelled", color: "#ef4444", sortOrder: 8, isFinal: true },
      ])
      .returning();
    console.log(`   ✓ Created ${allStatuses.length} order statuses`);
  } else {
    allStatuses = existingStatuses;
    console.log(`   ✓ Using ${allStatuses.length} existing statuses`);
  }

  const statusByName = (name: string) =>
    allStatuses.find((s) => s.name === name) ?? allStatuses.find((s) => s.name === "completed") ?? allStatuses[0];

  // ══════════════════════════════════════════════════════════
  // 3. CATEGORIES (from CSV data)
  // ══════════════════════════════════════════════════════════
  console.log("📁 Creating categories...");

  // Collect unique categories and sub-categories from both CSVs
  const curioCats = new Map<string, Set<string>>();
  for (const row of curioRows) {
    const cat = row.Category;
    const sub = row.Sub_Category;
    if (!curioCats.has(cat)) curioCats.set(cat, new Set());
    if (sub) curioCats.get(cat)!.add(sub);
  }

  const safariCats = new Map<string, Set<string>>();
  for (const row of safariRows) {
    const cat = row.Category;
    const sub = row.Sub_Category;
    if (!safariCats.has(cat)) safariCats.set(cat, new Set());
    if (sub) safariCats.get(cat)!.add(sub);
  }

  // Category icon mapping
  const catIcons: Record<string, string> = {
    "Wood Carvings": "🪵",
    "Jewellery & Accessories": "💎",
    "Textiles & Clothing": "👕",
    "Paintings & Art": "🎨",
    "Pottery & Ceramics": "🏺",
    "Basketry & Weaving": "🧺",
    "Leather Goods": "👜",
    "Musical Instruments": "🎵",
    "Books & Stationery": "📚",
    "Food & Consumables": "🍫",
    "Home Décor": "🏠",
    "Wildlife Collectibles": "🦒",
    "Ruskins Safaris Branded Merchandise": "🏷️",
    "Safari Packages": "🦁",
    "Beach & Leisure": "🏖️",
    "Adventure & Trekking": "🥾",
    "Cultural & Heritage": "🎭",
    "Add-On Services": "➕",
    "Day Tours": "🚐",
    "Safari Merchandise": "🛍️",
    "Safari Equipment": "🔭",
    "Health & Safety Products": "🩺",
    "Transfer Services": "🚗",
    "Air Services": "✈️",
    "Accommodation": "🏨",
    "Park Fees & Permits": "🎫",
    "Specialty Tours": "⭐",
    "Leisure & Water Activities": "🚤",
    "Insurance & Financial Services": "📋",
    "Travel Facilitation": "🌍",
    "Food & Beverage": "🍽️",
    "Group & Educational": "🎓",
    "Specialty Packages": "🎁",
  };

  // Insert parent categories (curio shop first, then safari)
  const categoryMap = new Map<string, string>(); // name → id
  let sortIdx = 0;

  // Curio categories (products)
  for (const [catName, subs] of curioCats) {
    sortIdx++;
    const [cat] = await db
      .insert(categories)
      .values({
        name: catName,
        description: `Curio shop: ${catName}`,
        sortOrder: sortIdx,
        metadata: { icon: catIcons[catName] ?? "📦", source: "curio" },
      })
      .returning();
    categoryMap.set(catName, cat.id);

    // Sub-categories
    let subIdx = 0;
    for (const subName of subs) {
      subIdx++;
      const [sub] = await db
        .insert(categories)
        .values({
          name: subName,
          description: `${catName} → ${subName}`,
          parentId: cat.id,
          sortOrder: subIdx,
          metadata: { source: "curio" },
        })
        .returning();
      categoryMap.set(`${catName}::${subName}`, sub.id);
    }
  }

  // Safari categories (services)
  for (const [catName, subs] of safariCats) {
    if (categoryMap.has(catName)) continue; // skip if already created from curio
    sortIdx++;
    const [cat] = await db
      .insert(categories)
      .values({
        name: catName,
        description: `Safari/services: ${catName}`,
        sortOrder: sortIdx,
        metadata: { icon: catIcons[catName] ?? "🌍", source: "safari" },
      })
      .returning();
    categoryMap.set(catName, cat.id);

    let subIdx = 0;
    for (const subName of subs) {
      subIdx++;
      const [sub] = await db
        .insert(categories)
        .values({
          name: subName,
          description: `${catName} → ${subName}`,
          parentId: cat.id,
          sortOrder: subIdx,
          metadata: { source: "safari" },
        })
        .returning();
      categoryMap.set(`${catName}::${subName}`, sub.id);
    }
  }

  console.log(`   ✓ Created ${categoryMap.size} categories + sub-categories\n`);

  // ══════════════════════════════════════════════════════════
  // 4. PRODUCTS from curio shop CSV (500 items)
  // ══════════════════════════════════════════════════════════
  console.log("📦 Creating products from curio shop data...");

  const allProductRecords: Array<{ id: string; sku: string; price: string; name: string; isConsumable: boolean; isSellable: boolean }> = [];

  for (const row of curioRows) {
    const subKey = `${row.Category}::${row.Sub_Category}`;
    const catId = categoryMap.get(subKey) ?? categoryMap.get(row.Category) ?? null;
    const price = parseFloat(row.Unit_Price_USD) || 0;
    const costPrice = price * (0.35 + Math.random() * 0.25); // 35-60% margin
    const vatRate = parseInt(row.VAT_Rate_Percent) || 16;
    const stock = parseInt(row.Stock_Quantity) || 0;
    const isFood = row.Category === "Food & Consumables";

    const [product] = await db
      .insert(products)
      .values({
        sku: row.SKU,
        name: row.Product_Name,
        description: row.Description,
        categoryId: catId,
        unit: isFood ? "piece" : "piece",
        price: fmtNum(price),
        costPrice: fmtNum(costPrice),
        taxRate: fmtNum(vatRate / 100, 4),
        isConsumable: isFood,
        isSellable: true,
        isActive: true,
        minStockLevel: Math.max(2, Math.floor(stock * 0.1)),
        reorderPoint: Math.max(5, Math.floor(stock * 0.15)),
        maxStockLevel: Math.max(stock * 2, 100),
        metadata: {
          source: "csv-curio",
          material: row.Material || null,
          colorTheme: row.Color_Theme || null,
          size: row.Size || null,
          itemType: row.Item_Type || null,
          countryOfOrigin: row.Country_of_Origin || null,
          supplier: row.Supplier_Partner || null,
          targetAgeGroup: row.Target_Age_Group || null,
          authenticityLevel: row.Authenticity_Level || null,
          yearAdded: parseInt(row.Year_Added) || null,
          customerRating: parseFloat(row.Customer_Rating) || null,
          warranty: row.Warranty_Policy || null,
          exclusive: row.Ruskins_Exclusive === "Yes",
        },
      } as any)
      .returning();

    allProductRecords.push(product as any);
  }

  console.log(`   ✓ Created ${allProductRecords.length} curio products`);

  // ══════════════════════════════════════════════════════════
  // 5. PRODUCTS from safari CSV (services stored as products)
  // ══════════════════════════════════════════════════════════
  console.log("🦁 Creating products from safari data...");

  for (const row of safariRows) {
    const subKey = `${row.Category}::${row.Sub_Category}`;
    const catId = categoryMap.get(subKey) ?? categoryMap.get(row.Category) ?? null;
    const price = parseFloat(row.Unit_Price_USD) || 0;
    const costPrice = price * (0.4 + Math.random() * 0.2); // 40-60% cost
    const vatRate = parseInt(row.VAT_Rate_Percent) || 16;
    const isProduct = row.Type === "Product";

    const [product] = await db
      .insert(products)
      .values({
        sku: row.Item_ID,
        name: row.Item_Name,
        description: row.Description,
        categoryId: catId,
        unit: isProduct ? "piece" : "booking",
        price: fmtNum(price),
        costPrice: fmtNum(costPrice),
        taxRate: fmtNum(vatRate / 100, 4),
        isConsumable: false,
        isSellable: true,
        isActive: row.Status !== "Discontinued",
        minStockLevel: isProduct ? 5 : 0,
        reorderPoint: isProduct ? 10 : 0,
        metadata: {
          source: "csv-safari",
          type: row.Type,
          country: row.Country || null,
          region: row.Region || null,
          seasonAvailability: row.Season_Availability || null,
          duration: row.Duration || null,
          capacityPersons: parseInt(row.Capacity_Persons) || null,
          destination: row.Destination || null,
          languageOffered: row.Language_Offered || null,
          minGroupSize: parseInt(row.Min_Group_Size) || null,
          maxGroupSize: parseInt(row.Max_Group_Size) || null,
          customerRating: parseFloat(row.Customer_Rating) || null,
          notes: row.Notes || null,
          supplier: row.Supplier_Partner || null,
        },
      } as any)
      .returning();

    allProductRecords.push(product as any);
  }

  console.log(`   ✓ Created ${safariRows.length} safari products/services`);
  console.log(`   ✓ Total products: ${allProductRecords.length}\n`);

  // Separate sellable stock products for order generation
  const stockProducts = allProductRecords.filter((p) => p.isSellable);

  // ══════════════════════════════════════════════════════════
  // 6. CUSTOMERS (30 realistic tourism customers)
  // ══════════════════════════════════════════════════════════
  console.log("👥 Creating customers...");

  const existingCustomers = await db.select().from(customers);
  let allCustomers: typeof existingCustomers;

  if (existingCustomers.length < 5) {
    // Clean and recreate
    if (existingCustomers.length > 0) {
      await db.execute(sql`DELETE FROM customers`);
    }

    const customerData = [
      // Tour operators
      { name: "Abercrombie & Kent East Africa", email: "bookings@abercrombiekent.co.ke", phone: "+254 20 695 0000", address: "Mombasa Road, Nairobi", taxId: "P051234567A", creditLimit: "50000.00", metadata: { type: "tour_operator", tier: "premium" } },
      { name: "Natural World Kenya Safaris", email: "info@naturalworldsafaris.com", phone: "+254 20 213 3456", address: "Westlands, Nairobi", creditLimit: "35000.00", metadata: { type: "tour_operator", tier: "premium" } },
      { name: "Gamewatchers Safaris", email: "sales@gamewatchers.co.ke", phone: "+254 20 712 3456", address: "Karen, Nairobi", creditLimit: "40000.00", metadata: { type: "tour_operator", tier: "premium" } },
      { name: "Go Wild Safaris", email: "hello@gowildsafaris.com", phone: "+254 722 123456", address: "Lavington, Nairobi", creditLimit: "25000.00", metadata: { type: "tour_operator", tier: "standard" } },
      { name: "Bonfire Adventures", email: "sales@bonfireadventures.com", phone: "+254 20 444 5555", address: "CBD Nairobi", creditLimit: "30000.00", metadata: { type: "tour_operator", tier: "premium" } },

      // Hotels & lodges
      { name: "Sarova Hotels & Resorts", email: "purchasing@sarova.co.ke", phone: "+254 20 271 3233", address: "Sarova Stanley, Nairobi", taxId: "P051234590A", creditLimit: "60000.00", metadata: { type: "hotel", tier: "premium" } },
      { name: "Fairmont Hotels Kenya", email: "gifts@fairmont.co.ke", phone: "+254 20 226 5555", address: "Norfolk Hotel, Nairobi", creditLimit: "45000.00", metadata: { type: "hotel", tier: "luxury" } },
      { name: "Angama Mara", email: "shop@angama.com", phone: "+254 20 513 4000", address: "Masai Mara, Narok", creditLimit: "55000.00", metadata: { type: "lodge", tier: "luxury" } },

      // Corporate
      { name: "Safaricom PLC", email: "gifts@safaricom.co.ke", phone: "+254 722 000000", address: "Safaricom House, Nairobi", taxId: "P051000001A", creditLimit: "100000.00", metadata: { type: "corporate", tier: "enterprise" } },
      { name: "KCB Group", email: "procurement@kcb.co.ke", phone: "+254 20 327 0000", address: "Kencom House, Nairobi", taxId: "P051000002A", creditLimit: "80000.00", metadata: { type: "corporate", tier: "enterprise" } },
      { name: "Nation Media Group", email: "events@nationmedia.com", phone: "+254 20 328 8000", address: "Nation Centre, Nairobi", creditLimit: "40000.00", metadata: { type: "corporate", tier: "standard" } },

      // International agents
      { name: "TUI Travel UK", email: "kenya@tui.co.uk", phone: "+44 203 451 2688", address: "London, United Kingdom", creditLimit: "75000.00", metadata: { type: "international_agent", market: "UK/Europe" } },
      { name: "Kuoni Switzerland", email: "africa@kuoni.ch", phone: "+41 44 277 4444", address: "Zurich, Switzerland", creditLimit: "80000.00", metadata: { type: "international_agent", market: "Europe" } },
      { name: "African Travel Inc (USA)", email: "bookings@africantravelinc.com", phone: "+1 954 850 0800", address: "Fort Lauderdale, FL, USA", creditLimit: "90000.00", metadata: { type: "international_agent", market: "North America" } },
      { name: "Scott Dunn Travel", email: "africa@scottdunn.com", phone: "+44 203 733 5375", address: "London, United Kingdom", creditLimit: "70000.00", metadata: { type: "international_agent", market: "UK" } },

      // Individual/group travelers
      { name: "Dr. James Ochieng", email: "james.ochieng@gmail.com", phone: "+254 733 456789", address: "Kilimani, Nairobi", metadata: { type: "individual", market: "local" } },
      { name: "Sarah van der Berg", email: "sarah.vdb@outlook.com", phone: "+27 82 345 6789", address: "Cape Town, South Africa", metadata: { type: "individual", market: "africa" } },
      { name: "Tanaka & Yuki Watanabe", email: "tanaka.w@gmail.com", phone: "+81 90 1234 5678", address: "Tokyo, Japan", metadata: { type: "group", market: "asia" } },
      { name: "Michael & Lisa Thompson", email: "thompson.safari@gmail.com", phone: "+1 415 555 0142", address: "San Francisco, CA, USA", metadata: { type: "couple", market: "north_america" } },
      { name: "Ahmed Al-Rashidi", email: "ahmed.rashidi@gmail.com", phone: "+971 50 123 4567", address: "Dubai, UAE", metadata: { type: "individual", market: "middle_east" } },
      { name: "Priya Sharma", email: "priya.sharma@yahoo.in", phone: "+91 98765 43210", address: "Mumbai, India", metadata: { type: "individual", market: "asia" } },
      { name: "Heinrich & Anna Becker", email: "becker.reisen@web.de", phone: "+49 178 456 7890", address: "Munich, Germany", metadata: { type: "couple", market: "europe" } },
      { name: "Eco Adventures Group", email: "info@ecoadventures.org", phone: "+254 20 555 6789", address: "Karen, Nairobi", creditLimit: "15000.00", metadata: { type: "group", market: "local" } },
      { name: "Margaret Wanjiku", email: "maggie.wanjiku@gmail.com", phone: "+254 712 345678", address: "Nyeri, Kenya", metadata: { type: "individual", market: "local" } },
      { name: "Chen Wei & Family", email: "chenwei.travel@qq.com", phone: "+86 138 0013 8000", address: "Beijing, China", metadata: { type: "family", market: "asia" } },
      { name: "Johnson & Johnson Safari Club", email: "safariclub@jnj.com", phone: "+1 732 524 0400", address: "New Brunswick, NJ, USA", creditLimit: "120000.00", metadata: { type: "corporate_incentive", market: "north_america" } },
      { name: "Diani Beach Resort Gifts", email: "gifts@dianiresort.co.ke", phone: "+254 40 320 2000", address: "Diani Beach, Kwale", creditLimit: "20000.00", metadata: { type: "reseller", market: "coast" } },
      { name: "Nairobi National Museum Shop", email: "shop@museums.or.ke", phone: "+254 20 374 2131", address: "Museum Hill, Nairobi", creditLimit: "35000.00", metadata: { type: "reseller", market: "local" } },
      { name: "Roberto & Maria Gonzalez", email: "gonzalez.safari@gmail.com", phone: "+34 612 345 678", address: "Madrid, Spain", metadata: { type: "couple", market: "europe" } },
      { name: "Cape to Cairo Tours", email: "bookings@capetocairo.com", phone: "+27 21 555 4321", address: "Cape Town, South Africa", creditLimit: "45000.00", metadata: { type: "tour_operator", market: "africa" } },
    ];

    allCustomers = await db
      .insert(customers)
      .values(customerData as any[])
      .returning();
    console.log(`   ✓ Created ${allCustomers.length} customers`);
  } else {
    allCustomers = existingCustomers;
    console.log(`   ✓ Using ${allCustomers.length} existing customers`);
  }

  // ══════════════════════════════════════════════════════════
  // 7. INVENTORY (stock levels per product per warehouse)
  // ══════════════════════════════════════════════════════════
  console.log("\n📊 Creating inventory records...");

  let invCount = 0;
  let txCount = 0;

  for (const product of allProductRecords) {
    // Determine which warehouses stock this product
    const productWarehouses: typeof allWarehouses = [];

    // Most products are in the main showroom
    productWarehouses.push(mainWarehouse);

    // Some are spread across other locations
    const roll = Math.random();
    if (roll < 0.6 && allWarehouses.length > 1) {
      // 60% chance of being in warehouse/storage too
      const secondWh = allWarehouses.find((w) => w.code === "WH-01") ?? allWarehouses[1];
      if (secondWh && secondWh.id !== mainWarehouse.id) productWarehouses.push(secondWh);
    }
    if (roll < 0.3 && allWarehouses.length > 2) {
      // 30% chance of coastal branch
      const coastWh = allWarehouses.find((w) => w.code === "MSA") ?? allWarehouses[2];
      if (coastWh && !productWarehouses.find((w) => w.id === coastWh.id)) productWarehouses.push(coastWh);
    }
    if (roll < 0.15 && allWarehouses.length > 3) {
      // 15% chance in lodge shop
      const lodgeWh = allWarehouses.find((w) => w.code === "LODGE") ?? allWarehouses[3];
      if (lodgeWh && !productWarehouses.find((w) => w.id === lodgeWh.id)) productWarehouses.push(lodgeWh);
    }

    for (const wh of productWarehouses) {
      // Find original stock from CSV
      const csvRow = curioRows.find((r) => r.SKU === product.sku);
      const baseStock = csvRow ? parseInt(csvRow.Stock_Quantity) || randomInt(10, 80) : randomInt(5, 30);
      // Main showroom gets more, others get less
      const qty = wh.id === mainWarehouse.id
        ? baseStock
        : Math.floor(baseStock * (0.2 + Math.random() * 0.3));
      const reserved = Math.floor(qty * Math.random() * 0.15);

      await db.insert(inventory).values({
        productId: product.id,
        warehouseId: wh.id,
        quantity: qty,
        reservedQuantity: reserved,
      });
      invCount++;

      // Create an initial receipt transaction
      await db.insert(inventoryTransactions).values({
        productId: product.id,
        warehouseId: wh.id,
        type: "receipt",
        quantity: qty + reserved,
        referenceType: "manual",
        notes: "Initial stock from CSV seed data",
        metadata: { source: "csv-seed" },
      } as any);
      txCount++;
    }
  }

  console.log(`   ✓ Created ${invCount} inventory records`);
  console.log(`   ✓ Created ${txCount} inventory transactions\n`);

  // ══════════════════════════════════════════════════════════
  // 8. ORDERS (300 orders over 180 days)
  // ══════════════════════════════════════════════════════════
  console.log("📝 Creating orders...");

  const ORDER_COUNT = 300;

  // Generate dates weighted toward recent (realistic growth)
  const orderDates: Date[] = [];
  for (let i = 0; i < ORDER_COUNT; i++) {
    const roll = Math.random();
    let daysBack: number;
    if (roll < 0.35) {
      daysBack = randomInt(0, 14); // 35% in last 2 weeks
    } else if (roll < 0.60) {
      daysBack = randomInt(15, 30); // 25% in weeks 2-4
    } else if (roll < 0.80) {
      daysBack = randomInt(31, 60); // 20% in weeks 4-8
    } else if (roll < 0.92) {
      daysBack = randomInt(61, 120); // 12% in weeks 8-17
    } else {
      daysBack = randomInt(121, 180); // 8% in weeks 17-26
    }
    const d = new Date(Date.now() - daysBack * 86400000);
    d.setHours(randomInt(8, 18), randomInt(0, 59), randomInt(0, 59));
    orderDates.push(d);
  }
  orderDates.sort((a, b) => a.getTime() - b.getTime());

  // Status distribution
  const statusWeights = [
    { name: "completed", weight: 30 },
    { name: "fully_paid", weight: 15 },
    { name: "confirmed", weight: 15 },
    { name: "deposit_paid", weight: 10 },
    { name: "quoted", weight: 12 },
    { name: "in_progress", weight: 8 },
    { name: "inquiry", weight: 5 },
    { name: "cancelled", weight: 5 },
  ];

  function pickWeightedStatus(): string {
    const total = statusWeights.reduce((s, d) => s + d.weight, 0);
    let r = Math.random() * total;
    for (const d of statusWeights) {
      r -= d.weight;
      if (r <= 0) return d.name;
    }
    return "completed";
  }

  const paymentMethods = ["mpesa", "bank_transfer", "cash", "card", "card_pdq", "credit"];

  let totalOrders = 0;
  let totalItems = 0;
  let totalInvoices = 0;
  let totalPayments = 0;

  for (let i = 0; i < ORDER_COUNT; i++) {
    const orderDate = orderDates[i];
    const customer = pick(allCustomers);
    const statusName = pickWeightedStatus();
    const status = statusByName(statusName);

    // Pick 1-6 random products
    const itemCount = randomInt(1, 6);
    const chosenProducts: Array<{ product: (typeof stockProducts)[0]; qty: number }> = [];
    const usedIds = new Set<string>();

    for (let j = 0; j < itemCount; j++) {
      let product = pick(stockProducts);
      let attempts = 0;
      while (usedIds.has(product.id) && attempts < 15) {
        product = pick(stockProducts);
        attempts++;
      }
      if (usedIds.has(product.id)) continue;
      usedIds.add(product.id);

      // Curios usually sold 1-3, safaris 1-2
      const isSafari = product.sku.startsWith("RS-") && !product.sku.startsWith("RS-CS-");
      const qty = isSafari ? randomInt(1, 4) : randomInt(1, 5);
      chosenProducts.push({ product, qty });
    }
    if (chosenProducts.length === 0) continue;

    // Calculate totals
    let subtotal = 0;
    const lineItems: Array<{
      product: (typeof stockProducts)[0];
      qty: number;
      unitPrice: number;
      lineTotal: number;
      taxRate: number;
    }> = [];

    for (const { product, qty } of chosenProducts) {
      const unitPrice = parseFloat(product.price);
      // Apply occasional discount (10-20% off for larger orders)
      const discount = qty > 3 ? 1 - (0.10 + Math.random() * 0.10) : 1;
      const effectivePrice = unitPrice * discount;
      const lineTotal = effectivePrice * qty;
      subtotal += lineTotal;
      lineItems.push({ product, qty, unitPrice: effectivePrice, lineTotal, taxRate: 0.16 });
    }

    const taxAmount = subtotal * 0.16;
    const discountAmount = lineItems.reduce(
      (sum, li) => sum + (parseFloat(li.product.price) * li.qty - li.lineTotal),
      0
    );
    const totalAmount = subtotal + taxAmount;
    const orderNumber = generateOrderNumber(i);

    // Payment
    const hasPay = !["inquiry", "cancelled", "quoted"].includes(statusName);
    const payMethod = hasPay ? pick(paymentMethods) : null;
    const payStatus =
      statusName === "fully_paid" || statusName === "completed"
        ? "paid"
        : statusName === "deposit_paid"
          ? "partial"
          : "pending";

    const [order] = await db
      .insert(orders)
      .values({
        orderNumber,
        customerId: customer.id,
        statusId: status.id,
        subtotal: fmtNum(subtotal),
        taxAmount: fmtNum(taxAmount),
        discountAmount: fmtNum(discountAmount),
        totalAmount: fmtNum(totalAmount),
        notes: `Order from ${customer.name}`,
        warehouseId: mainWarehouse.id,
        paymentMethod: payMethod,
        paymentStatus: payStatus,
        paymentReference:
          payMethod === "mpesa"
            ? `MPESA-${randomInt(100000, 999999)}`
            : payMethod === "bank_transfer"
              ? `BNK-${randomInt(10000, 99999)}`
              : payMethod === "card" || payMethod === "card_pdq"
                ? `CARD-${randomInt(1000, 9999)}`
                : null,
        metadata: { source: "csv-seed", day: orderDate.toISOString().slice(0, 10) },
      } as any)
      .returning();

    // Backdate
    await db.execute(
      sql`UPDATE orders SET created_at = ${orderDate.toISOString()}, updated_at = ${orderDate.toISOString()} WHERE id = ${order.id}`
    );

    // Insert line items
    for (const li of lineItems) {
      const itemTax = li.lineTotal * li.taxRate;
      const [item] = await db
        .insert(orderItems)
        .values({
          orderId: order.id,
          itemType: "stock",
          productId: li.product.id,
          description: li.product.name,
          quantity: li.qty,
          unitPrice: fmtNum(li.unitPrice),
          taxRate: fmtNum(li.taxRate, 4),
          taxAmount: fmtNum(itemTax),
          discountAmount: fmtNum(parseFloat(li.product.price) * li.qty - li.lineTotal),
          totalAmount: fmtNum(li.lineTotal + itemTax),
        } as any)
        .returning();

      await db.execute(
        sql`UPDATE order_items SET created_at = ${orderDate.toISOString()}, updated_at = ${orderDate.toISOString()} WHERE id = ${item.id}`
      );
      totalItems++;

      // Create sale inventory transaction
      if (["completed", "fully_paid"].includes(statusName)) {
        await db.insert(inventoryTransactions).values({
          productId: li.product.id,
          warehouseId: mainWarehouse.id,
          type: "sale",
          quantity: -li.qty,
          referenceType: "order",
          referenceId: order.id,
          notes: `Sold via ${orderNumber}`,
          metadata: { source: "csv-seed" },
        } as any);
      }
    }

    // ── Invoice ──
    if (!["inquiry", "cancelled"].includes(statusName)) {
      let invoiceStatus = "draft";
      let paidAmount = 0;

      if (statusName === "completed" || statusName === "fully_paid") {
        invoiceStatus = "paid";
        paidAmount = totalAmount;
      } else if (statusName === "deposit_paid") {
        invoiceStatus = "partial";
        paidAmount = totalAmount * 0.3;
      } else if (statusName === "confirmed" || statusName === "in_progress") {
        invoiceStatus = "sent";
      } else if (statusName === "quoted") {
        invoiceStatus = "draft";
      }

      const dueDate = new Date(orderDate.getTime() + 30 * 86400000);
      const invoiceDate = new Date(orderDate.getTime() + randomInt(0, 2) * 86400000);
      const invNumber = generateInvoiceNumber(i);

      const isKraVerified =
        invoiceStatus === "paid"
          ? Math.random() < 0.65
          : invoiceStatus === "sent" || invoiceStatus === "partial"
            ? Math.random() < 0.3
            : false;

      const kraVerifiedAt = isKraVerified
        ? new Date(invoiceDate.getTime() + randomInt(0, 3) * 86400000)
        : null;

      const kraInvoiceNumber = isKraVerified
        ? `00${randomInt(10, 99)}${randomInt(100000000, 999999999)}00${randomInt(100000, 999999)}00`
        : null;

      const [invoice] = await db
        .insert(invoices)
        .values({
          invoiceNumber: invNumber,
          orderId: order.id,
          customerId: customer.id,
          status: invoiceStatus,
          subtotal: fmtNum(subtotal),
          taxAmount: fmtNum(taxAmount),
          discountAmount: fmtNum(discountAmount),
          totalAmount: fmtNum(totalAmount),
          paidAmount: fmtNum(paidAmount),
          dueDate,
          paidAt: invoiceStatus === "paid" ? invoiceDate : null,
          kraVerified: isKraVerified,
          kraVerifiedAt,
          kraInvoiceNumber,
          notes: `Invoice for ${orderNumber}`,
        } as any)
        .returning();

      await db.execute(
        sql`UPDATE invoices SET created_at = ${invoiceDate.toISOString()}, updated_at = ${invoiceDate.toISOString()} WHERE id = ${invoice.id}`
      );
      totalInvoices++;

      // ── Payment ──
      if (paidAmount > 0) {
        const method = payMethod ?? pick(["mpesa", "bank_transfer", "cash"]);
        const payDate = new Date(invoiceDate.getTime() + randomInt(0, 5) * 86400000);

        const [payment] = await db
          .insert(payments)
          .values({
            invoiceId: invoice.id,
            amount: fmtNum(paidAmount),
            method,
            reference:
              method === "mpesa"
                ? `MPESA-${randomInt(100000, 999999)}`
                : method === "bank_transfer"
                  ? `BNK-${randomInt(10000, 99999)}`
                  : method === "card" || method === "card_pdq"
                    ? `CARD-${randomInt(1000, 9999)}`
                    : `PAY-${randomInt(1000, 9999)}`,
            notes:
              invoiceStatus === "paid"
                ? "Full payment received"
                : "Deposit payment (30%)",
          } as any)
          .returning();

        await db.execute(
          sql`UPDATE payments SET created_at = ${payDate.toISOString()}, updated_at = ${payDate.toISOString()} WHERE id = ${payment.id}`
        );
        totalPayments++;
      }
    }

    totalOrders++;

    // Progress indicator every 50 orders
    if ((i + 1) % 50 === 0) {
      console.log(`   ... ${i + 1}/${ORDER_COUNT} orders created`);
    }
  }

  console.log(`\n   ✓ ${totalOrders} orders created (${totalItems} line items)`);
  console.log(`   ✓ ${totalInvoices} invoices created`);
  console.log(`   ✓ ${totalPayments} payments created`);

  // ══════════════════════════════════════════════════════════
  // SUMMARY
  // ══════════════════════════════════════════════════════════
  const revenueResult = (await db.execute(
    sql`SELECT COALESCE(SUM(CAST(total_amount AS NUMERIC)), 0) as total FROM orders`
  )) as any[];
  const dateRange = (await db.execute(
    sql`SELECT MIN(created_at) as earliest, MAX(created_at) as latest FROM orders`
  )) as any[];

  const totalRevenue = parseFloat(revenueResult[0]?.total ?? 0);

  console.log(`\n═══════════════════════════════════════════════════`);
  console.log(`🎉 CSV Data Seed Complete!`);
  console.log(`═══════════════════════════════════════════════════`);
  console.log(`   Categories:    ${categoryMap.size}`);
  console.log(`   Products:      ${allProductRecords.length}`);
  console.log(`   Customers:     ${allCustomers.length}`);
  console.log(`   Warehouses:    ${allWarehouses.length}`);
  console.log(`   Inventory:     ${invCount} records`);
  console.log(`   Inv. Txns:     ${txCount} records`);
  console.log(`   Orders:        ${totalOrders}`);
  console.log(`   Order Items:   ${totalItems}`);
  console.log(`   Invoices:      ${totalInvoices}`);
  console.log(`   Payments:      ${totalPayments}`);
  console.log(`   Total Revenue: $${totalRevenue.toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
  console.log(`   Date Range:    ${dateRange[0]?.earliest?.toISOString?.()?.slice(0, 10) ?? "?"} → ${dateRange[0]?.latest?.toISOString?.()?.slice(0, 10) ?? "?"}`);
  console.log(`═══════════════════════════════════════════════════\n`);
}

seed()
  .then(async () => {
    await close();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("❌ Seed failed:", err);
    await close();
    process.exit(1);
  });
