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

## Phase 7 — POS Integration

Integrate with the **client's existing POS system** — Business IQ Enterprise is a BI solution provider, not a POS vendor. Clients already run their own POS (Square, Clover, Toast, Lightspeed, Shopify POS, Vend, Loyverse, custom systems, etc.). This phase builds the connectors that pull sales and inventory data from those POS systems into Business IQ for unified analytics, reporting, and AI insights.

### 7.1 POS Integration Architecture

```
┌──────────────────┐   REST/Webhook   ┌───────────────────┐    Internal     ┌──────────────┐
│  Client's POS     │ ──────────────► │  POS Connector     │ ─────────────► │  Business IQ  │
│  (Square, Clover, │ ◄── Polling ─── │  Service Layer     │                │  (DB + AI)    │
│   Toast, etc.)    │                  │  src/services/pos/ │                │               │
└──────────────────┘                  └───────────────────┘                └──────────────┘
                                            │
                                            ├── Webhook receiver (real-time push)
                                            ├── Polling scheduler (for POS without webhooks)
                                            ├── Data normalizer (POS-specific → generic schema)
                                            └── Sync log + conflict resolution
```

**Key principle:** We don't touch the POS hardware or software. We connect to the POS **API** to read sales transactions, product catalogs, inventory levels, and customer data — then normalize it into our generic schema for unified BI.

### 7.2 Supported POS Platforms (Connector Matrix)

| POS Platform | Auth Method | Data Available | Sync Method |
|-------------|-------------|----------------|-------------|
| **Square** | OAuth 2.0 | Sales, items, inventory, customers | Webhooks + REST API |
| **Clover** | OAuth 2.0 | Orders, items, inventory, employees | REST API + polling |
| **Toast** | API Key | Orders, menu items, labor, payments | Webhooks + REST API |
| **Lightspeed** | OAuth 2.0 | Sales, products, inventory, customers | REST API + polling |
| **Shopify POS** | OAuth 2.0 | Orders, products, inventory, customers | Webhooks + REST API |
| **Vend (Lightspeed X)** | OAuth 2.0 | Sales, products, inventory, customers | REST API + webhooks |
| **Loyverse** | API Token | Sales, items, inventory, customers | REST API + polling |
| **Custom / Generic** | API Key / OAuth | Configurable field mapping | Webhook + REST |

Each deployment configures which POS connector to use and provides API credentials via environment variables.

### 7.3 POS API Routes
- [ ] `POST /api/pos/connect` — Initiate OAuth flow or validate API key for a POS provider
- [ ] `GET /api/pos/status` — Connection status, last sync time, error count
- [ ] `POST /api/pos/sync` — Trigger a manual full or incremental sync
- [ ] `GET /api/pos/sync-log` — Paginated sync history (success/failure, records synced)
- [ ] `POST /api/pos/webhook` — Webhook receiver endpoint (POS pushes events here)
- [ ] `GET /api/pos/mapping` — Field mapping configuration (POS fields → BIQ fields)
- [ ] `PUT /api/pos/mapping` — Update field mapping for custom POS integrations
- [ ] `POST /api/pos/disconnect` — Revoke tokens and disable sync

### 7.4 POS Database Schema
- [ ] `pos_connections` — id, provider (square/clover/toast/...), warehouseId, authType, credentials (encrypted JSONB), status (connected/disconnected/error), lastSyncAt, syncFrequencyMins, fieldMapping (JSONB), metadata
- [ ] `pos_sync_log` — id, connectionId, syncType (full/incremental/webhook), status (success/partial/failed), recordsSynced, errors (JSONB), startedAt, completedAt
- [ ] `pos_transactions` — id, connectionId, externalId (POS transaction ID), orderId (our order), rawData (JSONB), normalizedAt, metadata

### 7.5 POS Connector Service

`src/services/pos.ts` + `src/services/pos/` subdirectory per provider

Each connector implements a common interface:
```typescript
interface POSConnector {
  authorize(config: POSConfig): Promise<AuthResult>;       // OAuth flow or key validation
  syncProducts(since?: Date): Promise<NormalizedProduct[]>; // Pull product catalog
  syncSales(since?: Date): Promise<NormalizedSale[]>;       // Pull sales transactions
  syncInventory(since?: Date): Promise<NormalizedStock[]>;  // Pull stock levels
  syncCustomers(since?: Date): Promise<NormalizedCustomer[]>; // Pull customer records
  handleWebhook(payload: unknown): Promise<WebhookResult>;  // Process incoming webhook
  disconnect(): Promise<void>;                              // Revoke & cleanup
}
```

**Data normalization:** Each POS has different field names, statuses, and structures. The connector normalizes everything into our generic schema (products, orders, customers, inventory) before writing to the database. Field mapping is configurable per-connection for custom POS systems.

### 7.6 Sync Strategy
- [ ] **Webhook-first:** For POS platforms that support webhooks (Square, Toast, Shopify), register webhooks on connect for real-time data push
- [ ] **Polling fallback:** For platforms without webhooks (some Clover setups, Loyverse), schedule periodic polling via cron (`/api/cron/pos-sync`)
- [ ] **Incremental sync:** Use `lastSyncAt` + POS-side `updated_at` filters to pull only changes
- [ ] **Full sync:** Admin-triggered full re-sync for data reconciliation
- [ ] **Conflict resolution:** POS is source of truth for sales; Business IQ is source of truth for analytics. Duplicate detection via `externalId`
- [ ] **Error handling:** Failed syncs logged with retry. After 3 consecutive failures, mark connection as `error` and notify admin

### 7.7 Environment Variables (Per-Client)
```env
POS_PROVIDER=square              # square | clover | toast | lightspeed | shopify | vend | loyverse | custom
POS_API_KEY=                     # API key (for token-based auth)
POS_CLIENT_ID=                   # OAuth client ID (for OAuth-based auth)
POS_CLIENT_SECRET=               # OAuth client secret
POS_WEBHOOK_SECRET=              # Webhook signature verification secret
POS_SYNC_FREQUENCY_MINS=15       # Polling interval (for non-webhook providers)
POS_LOCATION_ID=                 # POS location/store ID to sync (multi-location support)
```

### 7.8 POS Frontend Updates (Admin Console)
- [ ] New "POS Integration" tab in Admin console
- [ ] Provider selection with guided setup wizard (OAuth redirect or API key input)
- [ ] Connection status dashboard: last sync, records synced, error count
- [ ] Sync log viewer with error details and retry button
- [ ] Field mapping editor for custom POS integrations
- [ ] Manual sync trigger button
- [ ] POS data preview: recent transactions pulled from POS before they're synced

---

## Phase 8 — Intelligent Business Chatbot

### Overview — "Brain of the Business"

A deeply intelligent conversational AI that understands the **entire** business context — database state, uploaded documents, integrated HRMIS/CRM data, and industry-specific logic. Unlike the current basic assistant (single snapshot + text generation), this is a **multi-agent orchestrated system** with streaming responses, tool-call visualization, and a new **Data Science Assistant** agent that acts as the central intelligence coordinator.

**Architecture reference:** Adapted from the [Agentuity Coder](https://github.com/agentuity/coder) project — specifically its SSE streaming pattern, tool-call visualization, multi-agent orchestration, and session management model.

### 8.1 Agent Hierarchy — "Data-Driven Intelligence"

```
                         ┌─────────────────────────┐
                         │   Data Science Assistant  │
                         │   (Orchestrator / Brain)  │
                         │   src/agent/data-science/ │
                         └────────────┬──────────────┘
                                      │ delegates
              ┌───────────────┬───────┴──────┬──────────────┬──────────────┐
              ▼               ▼              ▼              ▼              ▼
     ┌────────────┐  ┌──────────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐
     │  Business   │  │   Insights   │ │  Report   │ │ Knowledge │ │Integration│
     │  Assistant  │  │   Analyzer   │ │ Generator │ │   Base    │ │  Bridge   │
     │  (chat/NL)  │  │  (analytics) │ │  (reports)│ │   (RAG)   │ │(HRMIS/CRM)│
     └─────────────┘  └──────────────┘ └───────────┘ └───────────┘ └───────────┘
           ↑                  ↑              ↑             ↑              ↑
           └─── all agents report results back to Data Science Assistant ──┘
```

**Key principle:** Every agent action is **data-driven**. The Data Science Assistant decides which sub-agents to invoke based on intent classification, routes the request, collects results, and synthesizes a unified response with statistical reasoning.

### 8.2 New Agent: Data Science Assistant (Orchestrator)

`src/agent/data-science/index.ts`

The "brain" agent that coordinates all other agents. Responsibilities:

| Capability | Description |
|------------|-------------|
| **Intent Classification** | Classifies user messages into categories: query, analysis, report, knowledge, integration, action |
| **Agent Routing** | Decides which sub-agent(s) to invoke (can invoke multiple in parallel) |
| **Result Synthesis** | Collects sub-agent outputs, applies statistical reasoning, produces unified response |
| **Tool Calling** | Exposes "tools" to the LLM: `query_database`, `analyze_trends`, `generate_report`, `search_knowledge`, `fetch_integration` |
| **Conversation Memory** | Maintains thread context with rolling summary for long conversations |
| **Proactive Insights** | After answering, appends related observations ("I also noticed…") |

**Tool definitions (visible in UI as tool calls):**

```typescript
const tools = {
  query_database: {
    description: "Execute a read-only SQL query against the business database",
    parameters: z.object({
      query: z.string().describe("SQL SELECT query"),
      explanation: z.string().describe("What this query does in plain English"),
    }),
  },
  analyze_trends: {
    description: "Run the insights-analyzer agent for trend/anomaly detection",
    parameters: z.object({
      analysis: z.enum(["demand-forecast", "anomaly-detection", "restock-recommendations", "sales-trends"]),
      timeframeDays: z.number(),
    }),
  },
  generate_report: {
    description: "Generate an AI-narrated business report",
    parameters: z.object({
      reportType: z.enum(["sales-summary", "inventory-health", "customer-activity", "financial-overview"]),
      startDate: z.string(),
      endDate: z.string(),
    }),
  },
  search_knowledge: {
    description: "Search the knowledge base for policy/document answers",
    parameters: z.object({ question: z.string() }),
  },
  fetch_integration: {
    description: "Query an integrated external system (HRMIS, CRM, etc.)",
    parameters: z.object({
      system: z.enum(["hrmis", "crm", "accounting", "custom"]),
      action: z.string(),
      params: z.record(z.unknown()).optional(),
    }),
  },
};
```

### 8.3 New Agent: Integration Bridge

`src/agent/integration-bridge/index.ts`

Connects Business IQ to external systems via API:

| Integration | Protocol | Data |
|-------------|----------|------|
| **HRMIS** (e.g., BambooHR, OrangeHRM) | REST API | Employee roster, attendance, payroll summaries |
| **CRM** (e.g., HubSpot, Salesforce) | REST API | Leads, deals, customer interactions, pipeline |
| **Accounting** (e.g., QuickBooks, Xero) | REST API / OAuth | Chart of accounts, P&L, balance sheet |
| **Custom** | Configurable webhook/REST | Client-specific integrations |

Configuration via env vars per deployment:
```env
HRMIS_PROVIDER=bamboohr       # or orangehrm, custom
HRMIS_API_URL=https://api.bamboohr.com/api/gateway.php/company
HRMIS_API_KEY=                 # Per-client API key
CRM_PROVIDER=hubspot           # or salesforce, custom
CRM_API_URL=https://api.hubapi.com
CRM_API_KEY=                   # Per-client API key
```

### 8.4 SSE Streaming Chat (Adapted from Coder Project)

**Architecture borrowed from Agentuity Coder:**

The coder project uses a proxy-based SSE streaming model where the backend proxies AI SSE events to the frontend. We adapt this to a **direct SSE generation** model since our AI runs server-side (not in sandboxes):

```
┌─────────────┐    POST /chat/send      ┌──────────────────┐     agent.run()     ┌──────────────┐
│  React SPA   │ ──────────────────────► │  Chat Route       │ ──────────────────► │ Data Science  │
│  (frontend)  │                         │  (src/api/chat.ts)│                     │ Assistant     │
│              │ ◄── SSE /chat/events ── │                   │ ◄── streamText ──── │              │
└─────────────┘                         └──────────────────┘                     └──────────────┘
```

#### SSE Event Types (mirroring Coder patterns):
```typescript
// Text streaming (partial tokens)
{ event: "message.delta", data: { content: "The top selling..." } }

// Tool call started (shown as expandable card in UI)
{ event: "tool.start", data: { toolId: "t1", name: "query_database", input: { query: "SELECT...", explanation: "..." } } }

// Tool call result
{ event: "tool.result", data: { toolId: "t1", output: { rows: [...], rowCount: 15 } } }

// Sub-agent delegated (shown as nested card)
{ event: "agent.delegated", data: { agent: "insights-analyzer", input: { analysis: "demand-forecast" } } }

// Sub-agent result
{ event: "agent.result", data: { agent: "insights-analyzer", output: { insights: [...] } } }

// Stream complete
{ event: "message.done", data: { messageId: "m1", suggestedActions: [...] } }

// Error
{ event: "error", data: { message: "Failed to query database" } }
```

#### API Routes:
- [ ] `POST /api/chat/send` — Fire-and-forget message send (returns `{ messageId }`)
- [ ] `GET /api/chat/events` — SSE stream for the current user session
- [ ] `GET /api/chat/history` — Paginated conversation history
- [ ] `POST /api/chat/sessions` — Create a new chat session
- [ ] `GET /api/chat/sessions` — List user's chat sessions
- [ ] `DELETE /api/chat/sessions/:id` — Delete a chat session
- [ ] `POST /api/chat/feedback` — Thumbs up/down on a response (for improvement)

### 8.5 Chat Session & Thread Model

```sql
-- New table: chat_sessions
chat_sessions (
  id          UUID PRIMARY KEY,
  userId      UUID REFERENCES users(id),
  title       VARCHAR(200),                -- auto-generated from first message
  status      VARCHAR(20) DEFAULT 'active', -- active | archived
  metadata    JSONB,                        -- model, last message preview, etc.
  createdAt   TIMESTAMP,
  updatedAt   TIMESTAMP
)

-- New table: chat_messages
chat_messages (
  id          UUID PRIMARY KEY,
  sessionId   UUID REFERENCES chat_sessions(id),
  role        VARCHAR(20),                  -- user | assistant | tool | system
  content     TEXT,                         -- message text or tool result JSON
  toolCalls   JSONB,                        -- array of tool call objects
  metadata    JSONB,                        -- tokens, latency, model, etc.
  createdAt   TIMESTAMP
)
```

Thread state stored in `ctx.thread.state`:
- `sessionId` — DB session ID
- `summary` — rolling conversation summary (compressed by LLM every N messages)
- `lastMessagePreview` — for session list UI
- `activeIntegrations` — which external systems are connected

### 8.6 Tool Call Visualization (Adapted from Coder)

Borrowing the Coder project's `ToolCallCard` pattern — each tool type renders differently:

| Tool | UI Treatment |
|------|-------------|
| `query_database` | SQL syntax-highlighted code block → results table with row count |
| `analyze_trends` | Loading spinner → insight cards with severity badges (info/warning/critical) |
| `generate_report` | Loading spinner → formatted markdown report in expandable card |
| `search_knowledge` | Document icon → answer with source citations (document name, chunk) |
| `fetch_integration` | System logo → data card (e.g., "3 employees on leave today") |

State machine per tool call: `pending → running → completed | error`

### 8.7 Frontend: Enhanced Assistant Page

Rewrite `src/web/pages/AssistantPage.tsx` with:

- [ ] **SSE-powered streaming** using `useEventStream` or custom `useReducer` hook (adapted from Coder's `useSessionEvents.ts`)
- [ ] **Session list sidebar** — multiple conversations, searchable, with date grouping
- [ ] **Tool call cards** — inline expandable cards showing what the AI is doing (SQL queries, analysis, etc.)
- [ ] **Markdown rendering** with code blocks, tables, and chart embeds
- [ ] **Suggested follow-ups** — clickable action pills after each response
- [ ] **Typing indicator** with live token streaming
- [ ] **Feedback buttons** — thumbs up/down per message for quality tracking
- [ ] **Chat context panel** — shows which data sources are active (DB, KB, HRMIS, CRM)
- [ ] **Mobile-optimized** — session list as slide-over drawer on small screens

### 8.8 Proactive Intelligence (Cron-Driven)

The Data Science Assistant isn't just reactive — it proactively generates insights:

- [ ] `POST /api/cron/daily-brief` — `cron('0 8 * * *')` — Morning brief: yesterday's sales, low stock, pending orders, upcoming deliveries
- [ ] `POST /api/cron/weekly-insights` — `cron('0 9 * * 1')` — Weekly trend analysis: sales velocity changes, customer churn risk, demand patterns
- [ ] `POST /api/cron/anomaly-watch` — `cron('0 */6 * * *')` — Every 6 hours: unusual transaction patterns, inventory discrepancies, pricing anomalies

These cron jobs write insights to a `notifications` table and push via SSE to connected users.

### 8.9 Integration Configuration (Admin Console)

New tab in Admin page: **Integrations**

- [ ] HRMIS connection setup (provider, API URL, API key, test connection)
- [ ] CRM connection setup (provider, API URL, API key, field mapping)
- [ ] Accounting system setup (provider, OAuth flow, sync schedule)
- [ ] Custom webhook integration builder
- [ ] Connection status dashboard (last sync, error log, data freshness)

### 8.10 Implementation Sequence

```
Step 1: Data Science Assistant agent (orchestrator) + tool definitions
         ├── Intent classifier (using Groq for speed)
         ├── Tool function implementations (query_database, analyze_trends etc.)
         └── Thread management with rolling summary

Step 2: SSE streaming infrastructure
         ├── Chat routes: send, events, history, sessions
         ├── SSE event protocol (message.delta, tool.start, tool.result etc.)
         └── Chat session + message DB tables + migrations

Step 3: Enhanced Assistant Page (frontend)
         ├── useReducer hook for SSE events (adapted from Coder)
         ├── Tool call cards (query results, insights, reports)
         ├── Session sidebar, markdown rendering, streaming display
         └── Mobile optimization

Step 4: Integration Bridge agent
         ├── HRMIS connector (BambooHR/OrangeHRM)
         ├── CRM connector (HubSpot/Salesforce)
         ├── Admin console Integration tab
         └── Connection testing + error handling

Step 5: Proactive intelligence + polish
         ├── Cron jobs (daily brief, weekly insights, anomaly watch)
         ├── Notification delivery via SSE
         ├── Feedback system (thumbs up/down → improvement loop)
         └── End-to-end testing of multi-agent flows
```

---

## Phase 9 — Testing, Optimization & Deployment

### 9.1 Testing
- [ ] Agent evaluations via Agentuity's eval system
- [ ] Workbench test prompts for each agent (including Data Science Assistant routing)
- [ ] Schema validation tests for all tool call inputs/outputs
- [ ] Integration tests: order → inventory → POS sync flow
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
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐  ┌──────────┐  │
│  │  Dashboard    │  │  Admin       │  │  AI Assistant  │  │  POS Mgmt│  │
│  │  (charts)     │  │  (6 tabs)    │  │  (SSE stream)  │  │  (sync)  │  │
│  └──────┬────────┘  └──────┬───────┘  └──────┬─────────┘  └────┬────┘  │
└─────────┼──────────────────┼─────────────────┼──────────────────┼───────┘
          │ HTTP             │ HTTP            │ SSE              │ HTTP
┌─────────▼──────────────────▼─────────────────▼──────────────────▼───────┐
│                          API Routes (Hono)                               │
│  src/api/ — createRouter(), auth middleware, SSE streaming               │
└──────┬──────────┬──────────┬──────────┬──────────┬──────────┬───────────┘
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
│  │ Neon Postgres │  │ KV Storage│  │Vector Store│  │ External APIs      │  │
│  │ (Drizzle ORM)│  │ (cache)   │  │ (RAG docs) │  │ (POS/HRMIS/CRM)   │  │
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
| POS integration | REST API connectors | Pull data from client's existing POS (Square, Clover, Toast etc.) |
| POS sync | Webhook + polling | Real-time webhooks where available, scheduled polling as fallback |
| **Architecture** | **Single-tenant** | **One deployment per client — full isolation, no tenant_id** |
| **Design** | **Industry-agnostic** | **Generic models + env-driven labels — zero vertical hardcoding** |
