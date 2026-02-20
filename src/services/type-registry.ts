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
- Write JavaScript to compute: moving averages (7-day, 14-day), sales velocity, velocity acceleration/deceleration, days until stockout, demand variability (coefficient of variation)
- Identify {{PRODUCT_LABEL_PLURAL}} at risk of stockout and {{PRODUCT_LABEL_PLURAL}} with accelerating/decelerating demand
- Return structured data with per-{{PRODUCT_LABEL}} forecasts sorted by risk level`,
    fewShotExamples: [
      {
        userInput: "Which products will run out first?",
        expectedBehavior: "Fetch sales velocity and current stock, compute days-until-stockout for each product, sort by urgency and flag critical items.",
      },
      {
        userInput: "Predict demand for next 2 weeks",
        expectedBehavior: "Calculate 7-day and 14-day moving averages, extrapolate forward, identify acceleration/deceleration trends per product.",
      },
    ],
  },
  {
    slug: "anomaly-detection",
    label: "Anomaly Detection",
    description: "Identify unusual patterns in orders, revenue, and pricing",
    promptTemplate: `Perform ANOMALY DETECTION analysis:
- Fetch daily {{ORDER_LABEL}} volumes, revenue, and per-{{PRODUCT_LABEL}} sales data for the last {timeframeDays} days
- Write JavaScript to compute: z-scores for daily volumes/revenue, IQR analysis for pricing outliers, volume spike detection
- Flag any data point with |z-score| > 2 as anomalous
- Return structured anomaly data with severity ratings, directions (spike/drop), and affected entities`,
    fewShotExamples: [
      {
        userInput: "Anything unusual in last month's sales?",
        expectedBehavior: "Compute z-scores on daily revenue and order counts. Flag days with |z| > 2 as anomalies. Check for pricing outliers via IQR.",
      },
    ],
  },
  {
    slug: "restock-recommendations",
    label: "Restock Recommendations",
    description: "Calculate optimal reorder quantities and urgency",
    promptTemplate: `Perform RESTOCK RECOMMENDATIONS analysis:
- Fetch sales velocity data and current stock levels for the last {timeframeDays} days
- Write JavaScript to compute: daily velocity per {{PRODUCT_LABEL}}, safety stock (1.5x lead time buffer assuming 7-day lead time), optimal reorder quantities, days of stock remaining, urgency classification
- Prioritize by urgency: out-of-stock > critical (<=3 days) > high (<=7 days) > medium (<=14 days) > low
- Return structured recommendations sorted by urgency`,
    fewShotExamples: [
      {
        userInput: "What do I need to reorder?",
        expectedBehavior: "Calculate safety stock levels using 1.5x lead time buffer, compare with current stock, classify urgency, and produce a sorted reorder list.",
      },
    ],
  },
  {
    slug: "sales-trends",
    label: "Sales Trends",
    description: "Analyze revenue trends, product momentum, and day-of-week patterns",
    promptTemplate: `Perform SALES TRENDS analysis:
- Fetch weekly revenue, daily revenue, and per-{{PRODUCT_LABEL}} weekly breakdown for the last {timeframeDays} days
- Write JavaScript to compute: overall growth rate (first half vs second half), {{PRODUCT_LABEL}} momentum scoring (recent vs earlier periods), day-of-week revenue patterns, peak identification
- Classify {{PRODUCT_LABEL_PLURAL}} as accelerating (>15% momentum), decelerating (<-15%), or steady
- Return structured trend data with overall metrics, top growers, top decliners, and day patterns`,
    fewShotExamples: [
      {
        userInput: "How are sales trending?",
        expectedBehavior: "Compute week-over-week growth, identify top accelerating and decelerating products, find peak revenue days.",
      },
      {
        userInput: "Which day of the week sells the most?",
        expectedBehavior: "Aggregate revenue by day-of-week, identify peak and trough days, compute variance.",
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
    promptTemplate: `Generate a SALES SUMMARY report for the period {periodStr}:
- Fetch total revenue, {{ORDER_LABEL}} count, average {{ORDER_LABEL}} value using aggregate SQL
- Fetch top-selling {{PRODUCT_LABEL_PLURAL}} (by revenue and by units) using GROUP BY + ORDER BY
- Fetch top {{CUSTOMER_LABEL_PLURAL}} by spend
- Fetch daily revenue for trend description
- Use multiple fetch_data calls if needed for different data sections`,
    fewShotExamples: [
      {
        userInput: "Monthly sales report",
        expectedBehavior: "Fetch revenue totals, top products by revenue, top customers by spend. Write a report with exec summary, key metrics, rankings, and recommendations.",
      },
    ],
  },
  {
    slug: "inventory-health",
    label: "Inventory Health",
    description: "Stock levels, low stock alerts, inventory valuation",
    promptTemplate: `Generate an INVENTORY HEALTH report:
- Fetch current stock summary: total {{PRODUCT_LABEL_PLURAL}}, total units, low-stock count, out-of-stock count
- Fetch the low/out-of-stock {{PRODUCT_LABEL_PLURAL}} with their quantities and reorder points
- Fetch top {{PRODUCT_LABEL_PLURAL}} by inventory value (quantity * cost_price)
- Note: Inventory is point-in-time -- ignore date filters for stock queries`,
    fewShotExamples: [
      {
        userInput: "Stock health check",
        expectedBehavior: "Query stock levels, identify low-stock and out-of-stock items, calculate inventory valuation. Write a report with stock summary, risk items, and restocking recommendations.",
      },
    ],
  },
  {
    slug: "customer-activity",
    label: "Customer Activity",
    description: "Customer counts, top spenders, order frequency",
    promptTemplate: `Generate a {{CUSTOMER_LABEL}} ACTIVITY report for the period {periodStr}:
- Fetch {{CUSTOMER_LABEL}} counts: total, active, new (created in period)
- Fetch top {{CUSTOMER_LABEL_PLURAL}} by spend with {{ORDER_LABEL}} counts and last {{ORDER_LABEL}} date
- Fetch {{ORDER_LABEL}} frequency distribution (how many {{CUSTOMER_LABEL_PLURAL}} have 1 {{ORDER_LABEL}}, 2 {{ORDER_LABEL_PLURAL}}, etc.)
- Use {{ORDER_LABEL_PLURAL}} within the date range for activity metrics`,
  },
  {
    slug: "financial-overview",
    label: "Financial Overview",
    description: "Revenue, invoicing, payments, and accounts receivable",
    promptTemplate: `Generate a FINANCIAL OVERVIEW report for the period {periodStr}:
- Fetch {{ORDER_LABEL}} revenue totals for the period
- Fetch {{INVOICE_LABEL}} summary: total invoiced, total paid, outstanding balance, overdue count
- Fetch payment summary: total collected, payment count
- Fetch accounts receivable aging (current, 1-30, 31-60, 61-90, 90+ days overdue)`,
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
