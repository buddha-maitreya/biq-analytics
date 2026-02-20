/**
 * Report Generator Agent -- Prompt templates
 *
 * NOTE: These templates serve as synchronous fallbacks when the
 * async type-registry is unavailable. The type-registry versions
 * are preferred and include label injection.
 */

import { injectLabels } from "@lib/prompts";

// ────────────────────────────────────────────────────────────
// Report-specific prompt templates
// ────────────────────────────────────────────────────────────

export function getReportPrompt(
  reportType: string,
  periodStr: string,
  startStr: string,
  endStr: string
): string {
  const prompts: Record<string, string> = {
    "sales-summary": injectLabels(`Generate a SALES SUMMARY report for the period ${periodStr}:
- Fetch total revenue, {{ORDER_LABEL}} count, average {{ORDER_LABEL}} value using aggregate SQL
- Fetch top-selling {{PRODUCT_LABEL_PLURAL}} (by revenue and by units) using GROUP BY + ORDER BY
- Fetch top {{CUSTOMER_LABEL_PLURAL}} by spend
- Fetch daily revenue for trend description
- Use multiple fetch_data calls if needed for different data sections`),

    "inventory-health": injectLabels(`Generate an INVENTORY HEALTH report:
- Fetch current stock summary: total {{PRODUCT_LABEL_PLURAL}}, total units, low-stock count, out-of-stock count
- Fetch the low/out-of-stock {{PRODUCT_LABEL_PLURAL}} with their quantities and reorder points
- Fetch top {{PRODUCT_LABEL_PLURAL}} by inventory value (quantity * cost_price)
- Note: Inventory is point-in-time -- ignore date filters for stock queries`),

    "customer-activity": injectLabels(`Generate a {{CUSTOMER_LABEL}} ACTIVITY report for the period ${periodStr}:
- Fetch {{CUSTOMER_LABEL}} counts: total, active, new (created in period)
- Fetch top {{CUSTOMER_LABEL_PLURAL}} by spend with {{ORDER_LABEL}} counts and last {{ORDER_LABEL}} date
- Fetch {{ORDER_LABEL}} frequency distribution (how many {{CUSTOMER_LABEL_PLURAL}} have 1 {{ORDER_LABEL}}, 2 {{ORDER_LABEL_PLURAL}}, etc.)
- Use {{ORDER_LABEL_PLURAL}} within the date range for activity metrics`),

    "financial-overview": injectLabels(`Generate a FINANCIAL OVERVIEW report for the period ${periodStr}:
- Fetch {{ORDER_LABEL}} revenue totals for the period
- Fetch {{INVOICE_LABEL}} summary: total invoiced, total paid, outstanding balance, overdue count
- Fetch payment summary: total collected, payment count
- Fetch accounts receivable aging (current, 1-30, 31-60, 61-90, 90+ days overdue)`),
  };

  return prompts[reportType] || `Generate a ${reportType} report for ${periodStr}.`;
}
