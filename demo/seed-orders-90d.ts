/**
 * Seed Script — 90-Day Order History
 *
 * Generates realistic orders distributed over the past 90 days so the
 * Dashboard Sales Trend chart and other analytics have meaningful data.
 *
 * Prerequisites: categories, products, customers, order_statuses, and
 *   warehouses must already exist (run seed-demo.ts first).
 *
 * Usage:
 *   DATABASE_URL=<your-url> bun scripts/seed-orders-90d.ts
 *
 * Safe to re-run — deletes previous orders/invoices/payments first.
 */

import { createPostgresDrizzle } from "@agentuity/drizzle";
import { sql } from "drizzle-orm";
import * as schema from "../src/db/schema";
import {
  products,
  customers,
  orderStatuses,
  warehouses,
  orders,
  orderItems,
  invoices,
  payments,
} from "../src/db/schema";

const { db, close } = createPostgresDrizzle({ schema });

// ── Helpers ──────────────────────────────────────────────────
function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomDateInRange(daysBack: number): Date {
  const now = Date.now();
  const start = now - daysBack * 86400000;
  return new Date(start + Math.random() * (now - start));
}

function fmtNum(n: number, decimals = 2): string {
  return n.toFixed(decimals);
}

// ── Main ─────────────────────────────────────────────────────
async function seed() {
  console.log("📊 Seeding 90-day order history...\n");

  // Load reference data
  const allProducts = await db.select().from(products);
  const allCustomers = await db.select().from(customers);
  const allStatuses = await db.select().from(orderStatuses);
  const allWarehouses = await db.select().from(warehouses);

  if (!allProducts.length || !allCustomers.length || !allStatuses.length) {
    console.error("❌ No products, customers, or order statuses found.");
    console.error("   Run seed-demo.ts first to create base data.");
    process.exit(1);
  }

  console.log(`   Found: ${allProducts.length} products, ${allCustomers.length} customers, ${allStatuses.length} statuses, ${allWarehouses.length} warehouses`);

  // Clean existing orders cascade
  console.log("\n🧹 Cleaning existing orders, invoices, payments...");
  await db.execute(sql`DELETE FROM payments`);
  await db.execute(sql`DELETE FROM invoices`);
  await db.execute(sql`DELETE FROM order_items`);
  await db.execute(sql`DELETE FROM orders`);
  console.log("   ✓ Cleaned\n");

  // Status lookup
  const statusByName = (name: string) =>
    allStatuses.find((s) => s.name === name) ?? allStatuses.find((s) => s.name === "completed") ?? allStatuses[0];

  // Default warehouse
  const mainWarehouse = allWarehouses[0];

  // ── Generate orders spread over 90 days ───────────────────
  // More orders in recent weeks, fewer further back (realistic growth)
  const ORDER_COUNT = 65;
  const orderDates: Date[] = [];

  for (let i = 0; i < ORDER_COUNT; i++) {
    // Weight towards recent: 40% in last 2 weeks, 35% in weeks 2-6, 25% in weeks 6-13
    const roll = Math.random();
    let daysBack: number;
    if (roll < 0.4) {
      daysBack = randomInt(0, 14);
    } else if (roll < 0.75) {
      daysBack = randomInt(15, 42);
    } else {
      daysBack = randomInt(43, 90);
    }
    const d = randomDateInRange(daysBack);
    // Set a random business hour (8am - 6pm)
    d.setHours(randomInt(8, 18), randomInt(0, 59), randomInt(0, 59));
    orderDates.push(d);
  }

  // Sort chronologically
  orderDates.sort((a, b) => a.getTime() - b.getTime());

  // Status distribution (realistic for a tourism business):
  // completed: 28%, confirmed: 22%, quoted: 17%, inquiry: 10%, cancelled: 10%,
  // deposit_paid: 8%, fully_paid: 5%
  const statusDistribution = [
    { name: "completed", weight: 28 },
    { name: "confirmed", weight: 22 },
    { name: "quoted", weight: 17 },
    { name: "inquiry", weight: 10 },
    { name: "cancelled", weight: 10 },
    { name: "deposit_paid", weight: 8 },
    { name: "fully_paid", weight: 5 },
  ];

  function pickWeightedStatus(): string {
    const total = statusDistribution.reduce((s, d) => s + d.weight, 0);
    let r = Math.random() * total;
    for (const d of statusDistribution) {
      r -= d.weight;
      if (r <= 0) return d.name;
    }
    return "completed";
  }

  // Payment methods
  const paymentMethods = ["mpesa", "bank_transfer", "cash", "card", "credit"];

  let totalOrders = 0;
  let totalItems = 0;
  let totalInvoices = 0;
  let totalPayments = 0;

  console.log("📝 Creating orders...");

  for (let i = 0; i < ORDER_COUNT; i++) {
    const orderDate = orderDates[i];
    const customer = pick(allCustomers);
    const statusName = pickWeightedStatus();
    const status = statusByName(statusName);

    // Pick 1-5 random products for this order
    const itemCount = randomInt(1, 5);
    const chosenProducts: Array<{ product: (typeof allProducts)[0]; qty: number }> = [];
    const usedProductIds = new Set<string>();

    for (let j = 0; j < itemCount; j++) {
      let product = pick(allProducts);
      // Avoid duplicates in same order
      let attempts = 0;
      while (usedProductIds.has(product.id) && attempts < 10) {
        product = pick(allProducts);
        attempts++;
      }
      if (usedProductIds.has(product.id)) continue;
      usedProductIds.add(product.id);

      const qty = randomInt(1, 6);
      chosenProducts.push({ product, qty });
    }

    if (chosenProducts.length === 0) continue;

    // Calculate totals
    let subtotal = 0;
    const lineItems: Array<{
      product: (typeof allProducts)[0];
      qty: number;
      unitPrice: number;
      lineTotal: number;
    }> = [];

    for (const { product, qty } of chosenProducts) {
      const unitPrice = parseFloat(product.price);
      const lineTotal = unitPrice * qty;
      subtotal += lineTotal;
      lineItems.push({ product, qty, unitPrice, lineTotal });
    }

    const taxRate = 0.16;
    const taxAmount = subtotal * taxRate;
    const totalAmount = subtotal + taxAmount;
    const orderNumber = `BK-${String(2026100 + i).padStart(7, "0")}`;

    // Pick payment method (only for non-inquiry/non-cancelled)
    const hasPay = !["inquiry", "cancelled", "quoted"].includes(statusName);
    const payMethod = hasPay ? pick(paymentMethods) : null;
    const payStatus =
      statusName === "fully_paid" || statusName === "completed"
        ? "paid"
        : statusName === "deposit_paid"
          ? "partial"
          : statusName === "confirmed" || statusName === "in_progress"
            ? "pending"
            : "pending";

    // Insert order with explicit created_at
    const [order] = await db
      .insert(orders)
      .values({
        orderNumber,
        customerId: customer.id,
        statusId: status.id,
        subtotal: fmtNum(subtotal),
        taxAmount: fmtNum(taxAmount),
        totalAmount: fmtNum(totalAmount),
        notes: `Auto-generated demo order #${i + 1}`,
        warehouseId: mainWarehouse?.id ?? null,
        paymentMethod: payMethod,
        paymentStatus: payStatus,
        paymentReference:
          payMethod === "mpesa"
            ? `MPESA-${randomInt(100000, 999999)}`
            : payMethod === "bank_transfer"
              ? `BNK-${randomInt(10000, 99999)}`
              : payMethod === "card"
                ? `CARD-${randomInt(1000, 9999)}`
                : null,
        metadata: { source: "seed-90d", day: orderDate.toISOString().slice(0, 10) },
      } as any)
      .returning();

    // Backdate created_at via raw SQL
    await db.execute(
      sql`UPDATE orders SET created_at = ${orderDate.toISOString()}, updated_at = ${orderDate.toISOString()} WHERE id = ${order.id}`
    );

    // Insert order items
    for (const li of lineItems) {
      const itemTax = li.lineTotal * taxRate;
      const [item] = await db
        .insert(orderItems)
        .values({
          orderId: order.id,
          productId: li.product.id,
          quantity: li.qty,
          unitPrice: fmtNum(li.unitPrice),
          taxRate: fmtNum(taxRate, 4),
          taxAmount: fmtNum(itemTax),
          totalAmount: fmtNum(li.lineTotal + itemTax),
        } as any)
        .returning();

      // Backdate item
      await db.execute(
        sql`UPDATE order_items SET created_at = ${orderDate.toISOString()}, updated_at = ${orderDate.toISOString()} WHERE id = ${item.id}`
      );
      totalItems++;
    }

    // ── Create invoice for non-inquiry orders ──
    if (!["inquiry", "cancelled"].includes(statusName)) {
      let invoiceStatus = "draft";
      let paidAmount = 0;

      if (statusName === "completed" || statusName === "fully_paid") {
        invoiceStatus = "paid";
        paidAmount = totalAmount;
      } else if (statusName === "deposit_paid") {
        invoiceStatus = "partial";
        paidAmount = totalAmount * 0.3;
      } else if (statusName === "confirmed") {
        invoiceStatus = "sent";
        paidAmount = 0;
      } else if (statusName === "quoted") {
        invoiceStatus = "draft";
        paidAmount = 0;
      }

      const dueDate = new Date(orderDate.getTime() + 30 * 86400000);
      const invoiceDate = new Date(orderDate.getTime() + randomInt(0, 2) * 86400000);
      const invNumber = `INV-${String(2026100 + i).padStart(7, "0")}`;

      // KRA verification: ~60% of paid invoices are verified, ~30% of sent invoices
      const isKraVerified =
        invoiceStatus === "paid"
          ? Math.random() < 0.6
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

      // Backdate invoice
      await db.execute(
        sql`UPDATE invoices SET created_at = ${invoiceDate.toISOString()}, updated_at = ${invoiceDate.toISOString()} WHERE id = ${invoice.id}`
      );
      totalInvoices++;

      // Create payment record for paid/partial invoices
      if (paidAmount > 0) {
        const method = payMethod ?? pick(["mpesa", "bank_transfer", "cash"]);
        const payDate = new Date(
          invoiceDate.getTime() + randomInt(0, 5) * 86400000
        );

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
                  : `PAY-${randomInt(1000, 9999)}`,
            notes:
              invoiceStatus === "paid"
                ? "Full payment received"
                : "30% deposit payment",
          } as any)
          .returning();

        await db.execute(
          sql`UPDATE payments SET created_at = ${payDate.toISOString()}, updated_at = ${payDate.toISOString()} WHERE id = ${payment.id}`
        );
        totalPayments++;
      }
    }

    totalOrders++;
  }

  console.log(`   ✓ ${totalOrders} orders created (${totalItems} line items)`);
  console.log(`   ✓ ${totalInvoices} invoices created`);
  console.log(`   ✓ ${totalPayments} payments created`);

  // ── Summary stats ──
  const revenueResult = await db.execute(
    sql`SELECT COALESCE(SUM(CAST(total_amount AS NUMERIC)), 0) as total FROM orders`
  ) as any[];
  const dateRange = await db.execute(
    sql`SELECT MIN(created_at) as earliest, MAX(created_at) as latest FROM orders`
  ) as any[];

  console.log(`\n═══════════════════════════════════════════════════`);
  console.log(`🎉 90-Day Order Seed Complete!`);
  console.log(`═══════════════════════════════════════════════════`);
  console.log(`   Orders:        ${totalOrders}`);
  console.log(`   Order Items:   ${totalItems}`);
  console.log(`   Invoices:      ${totalInvoices}`);
  console.log(`   Payments:      ${totalPayments}`);
  console.log(`   Total Revenue: ${parseFloat(revenueResult[0]?.total ?? 0).toLocaleString()} USD`);
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
