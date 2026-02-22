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

### ✅ Phase 6 — Document Intelligence & Chat Enhancements
- **Document Scanner agent** — GPT-4o multimodal: invoice, stock-sheet, barcode scan modes
- **Chat file uploads** — multipart upload with S3 storage + in-memory temp cache fallback
- **Multi-file upload** — select/capture multiple files at once (images, PDFs, CSVs, spreadsheets)
- **Camera capture** — mobile camera button for barcode/invoice/stock-sheet scanning (multi-photo)
- **S3 fallback** — temp in-memory cache with serve endpoint when S3 is unavailable (Agentuity deployment)
- **Chat attachment context** — uploaded files attached to chat messages with download URLs for scanner
- **Report generation pipeline** — Vega-Lite charts rendered via Sharp, PDF formatting, title page, TOC
- **Admin report settings** — 10 configurable parameters (title page, TOC, charts, exec summary, max pages/words)
- **Report export** — PDF download with S3 + temp cache fallback

---

## Phase 6.5 — Document Ingestion Pipeline ★ MOAT FEATURE ★

**The competitive moat:** Uploaded documents (receipts, invoices, sales/stock sheets) are automatically parsed by AI, deduplicated against existing data, and staged for approval. Once approved, they atomically update the relevant database tables (products, inventory, orders, invoices) without creating duplicates.

**No other application does this.** This is the core value proposition that differentiates Business IQ Enterprise.

### 6.5.1 Architecture Overview

```
┌──────────────┐   Upload    ┌──────────────┐   Parse    ┌──────────────┐
│  User uploads │ ──────────► │  Chat / API   │ ──────────► │  Document    │
│  document(s)  │             │  Attachments  │             │  Scanner     │
└──────────────┘             └──────────────┘             │  (GPT-4o)    │
                                                           └──────┬───────┘
                                                                  │ structured JSON
                                                                  ▼
┌──────────────┐   Apply     ┌──────────────┐   Dedup    ┌──────────────┐
│  Database     │ ◄────────── │  Approval     │ ◄──────── │  Ingestion   │
│  (atomic ops) │  on approve │  Chain        │  & stage  │  Engine      │
└──────────────┘             └──────────────┘             └──────────────┘
```

### 6.5.2 Deduplication Engine

The dedup engine prevents duplicate records when the same document is uploaded twice or when scanned items already exist in the database.

**Multi-layer matching strategy:**

| Layer | Signal | Match Type | Confidence |
|-------|--------|------------|------------|
| 1 | Document content hash (SHA-256) | Exact duplicate document | 100% — reject |
| 2 | Invoice number / receipt number | External reference match | 95% — flag |
| 3 | Product SKU / barcode | Exact product match | 95% — merge |
| 4 | Product name (fuzzy, Levenshtein ≤ 2) | Probable product match | 80% — suggest |
| 5 | Amount + date + supplier combo | Transaction match | 85% — flag |

**Dedup outcomes:**
- `exact_duplicate` — Document already processed → reject with link to original
- `item_match` — Scanned item matches existing product → update quantities (not create)
- `probable_match` — Fuzzy match found → present to user for confirmation
- `new_item` — No match → create new record (pending approval)

### 6.5.3 Database Schema (New Tables)

```sql
-- Tracks each document ingestion attempt
CREATE TABLE document_ingestions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attachment_id   UUID REFERENCES attachments(id),    -- source file
  session_id      UUID REFERENCES chat_sessions(id),  -- chat context
  user_id         UUID REFERENCES users(id),          -- who uploaded
  document_type   VARCHAR(50) NOT NULL,               -- invoice, stock_sheet, receipt, barcode
  document_hash   VARCHAR(64) NOT NULL,               -- SHA-256 of file content
  scanner_output  JSONB NOT NULL,                     -- raw structured JSON from scanner
  status          VARCHAR(30) DEFAULT 'pending',      -- pending, approved, rejected, applied, error
  approval_id     UUID REFERENCES approval_requests(id),
  dedup_results   JSONB,                              -- array of match results
  applied_at      TIMESTAMP,                          -- when DB changes were committed
  error_message   TEXT,
  metadata        JSONB,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);

-- Individual items extracted from a document, each with dedup status
CREATE TABLE document_ingestion_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ingestion_id    UUID REFERENCES document_ingestions(id) ON DELETE CASCADE,
  item_index      INTEGER NOT NULL,                   -- position in scanner output
  item_type       VARCHAR(30) NOT NULL,               -- product, order_item, invoice_line
  extracted_data  JSONB NOT NULL,                     -- parsed item data
  match_status    VARCHAR(30) DEFAULT 'new',          -- new, exact_match, fuzzy_match, duplicate
  matched_id      UUID,                               -- ID of existing record if matched
  match_confidence DECIMAL(5,2),                      -- 0-100
  resolution      VARCHAR(30),                        -- create, update, skip, merge
  user_confirmed  BOOLEAN DEFAULT FALSE,              -- user reviewed the match
  metadata        JSONB,
  created_at      TIMESTAMP DEFAULT NOW()
);
```

### 6.5.4 Approval Workflows (New)

Five new approval workflows for document ingestion, integrated with the existing approval system:

| Workflow | Trigger | Auto-Approve | Steps |
|----------|---------|--------------|-------|
| `document.invoice_ingestion` | Invoice scanned & staged | admin, super_admin | 1. Review items → 2. Confirm amounts |
| `document.stock_sheet_ingestion` | Stock sheet scanned & staged | admin, super_admin | 1. Review quantities → 2. Confirm adjustments |
| `document.receipt_ingestion` | Receipt scanned & staged | manager+ | 1. Review & approve |
| `document.bulk_import` | Multiple documents in batch | admin, super_admin | 1. Review summary → 2. Approve batch |
| `document.high_value_ingestion` | Total value > threshold | super_admin only | 1. Manager review → 2. Admin approval |

**Permission cascade model:**
```
super_admin → auto-approves everything
admin       → auto-approves except high_value
manager     → auto-approves receipts only, reviews up for invoices/stock
staff       → submits for review, manager/admin approves
viewer      → cannot upload documents
```

### 6.5.5 Apply-on-Approval (Atomic Operations)

When an ingestion is approved, the system atomically applies all changes in a single transaction:

**Invoice ingestion → creates/updates:**
- `orders` — new order record (or updates existing if PO number matches)
- `order_items` — line items from invoice
- `invoices` — invoice record with amounts
- `products` — new products if scanned items don't exist (pending separate approval)
- `inventory` — quantity adjustments for received stock

**Stock sheet ingestion → creates/updates:**
- `inventory` — quantity corrections per warehouse/location
- `products` — new products if scanned items don't exist
- Generates audit trail entries for each adjustment

**Receipt ingestion → creates/updates:**
- `orders` — sale record
- `order_items` — line items
- `inventory` — quantity deductions

### 6.5.6 Chatbot-Guided Collection

When the AI scanner parses a document with missing or ambiguous information, the chatbot guides the user to fill in gaps:

```
User: [uploads invoice photo]
AI:   📷 Scanning invoice...
      I found 5 line items from "ABC Supplies Ltd":
      1. Widget A × 100 @ $2.50 — ✅ matches existing SKU-001
      2. Widget B × 50 @ $3.00 — ⚠️ similar to "Widget Beta" (85% match)
      3. Gadget C × 25 @ $15.00 — 🆕 new product, not in system
      4. Part D × 200 @ $0.75 — ✅ matches existing SKU-044
      5. Material E × 10 @ $45.00 — ✅ matches existing SKU-112

      I need your help with items 2 and 3:
      • Is "Widget B" the same as "Widget Beta" (SKU-002)?
      • For "Gadget C" — what category and unit should I use?

User: Yes, Widget B is Widget Beta. Gadget C is in Electronics, unit: piece.

AI:   ✅ Got it! Here's the summary:
      - 3 existing products will have quantities updated
      - 1 product matched to "Widget Beta" — quantity +50
      - 1 new product "Gadget C" will be created in Electronics
      Total invoice: $1,012.50

      This has been submitted for approval.
      [Manager approval pending — John will review]
```

### 6.5.7 Knowledge Base Alignment

Scanned documents are also indexed in the Knowledge Base vector store:
- Invoice PDFs → searchable by supplier, date, amounts
- Stock sheets → searchable by item, location, date
- Receipts → searchable by transaction, customer, items
- This enables queries like "Show me all invoices from ABC Supplies" or "When did we last receive Widget A?"

### 6.5.8 Implementation Sequence

```
Phase A: Schema — 2 new tables (document_ingestions, document_ingestion_items)
Phase B: Dedup engine — hash check, external ref match, SKU/barcode/name matching
Phase C: Ingestion service — stage, review, apply functions
Phase D: Scanner → ingestion bridge — wire scanner output into ingestion pipeline
Phase E: Approval wiring — 5 new workflows, role-based auto-approve rules
Phase F: Permission cascade — enforce upload/approve hierarchy
Phase G: Review UI — ingestion review cards in Approvals page
Phase H: API routes — CRUD for ingestions, manual resolution endpoints
Phase I: Chat integration — chatbot guides user through ambiguous items
Phase J: Knowledge base indexing — auto-index processed documents
```

---

## Phase 7 — POS Integration (Weeks 1–3)

External hardware Point-of-Sale integration — connecting Business IQ Enterprise to physical POS terminals, receipt printers, barcode scanners, and cash drawers.

### 7.1 POS Gateway Architecture

```
┌────────────────┐     WebSocket      ┌──────────────────┐    REST/SSE    ┌──────────────┐
│  POS Terminal   │ ◄──────────────── │  POS Gateway      │ ◄──────────── │  Business IQ  │
│  (hardware)     │ ──────────────── │  (local bridge)    │ ──────────── │  (cloud)      │
└────────────────┘                    └──────────────────┘               └──────────────┘
     │                                      │
     ├── Barcode Scanner                    ├── Receipt Printer Driver
     ├── Cash Drawer                        ├── Offline Queue (SQLite)
     └── Card Reader                        └── Sync Engine
```

The POS Gateway is a lightweight local bridge application (`bun` or `electron`) that runs on the client device near the POS hardware, communicating with Business IQ cloud via WebSockets and handling hardware I/O locally.

### 7.2 POS API Routes
- [ ] `POST /api/pos/register` — Register a POS terminal (name, location, hardware config)
- [ ] `GET /api/pos/terminals` — List registered terminals with status
- [ ] `PUT /api/pos/terminals/:id/config` — Update terminal configuration
- [ ] `POST /api/pos/transactions` — Submit a completed POS transaction
- [ ] `GET /api/pos/transactions` — List transactions with filters (terminal, date, cashier)
- [ ] `POST /api/pos/sync` — Bulk sync offline transactions
- [ ] `WS /api/pos/live` — WebSocket endpoint for real-time terminal ↔ cloud communication

### 7.3 POS Database Schema
- [ ] `pos_terminals` — id, name, warehouseId, status (online/offline), hardwareConfig (JSONB), lastSeen
- [ ] `pos_transactions` — id, terminalId, orderId, cashierId, paymentMethod, receiptNumber, metadata
- [ ] `pos_sessions` — id, terminalId, cashierId, openedAt, closedAt, openingBalance, closingBalance, status

### 7.4 POS Gateway (Local Bridge)
- [ ] **Runtime:** Bun (cross-platform, single binary)
- [ ] **Hardware drivers:** USB HID for barcode scanners, ESC/POS for thermal printers, serial for cash drawers
- [ ] **Offline mode:** SQLite queue for transactions when cloud is unreachable
- [ ] **Auto-sync:** Background sync engine that flushes offline queue when connectivity returns
- [ ] **Config:** Gateway reads terminal config from cloud on startup, polls for config changes
- [ ] **Authentication:** API key per terminal (managed in Admin console)

### 7.5 POS Features
- [ ] Barcode scan → product lookup → add to cart (< 200ms round-trip)
- [ ] Receipt printing (ESC/POS thermal: 58mm and 80mm widths)
- [ ] Cash drawer open trigger on transaction completion
- [ ] Cashier session management (clock in/out, opening/closing balance)
- [ ] End-of-day settlement with discrepancy detection
- [ ] Split payment support (cash + card + mobile money)
- [ ] Offline transaction queue with visual indicator
- [ ] Real-time inventory deduction on sale
- [ ] Customer loyalty lookup by phone/barcode

### 7.6 POS Hardware Compatibility Matrix
| Hardware | Protocol | Driver |
|----------|----------|--------|
| Barcode Scanner (USB HID) | USB HID keyboard mode | Native — no driver needed |
| Thermal Printer (ESC/POS) | USB / Network / Bluetooth | `escpos` Bun-compatible library |
| Cash Drawer | Printer-triggered (DK port) | ESC/POS cash drawer command |
| Card Reader (Verifone/PAX) | Serial / TCP | Vendor SDK or ISO 8583 |
| Weighing Scale (serial) | RS-232 / USB-Serial | Custom serial parser |

### 7.7 POS Frontend Updates
- [ ] Terminal management page in Admin console (register, configure, monitor)
- [ ] POS session view: live terminal status, current cashier, transaction count
- [ ] End-of-day settlement wizard
- [ ] POS transaction history with receipt re-print

---

## Phase 8 — Intelligent Business Chatbot (Weeks 4–8)

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
Week 4: Data Science Assistant agent (orchestrator) + tool definitions
         ├── Intent classifier (using Groq for speed)
         ├── Tool function implementations (query_database, analyze_trends etc.)
         └── Thread management with rolling summary

Week 5: SSE streaming infrastructure
         ├── Chat routes: send, events, history, sessions
         ├── SSE event protocol (message.delta, tool.start, tool.result etc.)
         └── Chat session + message DB tables + migrations

Week 6: Enhanced Assistant Page (frontend)
         ├── useReducer hook for SSE events (adapted from Coder)
         ├── Tool call cards (query results, insights, reports)
         ├── Session sidebar, markdown rendering, streaming display
         └── Mobile optimization

Week 7: Integration Bridge agent
         ├── HRMIS connector (BambooHR/OrangeHRM)
         ├── CRM connector (HubSpot/Salesforce)
         ├── Admin console Integration tab
         └── Connection testing + error handling

Week 8: Proactive intelligence + polish
         ├── Cron jobs (daily brief, weekly insights, anomaly watch)
         ├── Notification delivery via SSE
         ├── Feedback system (thumbs up/down → improvement loop)
         └── End-to-end testing of multi-agent flows
```

---

## Phase 9 — Testing, Optimization & Deployment (Weeks 9–10)

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
│  │  Dashboard    │  │  Admin       │  │  AI Assistant  │  │  POS UI  │  │
│  │  (charts)     │  │  (5 tabs)    │  │  (SSE stream)  │  │  (orders)│  │
│  └──────┬────────┘  └──────┬───────┘  └──────┬─────────┘  └────┬────┘  │
└─────────┼──────────────────┼─────────────────┼──────────────────┼───────┘
          │ HTTP             │ HTTP            │ SSE              │ WS
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
| POS comm | WebSocket | Real-time bidirectional terminal ↔ cloud communication |
| POS offline | SQLite queue | Local transaction buffer when cloud is unreachable |
| **Architecture** | **Single-tenant** | **One deployment per client — full isolation, no tenant_id** |
| **Design** | **Industry-agnostic** | **Generic models + env-driven labels — zero vertical hardcoding** |
