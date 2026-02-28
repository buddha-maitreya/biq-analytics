/**
 * Insights Analyzer Agent -- Prompt templates and text helpers
 *
 * NOTE: These templates serve as synchronous fallbacks when the
 * async type-registry is unavailable. The type-registry versions
 * are preferred and include label injection.
 */

import { injectLabels } from "@lib/prompts";

// ────────────────────────────────────────────────────────────
// Analysis-specific prompt templates
// ────────────────────────────────────────────────────────────

export function getAnalysisPrompt(analysis: string, timeframeDays: number): string {
  const prompts: Record<string, string> = {
    "demand-forecast": injectLabels(`Perform DEMAND FORECASTING analysis:
- Fetch daily sales data and current stock levels for the last ${timeframeDays} days for all {{PRODUCT_LABEL_PLURAL}}
- Write Python to compute: moving averages (DF.rolling(7).mean(), DF.rolling(14).mean()), sales velocity, velocity acceleration/deceleration, days until stockout, demand variability (coefficient of variation via np.std/np.mean)
- Use ExponentialSmoothing from statsmodels for trend extrapolation if enough data points
- Identify {{PRODUCT_LABEL_PLURAL}} at risk of stockout and {{PRODUCT_LABEL_PLURAL}} with accelerating/decelerating demand
- Return structured data with per-{{PRODUCT_LABEL}} forecasts sorted by risk level`),

    "anomaly-detection": injectLabels(`Perform ANOMALY DETECTION analysis:
- Fetch daily {{ORDER_LABEL}} volumes, revenue, and per-{{PRODUCT_LABEL}} sales data for the last ${timeframeDays} days
- Write Python to compute: z-scores via scipy.stats.zscore() for daily volumes/revenue, IQR analysis for outliers (DF.quantile), volume spike detection
- Use IsolationForest from sklearn for multivariate anomaly detection if sufficient data
- Flag any data point with |z-score| > 2 as anomalous
- Return structured anomaly data with severity ratings, directions (spike/drop), and affected entities`),

    "restock-recommendations": injectLabels(`Perform RESTOCK RECOMMENDATIONS analysis:
- Fetch sales velocity data and current stock levels for the last ${timeframeDays} days
- Write Python to compute: daily velocity per {{PRODUCT_LABEL}} (DF.groupby + rolling mean), safety stock (1.5x lead time buffer assuming 7-day lead time), optimal reorder quantities, days of stock remaining, urgency classification
- Use numpy for statistical computations (np.std for demand variability, np.ceil for rounding)
- Prioritize by urgency: out-of-stock > critical (<=3 days) > high (<=7 days) > medium (<=14 days) > low
- Return structured recommendations sorted by urgency`),

    "sales-trends": injectLabels(`Perform SALES TRENDS analysis:
- Fetch weekly revenue, daily revenue, and per-{{PRODUCT_LABEL}} weekly breakdown for the last ${timeframeDays} days
- Write Python to compute: overall growth rate (first half vs second half using DF slicing), {{PRODUCT_LABEL}} momentum scoring (DF.pct_change() on recent vs earlier periods), day-of-week revenue patterns (DF.groupby(DF['date'].dt.dayofweek)), peak identification
- Use scipy.stats.linregress for trend line fitting and p-value significance
- Classify {{PRODUCT_LABEL_PLURAL}} as accelerating (>15% momentum), decelerating (<-15%), or steady
- Return structured trend data with overall metrics, top growers, top decliners, and day patterns`),
  };

  return prompts[analysis] || `Perform ${analysis} analysis for the last ${timeframeDays} days.`;
}

// ────────────────────────────────────────────────────────────
// Fallback parser -- safety net if structured output fails
// ────────────────────────────────────────────────────────────

export function parseInsightsFromText(
  text: string
): { insights: Array<Record<string, unknown>>; summary: string } {
  try {
    const jsonMatch = text.match(/\{[\s\S]*"insights"[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch {
    /* ignore */
  }

  return {
    insights: [
      {
        title: "Analysis Complete",
        severity: "info",
        description: text.slice(0, 500),
        recommendation: "Review the full analysis above for details.",
        confidence: 0.7,
      },
    ],
    summary: text.slice(0, 300),
  };
}
