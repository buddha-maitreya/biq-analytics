/**
 * Analytics Code Template Library — Pre-built Python templates for LLM use.
 *
 * Instead of having the LLM generate Python code from scratch (which leads to
 * hallucination, wrong imports, bad patterns), we provide pre-built templates
 * that the LLM fills in with parameters. Templates are stored in KV storage
 * keyed by analysis action type.
 *
 * Architecture:
 *   1. Templates are seeded from BUILTIN_TEMPLATES on first access
 *   2. Stored in KV namespace `analytics:templates` with no TTL (persistent)
 *   3. LLM receives template + parameter schema → fills in values
 *   4. Template code is executed via executeSandbox() (data-science agent path)
 *
 * NOTE: This is for the DATA-SCIENCE AGENT's ad-hoc sandbox execution (LLM-generated code).
 *       The analytics engine (src/lib/analytics.ts) uses fixed Python modules embedded
 *       in analytics-scripts.ts — it does NOT use templates.
 *
 * @module analytics-templates
 */

import type { KVStore } from "@lib/cache";

// ── Types ──────────────────────────────────────────────────

export interface AnalyticsTemplate {
  /** Unique action key (e.g., "trend_analysis", "moving_average") */
  action: string;
  /** Human-readable name for admin / LLM context */
  name: string;
  /** What this template does — included in LLM prompt */
  description: string;
  /** Python code template with {{PLACEHOLDER}} tokens */
  code: string;
  /** Parameter schema — tells the LLM what to fill in */
  parameters: TemplateParameter[];
  /** Runtime for sandbox execution */
  runtime: "python:3.13" | "python:3.14" | "bun:1";
  /** SQL query template (optional — if analysis needs DB data) */
  sqlTemplate?: string;
  /** Tags for grouping/filtering */
  tags: string[];
}

export interface TemplateParameter {
  /** Parameter name (matches {{NAME}} in code template) */
  name: string;
  /** Data type expected */
  type: "string" | "number" | "boolean" | "string[]" | "number[]";
  /** Description for the LLM */
  description: string;
  /** Default value (if any) */
  defaultValue?: string | number | boolean;
  /** Whether this parameter is required */
  required: boolean;
}

// ── KV Namespace ───────────────────────────────────────────

const KV_NAMESPACE = "analytics:templates";
const INDEX_KEY = "__index__";

// ── Template CRUD ──────────────────────────────────────────

/**
 * Get a single template by action key.
 */
export async function getTemplate(
  kv: KVStore,
  action: string
): Promise<AnalyticsTemplate | undefined> {
  const result = await kv.get<AnalyticsTemplate>(KV_NAMESPACE, action);
  return result.exists ? result.data : undefined;
}

/**
 * List all available templates.
 */
export async function listTemplates(
  kv: KVStore
): Promise<AnalyticsTemplate[]> {
  const indexResult = await kv.get<string[]>(KV_NAMESPACE, INDEX_KEY);
  if (!indexResult.exists || !indexResult.data?.length) return [];

  const templates: AnalyticsTemplate[] = [];
  for (const action of indexResult.data) {
    const t = await getTemplate(kv, action);
    if (t) templates.push(t);
  }
  return templates;
}

/**
 * Save a template (create or update).
 */
export async function saveTemplate(
  kv: KVStore,
  template: AnalyticsTemplate
): Promise<void> {
  await kv.set(KV_NAMESPACE, template.action, template, { ttl: null });

  // Update index
  const indexResult = await kv.get<string[]>(KV_NAMESPACE, INDEX_KEY);
  const index = indexResult.exists && indexResult.data ? indexResult.data : [];
  if (!index.includes(template.action)) {
    index.push(template.action);
    await kv.set(KV_NAMESPACE, INDEX_KEY, index, { ttl: null });
  }
}

/**
 * Delete a template.
 */
export async function deleteTemplate(
  kv: KVStore,
  action: string
): Promise<void> {
  await kv.delete(KV_NAMESPACE, action);

  const indexResult = await kv.get<string[]>(KV_NAMESPACE, INDEX_KEY);
  if (indexResult.exists && indexResult.data) {
    const updated = indexResult.data.filter((a) => a !== action);
    await kv.set(KV_NAMESPACE, INDEX_KEY, updated, { ttl: null });
  }
}

/**
 * Seed all built-in templates into KV. Idempotent — skips existing.
 */
export async function seedTemplates(kv: KVStore): Promise<number> {
  let seeded = 0;
  for (const template of BUILTIN_TEMPLATES) {
    const existing = await getTemplate(kv, template.action);
    if (!existing) {
      await saveTemplate(kv, template);
      seeded++;
    }
  }
  return seeded;
}

/**
 * Fill a template's placeholders with parameter values.
 * Returns ready-to-execute Python code.
 */
export function fillTemplate(
  template: AnalyticsTemplate,
  params: Record<string, string | number | boolean>
): string {
  let code = template.code;
  for (const [name, value] of Object.entries(params)) {
    const placeholder = `{{${name.toUpperCase()}}}`;
    const strValue = typeof value === "string" ? `"${value}"` : String(value);
    code = code.replaceAll(placeholder, strValue);
  }
  return code;
}

/**
 * Build a concise template catalog for inclusion in the LLM system prompt.
 * Lists available templates with their parameters so the LLM can
 * choose and fill a template instead of writing code from scratch.
 */
export function buildTemplateCatalog(templates: AnalyticsTemplate[]): string {
  if (!templates.length) return "";

  const lines = [
    "AVAILABLE CODE TEMPLATES (use these instead of writing code from scratch):",
    "When a template fits the user's request, use it by filling in the parameters.",
    "Templates are pre-tested and produce reliable, well-formatted results.",
    "",
  ];

  for (const t of templates) {
    lines.push(`## ${t.name} (action: ${t.action})`);
    lines.push(`   ${t.description}`);
    if (t.sqlTemplate) {
      lines.push(`   SQL: ${t.sqlTemplate}`);
    }
    lines.push("   Parameters:");
    for (const p of t.parameters) {
      const req = p.required ? "required" : `optional, default=${p.defaultValue}`;
      lines.push(`     - ${p.name} (${p.type}, ${req}): ${p.description}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ── Built-In Templates ─────────────────────────────────────

const BUILTIN_TEMPLATES: AnalyticsTemplate[] = [
  {
    action: "trend_analysis",
    name: "Sales/Revenue Trend Analysis",
    description:
      "Compute daily/weekly/monthly aggregates with moving average, growth rate, and trend direction. Works with any time-series data from SQL.",
    runtime: "python:3.13",
    tags: ["analytics", "time-series", "trend"],
    sqlTemplate:
      "SELECT DATE(created_at) as date, SUM(total_amount) as revenue, COUNT(*) as transactions FROM sales WHERE created_at >= NOW() - INTERVAL '{{DAYS}} days' GROUP BY DATE(created_at) ORDER BY date",
    parameters: [
      {
        name: "DAYS",
        type: "number",
        description: "Number of days to look back",
        defaultValue: 90,
        required: false,
      },
      {
        name: "MA_WINDOW",
        type: "number",
        description: "Moving average window (in periods)",
        defaultValue: 7,
        required: false,
      },
      {
        name: "VALUE_COLUMN",
        type: "string",
        description: "Column name containing the numeric values to analyze",
        defaultValue: "revenue",
        required: false,
      },
      {
        name: "DATE_COLUMN",
        type: "string",
        description: "Column name containing dates",
        defaultValue: "date",
        required: false,
      },
    ],
    code: `import pandas as pd
import numpy as np

df = pd.DataFrame(DATA)
date_col = {{DATE_COLUMN}}
value_col = {{VALUE_COLUMN}}

df[date_col] = pd.to_datetime(df[date_col])
df = df.sort_values(date_col)
df[value_col] = pd.to_numeric(df[value_col], errors='coerce').fillna(0)

# Moving average
ma_window = {{MA_WINDOW}}
df['ma'] = df[value_col].rolling(window=ma_window, min_periods=1).mean()

# Growth metrics
total = float(df[value_col].sum())
avg = float(df[value_col].mean())
first_half = df.head(len(df) // 2)[value_col].mean()
second_half = df.tail(len(df) // 2)[value_col].mean()
growth_pct = ((second_half / first_half) - 1) * 100 if first_half > 0 else 0
trend = 'up' if growth_pct > 2 else 'down' if growth_pct < -2 else 'flat'

# Peak and trough
peak_idx = df[value_col].idxmax()
trough_idx = df[value_col].idxmin()

return {
    "total": total,
    "average": round(avg, 2),
    "days": len(df),
    "trend": trend,
    "growthPct": round(float(growth_pct), 1),
    "peakDate": str(df.loc[peak_idx, date_col].date()),
    "peakValue": float(df.loc[peak_idx, value_col]),
    "troughDate": str(df.loc[trough_idx, date_col].date()),
    "troughValue": float(df.loc[trough_idx, value_col]),
    "movingAverageWindow": ma_window,
    "latestMA": round(float(df['ma'].iloc[-1]), 2),
}`,
  },
  {
    action: "top_bottom_ranking",
    name: "Top/Bottom N Ranking",
    description:
      "Rank items by a metric and return top N and bottom N. Works for products by revenue, customers by spend, categories by volume, etc.",
    runtime: "python:3.13",
    tags: ["analytics", "ranking"],
    sqlTemplate:
      "SELECT p.name, SUM(s.total_amount) as total_revenue, COUNT(*) as transaction_count FROM sales s JOIN products p ON s.product_id = p.id WHERE s.created_at >= NOW() - INTERVAL '{{DAYS}} days' GROUP BY p.name ORDER BY total_revenue DESC",
    parameters: [
      {
        name: "DAYS",
        type: "number",
        description: "Lookback period in days",
        defaultValue: 90,
        required: false,
      },
      {
        name: "TOP_N",
        type: "number",
        description: "Number of top items to return",
        defaultValue: 10,
        required: false,
      },
      {
        name: "NAME_COLUMN",
        type: "string",
        description: "Column containing item names",
        defaultValue: "name",
        required: false,
      },
      {
        name: "VALUE_COLUMN",
        type: "string",
        description: "Column containing the ranking metric",
        defaultValue: "total_revenue",
        required: false,
      },
    ],
    code: `import pandas as pd

df = pd.DataFrame(DATA)
name_col = {{NAME_COLUMN}}
value_col = {{VALUE_COLUMN}}
top_n = {{TOP_N}}

df[value_col] = pd.to_numeric(df[value_col], errors='coerce').fillna(0)
df = df.sort_values(value_col, ascending=False).reset_index(drop=True)

total = float(df[value_col].sum())
top = df.head(top_n)
bottom = df.tail(top_n) if len(df) > top_n else df.tail(max(1, len(df) // 4))

top_list = [{"name": str(r[name_col]), "value": float(r[value_col]),
             "pct": round(float(r[value_col]) / total * 100, 1) if total > 0 else 0}
            for _, r in top.iterrows()]

bottom_list = [{"name": str(r[name_col]), "value": float(r[value_col]),
                "pct": round(float(r[value_col]) / total * 100, 1) if total > 0 else 0}
               for _, r in bottom.iterrows()]

return {
    "totalItems": len(df),
    "totalValue": total,
    "top": top_list,
    "bottom": bottom_list,
    "topConcentration": round(sum(i["pct"] for i in top_list), 1),
}`,
  },
  {
    action: "period_comparison",
    name: "Period-over-Period Comparison",
    description:
      "Compare metrics between two time periods (e.g., this month vs last month, this quarter vs last quarter).",
    runtime: "python:3.13",
    tags: ["analytics", "comparison", "time-series"],
    sqlTemplate:
      "SELECT DATE(created_at) as date, SUM(total_amount) as revenue, COUNT(*) as orders FROM sales WHERE created_at >= NOW() - INTERVAL '{{DAYS}} days' GROUP BY DATE(created_at) ORDER BY date",
    parameters: [
      {
        name: "DAYS",
        type: "number",
        description: "Total lookback days (split into two equal halves for comparison)",
        defaultValue: 60,
        required: false,
      },
      {
        name: "VALUE_COLUMN",
        type: "string",
        description: "Column to compare",
        defaultValue: "revenue",
        required: false,
      },
    ],
    code: `import pandas as pd
import numpy as np

df = pd.DataFrame(DATA)
value_col = {{VALUE_COLUMN}}

df['date'] = pd.to_datetime(df['date'])
df[value_col] = pd.to_numeric(df[value_col], errors='coerce').fillna(0)
df = df.sort_values('date')

midpoint = len(df) // 2
period1 = df.iloc[:midpoint]
period2 = df.iloc[midpoint:]

p1_total = float(period1[value_col].sum())
p2_total = float(period2[value_col].sum())
p1_avg = float(period1[value_col].mean())
p2_avg = float(period2[value_col].mean())

change_pct = ((p2_total / p1_total) - 1) * 100 if p1_total > 0 else 0

return {
    "period1": {
        "start": str(period1['date'].iloc[0].date()),
        "end": str(period1['date'].iloc[-1].date()),
        "total": p1_total,
        "average": round(p1_avg, 2),
        "days": len(period1),
    },
    "period2": {
        "start": str(period2['date'].iloc[0].date()),
        "end": str(period2['date'].iloc[-1].date()),
        "total": p2_total,
        "average": round(p2_avg, 2),
        "days": len(period2),
    },
    "change": {
        "absolute": round(p2_total - p1_total, 2),
        "percentage": round(float(change_pct), 1),
        "direction": "up" if change_pct > 2 else "down" if change_pct < -2 else "flat",
    },
}`,
  },
  {
    action: "distribution_analysis",
    name: "Distribution & Statistical Summary",
    description:
      "Compute statistical distribution of a numeric column: mean, median, std dev, quartiles, skewness, and value buckets.",
    runtime: "python:3.13",
    tags: ["analytics", "statistics", "distribution"],
    parameters: [
      {
        name: "VALUE_COLUMN",
        type: "string",
        description: "Column to analyze distribution of",
        defaultValue: "total_amount",
        required: true,
      },
      {
        name: "BUCKETS",
        type: "number",
        description: "Number of histogram buckets",
        defaultValue: 10,
        required: false,
      },
    ],
    code: `import pandas as pd
import numpy as np
from scipy import stats as sp_stats

df = pd.DataFrame(DATA)
col = {{VALUE_COLUMN}}
df[col] = pd.to_numeric(df[col], errors='coerce').dropna()
values = df[col]

n_buckets = {{BUCKETS}}
counts, edges = np.histogram(values, bins=n_buckets)
buckets = [{"min": round(float(edges[i]), 2), "max": round(float(edges[i+1]), 2),
            "count": int(counts[i])}
           for i in range(len(counts))]

q1, median, q3 = float(np.percentile(values, 25)), float(np.median(values)), float(np.percentile(values, 75))

return {
    "count": len(values),
    "mean": round(float(values.mean()), 2),
    "median": round(median, 2),
    "stdDev": round(float(values.std()), 2),
    "min": float(values.min()),
    "max": float(values.max()),
    "q1": round(q1, 2),
    "q3": round(q3, 2),
    "iqr": round(q3 - q1, 2),
    "skewness": round(float(sp_stats.skew(values)), 3),
    "kurtosis": round(float(sp_stats.kurtosis(values)), 3),
    "distribution": buckets,
    "outlierThreshold": {"low": round(q1 - 1.5 * (q3 - q1), 2), "high": round(q3 + 1.5 * (q3 - q1), 2)},
    "outlierCount": int(((values < q1 - 1.5 * (q3 - q1)) | (values > q3 + 1.5 * (q3 - q1))).sum()),
}`,
  },
  {
    action: "cohort_analysis",
    name: "Customer Cohort Retention",
    description:
      "Group customers by their first purchase month (cohort), then track retention in subsequent months.",
    runtime: "python:3.13",
    tags: ["analytics", "customer", "retention", "cohort"],
    sqlTemplate:
      "SELECT customer_id, DATE(created_at) as order_date, total_amount FROM sales WHERE customer_id IS NOT NULL AND created_at >= NOW() - INTERVAL '{{MONTHS}} months' ORDER BY order_date",
    parameters: [
      {
        name: "MONTHS",
        type: "number",
        description: "Lookback period in months",
        defaultValue: 12,
        required: false,
      },
    ],
    code: `import pandas as pd
import numpy as np

df = pd.DataFrame(DATA)
df['order_date'] = pd.to_datetime(df['order_date'])
df['order_month'] = df['order_date'].dt.to_period('M')

# First purchase month per customer = cohort
first_purchase = df.groupby('customer_id')['order_month'].min().reset_index()
first_purchase.columns = ['customer_id', 'cohort']
df = df.merge(first_purchase, on='customer_id')

# Months since cohort
df['period'] = (df['order_month'] - df['cohort']).apply(lambda x: x.n if hasattr(x, 'n') else 0)

# Cohort counts
cohort_data = df.groupby(['cohort', 'period'])['customer_id'].nunique().reset_index()
cohort_sizes = df.groupby('cohort')['customer_id'].nunique().reset_index()
cohort_sizes.columns = ['cohort', 'size']

retention = cohort_data.pivot(index='cohort', columns='period', values='customer_id').fillna(0)

# Convert to rates
retention_rate = retention.div(retention[0], axis=0) * 100

cohorts = []
for cohort in retention_rate.index:
    size = int(cohort_sizes[cohort_sizes['cohort'] == cohort]['size'].iloc[0])
    rates = {f"month_{int(c)}": round(float(v), 1)
             for c, v in retention_rate.loc[cohort].items() if not pd.isna(v)}
    cohorts.append({"cohort": str(cohort), "size": size, "retention": rates})

avg_m1 = float(retention_rate[1].mean()) if 1 in retention_rate.columns else 0
avg_m3 = float(retention_rate[3].mean()) if 3 in retention_rate.columns else 0

return {
    "cohortCount": len(cohorts),
    "totalCustomers": int(df['customer_id'].nunique()),
    "avgRetentionMonth1": round(avg_m1, 1),
    "avgRetentionMonth3": round(avg_m3, 1),
    "cohorts": cohorts[:12],
}`,
  },
  {
    action: "correlation_matrix",
    name: "Correlation Analysis",
    description:
      "Compute Pearson correlation coefficients between numeric columns. Identifies which metrics move together.",
    runtime: "python:3.13",
    tags: ["analytics", "statistics", "correlation"],
    parameters: [
      {
        name: "COLUMNS",
        type: "string",
        description:
          "Comma-separated list of numeric column names to correlate (e.g., 'price,quantity,revenue')",
        required: true,
      },
    ],
    code: `import pandas as pd
import numpy as np

df = pd.DataFrame(DATA)
cols = [c.strip() for c in {{COLUMNS}}.split(',')]

# Filter to existing numeric columns
available = [c for c in cols if c in df.columns]
if len(available) < 2:
    return {"error": f"Need at least 2 numeric columns. Found: {available}"}

for c in available:
    df[c] = pd.to_numeric(df[c], errors='coerce')

corr = df[available].corr()

# Find strongest correlations (excluding self-correlation)
pairs = []
for i in range(len(available)):
    for j in range(i + 1, len(available)):
        r = float(corr.iloc[i, j])
        pairs.append({
            "col1": available[i], "col2": available[j],
            "correlation": round(r, 3),
            "strength": "strong" if abs(r) > 0.7 else "moderate" if abs(r) > 0.4 else "weak",
            "direction": "positive" if r > 0 else "negative",
        })

pairs.sort(key=lambda p: abs(p["correlation"]), reverse=True)

matrix = {c: {c2: round(float(corr.loc[c, c2]), 3) for c2 in available} for c in available}

return {
    "columns": available,
    "matrix": matrix,
    "topCorrelations": pairs[:10],
    "dataPoints": len(df),
}`,
  },
];
