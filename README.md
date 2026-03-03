# BIQ Analytics

**AI-powered Business Intelligence platform that plugs into any POS or ERP system.**

BIQ Analytics is an agentic BI platform that connects to your existing business systems, transforms raw transaction data into AI-powered forecasts, anomaly detection, customer intelligence, and board-quality reports. No migration. No disruption. Just smarter decisions.

Built on the [Agentuity](https://agentuity.dev) platform with a shared [FastAPI analytics microservice](analytics-service/), it deploys as a single-tenant application — one dedicated instance per client with isolated compute, storage, and configuration.

**Developed by [Ruskins AI Consulting LTD](https://ruskins.ai) © 2026**

---

## What BIQ Analytics Does

BIQ Analytics is **the AI brain behind your business**. It sits on top of your existing systems and delivers:

- **Demand Forecasting** — Prophet (with Kenyan holiday calendar), ARIMA, Holt-Winters, seasonal detection
- **Inventory Intelligence** — ABC-XYZ classification, safety stock + EOQ optimization, dead stock identification, shrinkage detection
- **Customer Analytics** — RFM segmentation, CLV prediction (BG/NBD + Gamma-Gamma), churn risk, bundle detection
- **Anomaly Detection** — IsolationForest for transaction anomalies, statistical shrinkage detection
- **Financial Insights** — Cash-in-stock simulation, stockout cost estimation, procurement planning, supplier analysis, sales velocity
- **Natural Language Chat** — Ask your data questions in plain English and get AI-narrated answers
- **Board-Quality Reports** — AI-generated PDF/XLSX/PPTX reports with inline charts and executive narratives
- **9 Chart Types** — Sales trends, heatmaps, scatter plots, treemaps, Pareto, waterfall, forecast plots, geo maps, rendered composites

### What BIQ Analytics Is NOT

| Not This | Why |
|----------|-----|
| **ERP** | We don't replace your business systems — we make them smarter |
| **POS** | We don't handle transactions — we analyze them |
| **Accounting Software** | We don't do bookkeeping — we surface financial insights |

---

## Platform Status

| Layer | State |
|-------|-------|
| Platform foundation (Agentuity + Neon Postgres + React 19) | ✅ Production-ready |
| 7 Agentuity agents (orchestrated) | ✅ Live |
| 27 Python analytics modules (FastAPI microservice) | ✅ Railway-ready |
| BI frontend (Dashboard, Analytics Explorer, Reports, Assistant) | ✅ Complete |
| Data connectors + webhooks (CSV, REST, webhook framework) | ✅ Framework live |
| M-Pesa / Paystack payment adapters | ⚠️ Adapters built, live API wiring pending |
| KRA eTIMS compliance | ⚠️ Types + routes built, live API wiring pending |
| Action agents (Restock, Collection, Digest, Anomaly Response) | 🔲 Next phase |
| Email / WhatsApp output channels | 🔲 Planned |

---

## Architecture

```
External Systems (POS / ERP / M-Pesa / Paystack / eTIMS)
        │ webhooks + connectors
        ▼
┌─────────────────────────────────────────────────────────────────┐
│  Agentuity Cloud (per client)                                   │
│                                                                 │
│  ┌─────────────┐  ┌──────────────────┐  ┌───────────────────┐  │
│  │  Frontend   │  │   API Routes     │  │    AI Agents      │  │
│  │  (React 19) │  │   (Hono-based)   │  │                   │  │
│  │             │  │                  │  │  data-science     │  │
│  │  Dashboard  │──▶  /api/admin      │──▶  insights-analyzer│  │
│  │  Analytics  │  │  /api/chat       │  │  report-generator │  │
│  │  Explorer   │  │  /api/reports    │  │  knowledge-base   │  │
│  │  Reports    │  │  /api/config     │  │  scheduler        │  │
│  │  Assistant  │  │  /api/webhooks   │  │  document-scanner │  │
│  │             │  │  /api/health     │  │  data-import      │  │
│  └─────────────┘  └────────┬─────────┘  └────────┬──────────┘  │
│                            │                     │              │
│                            ▼                     │              │
│                   ┌──────────────────┐            │              │
│                   │  Neon Postgres   │            │              │
│                   │  (dedicated DB)  │            │              │
│                   └──────────────────┘            │              │
│                                                   │              │
│        ┌──────────┐  ┌─────────┐  ┌───────────┐ │              │
│        │ KV Store │  │ Vector  │  │ Object    │ │              │
│        └──────────┘  └─────────┘  └───────────┘ │              │
└──────────────────────────────────────────────────│──────────────┘
                                                   │
                              ┌─────────────────────▼──────────────┐
                              │  Railway (shared across clients)   │
                              │  analytics-service (FastAPI)       │
                              │  27 Python modules                 │
                              │  ~$10-15/mo flat                   │
                              └────────────────────────────────────┘
```

### Layers

| Layer | Technology | Location |
|-------|-----------|----------|
| **Frontend** | React 19, Vite, `@agentuity/react` hooks | `src/web/` |
| **API Routes** | Hono-based routers via `@agentuity/runtime` | `src/api/` |
| **AI Agents** | 7 Agentuity agents with Vercel AI SDK | `src/agent/` |
| **Services** | Business logic, connectors, normalization | `src/services/` |
| **Database** | Neon Postgres via Drizzle ORM | `src/db/` |
| **Analytics Engine** | FastAPI + 27 Python modules (Prophet, scikit-learn, statsmodels) | `analytics-service/` |
| **Storage** | KV, Vector, and Object stores via Agentuity SDK | Agent runtime |

---

## Tech Stack

### Runtime & Language
- **Runtime:** [Bun](https://bun.sh) — fast JavaScript runtime, bundler, and package manager
- **Language:** TypeScript 5.x (strict mode)
- **Analytics:** Python 3.13 (FastAPI microservice)

### Frontend
- **Framework:** [React 19](https://react.dev)
- **Build Tool:** [Vite](https://vitejs.dev) (integrated into Agentuity CLI)
- **State & Data:** `@agentuity/react` hooks — `useAPI`, `useWebsocket`, `useEventStream`
- **Styling:** Custom CSS (`src/web/styles/`)

### Backend
- **Platform:** [Agentuity](https://agentuity.dev) — AI agent hosting with built-in routing, storage, and deployment
- **Routing:** Hono-based HTTP routers via `createRouter()` from `@agentuity/runtime`
- **Validation:** [Zod](https://zod.dev) schemas for request/response validation

### AI & Intelligence
- **SDK:** [Vercel AI SDK v4](https://sdk.vercel.ai) (`ai` package)
- **Providers:** OpenAI, Anthropic (Claude), Groq — routed through AI Gateway
- **Agents:** 7 specialized AI agents with typed input/output schemas

### Analytics Engine
- **Framework:** [FastAPI](https://fastapi.tiangolo.com/) with Pydantic validation
- **Forecasting:** Prophet (with Kenyan holidays), ARIMA, SARIMA, Holt-Winters
- **ML / Statistics:** scikit-learn (IsolationForest), statsmodels, scipy, lifetimes (BG/NBD + Gamma-Gamma)
- **Visualization:** Matplotlib, Seaborn, Plotly, Vega-Lite
- **Containerized:** Docker with CmdStan pre-compiled for Prophet

### Database & Storage
- **Database:** [Neon Postgres](https://neon.tech) — serverless Postgres, one database per client
- **ORM:** [Drizzle ORM](https://orm.drizzle.team) 0.45.x via `@agentuity/drizzle`
- **Migrations:** `drizzle-kit` for schema generation and migration
- **Additional Storage:** Agentuity KV store, Vector store (semantic search), Object store

### Deployment
- **Platform:** Agentuity CLI (`agentuity deploy`) for the main app
- **Analytics:** Railway (Docker) for the shared Python microservice
- **Build:** Vite (frontend) + Bun bundler (server) — hybrid build system
- **Environment:** WSL (Ubuntu 24.04) for builds and deploys from Windows

---

## 27 Analytics Modules

### Charts (9)
`sales_trends` · `heatmap` · `scatter` · `treemap` · `pareto` · `waterfall` · `forecast_plot` · `geo_map` · `render_chart`

### Forecasting (5)
`prophet_forecast` (Kenyan holidays) · `arima` · `holt_winters` · `safety_stock` (+ EOQ) · `seasonal_detect`

### Classification (4)
`abc_xyz` · `rfm` (segmentation) · `clv` (BG/NBD + Gamma-Gamma) · `bundles` (Apriori/FP-Growth)

### Anomaly Detection (2)
`isolation_forest` (transactions) · `shrinkage` (statistical)

### Business Insights (7)
`value_gap` · `dead_stock` · `cash_simulation` (Monte Carlo) · `procurement_plan` · `supplier_analysis` · `stockout_cost` · `sales_velocity`

---

## AI Agents

| Agent | Purpose |
|-------|---------|
| **data-science** | Orchestrator — routes analytics queries to the right module, manages conversation context |
| **insights-analyzer** | Runs Python analytics (sandbox for ad-hoc, microservice for production modules) |
| **report-generator** | AI-narrated PDF/XLSX/PPTX reports with inline charts and executive summaries |
| **knowledge-base** | RAG — document ingestion, vector embeddings, semantic search and retrieval |
| **scheduler** | Cron-driven automation — scheduled reports, alerts, recurring analytics jobs |
| **document-scanner** | Multimodal OCR, barcode extraction, invoice parsing |
| **data-import** | CSV/REST/webhook data ingestion with auto field-detection and normalization |

Agents communicate via typed Zod schemas and can call each other cross-agent. The data-science agent orchestrates the others to answer complex analytical questions.

---

## Project Structure

```
biq-analytics/
├── agentuity.json              # Agentuity project config
├── agentuity.config.ts         # Build-time config (frontend env vars, Vite)
├── app.ts                      # App entry point (createApp lifecycle)
├── package.json                # Dependencies and scripts
├── tsconfig.json               # TypeScript configuration
├── drizzle.config.ts           # Drizzle ORM migration config
│
├── analytics-service/          # Python analytics microservice
│   ├── Dockerfile              #   Docker build (CmdStan + Prophet)
│   ├── docker-compose.yml      #   Local dev compose
│   ├── railway.toml            #   Railway deployment config
│   ├── requirements.txt        #   Python dependencies
│   ├── pyproject.toml          #   Python project config
│   ├── src/
│   │   ├── app.py              #   FastAPI entrypoint + /analyze route
│   │   ├── config.py           #   Service configuration
│   │   ├── dispatcher.py       #   Routes actions → modules
│   │   ├── models.py           #   Pydantic request/response models
│   │   ├── validation.py       #   Input validation
│   │   ├── charts/             #   9 chart modules
│   │   ├── forecasting/        #   5 forecasting modules
│   │   ├── classification/     #   4 classification modules
│   │   ├── anomaly/            #   2 anomaly detection modules
│   │   └── insights/           #   7 business insight modules
│   └── tests/                  #   pytest suite
│
├── src/
│   ├── agent/                  # AI Agents (auto-discovered at build time)
│   │   ├── data-science/       #   Analytics orchestrator
│   │   ├── insights-analyzer/  #   Python analytics runner
│   │   ├── report-generator/   #   AI report generation
│   │   ├── knowledge-base/     #   RAG + vector search
│   │   ├── scheduler/          #   Cron automation
│   │   ├── document-scanner/   #   OCR + barcode
│   │   └── data-import/        #   Data ingestion
│   │
│   ├── api/                    # HTTP API Routes (Hono-based)
│   │   ├── admin.ts            #   /api/admin (stats, users, config)
│   │   ├── chat.ts             #   /api/chat (AI assistant)
│   │   ├── config.ts           #   /api/config, /api/health
│   │   ├── reports.ts          #   /api/reports (AI reports)
│   │   ├── webhooks.ts         #   /api/webhooks (M-Pesa, Paystack, generic)
│   │   └── ...                 #   Additional CRUD routes
│   │
│   ├── db/                     # Database Layer
│   │   ├── schema.ts           #   Drizzle schema (53+ tables)
│   │   ├── migrations/         #   SQL migration files
│   │   └── index.ts            #   Database connection
│   │
│   ├── services/               # Business Logic Layer
│   │   ├── connectors/         #   Data connector framework
│   │   │   ├── csv.ts          #     CSV import with auto-mapping
│   │   │   ├── rest.ts         #     Generic REST connector
│   │   │   ├── registry.ts     #     Connector registry pattern
│   │   │   └── types.ts        #     Connector interfaces
│   │   ├── normalizer.ts       #   Auto field-detection + data normalization
│   │   ├── type-registry.ts    #   Analytics type registry (all 27 modules)
│   │   └── ...                 #   Additional service modules
│   │
│   ├── lib/                    # Shared Utilities
│   │   ├── ai.ts               #   AI provider configuration
│   │   ├── analytics.ts        #   HTTP bridge to analytics microservice
│   │   ├── analytics-queries.ts#   SQL query builders for analytics data
│   │   ├── config.ts           #   Environment-driven app config
│   │   └── ...                 #   Errors, pagination, validation, chunker
│   │
│   ├── web/                    # Frontend (React 19 + Vite)
│   │   ├── App.tsx             #   Main app — routing + layout
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx   #     BI dashboard — KPIs, trends, alerts
│   │   │   ├── AnalyticsPage.tsx#    Analytics Explorer — all 27 modules
│   │   │   ├── ReportsPage.tsx #     AI report generation + export
│   │   │   ├── AssistantPage.tsx#    Natural language analytics chat
│   │   │   └── AdminPage.tsx   #     System administration
│   │   ├── components/
│   │   │   └── Sidebar.tsx     #     Navigation sidebar
│   │   └── styles/             #   CSS stylesheets
│   │
│   ├── types/                  # TypeScript type declarations
│   └── generated/              # Auto-generated by Agentuity CLI (gitignored)
│
├── scripts/                    # Build & utility scripts
├── demo/                       # Seed data & demo configurations
├── docs/                       # Technical documentation
└── .copilot/skills/            # Platform documentation (dev reference only)
```

---

## Data Connector Framework

BIQ Analytics ingests data from external systems — it doesn't require clients to re-enter data manually.

| Connector | Status | Description |
|-----------|--------|-------------|
| **CSV Import** | ✅ Live | Column auto-mapping, batch insert, preview |
| **REST Connector** | ✅ Live | Generic REST API polling |
| **Webhook Receiver** | ✅ Live | HMAC signature verification, idempotency |
| **M-Pesa (Daraja)** | ⚠️ Adapter built | C2B normalization, STK Push, callbacks |
| **Paystack** | ⚠️ Adapter built | Webhook signature verification, payment events |
| **KRA eTIMS** | ⚠️ Routes built | Invoice submission, PIN/TCC validation |

All connectors normalize data through `externalId` + `externalSource` columns, enabling deduplication and source tracking.

---

## Industry-Agnostic Design

The same codebase serves any industry. Configuration is purely through environment variables:

| Variable | Retail | Restaurant | Wholesale | Healthcare |
|----------|--------|-----------|-----------|------------|
| `PRODUCT_LABEL` | Product | Menu Item | Item | Medicine |
| `ORDER_LABEL` | Sales Order | Ticket | Purchase Order | Requisition |
| `CUSTOMER_LABEL` | Customer | Guest | Account | Facility |
| `WAREHOUSE_LABEL` | Store | Kitchen | Depot | Pharmacy |
| `UNIT_DEFAULT` | piece | portion | case | unit |
| `CURRENCY` | KES | USD | EUR | GBP |

No code branches, no industry conditionals, no vertical-specific columns. Same schema, same agents, same frontend — only config changes.

---

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) (v1.3+)
- [Agentuity CLI](https://agentuity.dev) (v1.0+)
- [Docker](https://docker.com) (for analytics-service local dev)
- [WSL Ubuntu 24.04](https://learn.microsoft.com/en-us/windows/wsl/) (for Windows users)

### Quick Start

```bash
# Clone
git clone https://github.com/buddha-maitreya/biq-analytics.git
cd biq-analytics
bun install

# Create project + database
agentuity project create --name "my-company-biq" --database new --no-build
agentuity cloud env pull

# Configure (edit .env with your branding, currency, API keys)

# Deploy
bunx drizzle-kit migrate    # Create database tables
agentuity deploy             # Deploy to Agentuity cloud
```

### Analytics Service (Local Dev)

```bash
cd analytics-service
docker-compose up            # Starts FastAPI on http://localhost:8000
# Test: curl http://localhost:8000/health
```

### Analytics Service (Production — Railway)

```bash
# Deploy analytics-service/ to Railway (Docker)
# Set ANALYTICS_SERVICE_URL in Agentuity environment
# The TypeScript bridge auto-routes analytics calls to the microservice
```

### Development

```bash
agentuity dev               # Start dev server with hot reload
```

### Build & Deploy

```bash
bun run validate            # Pre-deploy checks
agentuity build             # Build
agentuity deploy            # Deploy (from WSL on Windows)
```

---

## Client Deployment Model

Every client gets a fully isolated deployment:

```
┌────────────────────────────────────────────────┐
│  Client: Safari Curio Shop                     │
│                                                │
│  Agentuity Project: safari-curio-biq           │
│  URL: safari-curio-biq.agentuity.run           │
│                                                │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐ │
│  │ Frontend │  │  Server  │  │  7 AI Agents │ │
│  │ (React)  │  │  (Hono)  │  │              │ │
│  └──────────┘  └──────────┘  └──────────────┘ │
│                      │                         │
│                      ▼                         │
│            ┌──────────────────┐                │
│            │  Neon Postgres   │                │
│            │  (dedicated DB)  │                │
│            └──────────────────┘                │
│                      │                         │
│                      ▼                         │
│          ANALYTICS_SERVICE_URL ──────────┐     │
└──────────────────────────────────────────│─────┘
                                           │
                  ┌────────────────────────▼──┐
                  │  Railway (shared)         │
                  │  analytics-service        │
                  │  27 Python modules        │
                  │  ~$10-15/mo total         │
                  └──────────────────────────┘
```

- **Separate compute** — own Agentuity deployment
- **Separate database** — own Neon Postgres instance
- **Separate config** — own environment variables and branding
- **Shared analytics** — the Python microservice is stateless; it receives data, computes, returns results. No client data is stored.

---

## Production Testing Sequence

1. Deploy `analytics-service/` to Railway → get URL
2. Set `ANALYTICS_SERVICE_URL` in Agentuity → deploy main platform
3. Smoke test: Dashboard → Analytics Explorer → Prophet forecast → PDF report
4. Wire eTIMS live API (biggest Kenya differentiator)
5. Wire M-Pesa live API (needed for Collection Agent)
6. Build Weekly Digest Agent (first action agent — lowest risk, highest visible value)

---

## Roadmap

See [ROADMAP.md](ROADMAP.md) for the full phased roadmap. Key upcoming milestones:

- **Phase 6** — Wire live M-Pesa, Paystack, KRA eTIMS API calls (adapters already built)
- **Phase 7** — Action agents: Restock, Collection, Compliance, Weekly Digest, Anomaly Response, CRM Sync
- **Phase 8** — Email (SMTP) + WhatsApp Business API + SMS output channels
- **Phase 9** — Production hardening, security audit, load testing
- **Phase 10** — Advanced BI: multi-period comparison, scheduled delivery, product drill-downs

The action agents in Phase 7 are where BIQ stops being a dashboard and becomes a **business operating system**. That's the real moat.

---

## Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `dev` | `agentuity dev` | Start development server |
| `build` | `bun scripts/build.ts` | Build with Windows path fix |
| `validate` | `bun scripts/pre-deploy.ts` | Pre-deploy validation |
| `deploy` | `bun scripts/build.ts --deploy` | Build + deploy |
| `db:generate` | `bunx drizzle-kit generate` | Generate migration files |
| `db:migrate` | `bunx drizzle-kit migrate` | Run migrations |
| `db:seed` | `bun scripts/seed-demo.ts` | Seed demo data |
| `test` | `bun test` | Run test suite |

---

## License

Private — All rights reserved. © 2026 Ruskins AI Consulting LTD
