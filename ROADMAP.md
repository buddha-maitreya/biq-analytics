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

## Phase 9 — Testing, Optimization & Deployment (Weeks 9–10)

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
│Business  │ │Insights   │ │Report    │ │Knowledge│ │Integr- │ │Data       │
│Assistant │ │Analyzer   │ │Generator │ │Base     │ │ation   │ │Science    │
│(chat/NL) │ │(analytics)│ │(reports) │ │(RAG)    │ │Bridge  │ │Assistant  │
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
