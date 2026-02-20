# Business IQ Enterprise

**Enterprise-grade, industry-agnostic Inventory & Sales Management platform powered by AI agents.**

Business IQ Enterprise is a full-stack business management system that combines traditional CRUD operations with AI-powered insights, natural language queries, and automated report generation. Built on the [Agentuity](https://agentuity.dev) platform, it deploys as a single-tenant application — one dedicated instance per client with isolated compute, storage, and configuration.

---

## Vision

Modern businesses need more than spreadsheets and rigid ERP systems. Business IQ Enterprise brings **intelligent automation** to everyday operations:

- **Ask questions in plain English** — "Which products are running low?" or "Show me sales trends for the last quarter" — and get instant, data-backed answers from AI agents.
- **Automatic insights** — Demand forecasting, anomaly detection, restock recommendations, and sales trend analysis without manual number-crunching.
- **Any industry, same platform** — A restaurant, hardware store, chemical supplier, or clinic all run the same codebase. Terminology, units, tax rules, and workflows adapt through environment variables — zero code changes.
- **Single-tenant by design** — Every client gets their own deployment, database, and configuration. No shared data, no tenant ID hacks, no row-level security workarounds.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Agentuity Cloud                             │
│                                                                     │
│  ┌──────────────┐   ┌──────────────────┐   ┌────────────────────┐  │
│  │   Frontend    │   │   API Routes     │   │    AI Agents       │  │
│  │   (React +   │   │   (Hono-based)   │   │                    │  │
│  │    Vite)      │   │                  │   │  business-assistant│  │
│  │              │──▶│  /api/products    │──▶│  insights-analyzer │  │
│  │  Dashboard   │   │  /api/orders     │   │  knowledge-base    │  │
│  │  Products    │   │  /api/customers  │   │  report-generator  │  │
│  │  Orders      │   │  /api/inventory  │   │                    │  │
│  │  Customers   │   │  /api/invoices   │   └────────┬───────────┘  │
│  │  Inventory   │   │  /api/pricing    │            │              │
│  │  Invoices    │   │  /api/admin      │            │              │
│  │  Reports     │   │  /api/chat       │            ▼              │
│  │  Assistant   │   │  /api/reports    │   ┌────────────────────┐  │
│  └──────────────┘   │  /api/documents  │   │  AI Gateway        │  │
│                     │  /api/config     │   │  (OpenAI / Groq /  │  │
│                     │  /api/health     │   │   Anthropic)       │  │
│                     └────────┬─────────┘   └────────────────────┘  │
│                              │                                      │
│                              ▼                                      │
│                     ┌──────────────────┐                            │
│                     │  Neon Postgres   │                            │
│                     │  (per-client DB) │                            │
│                     └──────────────────┘                            │
│                                                                     │
│           ┌──────────┐  ┌──────────┐  ┌──────────────┐             │
│           │ KV Store │  │  Vector  │  │ Object Store │             │
│           │          │  │  Store   │  │              │             │
│           └──────────┘  └──────────┘  └──────────────┘             │
└─────────────────────────────────────────────────────────────────────┘
```

### Layers

| Layer | Technology | Location |
|-------|-----------|----------|
| **Frontend** | React 19, Vite, `@agentuity/react` hooks | `src/web/` |
| **API Routes** | Hono-based routers via `@agentuity/runtime` | `src/api/` |
| **AI Agents** | Agentuity agents with Vercel AI SDK | `src/agent/` |
| **Services** | Business logic layer (CRUD, calculations) | `src/services/` |
| **Database** | Neon Postgres via Drizzle ORM | `src/db/` |
| **Storage** | KV, Vector, and Object stores via Agentuity SDK | Agent runtime |

---

## Tech Stack

### Runtime & Language
- **Runtime:** [Bun](https://bun.sh) — fast JavaScript runtime, bundler, and package manager
- **Language:** TypeScript 5.x (strict mode)

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
- **Agents:** 4 specialized AI agents with typed input/output schemas

### Database & Storage
- **Database:** [Neon Postgres](https://neon.tech) — serverless Postgres, one database per client
- **ORM:** [Drizzle ORM](https://orm.drizzle.team) 0.45.x via `@agentuity/drizzle`
- **Migrations:** `drizzle-kit` for schema generation and migration
- **Additional Storage:** Agentuity KV store, Vector store (semantic search), Object store

### Deployment
- **CLI:** Agentuity CLI (`agentuity deploy`)
- **Build:** Vite (frontend) + Bun bundler (server) — hybrid build system
- **Environment:** WSL (Ubuntu 24.04) for builds and deploys from Windows

---

## Project Structure

```
business-iq-enterprise/
├── agentuity.json              # Agentuity project config (projectId, region)
├── agentuity.config.ts         # Build-time config (frontend env vars, Vite plugins)
├── app.ts                      # App entry point (createApp lifecycle)
├── package.json                # Dependencies and scripts
├── tsconfig.json               # TypeScript configuration
├── drizzle.config.ts           # Drizzle ORM migration config
│
├── src/
│   ├── agent/                  # AI Agents (auto-discovered at build time)
│   │   ├── data-science/       #   Advanced analytics & data processing
│   │   ├── document-scanner/   #   Barcode/QR, OCR stock sheets & invoices
│   │   ├── insights-analyzer/  #   Demand forecasting, anomaly detection
│   │   ├── knowledge-base/     #   Document ingestion & semantic search
│   │   └── report-generator/   #   Automated report generation
│   │
│   ├── api/                    # HTTP API Routes (Hono-based)
│   │   ├── index.ts            #   Route barrel file (all exports)
│   │   ├── config.ts           #   /api/config, /api/health
│   │   ├── products.ts         #   /api/products CRUD
│   │   ├── categories.ts       #   /api/categories CRUD + tree
│   │   ├── customers.ts        #   /api/customers CRUD
│   │   ├── warehouses.ts       #   /api/warehouses CRUD
│   │   ├── inventory.ts        #   /api/inventory (stock, adjustments, transfers)
│   │   ├── orders.ts           #   /api/orders CRUD + status management
│   │   ├── invoices.ts         #   /api/invoices CRUD + payments + from-scan
│   │   ├── pricing.ts          #   /api/pricing calculations + tax rules
│   │   ├── scanning.ts         #   /api/scan/* (barcode, stock sheet, invoice OCR)
│   │   ├── admin.ts            #   /api/admin (stats, users, config, approvals)
│   │   ├── documents.ts        #   /api/admin/documents (knowledge base)
│   │   ├── chat.ts             #   /api/chat (AI assistant)
│   │   ├── kra.ts              #   /api/kra (eTIMS invoice verification)
│   │   ├── settings.ts         #   /api/settings (system preferences)
│   │   ├── auth.ts             #   /api/auth (login, JWT, sessions)
│   │   └── reports.ts          #   /api/reports (AI report generation)
│   │
│   ├── db/                     # Database Layer
│   │   ├── schema.ts           #   Drizzle schema (all tables + relations)
│   │   └── index.ts            #   Database connection + query builder
│   │
│   ├── services/               # Business Logic Layer
│   │   ├── products.ts         #   Product CRUD operations
│   │   ├── categories.ts       #   Category tree management
│   │   ├── customers.ts        #   Customer management
│   │   ├── warehouses.ts       #   Warehouse operations
│   │   ├── inventory.ts        #   Stock management + transactions
│   │   ├── orders.ts           #   Order lifecycle management
│   │   ├── invoices.ts         #   Invoice generation + payments + from-scan
│   │   ├── pricing.ts          #   Price calculation + tax rules
│   │   ├── admin.ts            #   Admin operations + statistics
│   │   ├── auth.ts             #   JWT authentication + RBAC
│   │   ├── agent-configs.ts    #   AI agent configuration management
│   │   ├── kra-etims.ts        #   KRA eTIMS integration
│   │   ├── payments-integration.ts #  Payment gateway integrations
│   │   ├── settings.ts         #   System settings persistence
│   │   └── index.ts            #   Service barrel file
│   │
│   ├── lib/                    # Shared Utilities
│   │   ├── ai.ts               #   AI provider configuration
│   │   ├── config.ts           #   Environment-driven app config
│   │   ├── errors.ts           #   Error handling middleware
│   │   ├── pagination.ts       #   Pagination helpers
│   │   ├── validation.ts       #   Zod validation utilities
│   │   └── chunker.ts          #   Document chunking for vector store
│   │
│   ├── web/                    # Frontend (React + Vite)
│   │   ├── index.html          #   Vite entry point
│   │   ├── main.tsx            #   React bootstrap (AgentuityProvider)
│   │   ├── App.tsx             #   Main app component + routing
│   │   ├── components/         #   Shared UI components
│   │   │   └── Sidebar.tsx     #     Navigation sidebar
│   │   ├── pages/              #   Page components
│   │   │   ├── Dashboard.tsx   #     System overview + health
│   │   │   ├── ProductsPage.tsx#     Product management
│   │   │   ├── OrdersPage.tsx  #     Order management
│   │   │   ├── CustomersPage.tsx#    Customer management
│   │   │   ├── InventoryPage.tsx#    Stock levels + warehouses
│   │   │   ├── InvoicesPage.tsx#     Invoice management
│   │   │   ├── AdminPage.tsx   #     System admin + approval workflows
│   │   │   ├── AssistantPage.tsx#    AI chat assistant + scanner
│   │   │   ├── POSPage.tsx     #     Point of Sale + barcode scanning
│   │   │   ├── InvoiceCheckerPage.tsx # KRA eTIMS + OCR invoice import
│   │   │   ├── LoginPage.tsx   #     Authentication
│   │   │   ├── SettingsPage.tsx#     User preferences
│   │   │   ├── AboutPage.tsx   #     Platform info
│   │   │   ├── EmailPage.tsx   #     Email management
│   │   │   └── ReportsPage.tsx #     AI report generation
│   │   └── styles/             #   CSS stylesheets
│   │
│   ├── types/                  # TypeScript type declarations
│   └── generated/              # Auto-generated by Agentuity CLI (gitignored)
│
├── scripts/                    # Build & validation scripts
│   ├── pre-deploy.ts           #   Pre-deployment validation (6 checks)
│   ├── build.ts                #   Windows-safe build wrapper
│   └── fix-generated-paths.ts  #   Fix Windows backslash paths
│
└── .copilot/skills/            # Platform documentation (dev reference only)
```

---

## AI Agents

| Agent | Purpose | Input | Output |
|-------|---------|-------|--------|
| **data-science** | Advanced analytics, data processing, and statistical analysis | `{ query, dataset?, parameters? }` | `{ results, visualizations?, summary }` |
| **document-scanner** | Barcode/QR scanning, OCR stock sheets, OCR invoices via GPT-4o vision | `{ mode, imageData?, imageUrl? }` | `{ success, mode, data, confidence }` |
| **insights-analyzer** | Demand forecasting, anomaly detection, restock recommendations, sales trends | `{ analysis, timeframeDays, productId?, limit }` | `{ analysisType, insights[], summary }` |
| **knowledge-base** | Document ingestion, semantic search, and retrieval | `{ action, question?, documents?, keys? }` | `{ answer?, sources?, success }` |
| **report-generator** | Automated business reports (sales, inventory, customer, financial) | `{ reportType, startDate?, endDate?, format }` | `{ title, period, content, generatedAt }` |

Agents communicate via typed schemas (Zod) and can call each other cross-agent. The business assistant orchestrates other agents to answer complex questions.

### Document Scanner Agent

The **document-scanner** agent uses multimodal AI (GPT-4o vision) to process images in three modes:

| Mode | What It Does | Output |
|------|-------------|--------|
| `barcode` | Extracts barcode/QR code values (EAN-13, UPC-A, Code-128, QR, DataMatrix) | `{ found, type, value, format, confidence }` |
| `stock-sheet` | OCR reads tabular inventory data from photos of stock sheets | `{ items[{name, sku, quantity, unit, location}], documentDate, confidence }` |
| `invoice` | Extracts supplier invoice fields (number, supplier, amounts, line items) | `{ invoiceNumber, supplierName, lineItems[], totalAmount, confidence }` |

All three modes are exposed via API endpoints (`POST /api/scan/barcode`, `/api/scan/stock`, `/api/scan/invoice`) and integrated into the frontend with **review & confirm** UIs — users review extracted data before applying changes.

---

## Database Schema

The database is **industry-neutral** — generic column names with `metadata` JSONB columns for vertical-specific attributes.

| Table | Purpose |
|-------|---------|
| `categories` | Hierarchical product grouping (self-referencing parent) |
| `products` | Core items — SKU, pricing, units, stock levels |
| `warehouses` | Storage locations |
| `inventory` | Stock levels per product per warehouse |
| `inventory_transactions` | Audit trail for all stock changes |
| `customers` | Customer records with credit limits and balances |
| `order_statuses` | Configurable order workflow states (per deployment) |
| `orders` | Sales orders with line items |
| `order_items` | Line items within orders |
| `invoices` | Invoices linked to orders/customers |
| `invoice_items` | Line items within invoices |
| `payments` | Payment records against invoices |
| `tax_rules` | Configurable tax calculation rules |
| `users` | System users with role hierarchy and `reportsTo` chain |
| `approval_workflows` | Configurable multi-step approval chains per action type |
| `approval_workflow_steps` | Individual steps within approval workflows (role + order) |
| `approval_requests` | Pending/approved/rejected approval requests |
| `approval_request_steps` | Step-by-step audit trail for each approval request |
| `chat_sessions` | AI assistant conversation sessions |
| `chat_messages` | Individual messages within chat sessions |

---

## Industry-Agnostic Design

The same codebase serves any industry. Configuration is purely through environment variables:

| Variable | Example (Restaurant) | Example (Hardware Store) | Example (Chemical Supplier) |
|----------|---------------------|--------------------------|----------------------------|
| `PRODUCT_LABEL` | Menu Item | Product | Chemical |
| `ORDER_LABEL` | Ticket | Sales Order | Purchase Order |
| `CUSTOMER_LABEL` | Guest | Customer | Account |
| `WAREHOUSE_LABEL` | Kitchen | Store | Depot |
| `UNIT_DEFAULT` | portion | piece | kg |
| `CURRENCY` | USD | EUR | GBP |
| `COMPANY_NAME` | Joe's Diner | Bob's Hardware | ChemCorp |

No code branches, no industry conditionals, no vertical-specific columns. Same schema, same agents, same frontend — only config changes.

---

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) (v1.3+)
- [Agentuity CLI](https://agentuity.dev) (v1.0+)
- [WSL Ubuntu 24.04](https://learn.microsoft.com/en-us/windows/wsl/) (for Windows users)
- Node.js 20+ (for some dev tools)

### Installation

```bash
git clone https://github.com/buddha-maitreya/business-iq-enterprise.git
cd business-iq-enterprise
bun install
```

### Environment Setup

```bash
# Create Agentuity project (one-time)
agentuity project create --name business-iq-enterprise --database new

# Pull environment variables (DATABASE_URL, AGENTUITY_SDK_KEY)
agentuity cloud env pull

# Run database migrations
bunx drizzle-kit migrate
```

### Configuration

Create or edit `.env` with your client-specific settings:

```env
# Branding
COMPANY_NAME=My Business
COMPANY_LOGO_URL=https://example.com/logo.png

# Localization
CURRENCY=USD
TAX_RATE=0.08
TIMEZONE=America/Los_Angeles

# Industry Terminology
PRODUCT_LABEL=Product
PRODUCT_LABEL_PLURAL=Products
ORDER_LABEL=Order
ORDER_LABEL_PLURAL=Orders
CUSTOMER_LABEL=Customer
CUSTOMER_LABEL_PLURAL=Customers
WAREHOUSE_LABEL=Warehouse
INVOICE_LABEL=Invoice
UNIT_DEFAULT=piece

# AI Provider
LLM_PROVIDER_KEY=your-api-key
```

### Development

```bash
agentuity dev       # Start dev server with hot reload
```

### Build & Deploy

```bash
# Validate before deploying
bun run validate

# Build
agentuity build

# Deploy (from WSL on Windows)
agentuity deploy
```

**Windows users:** All builds and deploys must run from WSL (Ubuntu 24.04) to avoid path issues. See the [deployment workflow](#deployment-workflow) section.

---

## Deployment Workflow

### Standard Process (WSL)

```
1. Develop on Windows (edit code in VS Code)
2. Commit and push:
     git add -A && git commit -m "message" && git push
3. Deploy from WSL:
     cd ~/business-iq-enterprise && git pull && agentuity deploy
```

---

## New Client Installation Guide

Every client gets their own fully isolated deployment — separate Agentuity project, separate database, separate configuration. The process below can be performed by the client themselves (self-service) or by the vendor on the client's behalf.

### Prerequisites (One-Time)

The person deploying needs:

| Requirement | How to Install |
|------------|---------------|
| **Bun** (v1.3+) | `curl -fsSL https://bun.sh/install \| bash` |
| **Agentuity CLI** (v1.0+) | `curl -sSL https://agentuity.sh \| sh` |
| **Git** | Pre-installed on most systems, or `sudo apt install git` |
| **Agentuity Account** | Sign up at [app.agentuity.com](https://app.agentuity.com) |
| **Linux / macOS / WSL** | Windows users need WSL Ubuntu 24.04 for builds |

### Step-by-Step Installation

#### 1. Authenticate with Agentuity

```bash
agentuity login
```

This opens a browser for authentication. Follow the prompts to log in.

#### 2. Clone the Repository

```bash
git clone https://github.com/buddha-maitreya/business-iq-enterprise.git
cd business-iq-enterprise
```

#### 3. Install Dependencies

```bash
bun install
```

#### 4. Create Client Project & Database

```bash
agentuity project create --name "client-company-name" --database new --no-build
```

This command:
- Registers the project with Agentuity cloud
- Creates `agentuity.json` with the new `projectId` and `orgId`
- Provisions a dedicated Neon Postgres database
- Auto-injects `DATABASE_URL` and `AGENTUITY_SDK_KEY` into the environment

> **`--no-build`** skips the initial build (we configure env vars first).

#### 5. Pull Environment Secrets

```bash
agentuity cloud env pull
```

This writes `DATABASE_URL` and `AGENTUITY_SDK_KEY` into `.env`.

#### 6. Configure Client Environment

Edit `.env` (or set via Agentuity dashboard → Secrets) with client-specific values:

```env
# ── Branding ──────────────────────────────────
COMPANY_NAME=Acme Corporation
COMPANY_LOGO_URL=https://acme.com/logo.png

# ── Localization ──────────────────────────────
CURRENCY=USD
TAX_RATE=0.08
TIMEZONE=America/New_York

# ── Industry Terminology ──────────────────────
# Customize labels to match the client's industry.
# These control what the UI displays — the code never changes.
PRODUCT_LABEL=Product
PRODUCT_LABEL_PLURAL=Products
ORDER_LABEL=Order
ORDER_LABEL_PLURAL=Orders
CUSTOMER_LABEL=Customer
CUSTOMER_LABEL_PLURAL=Customers
WAREHOUSE_LABEL=Warehouse
INVOICE_LABEL=Invoice
UNIT_DEFAULT=piece

# ── AI Provider ───────────────────────────────
LLM_PROVIDER_KEY=sk-...    # OpenAI, Anthropic, or Groq API key
```

**Industry examples:**

| Setting | Restaurant | Hardware Store | Medical Supplier |
|---------|-----------|---------------|-----------------|
| `PRODUCT_LABEL` | Menu Item | Product | Supply |
| `ORDER_LABEL` | Ticket | Sales Order | Requisition |
| `CUSTOMER_LABEL` | Guest | Customer | Facility |
| `WAREHOUSE_LABEL` | Kitchen | Store | Distribution Center |
| `UNIT_DEFAULT` | portion | piece | unit |

#### 7. Push Environment to Cloud

```bash
agentuity cloud env push
```

This syncs your `.env` values to the Agentuity cloud so the deployed app can read them.

#### 8. Deploy

```bash
agentuity deploy
```

Expected output:
```
✓ Sync Env & Secrets
✓ Build, Verify and Package
  ✓ Typechecked in ~12s
  ✓ Client built in ~2s
  ✓ Server built in ~1s
✓ Security Scan
✓ Encrypt and Upload Deployment
✓ Provision Deployment
✓ Your project was deployed!

→ Project: https://client-company-name-org-name.agentuity.run
```

#### 9. Run Database Migrations

```bash
bunx drizzle-kit migrate
```

This creates all tables in the client's dedicated database.

#### 10. (Optional) Seed Initial Data

```bash
bun scripts/seed-demo.ts
```

Populates the database with starter data: default order statuses, sample tax rules, and optionally sample products/customers for testing.

### Post-Installation Checklist

| Step | Verify |
|------|--------|
| App loads | Visit the project URL — dashboard should render |
| Health check | `GET /api/health` returns `{"status":"ok"}` |
| Branding correct | Company name and labels match `.env` config |
| Database connected | Products/Customers pages load (empty is fine) |
| AI working | AI Assistant page responds to messages |

### Updating a Client Deployment

When new features are released:

```bash
cd business-iq-enterprise
git pull                    # Get latest code
agentuity deploy            # Rebuild and deploy
bunx drizzle-kit migrate    # Apply any new migrations (safe to re-run)
```

The client's data, configuration, and environment variables are preserved across deployments. Only the code is updated.

### Architecture: What Each Client Gets

```
┌────────────────────────────────────────────────┐
│  Client: Acme Corporation                      │
│                                                │
│  Agentuity Project: acme-corp-biq              │
│  URL: acme-corp-biq-org.agentuity.run          │
│                                                │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐ │
│  │ Frontend │  │  Server  │  │  5 AI Agents │ │
│  │ (React)  │  │  (Hono)  │  │              │ │
│  └──────────┘  └──────────┘  └──────────────┘ │
│                      │                         │
│                      ▼                         │
│            ┌──────────────────┐                │
│            │  Neon Postgres   │                │
│            │  (dedicated DB)  │                │
│            └──────────────────┘                │
│                                                │
│  Config: COMPANY_NAME=Acme Corporation         │
│          CURRENCY=USD                          │
│          PRODUCT_LABEL=Product                 │
│          ...                                   │
└────────────────────────────────────────────────┘
```

Each client is completely isolated:
- **Separate compute** — own Agentuity deployment
- **Separate database** — own Neon Postgres instance
- **Separate config** — own environment variables
- **Separate URL** — own subdomain
- **Separate AI context** — own knowledge base and conversation history

No data crosses between clients. No shared infrastructure. No tenant ID columns.

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/config` | App configuration (labels, branding) |
| GET/POST/PUT/DELETE | `/api/products` | Product CRUD |
| GET/POST/PUT/DELETE | `/api/categories` | Category CRUD + tree |
| GET/POST/PUT/DELETE | `/api/customers` | Customer CRUD |
| GET/POST/PUT/DELETE | `/api/warehouses` | Warehouse CRUD |
| GET/POST | `/api/inventory/*` | Stock levels, adjustments, transfers, bulk import |
| POST | `/api/inventory/bulk-adjust` | Apply OCR-scanned stock sheet data |
| GET/POST/PUT | `/api/orders` | Order lifecycle management |
| GET/POST | `/api/invoices` | Invoice management + payments |
| POST | `/api/invoices/from-scan` | Create invoice from OCR data (with dedup check) |
| POST | `/api/invoices/check-duplicate` | Check if invoice number already exists |
| GET/POST | `/api/pricing` | Price calculations + tax rules |
| GET/POST/PUT/DELETE | `/api/admin/*` | Admin operations, users, config |
| GET/POST/PUT/DELETE | `/api/approvals/*` | Approval workflows, requests, inbox |
| POST | `/api/admin/documents` | Knowledge base document management |
| POST | `/api/products/lookup-barcode` | Find product by barcode value |
| POST | `/api/products/fuzzy-match` | Match OCR-extracted names to products |
| POST | `/api/scan/barcode` | Scan barcode/QR code from image |
| POST | `/api/scan/stock` | OCR stock sheet for bulk inventory import |
| POST | `/api/scan/invoice` | OCR invoice for data extraction |
| POST | `/api/chat` | AI assistant chat (streaming) |
| POST | `/api/reports` | AI report generation |
| POST | `/api/kra/invoice/check` | Verify invoice against KRA eTIMS |
| POST | `/api/auth/login` | JWT authentication |
| GET | `/api/settings` | User/system preferences |

---

## Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `dev` | `agentuity dev` | Start development server |
| `build` | `bun scripts/build.ts` | Build with Windows path fix |
| `validate` | `bun scripts/pre-deploy.ts` | Pre-deploy validation (6 checks) |
| `deploy` | `bun scripts/build.ts --deploy` | Build + deploy |
| `db:generate` | `bunx drizzle-kit generate` | Generate migration files |
| `db:migrate` | `bunx drizzle-kit migrate` | Run migrations |
| `db:push` | `bunx drizzle-kit push` | Push schema directly |
| `db:studio` | `bunx drizzle-kit studio` | Open Drizzle Studio GUI |

---

## License

Private — All rights reserved.
