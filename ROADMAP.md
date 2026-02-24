# Business IQ Enterprise — Implementation Roadmap

## Inventory & Sales Management Platform

**Runtime:** Bun | **Language:** TypeScript | **Frontend:** React 19 | **Backend:** Agentuity Agents + Hono Routes  
**Database:** Neon Postgres (via `@agentuity/drizzle`) | **AI:** Vercel AI SDK + AI Gateway  
**Platform:** [Agentuity](https://agentuity.dev) — agent-native cloud  
**Architecture:** Single-Tenant (one codebase, dedicated deployment per client)  
**Design:** Industry-Agnostic (same code for retail, wholesale, manufacturing, F&B, healthcare, etc.)  
**Developed by:** Ruskins AI Consulting LTD © 2026

---

## Architecture — Single-Tenant, Industry-Agnostic

### Single-Tenant Isolation
Every client gets a fully isolated deployment:

| Concern | Isolation |
|---------|----------|
| **Compute** | Dedicated Agentuity project per client |
| **Database** | Dedicated Neon Postgres instance per client (provisioned via `agentuity cloud db create`) |
| **KV / Vector** | Scoped to client's Agentuity project |
| **Config** | Per-deployment env vars (branding, currency, tax, API keys) |
| **Codebase** | Identical across all clients — single source of truth |

### What This Means for Development
- **No `tenant_id` columns** — the entire database belongs to one client.
- **No row-level security or tenant filters** — unnecessary in single-tenant.
- **All client differences are driven by environment variables**, not code branches.
- **Schema migrations run per-deployment** (`bunx drizzle-kit migrate` on each client's DB).
- **Agents, routes, and frontend are identical** — deploy the same build everywhere.

### Industry-Agnostic Design
- **Generic domain models** — tables use `products`, `categories`, `customers`, `orders` with no industry-specific naming.
- **Configurable terminology** — `PRODUCT_LABEL`, `ORDER_LABEL`, `CUSTOMER_LABEL` env vars drive UI labels. Code never references "SKU", "ticket", "patient", etc.
- **Flexible units** — Products store `unit` as a free-form string (pieces, kg, liters, meters). No hardcoded unit enums.
- **Extensible metadata** — `metadata` JSONB columns on products, orders, customers allow industry-specific attributes without schema changes.
- **Configurable workflows** — Order statuses and fulfillment steps are data-driven, not hardcoded enums.
- **Pluggable tax & pricing** — `TAX_RATE` env var + configurable tax rules, not industry-specific calc logic.

---

## Completed Work

### ✅ Phase 0 — Project Bootstrap
- Agentuity project created and deployed
- Neon Postgres provisioned with full schema
- `.env` configured with client-specific variables
- WSL Ubuntu 24.04 build pipeline (avoids Windows path issues)
- GitHub repo: `github.com/buddha-maitreya/business-iq-enterprise`

### ✅ Phase 1 — Core Inventory Module
- Products CRUD with categories, pricing rules, metadata
- Multi-warehouse inventory tracking (6 locations seeded)
- Stock level monitoring with reorder point alerts
- Category management (15 categories, 54 products seeded)
- Inventory page with expandable warehouse → category → product hierarchy

### ✅ Phase 2 — Sales & Orders Module
- Order creation with order items, tax, discounts
- Customer management with profiles and purchase history
- Invoice generation from orders, payment tracking
- Configurable order statuses (data-driven, not hardcoded)
- 90-day demo seed data (65 orders, 47 invoices)

### ✅ Phase 3 — AI Features (Partial)
- **Business Assistant agent** — conversational BI with DB snapshot context
- **Insights Analyzer agent** — demand forecast, anomaly detection, restock recommendations
- **Report Generator agent** — AI-narrated sales/inventory/customer/financial reports
- **Knowledge Base agent** — RAG for uploaded business documents via vector store
- AI Assistant page with chat interface, suggestions, loading states

### ✅ Phase 4 — Reporting & Dashboard
- Dashboard with summary cards, date range filter, charts (pure SVG)
- LineChart (Y-axis ticks, axis labels), BarChart, PieChart (side legends)
- Invoice status breakdown table, low stock alerts table
- Reports page with AI-generated markdown reports

### ✅ Phase 5 — Enterprise Features
- JWT auth (jose HS256, 24h expiry) + Bun.password (bcrypt)
- 5-tier RBAC: super_admin > admin > manager > staff > viewer
- 10 permission modules with per-warehouse scoping
- Login page, auth middleware on all protected routes
- Admin console with 5 tabs: Users, Statuses, Tax Rules, Knowledge Base, Settings
- Payment integration (Paystack + M-Pesa) and KRA eTIMS compliance
- Email page (super_admin, AI-powered triage + drafts)
- About page (Business IQ Enterprise, powered by Ruskins AI)
- Mobile-optimized: hamburger drawer sidebar, touch targets, table scroll, responsive layouts

---

## Phase 7 — External POS Integration (Future)

Business IQ Enterprise will **never** include a built-in Point-of-Sale system. POS is a specialized domain with dedicated hardware, compliance requirements, and mature third-party solutions. Instead, this phase focuses on **integrating with external POS providers** via their APIs.

### 7.1 Integration-Only Approach

```
┌──────────────────┐     Webhook / API     ┌──────────────────┐
│  External POS     │ ────────────────────► │  Business IQ      │
│  (3rd-party)      │ ◄──────────────────── │  (cloud)          │
│  e.g. Square,     │     REST callbacks    │  /api/pos/webhook  │
│  Lightspeed, Vend │                       │  /api/pos/sync     │
└──────────────────┘                        └──────────────────┘
```

**What we build:** API endpoints to receive transaction data from external POS systems.  
**What we don't build:** POS terminals, receipt printers, cash drawer drivers, card readers, offline queues, or any hardware integration.

### 7.2 POS Webhook Endpoints
- [ ] `POST /api/pos/webhook` — Receive sale/refund events from external POS
- [ ] `POST /api/pos/sync` — Bulk import historical POS transactions
- [ ] `GET /api/pos/connections` — List configured POS integrations
- [ ] `PUT /api/pos/connections/:id` — Update POS connection settings (API key, webhook URL)

### 7.3 POS Integration Schema
- [ ] `pos_connections` — id, provider (Square/Lightspeed/Vend/Custom), apiKey, webhookSecret, warehouseId, status, lastSync
- [ ] `pos_transactions` — id, connectionId, externalId, orderId, amount, currency, paymentMethod, rawPayload (JSONB), receivedAt

### 7.4 Data Flow
- [ ] Incoming POS sale → create order + order items + deduct inventory
- [ ] Payment method mapping (POS provider's payment types → Business IQ's)
- [ ] Duplicate detection via `externalId` (idempotent webhook processing)
- [ ] Error queue for failed transaction imports (retry with backoff)

### 7.5 Admin Console — POS Connections Tab
- [ ] Add/edit POS connection (provider, API key, webhook secret, assigned warehouse)
- [ ] Test connection button (ping provider API)
- [ ] Connection status dashboard (last sync time, error count, transaction volume)

---

## Phase 8 — Intelligent Business Chatbot ✅ (Implemented)

**Status: Already implemented** as the AI Assistant with Data Science Agent orchestrator, multi-agent delegation (Insights Analyzer, Report Generator, Knowledge Base), SSE streaming chat, tool-call visualization, session management, and proactive intelligence cron jobs. No further work needed — this phase is complete.

---

## Phase 9 — Testing, Optimization & Deployment

### 9.1 Testing
- [ ] Agent evaluations via Agentuity's eval system
- [ ] Workbench test prompts for each agent (including Data Science Assistant routing)
- [ ] Schema validation tests for all tool call inputs/outputs
- [ ] Integration tests: order → inventory → sales sync flow
- [ ] Integration tests: chat → tool call → sub-agent → response flow
- [ ] Load testing for SSE connections (concurrent chat sessions)

### 9.2 Performance
- [ ] Connection pooling via `@agentuity/postgres` (max 10 connections)
- [ ] KV caching for hot data (product catalog, pricing, chat session metadata)
- [ ] Response compression (gzip/deflate)
- [ ] Pagination on all list endpoints
- [ ] Chat message pruning (archive old sessions, compress thread context)
- [ ] SSE connection management (heartbeat, reconnect, max idle timeout)

### 9.3 Deployment (Per-Client)
- [ ] Build deployment automation script for new client onboarding
- [ ] `agentuity deploy` — same build pushed to each client's Agentuity project
- [ ] Per-client environment variable management via Agentuity console / secrets
- [ ] Per-client database provisioning + migration script
- [ ] Monitoring via Agentuity Observability (per-project dashboards)
- [ ] Rollback strategy via deployment versions
- [ ] Document client onboarding runbook (provision → configure → deploy → migrate → verify)

---

## Phase 10 — Python Analytics Engine (Sandbox-Based)

A unified Python analytics library running in Agentuity sandboxes via `ctx.sandbox.run()`. **Not a separate microservice** — a collection of Python scripts pre-installed in a sandbox snapshot that TypeScript agents invoke on-demand for charts, forecasting, classification, and anomaly detection.

### 10.1 Architecture — Sandbox One-Shot Execution

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  TypeScript Agents (Agentuity Cloud)                                         │
│                                                                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐              │
│  │ Report Generator │  │ Data Science     │  │ Insights         │              │
│  │                  │  │ Assistant        │  │ Analyzer          │              │
│  └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘              │
│           │                     │                      │                      │
│           └─────────────────────┼──────────────────────┘                      │
│                                 │                                             │
│                    src/lib/analytics.ts                                       │
│                    (typed wrapper around ctx.sandbox.run)                     │
└─────────────────────────────────┼─────────────────────────────────────────────┘
                                  │ ctx.sandbox.run()
                                  │ input: JSON (action + data)
                                  │ output: JSON + base64 charts
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Python Sandbox (ephemeral, from snapshot)                                   │
│  Runtime: python:3.13  |  Snapshot: analytics-snapshot-v1                    │
│                                                                              │
│  /scripts/analytics/                                                         │
│  ├── main.py             ← single entry point, reads input.json, dispatches  │
│  ├── charts/                                                                 │
│  │   ├── sales_trends.py      (matplotlib time series, moving averages)      │
│  │   ├── heatmap.py           (seaborn branch × period heatmap)              │
│  │   ├── scatter.py           (margin vs. volume bubble chart)               │
│  │   ├── treemap.py           (squarify category revenue treemap)            │
│  │   ├── pareto.py            (ABC 80/20 bar + cumulative line)              │
│  │   ├── waterfall.py         (revenue contribution breakdown)               │
│  │   ├── forecast_plot.py     (actual vs. predicted with fan chart)           │
│  │   └── geo_map.py           (Kenya county/region branch performance)       │
│  ├── forecasting/                                                            │
│  │   ├── prophet_forecast.py  (per-product demand with Kenyan holidays)      │
│  │   ├── arima.py             (SARIMA for seasonal products)                 │
│  │   ├── holt_winters.py      (exponential smoothing, fast forecasts)        │
│  │   └── safety_stock.py      (dynamic safety stock + EOQ)                   │
│  ├── classification/                                                         │
│  │   ├── abc_xyz.py           (revenue contribution × demand variability)    │
│  │   ├── rfm.py               (customer Recency/Frequency/Monetary)          │
│  │   ├── clv.py               (BG/NBD + Gamma-Gamma lifetime value)          │
│  │   └── bundles.py           (Apriori/FP-Growth association rules)          │
│  └── anomaly/                                                                │
│      ├── isolation_forest.py  (transaction anomaly detection)                │
│      ├── shrinkage.py         (inventory discrepancy detection)              │
│      └── price_anomaly.py     (flag out-of-band pricing)                     │
└─────────────────────────────────────────────────────────────────────────────┘
```

**How it works:**
1. TypeScript agent queries DB for relevant data (sales, inventory, customers)
2. Agent calls `analytics.run(ctx, { action: "forecast", data: [...] })`
3. `analytics.ts` writes `input.json` to sandbox, runs `python3 /scripts/analytics/main.py`
4. `main.py` reads `input.json`, dispatches to the right module based on `action`
5. Module processes data, generates results (JSON + base64-encoded chart PNGs)
6. Writes structured JSON to stdout → TypeScript parses it
7. Sandbox is destroyed automatically (one-shot)

**Why sandbox, not a separate HTTP service:**
- No infrastructure to manage — no server, no networking, no CORS
- Scales to zero — no idle costs when analytics aren't running
- Per-request isolation — each call gets a clean container
- Pre-installed deps via snapshot — cold start ~1-2s
- Already integrated via existing `src/lib/sandbox.ts`

### 10.2 Dispatcher Pattern — `main.py`

Single entry point that routes to the correct analytics module:

```python
# /scripts/analytics/main.py
import json, sys

def main():
    with open("input.json") as f:
        request = json.load(f)

    action = request["action"]
    data = request.get("data", [])
    params = request.get("params", {})

    # Dispatch to the right module
    if action == "chart.sales_trends":
        from charts.sales_trends import run
    elif action == "chart.heatmap":
        from charts.heatmap import run
    elif action == "chart.treemap":
        from charts.treemap import run
    elif action == "chart.pareto":
        from charts.pareto import run
    elif action == "chart.forecast":
        from charts.forecast_plot import run
    elif action == "forecast.prophet":
        from forecasting.prophet_forecast import run
    elif action == "forecast.arima":
        from forecasting.arima import run
    elif action == "forecast.safety_stock":
        from forecasting.safety_stock import run
    elif action == "classify.abc_xyz":
        from classification.abc_xyz import run
    elif action == "classify.rfm":
        from classification.rfm import run
    elif action == "classify.clv":
        from classification.clv import run
    elif action == "classify.bundles":
        from classification.bundles import run
    elif action == "anomaly.transactions":
        from anomaly.isolation_forest import run
    elif action == "anomaly.shrinkage":
        from anomaly.shrinkage import run
    elif action == "anomaly.pricing":
        from anomaly.price_anomaly import run
    else:
        print(json.dumps({"error": f"Unknown action: {action}"}))
        sys.exit(1)

    result = run(data, params)
    print(json.dumps(result))

if __name__ == "__main__":
    main()
```

Each module exports a `run(data, params) → dict` function that returns structured JSON. Chart modules include a `charts` key with base64-encoded PNGs:

```python
{
    "summary": { ... },                    # structured results
    "charts": [                            # optional, for chart actions
        {
            "title": "Sales Trend — Last 90 Days",
            "format": "png",
            "data": "iVBORw0KGgo...",      # base64
            "width": 800,
            "height": 400
        }
    ]
}
```

### 10.3 TypeScript Integration — `src/lib/analytics.ts`

Typed wrapper around `ctx.sandbox.run()`:

```typescript
// src/lib/analytics.ts
type AnalyticsAction =
  | "chart.sales_trends" | "chart.heatmap" | "chart.treemap"
  | "chart.pareto" | "chart.forecast" | "chart.waterfall"
  | "forecast.prophet" | "forecast.arima" | "forecast.safety_stock"
  | "classify.abc_xyz" | "classify.rfm" | "classify.clv" | "classify.bundles"
  | "anomaly.transactions" | "anomaly.shrinkage" | "anomaly.pricing";

interface AnalyticsRequest {
  action: AnalyticsAction;
  data: Record<string, unknown>[];
  params?: Record<string, unknown>;
}

interface AnalyticsChart {
  title: string;
  format: "png" | "svg";
  data: string;  // base64
  width: number;
  height: number;
}

interface AnalyticsResult {
  summary: Record<string, unknown>;
  charts?: AnalyticsChart[];
  error?: string;
}

export async function runAnalytics(
  ctx: AgentContext,
  request: AnalyticsRequest
): Promise<AnalyticsResult> {
  const result = await ctx.sandbox.run({
    runtime: "python:3.13",
    snapshot: process.env.ANALYTICS_SNAPSHOT_ID,
    command: "python3 /scripts/analytics/main.py",
    files: { "input.json": JSON.stringify(request) },
    timeout: { execution: 60000 },
    network: { enabled: false },
  });
  return JSON.parse(result.stdout);
}
```

### 10.4 Chart Capabilities

| Chart Type | Module | Libraries | Use Case |
|------------|--------|-----------|----------|
| Sales trend lines | `charts/sales_trends.py` | matplotlib | Revenue over time with moving averages, confidence bands |
| Revenue heatmaps | `charts/heatmap.py` | seaborn | Branch × period intensity (spot underperformers) |
| Product scatter | `charts/scatter.py` | matplotlib | Margin vs. volume bubbles — find stars and dogs |
| Category treemaps | `charts/treemap.py` | squarify + matplotlib | Hierarchical revenue proportions |
| Pareto (80/20) | `charts/pareto.py` | matplotlib | ABC analysis — which 20% of products drive 80% of revenue |
| Waterfall | `charts/waterfall.py` | matplotlib | Revenue contribution breakdown by category |
| Forecast plot | `charts/forecast_plot.py` | matplotlib + prophet | Actual vs. predicted with 80%/95% prediction intervals |
| Kenya geo map | `charts/geo_map.py` | folium + geopandas | Branch performance by county/region |

**Design principles:**
- Brand-aware color palette via `params.colors` (primary, accent, background)
- KES currency formatting with Kenyan locale
- Print-ready: 300 DPI for PDF export, 150 DPI for web
- All charts return base64-encoded PNG + dimensions for embedding

### 10.5 Analytics Algorithms — Competitive Moat

Algorithms that no other inventory/sales management system in Kenya offers:

#### Demand Forecasting & Inventory Optimization
- [ ] **Prophet time series forecasting** — per-product, per-branch demand prediction with Kenyan holiday calendar (Jamhuri Day, Madaraka Day, Mashujaa Day, etc.)
- [ ] **ARIMA/SARIMA models** — for products with strong seasonal patterns (tourist seasons, rainy/dry season)
- [ ] **Exponential smoothing (Holt-Winters)** — fast, lightweight forecasts for high-velocity products
- [ ] **Safety stock calculator** — dynamic safety stock using actual demand variability (not static reorder points)
- [ ] **Economic Order Quantity (EOQ)** — optimal order quantity factoring holding cost, ordering cost, demand rate
- [ ] **ABC-XYZ inventory classification** — categorize products by revenue contribution (ABC) × demand predictability (XYZ)

#### Pricing Intelligence
- [ ] **Price elasticity estimation** — measure how quantity demanded responds to price changes per product
- [ ] **Dynamic pricing recommendations** — suggest optimal prices based on demand curves and margin targets
- [ ] **Bundle detection** — Apriori/FP-Growth association rule mining to identify frequently co-purchased products
- [ ] **Markdown optimization** — when to discount slow-moving stock, by how much, to maximize recovery

#### Customer Analytics
- [ ] **RFM segmentation** — Recency, Frequency, Monetary clustering with automatic labels (Champions, At-Risk, Hibernating)
- [ ] **Customer Lifetime Value (CLV)** — BG/NBD + Gamma-Gamma probabilistic models (`lifetimes` library)
- [ ] **Churn prediction** — gradient boosting classifier identifying customers likely to stop buying
- [ ] **Next-purchase prediction** — predict when a customer will next buy and what products

#### Anomaly Detection
- [ ] **Transaction anomaly detection** — Isolation Forest on transaction patterns (unusually large sales, suspicious refunds)
- [ ] **Inventory shrinkage detection** — statistical detection of stock discrepancies beyond normal variance
- [ ] **Price anomaly alerts** — flag sales significantly below/above normal price bands

#### Operational Intelligence
- [ ] **Sales velocity scoring** — rank products by sales velocity × margin
- [ ] **Stock-out cost estimation** — estimate revenue lost from stock-outs using demand models
- [ ] **Supplier lead time analysis** — statistical analysis of actual vs. promised lead times
- [ ] **Seasonal pattern detection** — automatic detection of seasonal cycles without manual configuration

### 10.6 Python Sandbox & Snapshot

**Snapshot ID** stored as env var: `ANALYTICS_SNAPSHOT_ID`

**Packages installed in snapshot:**

| Package | Purpose |
|---------|---------|
| `pandas` | Data manipulation, aggregation, time series |
| `numpy` | Numerical computation, array operations |
| `scipy` | Statistical tests, optimization |
| `scikit-learn` | Clustering, anomaly detection, PCA, classifiers |
| `matplotlib` | Publication-quality static charts |
| `seaborn` | Statistical visualizations (heatmaps, distributions) |
| `plotly` | Interactive charts (optional web embedding) |
| `statsmodels` | ARIMA, exponential smoothing, regression |
| `prophet` | Time series forecasting with holiday effects |
| `lifetimes` | CLV modeling (BG/NBD, Gamma-Gamma) |
| `mlxtend` | Association rule mining (Apriori, FP-Growth) |
| `squarify` | Treemap chart generation |
| `pillow` | Image processing for chart output |
| `openpyxl` | Excel export support |

**Sandbox creation (run in WSL terminal):**
```bash
# 1. Create sandbox with network enabled (for pip installs)
agentuity cloud sandbox create --runtime python:3.13 --name analytics-v2 --network --idle-timeout 45m

# 2. Create venv + install all analytics packages
agentuity cloud sandbox exec <sbx_id> -- uv venv /home/agentuity/venv
agentuity cloud sandbox exec <sbx_id> -- bash -c "VIRTUAL_ENV=/home/agentuity/venv uv pip install \
  pandas numpy scipy scikit-learn matplotlib seaborn plotly \
  statsmodels prophet lifetimes mlxtend squarify \
  pillow openpyxl"

# 3. Copy analytics scripts into sandbox
agentuity cloud sandbox cp scripts/analytics <sbx_id>:/scripts/analytics

# 4. Create snapshot for production use
agentuity cloud sandbox snapshot create <sbx_id> --name analytics-snapshot-v2

# 5. Save snapshot ID as env var
agentuity cloud env set ANALYTICS_SNAPSHOT_ID=<snapshot_id>
```

### 10.7 Agent Integration Points

**Report Generator** — embeds charts in every report section:
```
Agent receives report request
  → Queries DB for data (TypeScript)
  → runAnalytics(ctx, { action: "chart.sales_trends", data })
  → Receives { summary, charts: [{ data: "base64...", format: "png" }] }
  → Embeds chart images in PDF/DOCX report
  → Returns formatted report to user
```

**Data Science Assistant** — delegates classification and forecasting:
```
User asks "What products should I reorder?"
  → Agent classifies intent → inventory optimization
  → Queries sales + stock data from DB
  → runAnalytics(ctx, { action: "classify.abc_xyz", data })
  → runAnalytics(ctx, { action: "forecast.safety_stock", data })
  → Agent combines results into actionable response with chart
```

**Insights Analyzer** — runs forecasting and anomaly detection:
```
Cron triggers weekly insight generation
  → Queries last 90 days of sales data
  → runAnalytics(ctx, { action: "forecast.prophet", data })
  → runAnalytics(ctx, { action: "anomaly.transactions", data })
  → Results stored in KV, surfaced in Assistant chat
```

### 10.8 Implementation Sequence

```
Phase 10a — Foundation: ✅ COMPLETE
  ├── ✅ Python sandbox + snapshot with all analytics packages (snp_39ad8274...)
  ├── ✅ main.py dispatcher + input/output protocol (with input validation)
  ├── ✅ src/lib/analytics.ts typed wrapper (direct SDK call, output validation)
  ├── ✅ src/lib/analytics-scripts.ts — Python source embedded as TS constants
  ├── ✅ src/lib/analytics-defaults.ts — typed defaults for 6 categories
  ├── ✅ src/services/analytics-configs.ts — CRUD + cache for DB overrides
  ├── ✅ src/api/analytics-configs.ts — admin API (GET/PUT/reset/seed)
  ├── ✅ analytics_configs DB table + migration 0009 applied
  ├── ✅ First chart modules (sales_trends, heatmap, pareto)
  ├── ✅ Bug fix: classify.abc_xyz category mapping (exact-match-first)
  ├── ✅ Bug fix: Python modules uploaded via command.files (not executeSandbox)
  └── ✅ Bug fix: File naming standardized to input.json

Phase 10a-qe — Quality Engineering: ✅ COMPLETE
  ├── ✅ Code template library — pre-built Python templates in KV for LLM use
  ├── ✅ Python input validation — validate_input() in main.py checks columns,
  │     data types, minimum rows before processing
  ├── ✅ Execution metrics tracking — durationMs, cpuTimeMs, memoryByteSec
  │     logged per action type in KV with 24h TTL
  └── ✅ Output schema validation — validateAnalyticsOutput() in analytics.ts

Phase 10b — Forecasting:
  ├── Prophet forecast module with Kenyan holiday calendar
  ├── ARIMA/SARIMA for seasonal products
  ├── Safety stock + EOQ calculators
  ├── ABC-XYZ inventory classification
  └── Integration with Insights Analyzer agent

Phase 10c — Customer Intelligence:
  ├── RFM segmentation pipeline
  ├── CLV prediction (BG/NBD + Gamma-Gamma)
  ├── Churn prediction model
  ├── Bundle detection (association rules)
  └── Integration with Data Science Assistant

Phase 10d — Anomaly Detection & Pricing:
  ├── Transaction anomaly detection (Isolation Forest)
  ├── Shrinkage detection
  ├── Price elasticity estimation
  ├── Dynamic pricing recommendations
  └── Alerting pipeline → notifications → SSE push

Phase 10e — Sandbox Optimization:
  ├── Canary execution — run on first 100 rows before full dataset
  │     to validate code works; abort if canary fails
  └── Output fingerprinting — hash action + params + data, cache results
        in KV with TTL; return cached result for repeat queries
```

---

## Architecture Diagram (Updated)

```
┌─────────────────────────────────────────────────────────────────────┐
│                         React Frontend                               │
│  src/web/ — @agentuity/react hooks (useAPI, useEventStream)          │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  Dashboard    │  │  Admin       │  │  AI Assistant  │  │  Operations   │  │
│  │  (charts)     │  │  (5 tabs)    │  │  (SSE stream)  │  │  (Sales/Ord)  │  │
│  └──────┬────────┘  └──────┬───────┘  └──────┬─────────┘  └──────┬───────┘  │
└─────────┼──────────────────┼─────────────────┼──────────────────┼───────────┘
          │ HTTP             │ HTTP            │ SSE              │ HTTP
┌─────────▼──────────────────▼─────────────────▼──────────────────▼───────────┐
│                          API Routes (Hono)                                    │
│  src/api/ — createRouter(), auth middleware, SSE streaming                    │
└──────┬──────────┬──────────┬──────────┬──────────┬──────────┬───────────────┘
       │          │          │          │          │          │
┌──────▼──┐ ┌────▼─────┐ ┌─▼────────┐ ┌▼────────┐ ┌▼───────┐ ┌▼──────────┐
│Business  │ │Insights   │ │Report    │ │Knowledge│ │Sched-  │ │Data       │
│Assistant │ │Analyzer   │ │Generator │ │Base     │ │uler    │ │Science    │
│(chat/NL) │ │(analytics)│ │(reports) │ │(RAG)    │ │(cron)  │ │Assistant  │
└─────┬────┘ └─────┬─────┘ └────┬─────┘ └───┬────┘ └───┬────┘ │ORCHESTR. │
      │            │            │            │          │      └─────┬─────┘
      └────────────┴────────────┴────────────┴──────────┘            │
                                │  all agents report to  ◄───────────┘
                                ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                           Services Layer                                  │
│  ┌──────────────┐  ┌───────────┐  ┌────────────┐  ┌───────────────────┐  │
│  │ Neon Postgres │  │ KV Storage│  │Vector Store│  │ External APIs     │  │
│  │ (Drizzle ORM)│  │ (cache)   │  │ (RAG docs) │  │ (HRMIS/CRM/POS)  │  │
│  └──────────────┘  └───────────┘  └────────────┘  └───────────────────┘  │
└──────────────────────────────────┬────────────────────────────────────────┘
                                   │ ctx.sandbox.run()
┌──────────────────────────────────▼────────────────────────────────────────┐
│                    Python Sandbox (Agentuity Cloud)                        │
│  ┌────────────────┐  ┌──────────────────┐  ┌──────────────────────────┐   │
│  │ Chart Service   │  │ Analytics Engine  │  │ Forecasting Service      │   │
│  │ matplotlib      │  │ pandas, scipy     │  │ prophet, ARIMA           │   │
│  │ seaborn, plotly  │  │ scikit-learn      │  │ statsmodels              │   │
│  └────────────────┘  └──────────────────┘  └──────────────────────────┘   │
└───────────────────────────────────────────────────────────────────────────┘
```

---

## Key Tech Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| ORM | Drizzle via `@agentuity/drizzle` | Type-safe, lightweight, first-class Agentuity support |
| Schema validation | Zod | Rich `.describe()` for AI SDK, ecosystem support |
| AI SDK | Vercel AI SDK (`ai`) | Unified API for generateText, generateObject, streamText |
| AI providers | OpenAI + Groq via AI Gateway | GPT for quality, Groq for speed, unified billing |
| State management | `ctx.thread.state` + KV | Thread for conversations, KV for durable cache |
| Frontend hooks | `@agentuity/react` | Type-safe `useAPI`, `useWebsocket`, `useEventStream` |
| Auth | jose JWT + Bun.password | HS256 tokens, bcrypt hashing, 24h expiry |
| Chat streaming | SSE (Server-Sent Events) | Adapted from Coder project — tool-call visualization, agent delegation |
| Chat state | useReducer | Complex event dispatch (adapted from Coder's `useSessionEvents.ts`) |
| POS integration | External API webhooks | No built-in POS — integrate with Square, Lightspeed, Vend, etc. |
| Python analytics | Agentuity Sandboxes | matplotlib/seaborn/plotly charts, scikit-learn, prophet forecasting |
| **Architecture** | **Single-tenant** | **One deployment per client — full isolation, no tenant_id** |
| **Design** | **Industry-agnostic** | **Generic models + env-driven labels — zero vertical hardcoding** |

---

## Future — Chat Intelligence & Workflow Enhancements 🔲

Deferred features for future implementation. Not urgent — to be prioritized later.

### F1. Chat Personalization & Role Awareness

- [ ] Inject `userName` + `userRole` into system prompt on **all** code paths (currently only streaming chat passes `userName`; role is never injected)
- [ ] Add role-aware instructions so the LLM tailors responses: admins see operational insights, managers see approvals and team metrics, staff see task-specific guidance
- [ ] Customize actionable items and suggestions based on user's position and permissions

### F2. Proactive Pending Actions in Chat

- [ ] On session start, query pending approvals count, low stock alerts, overdue invoices, and upcoming scheduled tasks
- [ ] Replace static `aiWelcomeMessage` with a dynamic actionable briefing (e.g., "Good morning {name}, you have 3 pending approvals and 5 low-stock items")
- [ ] Surface pending actions contextually during conversation when relevant

### F3. Chat-Based Approval Workflow

- [ ] Add `list_pending_approvals` tool to data-science agent — wraps `getPendingApprovalsForUser()`
- [ ] Add `approve_request` tool — wraps `makeDecision()` with `approved` status
- [ ] Add `reject_request` tool — wraps `makeDecision()` with `rejected` status + reason
- [ ] User can approve/reject from chat without navigating to Approvals page

### F4. Product Creation Enhancements

- [ ] Add optional `warehouseId` + initial `quantity` to product creation flow so stock is created at a specific warehouse on product add
- [ ] Default warehouse auto-selected from signed-in user's `assignedWarehouses[0]`
- [ ] Route `product.create` through approval pipeline — map to next higher-up supervisor via `reportsTo` chain
- [ ] Configurable: `PRODUCT_APPROVAL_REQUIRED=true/false` env var

### F5. Email System & AI Draft Generation

- [ ] Build `src/api/emails.ts` + `src/services/emails.ts` — email CRUD, inbox, sent, drafts
- [ ] Integrate SMTP/SendGrid/Resend provider (configurable via `EMAIL_PROVIDER` env var)
- [ ] AI draft generation: LLM composes email based on context (order confirmation, follow-up, report summary)
- [ ] Wire to existing `EmailPage.tsx` frontend (currently a placeholder with demo data)
- [ ] Email templates for common business communications

### F6. Staff Daily Summary Reports

- [ ] Staff uploads daily business summary (text, document, or voice-to-text) via chat or dedicated UI
- [ ] Summary data stored in relevant table (reuse document ingestion or new `daily_reports` table)
- [ ] Auto-routes to their supervisor via approval/notification system
- [ ] Summaries ingested into knowledge base to further train the AI model on business context
- [ ] Supervisor dashboard view of team's daily summaries

### F7. Report Formatting & Export Polish

- [ ] Focus on visual formatting quality across all export formats (PDF, Excel, Word, PowerPoint)
- [ ] Elegant charts with proper styling, legends, and annotations
- [ ] Excel export: clean data-only sheets alongside formatted sheets
- [ ] PowerPoint: presentation-ready slides with speaker notes
- [ ] Configurable chart themes matching client branding

### F8. Progressive Web App (PWA)

Turn Business IQ Enterprise into an installable PWA with offline capability and native app feel. Full roadmap in **`PWA-ROADMAP.md`**.

- [ ] Web app manifest (`manifest.json`) + app icons (192, 512, maskable)
- [ ] Service worker with cache-first static assets + network-first API
- [ ] Custom install prompt banner (Android native prompt + iOS manual instructions)
- [ ] Offline app shell — layout loads without network
- [ ] SW registration in production only (`main.tsx`)
- [ ] PWA meta tags (theme-color, apple-mobile-web-app-*, apple-touch-icon)
- [ ] Update notification toast ("New version available — Refresh")
- [ ] `history.pushState()` for back-button support in standalone mode
- [ ] Push notifications for approvals, alerts, order status (future)

### F9. Sandbox Quality & Performance Optimization

Performance optimizations for the Python analytics sandbox. Items 1-3 already implemented in Phase 10a-qe.

- [x] **Code template library** — Pre-built Python code templates stored in KV, keyed by analysis type. LLM fills parameters instead of generating from scratch. Reduces hallucination.
- [x] **Python input validation** — `validate_input()` in `main.py` checks column existence, data types, and minimum row counts before processing.
- [x] **Execution metrics tracking** — `durationMs`, `cpuTimeMs`, `memoryByteSec` logged per action type in KV (24h TTL). Surface in admin dashboard.
- [ ] **Canary execution** — Before running on full dataset, run on first 100 rows to validate code works. If canary fails, abort without wasting resources.
- [ ] **Output fingerprinting** — Hash action + params + data, cache results in KV with TTL. Return cached result for repeat queries.
