# Business IQ Enterprise — Implementation Roadmap

## Inventory & Sales Management Platform

**Runtime:** Bun | **Language:** TypeScript | **Frontend:** React | **Backend:** Agentuity Agents + Hono Routes  
**Database:** Neon Postgres (via `@agentuity/drizzle`) | **AI:** Vercel AI SDK + AI Gateway  
**Platform:** [Agentuity](https://agentuity.dev) — agent-native cloud  
**Architecture:** Single-Tenant (one codebase, dedicated deployment per client)  
**Design:** Industry-Agnostic (same code for retail, wholesale, manufacturing, F&B, healthcare, etc.)

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
### Client Deployment Flow
```
1. Create Agentuity project (or org) for client
2. Provision database: agentuity cloud db create --name "client-db"
   (DATABASE_URL is auto-injected into .env and deployment secrets)
3. Configure env vars / Agentuity secrets:
   COMPANY_NAME, CURRENCY, TAX_RATE, PRODUCT_LABEL, etc.
4. Deploy: agentuity deploy
5. Run migrations: bunx drizzle-kit migrate
```

---

## Phase 0 — Project Bootstrap (Week 1)

### 0.1 Environment Setup
- [ ] Install Agentuity CLI: `curl -sSL https://agentuity.sh | sh`
- [ ] Install Bun runtime: `bun --version` (required by Agentuity)
- [ ] Create project: `agentuity create business-iq-enterprise`
- [ ] Configure `agentuity.json` with org/project IDs
- [ ] Provision Neon Postgres (dev instance): `agentuity cloud db create --name "biq-dev" --description "Dev database"` (DATABASE_URL auto-added to `.env`)
- [ ] Set up `.env` with remaining client configuration variables:
  ```
  # DATABASE_URL is auto-injected by `agentuity cloud db create`
  AGENTUITY_SDK_KEY=      # Client's Agentuity SDK key
  COMPANY_NAME=           # Client's business name (displayed in UI)
  COMPANY_LOGO_URL=       # Client's logo asset URL
  CURRENCY=USD            # Currency code (USD, EUR, GBP, etc.)
  TAX_RATE=0.0            # Default tax rate (decimal)
  TIMEZONE=UTC            # Client's timezone
  LLM_PROVIDER_KEY=       # AI API key (OpenAI/Groq)
  # Industry terminology
  PRODUCT_LABEL=Product
  PRODUCT_LABEL_PLURAL=Products
  ORDER_LABEL=Order
  ORDER_LABEL_PLURAL=Orders
  CUSTOMER_LABEL=Customer
  CUSTOMER_LABEL_PLURAL=Customers
  WAREHOUSE_LABEL=Warehouse
  INVOICE_LABEL=Invoice
  UNIT_DEFAULT=piece
  ```

### 0.2 Core Dependencies
```bash
bun add @agentuity/runtime @agentuity/schema @agentuity/react @agentuity/postgres @agentuity/drizzle
bun add drizzle-orm ai @ai-sdk/openai @ai-sdk/anthropic zod
bun add -D drizzle-kit @agentuity/cli typescript @types/bun
```

### 0.3 Database Schema (Drizzle ORM)
- [ ] Define core tables: `products`, `categories`, `inventory`, `warehouses` — all with `metadata` JSONB column
- [ ] Define sales tables: `customers`, `orders`, `order_items`, `invoices` — all with `metadata` JSONB column
- [ ] Define system tables: `users`, `roles`, `audit_log`, `notifications`
- [ ] Define config tables: `order_statuses`, `tax_rules` (data-driven workflows, not hardcoded enums)
- [ ] Products use free-form `unit` field (varchar) — no hardcoded unit enums
- [ ] Generate and run migrations: `bunx drizzle-kit generate && bunx drizzle-kit migrate`

---

## Phase 1 — Core Inventory Module (Weeks 2–3)

### 1.1 Agents
| Agent | Path | Purpose |
|-------|------|---------|
| `product-manager` | `src/agent/product-manager/` | CRUD operations for products |
| `inventory-tracker` | `src/agent/inventory-tracker/` | Stock levels, movements, alerts |
| `category-manager` | `src/agent/category-manager/` | Product categorization |
| `warehouse-manager` | `src/agent/warehouse-manager/` | Multi-warehouse support |
| `barcode-scanner` | `src/agent/barcode-scanner/` | SKU/barcode generation + lookup |

### 1.2 API Routes
- [ ] `POST /api/products` — Create product (validated via agent schema)
- [ ] `GET /api/products` — List with filters, pagination, search
- [ ] `GET /api/products/:id` — Get product detail
- [ ] `PUT /api/products/:id` — Update product
- [ ] `DELETE /api/products/:id` — Soft delete product
- [ ] `POST /api/inventory/adjust` — Stock adjustment
- [ ] `GET /api/inventory/levels` — Current stock levels
- [ ] `GET /api/inventory/movements` — Stock movement history

### 1.3 Frontend Pages
- [ ] Product list with DataTable (sort, filter, search)
- [ ] Product detail / edit form
- [ ] Inventory dashboard with stock level visualization
- [ ] Stock adjustment modal
- [ ] Low stock alerts panel

---

## Phase 2 — Sales & Orders Module (Weeks 4–5)

### 2.1 Agents
| Agent | Path | Purpose |
|-------|------|---------|
| `order-processor` | `src/agent/order-processor/` | Create/update/cancel orders |
| `customer-manager` | `src/agent/customer-manager/` | Customer CRUD + profile |
| `invoice-generator` | `src/agent/invoice-generator/` | PDF invoice creation |
| `pricing-engine` | `src/agent/pricing-engine/` | Dynamic pricing, discounts, tax |
| `payment-processor` | `src/agent/payment-processor/` | Payment gateway integration |

### 2.2 API Routes
- [ ] `POST /api/orders` — Create order (auto-validates stock)
- [ ] `GET /api/orders` — List orders with status filters
- [ ] `GET /api/orders/:id` — Order detail with items
- [ ] `PATCH /api/orders/:id/status` — Update order status
- [ ] `POST /api/invoices/:orderId` — Generate invoice
- [ ] `GET /api/customers` — Customer list
- [ ] `GET /api/customers/:id` — Customer detail + purchase history

### 2.3 Frontend Pages
- [ ] POS / Order creation interface
- [ ] Order management dashboard
- [ ] Customer management CRM view
- [ ] Invoice viewer / PDF export
- [ ] Sales charts and KPIs

---

## Phase 3 — Agentic AI Features (Weeks 6–7)

### 3.1 AI-Powered Agents
| Agent | Path | Purpose |
|-------|------|---------|
| `demand-forecaster` | `src/agent/demand-forecaster/` | LLM-powered demand prediction |
| `sales-analyst` | `src/agent/sales-analyst/` | Natural language sales queries |
| `reorder-advisor` | `src/agent/reorder-advisor/` | Smart reorder point suggestions |
| `anomaly-detector` | `src/agent/anomaly-detector/` | Unusual sales/inventory pattern detection |
| `chat-assistant` | `src/agent/chat-assistant/` | Conversational business intelligence |

### 3.2 AI Orchestrator Pattern
- [ ] `ai-router` agent that classifies user intent and routes to specialist agents
- [ ] Uses Groq for fast intent classification (`llama-3.3-70b-versatile`)
- [ ] Parallel agent execution for multi-source data gathering
- [ ] Background analytics logging via `ctx.waitUntil()`

### 3.3 RAG Knowledge Base
- [ ] Vector storage for product catalog semantic search
- [ ] Vector storage for sales data insights
- [ ] RAG agent that enriches responses with business context
- [ ] Document ingestion pipeline for SOPs/policies

### 3.4 Cron Jobs
- [ ] `POST /api/cron/daily-report` — `cron('0 9 * * *')` — Daily sales summary
- [ ] `POST /api/cron/stock-check` — `cron('0 */4 * * *')` — Low stock monitor
- [ ] `POST /api/cron/demand-forecast` — `cron('0 0 * * 1')` — Weekly demand forecast

---

## Phase 4 — Reporting & Analytics (Week 8)

### 4.1 Agents
| Agent | Path | Purpose |
|-------|------|---------|
| `report-generator` | `src/agent/report-generator/` | Parameterized report builder |
| `dashboard-data` | `src/agent/dashboard-data/` | Real-time dashboard aggregation |
| `export-agent` | `src/agent/export-agent/` | CSV/PDF export via Durable Streams |

### 4.2 Features
- [ ] Real-time dashboard with WebSocket updates
- [ ] Sales by period, category, customer (aggregate queries)
- [ ] Inventory valuation reports
- [ ] Profit margin analysis
- [ ] Export to CSV/PDF via Durable Streams

---

## Phase 5 — Enterprise Features (Weeks 9–10)

### 5.1 Authentication & Authorization
- [ ] `@agentuity/auth` integration with JWT middleware
- [ ] Role-based access control (Admin, Manager, Clerk, Viewer)
- [ ] API key authentication for external integrations
- [ ] Audit logging agent for all mutations

### 5.2 Multi-location / Multi-warehouse
- [ ] Warehouse-level inventory tracking
- [ ] Inter-warehouse transfer orders
- [ ] Location-specific pricing rules

### 5.3 Integrations
- [ ] Webhook endpoints for external systems (Stripe, shipping APIs)
- [ ] SSE endpoint for real-time notifications
- [ ] WebSocket for live collaboration / POS sync

---

## Phase 6 — Testing, Optimization & Deployment (Week 11–12)

### 6.1 Testing
- [ ] Agent evaluations via Agentuity's eval system
- [ ] Workbench test prompts for each agent
- [ ] Schema validation tests
- [ ] Integration tests for order→inventory flow

### 6.2 Performance
- [ ] Connection pooling via `@agentuity/postgres` (max 10 connections)
- [ ] KV caching for hot data (product catalog, pricing)
- [ ] Response compression (gzip/deflate)
- [ ] Pagination on all list endpoints

### 6.3 Deployment (Per-Client)
- [ ] Build deployment automation script for new client onboarding
- [ ] `agentuity deploy` — same build pushed to each client's Agentuity project
- [ ] Per-client environment variable management via Agentuity console / secrets
- [ ] Per-client database provisioning + migration script
- [ ] Monitoring via Agentuity Observability (per-project dashboards)
- [ ] Rollback strategy via deployment versions
- [ ] Document client onboarding runbook (provision → configure → deploy → migrate → verify)

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    React Frontend                        │
│  src/web/ — @agentuity/react hooks (useAPI, useWebsocket)│
└──────────────────────┬──────────────────────────────────┘
                       │ HTTP / WS / SSE
┌──────────────────────▼──────────────────────────────────┐
│                  API Routes (Hono)                        │
│  src/api/index.ts — createRouter(), middleware, validators│
└──────────┬───────────┬────────────┬─────────────────────┘
           │           │            │
    ┌──────▼──┐  ┌─────▼────┐  ┌───▼──────────┐
    │ Agents  │  │ Agents   │  │ AI Agents    │
    │ (CRUD)  │  │ (Sales)  │  │ (LLM-powered)│
    └────┬────┘  └────┬─────┘  └──────┬───────┘
         │            │               │
    ┌────▼────────────▼───────────────▼───────────────────┐
    │              Services Layer                           │
    │  Neon Postgres (Drizzle) │ KV Storage │ Vector Store │
    └─────────────────────────────────────────────────────┘
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
| Auth | `@agentuity/auth` + JWT | Built-in middleware integration |
| **Architecture** | **Single-tenant** | **One deployment per client — full isolation, no tenant_id** |
| **Design** | **Industry-agnostic** | **Generic models + env-driven labels — zero vertical hardcoding** |
