import { createAgent } from "@agentuity/runtime";
import { generateObject } from "ai";
import { z } from "zod";
import { db } from "@db/index";
import { sql } from "drizzle-orm";
import { config } from "@lib/config";
import { getModel } from "@lib/ai";
import { executeSandbox } from "@lib/sandbox";
import type { SandboxResult } from "@lib/sandbox";
import { getAISettings } from "@services/settings";

/**
 * Insights Analyzer Agent — AI + Sandbox-powered business intelligence.
 *
 * Architecture (v2 — sandbox-powered):
 *   1. Fetch raw data from DB using efficient SQL queries
 *   2. Execute statistical analysis JavaScript in an isolated Bun sandbox
 *      (moving averages, standard deviations, trend projections, anomaly scoring,
 *       velocity calculations, reorder point optimization, etc.)
 *   3. Feed the computed analytics TO the LLM for human-readable interpretation
 *
 * This is a REAL analytical agent — the sandbox does genuine computation
 * that LLMs can't reliably do (math, statistics, precise calculations),
 * while the LLM provides expert business interpretation of the results.
 *
 * Capabilities:
 *   - Demand forecasting: moving averages, velocity projections, stockout ETAs
 *   - Anomaly detection: z-score analysis, IQR outliers, spike detection
 *   - Restock recommendations: velocity-based EOQ, safety stock calculations
 *   - Sales trends: growth rates, momentum scoring, seasonality detection
 */

const inputSchema = z.object({
  analysis: z.enum([
    "demand-forecast",
    "anomaly-detection",
    "restock-recommendations",
    "sales-trends",
  ]),
  timeframeDays: z.number().int().min(1).max(365).default(30),
  productId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(50).default(10),
});

const insightSchema = z.object({
  title: z.string(),
  severity: z.enum(["info", "warning", "critical"]),
  description: z.string(),
  recommendation: z.string(),
  affectedItems: z.array(z.string()).optional(),
  confidence: z.number().min(0).max(1),
  dataPoints: z.record(z.unknown()).optional(),
});

const outputSchema = z.object({
  analysisType: z.string(),
  generatedAt: z.string(),
  insights: z.array(insightSchema),
  summary: z.string(),
});

// ────────────────────────────────────────────────────────────
// Sandbox analysis code for each analysis type
// ────────────────────────────────────────────────────────────

/** Demand forecasting — moving averages, velocity, stockout projections */
const DEMAND_FORECAST_CODE = `
// DATA = { dailySales, stockLevels }
const { dailySales, stockLevels } = DATA;

// Group daily sales by product
const byProduct = {};
for (const row of dailySales) {
  if (!byProduct[row.product_name]) byProduct[row.product_name] = { sku: row.sku, days: {} };
  byProduct[row.product_name].days[row.date] = (byProduct[row.product_name].days[row.date] || 0) + Number(row.quantity);
}

// Build stock lookup
const stockMap = {};
for (const s of stockLevels) stockMap[s.product_name] = { qty: Number(s.quantity), reorder: Number(s.reorder_point) || 0 };

// Analyze each product
const forecasts = [];
for (const [name, data] of Object.entries(byProduct)) {
  const dates = Object.keys(data.days).sort();
  const values = dates.map(d => data.days[d]);
  const totalDays = dates.length || 1;

  // Simple moving average (7-day and 14-day)
  const last7 = values.slice(-7);
  const last14 = values.slice(-14);
  const avg7 = last7.reduce((a, b) => a + b, 0) / (last7.length || 1);
  const avg14 = last14.reduce((a, b) => a + b, 0) / (last14.length || 1);
  const totalAvg = values.reduce((a, b) => a + b, 0) / totalDays;

  // Velocity trend
  const velocityChange = last7.length >= 2 && last14.length >= 2 ? ((avg7 - avg14) / (avg14 || 1)) * 100 : 0;

  // Current stock and days until stockout
  const stock = stockMap[name] || { qty: 0, reorder: 0 };
  const daysUntilStockout = avg7 > 0 ? Math.floor(stock.qty / avg7) : Infinity;
  const daysUntilReorder = avg7 > 0 ? Math.max(0, Math.floor((stock.qty - stock.reorder) / avg7)) : Infinity;

  // Standard deviation for variability
  const mean = totalAvg;
  const variance = values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / (totalDays || 1);
  const stdDev = Math.sqrt(variance);
  const cv = mean > 0 ? (stdDev / mean) * 100 : 0;

  forecasts.push({
    product: name, sku: data.sku,
    avgDailyDemand: Math.round(totalAvg * 100) / 100,
    avg7Day: Math.round(avg7 * 100) / 100,
    avg14Day: Math.round(avg14 * 100) / 100,
    velocityChangePct: Math.round(velocityChange * 10) / 10,
    demandVariability: Math.round(cv * 10) / 10,
    currentStock: stock.qty, reorderPoint: stock.reorder,
    daysUntilStockout: daysUntilStockout === Infinity ? null : daysUntilStockout,
    daysUntilReorder: daysUntilReorder === Infinity ? null : daysUntilReorder,
    riskLevel: daysUntilStockout <= 3 ? 'critical' : daysUntilStockout <= 7 ? 'warning' : 'ok',
  });
}

// Sort by risk (critical first), then by days until stockout
forecasts.sort((a, b) => {
  const riskOrder = { critical: 0, warning: 1, ok: 2 };
  if (riskOrder[a.riskLevel] !== riskOrder[b.riskLevel]) return riskOrder[a.riskLevel] - riskOrder[b.riskLevel];
  return (a.daysUntilStockout ?? 999) - (b.daysUntilStockout ?? 999);
});

return {
  type: 'demand-forecast',
  productCount: forecasts.length,
  criticalCount: forecasts.filter(f => f.riskLevel === 'critical').length,
  warningCount: forecasts.filter(f => f.riskLevel === 'warning').length,
  forecasts: forecasts.slice(0, 20),
};
`;

/** Anomaly detection — z-score analysis, IQR outliers */
const ANOMALY_DETECTION_CODE = `
// DATA = { dailyOrders, productSales }
const { dailyOrders, productSales } = DATA;

const anomalies = [];
const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
const stdDev = (arr) => {
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + Math.pow(v - m, 2), 0) / arr.length);
};

// --- Daily order anomalies (z-score method) ---
if (dailyOrders.length >= 7) {
  const counts = dailyOrders.map(d => Number(d.order_count));
  const revenues = dailyOrders.map(d => Number(d.total_revenue));
  const countMean = mean(counts), countStd = stdDev(counts);
  const revMean = mean(revenues), revStd = stdDev(revenues);

  for (const day of dailyOrders) {
    const countZ = countStd > 0 ? (Number(day.order_count) - countMean) / countStd : 0;
    const revZ = revStd > 0 ? (Number(day.total_revenue) - revMean) / revStd : 0;
    if (Math.abs(countZ) > 2) {
      anomalies.push({ type: 'order_volume', date: day.date, value: Number(day.order_count), expected: Math.round(countMean), zScore: Math.round(countZ * 100) / 100, direction: countZ > 0 ? 'spike' : 'drop', severity: Math.abs(countZ) > 3 ? 'critical' : 'warning' });
    }
    if (Math.abs(revZ) > 2) {
      anomalies.push({ type: 'revenue', date: day.date, value: Number(day.total_revenue), expected: Math.round(revMean), zScore: Math.round(revZ * 100) / 100, direction: revZ > 0 ? 'spike' : 'drop', severity: Math.abs(revZ) > 3 ? 'critical' : 'warning' });
    }
  }
}

// --- Product-level anomalies (IQR method for pricing) ---
if (productSales.length >= 5) {
  const prices = productSales.map(p => Number(p.avg_price)).sort((a, b) => a - b);
  const q1 = prices[Math.floor(prices.length * 0.25)];
  const q3 = prices[Math.floor(prices.length * 0.75)];
  const iqr = q3 - q1;

  for (const p of productSales) {
    const price = Number(p.avg_price);
    if (price < q1 - 1.5 * iqr || price > q3 + 1.5 * iqr) {
      anomalies.push({ type: 'pricing', product: p.product_name, sku: p.sku, avgPrice: price, priceRange: { q1, q3 }, direction: price > q3 + 1.5 * iqr ? 'high' : 'low', severity: 'warning' });
    }
  }

  // Volume anomalies (IQR on quantity)
  const quantities = productSales.map(p => Number(p.total_quantity)).sort((a, b) => a - b);
  const qtyQ1 = quantities[Math.floor(quantities.length * 0.25)];
  const qtyQ3 = quantities[Math.floor(quantities.length * 0.75)];
  const qtyIqr = qtyQ3 - qtyQ1;

  for (const p of productSales) {
    const qty = Number(p.total_quantity);
    if (qty > qtyQ3 + 2 * qtyIqr && qty > 10) {
      anomalies.push({ type: 'sales_volume', product: p.product_name, sku: p.sku, quantity: qty, expectedRange: { q1: qtyQ1, q3: qtyQ3 }, severity: 'info', direction: 'unusually high' });
    }
  }
}

const sevOrder = { critical: 0, warning: 1, info: 2 };
anomalies.sort((a, b) => (sevOrder[a.severity] || 2) - (sevOrder[b.severity] || 2));

return { type: 'anomaly-detection', totalAnomalies: anomalies.length, criticalCount: anomalies.filter(a => a.severity === 'critical').length, warningCount: anomalies.filter(a => a.severity === 'warning').length, anomalies: anomalies.slice(0, 25) };
`;

/** Restock recommendations — velocity-based EOQ, safety stock */
const RESTOCK_CODE = `
// DATA = { salesVelocity, stock }
const { salesVelocity, stock } = DATA;

const stockMap = {};
for (const s of stock) stockMap[s.product_name] = s;

const recommendations = [];
for (const item of salesVelocity) {
  const s = stockMap[item.product_name];
  if (!s) continue;

  const currentQty = Number(s.quantity);
  const reorderPt = Number(s.reorder_point) || 0;
  const minStock = Number(s.min_stock) || 0;
  const maxStock = Number(s.max_stock) || 0;
  const dailyVelocity = Number(item.total_sold) / 30;
  const leadTimeDays = 7;
  const safetyStock = Math.ceil(dailyVelocity * leadTimeDays * 1.5);
  const targetStock = maxStock > 0 ? maxStock : Math.ceil(dailyVelocity * 30 + safetyStock);
  const orderQty = Math.max(0, targetStock - currentQty);
  const daysRemaining = dailyVelocity > 0 ? currentQty / dailyVelocity : Infinity;

  let urgency = 'low';
  if (currentQty <= 0) urgency = 'out-of-stock';
  else if (currentQty <= reorderPt || daysRemaining <= 3) urgency = 'critical';
  else if (currentQty <= minStock || daysRemaining <= 7) urgency = 'high';
  else if (daysRemaining <= 14) urgency = 'medium';

  if (orderQty > 0 || urgency !== 'low') {
    recommendations.push({ product: item.product_name, sku: item.sku, currentStock: currentQty, dailyVelocity: Math.round(dailyVelocity * 100) / 100, daysRemaining: daysRemaining === Infinity ? null : Math.round(daysRemaining), safetyStock, reorderPoint: reorderPt, suggestedOrderQty: orderQty, targetStock, urgency, orderCount: Number(item.order_count) });
  }
}

const urgencyOrder = { 'out-of-stock': 0, critical: 1, high: 2, medium: 3, low: 4 };
recommendations.sort((a, b) => (urgencyOrder[a.urgency] || 4) - (urgencyOrder[b.urgency] || 4));

return { type: 'restock-recommendations', totalRecommendations: recommendations.length, outOfStock: recommendations.filter(r => r.urgency === 'out-of-stock').length, criticalCount: recommendations.filter(r => r.urgency === 'critical').length, highCount: recommendations.filter(r => r.urgency === 'high').length, recommendations: recommendations.slice(0, 20) };
`;

/** Sales trends — growth rates, momentum, seasonality */
const SALES_TRENDS_CODE = `
// DATA = { weeklyRevenue, productTrends, dailyRevenue }
const { weeklyRevenue, productTrends, dailyRevenue } = DATA;

// --- Overall trend ---
const weeks = weeklyRevenue.map(w => ({ week: w.week, revenue: Number(w.revenue), orders: Number(w.order_count) }));
let overallGrowth = 0;
let revenueDirection = 'flat';
if (weeks.length >= 2) {
  const firstHalf = weeks.slice(0, Math.floor(weeks.length / 2));
  const secondHalf = weeks.slice(Math.floor(weeks.length / 2));
  const firstAvg = firstHalf.reduce((s, w) => s + w.revenue, 0) / firstHalf.length;
  const secondAvg = secondHalf.reduce((s, w) => s + w.revenue, 0) / secondHalf.length;
  overallGrowth = firstAvg > 0 ? ((secondAvg - firstAvg) / firstAvg) * 100 : 0;
  revenueDirection = overallGrowth > 5 ? 'growing' : overallGrowth < -5 ? 'declining' : 'stable';
}

const totalRevenue = weeks.reduce((s, w) => s + w.revenue, 0);
const totalOrders = weeks.reduce((s, w) => s + w.orders, 0);
const avgWeeklyRevenue = weeks.length > 0 ? totalRevenue / weeks.length : 0;
const peakWeek = weeks.reduce((max, w) => w.revenue > max.revenue ? w : max, weeks[0] || { week: 'N/A', revenue: 0 });

// --- Product momentum ---
const productMomentum = productTrends.map(p => {
  const w = [Number(p.week1_qty), Number(p.week2_qty), Number(p.week3_qty), Number(p.week4_qty)].filter(v => !isNaN(v));
  const recent = w.slice(-2);
  const earlier = w.slice(0, 2);
  const recentAvg = recent.reduce((a, b) => a + b, 0) / (recent.length || 1);
  const earlierAvg = earlier.reduce((a, b) => a + b, 0) / (earlier.length || 1);
  const momentum = earlierAvg > 0 ? ((recentAvg - earlierAvg) / earlierAvg) * 100 : 0;
  return { product: p.product_name, sku: p.sku, totalRevenue: Number(p.total_revenue), momentumPct: Math.round(momentum * 10) / 10, trend: momentum > 15 ? 'accelerating' : momentum < -15 ? 'decelerating' : 'steady', weeklyUnits: w };
});

const sorted = [...productMomentum].sort((a, b) => b.momentumPct - a.momentumPct);
const topGrowers = sorted.filter(p => p.trend === 'accelerating').slice(0, 5);
const topDecliners = sorted.filter(p => p.trend === 'decelerating').slice(0, 5);

// --- Day-of-week pattern ---
const dayTotals = {};
for (const d of dailyRevenue) {
  const day = new Date(d.date).toLocaleDateString('en-US', { weekday: 'long' });
  dayTotals[day] = (dayTotals[day] || 0) + Number(d.revenue);
}
const dayPattern = Object.entries(dayTotals).map(([day, rev]) => ({ day, revenue: Math.round(rev * 100) / 100 })).sort((a, b) => b.revenue - a.revenue);

return { type: 'sales-trends', overall: { totalRevenue: Math.round(totalRevenue * 100) / 100, totalOrders, avgWeeklyRevenue: Math.round(avgWeeklyRevenue * 100) / 100, growthPct: Math.round(overallGrowth * 10) / 10, direction: revenueDirection, peakWeek: peakWeek?.week, peakRevenue: Math.round((peakWeek?.revenue || 0) * 100) / 100 }, topGrowers, topDecliners, dayOfWeekPattern: dayPattern, weeklyBreakdown: weeks };
`;

// ────────────────────────────────────────────────────────────
// SQL queries for each analysis type
// ────────────────────────────────────────────────────────────

function getDemandForecastSQL(days: number): string {
  return `
    SELECT json_build_object(
      'dailySales', (
        SELECT COALESCE(json_agg(row_to_json(t)), '[]')
        FROM (
          SELECT o.created_at::date as date, p.name as product_name, p.sku,
                 SUM(oi.quantity) as quantity, SUM(oi.total_amount) as revenue
          FROM order_items oi
          JOIN products p ON oi.product_id = p.id
          JOIN orders o ON oi.order_id = o.id
          WHERE o.created_at >= NOW() - INTERVAL '${days} days'
          GROUP BY o.created_at::date, p.name, p.sku
          ORDER BY date, product_name
        ) t
      ),
      'stockLevels', (
        SELECT COALESCE(json_agg(row_to_json(t)), '[]')
        FROM (
          SELECT p.name as product_name, p.sku, i.quantity, p.reorder_point
          FROM inventory i
          JOIN products p ON i.product_id = p.id
          WHERE p.is_active = true
        ) t
      )
    ) as data`;
}

function getAnomalyDetectionSQL(days: number): string {
  return `
    SELECT json_build_object(
      'dailyOrders', (
        SELECT COALESCE(json_agg(row_to_json(t)), '[]')
        FROM (
          SELECT created_at::date as date, COUNT(*) as order_count,
                 SUM(total_amount) as total_revenue
          FROM orders
          WHERE created_at >= NOW() - INTERVAL '${days} days'
          GROUP BY created_at::date
          ORDER BY date
        ) t
      ),
      'productSales', (
        SELECT COALESCE(json_agg(row_to_json(t)), '[]')
        FROM (
          SELECT p.name as product_name, p.sku, SUM(oi.quantity) as total_quantity,
                 SUM(oi.total_amount) as total_revenue, COUNT(DISTINCT oi.order_id) as order_count,
                 AVG(oi.unit_price) as avg_price
          FROM order_items oi
          JOIN products p ON oi.product_id = p.id
          JOIN orders o ON oi.order_id = o.id
          WHERE o.created_at >= NOW() - INTERVAL '${days} days'
          GROUP BY p.name, p.sku
          HAVING SUM(oi.quantity) > 0
        ) t
      )
    ) as data`;
}

function getRestockSQL(days: number): string {
  return `
    SELECT json_build_object(
      'salesVelocity', (
        SELECT COALESCE(json_agg(row_to_json(t)), '[]')
        FROM (
          SELECT p.name as product_name, p.sku, SUM(oi.quantity) as total_sold,
                 COUNT(DISTINCT oi.order_id) as order_count, AVG(oi.quantity) as avg_per_order
          FROM order_items oi
          JOIN products p ON oi.product_id = p.id
          JOIN orders o ON oi.order_id = o.id
          WHERE o.created_at >= NOW() - INTERVAL '${days} days'
          GROUP BY p.name, p.sku
          ORDER BY SUM(oi.quantity) DESC
          LIMIT 50
        ) t
      ),
      'stock', (
        SELECT COALESCE(json_agg(row_to_json(t)), '[]')
        FROM (
          SELECT p.name as product_name, p.sku, i.quantity,
                 p.reorder_point, p.min_stock_level as min_stock, p.max_stock_level as max_stock
          FROM inventory i
          JOIN products p ON i.product_id = p.id
          WHERE p.is_active = true
        ) t
      )
    ) as data`;
}

function getSalesTrendsSQL(days: number): string {
  return `
    SELECT json_build_object(
      'weeklyRevenue', (
        SELECT COALESCE(json_agg(row_to_json(t)), '[]')
        FROM (
          SELECT date_trunc('week', created_at)::date as week,
                 SUM(total_amount) as revenue, COUNT(*) as order_count
          FROM orders
          WHERE created_at >= NOW() - INTERVAL '${days} days'
          GROUP BY week ORDER BY week
        ) t
      ),
      'productTrends', (
        SELECT COALESCE(json_agg(row_to_json(t)), '[]')
        FROM (
          SELECT p.name as product_name, p.sku,
                 SUM(CASE WHEN o.created_at >= NOW() - INTERVAL '7 days' THEN oi.quantity ELSE 0 END) as week1_qty,
                 SUM(CASE WHEN o.created_at >= NOW() - INTERVAL '14 days' AND o.created_at < NOW() - INTERVAL '7 days' THEN oi.quantity ELSE 0 END) as week2_qty,
                 SUM(CASE WHEN o.created_at >= NOW() - INTERVAL '21 days' AND o.created_at < NOW() - INTERVAL '14 days' THEN oi.quantity ELSE 0 END) as week3_qty,
                 SUM(CASE WHEN o.created_at >= NOW() - INTERVAL '${days} days' AND o.created_at < NOW() - INTERVAL '21 days' THEN oi.quantity ELSE 0 END) as week4_qty,
                 SUM(oi.total_amount) as total_revenue
          FROM order_items oi
          JOIN products p ON oi.product_id = p.id
          JOIN orders o ON oi.order_id = o.id
          WHERE o.created_at >= NOW() - INTERVAL '${days} days'
          GROUP BY p.name, p.sku
          HAVING SUM(oi.quantity) > 0
          ORDER BY SUM(oi.total_amount) DESC
          LIMIT 30
        ) t
      ),
      'dailyRevenue', (
        SELECT COALESCE(json_agg(row_to_json(t)), '[]')
        FROM (
          SELECT created_at::date as date, SUM(total_amount) as revenue
          FROM orders
          WHERE created_at >= NOW() - INTERVAL '${days} days'
          GROUP BY date ORDER BY date
        ) t
      )
    ) as data`;
}

// ────────────────────────────────────────────────────────────
// Agent definition
// ────────────────────────────────────────────────────────────

export default createAgent("insights-analyzer", {
  schema: { input: inputSchema, output: outputSchema },
  handler: async (ctx, input) => {
    // Load client-customizable AI settings
    const aiSettings = await getAISettings();

    // Select the right SQL and analysis code
    const sqlQueries: Record<string, string> = {
      "demand-forecast": getDemandForecastSQL(input.timeframeDays),
      "anomaly-detection": getAnomalyDetectionSQL(input.timeframeDays),
      "restock-recommendations": getRestockSQL(input.timeframeDays),
      "sales-trends": getSalesTrendsSQL(input.timeframeDays),
    };

    const analysisCode: Record<string, string> = {
      "demand-forecast": DEMAND_FORECAST_CODE,
      "anomaly-detection": ANOMALY_DETECTION_CODE,
      "restock-recommendations": RESTOCK_CODE,
      "sales-trends": SALES_TRENDS_CODE,
    };

    const sqlQuery = sqlQueries[input.analysis];
    const code = analysisCode[input.analysis];

    // ── Step 1: Fetch data from DB ────────────────────────────
    let rawData: unknown;
    try {
      const result = await db.execute(sql.raw(sqlQuery));
      const rows = Array.isArray(result) ? result : (result as any).rows ?? [];
      rawData = rows[0]?.data || rows[0] || {};
    } catch (err: any) {
      ctx.logger.error(`SQL query failed for ${input.analysis}: ${err.message}`);
      return {
        analysisType: input.analysis,
        generatedAt: new Date().toISOString(),
        insights: [{
          title: "Data Retrieval Error",
          severity: "warning" as const,
          description: `Could not fetch data for analysis: ${err.message}`,
          recommendation: "Check database connectivity and table permissions.",
          confidence: 1,
        }],
        summary: "Analysis could not be completed due to a data retrieval error.",
      };
    }

    // ── Step 2: Execute analysis in sandbox ───────────────────
    let sandboxResult: SandboxResult;
    try {
      sandboxResult = await executeSandbox(ctx.sandbox, {
        code,
        explanation: `${input.analysis} analysis over ${input.timeframeDays} days`,
        data: rawData,
        timeoutMs: 30000,
      });
    } catch (err: any) {
      ctx.logger.error(`Sandbox execution failed for ${input.analysis}: ${err.message}`);
      return {
        analysisType: input.analysis,
        generatedAt: new Date().toISOString(),
        insights: [{
          title: "Analysis Engine Error",
          severity: "warning" as const,
          description: `Sandbox computation failed: ${err.message}`,
          recommendation: "This is a system error. The analysis will be retried automatically.",
          confidence: 1,
        }],
        summary: "Analysis computation could not be completed.",
      };
    }

    if (!sandboxResult.success) {
      ctx.logger.warn(`Sandbox analysis returned error: ${sandboxResult.error}`);
      return {
        analysisType: input.analysis,
        generatedAt: new Date().toISOString(),
        insights: [{
          title: "Analysis Computation Error",
          severity: "warning" as const,
          description: `Analysis computation error: ${sandboxResult.error}`,
          recommendation: "The analysis code encountered an error. Some data may be insufficient for this analysis type.",
          confidence: 0.5,
        }],
        summary: `${input.analysis} analysis could not be completed: ${sandboxResult.error}`,
      };
    }

    // ── Step 3: LLM interprets the computed analytics ─────────
    const computedData = JSON.stringify(sandboxResult.result, null, 2);

    const defaultPrompts: Record<string, string> = {
      "demand-forecast": `Interpret this demand forecast analysis. The data includes moving averages (7-day and 14-day), velocity trends, stockout projections, and demand variability scores. Focus on products at risk of stockout and provide specific, actionable restocking advice.`,
      "anomaly-detection": `Interpret these detected anomalies. Z-scores and IQR analysis have been performed on order volumes, revenue, and pricing. Explain WHAT each anomaly means in business terms (not statistics), WHY it might have happened, and WHAT to do about it.`,
      "restock-recommendations": `Interpret these restock recommendations. Velocity-based analysis with safety stock calculations has been performed. Prioritize by urgency. For each recommendation, explain why and suggest a specific action (quantity, timing).`,
      "sales-trends": `Interpret these sales trend analytics. Growth rates, product momentum scoring, and day-of-week patterns have been calculated. Identify the key story: is the business growing? Which products are driving/dragging? Any seasonal patterns?`,
    };

    const analysisPrompt = aiSettings.aiInsightsInstructions?.trim()
      ? `${aiSettings.aiInsightsInstructions.trim()}\n\nAnalysis type: ${input.analysis}\nTimeframe: last ${input.timeframeDays} days`
      : defaultPrompts[input.analysis];

    let systemPrompt = `You are an expert business intelligence analyst for ${config.companyName}.
You are interpreting PRE-COMPUTED statistical analysis results (not raw data). The heavy computation has already been done — your job is to:
1. Explain what the numbers mean in plain business language
2. Identify the most important findings
3. Provide specific, actionable recommendations
4. Rate your confidence based on data quality

Be specific — reference product names, SKUs, and exact numbers from the analysis.
Use the deployment's terminology: products are called "${config.labels.product}", orders are "${config.labels.order}".
Currency: ${config.currency}`;

    if (aiSettings.aiBusinessContext?.trim()) {
      systemPrompt += `\n\nBusiness context:\n${aiSettings.aiBusinessContext.trim()}`;
    }

    const { object } = await generateObject({
      model: await getModel(),
      schema: z.object({
        insights: z.array(insightSchema),
        summary: z.string(),
      }),
      system: systemPrompt,
      prompt: `${analysisPrompt}

Computed analysis results:
${computedData}`,
    });

    ctx.logger.info(
      `Insights analysis complete (sandbox-powered): ${input.analysis}, ${object.insights.length} insights generated`
    );

    return {
      analysisType: input.analysis,
      generatedAt: new Date().toISOString(),
      insights: object.insights,
      summary: object.summary,
    };
  },
});
