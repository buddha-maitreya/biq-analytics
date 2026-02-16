# Agentuity Single-Tenant, Industry-Agnostic Deployment Model

## Overview

Business IQ Enterprise uses a **single-tenant, industry-agnostic** architecture. Each client gets:

- Their own **Agentuity project** (dedicated compute)
- Their own **Neon Postgres database** (provisioned via `agentuity cloud db create`, `DATABASE_URL` auto-injected)
- Their own **KV / Vector namespaces** (scoped to project)
- Their own **environment variables** (branding, config, API keys)

The **codebase is identical** across all clients and industries. All per-client and per-industry behavior is driven by environment variables.

---

## Client Onboarding Runbook

### 1. Provision Database
```bash
# Agentuity provides Neon Postgres as a built-in service
agentuity cloud db create --name "client-name-db" --description "Client Name - Business IQ"

# DATABASE_URL is automatically added to .env and deployment secrets
# No need to visit Neon Console or manually copy connection strings
```

### 2. Create Agentuity Project
```bash
# Option A: New project in existing org
agentuity project create --name "biq-client-name"

# Option B: Separate org per client (for billing isolation)
# Create via Agentuity Console
```

### 3. Configure Environment Variables

Set these in Agentuity Console → Project → Secrets, or in `.env` for local dev:

| Variable | Example | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | *(auto-injected by `agentuity cloud db create`)* | Client's Neon Postgres (auto-provisioned) |
| `AGENTUITY_SDK_KEY` | `sk-agentuity-...` | Project SDK key |
| `COMPANY_NAME` | `Acme Corp` | Displayed in UI header, reports |
| `COMPANY_LOGO_URL` | `https://...logo.png` | Brand logo |
| `CURRENCY` | `USD` | Currency for pricing/invoices |
| `TAX_RATE` | `0.08` | Default tax rate (8%) |
| `TIMEZONE` | `America/New_York` | Client timezone |
| `LLM_PROVIDER_KEY` | `sk-...` | OpenAI/Groq API key || `PRODUCT_LABEL` | `Product` / `Part` / `Ingredient` | Industry term for products |
| `PRODUCT_LABEL_PLURAL` | `Products` / `Parts` | Plural form |
| `ORDER_LABEL` | `Order` / `Ticket` / `Work Order` | Industry term for orders |
| `ORDER_LABEL_PLURAL` | `Orders` / `Tickets` | Plural form |
| `CUSTOMER_LABEL` | `Customer` / `Client` / `Patient` | Industry term for customers |
| `CUSTOMER_LABEL_PLURAL` | `Customers` / `Clients` | Plural form |
| `WAREHOUSE_LABEL` | `Warehouse` / `Store` / `Depot` | Industry term for locations |
| `INVOICE_LABEL` | `Invoice` / `Bill` / `Receipt` | Industry term for invoices |
| `UNIT_DEFAULT` | `piece` / `kg` / `liter` | Default unit of measure |
### 4. Deploy
```bash
agentuity deploy
```

### 5. Run Migrations
```bash
bunx drizzle-kit migrate
```

### 6. Verify
- Hit the health check endpoint
- Confirm database connectivity
- Test a product creation flow
- Verify branding loads correctly

---

## Development Guidelines

### DO
- Use `process.env.COMPANY_NAME` etc. for all client-specific values
- Use `process.env.PRODUCT_LABEL` etc. for all industry terminology in the UI
- Keep the database schema universal and industry-neutral — same tables, same columns for every client
- Use `metadata` JSONB columns for industry-specific attributes
- Use free-form `unit` varchar fields, not hardcoded enums
- Test locally with a dev `.env` that mimics a client config
- Run migrations on each client's database after schema changes

### DON'T
- Add `tenant_id` columns — the whole DB is one client's
- Add conditionals based on client identity or industry in business logic
- Hardcode industry-specific terms ("SKU", "patient", "aisle") in code
- Hardcode order statuses or workflow steps as enums
- Share KV keys or vector namespaces across deployments
- Hardcode any client-specific values in source code

---

## Updating All Clients

When you ship a new feature or fix:

```bash
# For each client project:
agentuity deploy --project <client-project-id>
bunx drizzle-kit migrate  # if schema changed
```

Consider automating this with a deployment script that iterates over a manifest of client project IDs.

---

## Config Endpoint Pattern

Expose a `/api/config` route that returns client-specific branding and industry terminology from env vars:

```typescript
// src/api/index.ts
router.get('/config', (c) => {
  return c.json({
    companyName: process.env.COMPANY_NAME ?? 'Business IQ',
    logoUrl: process.env.COMPANY_LOGO_URL ?? '/logo.svg',
    currency: process.env.CURRENCY ?? 'USD',
    taxRate: parseFloat(process.env.TAX_RATE ?? '0'),
    timezone: process.env.TIMEZONE ?? 'UTC',
    // Industry terminology
    labels: {
      product: process.env.PRODUCT_LABEL ?? 'Product',
      productPlural: process.env.PRODUCT_LABEL_PLURAL ?? 'Products',
      order: process.env.ORDER_LABEL ?? 'Order',
      orderPlural: process.env.ORDER_LABEL_PLURAL ?? 'Orders',
      customer: process.env.CUSTOMER_LABEL ?? 'Customer',
      customerPlural: process.env.CUSTOMER_LABEL_PLURAL ?? 'Customers',
      warehouse: process.env.WAREHOUSE_LABEL ?? 'Warehouse',
      invoice: process.env.INVOICE_LABEL ?? 'Invoice',
      unitDefault: process.env.UNIT_DEFAULT ?? 'piece',
    },
  });
});
```

The frontend fetches this on load to apply branding, locale settings, and industry-specific labels throughout the UI.
