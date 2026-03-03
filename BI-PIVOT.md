# Business IQ Enterprise — BI Platform Pivot

## Strategic Decision Document

**Date:** March 2026  
**Decision:** Pivot from Inventory/Sales Management → Business Intelligence Platform  
**Status:** CONFIRMED — ready for execution  
**Developed by:** Ruskins AI Consulting LTD © 2026

---

## 1. The Decision

Business IQ Enterprise pivots from a generalist inventory & sales management system to a **Business Intelligence (BI) platform** — the "Warehouse Brain" that sits on top of any POS/ERP.

### What We ARE

| Identity | Description |
|----------|-------------|
| **Business Intelligence Platform** | AI-powered analytics, forecasting, and decision support |
| **The Brain** | Connects to your existing systems, makes them smarter |
| **Plug-in Intelligence** | Zero migration risk — clients keep their POS/ERP |
| **Decision Engine** | Turns raw transaction data into actionable business insight |

### What We Are NOT

| Rejected Path | Why |
|---------------|-----|
| **ERP** | Reliability bar too high (bugs = client business stops), scope explosion (accounting, HR, payroll, procurement, compliance), 10-year head start from Odoo/SAP/QuickBooks, 3-12 month sales cycles |
| **POS** | Specialized hardware, compliance certifications, mature market, not our differentiator |
| **Transaction System** | We analyze transactions; we don't create them |

---

## 2. Why BI Wins

### Competitive Moat (Already Built)

| Capability | Status | Competition in Kenya/Africa SME |
|------------|--------|--------------------------------|
| Prophet demand forecasting (Kenyan holidays) | Production | **Nobody** |
| ARIMA/SARIMA seasonal forecasting | Production | **Nobody** |
| Holt-Winters exponential smoothing | Production | **Nobody** |
| Safety stock + EOQ optimization | Production | **Nobody** |
| ABC-XYZ inventory classification | Production | **Nobody** |
| RFM customer segmentation | Production | **Nobody** |
| CLV prediction (BG/NBD + Gamma-Gamma) | Production | **Nobody** |
| Bundle detection (Apriori/FP-Growth) | Production | **Nobody** |
| Anomaly detection (IsolationForest) | Production | **Nobody** |
| Shrinkage detection (statistical) | Production | **Nobody** |
| Natural language analytics chat | Production | **Nobody** |
| AI-narrated board-quality reports (PDF) | Production | **Nobody** |

**12 production AI analytics modules.** No other inventory/sales platform in the Kenya/Africa SME market offers any of these. This is a 12-month head start that compounds with every new module.

### Business Model Advantages

| Factor | BI Platform | ERP |
|--------|-------------|-----|
| **Sales cycle** | 1-2 weeks | 3-12 months |
| **Onboarding** | Connect data, get insights tomorrow | 3-6 month implementation |
| **Client risk** | Zero — existing systems continue | Migration risk, vendor lock-in |
| **Revenue model** | Monthly subscription | Project fees + maintenance |
| **Build scope** | Analytics + UI + integrations | Everything (accounting to HR) |
| **Competition** | Blue ocean in Africa SME | Red ocean (Odoo, SAP, QuickBooks) |
| **Differentiator** | AI is the product | AI is a feature |
| **Scalability** | Same code, many verticals | Vertical-specific customization |

### Architecture Fit

The existing architecture — single-tenant, industry-agnostic, env-driven config — is **perfect** for BI:
- Each client gets their own analytics brain
- Industry terminology configured via env vars (`PRODUCT_LABEL`, `ORDER_LABEL`, etc.)
- Same analytics modules work for any vertical
- Per-client Python sandbox with pre-installed analytics packages

---

## 3. Analytics Architecture — Shared Python Service (Not Per-Client)

### Why NOT Railway/Fly.io Per Client?

The original plan suggested deploying a separate Python microservice per client ($5-7/client/month). This is wrong. Here's why:

**The Python analytics code is stateless and data-agnostic.** Every module takes `data` (a list of dicts) + `params` as input and returns `{ summary, charts }` as output. The service never connects to any database. It doesn't know or care which client sent the request. Data isolation is inherent — each client's Agentuity TypeScript agent queries THEIR single-tenant database, then sends only their data to the shared service.

### Why NOT Agentuity Sandboxes (for production analytics)?

Agentuity sandboxes are designed for **ephemeral, untrusted code execution**:
- One-shot: boot → run → destroy (no connection pooling, no model caching)
- 25 Python files (~4200 lines) uploaded on **every** call via `command.files`
- Results passed via stdout (fragile — sandbox prepends timestamps to each line, large base64 chunks get split across lines)
- Cold start: 3-5s with snapshot, 10-15s without

Sandboxes are the RIGHT choice for **LLM-generated ad-hoc code** (untrusted, needs isolation). They are the WRONG choice for **production analytics modules** (trusted, tested, versioned code that runs thousands of times).

### Correct Architecture: One Shared FastAPI Service

```
┌─────────────────────────────────────────────────────────────────┐
│  Client A (Agentuity)          Client B (Agentuity)             │
│  ┌──────────────────┐          ┌──────────────────┐             │
│  │ TypeScript Agent  │          │ TypeScript Agent  │             │
│  │ 1. Query Client   │          │ 1. Query Client   │             │
│  │    A's database   │          │    B's database   │             │
│  │ 2. POST /analyze  │──┐  ┌──│ 2. POST /analyze  │             │
│  │    { data: [...] }│  │  │  │    { data: [...] }│             │
│  └──────────────────┘  │  │  └──────────────────┘             │
└─────────────────────────┼──┼────────────────────────────────────┘
                          │  │
                          ▼  ▼
              ┌──────────────────────────┐
              │  ONE Shared FastAPI       │
              │  Analytics Service        │
              │  ─────────────────────    │
              │  POST /analyze            │
              │  { action, data, params } │
              │  → { summary, charts }    │
              │                           │
              │  Receives DATA, not DB    │
              │  credentials. Never sees  │
              │  another client's data.   │
              │  Pure computation.         │
              └──────────────────────────┘
```

### Data Isolation is Architectural (Not Code-Based)

| Concern | How It's Isolated |
|---------|-------------------|
| **Database** | Each client has their own Neon Postgres. The Python service has NO database access. |
| **Data in transit** | Each client's TypeScript agent queries its own DB, then POSTs only its data to `/analyze`. |
| **No client identifier needed** | The Python service doesn't know which client is calling. No tenant ID, no auth tokens between services. |
| **No data persistence** | The Python service is stateless. It processes data in memory and returns results. Nothing is stored. |
| **Model caching** | Cached by action type (e.g., a Prophet model for "weekly forecast"). If Client A and B both request the same forecast type, they get separate model fits on their own data. The cache key is action+params, not client identity. |

### Cost Model

| Approach | 1 client | 10 clients | 50 clients |
|----------|----------|------------|------------|
| Sandbox per call (current) | $0 (Agentuity included) | $0 | $0 |
| Microservice per client | $5-7/mo | $50-70/mo | $250-350/mo |
| **ONE shared microservice** | **$10-15/mo** | **$10-15/mo** | **$15-25/mo** |

Shared service cost is nearly flat — you add clients without adding infrastructure. Only scale up when total request volume demands a bigger instance.

### Where to Host the Shared Service

| Provider | Monthly Cost | Why |
|----------|-------------|-----|
| **Railway** | ~$10/mo (Pro plan) | Simplest deploy, auto-HTTPS, Dockerfile support, scale-to-zero optional |
| **Fly.io** | ~$7-10/mo | Global edge, scale-to-zero, good for latency if clients are in different regions |
| **Render** | ~$7/mo | Simple, free tier for dev, auto-deploy from GitHub |
| **Agentuity Sandbox (persistent)** | $0 (included) | NOT recommended — sandboxes aren't designed for persistent HTTP servers (no auto-restart, no health checks, no load balancing, idle timeouts) |

**Recommendation: Railway** — simplest path from Dockerfile to production.

### Two-Phase Migration

```
Phase 1 — Build & validate (no infra change yet)
  ├── Create analytics-service/ at project root
  ├── Move Python scripts from scripts/analytics/ → service
  ├── Add FastAPI API + Pydantic models + pytest
  ├── Run locally: docker-compose up → test all 25 modules
  ├── Agentuity deployment UNCHANGED (still uses sandbox)
  └── Deliverable: working, tested FastAPI service in a Docker image

Phase 2 — Deploy & switch
  ├── Deploy Docker image to Railway (one instance)
  ├── Set ANALYTICS_SERVICE_URL env var on Agentuity project
  ├── Refactor analytics.ts: if URL set → HTTP; else → sandbox (fallback)
  ├── Validate on production (compare sandbox vs service results)
  └── Remove sandbox analytics code path once confident
```

### What Stays in Agentuity Sandboxes

The `executeSandbox()` function in `src/lib/sandbox.ts` and the `run_analysis` tool in `src/agent/data-science/tools/sandbox.ts` — these handle LLM-generated ad-hoc Python code from the chat agent. This code is untrusted (written by an AI model on the fly) and MUST run in an isolated sandbox. This path is completely separate from the production analytics pipeline and does NOT change.

---

## 4. Product Positioning

### Tagline Options

- **"The AI Brain Behind Your Business"**
- **"Plug-In Intelligence for Any Business"**
- **"Your Data Scientist, On Call 24/7"**

### Value Proposition

> Business IQ Enterprise connects to your existing Point-of-Sale or ERP system and transforms your raw data into AI-powered forecasts, anomaly detection, customer intelligence, and board-quality reports. No migration. No disruption. Just smarter decisions.

### Target Verticals (Same Code, Different Config)

| Vertical | PRODUCT_LABEL | Key Analytics |
|----------|---------------|---------------|
| Retail (general) | Product | Demand forecast, restock, shrinkage |
| Wholesale/Distribution | Item | Safety stock, EOQ, supplier analytics |
| Restaurant/F&B | Menu Item | Waste prediction, peak demand, CLV |
| Manufacturing | Component | Lead time analysis, BOM optimization |
| Healthcare/Pharmacy | Medicine | Expiry tracking, demand cycles, stockout cost |
| Agriculture | Crop/Input | Seasonal forecast, price volatility |
| Tourism/Safari | Experience | RFM, CLV, bundle detection, seasonal |

---

## 5. Feature Roadmap — BI Platform

### Tier 1: Core BI (Existing — Production)

- [x] Demand forecasting (Prophet, ARIMA, Holt-Winters)
- [x] Safety stock + EOQ optimization
- [x] ABC-XYZ inventory classification
- [x] RFM customer segmentation
- [x] CLV prediction (BG/NBD + Gamma-Gamma)
- [x] Bundle detection (Apriori/FP-Growth)
- [x] Anomaly detection (transactions)
- [x] Shrinkage detection
- [x] Dead stock / slow mover identification
- [x] Natural language analytics chat
- [x] AI-narrated board-quality PDF reports
- [x] Chart generation (8 chart types)
- [x] Execution metrics tracking

### Tier 2: Advanced BI (Next — Adds Competitive Moat)

| Feature | Type | Priority |
|---------|------|----------|
| **Supplier delay analysis** | Analytics module | High |
| **Cash-in-stock simulation** | Analytics module | High |
| **Procurement recommendations** | Analytics module (aggregate restock → purchase plan) | High |
| **Churn prediction** | ML classifier | Medium |
| **Next-purchase prediction** | ML model | Medium |
| **Seasonal pattern auto-detection** | Time series | Medium |
| **Stock-out cost estimation** | Revenue impact model | Medium |
| **Sales velocity scoring** | Composite metric | Medium |

### Tier 3: BI Platform Features (Differentiators)

| Feature | Description | Priority |
|---------|-------------|----------|
| **Scheduled reports** | Weekly/monthly auto-generated reports delivered via email | High |
| **Alert system** | Configurable thresholds → push notifications / email | High |
| **Dashboard builder** | Drag-and-drop custom dashboards per role | Medium |
| **Data connectors** | POS webhooks (Square, Lightspeed, Vend), CSV import, API import | High |
| **Historical comparison** | This period vs last period, YoY, trend lines | Medium |
| **Drill-down navigation** | Click chart → see underlying data → filter → export | Medium |
| **Multi-source data** | Combine POS + accounting + CRM data in one view | Low |
| **Embedded analytics** | Iframe/widget for clients to embed BI in their own systems | Low |

### Tier 4: Warehouse Brain (Missing Features — BI-Compatible Only)

From the warehouse features audit. Only features that fit the BI identity (analysis, recommendations, predictions) are included. Operational features (pick lists, truck dispatch) are explicitly excluded.

| Feature | Implementation | Depends On |
|---------|---------------|------------|
| **Supplier delay analysis** | Python module: actual vs promised delivery dates, lead time variability, reliability scoring | `suppliers` table + delivery tracking data (imported from POS/ERP) |
| **Cash-in-stock simulation** | Python module: Monte Carlo simulation of stocking strategies, capital efficiency modeling, what-if scenarios | Existing inventory + cost data |
| **Procurement plan generation** | Aggregate restock recommendations by supplier → suggested purchase orders with quantities, timing, estimated cost | Existing safety stock + EOQ data + supplier mapping |
| **Expiry risk analytics** | Predict waste from slow-moving perishables, flag items approaching expiry for promotional pricing | Batch/expiry data (from scanning pipeline or POS import) |

**Explicitly OUT OF SCOPE (ERP territory):**
- Item location tracking (shelf/bin/zone) — operational, not analytical
- Truck/delivery dispatch management — logistics operations
- Picker error tracking — warehouse operations
- Pick list management — warehouse operations
- Purchase order creation/management — ERP function
- Receiving/putaway workflows — warehouse operations

---

## 6. Claude Code Refactoring Brief

### How to Use This Section

This section is designed to be passed directly to Claude Code agents. Each agent brief is self-contained — copy the entire agent section (including context, current code, tasks, contracts, and testing criteria) into a single Claude Code session.

**Run agents sequentially, not in parallel.** Each agent's output is validated before the next starts.

### Repository

- **GitHub:** `https://github.com/buddha-maitreya/business-iq-enterprise`
- **Branch:** `main`
- **Runtime:** Bun (TypeScript) + Python 3.13 (analytics)
- **Platform:** Agentuity (https://agentuity.dev) — agent-native serverless cloud
- **ORM:** Drizzle (Postgres)
- **AI:** Vercel AI SDK (`ai` package)
- **Validation:** Zod

### Agent Assignment

| Agent | Workstream | Primary Directories | Deliverable |
|-------|-----------|---------------------|-------------|
| **Agent 1** | Python Analytics Microservice | `analytics-service/` (new) | Standalone FastAPI service, Dockerfile, pytest suite |
| **Agent 2** | TypeScript Integration Layer | `src/lib/analytics.ts`, `src/services/type-registry.ts` | HTTP bridge to microservice with sandbox fallback |
| **Agent 3** | Frontend BI Dashboard | `src/web/` | Analytics-first UI with interactive charts |
| **Agent 4** | Data Pipeline & Connectors | `src/services/connectors/`, `src/api/webhooks.ts` | External data ingestion framework |

---

### Agent 1 — Python Analytics Microservice

> **Copy everything from this heading to the next `---` into a Claude Code session.**

#### Identity

You are refactoring a Python analytics engine from embedded TypeScript template literals into a standalone FastAPI microservice. This microservice serves ALL clients from a single deployment — it receives pre-queried data in each request and returns computed results. It never connects to any database. Data isolation is architectural (each client's TypeScript app queries its own DB and sends only its data).

#### What Exists Today

The project has 25 Python analytics modules. They exist in TWO places:

1. **Canonical source:** `scripts/analytics/` — proper `.py` files organized into subdirectories:
   ```
   scripts/analytics/
   ├── __init__.py
   ├── main.py              # Entry point: reads input.json, dispatches to module
   ├── charts/
   │   ├── __init__.py
   │   ├── sales_trends.py
   │   ├── heatmap.py
   │   ├── scatter.py
   │   ├── treemap.py
   │   ├── pareto.py
   │   ├── waterfall.py
   │   ├── forecast_plot.py
   │   ├── geo_map.py
   │   └── render.py        # Generic chart renderer (takes chart spec)
   ├── forecasting/
   │   ├── prophet_forecast.py  # Facebook Prophet with Kenyan holidays
   │   ├── arima.py
   │   ├── holt_winters.py
   │   └── safety_stock.py      # Safety stock + EOQ calculator
   ├── anomaly/
   │   ├── isolation_forest.py  # Transaction anomaly detection
   │   └── shrinkage.py         # Inventory shrinkage detection
   ├── classification/
   │   ├── abc_xyz.py           # ABC-XYZ inventory classification
   │   ├── rfm.py               # RFM customer segmentation
   │   ├── clv.py               # Customer Lifetime Value (BG/NBD + Gamma-Gamma)
   │   └── bundles.py           # Association rule mining (Apriori/FP-Growth)
   └── insights/
       ├── value_gap.py         # Revenue gap analysis
       └── dead_stock.py        # Dead/slow-moving stock detection
   ```

2. **Embedded copy:** `src/lib/analytics-scripts.ts` (~4200 lines) — the same Python code stored as TypeScript template literal strings (e.g., `export const MAIN_PY = \`...\``). This file is auto-generated by `scripts/generate-analytics-scripts.ts`. It exists because Agentuity sandboxes require all code to be uploaded as files on every call.

#### Current Execution Flow (What You're Replacing)

```python
# Currently in scripts/analytics/main.py:
# 1. Reads input.json from disk (written by sandbox file upload)
# 2. Dispatches based on action field:
#    "chart.sales_trends" → charts.sales_trends.run(data, params, chart_config)
#    "forecast.prophet"   → forecasting.prophet_forecast.run(data, params, chart_config)
#    etc.
# 3. Prints JSON result to stdout (sandbox captures stdout)
#
# Every module has the same signature:
#   def run(data: list[dict], params: dict, chart_config: dict = None) -> dict
#
# Returns: { "summary": {...}, "charts": [...], "table": {...} }
# Charts format: { "title": str, "format": "png", "data": "<base64>", "width": int, "height": int }
```

**Read these files before starting:**
- `scripts/analytics/main.py` — understand the dispatcher logic
- Any 3 modules (e.g., `charts/sales_trends.py`, `forecasting/prophet_forecast.py`, `classification/abc_xyz.py`) — understand the `run()` interface
- `src/lib/analytics.ts` lines 100-160 — understand `AnalyticsRequest`, `AnalyticsResult`, `AnalyticsChart` interfaces (the HTTP contract Agent 2 will consume)

#### What You Must Build

```
analytics-service/
├── src/
│   ├── app.py              # FastAPI application factory
│   ├── config.py           # Settings (host, port, log level, CORS origins)
│   ├── models.py           # Pydantic: AnalyzeRequest, AnalyzeResponse, ChartOutput
│   ├── dispatcher.py       # Action → module routing (extracted from main.py)
│   ├── validation.py       # Input validation (extracted from main.py validate_input)
│   ├── charts/             # Migrated from scripts/analytics/charts/
│   ├── forecasting/        # Migrated from scripts/analytics/forecasting/
│   ├── anomaly/            # Migrated from scripts/analytics/anomaly/
│   ├── classification/     # Migrated from scripts/analytics/classification/
│   └── insights/           # Migrated from scripts/analytics/insights/
├── tests/
│   ├── conftest.py         # Shared fixtures: sample sales data, products, customers
│   ├── test_charts.py      # Test every chart module with synthetic data
│   ├── test_forecasting.py # Test Prophet, ARIMA, Holt-Winters, safety stock
│   ├── test_anomaly.py     # Test isolation forest, shrinkage
│   ├── test_classification.py  # Test ABC-XYZ, RFM, CLV, bundles
│   ├── test_insights.py    # Test value gap, dead stock, new modules
│   ├── test_api.py         # Integration tests for HTTP endpoints
│   └── test_validation.py  # Input validation edge cases
├── Dockerfile              # Multi-stage: python:3.13-slim, non-root user
├── docker-compose.yml      # Service + test runner
├── pyproject.toml          # deps, pytest config, ruff linting
├── requirements.txt        # Pinned production deps
├── .dockerignore
└── README.md               # Setup, local dev, deployment instructions
```

#### FastAPI Endpoints

```python
# POST /analyze
# Request body:
{
    "action": "forecast.prophet",      # AnalyticsAction string
    "data": [{"date": "2026-01-01", "amount": 1500}, ...],  # Pre-queried rows
    "params": {"periods": 30},         # Module-specific params (optional)
    "chart_config": {"dpi": 150}       # Chart styling (optional)
}

# Response body (matches AnalyticsResult in src/lib/analytics.ts):
{
    "success": true,
    "summary": { ... },                # Module-specific structured results
    "charts": [                        # Optional, for chart/forecast actions
        {
            "title": "Sales Forecast — Next 30 Days",
            "format": "png",
            "data": "iVBORw0KGgo...",  # base64-encoded PNG
            "width": 800,
            "height": 400
        }
    ],
    "table": {                         # Optional, for tabular results
        "columns": ["date", "predicted", "lower", "upper"],
        "rows": [{"date": "2026-03-01", "predicted": 1200, ...}]
    },
    "error": null                      # null on success, string on failure
}

# GET /health
# Response: { "status": "healthy", "modules": 25, "version": "1.0.0" }

# GET /actions
# Response: { "actions": ["chart.sales_trends", "forecast.prophet", ...] }
```

#### Migration Rules

For each Python module migrated from `scripts/analytics/`:
1. **Keep the exact same `run(data, params, chart_config)` signature.** The dispatcher calls it.
2. **Remove all sandbox-specific code:**
   - Remove `sys.path.insert(0, '/home/agentuity/venv/lib/python3.13/site-packages')`
   - Remove `json.dump(result, sys.stdout)` — the function returns a dict, FastAPI serializes it
   - Remove `import sys; sys.exit(1)` error handling — raise exceptions, let FastAPI handle 500s
3. **Add type hints:** `def run(data: list[dict[str, Any]], params: dict[str, Any], chart_config: dict[str, Any] | None = None) -> dict[str, Any]:`
4. **Add logging:** Replace `print()` with `logging.getLogger(__name__)`
5. **Suppress library noise:** Configure matplotlib to use `Agg` backend (no GUI), suppress Prophet/cmdstanpy logging at module import time

#### New Modules to Add (Tier 2)

Build these 6 new analytical modules alongside the migration:

| Module | Path | Description | Input Data Shape |
|--------|------|-------------|------------------|
| `insights.cash_simulation` | `src/insights/cash_simulation.py` | Monte Carlo simulation of different stocking strategies. Model capital efficiency, show how much cash is tied up in each inventory tier (A/B/C items), and simulate the ROI of reducing stock levels. | Products with `cost_price`, `quantity`, `avg_daily_sales` |
| `insights.procurement_plan` | `src/insights/procurement_plan.py` | Aggregate individual restock recommendations into a procurement plan grouped by supplier. Output: per-supplier order list with quantities, estimated cost, suggested order date. | Products with `supplier_name`, `reorder_point`, `current_stock`, `lead_time_days`, `cost_price` |
| `insights.supplier_analysis` | `src/insights/supplier_analysis.py` | Analyze supplier reliability: actual vs promised delivery times, lead time variability (std dev), on-time delivery rate, average delay. | Delivery records with `supplier_name`, `promised_date`, `actual_date`, `order_value` |
| `forecast.seasonal_detect` | `src/forecasting/seasonal_detect.py` | Auto-detect seasonal cycles in sales data without manual configuration. Use FFT or STL decomposition to find dominant periods (weekly, monthly, quarterly, annual). | Time series with `date`, `amount` (minimum 365 days for annual detection) |
| `insights.stockout_cost` | `src/insights/stockout_cost.py` | Estimate revenue lost from stockouts using demand models. For each stockout event, calculate: days out of stock × average daily demand × selling price. | Products with `stock_history` (dates when stock was zero), `avg_daily_sales`, `selling_price` |
| `insights.sales_velocity` | `src/insights/sales_velocity.py` | Composite scoring: rank products by `(sales_velocity × gross_margin)`. Quadrant analysis: high velocity + high margin = stars, low velocity + low margin = dogs. | Products with `quantity_sold`, `days_in_period`, `selling_price`, `cost_price` |

Each new module follows the same pattern: `def run(data, params, chart_config) -> dict` returning `{ summary, charts?, table? }`.

#### Testing Requirements

Every module must have pytest coverage:

```python
# Example test structure (test_forecasting.py):
import pytest
from src.forecasting.prophet_forecast import run as prophet_run

@pytest.fixture
def sales_data():
    """90 days of synthetic daily sales data."""
    import pandas as pd
    dates = pd.date_range("2025-12-01", periods=90, freq="D")
    return [{"date": d.isoformat(), "amount": 1000 + i * 10 + (i % 7) * 50}
            for i, d in enumerate(dates)]

def test_prophet_forecast_returns_summary(sales_data):
    result = prophet_run(sales_data, {"periods": 14})
    assert "summary" in result
    assert "forecast_periods" in result["summary"]

def test_prophet_forecast_returns_charts(sales_data):
    result = prophet_run(sales_data, {"periods": 14})
    assert "charts" in result
    assert len(result["charts"]) > 0
    chart = result["charts"][0]
    assert chart["format"] == "png"
    assert len(chart["data"]) > 100  # non-trivial base64

def test_prophet_handles_empty_data():
    result = prophet_run([], {"periods": 14})
    assert "error" in result

def test_prophet_handles_insufficient_data():
    result = prophet_run([{"date": "2026-01-01", "amount": 100}], {"periods": 14})
    assert "error" in result
```

**Minimum: one happy-path test + one edge-case test per module. Target: 80%+ coverage.**

#### Dockerfile

```dockerfile
FROM python:3.13-slim AS builder
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

FROM python:3.13-slim
WORKDIR /app
COPY --from=builder /usr/local /usr/local
COPY src/ ./src/
RUN useradd -m -s /bin/bash appuser
USER appuser
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD curl -f http://localhost:8000/health || exit 1
CMD ["uvicorn", "src.app:app", "--host", "0.0.0.0", "--port", "8000"]
```

#### Done Criteria

- [ ] All 25 existing modules migrated and passing tests
- [ ] 6 new Tier 2 modules implemented and passing tests
- [ ] `POST /analyze` endpoint handles all 31 action types
- [ ] `docker-compose up` starts service on localhost:8000
- [ ] `docker-compose run test` runs full pytest suite
- [ ] No sandbox-specific code in any Python module
- [ ] README.md documents local setup, testing, and deployment

---

### Agent 2 — TypeScript Integration Layer

> **Copy everything from this heading to the next `---` into a Claude Code session.**

#### Identity

You are refactoring the TypeScript analytics bridge (`src/lib/analytics.ts`) to call a shared Python FastAPI microservice via HTTP instead of executing Python in ephemeral Agentuity sandboxes. You must maintain backward compatibility — if the microservice URL is not configured, the existing sandbox path continues to work.

#### What Exists Today

**Read these files completely before making any changes:**

1. **`src/lib/analytics.ts`** (~577 lines) — The analytics bridge. Key function: `runAnalytics(sandboxApi, request, kv?)`. Currently:
   - Gets analytics config from DB (category-specific params)
   - Assembles 25 Python files from `analytics-scripts.ts` as `Buffer` objects
   - Builds `input.json` with action, data, params, chartConfig
   - Calls `sandboxApi.run({ command: { exec: ["python3", "main.py"], files: [...] }, snapshot: snapshotId, ... })`
   - Strips timestamp prefixes from sandbox stdout lines
   - Joins all lines, extracts outermost JSON object, sanitizes NaN/Infinity, parses
   - Returns `AnalyticsResult` (defined in same file, lines ~100-160)

2. **`src/lib/analytics-scripts.ts`** (~4200 lines) — Python code as TypeScript template literal exports. Will be deprecated but must remain functional as sandbox fallback.

3. **`src/services/type-registry.ts`** — Defines analysis types with display names, descriptions, SQL query templates, data-fetch instructions. Used by insights-analyzer and report-generator agents.

4. **`src/lib/analytics-queries.ts`** — TypeScript functions that query the database for analytics data. E.g., `fetchSalesData(db, dateRange)`, `fetchInventoryWithTransactions(db)`.

5. **`src/lib/analytics-metrics.ts`** — Execution metrics tracking (action type, duration, success rate, stored in KV).

6. **`src/agent/insights-analyzer/`** — Agent that calls `runAnalytics()`. **Do not change its code** — just ensure `runAnalytics()` still works the same.

7. **`src/agent/data-science/tools/sandbox.ts`** — LLM ad-hoc sandbox tool. Uses `executeSandbox()` from `src/lib/sandbox.ts`. **DO NOT TOUCH THIS FILE OR `src/lib/sandbox.ts`**. This is a completely separate code path for untrusted LLM-generated code.

#### What You Must Build

**Task 1: Add HTTP client path in `src/lib/analytics.ts`**

```typescript
// New env var:
const ANALYTICS_SERVICE_URL = process.env.ANALYTICS_SERVICE_URL; // e.g., "https://analytics.example.com"

export async function runAnalytics(
  sandboxApi: ...,  // keep same signature
  request: AnalyticsRequest,
  kv?: KVStore
): Promise<AnalyticsResult> {
  // NEW: If microservice URL is configured, use HTTP path
  if (ANALYTICS_SERVICE_URL) {
    return runAnalyticsViaService(request, kv);
  }
  // EXISTING: Fall back to sandbox execution (unchanged)
  return runAnalyticsViaSandbox(sandboxApi, request, kv);
}
```

The `runAnalyticsViaService()` function:
- POST to `${ANALYTICS_SERVICE_URL}/analyze`
- Body: `{ action, data, params: { ...categoryConfig, ...overrideParams }, chart_config: chartConfig }`
- Headers: `Content-Type: application/json`
- Timeout: 60 seconds (configurable via `ANALYTICS_TIMEOUT_MS` env var)
- Retry: 3 attempts with exponential backoff (1s, 2s, 4s) on 5xx or network error
- Circuit breaker: after 5 consecutive failures, fail-fast for 30 seconds before retrying
- Parse response as `AnalyticsResult`
- Log execution metrics to KV (same as current sandbox path)
- On permanent failure: return `{ success: false, error: "Analytics service unavailable" }`

The `runAnalyticsViaSandbox()` function:
- Extract the EXISTING sandbox execution logic (unchanged)
- This is the fallback for when `ANALYTICS_SERVICE_URL` is not set

**Task 2: Add new `AnalyticsAction` types**

Add to the `AnalyticsAction` union type:
```typescript
| "insights.cash_simulation"
| "insights.procurement_plan"
| "insights.supplier_analysis"
| "forecast.seasonal_detect"
| "insights.stockout_cost"
| "insights.sales_velocity"
```

**Task 3: Update `src/services/type-registry.ts`**

Add analysis type entries for each new action. Follow the existing pattern — each has:
- `name`: Display name
- `description`: What it does
- `action`: The `AnalyticsAction` string
- `category`: The analytics category
- `requiredData`: Description of SQL data needed
- `dataFetchInstructions`: Instructions for the report-generator agent on how to query data

**Task 4: Add data queries in `src/lib/analytics-queries.ts`**

Add query functions for new modules:
- `fetchCashInStockData(db)` — products with cost_price, quantity, avg daily sales
- `fetchProcurementData(db)` — products with supplier info, reorder points, lead times
- `fetchSupplierPerformanceData(db)` — delivery records (if supplier tables exist; if not, return empty with a comment noting the dependency)
- `fetchStockoutHistory(db)` — stock level snapshots showing zero-stock periods
- `fetchSalesVelocityData(db, dateRange)` — products with sales volume and margins

#### Contracts

These types are the API contract between Agent 1 (Python) and Agent 2 (TypeScript). They already exist in `src/lib/analytics.ts` — do NOT change their shape:

```typescript
interface AnalyticsRequest {
  action: AnalyticsAction;
  data: Record<string, unknown>[];
  params?: Record<string, unknown>;
}

interface AnalyticsResult {
  success: boolean;
  summary?: Record<string, unknown>;
  charts?: AnalyticsChart[];
  table?: { columns: string[]; rows: Record<string, unknown>[] };
  error?: string;
  traceback?: string;
  meta?: { sandboxId?: string; durationMs?: number; dataRowCount: number; action: AnalyticsAction };
}

interface AnalyticsChart {
  title: string;
  format: "png" | "svg";
  data: string;  // base64
  width: number;
  height: number;
}
```

#### Done Criteria

- [ ] `runAnalytics()` routes to HTTP when `ANALYTICS_SERVICE_URL` is set
- [ ] `runAnalytics()` falls back to sandbox when URL is NOT set
- [ ] Retry logic with exponential backoff on HTTP path
- [ ] Circuit breaker pattern on HTTP path
- [ ] 6 new action types added to `AnalyticsAction`
- [ ] Type registry entries for all new actions
- [ ] Data query functions for new modules
- [ ] Execution metrics logged for both paths
- [ ] All existing callers (`insights-analyzer`, `report-generator`) work without changes
- [ ] `sandbox.ts` and `data-science/tools/sandbox.ts` are UNTOUCHED

---

### Agent 3 — Frontend BI Dashboard

> **Copy everything from this heading to the next `---` into a Claude Code session.**

#### Identity

You are transforming the frontend from a CRUD inventory management app into a BI analytics dashboard. The primary user experience should be interactive data visualization and AI-powered insights, not data entry forms.

#### What Exists Today

**Read before starting:**

1. **`src/web/pages/DashboardPage.tsx`** — Current dashboard with summary cards and basic SVG charts (LineChart, BarChart, PieChart defined in `src/web/components/charts/`)
2. **`src/web/components/PredictiveAnalytics.tsx`** (~500 lines) — Forecast results display: tables, summary cards, insight boxes, chart images (base64 PNG from Python)
3. **`src/web/pages/ReportsPage.tsx`** — AI-generated reports rendered as markdown → HTML
4. **`src/web/hooks/useChatStream.ts`** — Chat hook for AI assistant (SSE streaming)
5. **`src/web/styles/global.css`** — Global stylesheet
6. **`src/web/components/charts/`** — LineChart, BarChart, PieChart (pure SVG, no library)
7. **`src/web/lib/markdown.tsx`** — Shared markdown renderer (used in chat + reports)

**Tech constraints:**
- React 19 (no class components)
- No component library (Tailwind, MUI, etc.) — uses CSS modules + global CSS
- Bundle must stay small — Agentuity deploys frontend via Vite
- Mobile-responsive (existing pattern: hamburger sidebar, touch targets)
- Auth: JWT-based, RBAC (super_admin, admin, manager, staff, viewer)
- API pattern: `useAPI()` hook from `@agentuity/react`

#### What You Must Build

**1. BI Dashboard Overhaul (`src/web/pages/DashboardPage.tsx`)**

Replace the current dashboard with a BI-first layout:

```
┌───────────────────────────────────────────────────────────┐
│  [Date Range: 7d ▾]  [Compare: vs prev period ▾]         │
├───────────────────────────────────────────────────────────┤
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐    │
│  │ Revenue  │  │ Orders   │  │ Avg Cart │  │ Margin   │    │
│  │ KES 1.2M │  │ 342      │  │ KES 3.5K │  │ 34.2%    │    │
│  │ ▲ +12.5% │  │ ▲ +8.3%  │  │ ▼ -2.1%  │  │ ▲ +1.8%  │    │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘    │
├───────────────────────────────┬───────────────────────────┤
│  Revenue Trend (area chart)   │  Top Categories (bar)     │
│  with moving average overlay  │  with drill-down on click  │
├───────────────────────────────┼───────────────────────────┤
│  Product Performance          │  Alerts & Insights        │
│  (scatter: margin vs volume)  │  ⚠ 5 items need restock  │
│                               │  📈 Sales spike: Widget X │
│                               │  📉 Shrinkage: Category Y │
└───────────────────────────────┴───────────────────────────┘
```

- KPI cards show value + period-over-period change (▲/▼ with green/red)
- Date range picker with presets: Today, 7d, 30d, 90d, YTD, Custom
- Comparison mode: vs previous period, vs same period last year
- Charts: built with SVG (enhance existing chart components, or add lightweight recharts if needed — check bundle impact first)

**2. Analytics Explorer Page (`src/web/pages/AnalyticsPage.tsx` — NEW)**

A self-service analytics page where users can run any analysis type:

- Left panel: analysis type selector (cards with icons + descriptions)
- Top: parameter controls (date range, product/category filter, warehouse filter)
- Center: results area (summary cards + charts + data table)
- "Run Analysis" button → loading spinner → results appear
- Export: "Download PDF" button (uses existing `@react-pdf/renderer` engine)

Analysis types to show (from type-registry):
- Demand Forecast, Anomaly Detection, Restock Recommendations, ABC-XYZ Classification
- RFM Segmentation, CLV Prediction, Bundle Detection, Shrinkage Analysis
- (New Tier 2): Cash Simulation, Procurement Plan, Sales Velocity, Seasonal Detection

**3. Interactive Chart Upgrades (`src/web/components/charts/`)**

Enhance existing SVG charts or add new ones:
- Tooltips on hover (show exact value, date, percentage)
- Click handler on chart elements (for drill-down navigation)
- Area chart with gradient fill (for revenue trends)
- Stacked bar chart (for category breakdown over time)
- Heatmap grid (for day-of-week × hour-of-day sales intensity)

**4. Drill-Down Navigation Pattern**

When a user clicks a chart element:
- Dashboard → Category detail view (filtered to that category)
- Category → Product list (sorted by the metric they clicked)
- Product → Product detail with historical trend + forecast
- Breadcrumb trail: `Dashboard > Electronics > Widget X > Forecast`

Use URL query params for filter state (shareable links):
`/dashboard?category=electronics&dateRange=30d`

**5. Alerts & Insights Sidebar**

A collapsible sidebar panel showing real-time business alerts:
- Restock urgency (critical = red, high = orange, medium = yellow)
- Anomaly alerts (unusual spikes or drops)
- Shrinkage warnings
- Slow-moving stock flags
- Each alert is clickable → navigates to relevant analysis

Badge count on the sidebar toggle button.

#### Done Criteria

- [ ] BI dashboard with KPI cards showing trend direction
- [ ] Date range picker with presets
- [ ] Period comparison (vs previous period)
- [ ] At least 4 chart types working with tooltips
- [ ] Analytics Explorer page with analysis type selection + results display
- [ ] Drill-down navigation from dashboard → category → product
- [ ] Alerts sidebar with clickable alerts
- [ ] Mobile-responsive layout
- [ ] No breaking changes to existing pages

---

### Agent 4 — Data Pipeline & Connectors

> **Copy everything from this heading to the next `---` into a Claude Code session.**

#### Identity

You are building the data ingestion layer that makes Business IQ Enterprise work as a "plug-in intelligence" platform. Clients keep their existing POS/ERP systems and connect them to BIQ for analytics. Your job is to build the plumbing that receives, normalizes, and stores external data.

#### What Exists Today

**Read before starting:**

1. **`src/db/schema.ts`** — Full database schema. Key tables: `products`, `orders`, `orderItems`, `customers`, `categories`, `inventory`, `warehouses`, `inventoryTransactions`. Note the `metadata` JSONB columns on products, orders, customers — these store arbitrary external attributes.
2. **`src/agent/data-import/`** — Existing data import agent (basic CSV import)
3. **`src/services/products.ts`** — Product CRUD service
4. **`src/services/orders.ts`** — Order CRUD service
5. **`src/services/customers.ts`** — Customer CRUD service
6. **`src/services/inventory.ts`** — Inventory management service
7. **`src/api/`** — Existing Hono route files (pattern: `createRouter()` from `@agentuity/runtime`)

**Architecture context:**
- Single-tenant: each client has their own DB (no tenant_id columns)
- Platform: Agentuity (Hono-based routes, Drizzle ORM, Bun runtime)
- Routes use `createRouter()` from `@agentuity/runtime`, NOT `new Hono()`
- Middleware: auth middleware on protected routes
- Config: env vars for all client-specific settings

#### What You Must Build

**1. Connector Framework (`src/services/connectors/`)**

```typescript
// src/services/connectors/types.ts
export interface DataConnector {
  /** Unique connector type identifier */
  type: string;  // "csv", "webhook", "rest_api", "square", "mpesa"

  /** Display name for UI */
  displayName: string;

  /** Test connection / validate config */
  validate(config: ConnectorConfig): Promise<{ valid: boolean; error?: string }>;

  /** Pull data from source, normalize, and upsert into DB */
  sync(config: ConnectorConfig, options?: SyncOptions): Promise<SyncResult>;
}

export interface ConnectorConfig {
  type: string;
  /** Connection-specific settings (URL, API key, file path, etc.) */
  settings: Record<string, unknown>;
  /** Column/field mapping: external field name → internal field name */
  fieldMapping?: Record<string, string>;
  /** Last successful sync timestamp */
  lastSyncAt?: Date;
}

export interface SyncResult {
  success: boolean;
  recordsProcessed: number;
  recordsCreated: number;
  recordsUpdated: number;
  recordsSkipped: number;
  errors: Array<{ row: number; field: string; error: string }>;
  syncedAt: Date;
}

// src/services/connectors/registry.ts
// - registerConnector(connector: DataConnector)
// - getConnector(type: string): DataConnector
// - listConnectors(): DataConnector[]
```

**2. Data Normalization Layer (`src/services/normalizer.ts`)**

Every external data source goes through normalization before DB insert:

```typescript
export interface NormalizedProduct {
  name: string;
  sku?: string;
  categoryName?: string;  // Resolved to category ID during insert
  costPrice?: number;
  sellingPrice?: number;
  unit?: string;
  metadata: Record<string, unknown>;  // Store ALL raw external fields here
  externalId?: string;  // External system's ID (for sync reconciliation)
  externalSource?: string;  // Which connector provided this
}

// Similar for NormalizedOrder, NormalizedCustomer, NormalizedInventoryAdjustment

export function normalizeProduct(raw: Record<string, unknown>, fieldMapping: Record<string, string>): NormalizedProduct;
export function normalizeOrder(raw: Record<string, unknown>, fieldMapping: Record<string, string>): NormalizedOrder;
export function normalizeCustomer(raw: Record<string, unknown>, fieldMapping: Record<string, string>): NormalizedCustomer;
```

Key rules:
- Map external field names to internal using `fieldMapping` config
- Auto-detect common patterns: "product_name" / "item_name" / "name" → `name`
- Store unmapped fields in `metadata` JSONB (nothing is lost)
- Preserve `externalId` for future sync reconciliation
- Handle unit conversions if `unitMapping` config is provided

**3. CSV/Excel Connector Enhancement (`src/services/connectors/csv.ts`)**

Enhance the existing data-import agent's CSV capability:
- Smart column auto-detection (fuzzy match column headers to internal fields)
- Preview endpoint: parse first 10 rows, return detected mapping for user confirmation
- Batch insert: process in chunks of 100 rows (don't load all into memory)
- Conflict resolution: configurable (skip, overwrite, merge) per field
- Progress tracking: emit progress events (for UI loading bar)

**4. Webhook Receiver (`src/api/webhooks.ts`)**

```typescript
// POST /api/webhooks/:source
// Example: POST /api/webhooks/square
// Headers: X-Webhook-Signature: <HMAC-SHA256 signature>
// Body: { event_type: "sale_created", data: { ... } }

// Route handler:
// 1. Verify signature (config per source: WEBHOOK_SECRET_SQUARE, etc.)
// 2. Parse event type
// 3. Normalize data through normalizer
// 4. Upsert into appropriate table
// 5. Return 200 (idempotent: dedupe by externalId)
```

Event types to handle:
- `sale_created` / `order_created` → normalize → insert into `orders` + `orderItems`
- `product_updated` → normalize → upsert into `products`
- `inventory_adjusted` → normalize → insert into `inventoryTransactions`
- `customer_created` / `customer_updated` → normalize → upsert into `customers`

**5. Sync Status Tracking**

Add a `data_syncs` table (or use KV) to track sync history:
- connector type, last sync time, records synced, errors, status (success/failed/in_progress)
- API endpoint: `GET /api/admin/syncs` — list sync history
- API endpoint: `POST /api/admin/syncs/:connector/now` — trigger manual sync

**6. DB Schema Additions**

Add columns to existing tables if not present (check `src/db/schema.ts` first):
- `products.externalId` (varchar, nullable, indexed) — external system's product ID
- `products.externalSource` (varchar, nullable) — which connector provided this
- `orders.externalId` + `orders.externalSource` — same pattern
- `customers.externalId` + `customers.externalSource`

If these already exist in `metadata` JSONB, that's fine — but having indexed columns makes sync reconciliation queries fast.

#### Done Criteria

- [ ] Connector framework with registry pattern
- [ ] Data normalization layer with auto-detection
- [ ] CSV connector with column auto-mapping and batch insert
- [ ] Webhook receiver with signature verification and idempotency
- [ ] At least one provider-specific example (e.g., generic REST connector)
- [ ] Sync status tracking with API endpoints
- [ ] `externalId` column on products/orders/customers (via Drizzle migration)
- [ ] All imported data goes through normalization (never raw insert)

---

## 7. Coordination Rules

### Shared Contracts (Do Not Break)

| Contract | Owner | Consumers |
|----------|-------|-----------|
| `POST /analyze` request/response schema | Agent 1 | Agent 2 |
| `AnalyticsResult` / `AnalyticsAction` types | Agent 2 | Agent 1, Agent 3 |
| DB schema (`src/db/schema.ts`) | Agent 4 | All agents |
| API route patterns (`/api/*`) | All | Agent 3 (frontend) |

### Execution Order

```
1. Agent 1 FIRST  — Python service is standalone, zero conflicts with existing code
2. Agent 4 SECOND — Data pipeline adds new services/routes + possible schema migration
3. Agent 2 THIRD  — Integration layer depends on Agent 1's /analyze API contract
4. Agent 3 LAST   — Frontend depends on all backend APIs being stable
```

### Branch Strategy

```
main (protected)
├── feat/analytics-service    (Agent 1)
├── feat/data-pipeline        (Agent 4)
├── feat/integration-refactor (Agent 2)
└── feat/bi-frontend          (Agent 3)
```

---

## 8. Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Analytics latency (P95) | 8-15s (sandbox) | <2s (microservice) |
| Analytics modules | 25 | 31 (+6 Tier 2) |
| Python test coverage | 0% | 80%+ |
| Data connectors | 1 (CSV manual) | 4+ (CSV auto, webhook, REST, M-Pesa) |
| Client onboarding time | Manual seed scripts | <1 week with connector |
| Time to first insight | N/A | <24 hours after data connection |

---

## Appendix: Files to Read Before Starting

### For All Agents
- `ROADMAP.md` — Full project roadmap and history
- `.github/copilot-instructions.md` — Project conventions, build/deploy workflow, architecture rules
- `src/db/schema.ts` — Complete database schema
- `agentuity.json` — Agentuity project config
- `BI-PIVOT.md` — This document (for strategic context)

### Agent 1 (Python Service)
- `scripts/analytics/` — ALL Python source files (canonical code to migrate)
- `scripts/analytics/main.py` — Current dispatcher logic
- `src/lib/analytics.ts` lines 100-160 — TypeScript types that define the API contract
- `src/lib/analytics-scripts.ts` — Embedded Python (reference only — shows what's being replaced)
- `docs/PYTHON-PREDICTIVE-ANALYTICS-ROADMAP.md` — Planned modules and algorithms

### Agent 2 (TypeScript Integration)
- `src/lib/analytics.ts` — **ENTIRE FILE** — you're refactoring this
- `src/lib/analytics-scripts.ts` — Exists as sandbox fallback (don't delete)
- `src/lib/analytics-queries.ts` — Data fetching functions (you're adding new ones)
- `src/lib/analytics-metrics.ts` — Execution metrics (must work on both paths)
- `src/services/type-registry.ts` — Analysis type definitions (you're adding entries)
- `src/agent/insights-analyzer/` — Calls `runAnalytics()` (read to understand caller)
- `src/agent/data-science/tools/sandbox.ts` — **DO NOT TOUCH** (LLM sandbox tool)
- `src/lib/sandbox.ts` — **DO NOT TOUCH** (LLM sandbox execution)

### Agent 3 (Frontend)
- `src/web/pages/` — All current pages
- `src/web/components/` — All components (especially `charts/`, `PredictiveAnalytics.tsx`)
- `src/web/hooks/` — Custom hooks (`useAPI`, `useChatStream`, etc.)
- `src/web/styles/global.css` — Global styles
- `src/web/lib/markdown.tsx` — Shared markdown renderer

### Agent 4 (Data Pipeline)
- `src/db/schema.ts` — **ENTIRE FILE** — understand every table before adding columns
- `src/agent/data-import/` — Existing import agent (enhance, don't rewrite)
- `src/services/` — ALL service files (understand existing patterns)
- `src/api/` — ALL route files (understand Hono + `createRouter()` pattern)
- `demo/seed-demo.ts` — See how demo data is structured and inserted
