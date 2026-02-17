/**
 * Seed Script — Kenyan Tourism Business Demo
 *
 * Populates the database with realistic data for a Kenyan safari & tourism
 * company. Covers safaris, birdwatching, beach activities, accommodation,
 * trekking, vehicle hire, camping, itineraries, dietary options, and more.
 *
 * Usage:
 *   DATABASE_URL=<your-url> bun scripts/seed-demo.ts
 *
 * The script is idempotent — it checks for existing data before inserting.
 * To reset: drop all tables, re-run migrations, then re-run this script.
 */

import { createPostgresDrizzle } from "@agentuity/drizzle";
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
  taxRules,
  users,
} from "../src/db/schema";

// ────────────────────────────────────────────────────────────
// Database connection (reads DATABASE_URL automatically)
// ────────────────────────────────────────────────────────────
const { db, close } = createPostgresDrizzle({ schema });

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────
function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomDate(daysBack: number, daysForward = 0): Date {
  const now = Date.now();
  const start = now - daysBack * 86400000;
  const end = now + daysForward * 86400000;
  return new Date(start + Math.random() * (end - start));
}

function generateOrderNumber(index: number): string {
  return `BK-${String(2026000 + index).padStart(7, "0")}`;
}

function generateInvoiceNumber(index: number): string {
  return `INV-${String(2026000 + index).padStart(7, "0")}`;
}

// ────────────────────────────────────────────────────────────
// Seed Data
// ────────────────────────────────────────────────────────────

async function seed() {
  console.log("🌍 Seeding Kenyan Tourism Business Demo...\n");

  // Check if already seeded
  const existingCategories = await db.select({ id: categories.id }).from(categories).limit(1);
  if (existingCategories.length > 0) {
    console.log("⚠️  Database already has data. To re-seed, drop tables first:");
    console.log("   bunx drizzle-kit push --force && bun scripts/seed-demo.ts");
    process.exit(0);
  }

  // ══════════════════════════════════════════════════════════
  // 1. CATEGORIES (hierarchical)
  // ══════════════════════════════════════════════════════════
  console.log("📁 Creating categories...");

  const [catSafaris] = await db.insert(categories).values({
    name: "Safari Packages",
    description: "Guided wildlife safari experiences across Kenya's iconic national parks and conservancies",
    sortOrder: 1,
    metadata: { icon: "🦁", region: "nationwide" },
  }).returning();

  const [catBirdwatching] = await db.insert(categories).values({
    name: "Birdwatching Tours",
    description: "Guided birding excursions across Kenya's 1,100+ bird species habitats",
    sortOrder: 2,
    metadata: { icon: "🦅", region: "nationwide" },
  }).returning();

  const [catBeach] = await db.insert(categories).values({
    name: "Beach & Marine Activities",
    description: "Coastal experiences along Kenya's Indian Ocean shoreline — Diani, Watamu, Malindi, Lamu",
    sortOrder: 3,
    metadata: { icon: "🏖️", region: "coast" },
  }).returning();

  const [catAccommodation] = await db.insert(categories).values({
    name: "Accommodation",
    description: "Lodges, tented camps, hotels, and homestays across all destinations",
    sortOrder: 4,
    metadata: { icon: "🏨", region: "nationwide" },
  }).returning();

  const [catTrekking] = await db.insert(categories).values({
    name: "Trekking & Hiking",
    description: "Mountain treks, nature walks, and hiking adventures — Mt Kenya, Aberdares, Hell's Gate",
    sortOrder: 5,
    metadata: { icon: "🥾", region: "highlands" },
  }).returning();

  const [catVehicles] = await db.insert(categories).values({
    name: "Vehicle Hire",
    description: "Safari vehicles, 4x4s, minivans, and luxury transfers for game drives and transfers",
    sortOrder: 6,
    metadata: { icon: "🚙", region: "nationwide" },
  }).returning();

  const [catCamping] = await db.insert(categories).values({
    name: "Camping & Outdoor",
    description: "Camping equipment, bush camping, glamping, and outdoor adventure gear",
    sortOrder: 7,
    metadata: { icon: "⛺", region: "nationwide" },
  }).returning();

  const [catDining] = await db.insert(categories).values({
    name: "Dining & Dietary Plans",
    description: "Meal plans, dietary accommodations, bush dining, and cultural food experiences",
    sortOrder: 8,
    metadata: { icon: "🍽️", region: "nationwide" },
  }).returning();

  const [catCultural] = await db.insert(categories).values({
    name: "Cultural Experiences",
    description: "Community visits, traditional dances, Maasai village tours, and heritage sites",
    sortOrder: 9,
    metadata: { icon: "🎭", region: "nationwide" },
  }).returning();

  const [catTransfers] = await db.insert(categories).values({
    name: "Transfers & Flights",
    description: "Airport transfers, domestic flights, helicopter charters, and inter-park transfers",
    sortOrder: 10,
    metadata: { icon: "✈️", region: "nationwide" },
  }).returning();

  // Sub-categories
  const [catLuxuryLodge] = await db.insert(categories).values({
    name: "Luxury Lodges",
    description: "Premium lodges and resorts with full-service amenities",
    parentId: catAccommodation.id,
    sortOrder: 1,
    metadata: { tier: "luxury" },
  }).returning();

  const [catTentedCamp] = await db.insert(categories).values({
    name: "Tented Camps",
    description: "Semi-permanent tented safari camps with en-suite facilities",
    parentId: catAccommodation.id,
    sortOrder: 2,
    metadata: { tier: "mid-range" },
  }).returning();

  const [catBudgetAccom] = await db.insert(categories).values({
    name: "Budget Accommodation",
    description: "Hostels, guesthouses, and budget-friendly stays",
    parentId: catAccommodation.id,
    sortOrder: 3,
    metadata: { tier: "budget" },
  }).returning();

  const [catBushCamping] = await db.insert(categories).values({
    name: "Bush Camping",
    description: "Wild camping in designated bush campsites within parks and conservancies",
    parentId: catCamping.id,
    sortOrder: 1,
  }).returning();

  const [catGlamping] = await db.insert(categories).values({
    name: "Glamping",
    description: "Luxury glamping with premium tents, hot showers, and gourmet bush meals",
    parentId: catCamping.id,
    sortOrder: 2,
  }).returning();

  console.log(`   ✓ ${15} categories created\n`);

  // ══════════════════════════════════════════════════════════
  // 2. PRODUCTS (tourism offerings)
  // ══════════════════════════════════════════════════════════
  console.log("🦁 Creating products (tourism offerings)...");

  const productData = [
    // ── Safari Packages ─────────────────────────────────
    {
      sku: "SAF-MARA-3D", name: "Masai Mara Classic Safari — 3 Days",
      description: "3-day, 2-night safari in the Masai Mara National Reserve. Includes game drives at dawn and dusk, Mara River crossing viewpoints (seasonal), and Big Five tracking with expert Maasai guides. Accommodation in mid-range tented camp.",
      categoryId: catSafaris.id, unit: "person", price: "850.00", costPrice: "520.00", taxRate: "0.16",
      minStockLevel: 2, reorderPoint: 5, maxStockLevel: 24,
      metadata: { duration: "3 days / 2 nights", difficulty: "easy", parkFees: "included", highlights: ["Big Five", "Mara River", "Maasai culture"], season: "year-round", bestMonths: ["Jul", "Aug", "Sep", "Oct"] },
    },
    {
      sku: "SAF-MARA-5D", name: "Masai Mara Premium Safari — 5 Days",
      description: "5-day luxury Mara experience with hot air balloon ride, bush breakfast, night game drives in conservancy, and Maasai village visit. Luxury lodge accommodation with all meals.",
      categoryId: catSafaris.id, unit: "person", price: "2200.00", costPrice: "1400.00", taxRate: "0.16",
      minStockLevel: 2, reorderPoint: 3, maxStockLevel: 16,
      metadata: { duration: "5 days / 4 nights", difficulty: "easy", parkFees: "included", tier: "luxury", highlights: ["hot air balloon", "night drives", "bush breakfast"] },
    },
    {
      sku: "SAF-AMBO-3D", name: "Amboseli Safari — 3 Days",
      description: "3-day safari beneath Mt Kilimanjaro's snow-capped peak. Famous for large elephant herds. Includes game drives, sundowner cocktails, and Maasai community visit.",
      categoryId: catSafaris.id, unit: "person", price: "720.00", costPrice: "430.00", taxRate: "0.16",
      minStockLevel: 2, reorderPoint: 5, maxStockLevel: 24,
      metadata: { duration: "3 days / 2 nights", difficulty: "easy", highlights: ["elephants", "Kilimanjaro views", "sundowners"] },
    },
    {
      sku: "SAF-TSAVO-4D", name: "Tsavo East & West Combined — 4 Days",
      description: "Explore Kenya's largest park system — red elephants of Tsavo East, Mzima Springs in Tsavo West, and the lava flows of Shetani. Mid-range lodge stays.",
      categoryId: catSafaris.id, unit: "person", price: "980.00", costPrice: "600.00", taxRate: "0.16",
      minStockLevel: 2, reorderPoint: 4, maxStockLevel: 20,
      metadata: { duration: "4 days / 3 nights", difficulty: "easy", highlights: ["red elephants", "Mzima Springs", "Shetani lava"] },
    },
    {
      sku: "SAF-SAMBURU-3D", name: "Samburu Special Five Safari — 3 Days",
      description: "Track the 'Samburu Special Five' — Grevy's zebra, reticulated giraffe, Beisa oryx, Somali ostrich, and gerenuk. Ewaso Nyiro river game drives.",
      categoryId: catSafaris.id, unit: "person", price: "890.00", costPrice: "540.00", taxRate: "0.16",
      minStockLevel: 2, reorderPoint: 4, maxStockLevel: 16,
      metadata: { duration: "3 days / 2 nights", difficulty: "easy", highlights: ["Samburu Special Five", "Ewaso Nyiro river"] },
    },
    {
      sku: "SAF-LAIKIPIA-4D", name: "Laikipia Conservancy Safari — 4 Days",
      description: "Private conservancy safari with walking safaris, camel treks, night drives, and rhino tracking. Intimate camp with max 12 guests. Community-owned wildlife corridor.",
      categoryId: catSafaris.id, unit: "person", price: "1650.00", costPrice: "1050.00", taxRate: "0.16",
      minStockLevel: 1, reorderPoint: 2, maxStockLevel: 12,
      metadata: { duration: "4 days / 3 nights", difficulty: "moderate", tier: "luxury", highlights: ["walking safari", "camel trek", "rhino tracking"] },
    },
    {
      sku: "SAF-NAKNURU-2D", name: "Lake Nakuru Day Safari — 2 Days",
      description: "Rhino sanctuary safari at Lake Nakuru National Park. Famous for flamingos (seasonal) and guaranteed rhino sightings. Includes Menengai Crater viewpoint.",
      categoryId: catSafaris.id, unit: "person", price: "450.00", costPrice: "270.00", taxRate: "0.16",
      minStockLevel: 4, reorderPoint: 6, maxStockLevel: 30,
      metadata: { duration: "2 days / 1 night", difficulty: "easy", highlights: ["rhinos", "flamingos", "Menengai Crater"] },
    },
    {
      sku: "SAF-MIGRATION", name: "Great Migration Tracking — 7 Days",
      description: "Follow the Great Wildebeest Migration from Serengeti crossing to Mara. Includes 3 nights Mara, 2 nights Serengeti (cross-border), hot air balloon, and river crossing stakeouts.",
      categoryId: catSafaris.id, unit: "person", price: "4500.00", costPrice: "3000.00", taxRate: "0.16",
      minStockLevel: 1, reorderPoint: 2, maxStockLevel: 12,
      metadata: { duration: "7 days / 6 nights", difficulty: "easy", tier: "luxury", season: "Jul-Oct", highlights: ["river crossing", "wildebeest migration", "balloon safari"] },
    },

    // ── Birdwatching Tours ──────────────────────────────
    {
      sku: "BIRD-NAIVASHA", name: "Lake Naivasha Birding Day Trip",
      description: "Full-day birdwatching at Lake Naivasha — African fish eagle, malachite kingfisher, pelicans, cormorants, and 400+ species. Boat ride included. Crescent Island walking safari.",
      categoryId: catBirdwatching.id, unit: "person", price: "120.00", costPrice: "65.00", taxRate: "0.16",
      minStockLevel: 4, reorderPoint: 8, maxStockLevel: 40,
      metadata: { duration: "full day", speciesCount: 400, highlights: ["fish eagle", "pelicans", "Crescent Island"] },
    },
    {
      sku: "BIRD-BARINGO-2D", name: "Lake Baringo & Bogoria Birding — 2 Days",
      description: "Baringo's 470+ bird species including Hemprich's hornbill, Jackson's hornbill, and northern specials. Lake Bogoria flamingos and hot springs. Expert ornithologist guide.",
      categoryId: catBirdwatching.id, unit: "person", price: "320.00", costPrice: "190.00", taxRate: "0.16",
      minStockLevel: 2, reorderPoint: 4, maxStockLevel: 20,
      metadata: { duration: "2 days / 1 night", speciesCount: 470, highlights: ["Hemprich's hornbill", "flamingos", "hot springs"] },
    },
    {
      sku: "BIRD-KAKAMEGA-3D", name: "Kakamega Rainforest Birding — 3 Days",
      description: "Kenya's only tropical rainforest — blue-headed bee-eater, great blue turaco, Turner's eremomela. Night birding for Pel's fishing owl. Forest canopy walks.",
      categoryId: catBirdwatching.id, unit: "person", price: "480.00", costPrice: "290.00", taxRate: "0.16",
      minStockLevel: 2, reorderPoint: 3, maxStockLevel: 16,
      metadata: { duration: "3 days / 2 nights", speciesCount: 360, highlights: ["blue turaco", "canopy walk", "night birding"] },
    },
    {
      sku: "BIRD-COAST-5D", name: "Coastal Birding Circuit — 5 Days",
      description: "Arabuko-Sokoke Forest (Clarke's weaver, Sokoke scops owl), Mida Creek (waders, terns), Sabaki River Mouth (rarities), and Shimba Hills (palm-nut vulture). World-class endemics.",
      categoryId: catBirdwatching.id, unit: "person", price: "750.00", costPrice: "450.00", taxRate: "0.16",
      minStockLevel: 1, reorderPoint: 3, maxStockLevel: 12,
      metadata: { duration: "5 days / 4 nights", speciesCount: 300, highlights: ["Clarke's weaver", "Sokoke scops owl", "Sabaki mouth"] },
    },

    // ── Beach & Marine Activities ───────────────────────
    {
      sku: "BCH-DIANI-SNORK", name: "Diani Beach Snorkeling Trip",
      description: "Half-day snorkeling at Diani's coral reef — tropical fish, sea turtles, and dolphins. Equipment provided. Kisite-Mpunguti Marine Park option available.",
      categoryId: catBeach.id, unit: "person", price: "75.00", costPrice: "35.00", taxRate: "0.16",
      minStockLevel: 6, reorderPoint: 10, maxStockLevel: 50,
      metadata: { duration: "half day", difficulty: "easy", equipment: "included" },
    },
    {
      sku: "BCH-WATAMU-DIVE", name: "Watamu Scuba Diving (2 dives)",
      description: "Two-tank dive at Watamu Marine National Park — coral gardens, whale sharks (seasonal), groupers, and rays. PADI certified instructors. Beginners welcome.",
      categoryId: catBeach.id, unit: "person", price: "150.00", costPrice: "80.00", taxRate: "0.16",
      minStockLevel: 4, reorderPoint: 6, maxStockLevel: 30,
      metadata: { duration: "full day", dives: 2, certification: "PADI", highlights: ["coral gardens", "whale sharks"] },
    },
    {
      sku: "BCH-LAMU-DHOW", name: "Lamu Dhow Sailing Experience",
      description: "Traditional Swahili dhow sailing cruise around Lamu archipelago. Mangrove channels, Manda Island, snorkeling, and seafood lunch on sandbank. UNESCO World Heritage context.",
      categoryId: catBeach.id, unit: "person", price: "95.00", costPrice: "45.00", taxRate: "0.16",
      minStockLevel: 4, reorderPoint: 8, maxStockLevel: 30,
      metadata: { duration: "full day", highlights: ["dhow sailing", "UNESCO Lamu", "sandbank lunch"] },
    },
    {
      sku: "BCH-FISHING", name: "Deep Sea Fishing Charter — Full Day",
      description: "Full-day deep sea fishing out of Malindi/Watamu. Target marlin, sailfish, yellowfin tuna, and wahoo. All tackle provided. Hemingway's fishing legacy.",
      categoryId: catBeach.id, unit: "boat", price: "800.00", costPrice: "500.00", taxRate: "0.16",
      minStockLevel: 1, reorderPoint: 2, maxStockLevel: 5,
      metadata: { duration: "full day", capacity: "6 anglers", species: ["marlin", "sailfish", "tuna", "wahoo"] },
    },
    {
      sku: "BCH-KITESURF", name: "Kitesurfing Lessons — Diani (3 days)",
      description: "3-day IKO-certified kitesurfing course on Diani Beach. Consistent SE trade winds Dec–Mar & Jun–Oct. Equipment, insurance, and instructor included.",
      categoryId: catBeach.id, unit: "person", price: "350.00", costPrice: "180.00", taxRate: "0.16",
      minStockLevel: 2, reorderPoint: 4, maxStockLevel: 16,
      metadata: { duration: "3 days", certification: "IKO", season: "Dec-Mar, Jun-Oct" },
    },

    // ── Accommodation ───────────────────────────────────
    {
      sku: "ACC-MARA-LUXURY", name: "Mara Luxury Lodge — Per Night",
      description: "Premium lodge in Masai Mara conservancy. En-suite rooms with Mara views, infinity pool, spa, bush dining. All meals and conservancy fees included.",
      categoryId: catLuxuryLodge.id, unit: "night", price: "450.00", costPrice: "280.00", taxRate: "0.16",
      minStockLevel: 5, reorderPoint: 8, maxStockLevel: 30,
      metadata: { location: "Masai Mara conservancy", roomType: "en-suite", meals: "full board", amenities: ["pool", "spa", "wifi", "bush dining"] },
    },
    {
      sku: "ACC-MARA-TENT", name: "Mara Tented Camp — Per Night",
      description: "Classic safari tented camp in the Mara triangle. Canvas tents with en-suite bathroom, hot water, and verandah. Full board with bush breakfast option.",
      categoryId: catTentedCamp.id, unit: "night", price: "220.00", costPrice: "130.00", taxRate: "0.16",
      minStockLevel: 6, reorderPoint: 10, maxStockLevel: 40,
      metadata: { location: "Mara Triangle", roomType: "safari tent", meals: "full board" },
    },
    {
      sku: "ACC-AMBO-LODGE", name: "Amboseli Lodge — Per Night",
      description: "Lodge with panoramic Kilimanjaro views. Poolside sundowners, cultural boma (Maasai enclosure). Full board.",
      categoryId: catLuxuryLodge.id, unit: "night", price: "380.00", costPrice: "230.00", taxRate: "0.16",
      minStockLevel: 5, reorderPoint: 8, maxStockLevel: 30,
      metadata: { location: "Amboseli", highlights: ["Kilimanjaro view", "cultural boma"] },
    },
    {
      sku: "ACC-DIANI-RESORT", name: "Diani Beach Resort — Per Night",
      description: "Beachfront resort on Diani's white sands. Ocean-view rooms, 2 pools, water sports center, 3 restaurants. Half board.",
      categoryId: catLuxuryLodge.id, unit: "night", price: "280.00", costPrice: "170.00", taxRate: "0.16",
      minStockLevel: 10, reorderPoint: 15, maxStockLevel: 60,
      metadata: { location: "Diani Beach", meals: "half board", amenities: ["beach access", "2 pools", "water sports", "spa"] },
    },
    {
      sku: "ACC-LAMU-HOUSE", name: "Lamu Heritage House — Per Night",
      description: "Restored Swahili merchant's house in Lamu Old Town. Rooftop terrace, traditional decor, courtyard. Breakfast included. UNESCO heritage setting.",
      categoryId: catTentedCamp.id, unit: "night", price: "160.00", costPrice: "90.00", taxRate: "0.16",
      minStockLevel: 3, reorderPoint: 5, maxStockLevel: 10,
      metadata: { location: "Lamu Old Town", style: "heritage", meals: "bed & breakfast" },
    },
    {
      sku: "ACC-NAIROBI-BKP", name: "Nairobi Backpackers — Per Night",
      description: "Social hostel in Nairobi's Westlands district. Dorm and private rooms. Bar, co-working space, safari booking desk. Walking distance to restaurants.",
      categoryId: catBudgetAccom.id, unit: "night", price: "25.00", costPrice: "12.00", taxRate: "0.16",
      minStockLevel: 20, reorderPoint: 30, maxStockLevel: 100,
      metadata: { location: "Nairobi Westlands", roomTypes: ["dorm", "private"], meals: "self-catering" },
    },
    {
      sku: "ACC-NANYUKI-CAMP", name: "Nanyuki Mountain Camp — Per Night",
      description: "Base camp for Mt Kenya treks. Canvas tents at 2,000m altitude. Hot meals, mountain guides available. Cold but stunning.",
      categoryId: catTentedCamp.id, unit: "night", price: "85.00", costPrice: "45.00", taxRate: "0.16",
      minStockLevel: 8, reorderPoint: 12, maxStockLevel: 40,
      metadata: { location: "Nanyuki / Mt Kenya foothills", altitude: "2,000m", meals: "full board" },
    },

    // ── Trekking & Hiking ───────────────────────────────
    {
      sku: "TREK-MTKENYA-5D", name: "Mt Kenya Summit Trek — 5 Days (Sirimon-Chogoria)",
      description: "5-day trek to Point Lenana (4,985m) via Sirimon route, descend Chogoria. Porters, cook, guide. Acclimatization at Mackinder's Camp. All park fees included.",
      categoryId: catTrekking.id, unit: "person", price: "1200.00", costPrice: "750.00", taxRate: "0.16",
      minStockLevel: 2, reorderPoint: 3, maxStockLevel: 12,
      metadata: { duration: "5 days / 4 nights", summit: "Point Lenana 4,985m", difficulty: "challenging", route: "Sirimon up / Chogoria down" },
    },
    {
      sku: "TREK-HELLSGATE", name: "Hell's Gate Gorge Hike — Day Trip",
      description: "Full-day hike through Hell's Gate National Park gorge. Cycling to gorge entrance, scrambling through narrow canyon with hot springs. Possible baboon and rock hyrax sightings.",
      categoryId: catTrekking.id, unit: "person", price: "85.00", costPrice: "40.00", taxRate: "0.16",
      minStockLevel: 6, reorderPoint: 10, maxStockLevel: 50,
      metadata: { duration: "full day", difficulty: "moderate", highlights: ["gorge walk", "cycling", "hot springs"] },
    },
    {
      sku: "TREK-ABERDARES-3D", name: "Aberdares Hiking & Waterfalls — 3 Days",
      description: "3-day trek through the Aberdare ranges. Karuru Falls (273m), bamboo forest, moorlands. Treetop lodge accommodation. Rhino and bongo sightings possible.",
      categoryId: catTrekking.id, unit: "person", price: "520.00", costPrice: "310.00", taxRate: "0.16",
      minStockLevel: 2, reorderPoint: 4, maxStockLevel: 16,
      metadata: { duration: "3 days / 2 nights", difficulty: "moderate", highlights: ["Karuru Falls", "bamboo forest", "moorlands"] },
    },
    {
      sku: "TREK-LONGONOT", name: "Mt Longonot Crater Hike — Day Trip",
      description: "Hike to the rim of Mt Longonot volcanic crater (2,776m). 360° Rift Valley views. Moderate 3-4 hour ascent. Option to circumnavigate crater rim (full day).",
      categoryId: catTrekking.id, unit: "person", price: "65.00", costPrice: "30.00", taxRate: "0.16",
      minStockLevel: 6, reorderPoint: 10, maxStockLevel: 50,
      metadata: { duration: "half day or full day", difficulty: "moderate", altitude: "2,776m" },
    },
    {
      sku: "TREK-CHYULU", name: "Chyulu Hills Walking Safari — 2 Days",
      description: "Walking safari across the green hills of Chyulu. Volcanic caves, Kilimanjaro views, Maasai guides. Night camp under the stars. Raw, authentic Kenya.",
      categoryId: catTrekking.id, unit: "person", price: "380.00", costPrice: "220.00", taxRate: "0.16",
      minStockLevel: 2, reorderPoint: 3, maxStockLevel: 12,
      metadata: { duration: "2 days / 1 night", difficulty: "moderate", highlights: ["volcanic caves", "Kili views", "wild camping"] },
    },

    // ── Vehicle Hire ────────────────────────────────────
    {
      sku: "VEH-LANDCRUISER", name: "Toyota Land Cruiser 4x4 — Per Day",
      description: "Pop-up roof safari Land Cruiser. 6-seater, high clearance, radio. Driver/guide included. Fuel extra. Ideal for Mara, Amboseli, Samburu game drives.",
      categoryId: catVehicles.id, unit: "day", price: "250.00", costPrice: "150.00", taxRate: "0.16",
      minStockLevel: 3, reorderPoint: 5, maxStockLevel: 15,
      metadata: { capacity: 6, type: "4x4 safari", features: ["pop-up roof", "radio", "cooler box"], fuel: "excluded", driver: "included" },
    },
    {
      sku: "VEH-HIACE", name: "Toyota HiAce Safari Van — Per Day",
      description: "8-seater safari van with pop-up roof. Good for group safaris and park transfers. Driver included. Air conditioning.",
      categoryId: catVehicles.id, unit: "day", price: "180.00", costPrice: "100.00", taxRate: "0.16",
      minStockLevel: 4, reorderPoint: 6, maxStockLevel: 20,
      metadata: { capacity: 8, type: "safari van", features: ["pop-up roof", "AC"], driver: "included" },
    },
    {
      sku: "VEH-MINIBUS", name: "22-Seater Minibus — Per Day",
      description: "Large group transfer vehicle. AC, PA system. Nairobi city tours, airport transfers, conference shuttles. Driver included.",
      categoryId: catVehicles.id, unit: "day", price: "300.00", costPrice: "180.00", taxRate: "0.16",
      minStockLevel: 2, reorderPoint: 3, maxStockLevel: 8,
      metadata: { capacity: 22, type: "minibus", features: ["AC", "PA system"], driver: "included" },
    },
    {
      sku: "VEH-SELFDRIVE", name: "Self-Drive Suzuki Jimny — Per Day",
      description: "Compact 4x4 for self-drive adventures. GPS, camping rack, spare tire. Insurance and KAA permit included. Min 2 days.",
      categoryId: catVehicles.id, unit: "day", price: "95.00", costPrice: "55.00", taxRate: "0.16",
      minStockLevel: 3, reorderPoint: 5, maxStockLevel: 10,
      metadata: { capacity: 4, type: "self-drive 4x4", features: ["GPS", "roof rack", "spare tire"], driver: "self", insurance: "included" },
    },
    {
      sku: "VEH-LUXURY-SUV", name: "Luxury Range Rover — Per Day",
      description: "Premium Range Rover for VIP transfers and private game drives. Leather interior, climate control, fridge. Chauffeur included.",
      categoryId: catVehicles.id, unit: "day", price: "500.00", costPrice: "320.00", taxRate: "0.16",
      minStockLevel: 1, reorderPoint: 2, maxStockLevel: 4,
      metadata: { capacity: 4, type: "luxury SUV", tier: "premium", features: ["leather", "fridge", "climate control"], driver: "chauffeur" },
    },

    // ── Camping & Outdoor ───────────────────────────────
    {
      sku: "CAMP-BUSHSITE", name: "Bush Campsite — Per Night Per Person",
      description: "Designated bush campsite within national parks. Communal firepit, pit latrine, basic security. Bring your own tent or rent one. Night sounds of the wild.",
      categoryId: catBushCamping.id, unit: "night", price: "25.00", costPrice: "10.00", taxRate: "0.16",
      minStockLevel: 20, reorderPoint: 30, maxStockLevel: 100,
      metadata: { facilities: ["firepit", "pit latrine", "security guard"], bringOwn: ["tent", "sleeping bag", "food"] },
    },
    {
      sku: "CAMP-GLAMPING", name: "Glamping Package — Per Night",
      description: "Luxury glamping tent with real bed, hot shower, flush toilet, solar lighting, and 3-course dinner + breakfast. Stargazing deck. Staff on-site.",
      categoryId: catGlamping.id, unit: "night", price: "180.00", costPrice: "100.00", taxRate: "0.16",
      minStockLevel: 4, reorderPoint: 6, maxStockLevel: 20,
      metadata: { facilities: ["hot shower", "flush toilet", "solar", "stargazing deck"], meals: "dinner + breakfast" },
    },
    {
      sku: "CAMP-TENT-RENT", name: "2-Person Tent Rental — Per Night",
      description: "Quality 2-person dome tent with rain fly, groundsheet, and sleeping mats. Collection at any Nairobi office or park gate.",
      categoryId: catCamping.id, unit: "night", price: "15.00", costPrice: "5.00", taxRate: "0.16",
      minStockLevel: 30, reorderPoint: 40, maxStockLevel: 100,
      metadata: { capacity: 2, includes: ["rain fly", "groundsheet", "sleeping mats"] },
    },
    {
      sku: "CAMP-GEAR-PKG", name: "Full Camping Gear Package — Per Person/Day",
      description: "Complete camping kit: tent, sleeping bag, pillow, headlamp, camp chair, cookware, and jerry can. Everything for a bush camping adventure.",
      categoryId: catCamping.id, unit: "day", price: "35.00", costPrice: "12.00", taxRate: "0.16",
      minStockLevel: 15, reorderPoint: 20, maxStockLevel: 80,
      metadata: { includes: ["tent", "sleeping bag", "pillow", "headlamp", "camp chair", "cookware", "jerry can"] },
    },

    // ── Dining & Dietary Plans ──────────────────────────
    {
      sku: "MEAL-FULLBOARD", name: "Full Board Meal Plan — Per Day",
      description: "Breakfast, lunch, and dinner. Kenyan and international cuisine. Served at lodge/camp or packed for game drives. Complimentary tea/coffee.",
      categoryId: catDining.id, unit: "day", price: "65.00", costPrice: "30.00", taxRate: "0.16",
      minStockLevel: 20, reorderPoint: 30, maxStockLevel: 200,
      metadata: { meals: ["breakfast", "lunch", "dinner"], beverages: "tea/coffee included", alcoholic: "excluded" },
    },
    {
      sku: "MEAL-HALFBOARD", name: "Half Board Meal Plan — Per Day",
      description: "Breakfast and dinner. Lunch on own (packed option available at extra cost). Tea/coffee included.",
      categoryId: catDining.id, unit: "day", price: "45.00", costPrice: "20.00", taxRate: "0.16",
      minStockLevel: 20, reorderPoint: 30, maxStockLevel: 200,
      metadata: { meals: ["breakfast", "dinner"], beverages: "tea/coffee included" },
    },
    {
      sku: "MEAL-VEGAN", name: "Vegan Dietary Supplement — Per Day",
      description: "Vegan meal upgrade across all meals. Plant-based proteins, fresh tropical fruits, organic vegetables. Pre-arranged with lodge/camp kitchen.",
      categoryId: catDining.id, unit: "day", price: "15.00", costPrice: "8.00", taxRate: "0.16",
      minStockLevel: 10, reorderPoint: 15, maxStockLevel: 50,
      metadata: { dietaryType: "vegan", allergens: "nut-free options available" },
    },
    {
      sku: "MEAL-HALAL", name: "Halal Dietary Supplement — Per Day",
      description: "Halal-certified meal preparation. Sourced from certified suppliers. Available at all partner lodges and camps along the coast and in Nairobi.",
      categoryId: catDining.id, unit: "day", price: "10.00", costPrice: "5.00", taxRate: "0.16",
      minStockLevel: 10, reorderPoint: 15, maxStockLevel: 50,
      metadata: { dietaryType: "halal", certification: "Kenya Bureau of Halal Certification" },
    },
    {
      sku: "MEAL-GLUTENFREE", name: "Gluten-Free Dietary Supplement — Per Day",
      description: "Gluten-free meal preparation across all meals. Substitute breads, pasta, and cereals. Advance notice required.",
      categoryId: catDining.id, unit: "day", price: "12.00", costPrice: "6.00", taxRate: "0.16",
      minStockLevel: 8, reorderPoint: 12, maxStockLevel: 40,
      metadata: { dietaryType: "gluten-free", advanceNotice: "48 hours" },
    },
    {
      sku: "MEAL-KOSHER", name: "Kosher Dietary Supplement — Per Day",
      description: "Kosher meal option prepared by certified kitchen. Limited availability — Nairobi and select Mara lodges. 72-hour advance booking required.",
      categoryId: catDining.id, unit: "day", price: "25.00", costPrice: "15.00", taxRate: "0.16",
      minStockLevel: 4, reorderPoint: 6, maxStockLevel: 20,
      metadata: { dietaryType: "kosher", advanceNotice: "72 hours", availability: "limited" },
    },
    {
      sku: "MEAL-BUSHDINNER", name: "Bush Dinner Experience",
      description: "Private bush dinner under the stars. Lantern-lit table, nyama choma (grilled meat), Swahili coast flavors, local wines. Maasai fire dancers. Max 12 guests.",
      categoryId: catDining.id, unit: "event", price: "120.00", costPrice: "70.00", taxRate: "0.16",
      minStockLevel: 5, reorderPoint: 8, maxStockLevel: 30,
      metadata: { capacity: 12, style: "private", highlights: ["nyama choma", "Maasai dancers", "stargazing"] },
    },
    {
      sku: "MEAL-CHILD", name: "Children's Meal Plan — Per Day (Under 12)",
      description: "Kid-friendly menu for children under 12. Smaller portions, familiar foods plus Kenyan treats. Included with most family packages at 50% rate.",
      categoryId: catDining.id, unit: "day", price: "30.00", costPrice: "15.00", taxRate: "0.16",
      minStockLevel: 10, reorderPoint: 15, maxStockLevel: 50,
      metadata: { ageGroup: "under 12", dietaryType: "standard children's" },
    },

    // ── Cultural Experiences ────────────────────────────
    {
      sku: "CULT-MAASAI", name: "Maasai Village Visit & Cultural Immersion",
      description: "Half-day visit to a Maasai manyatta (homestead). Traditional welcome dance, bead-making workshop, warrior jumping, homestead tour. Direct community benefit fee included.",
      categoryId: catCultural.id, unit: "person", price: "55.00", costPrice: "25.00", taxRate: "0.16",
      minStockLevel: 10, reorderPoint: 15, maxStockLevel: 60,
      metadata: { duration: "half day", community: "Maasai", highlights: ["welcome dance", "bead-making", "warrior jumping"] },
    },
    {
      sku: "CULT-SWAHILI", name: "Swahili Cooking Class — Mombasa",
      description: "Half-day cooking class in Old Town Mombasa. Market tour, biryani, pilau, samosas, mandazi. Take home recipes. Learn the Arab, Indian, African fusion of Swahili cuisine.",
      categoryId: catCultural.id, unit: "person", price: "45.00", costPrice: "20.00", taxRate: "0.16",
      minStockLevel: 6, reorderPoint: 10, maxStockLevel: 30,
      metadata: { duration: "half day", cuisine: "Swahili", dishes: ["biryani", "pilau", "samosas", "mandazi"] },
    },
    {
      sku: "CULT-KAREN-GIRAFFE", name: "Karen Blixen & Giraffe Centre — Day Tour",
      description: "Visit Karen Blixen Museum (Out of Africa) and the Giraffe Centre to hand-feed endangered Rothschild giraffes. Optional Kazuri Beads factory and Sheldrick Elephant Orphanage.",
      categoryId: catCultural.id, unit: "person", price: "85.00", costPrice: "45.00", taxRate: "0.16",
      minStockLevel: 8, reorderPoint: 12, maxStockLevel: 40,
      metadata: { duration: "full day", highlights: ["Karen Blixen Museum", "giraffe feeding", "Kazuri Beads"] },
    },
    {
      sku: "CULT-FORT-JESUS", name: "Fort Jesus & Old Town Mombasa Tour",
      description: "Guided tour of the 16th-century Portuguese Fort Jesus (UNESCO) and Mombasa Old Town. Spice markets, Swahili architecture, and Indian Ocean views.",
      categoryId: catCultural.id, unit: "person", price: "40.00", costPrice: "18.00", taxRate: "0.16",
      minStockLevel: 8, reorderPoint: 12, maxStockLevel: 40,
      metadata: { duration: "half day", highlights: ["Fort Jesus", "spice market", "Old Town"] },
    },

    // ── Transfers & Flights ─────────────────────────────
    {
      sku: "TRF-JKIA-NBO", name: "JKIA Airport Transfer — Nairobi",
      description: "Private airport pickup/dropoff at Jomo Kenyatta International Airport. Meet & greet with sign. AC vehicle. 24/7 availability.",
      categoryId: catTransfers.id, unit: "trip", price: "45.00", costPrice: "22.00", taxRate: "0.16",
      minStockLevel: 10, reorderPoint: 15, maxStockLevel: 60,
      metadata: { route: "JKIA ↔ Nairobi hotels", duration: "45-90 min", availability: "24/7" },
    },
    {
      sku: "TRF-WILSON-MARA", name: "Flight: Wilson Airport → Masai Mara",
      description: "Scheduled light aircraft from Wilson Airport (Nairobi) to Masai Mara airstrips (Keekorok, Musiara, Olkiombo). ~45 min flight. 15kg luggage soft bag only.",
      categoryId: catTransfers.id, unit: "person", price: "280.00", costPrice: "200.00", taxRate: "0.16",
      minStockLevel: 5, reorderPoint: 8, maxStockLevel: 30,
      metadata: { route: "Wilson → Mara", duration: "45 min", luggage: "15kg soft bag", aircraft: "Cessna Caravan" },
    },
    {
      sku: "TRF-HELI-CHARTER", name: "Helicopter Charter — Per Hour",
      description: "Private helicopter charter for scenic flights, inter-park transfers, or emergency evacuation. AS350 Squirrel. Up to 5 passengers.",
      categoryId: catTransfers.id, unit: "hour", price: "2500.00", costPrice: "1800.00", taxRate: "0.16",
      minStockLevel: 1, reorderPoint: 1, maxStockLevel: 4,
      metadata: { aircraft: "AS350 Squirrel", capacity: 5, uses: ["scenic", "transfer", "emergency"] },
    },
    {
      sku: "TRF-SGR-MOMBASA", name: "SGR Train: Nairobi → Mombasa",
      description: "Madaraka Express standard gauge railway. First class ticket. 4.5 hours Nairobi Terminus to Mombasa Terminus. Scenic Tsavo views.",
      categoryId: catTransfers.id, unit: "person", price: "35.00", costPrice: "25.00", taxRate: "0.16",
      minStockLevel: 10, reorderPoint: 15, maxStockLevel: 60,
      metadata: { route: "Nairobi → Mombasa", duration: "4.5 hours", class: "first", highlights: ["Tsavo views"] },
    },
  ];

  const insertedProducts = [];
  for (const p of productData) {
    const [inserted] = await db.insert(products).values(p as any).returning();
    insertedProducts.push(inserted);
  }

  console.log(`   ✓ ${insertedProducts.length} products created\n`);

  // ══════════════════════════════════════════════════════════
  // 3. WAREHOUSES (operational locations)
  // ══════════════════════════════════════════════════════════
  console.log("🏢 Creating operational locations...");

  const warehouseData = [
    { name: "Nairobi Head Office", code: "NBO-HQ", address: "Kilimani, Nairobi, Kenya", isDefault: true, metadata: { type: "headquarters", phone: "+254 20 xxx xxxx" } },
    { name: "Mombasa Coastal Office", code: "MSA-CO", address: "Nyali, Mombasa, Kenya", metadata: { type: "regional office", phone: "+254 41 xxx xxxx" } },
    { name: "Masai Mara Operations Base", code: "MARA-OPS", address: "Narok County, Kenya", metadata: { type: "field office", phone: "+254 7xx xxx xxx" } },
    { name: "Diani Beach Office", code: "DIANI-OFC", address: "Diani Beach Road, Kwale County", metadata: { type: "satellite office" } },
    { name: "Nanyuki Mt Kenya Base", code: "NANYUKI-BASE", address: "Nanyuki, Laikipia County", metadata: { type: "mountain operations" } },
    { name: "Vehicle Depot — Nairobi", code: "NBO-DEPOT", address: "Industrial Area, Nairobi", metadata: { type: "vehicle depot", capacity: "30 vehicles" } },
  ];

  const insertedWarehouses = [];
  for (const w of warehouseData) {
    const [inserted] = await db.insert(warehouses).values(w as any).returning();
    insertedWarehouses.push(inserted);
  }

  console.log(`   ✓ ${insertedWarehouses.length} locations created\n`);

  // ══════════════════════════════════════════════════════════
  // 4. INVENTORY (availability per location)
  // ══════════════════════════════════════════════════════════
  console.log("📦 Setting up inventory (availability)...");

  let inventoryCount = 0;
  const nboHQ = insertedWarehouses[0];
  const msaOffice = insertedWarehouses[1];
  const maraOps = insertedWarehouses[2];
  const dianiOffice = insertedWarehouses[3];
  const nanyukiBase = insertedWarehouses[4];
  const vehicleDepot = insertedWarehouses[5];

  for (const product of insertedProducts) {
    const sku = product.sku;
    let locations: { wh: typeof nboHQ; qty: number; reserved: number }[] = [];

    // Assign inventory based on product type
    if (sku.startsWith("SAF-") || sku.startsWith("BIRD-")) {
      locations = [
        { wh: nboHQ, qty: randomInt(8, 24), reserved: randomInt(1, 5) },
        { wh: maraOps, qty: randomInt(4, 16), reserved: randomInt(0, 3) },
      ];
    } else if (sku.startsWith("BCH-") || sku.startsWith("ACC-DIANI") || sku.startsWith("ACC-LAMU")) {
      locations = [
        { wh: msaOffice, qty: randomInt(6, 30), reserved: randomInt(1, 6) },
        { wh: dianiOffice, qty: randomInt(4, 20), reserved: randomInt(0, 4) },
      ];
    } else if (sku.startsWith("VEH-")) {
      locations = [
        { wh: vehicleDepot, qty: randomInt(3, 12), reserved: randomInt(1, 4) },
        { wh: maraOps, qty: randomInt(1, 5), reserved: randomInt(0, 2) },
      ];
    } else if (sku.startsWith("TREK-")) {
      locations = [
        { wh: nboHQ, qty: randomInt(6, 20), reserved: randomInt(1, 4) },
        { wh: nanyukiBase, qty: randomInt(4, 16), reserved: randomInt(0, 3) },
      ];
    } else if (sku.startsWith("CAMP-")) {
      locations = [
        { wh: nboHQ, qty: randomInt(15, 50), reserved: randomInt(2, 8) },
        { wh: maraOps, qty: randomInt(5, 20), reserved: randomInt(1, 4) },
        { wh: nanyukiBase, qty: randomInt(5, 15), reserved: randomInt(0, 3) },
      ];
    } else if (sku.startsWith("MEAL-")) {
      locations = [
        { wh: nboHQ, qty: randomInt(30, 100), reserved: randomInt(5, 20) },
        { wh: msaOffice, qty: randomInt(20, 60), reserved: randomInt(3, 12) },
        { wh: maraOps, qty: randomInt(15, 50), reserved: randomInt(2, 10) },
      ];
    } else if (sku.startsWith("CULT-")) {
      locations = [
        { wh: nboHQ, qty: randomInt(10, 30), reserved: randomInt(2, 6) },
      ];
    } else if (sku.startsWith("TRF-")) {
      locations = [
        { wh: nboHQ, qty: randomInt(10, 40), reserved: randomInt(2, 8) },
      ];
    } else {
      locations = [
        { wh: nboHQ, qty: randomInt(5, 20), reserved: randomInt(0, 3) },
      ];
    }

    for (const loc of locations) {
      await db.insert(inventory).values({
        productId: product.id,
        warehouseId: loc.wh.id,
        quantity: loc.qty,
        reservedQuantity: loc.reserved,
      });
      inventoryCount++;
    }
  }

  console.log(`   ✓ ${inventoryCount} inventory records created\n`);

  // ══════════════════════════════════════════════════════════
  // 5. CUSTOMERS
  // ══════════════════════════════════════════════════════════
  console.log("👥 Creating customers...");

  const customerData = [
    // Travel agencies & tour operators
    { name: "Abercrombie & Kent East Africa", email: "bookings@abercrombiekent.co.ke", phone: "+254 20 695 0000", address: "Mombasa Road, Nairobi", taxId: "P051234567A", creditLimit: "50000.00", balance: "12500.00", metadata: { type: "tour operator", tier: "premium", market: "luxury international" } },
    { name: "Pollman's Tours & Safaris", email: "info@pollmans.com", phone: "+254 41 231 2055", address: "Moi Avenue, Mombasa", taxId: "P051234568B", creditLimit: "30000.00", balance: "8200.00", metadata: { type: "tour operator", market: "mid-range" } },
    { name: "Somak Safaris International", email: "reservations@somak.com", phone: "+254 20 535 502", address: "Reinsurance Plaza, Nairobi", taxId: "P051234569C", creditLimit: "40000.00", balance: "6800.00", metadata: { type: "tour operator", market: "international group" } },
    { name: "Bonfire Adventures", email: "info@bonfireadventures.com", phone: "+254 722 387 654", address: "CBD, Nairobi", taxId: "P051234570D", creditLimit: "20000.00", balance: "4500.00", metadata: { type: "tour operator", market: "domestic & E. Africa" } },
    { name: "Gamewatchers Safaris", email: "info@gamewatchers.com", phone: "+254 20 712 3129", address: "Karen, Nairobi", taxId: "P051234571E", creditLimit: "35000.00", balance: "9100.00", metadata: { type: "safari operator", market: "eco-tourism" } },

    // Corporate clients
    { name: "Safaricom PLC — Events", email: "events@safaricom.co.ke", phone: "+254 722 000 100", address: "Safaricom House, Nairobi", taxId: "P051234572F", creditLimit: "80000.00", balance: "0.00", metadata: { type: "corporate", industry: "telecom" } },
    { name: "Kenya Airways — Crew Leisure", email: "crew.leisure@kenya-airways.com", phone: "+254 20 642 2000", address: "JKIA, Nairobi", taxId: "P051234573G", creditLimit: "25000.00", balance: "3200.00", metadata: { type: "corporate", industry: "aviation" } },
    { name: "Equity Bank — Team Building", email: "hr.events@equitybank.co.ke", phone: "+254 763 063 000", address: "Equity Centre, Nairobi", taxId: "P051234574H", creditLimit: "30000.00", balance: "0.00", metadata: { type: "corporate", industry: "banking" } },

    // International agents
    { name: "TUI Group — Kenya Desk", email: "kenya@tui.com", phone: "+44 20 3451 2688", address: "London, United Kingdom", creditLimit: "100000.00", balance: "22500.00", metadata: { type: "international agent", market: "European package holidays" } },
    { name: "Kuoni Travel — Africa", email: "africa@kuoni.ch", phone: "+41 44 277 4444", address: "Zurich, Switzerland", creditLimit: "75000.00", balance: "18000.00", metadata: { type: "international agent", market: "Swiss luxury" } },
    { name: "Intrepid Travel — East Africa", email: "eastafrica@intrepidtravel.com", phone: "+61 3 9473 2626", address: "Melbourne, Australia", creditLimit: "45000.00", balance: "7500.00", metadata: { type: "international agent", market: "adventure travel" } },
    { name: "G Adventures — Kenya", email: "kenya@gadventures.com", phone: "+1 416 260 0999", address: "Toronto, Canada", creditLimit: "40000.00", balance: "5300.00", metadata: { type: "international agent", market: "small group adventure" } },

    // Direct clients (individual travelers)
    { name: "Dr. James Mitchell", email: "j.mitchell@gmail.com", phone: "+1 415 555 0147", address: "San Francisco, CA, USA", creditLimit: "5000.00", balance: "1200.00", metadata: { type: "individual", nationality: "American", interests: ["birdwatching", "photography"] } },
    { name: "Yuki & Takeshi Tanaka", email: "tanaka.travel@yahoo.co.jp", phone: "+81 90 1234 5678", address: "Tokyo, Japan", creditLimit: "8000.00", balance: "0.00", metadata: { type: "individual", nationality: "Japanese", interests: ["safari", "cultural"] } },
    { name: "Familie Schmidt", email: "schmidt.familie@web.de", phone: "+49 171 234 5678", address: "Munich, Germany", creditLimit: "10000.00", balance: "2400.00", metadata: { type: "family", nationality: "German", groupSize: 4, interests: ["family safari", "beach"] } },
    { name: "Wanjiku Muthoni", email: "wanjiku.m@gmail.com", phone: "+254 712 345 678", address: "Kileleshwa, Nairobi", creditLimit: "3000.00", balance: "800.00", metadata: { type: "individual", nationality: "Kenyan", interests: ["domestic travel", "trekking", "camping"] } },
    { name: "Ahmed Al-Rashid Group", email: "ahmed.alrashid@travel.ae", phone: "+971 50 123 4567", address: "Dubai, UAE", creditLimit: "30000.00", balance: "5600.00", metadata: { type: "group", nationality: "Emirati", groupSize: 8, interests: ["luxury safari", "halal dining", "beach"] } },
    { name: "Sarah & Tom Williams", email: "williams.honeymoon@gmail.com", phone: "+44 7700 123 456", address: "Bristol, United Kingdom", creditLimit: "6000.00", balance: "0.00", metadata: { type: "couple", nationality: "British", interests: ["honeymoon", "beach", "safari"] } },
  ];

  const insertedCustomers = [];
  for (const c of customerData) {
    const [inserted] = await db.insert(customers).values(c as any).returning();
    insertedCustomers.push(inserted);
  }

  console.log(`   ✓ ${insertedCustomers.length} customers created\n`);

  // ══════════════════════════════════════════════════════════
  // 6. ORDER STATUSES
  // ══════════════════════════════════════════════════════════
  console.log("📋 Creating booking statuses...");

  const statusData = [
    { name: "inquiry", label: "Inquiry", color: "#6B7280", sortOrder: 1, isDefault: true },
    { name: "quoted", label: "Quoted", color: "#3B82F6", sortOrder: 2 },
    { name: "confirmed", label: "Confirmed", color: "#10B981", sortOrder: 3 },
    { name: "deposit_paid", label: "Deposit Paid", color: "#8B5CF6", sortOrder: 4 },
    { name: "fully_paid", label: "Fully Paid", color: "#059669", sortOrder: 5 },
    { name: "in_progress", label: "In Progress", color: "#F59E0B", sortOrder: 6 },
    { name: "completed", label: "Completed", color: "#22C55E", sortOrder: 7, isFinal: true },
    { name: "cancelled", label: "Cancelled", color: "#EF4444", sortOrder: 8, isFinal: true },
    { name: "refunded", label: "Refunded", color: "#F97316", sortOrder: 9, isFinal: true },
  ];

  const insertedStatuses = [];
  for (const s of statusData) {
    const [inserted] = await db.insert(orderStatuses).values(s as any).returning();
    insertedStatuses.push(inserted);
  }

  const statusMap = Object.fromEntries(insertedStatuses.map((s) => [s.name, s]));

  console.log(`   ✓ ${insertedStatuses.length} booking statuses created\n`);

  // ══════════════════════════════════════════════════════════
  // 7. TAX RULES
  // ══════════════════════════════════════════════════════════
  console.log("💰 Creating tax rules...");

  const taxData = [
    { name: "Standard VAT (16%)", rate: "0.16", appliesTo: "all", isDefault: true, metadata: { authority: "Kenya Revenue Authority", description: "Standard rate for tourism services" } },
    { name: "Exempt — Park Fees", rate: "0.00", appliesTo: "category", metadata: { description: "National park fees are VAT-exempt" } },
    { name: "Exempt — International Flights", rate: "0.00", appliesTo: "category", metadata: { description: "International transport exempt per KRA" } },
    { name: "Reduced — Accommodation (VAT)", rate: "0.16", appliesTo: "category", metadata: { description: "Standard VAT on accommodation services" } },
    { name: "Catering Levy (2%)", rate: "0.02", appliesTo: "category", metadata: { description: "Catering/restaurant services levy" } },
  ];

  for (const t of taxData) {
    await db.insert(taxRules).values(t as any);
  }

  console.log(`   ✓ ${taxData.length} tax rules created\n`);

  // ══════════════════════════════════════════════════════════
  // 8. USERS
  // ══════════════════════════════════════════════════════════
  console.log("👤 Creating users...");

  const userData = [
    { email: "admin@safaribiq.co.ke", name: "Philip Maina", role: "admin", metadata: { department: "management" } },
    { email: "ops@safaribiq.co.ke", name: "Grace Wanjiru", role: "manager", metadata: { department: "operations" } },
    { email: "bookings@safaribiq.co.ke", name: "James Ochieng", role: "staff", metadata: { department: "reservations" } },
    { email: "coast@safaribiq.co.ke", name: "Fatma Hassan", role: "staff", metadata: { department: "coastal operations" } },
    { email: "accounts@safaribiq.co.ke", name: "David Kimani", role: "staff", metadata: { department: "finance" } },
    { email: "guide.mara@safaribiq.co.ke", name: "Ole Nkaissery", role: "staff", metadata: { department: "field guides", specialization: "Masai Mara" } },
    { email: "guide.mountain@safaribiq.co.ke", name: "Peter Nderitu", role: "staff", metadata: { department: "field guides", specialization: "Mt Kenya trekking" } },
  ];

  const insertedUsers = [];
  for (const u of userData) {
    const [inserted] = await db.insert(users).values(u as any).returning();
    insertedUsers.push(inserted);
  }

  console.log(`   ✓ ${insertedUsers.length} users created\n`);

  // ══════════════════════════════════════════════════════════
  // 9. ORDERS (bookings)
  // ══════════════════════════════════════════════════════════
  console.log("📝 Creating sample bookings...");

  const bookingScenarios = [
    // Completed luxury Mara safari
    {
      customer: insertedCustomers[0], // A&K
      status: statusMap["completed"],
      notes: "VIP group from New York. 4 adults. Luxury lodge, balloon ride, bush dinner. Very satisfied — left 5-star review.",
      items: [
        { product: insertedProducts.find((p) => p.sku === "SAF-MARA-5D")!, qty: 4 },
        { product: insertedProducts.find((p) => p.sku === "ACC-MARA-LUXURY")!, qty: 16 },
        { product: insertedProducts.find((p) => p.sku === "MEAL-FULLBOARD")!, qty: 16 },
        { product: insertedProducts.find((p) => p.sku === "TRF-WILSON-MARA")!, qty: 4 },
        { product: insertedProducts.find((p) => p.sku === "MEAL-BUSHDINNER")!, qty: 1 },
      ],
    },
    // Confirmed family safari + beach combo
    {
      customer: insertedCustomers[14], // Familie Schmidt
      status: statusMap["confirmed"],
      notes: "German family of 4 (2 adults, 2 children). Mara + Diani combo. 10 days total. Vegetarian meals for wife.",
      items: [
        { product: insertedProducts.find((p) => p.sku === "SAF-MARA-3D")!, qty: 4 },
        { product: insertedProducts.find((p) => p.sku === "ACC-MARA-TENT")!, qty: 8 },
        { product: insertedProducts.find((p) => p.sku === "ACC-DIANI-RESORT")!, qty: 20 },
        { product: insertedProducts.find((p) => p.sku === "MEAL-FULLBOARD")!, qty: 24 },
        { product: insertedProducts.find((p) => p.sku === "MEAL-CHILD")!, qty: 16 },
        { product: insertedProducts.find((p) => p.sku === "BCH-DIANI-SNORK")!, qty: 4 },
        { product: insertedProducts.find((p) => p.sku === "VEH-LANDCRUISER")!, qty: 3 },
        { product: insertedProducts.find((p) => p.sku === "TRF-JKIA-NBO")!, qty: 2 },
      ],
    },
    // In-progress Mt Kenya trek
    {
      customer: insertedCustomers[15], // Wanjiku Muthoni
      status: statusMap["in_progress"],
      notes: "Solo Kenyan trekker. Point Lenana summit attempt. Camping gear rented. Budget-conscious.",
      items: [
        { product: insertedProducts.find((p) => p.sku === "TREK-MTKENYA-5D")!, qty: 1 },
        { product: insertedProducts.find((p) => p.sku === "ACC-NANYUKI-CAMP")!, qty: 1 },
        { product: insertedProducts.find((p) => p.sku === "CAMP-GEAR-PKG")!, qty: 5 },
        { product: insertedProducts.find((p) => p.sku === "MEAL-FULLBOARD")!, qty: 5 },
      ],
    },
    // Quoted group safari — UAE
    {
      customer: insertedCustomers[16], // Ahmed Al-Rashid
      status: statusMap["quoted"],
      notes: "8-person Emirates group. Luxury Mara + Amboseli. Halal meals essential. Private vehicles only. Possible Lamu extension.",
      items: [
        { product: insertedProducts.find((p) => p.sku === "SAF-MARA-5D")!, qty: 8 },
        { product: insertedProducts.find((p) => p.sku === "SAF-AMBO-3D")!, qty: 8 },
        { product: insertedProducts.find((p) => p.sku === "ACC-MARA-LUXURY")!, qty: 32 },
        { product: insertedProducts.find((p) => p.sku === "ACC-AMBO-LODGE")!, qty: 16 },
        { product: insertedProducts.find((p) => p.sku === "MEAL-FULLBOARD")!, qty: 56 },
        { product: insertedProducts.find((p) => p.sku === "MEAL-HALAL")!, qty: 56 },
        { product: insertedProducts.find((p) => p.sku === "VEH-LANDCRUISER")!, qty: 7 },
        { product: insertedProducts.find((p) => p.sku === "VEH-LUXURY-SUV")!, qty: 1 },
        { product: insertedProducts.find((p) => p.sku === "TRF-WILSON-MARA")!, qty: 8 },
      ],
    },
    // Deposit paid — British honeymoon
    {
      customer: insertedCustomers[17], // Williams honeymoon
      status: statusMap["deposit_paid"],
      notes: "Honeymoon couple. Mara luxury + Diani beach. Hot air balloon. Bush dinner. Special room setup requested.",
      items: [
        { product: insertedProducts.find((p) => p.sku === "SAF-MARA-3D")!, qty: 2 },
        { product: insertedProducts.find((p) => p.sku === "ACC-MARA-LUXURY")!, qty: 6 },
        { product: insertedProducts.find((p) => p.sku === "ACC-DIANI-RESORT")!, qty: 8 },
        { product: insertedProducts.find((p) => p.sku === "MEAL-FULLBOARD")!, qty: 14 },
        { product: insertedProducts.find((p) => p.sku === "MEAL-BUSHDINNER")!, qty: 1 },
        { product: insertedProducts.find((p) => p.sku === "BCH-LAMU-DHOW")!, qty: 2 },
        { product: insertedProducts.find((p) => p.sku === "VEH-LANDCRUISER")!, qty: 3 },
      ],
    },
    // Completed birdwatching tour
    {
      customer: insertedCustomers[12], // Dr. Mitchell
      status: statusMap["completed"],
      notes: "Avid birder from California. 10-day Kenya birding circuit. 547 species recorded. Kakamega + Baringo + Coast. Photography focus.",
      items: [
        { product: insertedProducts.find((p) => p.sku === "BIRD-KAKAMEGA-3D")!, qty: 1 },
        { product: insertedProducts.find((p) => p.sku === "BIRD-BARINGO-2D")!, qty: 1 },
        { product: insertedProducts.find((p) => p.sku === "BIRD-COAST-5D")!, qty: 1 },
        { product: insertedProducts.find((p) => p.sku === "VEH-LANDCRUISER")!, qty: 10 },
        { product: insertedProducts.find((p) => p.sku === "MEAL-FULLBOARD")!, qty: 10 },
        { product: insertedProducts.find((p) => p.sku === "MEAL-VEGAN")!, qty: 10 },
      ],
    },
    // Inquiry — corporate team building
    {
      customer: insertedCustomers[7], // Equity Bank
      status: statusMap["inquiry"],
      notes: "40-person team building at Hell's Gate + Lake Naivasha. 2 days. Budget per head: $150 max. Need team activities.",
      items: [
        { product: insertedProducts.find((p) => p.sku === "TREK-HELLSGATE")!, qty: 40 },
        { product: insertedProducts.find((p) => p.sku === "BIRD-NAIVASHA")!, qty: 40 },
        { product: insertedProducts.find((p) => p.sku === "MEAL-FULLBOARD")!, qty: 80 },
        { product: insertedProducts.find((p) => p.sku === "VEH-MINIBUS")!, qty: 4 },
      ],
    },
    // Inquiry — Intrepid small group
    {
      customer: insertedCustomers[10], // Intrepid Travel
      status: statusMap["inquiry"],
      notes: "12-person adventure group. Budget camping safari + cultural experiences. Need Maasai visit and cooking class.",
      items: [
        { product: insertedProducts.find((p) => p.sku === "SAF-MARA-3D")!, qty: 12 },
        { product: insertedProducts.find((p) => p.sku === "CAMP-BUSHSITE")!, qty: 24 },
        { product: insertedProducts.find((p) => p.sku === "CAMP-GEAR-PKG")!, qty: 36 },
        { product: insertedProducts.find((p) => p.sku === "CULT-MAASAI")!, qty: 12 },
        { product: insertedProducts.find((p) => p.sku === "CULT-SWAHILI")!, qty: 12 },
        { product: insertedProducts.find((p) => p.sku === "MEAL-HALFBOARD")!, qty: 36 },
        { product: insertedProducts.find((p) => p.sku === "VEH-HIACE")!, qty: 3 },
      ],
    },
    // Fully paid — Japanese couple
    {
      customer: insertedCustomers[13], // Tanaka
      status: statusMap["fully_paid"],
      notes: "Japanese couple. Amboseli + Mara migration safari. Very interested in photography. Cultural experiences requested.",
      items: [
        { product: insertedProducts.find((p) => p.sku === "SAF-MIGRATION")!, qty: 2 },
        { product: insertedProducts.find((p) => p.sku === "ACC-MARA-LUXURY")!, qty: 6 },
        { product: insertedProducts.find((p) => p.sku === "ACC-AMBO-LODGE")!, qty: 4 },
        { product: insertedProducts.find((p) => p.sku === "MEAL-FULLBOARD")!, qty: 14 },
        { product: insertedProducts.find((p) => p.sku === "CULT-MAASAI")!, qty: 2 },
        { product: insertedProducts.find((p) => p.sku === "CULT-KAREN-GIRAFFE")!, qty: 2 },
        { product: insertedProducts.find((p) => p.sku === "TRF-JKIA-NBO")!, qty: 2 },
      ],
    },
    // Completed — TUI group package
    {
      customer: insertedCustomers[8], // TUI Group
      status: statusMap["completed"],
      notes: "European group of 16. Standard Mara + Amboseli + Tsavo package. 12 days. Recurring monthly bookings.",
      items: [
        { product: insertedProducts.find((p) => p.sku === "SAF-MARA-3D")!, qty: 16 },
        { product: insertedProducts.find((p) => p.sku === "SAF-AMBO-3D")!, qty: 16 },
        { product: insertedProducts.find((p) => p.sku === "SAF-TSAVO-4D")!, qty: 16 },
        { product: insertedProducts.find((p) => p.sku === "ACC-MARA-TENT")!, qty: 32 },
        { product: insertedProducts.find((p) => p.sku === "MEAL-FULLBOARD")!, qty: 160 },
        { product: insertedProducts.find((p) => p.sku === "VEH-HIACE")!, qty: 24 },
        { product: insertedProducts.find((p) => p.sku === "TRF-JKIA-NBO")!, qty: 16 },
      ],
    },
    // Confirmed — Glamping adventure
    {
      customer: insertedCustomers[9], // Kuoni Travel
      status: statusMap["confirmed"],
      notes: "Swiss luxury glamping safari. 6 guests. Laikipia conservancy + Mara. Walking safari emphasis. High-end dietary requirements.",
      items: [
        { product: insertedProducts.find((p) => p.sku === "SAF-LAIKIPIA-4D")!, qty: 6 },
        { product: insertedProducts.find((p) => p.sku === "SAF-MARA-3D")!, qty: 6 },
        { product: insertedProducts.find((p) => p.sku === "CAMP-GLAMPING")!, qty: 36 },
        { product: insertedProducts.find((p) => p.sku === "MEAL-FULLBOARD")!, qty: 42 },
        { product: insertedProducts.find((p) => p.sku === "MEAL-GLUTENFREE")!, qty: 14 },
        { product: insertedProducts.find((p) => p.sku === "VEH-LANDCRUISER")!, qty: 7 },
        { product: insertedProducts.find((p) => p.sku === "TRF-WILSON-MARA")!, qty: 6 },
      ],
    },
    // Cancelled booking
    {
      customer: insertedCustomers[3], // Bonfire Adventures
      status: statusMap["cancelled"],
      notes: "Group booking cancelled due to client travel advisory change. Full refund processed.",
      items: [
        { product: insertedProducts.find((p) => p.sku === "SAF-MARA-3D")!, qty: 20 },
        { product: insertedProducts.find((p) => p.sku === "ACC-MARA-TENT")!, qty: 40 },
        { product: insertedProducts.find((p) => p.sku === "MEAL-FULLBOARD")!, qty: 60 },
      ],
    },
    // SGR train booking
    {
      customer: insertedCustomers[5], // Safaricom
      status: statusMap["confirmed"],
      notes: "Safaricom staff retreat. 30 people. SGR to Mombasa + Diani beach weekend. Team building activities TBC.",
      items: [
        { product: insertedProducts.find((p) => p.sku === "TRF-SGR-MOMBASA")!, qty: 60 },
        { product: insertedProducts.find((p) => p.sku === "ACC-DIANI-RESORT")!, qty: 60 },
        { product: insertedProducts.find((p) => p.sku === "MEAL-FULLBOARD")!, qty: 60 },
        { product: insertedProducts.find((p) => p.sku === "BCH-KITESURF")!, qty: 10 },
        { product: insertedProducts.find((p) => p.sku === "BCH-DIANI-SNORK")!, qty: 30 },
      ],
    },
    // Kitesurfing package
    {
      customer: insertedCustomers[11], // G Adventures
      status: statusMap["deposit_paid"],
      notes: "Adventure group, 8 pax. Kitesurfing + diving + dhow sailing. Diani & Watamu combo.",
      items: [
        { product: insertedProducts.find((p) => p.sku === "BCH-KITESURF")!, qty: 8 },
        { product: insertedProducts.find((p) => p.sku === "BCH-WATAMU-DIVE")!, qty: 8 },
        { product: insertedProducts.find((p) => p.sku === "BCH-LAMU-DHOW")!, qty: 8 },
        { product: insertedProducts.find((p) => p.sku === "ACC-DIANI-RESORT")!, qty: 24 },
        { product: insertedProducts.find((p) => p.sku === "ACC-LAMU-HOUSE")!, qty: 16 },
        { product: insertedProducts.find((p) => p.sku === "MEAL-HALFBOARD")!, qty: 40 },
      ],
    },
    // Deep sea fishing
    {
      customer: insertedCustomers[6], // KQ Crew
      status: statusMap["completed"],
      notes: "KQ crew layover activity. 2 boats, full day fishing. Malindi. Caught 2 sailfish!",
      items: [
        { product: insertedProducts.find((p) => p.sku === "BCH-FISHING")!, qty: 2 },
        { product: insertedProducts.find((p) => p.sku === "MEAL-HALFBOARD")!, qty: 12 },
      ],
    },
  ];

  let orderCount = 0;
  let orderItemCount = 0;

  for (const booking of bookingScenarios) {
    // Calculate totals
    let subtotal = 0;
    const lineItems: { product: any; qty: number; unitPrice: number; lineTotal: number }[] = [];

    for (const item of booking.items) {
      if (!item.product) continue;
      const unitPrice = parseFloat(item.product.price);
      const lineTotal = unitPrice * item.qty;
      subtotal += lineTotal;
      lineItems.push({ product: item.product, qty: item.qty, unitPrice, lineTotal });
    }

    const taxAmount = subtotal * 0.16;
    const totalAmount = subtotal + taxAmount;

    const [order] = await db.insert(orders).values({
      orderNumber: generateOrderNumber(orderCount + 1),
      customerId: booking.customer.id,
      statusId: booking.status.id,
      subtotal: subtotal.toFixed(2),
      taxAmount: taxAmount.toFixed(2),
      totalAmount: totalAmount.toFixed(2),
      notes: booking.notes,
      warehouseId: nboHQ.id,
      metadata: { source: "seed-demo", bookingType: "tourism" },
    } as any).returning();

    for (const li of lineItems) {
      const itemTax = li.lineTotal * 0.16;
      await db.insert(orderItems).values({
        orderId: order.id,
        productId: li.product.id,
        quantity: li.qty,
        unitPrice: li.unitPrice.toFixed(2),
        taxRate: "0.16",
        taxAmount: itemTax.toFixed(2),
        totalAmount: (li.lineTotal + itemTax).toFixed(2),
      } as any);
      orderItemCount++;
    }

    orderCount++;
  }

  console.log(`   ✓ ${orderCount} bookings created with ${orderItemCount} line items\n`);

  // ══════════════════════════════════════════════════════════
  // 10. INVOICES & PAYMENTS
  // ══════════════════════════════════════════════════════════
  console.log("🧾 Creating invoices & payments...");

  // Get orders that should have invoices (confirmed, deposit_paid, fully_paid, completed)
  const allOrders = await db.select().from(orders);
  let invoiceCount = 0;
  let paymentCount = 0;

  for (const order of allOrders) {
    const orderStatus = insertedStatuses.find((s) => s.id === order.statusId);
    if (!orderStatus) continue;

    const statusName = orderStatus.name;
    if (["inquiry", "cancelled"].includes(statusName)) continue;

    const total = parseFloat(order.totalAmount);
    let invoiceStatus = "draft";
    let paidAmount = 0;

    if (statusName === "completed" || statusName === "fully_paid") {
      invoiceStatus = "paid";
      paidAmount = total;
    } else if (statusName === "deposit_paid") {
      invoiceStatus = "sent";
      paidAmount = total * 0.3; // 30% deposit
    } else if (statusName === "confirmed" || statusName === "in_progress") {
      invoiceStatus = "sent";
      paidAmount = 0;
    } else if (statusName === "quoted") {
      invoiceStatus = "draft";
      paidAmount = 0;
    }

    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 30);

    const [invoice] = await db.insert(invoices).values({
      invoiceNumber: generateInvoiceNumber(invoiceCount + 1),
      orderId: order.id,
      customerId: order.customerId,
      status: invoiceStatus,
      subtotal: order.subtotal,
      taxAmount: order.taxAmount,
      totalAmount: order.totalAmount,
      paidAmount: paidAmount.toFixed(2),
      dueDate,
      paidAt: invoiceStatus === "paid" ? randomDate(30) : null,
      notes: `Invoice for booking ${order.orderNumber}`,
    } as any).returning();

    invoiceCount++;

    // Create payment records for paid invoices
    if (paidAmount > 0) {
      const methods = ["mpesa", "bank_transfer", "credit_card", "cash"];
      const method = methods[randomInt(0, methods.length - 1)];

      await db.insert(payments).values({
        invoiceId: invoice.id,
        amount: paidAmount.toFixed(2),
        method,
        reference: method === "mpesa" ? `MPESA-${randomInt(100000, 999999)}` : method === "bank_transfer" ? `BNK-${randomInt(10000, 99999)}` : `CC-${randomInt(1000, 9999)}`,
        notes: statusName === "deposit_paid" ? "30% deposit payment" : "Full payment received",
      } as any);
      paymentCount++;
    }
  }

  console.log(`   ✓ ${invoiceCount} invoices and ${paymentCount} payments created\n`);

  // ══════════════════════════════════════════════════════════
  // SUMMARY
  // ══════════════════════════════════════════════════════════
  console.log("═══════════════════════════════════════════════════");
  console.log("🎉 Kenyan Tourism Demo Data — Seeding Complete!");
  console.log("═══════════════════════════════════════════════════");
  console.log(`   Categories:     15`);
  console.log(`   Products:       ${insertedProducts.length}`);
  console.log(`   Locations:      ${insertedWarehouses.length}`);
  console.log(`   Inventory:      ${inventoryCount} records`);
  console.log(`   Customers:      ${insertedCustomers.length}`);
  console.log(`   Order Statuses: ${insertedStatuses.length}`);
  console.log(`   Tax Rules:      ${taxData.length}`);
  console.log(`   Users:          ${insertedUsers.length}`);
  console.log(`   Bookings:       ${orderCount}`);
  console.log(`   Invoices:       ${invoiceCount}`);
  console.log(`   Payments:       ${paymentCount}`);
  console.log("═══════════════════════════════════════════════════\n");
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
