import { createAgent } from "@agentuity/runtime";
import { generateText } from "ai";
import { z } from "zod";
import { db, products, orders, orderItems, customers, inventory, invoices, payments } from "@db/index";
import { sql, eq, gte, lte, and, desc } from "drizzle-orm";
import { config } from "@lib/config";
import { getModel } from "@lib/ai";

/**
 * Report Generator Agent — AI-powered business report creation.
 *
 * Generates formatted, human-readable business reports using LLM
 * to interpret data, add context, and structure findings.
 *
 * Unlike a simple data dump, the LLM adds:
 *   - Executive summary with key callouts
 *   - Trend interpretation (not just numbers)
 *   - Actionable recommendations
 *   - Natural language formatting
 *
 * Report types:
 *   - sales-summary: Revenue, order count, top products, top customers
 *   - inventory-health: Stock levels, low stock alerts, turnover rates
 *   - customer-activity: Active customers, order frequency, spend patterns
 *   - financial-overview: Revenue, payments, outstanding invoices
 */

const inputSchema = z.object({
  reportType: z.enum([
    "sales-summary",
    "inventory-health",
    "customer-activity",
    "financial-overview",
  ]),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  format: z.enum(["markdown", "plain"]).default("markdown"),
});

const outputSchema = z.object({
  title: z.string(),
  reportType: z.string(),
  period: z.object({ start: z.string(), end: z.string() }),
  content: z.string(),
  generatedAt: z.string(),
});

/** Gather sales data for the period */
async function getSalesData(start: Date, end: Date) {
  const [revenue] = await db
    .select({
      totalRevenue: sql<number>`COALESCE(sum(${orders.totalAmount}), 0)`,
      totalTax: sql<number>`COALESCE(sum(${orders.taxAmount}), 0)`,
      totalDiscount: sql<number>`COALESCE(sum(${orders.discountAmount}), 0)`,
      orderCount: sql<number>`count(*)`,
      avgOrderValue: sql<number>`COALESCE(avg(${orders.totalAmount}), 0)`,
    })
    .from(orders)
    .where(and(gte(orders.createdAt, start), lte(orders.createdAt, end)));

  const topProducts = await db
    .select({
      name: products.name,
      sku: products.sku,
      totalSold: sql<number>`sum(${orderItems.quantity})`,
      revenue: sql<number>`sum(${orderItems.totalAmount})`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .innerJoin(products, eq(orderItems.productId, products.id))
    .where(and(gte(orders.createdAt, start), lte(orders.createdAt, end)))
    .groupBy(products.name, products.sku)
    .orderBy(sql`sum(${orderItems.totalAmount}) desc`)
    .limit(10);

  const topCustomers = await db
    .select({
      name: customers.name,
      orderCount: sql<number>`count(*)`,
      totalSpend: sql<number>`sum(${orders.totalAmount})`,
    })
    .from(orders)
    .innerJoin(customers, eq(orders.customerId, customers.id))
    .where(and(gte(orders.createdAt, start), lte(orders.createdAt, end)))
    .groupBy(customers.name)
    .orderBy(sql`sum(${orders.totalAmount}) desc`)
    .limit(10);

  return { revenue, topProducts, topCustomers };
}

/** Gather inventory health data */
async function getInventoryHealth() {
  const stockSummary = await db
    .select({
      totalItems: sql<number>`count(distinct ${inventory.productId})`,
      totalUnits: sql<number>`COALESCE(sum(${inventory.quantity}), 0)`,
      lowStockCount: sql<number>`count(*) filter (where ${inventory.quantity} <= COALESCE(${products.reorderPoint}, ${products.minStockLevel}, 0))`,
      outOfStockCount: sql<number>`count(*) filter (where ${inventory.quantity} = 0)`,
    })
    .from(inventory)
    .innerJoin(products, eq(inventory.productId, products.id));

  const lowStockItems = await db
    .select({
      name: products.name,
      sku: products.sku,
      quantity: inventory.quantity,
      reorderPoint: products.reorderPoint,
    })
    .from(inventory)
    .innerJoin(products, eq(inventory.productId, products.id))
    .where(
      sql`${inventory.quantity} <= COALESCE(${products.reorderPoint}, ${products.minStockLevel}, 0)`
    )
    .orderBy(inventory.quantity)
    .limit(20);

  return { stockSummary, lowStockItems };
}

/** Gather financial data */
async function getFinancialData(start: Date, end: Date) {
  const [invoiceSummary] = await db
    .select({
      totalInvoiced: sql<number>`COALESCE(sum(${invoices.totalAmount}), 0)`,
      totalPaid: sql<number>`COALESCE(sum(${invoices.paidAmount}), 0)`,
      outstanding: sql<number>`COALESCE(sum(${invoices.totalAmount}) - sum(${invoices.paidAmount}), 0)`,
      invoiceCount: sql<number>`count(*)`,
      overdueCount: sql<number>`count(*) filter (where ${invoices.dueDate} < now() and ${invoices.status} != 'paid')`,
    })
    .from(invoices)
    .where(and(gte(invoices.createdAt, start), lte(invoices.createdAt, end)));

  const [paymentSummary] = await db
    .select({
      totalPayments: sql<number>`COALESCE(sum(${payments.amount}), 0)`,
      paymentCount: sql<number>`count(*)`,
    })
    .from(payments)
    .where(and(gte(payments.createdAt, start), lte(payments.createdAt, end)));

  return { invoiceSummary, paymentSummary };
}

export default createAgent("report-generator", {
  schema: { input: inputSchema, output: outputSchema },
  handler: async (ctx, input) => {
    // Default to last 30 days
    const end = input.endDate ? new Date(input.endDate) : new Date();
    const start = input.startDate
      ? new Date(input.startDate)
      : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

    const periodStr = `${start.toISOString().split("T")[0]} to ${end.toISOString().split("T")[0]}`;

    // Gather relevant data based on report type
    let reportData: Record<string, unknown> = {};
    switch (input.reportType) {
      case "sales-summary":
        reportData = await getSalesData(start, end);
        break;
      case "inventory-health":
        reportData = await getInventoryHealth();
        break;
      case "customer-activity":
        reportData = await getSalesData(start, end); // reuses customer data from sales
        break;
      case "financial-overview":
        reportData = {
          sales: await getSalesData(start, end),
          financials: await getFinancialData(start, end),
        };
        break;
    }

    const reportTitles: Record<string, string> = {
      "sales-summary": `${config.labels.orderPlural} & Revenue Report`,
      "inventory-health": "Inventory Health Report",
      "customer-activity": `${config.labels.customerPlural} Activity Report`,
      "financial-overview": "Financial Overview Report",
    };

    const title = reportTitles[input.reportType];
    const formatInstruction =
      input.format === "markdown"
        ? "Format the report in clean Markdown with headers, bullet points, and tables where appropriate."
        : "Format the report in plain text, well-structured with clear sections.";

    const { text } = await generateText({
      model: getModel(),
      system: `You are a professional business report writer for ${config.companyName}.
Generate a clear, actionable business report based on the data provided.

Report structure:
1. Executive Summary (2-3 sentences, key highlights)
2. Key Metrics (the important numbers)
3. Details & Analysis (interpretation of the data)
4. Recommendations (actionable next steps)

${formatInstruction}

Use the deployment's terminology: "${config.labels.product}" for products, "${config.labels.order}" for orders, "${config.labels.customer}" for customers.
Currency: ${config.currency}
Period: ${periodStr}`,
      prompt: `Generate the "${title}" report for ${config.companyName}.

Period: ${periodStr}

Data:
${JSON.stringify(reportData, null, 2)}`,
    });

    ctx.logger.info(
      `Generated report: ${input.reportType} for period ${periodStr}`
    );

    return {
      title,
      reportType: input.reportType,
      period: {
        start: start.toISOString(),
        end: end.toISOString(),
      },
      content: text,
      generatedAt: new Date().toISOString(),
    };
  },
});
