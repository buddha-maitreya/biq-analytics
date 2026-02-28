/**
 * Analytics Data Queries — Fetch data from DB for pre-built Python analytics.
 *
 * Each analytics action needs specific data from the database. This module
 * maps action types to SQL queries that return the right shape for each
 * Python module. The data is passed to the sandbox via JSON.
 *
 * Architecture:
 *   ReportsPage / LLM tool / Scheduler
 *     → getAnalyticsData(action, dateRange)
 *     → SQL query (Drizzle raw)
 *     → Record<string, unknown>[]
 *     → runAnalytics(sandbox, { action, data })
 */

import { db } from "@db/index";
import { sql } from "drizzle-orm";
import type { AnalyticsAction } from "@lib/analytics";

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

export interface DateRange {
  start: string; // ISO date: "2024-01-01"
  end: string;   // ISO date: "2024-12-31"
}

export interface AnalyticsDataResult {
  data: Record<string, unknown>[];
  rowCount: number;
  queryMs: number;
}

// ────────────────────────────────────────────────────────────
// Query Implementations
// ────────────────────────────────────────────────────────────

/** Daily sales aggregates for time-series forecasting */
async function fetchDailySales(range: DateRange): Promise<Record<string, unknown>[]> {
  const result = await db.execute(sql`
    SELECT
      DATE(s.sale_date) as date,
      COUNT(*) as transactions,
      SUM(s.quantity) as units,
      SUM(s.total_amount::numeric) as revenue,
      COUNT(DISTINCT s.product_id) as unique_products
    FROM sales s
    WHERE s.sale_date >= ${range.start}::date
      AND s.sale_date <= ${range.end}::date
    GROUP BY DATE(s.sale_date)
    ORDER BY date
  `);
  return result as Record<string, unknown>[];
}

/** Product-level revenue & quantity for ABC-XYZ classification */
async function fetchProductMetrics(range: DateRange): Promise<Record<string, unknown>[]> {
  const result = await db.execute(sql`
    SELECT
      s.product_id,
      s.product_name as name,
      s.sku,
      s.category,
      COUNT(*) as order_count,
      SUM(s.quantity) as total_quantity,
      SUM(s.total_amount::numeric) as total_revenue,
      AVG(s.unit_price::numeric) as avg_price,
      STDDEV(s.quantity) as qty_stddev,
      AVG(s.quantity) as qty_avg
    FROM sales s
    WHERE s.sale_date >= ${range.start}::date
      AND s.sale_date <= ${range.end}::date
      AND s.product_id IS NOT NULL
    GROUP BY s.product_id, s.product_name, s.sku, s.category
    ORDER BY total_revenue DESC
  `);
  return result as Record<string, unknown>[];
}

/** Customer purchase history for RFM segmentation */
async function fetchCustomerPurchases(range: DateRange): Promise<Record<string, unknown>[]> {
  const result = await db.execute(sql`
    SELECT
      s.customer_id,
      s.customer_name as name,
      DATE(s.sale_date) as purchase_date,
      s.total_amount::numeric as amount,
      s.quantity
    FROM sales s
    WHERE s.sale_date >= ${range.start}::date
      AND s.sale_date <= ${range.end}::date
      AND s.customer_id IS NOT NULL
    ORDER BY s.customer_id, s.sale_date
  `);
  return result as Record<string, unknown>[];
}

/** Customer transaction frequency data for CLV modeling */
async function fetchCustomerTransactions(range: DateRange): Promise<Record<string, unknown>[]> {
  const result = await db.execute(sql`
    SELECT
      s.customer_id,
      s.customer_name as name,
      COUNT(*) as frequency,
      SUM(s.total_amount::numeric) as monetary,
      MIN(DATE(s.sale_date)) as first_purchase,
      MAX(DATE(s.sale_date)) as last_purchase,
      COUNT(DISTINCT DATE(s.sale_date)) as active_days
    FROM sales s
    WHERE s.sale_date >= ${range.start}::date
      AND s.sale_date <= ${range.end}::date
      AND s.customer_id IS NOT NULL
    GROUP BY s.customer_id, s.customer_name
    HAVING COUNT(*) >= 2
    ORDER BY monetary DESC
  `);
  return result as Record<string, unknown>[];
}

/** Co-purchase data for bundle/association analysis */
async function fetchCoPurchases(range: DateRange): Promise<Record<string, unknown>[]> {
  const result = await db.execute(sql`
    SELECT
      oi.order_id,
      oi.product_id,
      p.name as product_name,
      p.sku,
      oi.quantity,
      oi.total_amount::numeric as amount
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    JOIN products p ON p.id = oi.product_id
    WHERE o.created_at >= ${range.start}::date
      AND o.created_at <= ${range.end}::date
      AND oi.product_id IS NOT NULL
    ORDER BY oi.order_id, p.name
  `);
  return result as Record<string, unknown>[];
}

/** Transaction-level data for anomaly detection */
async function fetchTransactions(range: DateRange): Promise<Record<string, unknown>[]> {
  const result = await db.execute(sql`
    SELECT
      s.id,
      s.sale_number,
      DATE(s.sale_date) as date,
      s.product_name,
      s.sku,
      s.category,
      s.warehouse_name,
      s.quantity,
      s.unit_price::numeric as unit_price,
      s.total_amount::numeric as amount,
      s.payment_method,
      s.sold_by
    FROM sales s
    WHERE s.sale_date >= ${range.start}::date
      AND s.sale_date <= ${range.end}::date
    ORDER BY s.sale_date DESC
  `);
  return result as Record<string, unknown>[];
}

/** Inventory + expected vs actual for shrinkage detection */
async function fetchInventoryWithTransactions(range: DateRange): Promise<Record<string, unknown>[]> {
  const result = await db.execute(sql`
    SELECT
      p.id as product_id,
      p.name as product_name,
      p.sku,
      COALESCE(inv.quantity, 0) as current_stock,
      COALESCE(
        (SELECT SUM(it.quantity) FROM inventory_transactions it
         WHERE it.product_id = p.id AND it.type = 'receipt'
         AND it.created_at >= ${range.start}::date AND it.created_at <= ${range.end}::date),
        0
      ) as received,
      COALESCE(
        (SELECT SUM(ABS(it.quantity)) FROM inventory_transactions it
         WHERE it.product_id = p.id AND it.type = 'sale'
         AND it.created_at >= ${range.start}::date AND it.created_at <= ${range.end}::date),
        0
      ) as sold,
      COALESCE(
        (SELECT SUM(it.quantity) FROM inventory_transactions it
         WHERE it.product_id = p.id AND it.type = 'adjustment'
         AND it.created_at >= ${range.start}::date AND it.created_at <= ${range.end}::date),
        0
      ) as adjustments,
      p.cost_price::numeric as cost_price
    FROM products p
    LEFT JOIN inventory inv ON inv.product_id = p.id
    WHERE p.is_active = true
    ORDER BY p.name
  `);
  return result as Record<string, unknown>[];
}

/** Safety stock calculation data — daily demand + lead times */
async function fetchDemandData(range: DateRange): Promise<Record<string, unknown>[]> {
  const result = await db.execute(sql`
    SELECT
      s.product_id,
      s.product_name as name,
      s.sku,
      DATE(s.sale_date) as date,
      SUM(s.quantity) as daily_demand,
      AVG(s.unit_price::numeric) as avg_price,
      p.cost_price::numeric as cost_price,
      p.min_stock_level,
      p.reorder_point
    FROM sales s
    JOIN products p ON p.id = s.product_id
    WHERE s.sale_date >= ${range.start}::date
      AND s.sale_date <= ${range.end}::date
      AND s.product_id IS NOT NULL
    GROUP BY s.product_id, s.product_name, s.sku, DATE(s.sale_date),
             p.cost_price, p.min_stock_level, p.reorder_point
    ORDER BY s.product_id, date
  `);
  return result as Record<string, unknown>[];
}

/** Chart data — scatter (margin vs volume) */
async function fetchMarginVolumeData(range: DateRange): Promise<Record<string, unknown>[]> {
  const result = await db.execute(sql`
    SELECT
      s.product_id,
      s.product_name as name,
      s.category,
      SUM(s.quantity) as volume,
      SUM(s.total_amount::numeric) as revenue,
      AVG(s.unit_price::numeric) as avg_price,
      AVG(s.unit_price::numeric - COALESCE(p.cost_price::numeric, 0)) as avg_margin,
      CASE WHEN AVG(s.unit_price::numeric) > 0
        THEN AVG(s.unit_price::numeric - COALESCE(p.cost_price::numeric, 0)) / AVG(s.unit_price::numeric) * 100
        ELSE 0
      END as margin_pct
    FROM sales s
    LEFT JOIN products p ON p.id = s.product_id
    WHERE s.sale_date >= ${range.start}::date
      AND s.sale_date <= ${range.end}::date
      AND s.product_id IS NOT NULL
    GROUP BY s.product_id, s.product_name, s.category
    ORDER BY revenue DESC
  `);
  return result as Record<string, unknown>[];
}

/** Category-level revenue for treemap */
async function fetchCategoryRevenue(range: DateRange): Promise<Record<string, unknown>[]> {
  const result = await db.execute(sql`
    SELECT
      COALESCE(s.category, 'Uncategorized') as category,
      COUNT(DISTINCT s.product_id) as product_count,
      SUM(s.quantity) as total_units,
      SUM(s.total_amount::numeric) as revenue
    FROM sales s
    WHERE s.sale_date >= ${range.start}::date
      AND s.sale_date <= ${range.end}::date
    GROUP BY s.category
    ORDER BY revenue DESC
  `);
  return result as Record<string, unknown>[];
}

/** Warehouse/region performance for geo map */
async function fetchRegionalPerformance(range: DateRange): Promise<Record<string, unknown>[]> {
  const result = await db.execute(sql`
    SELECT
      COALESCE(s.warehouse_name, 'Unknown') as region,
      COUNT(*) as transactions,
      SUM(s.quantity) as units,
      SUM(s.total_amount::numeric) as revenue,
      COUNT(DISTINCT s.product_id) as unique_products,
      COUNT(DISTINCT s.customer_id) as unique_customers
    FROM sales s
    WHERE s.sale_date >= ${range.start}::date
      AND s.sale_date <= ${range.end}::date
    GROUP BY s.warehouse_name
    ORDER BY revenue DESC
  `);
  return result as Record<string, unknown>[];
}

// ────────────────────────────────────────────────────────────
// Action → Query Mapping
// ────────────────────────────────────────────────────────────

/**
 * Mapping of analytics actions to their data-fetching functions.
 * Each action knows exactly what data it needs from the database.
 */
const ACTION_QUERY_MAP: Record<AnalyticsAction, (range: DateRange) => Promise<Record<string, unknown>[]>> = {
  // Charts
  "chart.sales_trends": fetchDailySales,
  "chart.heatmap": fetchDailySales,
  "chart.scatter": fetchMarginVolumeData,
  "chart.treemap": fetchCategoryRevenue,
  "chart.pareto": fetchProductMetrics,
  "chart.waterfall": fetchCategoryRevenue,
  "chart.forecast": fetchDailySales,
  "chart.geo_map": fetchRegionalPerformance,
  // Forecasting
  "forecast.prophet": fetchDailySales,
  "forecast.arima": fetchDailySales,
  "forecast.holt_winters": fetchDailySales,
  "forecast.safety_stock": fetchDemandData,
  // Classification
  "classify.abc_xyz": fetchProductMetrics,
  "classify.rfm": fetchCustomerPurchases,
  "classify.clv": fetchCustomerTransactions,
  "classify.bundles": fetchCoPurchases,
  // Anomaly detection
  "anomaly.transactions": fetchTransactions,
  "anomaly.shrinkage": fetchInventoryWithTransactions,
};

// ────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────

/**
 * Fetch the data needed for a specific analytics action.
 *
 * @param action - The analytics action to run
 * @param range - Date range for the query
 * @returns The data rows, count, and query timing
 *
 * @example
 * ```ts
 * const { data } = await getAnalyticsData("forecast.prophet", {
 *   start: "2024-06-01",
 *   end: "2024-12-31",
 * });
 * const result = await runAnalytics(sandbox, {
 *   action: "forecast.prophet",
 *   data,
 * });
 * ```
 */
export async function getAnalyticsData(
  action: AnalyticsAction,
  range: DateRange
): Promise<AnalyticsDataResult> {
  const queryFn = ACTION_QUERY_MAP[action];
  if (!queryFn) {
    throw new Error(`No data query defined for action: ${action}`);
  }

  const start = performance.now();
  const data = await queryFn(range);
  const queryMs = Math.round(performance.now() - start);

  return { data, rowCount: data.length, queryMs };
}

/**
 * Get the default date range for a given action.
 * Forecasting/trends use 90 days, others use 30 days.
 */
export function getDefaultRange(action: AnalyticsAction): DateRange {
  const daysBack = action.startsWith("forecast.") || action.startsWith("chart.")
    ? 90
    : 30;

  const end = new Date();
  const start = new Date(end.getTime() - daysBack * 86_400_000);

  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

// ────────────────────────────────────────────────────────────
// Analytics Type Metadata (for UI display)
// ────────────────────────────────────────────────────────────

export interface AnalyticsTypeInfo {
  action: AnalyticsAction;
  label: string;
  description: string;
  category: "forecasting" | "classification" | "anomaly" | "charts";
  icon: string;
}

/** All available predictive analytics types for UI selection */
export const PREDICTIVE_ANALYTICS_TYPES: AnalyticsTypeInfo[] = [
  // Forecasting
  {
    action: "forecast.prophet",
    label: "Prophet Forecast",
    description: "Time-series forecasting using Facebook Prophet with automatic seasonality and holiday detection",
    category: "forecasting",
    icon: "📈",
  },
  {
    action: "forecast.arima",
    label: "ARIMA Forecast",
    description: "Statistical SARIMA model with automatic order selection via AIC grid search",
    category: "forecasting",
    icon: "📉",
  },
  {
    action: "forecast.holt_winters",
    label: "Holt-Winters Forecast",
    description: "Exponential smoothing with trend and seasonal components for demand prediction",
    category: "forecasting",
    icon: "🔮",
  },
  {
    action: "forecast.safety_stock",
    label: "Safety Stock & EOQ",
    description: "Calculate optimal safety stock levels and economic order quantities per product",
    category: "forecasting",
    icon: "🛡️",
  },
  // Classification
  {
    action: "classify.abc_xyz",
    label: "ABC-XYZ Classification",
    description: "Classify products by revenue contribution (ABC) and demand variability (XYZ) — 9-cell matrix",
    category: "classification",
    icon: "🏷️",
  },
  {
    action: "classify.rfm",
    label: "RFM Segmentation",
    description: "Segment customers by Recency, Frequency, and Monetary value for targeted marketing",
    category: "classification",
    icon: "👥",
  },
  {
    action: "classify.clv",
    label: "Customer Lifetime Value",
    description: "Probabilistic CLV using BG/NBD + Gamma-Gamma models to predict future customer value",
    category: "classification",
    icon: "💎",
  },
  {
    action: "classify.bundles",
    label: "Bundle Analysis",
    description: "Find frequently co-purchased products using Apriori/FP-Growth association rules",
    category: "classification",
    icon: "🎁",
  },
  // Anomaly Detection
  {
    action: "anomaly.transactions",
    label: "Transaction Anomalies",
    description: "Detect unusual transactions using Isolation Forest and Local Outlier Factor algorithms",
    category: "anomaly",
    icon: "🔍",
  },
  {
    action: "anomaly.shrinkage",
    label: "Inventory Shrinkage",
    description: "Identify inventory shrinkage and discrepancies using statistical threshold analysis",
    category: "anomaly",
    icon: "📦",
  },
];
