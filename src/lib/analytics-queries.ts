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
import { dbRows } from "@db/rows";
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
  return dbRows(result) as Record<string, unknown>[];
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
  return dbRows(result) as Record<string, unknown>[];
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
  return dbRows(result) as Record<string, unknown>[];
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
  return dbRows(result) as Record<string, unknown>[];
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
  return dbRows(result) as Record<string, unknown>[];
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
  return dbRows(result) as Record<string, unknown>[];
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
  return dbRows(result) as Record<string, unknown>[];
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
  return dbRows(result) as Record<string, unknown>[];
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
  return dbRows(result) as Record<string, unknown>[];
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
  return dbRows(result) as Record<string, unknown>[];
}

/**
 * Value Gap Analysis — multi-section payload combining:
 *  - 'inventory'  rows: product stock + dead-stock flag (no sales in 30d)
 *  - 'sales'      rows: daily revenue aggregates for trend analysis
 *  - 'mpesa'      rows: M-Pesa posTransaction status counts
 *
 * The Python module splits by metric_type and computes each KPI independently.
 */
async function fetchValueGapData(range: DateRange): Promise<Record<string, unknown>[]> {
  const [inventoryRows, salesRows, mpesaRows] = await Promise.all([
    // 1. Inventory with dead-stock flag (in-stock products only)
    db.execute(sql`
      SELECT
        'inventory' as metric_type,
        p.name as product_name,
        p.sku,
        COALESCE(inv.quantity, 0) as current_stock,
        COALESCE(p.cost_price::numeric, 0) as cost_price,
        COALESCE(inv.quantity, 0) * COALESCE(p.cost_price::numeric, 0) as inventory_value,
        CASE
          WHEN NOT EXISTS (
            SELECT 1 FROM sales s2
            WHERE s2.product_id = p.id
              AND s2.sale_date >= (${range.end}::date - INTERVAL '30 days')
              AND s2.sale_date <= ${range.end}::date
          ) THEN 1
          ELSE 0
        END as is_dead_stock
      FROM products p
      LEFT JOIN inventory inv ON inv.product_id = p.id
      WHERE p.is_active = true
        AND COALESCE(inv.quantity, 0) > 0
    `),
    // 2. Daily sales for period-over-period trend
    db.execute(sql`
      SELECT
        'sales' as metric_type,
        DATE(s.sale_date) as date,
        SUM(s.total_amount::numeric) as revenue,
        COUNT(*) as transactions
      FROM sales s
      WHERE s.sale_date >= ${range.start}::date
        AND s.sale_date <= ${range.end}::date
      GROUP BY DATE(s.sale_date)
      ORDER BY date
    `),
    // 3. M-Pesa reconciliation via posTransactions
    db.execute(sql`
      SELECT
        'mpesa' as metric_type,
        pt.status,
        COUNT(*) as tx_count,
        COALESCE(SUM(pt.total_amount::numeric), 0) as total_amount
      FROM pos_transactions pt
      WHERE pt.pos_vendor = 'mpesa'
        AND pt.created_at >= ${range.start}::date
        AND pt.created_at <= ${range.end}::date
      GROUP BY pt.status
    `),
  ]);

  return [
    ...dbRows(inventoryRows),
    ...dbRows(salesRows),
    ...dbRows(mpesaRows),
  ] as Record<string, unknown>[];
}

/** Products with no sales in the last 30+ days (dead stock) */
async function fetchDeadStockData(range: DateRange): Promise<Record<string, unknown>[]> {
  const result = await db.execute(sql`
    SELECT p.name AS product_name, p.sku,
           COALESCE(i.quantity, 0) AS current_stock,
           MAX(s.created_at) AS last_sale_date,
           COALESCE(SUM(s.quantity), 0) AS total_sold_30d,
           p.cost_price, p.price AS selling_price
    FROM products p
    LEFT JOIN inventory i ON i.product_id = p.id
    LEFT JOIN sales s ON s.product_id = p.id AND s.created_at >= (CURRENT_DATE - INTERVAL '30 days')
    WHERE p.is_active = true
    GROUP BY p.id, p.name, p.sku, i.quantity, p.cost_price, p.price
    HAVING COALESCE(i.quantity, 0) > 0
    ORDER BY last_sale_date ASC NULLS FIRST
  `);
  return dbRows(result) as Record<string, unknown>[];
}

/** Products with cost and stock for capital simulation */
async function fetchCashInStockData(_range: DateRange): Promise<Record<string, unknown>[]> {
  const result = await db.execute(sql`
    SELECT p.name AS product_name, p.sku, p.cost_price,
           COALESCE(i.quantity, 0) AS quantity,
           COALESCE(AVG(s.quantity)::numeric / 30.0, 0) AS avg_daily_sales,
           p.price AS selling_price
    FROM products p
    LEFT JOIN inventory i ON i.product_id = p.id
    LEFT JOIN sales s ON s.product_id = p.id AND s.created_at >= (CURRENT_DATE - INTERVAL '90 days')
    WHERE p.is_active = true AND p.cost_price > 0
    GROUP BY p.id, p.name, p.sku, p.cost_price, i.quantity, p.price
    ORDER BY (p.cost_price * COALESCE(i.quantity, 0)) DESC
  `);
  return dbRows(result) as Record<string, unknown>[];
}

/** Products needing restock grouped by supplier */
async function fetchProcurementData(_range: DateRange): Promise<Record<string, unknown>[]> {
  const result = await db.execute(sql`
    SELECT p.name AS product_name, p.sku,
           p.supplier_name,
           COALESCE(i.quantity, 0) AS current_stock,
           p.reorder_point,
           p.cost_price,
           14 AS lead_time_days
    FROM products p
    LEFT JOIN inventory i ON i.product_id = p.id
    WHERE p.is_active = true
      AND p.reorder_point > 0
      AND COALESCE(i.quantity, 0) <= p.reorder_point
    ORDER BY p.supplier_name NULLS LAST, p.name
  `);
  return dbRows(result) as Record<string, unknown>[];
}

/** Supplier delivery tracking (stub — no delivery table yet) */
async function fetchSupplierPerformanceData(_range: DateRange): Promise<Record<string, unknown>[]> {
  // Supplier delivery tracking data is not yet available.
  // This will be populated once delivery tracking is added to the schema.
  return [];
}

/** Products with zero-stock periods for stockout cost estimation */
async function fetchStockoutHistory(_range: DateRange): Promise<Record<string, unknown>[]> {
  const result = await db.execute(sql`
    SELECT p.name AS product_name, p.sku,
           p.price AS selling_price,
           COALESCE(AVG(daily_sales.qty), 0) AS avg_daily_sales,
           GREATEST(0, DATE_PART('day', NOW() - MAX(it.created_at))) AS stockout_days
    FROM products p
    LEFT JOIN inventory i ON i.product_id = p.id AND i.quantity = 0
    LEFT JOIN inventory_transactions it ON it.product_id = p.id AND it.type = 'adjustment'
    LEFT JOIN (
      SELECT product_id, AVG(quantity) AS qty FROM sales
      WHERE created_at >= CURRENT_DATE - INTERVAL '90 days'
      GROUP BY product_id
    ) daily_sales ON daily_sales.product_id = p.id
    WHERE p.is_active = true AND COALESCE(i.quantity, 0) = 0
    GROUP BY p.id, p.name, p.sku, p.price
  `);
  return dbRows(result) as Record<string, unknown>[];
}

/** Sales velocity scoring — volume and margins per product */
async function fetchSalesVelocityData(range: DateRange): Promise<Record<string, unknown>[]> {
  const startDate = range.start;
  const endDate = range.end;
  // Compute days in period for velocity calculation
  const days = Math.max(
    1,
    Math.ceil(
      (new Date(endDate).getTime() - new Date(startDate).getTime()) / 86_400_000
    )
  );

  const result = await db.execute(sql`
    SELECT p.name AS product_name, p.sku,
           COALESCE(SUM(s.quantity), 0) AS quantity_sold,
           ${days} AS days_in_period,
           p.price AS selling_price,
           p.cost_price
    FROM products p
    LEFT JOIN sales s ON s.product_id = p.id AND s.created_at >= ${startDate}::date AND s.created_at <= ${endDate}::date
    WHERE p.is_active = true AND p.price > 0
    GROUP BY p.id, p.name, p.sku, p.price, p.cost_price
    ORDER BY quantity_sold DESC
  `);
  return dbRows(result) as Record<string, unknown>[];
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
  return dbRows(result) as Record<string, unknown>[];
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
  "chart.render": async () => [], // chart.render uses data from params.charts, not DB queries
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
  // Insights
  "insights.value_gap": fetchValueGapData,
  "insights.dead_stock": fetchDeadStockData,
  "insights.cash_simulation": fetchCashInStockData,
  "insights.procurement_plan": fetchProcurementData,
  "insights.supplier_analysis": fetchSupplierPerformanceData,
  "insights.stockout_cost": fetchStockoutHistory,
  "insights.sales_velocity": fetchSalesVelocityData,
  // Seasonal
  "forecast.seasonal_detect": fetchDailySales,
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
  const daysBack = action.startsWith("forecast.") || action.startsWith("chart.") || action.startsWith("insights.")
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
  category: "forecasting" | "classification" | "anomaly" | "charts" | "insights";
  icon: string;
}

/** All available predictive analytics types for UI selection */
export const PREDICTIVE_ANALYTICS_TYPES: AnalyticsTypeInfo[] = [
  // Insights
  {
    action: "insights.value_gap",
    label: "AI vs Standard POS: Value Gap",
    description: "See your business's real performance — dead stock rate, waste risk, revenue momentum, and M-Pesa reconciliation accuracy — compared against what a standard POS delivers. Answers: 'What is my AI system actually saving me?'",
    category: "insights",
    icon: "🏆",
  },
  // Forecasting
  {
    action: "forecast.prophet",
    label: "Sales Demand Forecast",
    description: "Predicts how much you will sell over any period ahead. Automatically accounts for day-of-week patterns, seasonal peaks, and Kenyan public holidays. Answers: 'How much stock do I need to prepare for next week, month, or quarter?'",
    category: "forecasting",
    icon: "📈",
  },
  {
    action: "forecast.arima",
    label: "Statistical Demand Forecast",
    description: "A self-calibrating forecast model that learns your store's unique sales rhythm. Best for businesses with steady, repeating patterns. Answers: 'What is my expected revenue this period based on my own historical trend?'",
    category: "forecasting",
    icon: "📉",
  },
  {
    action: "forecast.holt_winters",
    label: "Trend & Seasonality Forecast",
    description: "Tracks both where your demand is heading and how it fluctuates with seasons simultaneously. Ideal when your business is growing and has clear busy/quiet periods. Answers: 'How is my demand growing and when should I stock up?'",
    category: "forecasting",
    icon: "🔮",
  },
  {
    action: "forecast.safety_stock",
    label: "Safety Stock & Reorder Planner",
    description: "Calculates the exact buffer stock each product needs to never run out, plus the most cost-efficient order quantity per SKU. Answers: 'How much should I reorder for each product, and when should I place the order?'",
    category: "forecasting",
    icon: "🛡️",
  },
  // Classification
  {
    action: "classify.abc_xyz",
    label: "Product Portfolio Ranking",
    description: "Scores every product on two scales: how much revenue it generates (A = top 80%, B = next 15%, C = bottom 5%) and how consistently it sells (X = steady, Y = variable, Z = erratic). Answers: 'Which products deserve my capital and shelf space, and which are dead weight?'",
    category: "classification",
    icon: "🏷️",
  },
  {
    action: "classify.rfm",
    label: "Customer Loyalty Segmentation",
    description: "Automatically groups every customer by how recently they bought, how often they return, and how much they spend — producing segments like Champions, Loyal, At Risk, and Lost. Answers: 'Who are my best customers, and who is slipping away before it is too late?'",
    category: "classification",
    icon: "👥",
  },
  {
    action: "classify.clv",
    label: "Customer Lifetime Value",
    description: "Predicts the total future revenue each customer is likely to generate for your business over the next 12 months, ranked from most to least valuable. Answers: 'Which customers are worth investing in — discounts, loyalty rewards, personal follow-up?'",
    category: "classification",
    icon: "💎",
  },
  {
    action: "classify.bundles",
    label: "Product Bundle Finder",
    description: "Mines your order history to find which products customers consistently buy together. Answers: 'What should I bundle, cross-sell, or place side-by-side to increase average basket size?'",
    category: "classification",
    icon: "🎁",
  },
  // Anomaly Detection
  {
    action: "anomaly.transactions",
    label: "Suspicious Transaction Scan",
    description: "Reviews every sale for unusual patterns — abnormal quantities, off-hours transactions, price deviations, or staff-specific outliers that fall outside your normal range. Answers: 'Is anything irregular happening at my till that I should investigate?'",
    category: "anomaly",
    icon: "🔍",
  },
  {
    action: "anomaly.shrinkage",
    label: "Inventory Loss Detection",
    description: "Compares what your records say you should have in stock against what is physically there, then flags every product with unexplained discrepancies. Answers: 'Where is my inventory disappearing — theft, damage, spoilage, or recording errors?'",
    category: "anomaly",
    icon: "📦",
  },
  // New Insights
  {
    action: "insights.dead_stock",
    label: "Dead Stock Analysis",
    description: "Identifies slow-moving inventory with no recent sales, ranks by capital at risk, and suggests markdown/bundle/write-off actions. Answers: 'Which products are gathering dust and tying up my cash?'",
    category: "insights",
    icon: "🪦",
  },
  {
    action: "insights.cash_simulation",
    label: "Cash-in-Stock Simulation",
    description: "Monte Carlo simulation of capital tied up in inventory by ABC tier, projecting sell-through timelines and flagging over-stocked items. Answers: 'How much working capital is locked in my warehouse and when will I recover it?'",
    category: "insights",
    icon: "💰",
  },
  {
    action: "insights.procurement_plan",
    label: "Procurement Plan",
    description: "Aggregates restock needs by supplier into a consolidated purchase plan with estimated costs and lead times. Answers: 'What do I need to order and from which suppliers?'",
    category: "insights",
    icon: "📋",
  },
  {
    action: "insights.supplier_analysis",
    label: "Supplier Reliability Analysis",
    description: "Scores suppliers on on-time delivery rate and lead time variance with a composite reliability score. Answers: 'Which suppliers can I trust and which need attention?'",
    category: "insights",
    icon: "🤝",
  },
  {
    action: "insights.stockout_cost",
    label: "Stockout Cost Estimation",
    description: "Quantifies revenue and profit lost from zero-stock periods by estimating missed sales from historical demand. Answers: 'How much money am I losing because products are out of stock?'",
    category: "insights",
    icon: "🚫",
  },
  {
    action: "insights.sales_velocity",
    label: "Sales Velocity Scoring",
    description: "Classifies products into Stars, Volume Movers, Premium, and Dogs based on velocity x margin quadrant analysis. Answers: 'Which products are my stars and which should I drop?'",
    category: "insights",
    icon: "⚡",
  },
  // New Forecasting
  {
    action: "forecast.seasonal_detect",
    label: "Seasonal Pattern Detection",
    description: "Uses FFT (Fast Fourier Transform) to auto-detect weekly, monthly, and annual cycles in your sales data. Answers: 'Are there hidden seasonal patterns I should plan around?'",
    category: "forecasting",
    icon: "🌊",
  },
];
