import { createAgent } from "@agentuity/runtime";
import { generateText } from "ai";
import { z } from "zod";
import { db } from "@db/index";
import { sql } from "drizzle-orm";
import { config } from "@lib/config";
import { getModel } from "@lib/ai";
import { executeSandbox } from "@lib/sandbox";
import type { SandboxResult } from "@lib/sandbox";
import { getAISettings } from "@services/settings";

/**
 * Report Generator Agent — AI + Sandbox-powered business report creation.
 *
 * Architecture (v2 — sandbox-powered):
 *   1. Fetch raw data from DB using efficient SQL queries
 *   2. Execute data processing JavaScript in an isolated Bun sandbox
 *      (aggregations, rankings, percentage calculations, period comparisons,
 *       growth rates, pareto analysis, etc.)
 *   3. Feed the computed report data TO the LLM for human-readable narration
 *
 * The sandbox computes precise numbers, rankings, and derived metrics.
 * The LLM writes the executive summary, interprets trends, and formats
 * the report with context — something pure computation can't do.
 *
 * Report types:
 *   - sales-summary: Revenue, order count, top products, top customers, growth
 *   - inventory-health: Stock levels, low stock alerts, turnover rates, ABC analysis
 *   - customer-activity: Active customers, order frequency, spend patterns, RFM scoring
 *   - financial-overview: Revenue, payments, outstanding invoices, collection rates
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

// ────────────────────────────────────────────────────────────
// Sandbox computation code for each report type
// ────────────────────────────────────────────────────────────

const SALES_REPORT_CODE = `
// DATA = { revenue, topProducts, topCustomers, dailyRevenue }
const { revenue, topProducts, topCustomers, dailyRevenue } = DATA;

const rev = revenue[0] || {};
const totalRevenue = Number(rev.total_revenue) || 0;
const totalTax = Number(rev.total_tax) || 0;
const totalDiscount = Number(rev.total_discount) || 0;
const orderCount = Number(rev.order_count) || 0;
const avgOrderValue = orderCount > 0 ? totalRevenue / orderCount : 0;

// Revenue distribution by product (pareto analysis)
let cumRevenue = 0;
const productsWithShare = topProducts.map((p, i) => {
  const rev = Number(p.revenue) || 0;
  cumRevenue += rev;
  return {
    rank: i + 1,
    name: p.name,
    sku: p.sku,
    unitsSold: Number(p.total_sold),
    revenue: rev,
    sharePercent: totalRevenue > 0 ? Math.round((rev / totalRevenue) * 1000) / 10 : 0,
    cumulativePercent: totalRevenue > 0 ? Math.round((cumRevenue / totalRevenue) * 1000) / 10 : 0,
    avgPrice: Number(p.total_sold) > 0 ? Math.round((rev / Number(p.total_sold)) * 100) / 100 : 0,
  };
});

// Top 20% of products contribute what % of revenue (pareto)
const top20Pct = Math.ceil(productsWithShare.length * 0.2);
const paretoRevenue = productsWithShare.slice(0, top20Pct).reduce((s, p) => s + p.revenue, 0);
const paretoShare = totalRevenue > 0 ? Math.round((paretoRevenue / totalRevenue) * 1000) / 10 : 0;

// Customer analysis
const customersWithShare = topCustomers.map((c, i) => ({
  rank: i + 1,
  name: c.name,
  orders: Number(c.order_count),
  totalSpend: Number(c.total_spend),
  sharePercent: totalRevenue > 0 ? Math.round((Number(c.total_spend) / totalRevenue) * 1000) / 10 : 0,
  avgOrderValue: Number(c.order_count) > 0 ? Math.round(Number(c.total_spend) / Number(c.order_count) * 100) / 100 : 0,
}));

// Daily trend analysis
const daily = dailyRevenue.map(d => ({ date: d.date, revenue: Number(d.revenue) }));
const firstHalf = daily.slice(0, Math.floor(daily.length / 2));
const secondHalf = daily.slice(Math.floor(daily.length / 2));
const firstAvg = firstHalf.length > 0 ? firstHalf.reduce((s, d) => s + d.revenue, 0) / firstHalf.length : 0;
const secondAvg = secondHalf.length > 0 ? secondHalf.reduce((s, d) => s + d.revenue, 0) / secondHalf.length : 0;
const growthPct = firstAvg > 0 ? Math.round(((secondAvg - firstAvg) / firstAvg) * 1000) / 10 : 0;
const peakDay = daily.reduce((max, d) => d.revenue > max.revenue ? d : max, daily[0] || { date: 'N/A', revenue: 0 });

return {
  metrics: { totalRevenue: Math.round(totalRevenue * 100) / 100, totalTax: Math.round(totalTax * 100) / 100, totalDiscount: Math.round(totalDiscount * 100) / 100, orderCount, avgOrderValue: Math.round(avgOrderValue * 100) / 100 },
  trend: { growthPct, direction: growthPct > 5 ? 'growing' : growthPct < -5 ? 'declining' : 'stable', peakDay: peakDay.date, peakRevenue: Math.round(peakDay.revenue * 100) / 100, avgDailyRevenue: Math.round((daily.reduce((s, d) => s + d.revenue, 0) / (daily.length || 1)) * 100) / 100 },
  pareto: { top20ProductCount: top20Pct, top20RevenueShare: paretoShare },
  topProducts: productsWithShare.slice(0, 10),
  topCustomers: customersWithShare.slice(0, 10),
};
`;

const INVENTORY_REPORT_CODE = `
// DATA = { stockSummary, lowStockItems, inventoryValue }
const { stockSummary, lowStockItems, inventoryValue } = DATA;

const summary = stockSummary[0] || {};
const totalItems = Number(summary.total_items) || 0;
const totalUnits = Number(summary.total_units) || 0;
const lowStockCount = Number(summary.low_stock_count) || 0;
const outOfStockCount = Number(summary.out_of_stock_count) || 0;
const healthyCount = totalItems - lowStockCount - outOfStockCount;

// Inventory health score (0-100)
const healthScore = totalItems > 0
  ? Math.round(((healthyCount / totalItems) * 70 + (1 - (outOfStockCount / totalItems)) * 30))
  : 100;

// Low stock analysis with urgency scoring
const lowStock = lowStockItems.map((item, i) => {
  const qty = Number(item.quantity);
  const reorder = Number(item.reorder_point) || 0;
  const deficit = reorder - qty;
  const urgencyScore = qty === 0 ? 100 : deficit > 0 ? Math.min(99, Math.round((deficit / (reorder || 1)) * 100)) : 0;
  return { rank: i + 1, name: item.name, sku: item.sku, quantity: qty, reorderPoint: reorder, deficit, urgencyScore };
}).sort((a, b) => b.urgencyScore - a.urgencyScore);

// Inventory value analysis
const valueData = inventoryValue.map(v => ({
  name: v.name, sku: v.sku, quantity: Number(v.quantity),
  unitCost: Number(v.cost_price) || 0,
  totalValue: (Number(v.quantity) || 0) * (Number(v.cost_price) || 0),
})).sort((a, b) => b.totalValue - a.totalValue);

const totalInventoryValue = valueData.reduce((s, v) => s + v.totalValue, 0);

return {
  summary: { totalItems, totalUnits, lowStockCount, outOfStockCount, healthyCount, healthScore },
  value: { totalInventoryValue: Math.round(totalInventoryValue * 100) / 100, topValueItems: valueData.slice(0, 10).map(v => ({ ...v, totalValue: Math.round(v.totalValue * 100) / 100 })) },
  lowStockAlerts: lowStock.slice(0, 15),
};
`;

const CUSTOMER_REPORT_CODE = `
// DATA = { customerStats, topCustomers, orderFrequency }
const { customerStats, topCustomers, orderFrequency } = DATA;

const stats = customerStats[0] || {};
const totalCustomers = Number(stats.total_customers) || 0;
const activeCustomers = Number(stats.active_customers) || 0;
const newCustomers = Number(stats.new_customers) || 0;

// RFM-like scoring for top customers
const customers = topCustomers.map((c, i) => {
  const orders = Number(c.order_count);
  const spend = Number(c.total_spend);
  const avgValue = orders > 0 ? spend / orders : 0;
  const daysSinceOrder = Number(c.days_since_last_order) || 999;
  
  // Simple engagement score (0-100)
  const recencyScore = daysSinceOrder <= 7 ? 100 : daysSinceOrder <= 14 ? 80 : daysSinceOrder <= 30 ? 60 : daysSinceOrder <= 60 ? 40 : 20;
  const frequencyScore = Math.min(100, orders * 10);
  const monetaryScore = Math.min(100, Math.round((spend / (topCustomers[0]?.total_spend || spend || 1)) * 100));
  const engagementScore = Math.round((recencyScore * 0.4 + frequencyScore * 0.3 + monetaryScore * 0.3));

  return {
    rank: i + 1, name: c.name, email: c.email, orders, totalSpend: Math.round(spend * 100) / 100,
    avgOrderValue: Math.round(avgValue * 100) / 100, daysSinceLastOrder: daysSinceOrder, engagementScore,
    segment: engagementScore >= 70 ? 'champion' : engagementScore >= 50 ? 'loyal' : engagementScore >= 30 ? 'at-risk' : 'dormant',
  };
});

// Segment distribution
const segments = { champion: 0, loyal: 0, 'at-risk': 0, dormant: 0 };
for (const c of customers) segments[c.segment]++;

// Order frequency distribution
const freqDistribution = orderFrequency.map(f => ({
  orderCount: Number(f.order_count),
  customerCount: Number(f.customer_count),
}));

return {
  overview: { totalCustomers, activeCustomers, newCustomers, activeRate: totalCustomers > 0 ? Math.round((activeCustomers / totalCustomers) * 1000) / 10 : 0 },
  segments,
  topCustomers: customers.slice(0, 15),
  orderFrequency: freqDistribution,
};
`;

const FINANCIAL_REPORT_CODE = `
// DATA = { revenue, invoiceSummary, paymentSummary, agingBuckets }
const { revenue, invoiceSummary, paymentSummary, agingBuckets } = DATA;

const rev = revenue[0] || {};
const inv = invoiceSummary[0] || {};
const pay = paymentSummary[0] || {};

const totalRevenue = Number(rev.total_revenue) || 0;
const totalInvoiced = Number(inv.total_invoiced) || 0;
const totalPaid = Number(inv.total_paid) || 0;
const outstanding = Number(inv.outstanding) || 0;
const overdueCount = Number(inv.overdue_count) || 0;
const invoiceCount = Number(inv.invoice_count) || 0;
const totalPayments = Number(pay.total_payments) || 0;
const paymentCount = Number(pay.payment_count) || 0;

// Collection rate
const collectionRate = totalInvoiced > 0 ? Math.round((totalPaid / totalInvoiced) * 1000) / 10 : 100;

// Days Sales Outstanding (DSO)
const avgDailyRevenue = totalRevenue / 30; // approximate
const dso = avgDailyRevenue > 0 ? Math.round(outstanding / avgDailyRevenue) : 0;

// Aging analysis
const aging = agingBuckets.map(b => ({
  bucket: b.bucket,
  count: Number(b.invoice_count),
  amount: Math.round(Number(b.total_amount) * 100) / 100,
}));

return {
  revenue: { total: Math.round(totalRevenue * 100) / 100, orderCount: Number(rev.order_count) || 0 },
  invoicing: { totalInvoiced: Math.round(totalInvoiced * 100) / 100, totalPaid: Math.round(totalPaid * 100) / 100, outstanding: Math.round(outstanding * 100) / 100, invoiceCount, overdueCount, collectionRate },
  payments: { totalPayments: Math.round(totalPayments * 100) / 100, paymentCount },
  health: { dso, collectionRate, outstandingRatio: totalInvoiced > 0 ? Math.round((outstanding / totalInvoiced) * 1000) / 10 : 0 },
  aging,
};
`;

// ────────────────────────────────────────────────────────────
// SQL queries for each report type
// ────────────────────────────────────────────────────────────

function getSalesSQL(startDate: string, endDate: string): string {
  return `
    SELECT json_build_object(
      'revenue', (
        SELECT COALESCE(json_agg(row_to_json(t)), '[]') FROM (
          SELECT COALESCE(SUM(total_amount), 0) as total_revenue, COALESCE(SUM(tax_amount), 0) as total_tax,
                 COALESCE(SUM(discount_amount), 0) as total_discount, COUNT(*) as order_count
          FROM orders WHERE created_at >= '${startDate}'::timestamp AND created_at <= '${endDate}'::timestamp
        ) t
      ),
      'topProducts', (
        SELECT COALESCE(json_agg(row_to_json(t)), '[]') FROM (
          SELECT p.name, p.sku, SUM(oi.quantity) as total_sold, SUM(oi.total_amount) as revenue
          FROM order_items oi JOIN orders o ON oi.order_id = o.id JOIN products p ON oi.product_id = p.id
          WHERE o.created_at >= '${startDate}'::timestamp AND o.created_at <= '${endDate}'::timestamp
          GROUP BY p.name, p.sku ORDER BY revenue DESC LIMIT 20
        ) t
      ),
      'topCustomers', (
        SELECT COALESCE(json_agg(row_to_json(t)), '[]') FROM (
          SELECT c.name, COUNT(*) as order_count, SUM(o.total_amount) as total_spend
          FROM orders o JOIN customers c ON o.customer_id = c.id
          WHERE o.created_at >= '${startDate}'::timestamp AND o.created_at <= '${endDate}'::timestamp
          GROUP BY c.name ORDER BY total_spend DESC LIMIT 15
        ) t
      ),
      'dailyRevenue', (
        SELECT COALESCE(json_agg(row_to_json(t)), '[]') FROM (
          SELECT created_at::date as date, SUM(total_amount) as revenue
          FROM orders WHERE created_at >= '${startDate}'::timestamp AND created_at <= '${endDate}'::timestamp
          GROUP BY date ORDER BY date
        ) t
      )
    ) as data`;
}

function getInventorySQL(): string {
  return `
    SELECT json_build_object(
      'stockSummary', (
        SELECT COALESCE(json_agg(row_to_json(t)), '[]') FROM (
          SELECT COUNT(DISTINCT i.product_id) as total_items, COALESCE(SUM(i.quantity), 0) as total_units,
                 COUNT(*) FILTER (WHERE i.quantity <= COALESCE(p.reorder_point, p.min_stock_level, 0)) as low_stock_count,
                 COUNT(*) FILTER (WHERE i.quantity = 0) as out_of_stock_count
          FROM inventory i JOIN products p ON i.product_id = p.id
        ) t
      ),
      'lowStockItems', (
        SELECT COALESCE(json_agg(row_to_json(t)), '[]') FROM (
          SELECT p.name, p.sku, i.quantity, p.reorder_point
          FROM inventory i JOIN products p ON i.product_id = p.id
          WHERE i.quantity <= COALESCE(p.reorder_point, p.min_stock_level, 0)
          ORDER BY i.quantity LIMIT 20
        ) t
      ),
      'inventoryValue', (
        SELECT COALESCE(json_agg(row_to_json(t)), '[]') FROM (
          SELECT p.name, p.sku, i.quantity, p.cost_price
          FROM inventory i JOIN products p ON i.product_id = p.id
          WHERE p.is_active = true ORDER BY (i.quantity * COALESCE(p.cost_price::numeric, 0)) DESC LIMIT 20
        ) t
      )
    ) as data`;
}

function getCustomerSQL(startDate: string, endDate: string): string {
  return `
    SELECT json_build_object(
      'customerStats', (
        SELECT COALESCE(json_agg(row_to_json(t)), '[]') FROM (
          SELECT COUNT(*) as total_customers,
                 COUNT(*) FILTER (WHERE is_active = true) as active_customers,
                 COUNT(*) FILTER (WHERE created_at >= '${startDate}'::timestamp) as new_customers
          FROM customers
        ) t
      ),
      'topCustomers', (
        SELECT COALESCE(json_agg(row_to_json(t)), '[]') FROM (
          SELECT c.name, c.email, COUNT(o.id) as order_count, COALESCE(SUM(o.total_amount), 0) as total_spend,
                 EXTRACT(DAY FROM NOW() - MAX(o.created_at)) as days_since_last_order
          FROM customers c LEFT JOIN orders o ON c.id = o.customer_id
          WHERE c.is_active = true
          GROUP BY c.id, c.name, c.email ORDER BY total_spend DESC LIMIT 30
        ) t
      ),
      'orderFrequency', (
        SELECT COALESCE(json_agg(row_to_json(t)), '[]') FROM (
          SELECT order_count, COUNT(*) as customer_count FROM (
            SELECT c.id, COUNT(o.id) as order_count
            FROM customers c LEFT JOIN orders o ON c.id = o.customer_id
            WHERE c.is_active = true
            GROUP BY c.id
          ) sub GROUP BY order_count ORDER BY order_count
        ) t
      )
    ) as data`;
}

function getFinancialSQL(startDate: string, endDate: string): string {
  return `
    SELECT json_build_object(
      'revenue', (
        SELECT COALESCE(json_agg(row_to_json(t)), '[]') FROM (
          SELECT COALESCE(SUM(total_amount), 0) as total_revenue, COUNT(*) as order_count
          FROM orders WHERE created_at >= '${startDate}'::timestamp AND created_at <= '${endDate}'::timestamp
        ) t
      ),
      'invoiceSummary', (
        SELECT COALESCE(json_agg(row_to_json(t)), '[]') FROM (
          SELECT COALESCE(SUM(total_amount), 0) as total_invoiced, COALESCE(SUM(paid_amount), 0) as total_paid,
                 COALESCE(SUM(total_amount) - SUM(paid_amount), 0) as outstanding, COUNT(*) as invoice_count,
                 COUNT(*) FILTER (WHERE due_date < NOW() AND status != 'paid') as overdue_count
          FROM invoices WHERE created_at >= '${startDate}'::timestamp AND created_at <= '${endDate}'::timestamp
        ) t
      ),
      'paymentSummary', (
        SELECT COALESCE(json_agg(row_to_json(t)), '[]') FROM (
          SELECT COALESCE(SUM(amount), 0) as total_payments, COUNT(*) as payment_count
          FROM payments WHERE created_at >= '${startDate}'::timestamp AND created_at <= '${endDate}'::timestamp
        ) t
      ),
      'agingBuckets', (
        SELECT COALESCE(json_agg(row_to_json(t)), '[]') FROM (
          SELECT
            CASE
              WHEN due_date >= NOW() THEN 'Current'
              WHEN due_date >= NOW() - INTERVAL '30 days' THEN '1-30 days'
              WHEN due_date >= NOW() - INTERVAL '60 days' THEN '31-60 days'
              WHEN due_date >= NOW() - INTERVAL '90 days' THEN '61-90 days'
              ELSE '90+ days'
            END as bucket,
            COUNT(*) as invoice_count, SUM(total_amount - paid_amount) as total_amount
          FROM invoices WHERE status != 'paid'
          GROUP BY bucket ORDER BY MIN(due_date) DESC
        ) t
      )
    ) as data`;
}

// ────────────────────────────────────────────────────────────
// Agent definition
// ────────────────────────────────────────────────────────────

export default createAgent("report-generator", {
  schema: { input: inputSchema, output: outputSchema },
  handler: async (ctx, input) => {
    // Default to last 30 days
    const end = input.endDate ? new Date(input.endDate) : new Date();
    const start = input.startDate
      ? new Date(input.startDate)
      : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

    const startStr = start.toISOString();
    const endStr = end.toISOString();
    const periodStr = `${start.toISOString().split("T")[0]} to ${end.toISOString().split("T")[0]}`;

    // Select SQL and computation code
    const sqlQueries: Record<string, string> = {
      "sales-summary": getSalesSQL(startStr, endStr),
      "inventory-health": getInventorySQL(),
      "customer-activity": getCustomerSQL(startStr, endStr),
      "financial-overview": getFinancialSQL(startStr, endStr),
    };

    const computeCode: Record<string, string> = {
      "sales-summary": SALES_REPORT_CODE,
      "inventory-health": INVENTORY_REPORT_CODE,
      "customer-activity": CUSTOMER_REPORT_CODE,
      "financial-overview": FINANCIAL_REPORT_CODE,
    };

    const reportTitles: Record<string, string> = {
      "sales-summary": `${config.labels.orderPlural} & Revenue Report`,
      "inventory-health": "Inventory Health Report",
      "customer-activity": `${config.labels.customerPlural} Activity Report`,
      "financial-overview": "Financial Overview Report",
    };

    const title = reportTitles[input.reportType];
    const sqlQuery = sqlQueries[input.reportType];
    const code = computeCode[input.reportType];

    // ── Step 1: Fetch data from DB ────────────────────────────
    let rawData: unknown;
    try {
      const result = await db.execute(sql.raw(sqlQuery));
      const rows = Array.isArray(result) ? result : (result as any).rows ?? [];
      rawData = rows[0]?.data || rows[0] || {};
    } catch (err: any) {
      ctx.logger.error(`SQL query failed for report ${input.reportType}: ${err.message}`);
      return {
        title,
        reportType: input.reportType,
        period: { start: start.toISOString(), end: end.toISOString() },
        content: `**Error:** Could not retrieve data for this report. ${err.message}`,
        generatedAt: new Date().toISOString(),
      };
    }

    // ── Step 2: Compute report data in sandbox ────────────────
    let sandboxResult: SandboxResult;
    try {
      sandboxResult = await executeSandbox(ctx.sandbox, {
        code,
        explanation: `${input.reportType} report data computation`,
        data: rawData,
        timeoutMs: 30000,
      });
    } catch (err: any) {
      ctx.logger.error(`Sandbox failed for report ${input.reportType}: ${err.message}`);
      return {
        title,
        reportType: input.reportType,
        period: { start: start.toISOString(), end: end.toISOString() },
        content: `**Error:** Report computation failed. ${err.message}`,
        generatedAt: new Date().toISOString(),
      };
    }

    if (!sandboxResult.success) {
      ctx.logger.warn(`Report computation error: ${sandboxResult.error}`);
      return {
        title,
        reportType: input.reportType,
        period: { start: start.toISOString(), end: end.toISOString() },
        content: `**Error:** Report computation failed. ${sandboxResult.error}`,
        generatedAt: new Date().toISOString(),
      };
    }

    // ── Step 3: LLM narrates the computed report data ─────────
    const computedData = JSON.stringify(sandboxResult.result, null, 2);

    const formatInstruction =
      input.format === "markdown"
        ? "Format the report in clean Markdown with headers, bullet points, and tables where appropriate."
        : "Format the report in plain text, well-structured with clear sections.";

    const aiSettings = await getAISettings();

    const defaultReportSystem = `Report structure:
1. Executive Summary (2-3 sentences, key highlights)
2. Key Metrics (the important numbers — these have been PRE-COMPUTED with exact precision)
3. Details & Analysis (interpretation of the data — explain what the numbers mean)
4. Rankings & Breakdowns (top products, customers, etc. — from the computed data)
5. Recommendations (actionable next steps based on what the data shows)`;

    const reportInstructions = aiSettings.aiReportInstructions?.trim() || defaultReportSystem;
    const businessContext = aiSettings.aiBusinessContext?.trim()
      ? `\nBusiness context:\n${aiSettings.aiBusinessContext.trim()}`
      : "";

    const { text } = await generateText({
      model: await getModel(),
      system: `You are a professional business report writer for ${config.companyName}.
Generate a clear, actionable business report based on PRE-COMPUTED analytics data.

IMPORTANT: The numbers in the data have been computed with mathematical precision (in a sandbox).
Do NOT recalculate or approximate — use the EXACT numbers provided. Your job is to:
1. Structure the report clearly
2. Interpret what the numbers mean for the business
3. Highlight the most important findings
4. Provide actionable recommendations

${reportInstructions}

${formatInstruction}

Use the deployment's terminology: "${config.labels.product}" for products, "${config.labels.order}" for orders, "${config.labels.customer}" for customers.
Currency: ${config.currency}
Period: ${periodStr}${businessContext}`,
      prompt: `Generate the "${title}" report for ${config.companyName}.

Period: ${periodStr}

Computed Report Data:
${computedData}`,
    });

    ctx.logger.info(
      `Generated report (sandbox-powered): ${input.reportType} for period ${periodStr}`
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
