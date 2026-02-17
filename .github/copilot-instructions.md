# Copilot Instructions — Business IQ Enterprise

This is an enterprise-grade, **industry-agnostic** Inventory & Sales Management platform built on **Agentuity** (https://agentuity.dev).

## Development Philosophy — Holistic, Not Patchwork

**Every change must be grounded in the platform documentation.** This project ships with comprehensive `.copilot/skills/*.md` files that document how every Agentuity API, convention, and pattern works. These files exist for a reason — they are the **single source of truth** for how to build on this platform.

### Rules of Engagement
1. **Read the docs first, code second.** Before writing or modifying any code that touches Agentuity APIs (agents, routes, storage, deployment, CLI), **always** consult the relevant `.copilot/skills/` file. Do not guess, assume, or rely on general knowledge — the platform has specific conventions that must be followed exactly.
2. **No patchwork.** Never apply quick fixes, band-aids, or trial-and-error hacks. If something doesn't work, stop and understand *why* by reading the documentation. A correct solution built once is worth more than five speculative patches.
3. **Holistic understanding.** Every change should account for the full system: database schema, service layer, API routes, agents, frontend, and deployment config. Changing one layer without updating the others creates drift and bugs.
4. **Validate against real examples.** When the docs reference patterns or conventions, follow them precisely. File naming, export patterns, import conventions, and JSON schemas all have specific requirements documented in the skills files.
5. **When stuck, research before retrying.** If a command fails or code doesn't build, read the relevant documentation to understand the expected behavior. Check the skills files for the correct flags, formats, and workflows — don't re-run the same failing command with random variations.

### Skills Documentation Index
| File | Covers |
|------|--------|
| `agentuity-app-configuration.md` | `agentuity.json` structure, `app.ts` lifecycle, CORS, compression |
| `agentuity-build-configuration.md` | `agentuity.config.ts`, build-time env vars, Vite config |
| `agentuity-creating-agents.md` | Agent file structure, `createAgent()`, schemas, handlers |
| `agentuity-agents.md` | Agent communication, triggers, cross-agent calls |
| `agentuity-routes.md` / `agentuity-routing.md` | `createRouter()`, middleware, streaming, cron, websockets |
| `agentuity-http-routes.md` | HTTP route patterns, request/response handling |
| `agentuity-frontend.md` | React hooks (`useAPI`, `useWebsocket`, `useEventStream`), auth |
| `agentuity-storage.md` | KV, vector, object storage, Redis APIs |
| `agentuity-sdk-reference.md` | Full SDK API surface |
| `agentuity-apis.md` | External API patterns |
| `agentuity-cli-reference.md` | CLI commands, auth, deploy, storage, debugging |
| `agentuity-logging.md` | Structured logging via `ctx.logger` |
| `agentuity-sandbox.md` | Sandbox environments |
| `agentuity-sessions-debugging.md` | Session inspection, debugging deployed agents |
| `agentuity-single-tenant-deployment.md` | Per-client deployment model |

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

## Deployment Rules

### No Markdown Files in Deployment Bundles
**Never import `.md` files in any source code file** (agents, routes, services, libs, frontend). Markdown files exist in the repository for development reference only — they are **not runtime artifacts** and must never be bundled into deployed code.

- `.copilot/skills/*.md` — Copilot-only reference docs. **Never import.**
- `.github/*.md` — GitHub/Copilot configuration. **Never import.**
- `ROADMAP.md`, `CHANGELOG.md`, `README.md` — Project docs. **Never import.**
- `src/generated/*.md` — Build-time generated docs. **Never import.**

The Agentuity build system (Bun bundler for server, Vite for frontend) only includes files referenced via `import` statements. As long as `.md` files are never imported, they stay out of the deployment bundle. **This is a hard rule — no exceptions.**

If content from a markdown file is needed at runtime (e.g., agent system prompts), extract it into a `.ts` file as an exported string constant instead of importing the `.md` file directly.

### Pre-Deploy Validation
Before every deployment, run the validation script to catch errors early:
```bash
bun run validate          # or: bun scripts/pre-deploy.ts
```
This script performs:
1. TypeScript type checking (`tsc --noEmit --skipLibCheck`)
2. Verifies no `.md` file imports exist in source code
3. Verifies all agent `index.ts` files exist and export correctly
4. Runs `agentuity build` to catch bundling errors
5. Reports all errors with clear context — no guesswork needed

### Windows Path Issue & WSL Build Workflow
The Agentuity CLI generates `src/generated/*.ts` files with **Windows backslash paths** when run on Windows. Backslashes are interpreted as escape sequences (`\b` → backspace, `\r` → carriage return, `\n` → newline), corrupting import paths and failing both TypeScript and the Bun bundler. **This is a known CLI bug.**

**Solution:** All builds and deploys must run on Linux via WSL. The project has WSL (Ubuntu 24.04) configured with Bun and the Agentuity CLI installed.

**CRITICAL: All `wsl -d Ubuntu-24.04 -- bash -lc "..."` commands MUST be run from desktop Windows PowerShell, NEVER from inside WSL itself.** The `wsl` command is a Windows executable that calls into WSL — it does not exist inside Linux. If Copilot needs to run a WSL command, it must use the `run_in_terminal` tool targeting a PowerShell terminal.

**Generated files are gitignored** — `src/generated/*.ts` is in `.gitignore` to prevent Windows-generated files from being committed. The cloud build (Linux) regenerates them with correct paths.

**Build from desktop PowerShell (required):**
```powershell
wsl -d Ubuntu-24.04 -- bash -lc "cd ~/business-iq-enterprise && git pull && source ~/.bashrc && agentuity build"
```

**Deploy from desktop PowerShell (required):**
```powershell
wsl -d Ubuntu-24.04 -- bash -lc "cd ~/business-iq-enterprise && git pull && source ~/.bashrc && agentuity deploy"
```

**WSL environment setup (one-time, already done):**
1. `wsl --install Ubuntu-24.04` — Install Ubuntu in WSL
2. `curl -fsSL https://bun.sh/install | bash` — Install Bun
3. `curl -sSL https://agentuity.sh | sh` — Install Agentuity CLI
4. `sudo apt install -y unzip gh` — Install prerequisites
5. `gh auth login` — Authenticate GitHub
6. `git clone https://github.com/buddha-maitreya/business-iq-enterprise.git` — Clone project

**Important:** Always `git pull` inside WSL before building to sync with latest changes pushed from Windows.

### Deployment Workflow (Primary — WSL)
This is the **standard deployment process**. All builds and deploys run from WSL (Ubuntu 24.04) to avoid Windows path issues.

**Daily workflow:**
```
1. Develop on Windows (edit code in VS Code as usual)
2. Commit and push to GitHub from Windows PowerShell:
     git add -A && git commit -m "message" && git push
3. Deploy from desktop PowerShell (WSL one-liner):
     wsl -d Ubuntu-24.04 -- bash -lc "cd ~/business-iq-enterprise && git pull && source ~/.bashrc && agentuity deploy"
```

**NOTE:** The `wsl -d Ubuntu-24.04` command is a Windows executable. It must ALWAYS be run from desktop PowerShell. Never run it from inside a WSL/Linux terminal.

**Or from inside the WSL terminal directly (if the user opens one manually):**
```bash
cd ~/business-iq-enterprise
git pull                    # Sync latest code from GitHub
source ~/.bashrc            # Ensure bun/agentuity are on PATH
agentuity deploy            # Build + typecheck + deploy to cloud
```

**Expected output on success:**
```
✓ Sync Env & Secrets
✓ Build, Verify and Package
  ✓ Typechecked in ~9s
  ✓ Server built in ~1s
✓ Security Scan
✓ Encrypt and Upload Deployment
✓ Provision Deployment
✓ Your project was deployed!
```

**First-time WSL deploy setup (one-time, already done):**
```bash
agentuity login             # Browser-based auth — open URL, enter code
agentuity cloud env pull    # Pulls AGENTUITY_SDK_KEY + DATABASE_URL into .env
agentuity deploy            # Build, typecheck, deploy
```

**If auth expires**, re-run `agentuity login` inside WSL.

### Deployment Error Diagnosis
When a deployment fails:
1. **First**: Build in WSL to see if code compiles: `agentuity build`
2. **Second**: Check for TypeScript errors: `bunx tsc --noEmit --skipLibCheck`
3. **Third**: Deploy with verbose output: `agentuity deploy --log-level debug`
4. **Fourth**: Check cloud logs: `agentuity cloud deployment logs <deploy_id> --limit=100`
5. **Never speculate** — always capture the full error output before attempting fixes.

## Operational Notes

### Agentuity CLI Login (Windows / Copilot Agent)
The `agentuity auth login` command uses a browser-based spinner flow. In automated terminals the output scrolls too fast for the user. **Always** run it in a **background terminal**, then retrieve the output to extract the login URL/code and present it to the user in chat. See `.copilot/skills/agentuity-cli-reference.md` → "Login from Copilot / Automated Terminal" for the full procedure.

### Project Setup & Deployment
Per `.copilot/skills/agentuity-cli-reference.md` and `.copilot/skills/agentuity-app-configuration.md`:

1. **`agentuity.json` is minimal** — it contains `projectId`, `orgId`, `region`, and optionally `deployment` config. **Agents are NOT listed in this file** — they are auto-discovered from `src/agent/*/index.ts` at build time.
2. **Create a new project** (registers with cloud, populates `agentuity.json`):
   ```bash
   agentuity project create --name <name> --dir <path> --database new --no-install --no-build
   ```
   Use `--no-build` when the project already has code to avoid premature build failures.
3. **Set defaults before interactive commands**:
   ```bash
   agentuity auth org select <org_id>
   agentuity cloud region select usw
   ```
4. **Build**: `agentuity build` (run from WSL)
5. **Deploy**: `agentuity deploy` (run from WSL)
6. **Database**: `agentuity cloud db create --name <name>` auto-injects `DATABASE_URL`

### Agent File Convention
Each agent must be at `src/agent/<name>/index.ts` (not `agent.ts`). The SDK discovers agents by scanning for `index.ts` files in subdirectories of `src/agent/`. See `.copilot/skills/agentuity-creating-agents.md`.

### GitHub Repository
- **Repo:** https://github.com/buddha-maitreya/business-iq-enterprise
- **Branch:** main
