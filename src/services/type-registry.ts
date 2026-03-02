/**
 * Extensible Analysis & Report Type Registry
 *
 * Phase 3.4: Moves hardcoded analysis/report types from Zod enums
 * to a data-driven registry backed by the agent_configs DB table.
 *
 * Each type definition includes:
 *   - slug: machine identifier (e.g. "sales-trends")
 *   - label: human-friendly display name
 *   - description: short description for admin UI
 *   - promptTemplate: analysis/report-specific prompt injected into the agent
 *
 * Types are stored in the agent config's `config.customTypes` JSONB field.
 * Built-in types are always available as fallbacks.
 *
 * Usage:
 *   const types = await getAnalysisTypes();
 *   const prompt = getAnalysisPromptForType(types, "sales-trends", 30);
 */

import { getAgentConfigWithDefaults } from "@services/agent-configs";
import { memoryCache } from "@lib/cache";
import { injectLabels } from "@lib/prompts";

// ── Type Definition ────────────────────────────────────────

export interface TypeDefinition {
  /** Machine slug (e.g. "sales-trends", "inventory-health") */
  slug: string;
  /** Human-friendly label (e.g. "Sales Trends Analysis") */
  label: string;
  /** Short description for admin UI and LLM context */
  description: string;
  /** Prompt template injected into the agent's system/user prompt.
   *  Can contain placeholders: {timeframeDays}, {periodStr}, {startStr}, {endStr}
   *  and label tokens: {{PRODUCT_LABEL}}, {{ORDER_LABEL}}, etc. */
  promptTemplate: string;
  /** Optional few-shot examples showing expected input→output patterns.
   *  Each example has a `userInput` and `expectedBehavior` description. */
  fewShotExamples?: Array<{
    userInput: string;
    expectedBehavior: string;
  }>;
}

// ── Built-in Analysis Types ────────────────────────────────

const BUILTIN_ANALYSIS_TYPES: TypeDefinition[] = [
  {
    slug: "demand-forecast",
    label: "Demand Forecast",
    description: "Predict future demand based on sales velocity and trends",
    promptTemplate: `Perform DEMAND FORECASTING analysis:
- Fetch daily sales data and current stock levels for the last {timeframeDays} days for all {{PRODUCT_LABEL_PLURAL}}
- Write Python to compute: moving averages (DF.rolling(7).mean(), DF.rolling(14).mean()), sales velocity, velocity acceleration/deceleration, days until stockout, demand variability (coefficient of variation via np.std/np.mean)
- Use ExponentialSmoothing from statsmodels for trend extrapolation if enough data points
- Identify {{PRODUCT_LABEL_PLURAL}} at risk of stockout and {{PRODUCT_LABEL_PLURAL}} with accelerating/decelerating demand
- Return structured data with per-{{PRODUCT_LABEL}} forecasts sorted by risk level`,
    fewShotExamples: [
      {
        userInput: "Which products will run out first?",
        expectedBehavior: "Fetch sales velocity and current stock. Use pandas groupby + rolling mean to compute velocity per product. Calculate days-until-stockout, sort by urgency and flag critical items.",
      },
      {
        userInput: "Predict demand for next 2 weeks",
        expectedBehavior: "Use ExponentialSmoothing or scipy.stats.linregress to extrapolate 7-day and 14-day forecasts. Identify acceleration/deceleration trends per product using pandas pct_change().",
      },
    ],
  },
  {
    slug: "anomaly-detection",
    label: "Anomaly Detection",
    description: "Identify unusual patterns in orders, revenue, and pricing",
    promptTemplate: `Perform ANOMALY DETECTION analysis:
- Fetch daily {{ORDER_LABEL}} volumes, revenue, and per-{{PRODUCT_LABEL}} sales data for the last {timeframeDays} days
- Write Python to compute: z-scores via scipy.stats.zscore() for daily volumes/revenue, IQR analysis for pricing outliers (np.percentile or DF.quantile), volume spike detection
- Use IsolationForest from sklearn for multivariate anomaly detection if sufficient data
- Flag any data point with |z-score| > 2 as anomalous
- Return structured anomaly data with severity ratings, directions (spike/drop), and affected entities`,
    fewShotExamples: [
      {
        userInput: "Anything unusual in last month's sales?",
        expectedBehavior: "Use scipy.stats.zscore() on daily revenue and order counts. Flag days with |z| > 2. Use DF.quantile() for IQR-based pricing outlier detection.",
      },
    ],
  },
  {
    slug: "restock-recommendations",
    label: "Restock Recommendations",
    description: "Calculate optimal reorder quantities and urgency",
    promptTemplate: `Perform RESTOCK RECOMMENDATIONS analysis:
- Fetch sales velocity data and current stock levels for the last {timeframeDays} days
- Write Python to compute: daily velocity per {{PRODUCT_LABEL}} (DF.groupby + rolling mean), safety stock (1.5x lead time buffer assuming 7-day lead time), optimal reorder quantities, days of stock remaining, urgency classification
- Use numpy for statistical computations (np.std for demand variability, np.ceil for rounding)
- Prioritize by urgency: out-of-stock > critical (<=3 days) > high (<=7 days) > medium (<=14 days) > low
- Return structured recommendations sorted by urgency`,
    fewShotExamples: [
      {
        userInput: "What do I need to reorder?",
        expectedBehavior: "Use pandas groupby for per-product velocity. Compute safety stock with np.ceil(velocity * lead_time * 1.5). Classify urgency based on days_remaining, sort and return reorder list.",
      },
    ],
  },
  {
    slug: "sales-trends",
    label: "Sales Trends",
    description: "Analyze revenue trends, product momentum, and day-of-week patterns",
    promptTemplate: `Perform SALES TRENDS analysis:
- Fetch weekly revenue, daily revenue, and per-{{PRODUCT_LABEL}} weekly breakdown for the last {timeframeDays} days
- Write Python to compute: overall growth rate (first half vs second half using DF slicing), {{PRODUCT_LABEL}} momentum scoring (DF.pct_change() on recent vs earlier periods), day-of-week revenue patterns (DF.groupby(DF['date'].dt.dayofweek)), peak identification
- Use scipy.stats.linregress for trend line fitting and p-value significance
- Classify {{PRODUCT_LABEL_PLURAL}} as accelerating (>15% momentum), decelerating (<-15%), or steady
- Return structured trend data with overall metrics, top growers, top decliners, and day patterns`,
    fewShotExamples: [
      {
        userInput: "How are sales trending?",
        expectedBehavior: "Use scipy.stats.linregress for trend line. Compute week-over-week growth with pandas pct_change(). Identify top accelerating/decelerating products using momentum scoring.",
      },
      {
        userInput: "Which day of the week sells the most?",
        expectedBehavior: "Use DF.groupby(DF['date'].dt.dayofweek).agg({'revenue': ['sum', 'mean']}) to aggregate by day-of-week. Identify peak and trough days.",
      },
    ],
  },
];

// ── Built-in Report Types ──────────────────────────────────

const BUILTIN_REPORT_TYPES: TypeDefinition[] = [
  {
    slug: "sales-summary",
    label: "Sales Summary",
    description: "Revenue, orders, top products and customers",
    promptTemplate: `Generate a SALES SUMMARY report for the period {periodStr}.
Use multiple fetch_data calls — one per data section below:

1. PERIOD TOTALS: total revenue (SUM), {{ORDER_LABEL}} count (COUNT), average {{ORDER_LABEL}} value (AVG), unique {{CUSTOMER_LABEL_PLURAL}} who ordered (COUNT DISTINCT customer_id). Filter: {startStr} to {endStr}.

2. PRIOR PERIOD TOTALS (same duration shifted back) for period-over-period comparison: same metrics but for the window immediately before {startStr}. Use: created_at >= ('{startStr}'::date - INTERVAL 'X days') AND created_at < '{startStr}'::date where X = number of days in the report period.

3. TOP 10 {{PRODUCT_LABEL_PLURAL}} by revenue: product name, total revenue, units sold, % of period revenue, number of distinct {{CUSTOMER_LABEL_PLURAL}} who bought it. GROUP BY product, ORDER BY revenue DESC, LIMIT 10.

4. TOP 10 {{CUSTOMER_LABEL_PLURAL}} by spend: customer name, total spend, {{ORDER_LABEL}} count, average {{ORDER_LABEL}} value, last {{ORDER_LABEL}} date. ORDER BY spend DESC, LIMIT 10.

5. DAILY REVENUE TREND: date, daily revenue, daily {{ORDER_LABEL}} count. GROUP BY DATE(created_at), ORDER BY date ASC. Include every day in the period (use generate_series or rely on actual order dates).

6. REVENUE BY CATEGORY (if a category/type column exists on products): category, revenue, % of total, {{ORDER_LABEL}} count. ORDER BY revenue DESC.`,
    fewShotExamples: [
      {
        userInput: "Monthly sales report",
        expectedBehavior: "Fetch period totals + prior period for comparison, top 10 products with % of revenue, top 10 customers with order counts, daily trend, and category breakdown. Write a report with specific figures, period-over-period comparison, and named recommendations.",
      },
    ],
  },
  {
    slug: "inventory-health",
    label: "Inventory Health",
    description: "Stock levels, low stock alerts, slow movers, inventory valuation",
    promptTemplate: `Generate an INVENTORY HEALTH report (point-in-time — no date filter needed for stock levels).
Use multiple fetch_data calls — one per data section below:

1. STOCK SUMMARY: total active {{PRODUCT_LABEL_PLURAL}}, total units on hand (SUM quantity), total inventory value (SUM quantity * cost_price), count of out-of-stock (quantity = 0), count of low-stock (quantity > 0 AND quantity <= reorder_point), count of healthy stock (quantity > reorder_point).

2. CRITICAL STOCK LIST: all {{PRODUCT_LABEL_PLURAL}} where quantity <= reorder_point. Columns: name, sku, current quantity, reorder_point, deficit (reorder_point - quantity), inventory value. Order by (quantity::float / NULLIF(reorder_point, 1)) ASC — most critical first. LIMIT 20.

3. TOP 15 {{PRODUCT_LABEL_PLURAL}} BY INVENTORY VALUE: name, sku, quantity, cost_price, total value (quantity * cost_price), % of total inventory value. ORDER BY value DESC.

4. SLOW-MOVING STOCK: {{PRODUCT_LABEL_PLURAL}} with quantity > 0 but zero sales in the last 30 days (LEFT JOIN order_items on product_id, filter for recent sales, WHERE recent_sales IS NULL or recent_sales = 0). Include: name, sku, quantity on hand, inventory value (quantity * cost_price), days since last sale.

5. OUT-OF-STOCK ITEMS: full list of {{PRODUCT_LABEL_PLURAL}} with quantity = 0 and is_active = true. Include: name, sku, reorder_point, cost_price.`,
    fewShotExamples: [
      {
        userInput: "Stock health check",
        expectedBehavior: "Query stock summary, critical/low-stock list sorted by severity, top items by inventory value, slow-movers with inventory value at risk, and out-of-stock items. Write a report naming specific products, quantities, and dollar values at risk.",
      },
    ],
  },
  {
    slug: "customer-activity",
    label: "Customer Activity",
    description: "Customer counts, top spenders, order frequency, new vs returning",
    promptTemplate: `Generate a {{CUSTOMER_LABEL}} ACTIVITY report for the period {periodStr}.
Use multiple fetch_data calls — one per data section below:

1. {{CUSTOMER_LABEL}} SUMMARY: total {{CUSTOMER_LABEL_PLURAL}} in DB, active {{CUSTOMER_LABEL_PLURAL}} in period (placed at least one {{ORDER_LABEL}}), new {{CUSTOMER_LABEL_PLURAL}} (created_at within period), returning {{CUSTOMER_LABEL_PLURAL}} (active but created before period start). Filter {{ORDER_LABEL_PLURAL}}: {startStr} to {endStr}.

2. PRIOR PERIOD ACTIVE COUNT: count of {{CUSTOMER_LABEL_PLURAL}} who ordered in the immediately preceding period of the same length — for period-over-period active customer comparison.

3. TOP 15 {{CUSTOMER_LABEL_PLURAL}} BY SPEND: name, total spend, {{ORDER_LABEL}} count, average {{ORDER_LABEL}} value, first {{ORDER_LABEL}} date, last {{ORDER_LABEL}} date. Use {{ORDER_LABEL_PLURAL}} in the report period. ORDER BY spend DESC, LIMIT 15.

4. ORDER FREQUENCY DISTRIBUTION: how many {{CUSTOMER_LABEL_PLURAL}} placed exactly 1 {{ORDER_LABEL}}, 2 {{ORDER_LABEL_PLURAL}}, 3 {{ORDER_LABEL_PLURAL}}, 4 {{ORDER_LABEL_PLURAL}}, 5+ {{ORDER_LABEL_PLURAL}} in the period. Use a GROUP BY subquery: SELECT order_count, COUNT(*) as customer_count FROM (SELECT customer_id, COUNT(*) as order_count FROM orders WHERE ... GROUP BY customer_id) sub GROUP BY order_count ORDER BY order_count.

5. NEW VS RETURNING REVENUE SPLIT: total revenue from new {{CUSTOMER_LABEL_PLURAL}} vs returning {{CUSTOMER_LABEL_PLURAL}} in the period. JOIN customers on created_at to determine new/returning status.

6. AT-RISK {{CUSTOMER_LABEL_PLURAL}}: {{CUSTOMER_LABEL_PLURAL}} who ordered in the prior period but have NOT ordered in the current period (potential churn). Show: name, last order date, total historical spend. LIMIT 10.`,
  },
  {
    slug: "financial-overview",
    label: "Financial Overview",
    description: "Revenue, invoicing, payments, accounts receivable, and aging",
    promptTemplate: `Generate a FINANCIAL OVERVIEW report for the period {periodStr}.
Use multiple fetch_data calls — one per data section below:

1. REVENUE SUMMARY: total {{ORDER_LABEL}} revenue, {{ORDER_LABEL}} count, average {{ORDER_LABEL}} value, revenue from paid vs unpaid {{ORDER_LABEL_PLURAL}} (if payment_status column exists). Filter: {startStr} to {endStr}.

2. PRIOR PERIOD REVENUE: same metrics for the immediately preceding period of equal length — for period-over-period comparison.

3. INVOICE SUMMARY: total invoiced amount (SUM total_amount), total collected (SUM amount_paid or similar), outstanding balance (total - collected), count of invoices by status (paid, partial, overdue, pending). Use the invoices table.

4. ACCOUNTS RECEIVABLE AGING: group unpaid invoice balances by how overdue they are:
   - Current (due_date >= TODAY)
   - 1–30 days overdue
   - 31–60 days overdue
   - 61–90 days overdue
   - 90+ days overdue
   Show: bucket label, invoice count, total amount outstanding, % of total AR. Use CASE WHEN on (CURRENT_DATE - due_date).

5. TOP 10 OUTSTANDING INVOICES: customer name, invoice number, invoice date, due date, amount, days overdue. ORDER BY days overdue DESC, LIMIT 10.

6. PAYMENT METHOD DISTRIBUTION (if payment data exists): payment method, transaction count, total amount, % of total collected. GROUP BY payment method, ORDER BY amount DESC.`,
  },
];

// ── Registry Functions ─────────────────────────────────────

/**
 * Get all available analysis types (built-in + custom).
 * Custom types from agent config are merged with built-in types.
 * Custom types with matching slugs override built-in definitions.
 */
export async function getAnalysisTypes(): Promise<TypeDefinition[]> {
  const cacheKey = "type-registry:analysis";
  const cached = memoryCache.get<TypeDefinition[]>(cacheKey);
  if (cached) return cached;

  try {
    const config = await getAgentConfigWithDefaults("insights-analyzer");
    const cfg = (config.config ?? {}) as Record<string, unknown>;
    const customTypes = (cfg.customTypes as TypeDefinition[]) ?? [];

    const result = mergeTypes(BUILTIN_ANALYSIS_TYPES, customTypes);
    memoryCache.set(cacheKey, result, 120); // 2-minute cache
    return result;
  } catch {
    return BUILTIN_ANALYSIS_TYPES;
  }
}

/**
 * Get all available report types (built-in + custom).
 */
export async function getReportTypes(): Promise<TypeDefinition[]> {
  const cacheKey = "type-registry:report";
  const cached = memoryCache.get<TypeDefinition[]>(cacheKey);
  if (cached) return cached;

  try {
    const config = await getAgentConfigWithDefaults("report-generator");
    const cfg = (config.config ?? {}) as Record<string, unknown>;
    const customTypes = (cfg.customTypes as TypeDefinition[]) ?? [];

    const result = mergeTypes(BUILTIN_REPORT_TYPES, customTypes);
    memoryCache.set(cacheKey, result, 120);
    return result;
  } catch {
    return BUILTIN_REPORT_TYPES;
  }
}

/**
 * Get the prompt for a specific analysis type with placeholders filled.
 */
export async function getAnalysisPromptForType(
  analysisSlug: string,
  timeframeDays: number
): Promise<string> {
  const types = await getAnalysisTypes();
  const typeDef = types.find((t) => t.slug === analysisSlug);

  if (!typeDef) {
    return `Perform ${analysisSlug} analysis for the last ${timeframeDays} days.`;
  }

  const prompt = injectLabels(
    typeDef.promptTemplate
      .replace(/\{timeframeDays\}/g, String(timeframeDays))
  );

  return prompt + formatFewShotExamples(typeDef.fewShotExamples);
}

/**
 * Get the prompt for a specific report type with placeholders filled.
 */
export async function getReportPromptForType(
  reportSlug: string,
  periodStr: string,
  startStr: string,
  endStr: string
): Promise<string> {
  const types = await getReportTypes();
  const typeDef = types.find((t) => t.slug === reportSlug);

  if (!typeDef) {
    return `Generate a ${reportSlug} report for ${periodStr}.`;
  }

  const prompt = injectLabels(
    typeDef.promptTemplate
      .replace(/\{periodStr\}/g, periodStr)
      .replace(/\{startStr\}/g, startStr)
      .replace(/\{endStr\}/g, endStr)
  );

  return prompt + formatFewShotExamples(typeDef.fewShotExamples);
}

/**
 * Get valid slugs for Zod validation (used in input schemas).
 * Returns both built-in and custom type slugs.
 */
export async function getAnalysisSlugs(): Promise<string[]> {
  const types = await getAnalysisTypes();
  return types.map((t) => t.slug);
}

export async function getReportSlugs(): Promise<string[]> {
  const types = await getReportTypes();
  return types.map((t) => t.slug);
}

/**
 * Get built-in type slugs synchronously (for Zod enum fallback).
 * Use this only where async is not possible.
 */
export function getBuiltinAnalysisSlugs(): string[] {
  return BUILTIN_ANALYSIS_TYPES.map((t) => t.slug);
}

export function getBuiltinReportSlugs(): string[] {
  return BUILTIN_REPORT_TYPES.map((t) => t.slug);
}

// ── Helpers ────────────────────────────────────────────────

/** Merge custom types into built-in types. Custom overrides built-in by slug. */
function mergeTypes(builtins: TypeDefinition[], customs: TypeDefinition[]): TypeDefinition[] {
  const map = new Map<string, TypeDefinition>();

  for (const t of builtins) map.set(t.slug, t);
  for (const t of customs) map.set(t.slug, t); // custom overrides built-in

  return Array.from(map.values());
}

/**
 * Format few-shot examples into a prompt section.
 * Returns an empty string if no examples are available.
 */
function formatFewShotExamples(
  examples?: TypeDefinition["fewShotExamples"]
): string {
  if (!examples?.length) return "";
  const lines = examples.map(
    (ex) => `  User: "${ex.userInput}"\n  Expected: ${ex.expectedBehavior}`
  );
  return `\n\nExamples of expected behavior:\n${lines.join("\n\n")}`;
}
