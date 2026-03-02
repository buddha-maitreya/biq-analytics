# Analytics Features — Implementation Status & Client Onboarding Guide

> Last updated: 2026-03-02
> Location in app: **Analytics → Predictive Analytics tab**

---

## Architecture Overview

All analytics run in an isolated Python sandbox (Agentuity SDK) using a pre-built snapshot
with pandas, numpy, scikit-learn, matplotlib, statsmodels, prophet, and lifetimes pre-installed.

```
User selects module + date range + forecast horizon
  → POST /api/predictive-analytics/run
    → SQL query fetches data from DB (TypeScript)
      → runAnalytics() uploads Python files + data to sandbox
        → Python module executes, returns { summary, table, charts }
          → UI renders summary cards, data table, chart images
```

The Python modules are embedded as strings in `src/lib/analytics-scripts.ts`.
SQL queries are in `src/lib/analytics-queries.ts`.
The analytics engine is in `src/lib/analytics.ts`.

---

## Features — Implementation Status

### 🏆 Business Insights

#### `insights.value_gap` — AI vs Standard POS: Value Gap
**Status:** ✅ Implemented (2026-03-02)
**Card description:** "See your business's real performance — dead stock rate, waste risk, revenue momentum,
and M-Pesa reconciliation accuracy — compared against what a standard POS delivers."

**What it computes:**
| KPI | Benchmark | Source |
|-----|-----------|--------|
| Dead stock rate | ~28% avg (Kenyan SME) | Products with no sales in 30d / total in-stock SKUs |
| Waste / slow-mover risk | ~15% of inventory value | At-risk inventory value / total inventory value |
| Revenue momentum | ~2% monthly (flat baseline) | Period-over-period revenue growth from `sales` table |
| M-Pesa reconciliation | ~94% accuracy (manual) | `pos_transactions` where `pos_vendor = 'mpesa'`, status breakdown |

**Data requirements:** Active products with stock > 0. Sales data for trend. M-Pesa shows "No data" gracefully if not integrated.

**Output:** 4-row comparison table. No charts (table-only by design).

---

### 📈 Demand Forecasting

All three forecast models share the same two controls:
- **Historical Data Period** — how far back to train the model (30 / 60 / 90 / 180 / 365 days)
- **Forecast Horizon** — how far ahead to predict (1 week / 2 weeks / 1 month / 2 months / 3 months)

The horizon picker is shown **only** for `forecast.prophet`, `forecast.arima`, and `forecast.holt_winters`.
It is hidden for `forecast.safety_stock` (which is not time-horizon based).

#### `forecast.prophet` — Sales Demand Forecast
**Status:** ✅ Implemented
**Best for:** Most businesses. Handles irregular data, missing days, and Kenyan holidays automatically.
**Min data required:** 30 data points (days with sales)
**Output:** Forecast table (date, predicted, lower bound, upper bound) + chart (when sandbox charts re-enabled)
**Key param:** `horizonDays` (default 30, range 7–90 from UI)

#### `forecast.arima` — Statistical Demand Forecast
**Status:** ✅ Implemented
**Best for:** Businesses with consistent weekly/monthly patterns.
**Min data required:** 14 data points
**Output:** Forecast table + summary (model order, AIC score, total forecast, avg daily forecast) + chart
**Key param:** `horizonDays` (default 30)

#### `forecast.holt_winters` — Trend & Seasonality Forecast
**Status:** ✅ Implemented
**Best for:** Growing businesses with clear seasonal cycles.
**Min data required:** 14 data points (needs at least 2 full seasonal cycles)
**Output:** Forecast table + summary (trend type, seasonal periods, growth direction) + chart
**Key param:** `horizonDays` (default 30)

#### `forecast.safety_stock` — Safety Stock & Reorder Planner
**Status:** ✅ Implemented
**No horizon control** — outputs per-product recommendations, not time-series
**Output:** Table with columns: product, avg daily demand, demand std dev, safety stock qty, reorder point, EOQ (economic order quantity), estimated days of cover
**Key params:** `serviceLevel` (default 0.95), `leadTimeDays` (default 7)

---

### 🏷️ Classification

#### `classify.abc_xyz` — Product Portfolio Ranking
**Status:** ✅ Implemented
**Output:** Every product classified into one of 9 cells (AX, AY, AZ, BX, BY, BZ, CX, CY, CZ)
- A/B/C = revenue contribution (top 80% / next 15% / bottom 5%)
- X/Y/Z = demand variability (CoV < 0.5 / 0.5–1.0 / > 1.0)

#### `classify.rfm` — Customer Loyalty Segmentation
**Status:** ✅ Implemented
**Min data required:** 5 customers with purchase history
**Output:** Customer table with RFM scores + segment label (Champions, Loyal, Potential Loyalists, At Risk, Hibernating, Lost)
**Note:** Only works if sales are linked to customer records (walk-in sales have no customer_id)

#### `classify.clv` — Customer Lifetime Value
**Status:** ✅ Implemented
**Model:** BG/NBD + Gamma-Gamma (probabilistic)
**Min data required:** Customers with ≥ 2 transactions
**Output:** Per-customer predicted 12-month revenue, ranked

#### `classify.bundles` — Product Bundle Finder
**Status:** ✅ Implemented
**Model:** Apriori / FP-Growth association rules
**Min data required:** Orders with multiple line items (requires `order_items` table, not just `sales`)
**Output:** Association rules table (antecedent → consequent, support, confidence, lift)

---

### 🔍 Anomaly Detection

#### `anomaly.transactions` — Suspicious Transaction Scan
**Status:** ✅ Implemented
**Model:** Isolation Forest + Local Outlier Factor
**Min data required:** 10 transactions
**Output:** Flagged transactions with anomaly score and reason

#### `anomaly.shrinkage` — Inventory Loss Detection
**Status:** ✅ Implemented
**Method:** Expected stock (received − sold + adjustments) vs actual inventory, flagged at > 2.5σ
**Output:** Per-product shrinkage table with discrepancy, % variance, estimated value lost, and flag

---

## Known Limitations / Client Onboarding Notes

### Charts are table-only for now
`isPythonChartsAvailable()` returns `false` in `src/lib/python-charts.ts`. This disables
matplotlib chart rendering in the **report export pipeline** (PDF/DOCX/PPTX).

The analytics API (`/api/predictive-analytics/run`) is unaffected — it returns whatever Python
produces including charts. Re-enable when sandbox cold-start latency is acceptable:
```ts
// src/lib/python-charts.ts line 182
export function isPythonChartsAvailable(): boolean {
  return true; // change false → true
}
```

### Forecast models need enough historical data
- Prophet: minimum 30 days of sales data
- ARIMA / Holt-Winters: minimum 14 days
- If a new client has less than this, the sandbox returns a clear error message

### Bundle analysis requires order-based data
`classify.bundles` queries the `order_items` table (multi-item orders), not the `sales` table.
Clients who only use the quick POS (single-item `sales` entries) will get sparse bundle results.

### RFM / CLV require named customers
Walk-in sales (no customer_id) are excluded. Clients who capture customer data at POS get full
segmentation; those who don't will see limited customer analytics.

### M-Pesa in Value Gap shows "No data" if not integrated
If a client has not configured the M-Pesa POS vendor webhook, `pos_transactions` will be empty.
The Value Gap module handles this gracefully — M-Pesa row shows "No M-Pesa transactions in period".

---

## Adding a New Analytics Module

1. **Python module** — Add `MYMODULE_PY` constant to `src/lib/analytics-scripts.ts`
2. **File manifest** — Add `{ path: "mygroup/mymodule.py", content: MYMODULE_PY }` to `getAnalyticsFiles()`
3. **Dispatch** — Add `elif action == 'mygroup.myaction': from mygroup.mymodule import run` to `MAIN_PY`
4. **Action type** — Add `| "mygroup.myaction"` to `AnalyticsAction` in `src/lib/analytics.ts`
5. **Category mapping** — Add entry to `ACTION_TO_CATEGORY` in `src/lib/analytics.ts`
6. **SQL query** — Add `fetchMyData()` to `src/lib/analytics-queries.ts`
7. **Query map** — Add `"mygroup.myaction": fetchMyData` to `ACTION_QUERY_MAP`
8. **UI card** — Add entry to `PREDICTIVE_ANALYTICS_TYPES` with business-language description

---

## UI Location

**Analytics page → Predictive Analytics tab → category group → click card → configure → Run Analysis**

Category display order: Business Insights → Forecasting → Classification → Anomaly Detection → Visualizations

Each card shows: icon + label + full description. Clicking selects it and reveals the run panel with
"Historical Data Period" pills (all modules) and "Forecast Horizon" pills (forecast.prophet / arima / holt_winters only).
