# Copilot Instructions — Business IQ Enterprise

This is an enterprise-grade, **industry-agnostic** Inventory & Sales Management platform built on **Agentuity** (https://agentuity.dev).

## Design Philosophy — Industry-Agnostic

This platform is designed to work for **any industry** — retail, wholesale, manufacturing, food & beverage, healthcare, construction, agriculture, or any business that manages inventory and sales. The codebase contains **zero industry-specific hardcoding**.

### Core Principles
- **Generic domain models** — Use universal terms: "product" (not "SKU", "part", "ingredient"), "category" (not "department", "aisle"), "customer" (not "patient", "contractor"). Industries map their terminology via UI labels.
- **Configurable via environment variables** — Industry-specific labels, units of measure, tax rules, document titles, and workflows are driven by env vars and config, never by code branches.
- **Flexible units & measurements** — Support arbitrary units (pieces, kg, liters, meters, pallets, etc.) as data, not enums. Units are stored on the product record, not hardcoded.
- **Pluggable tax & pricing** — Tax calculation is driven by `TAX_RATE` and extensible tax rule configs, not by country-specific or industry-specific tax logic baked into code.
- **Neutral terminology in code** — Variables, database columns, agent names, and API endpoints use generic business language. Comments and labels never assume a specific vertical.
- **No hardcoded workflows** — Order statuses, approval chains, and fulfillment steps are configurable data, not fixed enums. Different industries have different flows.
- **Extensible metadata** — Products, orders, and customers have a `metadata` JSONB column for industry-specific attributes without schema changes.

### What This Means in Practice
- A **restaurant** deploys this with `PRODUCT_LABEL=Menu Item`, `UNIT_DEFAULT=portion`, `ORDER_LABEL=Ticket`.
- A **hardware store** deploys with `PRODUCT_LABEL=Product`, `UNIT_DEFAULT=piece`, `ORDER_LABEL=Sales Order`.
- A **chemical supplier** deploys with `PRODUCT_LABEL=Chemical`, `UNIT_DEFAULT=kg`, `ORDER_LABEL=Purchase Order`.
- **Same code, same schema, same agents** — only config changes.

## Architecture Model — Single-Tenant

This application follows a **single-tenant architecture**. Every client deployment is fully isolated:

- **One codebase, many deployments** — The same source code is deployed to each client's own Agentuity instance.
- **Dedicated server per client** — Each client runs on their own Agentuity deployment. No shared compute.
- **Dedicated database per client** — Each client has their own Neon Postgres database. No shared data, no tenant ID filtering, no row-level security hacks.
- **Dedicated environment variables** — Each deployment has its own `.env` / Agentuity console config (DATABASE_URL, API keys, branding, etc.).
- **Client-specific customization** — Feature flags, branding, industry terminology, and config are controlled per-deployment via environment variables, NOT via database tenant columns.

### Implications for Development
- **Never add `tenant_id` columns or multi-tenant filtering** — the database belongs to one client.
- **Never share KV namespaces, vector stores, or storage across clients** — each deployment is isolated by infrastructure.
- **Environment variables are the config boundary** — use `process.env` / Agentuity secrets for all client-specific config (company name, logo URL, currency, tax rates, industry labels, etc.).
- **Database schema is universal and industry-neutral** — every client gets the same schema; migrations run per-deployment. No industry-specific columns — use `metadata` JSONB for vertical-specific attributes.
- **Agents, routes, and frontend are identical across clients and industries** — behavior differences come from env config, not code branches or industry conditionals.

### Deployment Workflow
```
# For each client:
1. Create Agentuity project for client (or use separate org)
2. Provision database: `agentuity cloud db create --name "client-db"`
   (DATABASE_URL is auto-injected into .env and deployment secrets)
3. Configure remaining env vars / Agentuity secrets (branding, labels, etc.)
4. Deploy: `agentuity deploy`
5. Run migrations: `bunx drizzle-kit migrate`
```

## Tech Stack
- **Runtime:** Bun
- **Language:** TypeScript (strict mode)
- **Frontend:** React with `@agentuity/react` hooks
- **Backend:** Agentuity agents + Hono-based routes
- **Database:** Neon Postgres via `@agentuity/drizzle` (Drizzle ORM) — provisioned by Agentuity, one DB per client
- **AI:** Vercel AI SDK (`ai` package) + OpenAI/Groq via AI Gateway
- **Schema Validation:** Zod
- **Deployment:** `agentuity deploy` (per-client)

## Key Conventions

### Agents (src/agent/)
- Each agent lives in `src/agent/<name>/agent.ts`
- Use `createAgent()` from `@agentuity/runtime`
- Always define `schema.input` and `schema.output` with Zod
- Handler receives `(ctx, input)` — types are inferred from schema
- Use `ctx.logger` (never `console.log`)
- Use `ctx.kv` for key-value storage, `ctx.vector` for semantic search
- Use `ctx.thread.state` for conversation persistence
- Import other agents with `import agentName from '@agent/agent-name'`

### Routes (src/api/)
- Use `createRouter()` from `@agentuity/runtime`
- Use `agent.validator()` middleware for request validation
- Access services via `c.var.kv`, `c.var.vector`, `c.var.logger`
- Use `stream()` middleware for streaming responses
- Use `cron()` middleware for scheduled tasks
- Use `websocket()` for real-time bidirectional comms

### Database
- Schema defined in `src/db/schema.ts` using `drizzle-orm/pg-core`
- Use `createPostgresDrizzle()` from `@agentuity/drizzle`
- Always use parameterized queries (template literals for raw SQL)
- Migrations via `bunx drizzle-kit generate && bunx drizzle-kit migrate`
- **No tenant_id columns** — single-tenant, whole DB belongs to one client
- **Industry-neutral schema** — use generic column names (`name`, `unit`, `price`). Store industry-specific attributes in `metadata` JSONB columns.
- **No hardcoded enums for statuses/types** — use `varchar` or reference tables so each deployment can define its own workflows.

### Frontend (src/web/)
- Use `useAPI()` for request/response patterns
- Use `useWebsocket()` for real-time communication
- Use `useEventStream()` for server push
- Wrap app in `<AgentuityProvider>`
- Client branding (logo, colors, company name) AND industry terminology (labels, units) loaded from env-driven config endpoint

### Client Configuration (Environment Variables)
All client-specific values are injected via environment variables:
```
# Infrastructure (auto-injected by Agentuity)
# DATABASE_URL — auto-set by `agentuity cloud db create`
# AGENTUITY_SDK_KEY — auto-set by Agentuity project
LLM_PROVIDER_KEY=       # AI API key (may be client's own)

# Branding
COMPANY_NAME=           # Client's business name
COMPANY_LOGO_URL=       # Client's logo

# Localization
CURRENCY=               # e.g. USD, EUR, GBP
TAX_RATE=               # Default tax rate
TIMEZONE=               # Client's timezone

# Industry Terminology (labels shown in UI)
PRODUCT_LABEL=Product         # e.g. "Item", "Part", "Ingredient", "SKU"
PRODUCT_LABEL_PLURAL=Products # e.g. "Items", "Parts", "Ingredients"
ORDER_LABEL=Order             # e.g. "Sales Order", "Ticket", "Work Order"
ORDER_LABEL_PLURAL=Orders     # e.g. "Sales Orders", "Tickets"
CUSTOMER_LABEL=Customer       # e.g. "Client", "Patient", "Account"
CUSTOMER_LABEL_PLURAL=Customers
WAREHOUSE_LABEL=Warehouse     # e.g. "Store", "Location", "Depot"
INVOICE_LABEL=Invoice         # e.g. "Bill", "Receipt", "Statement"
UNIT_DEFAULT=piece            # Default unit of measure (piece, kg, liter, etc.)
```

## Reference Documentation
Detailed Agentuity platform documentation is available in the `.copilot/skills/` directory.
Always consult these files when working with Agentuity-specific APIs.
