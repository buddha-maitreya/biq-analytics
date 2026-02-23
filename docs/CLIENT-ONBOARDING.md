# Client Onboarding Guide

**Business IQ Enterprise — Single-Tenant Deployment**

This guide covers the complete process for onboarding a new client, from initial deployment to post-deploy configuration, analytics sandbox setup, and troubleshooting.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Deployment Workflow](#deployment-workflow)
3. [Database Setup](#database-setup)
4. [Environment Configuration](#environment-configuration)
5. [POS Integration](#pos-integration)
6. [Analytics Sandbox Setup (Python)](#analytics-sandbox-setup-python)
7. [Post-Deployment Verification](#post-deployment-verification)
8. [Agent Configuration](#agent-configuration)
9. [Troubleshooting](#troubleshooting)

---

## Prerequisites

Before onboarding a new client, ensure you have:

- [ ] Agentuity CLI installed and authenticated (`agentuity login`)
- [ ] Access to the Agentuity console ([https://console.agentuity.dev](https://console.agentuity.dev))
- [ ] GitHub access to the repository
- [ ] WSL (Ubuntu 24.04) configured on the deployment machine (Windows)
- [ ] Client configuration details collected (see [Environment Configuration](#environment-configuration))

### WSL Setup (One-Time — Already Done on Dev Machine)

```bash
# Install Ubuntu in WSL
wsl --install Ubuntu-24.04

# Inside WSL:
curl -fsSL https://bun.sh/install | bash          # Install Bun
curl -sSL https://agentuity.sh | sh                # Install Agentuity CLI
sudo apt install -y unzip gh                        # Prerequisites
gh auth login                                       # GitHub auth
git clone https://github.com/buddha-maitreya/business-iq-enterprise.git
```

---

## Deployment Workflow

Each client gets their own Agentuity project, database, and deployment. **No shared resources.**

### Step 1: Create Agentuity Project

```bash
agentuity project create --name "client-name-biq" --dir ./business-iq-enterprise --database new --no-install --no-build
```

This does three things:
- Registers a new project in Agentuity cloud
- Creates `agentuity.json` with `projectId`, `orgId`, `region`
- Provisions a dedicated Neon Postgres database (`DATABASE_URL` auto-injected)

### Step 2: Configure Environment Variables

Set client-specific config via the Agentuity console or CLI:

```bash
# Pull auto-injected secrets (DATABASE_URL, AGENTUITY_SDK_KEY)
agentuity cloud env pull

# Set remaining config (see Environment Configuration section below)
agentuity cloud env set COMPANY_NAME "Client Business Name"
agentuity cloud env set LLM_PROVIDER_KEY "sk-..."
# ... etc
```

### Step 3: Deploy

**From desktop PowerShell (required — WSL one-liner):**

```powershell
wsl -d Ubuntu-24.04 -- bash -lc "cd ~/business-iq-enterprise && git pull && source ~/.bashrc && agentuity deploy"
```

**Or from inside WSL terminal directly:**

```bash
cd ~/business-iq-enterprise
git pull
source ~/.bashrc
agentuity deploy
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

### Step 4: Run Database Migrations

```bash
bunx drizzle-kit migrate
```

This creates all tables in the client's dedicated Neon Postgres database.

### Step 5: Seed Initial Data (Optional)

```bash
bun demo/seed-auth.ts          # Create default admin user
bun demo/seed-demo.ts          # Seed sample products, categories, customers
bun demo/seed-orders-90d.ts    # Generate 90 days of sample order history
```

---

## Database Setup

Each client gets a **dedicated Neon Postgres database** — no shared data between deployments.

### Provisioning

```bash
agentuity cloud db create --name "client-db"
```

`DATABASE_URL` is automatically injected into the deployment environment. No manual connection string management.

### Migrations

```bash
# Generate migration from schema changes
bunx drizzle-kit generate

# Apply migrations
bunx drizzle-kit migrate
```

### Schema Notes

- Schema is **industry-neutral** — generic columns (`name`, `unit`, `price`, `category`)
- Industry-specific attributes go in `metadata` JSONB columns
- No `tenant_id` columns — the entire database belongs to one client
- Statuses use `varchar` (not enums) so each deployment defines its own workflows

---

## Environment Configuration

All client-specific values are injected via environment variables:

### Infrastructure (Auto-Injected)

| Variable | Source | Notes |
|----------|--------|-------|
| `DATABASE_URL` | `agentuity cloud db create` | Auto-set |
| `AGENTUITY_SDK_KEY` | Project creation | Auto-set |

### Required — Set Per Client

| Variable | Example | Purpose |
|----------|---------|---------|
| `LLM_PROVIDER_KEY` | `sk-...` | AI API key (OpenAI/Anthropic/Groq) |
| `COMPANY_NAME` | `Acme Trading Co.` | Client's business name |
| `CURRENCY` | `USD`, `KES`, `EUR` | Display currency |
| `TAX_RATE` | `0.16` | Default tax rate (16%) |
| `TIMEZONE` | `Africa/Nairobi` | Client timezone |

### Optional — Industry Terminology

| Variable | Default | Example for Restaurant | Example for Hardware |
|----------|---------|----------------------|---------------------|
| `PRODUCT_LABEL` | `Product` | `Menu Item` | `Product` |
| `PRODUCT_LABEL_PLURAL` | `Products` | `Menu Items` | `Products` |
| `ORDER_LABEL` | `Order` | `Ticket` | `Sales Order` |
| `ORDER_LABEL_PLURAL` | `Orders` | `Tickets` | `Sales Orders` |
| `CUSTOMER_LABEL` | `Customer` | `Guest` | `Customer` |
| `CUSTOMER_LABEL_PLURAL` | `Customers` | `Guests` | `Customers` |
| `WAREHOUSE_LABEL` | `Warehouse` | `Kitchen` | `Store` |
| `INVOICE_LABEL` | `Invoice` | `Bill` | `Invoice` |
| `UNIT_DEFAULT` | `piece` | `portion` | `piece` |

### Optional — Branding

| Variable | Purpose |
|----------|---------|
| `COMPANY_LOGO_URL` | Client logo URL (displayed in app + reports) |

---

## POS Integration

Business IQ Enterprise picks up sales data **in real time** from the client's existing POS terminal. The POS handles payment collection (cash, card, M-Pesa). BIQ receives completed sale data, creates orders, and deducts stock automatically.

### Architecture

```
Customer pays at POS terminal
        │
        ▼
 POS Terminal (cash / card / M-Pesa)
        │
        ├── Processes payment
        ├── Prints receipt
        │
        ▼
 POST /api/webhooks/pos   ← POS sends sale data
        │
        ├── Verify HMAC signature
        ├── Deduplicate by receipt ID (idempotent)
        ├── Resolve products by SKU or barcode
        ├── Create order + deduct stock
        │
        ▼
 Order appears in BIQ immediately
 (stock updated, payment recorded)
```

**Key principle:** BIQ does NOT process payments. The POS terminal handles all payment collection. BIQ only records the sale outcome.

### Step 1: Register the POS Webhook Source

After deployment, register the POS terminal as a webhook source. This is a one-time setup per client.

**Via API (recommended):**

```bash
curl -X POST https://<deployment-url>/api/webhooks/register \
  -H "Authorization: Bearer <admin-session-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "pos",
    "handler": "pos",
    "async": false,
    "secret": "<shared-secret>",
    "signatureHeader": "x-signature"
  }'
```

| Field | Value | Notes |
|-------|-------|-------|
| `name` | `pos` | Webhook source identifier. Must be `pos` for the POS handler. |
| `handler` | `pos` | Maps to the built-in POS service handler. |
| `async` | `false` | **Must be false** — POS needs a synchronous response with the order ID. |
| `secret` | Client-specific | HMAC-SHA256 shared secret. Generate one per client: `openssl rand -hex 32` |
| `signatureHeader` | `x-signature` | HTTP header the POS sends the HMAC signature in. |

**Via Admin UI:**

Navigate to Admin → Webhooks → Register Source. Fill in the same values.

### Step 2: Configure the POS Terminal

Configure the client's POS terminal to POST completed sales to:

```
POST https://<deployment-url>/api/webhooks/pos
```

**Required headers:**

| Header | Value |
|--------|-------|
| `Content-Type` | `application/json` |
| `x-signature` | HMAC-SHA256 hex digest of the request body, using the shared secret |

**HMAC signature computation (for POS vendor integration):**

```
signature = HMAC-SHA256(shared_secret, request_body)
# Send as hex string in x-signature header
```

### Step 3: Payload Format

The POS terminal must POST JSON in this format:

```json
{
  "receiptId": "RCP-001234",
  "terminalId": "T001",
  "cashierId": "jane",
  "timestamp": "2026-02-23T14:30:00Z",
  "items": [
    {
      "sku": "WIDGET-001",
      "quantity": 2,
      "unitPrice": 1500,
      "discount": 0
    },
    {
      "barcode": "6001234567890",
      "quantity": 1
    }
  ],
  "payment": {
    "method": "mpesa",
    "reference": "QKD3F7HXYZ",
    "status": "paid"
  },
  "customer": {
    "phone": "+254712345678"
  }
}
```

**Payload reference:**

| Field | Required | Type | Notes |
|-------|----------|------|-------|
| `receiptId` | **Yes** | string | Unique receipt ID from POS. Used for idempotency — same receipt won't create duplicate orders. |
| `terminalId` | No | string | POS terminal identifier |
| `cashierId` | No | string | Cashier/operator ID |
| `timestamp` | No | ISO 8601 | When the sale occurred. Defaults to now. |
| `warehouseId` | No | UUID | Source warehouse. Defaults to the deployment's default warehouse. |
| `items` | **Yes** | array | At least one item required |
| `items[].sku` | Yes* | string | Product SKU — primary lookup key |
| `items[].barcode` | Yes* | string | Product barcode — fallback lookup |
| `items[].productId` | Yes* | UUID | Direct product UUID — if POS knows it |
| `items[].quantity` | **Yes** | integer | Quantity sold (min 1) |
| `items[].unitPrice` | No | number | Unit price from POS. Defaults to product price in BIQ. |
| `items[].discount` | No | number | Line item discount amount |
| `payment.method` | No | string | `cash`, `card`, `card_pdq`, `mpesa`, `bank_transfer` |
| `payment.reference` | No | string | External ref: M-Pesa receipt code, card approval number |
| `payment.status` | No | enum | `paid` (default), `pending`, `partial` |
| `customer.id` | No | UUID | Customer UUID if POS knows it |
| `customer.phone` | No | string | Customer phone — used to match existing customers |
| `customer.name` | No | string | Reference only |
| `metadata` | No | object | Arbitrary POS-specific data |

*At least one of `sku`, `barcode`, or `productId` is required per item.

### Step 4: Response Format

The POS receives a synchronous response:

```json
{
  "received": true,
  "eventId": "a1b2c3d4-...",
  "data": {
    "duplicate": false,
    "orderId": "f5e6d7c8-...",
    "orderNumber": "ORD-000047",
    "totalAmount": "4500.00",
    "itemsProcessed": 2,
    "itemsNotFound": [],
    "paymentStatus": "paid"
  }
}
```

| Field | Type | Notes |
|-------|------|-------|
| `data.duplicate` | boolean | `true` if this `receiptId` was already processed (idempotent) |
| `data.orderId` | UUID | BIQ order ID |
| `data.orderNumber` | string | Sequential order number (e.g., `ORD-000047`) |
| `data.totalAmount` | string | Computed total including tax |
| `data.itemsProcessed` | number | How many items were resolved and ordered |
| `data.itemsNotFound` | string[] | SKUs/barcodes that didn't match any product in BIQ |
| `data.paymentStatus` | string | Payment status recorded on the order |

### What Happens Automatically

1. **Stock deduction** — inventory is reduced immediately for each item sold
2. **Idempotency** — same `receiptId` within 24 hours returns the cached result (no double-counting)
3. **Product resolution** — items are matched by SKU first, then barcode, then product UUID
4. **Customer matching** — if a phone number is provided, the sale is linked to the existing customer
5. **Payment recording** — payment method and reference (e.g., M-Pesa receipt) stored on the order
6. **Audit trail** — inventory transactions recorded with `type: "sale"`, linked to the order
7. **Webhook event log** — every POS POST is logged in `webhook_events` for debugging

### Error Handling

| HTTP Status | Error | Cause | POS Action |
|-------------|-------|-------|------------|
| `200` | — | Sale processed successfully | Done |
| `401` | Invalid signature | HMAC verification failed | Check shared secret |
| `404` | Webhook source not found | POS source not registered | Register via `/api/webhooks/register` |
| `400` | Validation error | Missing required fields or no products found | Fix payload format |
| `429` | Rate limit exceeded | Too many requests per minute | Retry after backoff |

### Generating an HMAC Secret

Generate a unique secret for each client deployment:

```bash
# From PowerShell:
[System.BitConverter]::ToString((1..32 | ForEach-Object { Get-Random -Max 256 })).Replace('-','').ToLower()

# From bash/WSL:
openssl rand -hex 32
```

Store this secret in two places:
1. **BIQ** — passed in the `secret` field when registering the webhook source
2. **POS terminal** — configured in the POS integration settings

### Testing the POS Webhook

After registration, test with curl:

```bash
# Generate HMAC signature
SECRET="your-shared-secret"
BODY='{"receiptId":"TEST-001","items":[{"sku":"TEST-SKU","quantity":1}],"payment":{"method":"cash","status":"paid"}}'
SIG=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')

# Send test webhook
curl -X POST https://<deployment-url>/api/webhooks/pos \
  -H "Content-Type: application/json" \
  -H "x-signature: $SIG" \
  -d "$BODY"
```

### POS Vendor Integration Notes

Different POS vendors have different integration methods. Common patterns:

| POS Type | Integration Method | Notes |
|----------|-------------------|-------|
| **Modern cloud POS** (e.g., Square, Loyverse) | Webhook/API built-in | Configure webhook URL in POS settings |
| **Android POS** (common in Kenya) | Custom middleware app | Build a small app that intercepts POS receipts and POSTs to BIQ |
| **Desktop POS** (e.g., QuickBooks POS) | Integration script | Script runs on POS machine, watches for new sales, POSTs to BIQ |
| **Receipt printer POS** (basic) | Manual or OCR | Not ideal for real-time — consider upgrading to a POS with API support |

For the first client deployment, work with the POS vendor to configure their webhook/API to POST to the BIQ endpoint. Most modern POS systems support outgoing webhooks.

---

## Analytics Sandbox Setup (Python)

The analytics engine runs LLM-generated **Python 3.14** code in isolated Agentuity sandboxes for statistical analysis: demand forecasting, anomaly detection, trend analysis, restock recommendations, and more.

### Architecture

```
User asks analytical question
        │
        ▼
 Data Science Agent (The Brain)
        │
        ├──▶ SQL query → Neon Postgres → raw data
        │
        ▼
 Insights Analyzer Agent (The Analyst)
        │
        ├──▶ LLM generates Python code (numpy/pandas/scipy/sklearn/statsmodels)
        │
        ▼
 Agentuity Sandbox (python:3.14)
        │
        ├──▶ Runs Python code against data
        ├──▶ Returns structured JSON results
        │
        ▼
 Formatted insights returned to user
```

### Runtime

The sandbox uses `python:3.14` with the `uv` package manager (pre-installed by Agentuity). This is an Agentuity-provided runtime — **no configuration needed in the console**.

**Important:** The Python runtime is `uv`-managed and externally locked. You **cannot** use `pip`, `pip3`, or `python3 -m ensurepip` directly. All package installation must go through `uv` with a virtual environment.

### Creating the Analytics Snapshot (One-Time, Post-Deploy)

A **snapshot** pre-installs data science packages so they don't need to be installed on every sandbox execution. This is a **one-time setup per deployment**.

> **Note:** Even without a snapshot, the system works — it auto-installs packages via `uv` at runtime (~10s overhead per request). Snapshots eliminate this overhead for faster analytics responses.

#### Option A: CLI from WSL (Recommended)

Run these commands from inside WSL (or via `wsl -d Ubuntu-24.04 -- bash -lc "..."` from PowerShell). Execute them back-to-back without delay.

**Step 1 — Create an interactive sandbox with network access:**

```bash
agentuity cloud sandbox create --runtime python:3.14 --memory 1Gi --disk 2Gi --network --idle-timeout 30m
# Returns: sbx_<id>
```

**Step 2 — Create a virtual environment** (the Python runtime is `uv`-managed and locked — you cannot use `pip`/`pip3` directly):

```bash
agentuity cloud sandbox exec <sbx_id> -- uv venv /var/agentuity/venv
```

> **Path matters:** Use `/var/agentuity/venv` — this is the writable workspace directory. `/tmp/` is transient and won't be captured by snapshots. `/home/user/` is permission-denied.

**Step 3 — Install data science packages:**

```bash
agentuity cloud sandbox exec <sbx_id> -- uv pip install --python /var/agentuity/venv/bin/python numpy pandas scipy scikit-learn statsmodels
```

Expected output: `Installed 11 packages in ...` (~6-10 seconds)

**Step 4 — Create the snapshot** (immediately after install — don't let the sandbox idle-timeout):

```bash
agentuity cloud sandbox snapshot create <sbx_id> --tag python-analysis
```

If snapshot creation returns a 500 error, see [Troubleshooting: Snapshot creation fails](#snapshot-creation-fails) below.

**Step 5 — Copy the snapshot ID** from the output and clean up:

```bash
agentuity cloud sandbox delete <sbx_id>
```

#### Option B: Agentuity Dashboard (Manual)

1. Go to **Agentuity Dashboard → Services → Sandbox → Create Sandbox**
2. Fill in the settings:

   | Field | Value |
   |-------|-------|
   | **Name** | Unique name (e.g. `biq-analysis-py314-v2`) — if a name is taken by an archived sandbox, use a different name |
   | **Description** | `Data science stack for analytics` |
   | **Runtime** | `python:3.14` |
   | **Region** | Match your project region (e.g. `US East`) |
   | **Memory** | `512Mi` |
   | **CPU** | `1 core` (needed for compilation) |
   | **Disk** | `1Gi` (packages need ~600-800MB installed) |
   | **Execution Mode** | `Interactive` |
   | **Idle Timeout** | `10m` |
   | **Network Access** | **ON** (required to download packages) |
   | **Expose Port** | _(leave blank)_ |

   **CRITICAL — Startup screen:**

   | Field | Value |
   |-------|-------|
   | **Command** | _(leave blank)_ |
   | **Dependencies** | **LEAVE BLANK** — this field installs `apt` system packages (e.g. `git`, `curl`), NOT Python packages. Putting Python package names here will fail. |
   | **Environment Variables** | _(leave blank)_ |
   | **Files** | _(leave blank)_ |

3. Click **Create Sandbox** and wait for the sandbox detail page.

4. In the sandbox terminal, run these commands **one at a time** (the terminal does not support `&&` chaining, and wraps quoted strings incorrectly):

   ```
   uv venv /var/agentuity/venv
   ```
   ```
   uv pip install --python /var/agentuity/venv/bin/python numpy pandas scipy scikit-learn statsmodels
   ```

5. Click the **Snapshot** button (top-right) → name it, tag it → **Create**.

6. Copy the **snapshot ID**.

#### Option C: Auto-Bootstrap (No Snapshot — Fallback)

If snapshot creation is not possible (e.g., Agentuity API issues), the system automatically falls back to **runtime package installation**. When no `sandboxSnapshotId` is configured:

- The sandbox enables network access temporarily
- The Python script runs `uv venv` + `uv pip install` before importing packages
- Adds ~6-10 seconds to each analytics request
- The timeout is automatically extended to 60s minimum

No configuration needed — this is the default behavior when no snapshot is set.

#### Step 2: Configure the Agent to Use the Snapshot

After getting the `snapshotId`, set it in the agent config:

**Via Admin Console UI:**
1. Navigate to **Admin → Agent Configs → insights-analyzer**
2. In the JSON config section, add:
   ```json
   {
     "sandboxSnapshotId": "snap_abc123...",
     "sandboxRuntime": "python:3.14"
   }
   ```
3. Save

**Via API:**

```bash
curl -X PUT https://<your-deployment-url>/api/agent-configs/insights-analyzer \
  -H "Authorization: Bearer <session-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "config": {
      "sandboxSnapshotId": "snap_abc123...",
      "sandboxRuntime": "python:3.14"
    }
  }'
```

Also configure the data-science agent (The Brain) if it uses sandbox directly:

```bash
curl -X PUT https://<your-deployment-url>/api/agent-configs/data-science \
  -H "Authorization: Bearer <session-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "config": {
      "sandboxSnapshotId": "snap_abc123...",
      "sandboxRuntime": "python:3.14"
    }
  }'
```

### Pre-Installed Packages in Snapshot

| Package | Version | Purpose |
|---------|---------|---------|
| `numpy` | Latest | Numerical computing, arrays, linear algebra |
| `pandas` | Latest | DataFrames, time series, aggregation |
| `scipy` | Latest | Statistical functions, hypothesis tests, optimization |
| `scikit-learn` | Latest | Machine learning (regression, clustering, anomaly detection) |
| `statsmodels` | Latest | Time series forecasting (Exponential Smoothing, ARIMA, seasonal decomposition) |

### What Works Without a Snapshot

Even without creating a snapshot, the analytics sandbox still works using Python's standard library:

- `math`, `statistics` — basic calculations
- `datetime`, `collections`, `itertools` — data manipulation
- `json`, `csv` — data parsing
- `re` — pattern matching

The LLM will fall back to manual implementations of statistical methods. It works, but is less efficient and less accurate than numpy/scipy.

### Sandbox Security

- **Network: Disabled when snapshot is set** — no data exfiltration possible. When no snapshot is configured, network is temporarily enabled for package installation only (the auto-bootstrap code runs `uv pip install` then proceeds with analysis).
- **SQL: Read-only** — only SELECT/WITH queries allowed (validated server-side)
- **Timeout: 30 seconds default** (configurable via `sandboxTimeoutMs` in agent config). Auto-extended to 60s minimum when no snapshot is configured.
- **Memory: 256Mi** (configurable via `sandboxMemoryMb` in agent config)
- **Isolation: Full** — each execution runs in its own container, destroyed after use

---

## Post-Deployment Verification

After deploying a new client, verify these work:

### 1. Health Check

```bash
curl https://<deployment-url>/api/health
# Should return: {"status":"ok","timestamp":"..."}
```

### 2. Config Endpoint

```bash
curl https://<deployment-url>/api/config
# Should return company name, labels, currency, features
```

### 3. Admin Login

Navigate to `https://<deployment-url>` in a browser. Log in with the seeded admin credentials.

### 4. Test Analytics (After Snapshot Setup)

In the Assistant chat, ask:
- "How are sales trending?" — should trigger The Analyst with Python sandbox
- "Which products are running low?" — should trigger demand forecast analysis
- "Give me a sales summary report" — should trigger The Writer for report generation
- "Export a report as PDF" — should generate PDF with cover page, TOC, and "Prepared by"

### 5. Test Document Scanner

Upload a barcode/QR code image or invoice — should trigger The Scanner agent.

---

## Agent Configuration

All agents are configurable per-deployment via the Admin Console → Agent Configs.

### insights-analyzer (The Analyst)

| Config Key | Default | Purpose |
|-----------|---------|---------|
| `sandboxTimeoutMs` | `30000` | Max execution time per sandbox run |
| `sandboxSnapshotId` | _(none)_ | Pre-installed Python packages snapshot |
| `sandboxRuntime` | `python:3.14` | Sandbox runtime |
| `sandboxMemoryMb` | `256` | Sandbox memory limit in MB |
| `maxSteps` | `5` | Max LLM tool call iterations |
| `modelOverride` | _(default)_ | Override AI model (e.g. `gpt-4o`, `claude-sonnet-4-20250514`) |
| `temperature` | _(default)_ | Model temperature |
| `tokenBudget` | `50000` | Max tokens per invocation |

### data-science (The Brain)

| Config Key | Default | Purpose |
|-----------|---------|---------|
| `sandboxSnapshotId` | _(none)_ | Pre-installed Python packages snapshot |
| `sandboxRuntime` | `python:3.14` | Sandbox runtime for direct analysis |
| `maxSteps` | `10` | Max tool call iterations |
| `modelOverride` | _(default)_ | Override AI model |

### report-generator (The Writer)

| Config Key | Default | Purpose |
|-----------|---------|---------|
| `maxSteps` | `5` | Max SQL fetch iterations |
| `modelOverride` | _(default)_ | Override AI model |

### knowledge-base (The Librarian)

| Config Key | Default | Purpose |
|-----------|---------|---------|
| `chunkSize` | `1000` | Document chunk size for vector store |
| `chunkOverlap` | `200` | Overlap between chunks |
| `modelOverride` | _(default)_ | Override AI model |

---

## Troubleshooting

### Deployment Issues

#### Build fails with backslash path errors

**Cause:** Running build on Windows instead of WSL. The Agentuity CLI generates files with Windows backslash paths that break TypeScript/Bun.

**Fix:** Always build and deploy from WSL:

```powershell
wsl -d Ubuntu-24.04 -- bash -lc "cd ~/business-iq-enterprise && git pull && source ~/.bashrc && agentuity deploy"
```

#### `agentuity: command not found` in WSL

**Fix:** Source the shell profile first:

```bash
source ~/.bashrc
```

#### Auth expired

**Fix:** Re-authenticate:

```bash
agentuity login
```

### Analytics / Sandbox Issues

#### "Sandbox not available" error in chat

**Cause:** The agent doesn't have access to `ctx.sandbox`. This can happen if the Agentuity SDK version is outdated or the agent wasn't properly registered.

**Fix:**
1. Verify the agent is discovered: check that `src/agent/insights-analyzer/index.ts` exists and exports correctly
2. Redeploy: `agentuity deploy`
3. Check Agentuity console → Agents tab to confirm the agent is listed

#### Analytics returns "No module named numpy" (or pandas, scipy, etc.)

**Cause:** No snapshot configured AND auto-bootstrap failed (usually due to network issues or sandbox limitations).

**Fix:**
1. The system should auto-install packages at runtime when no snapshot is set. If this isn't working, check that the sandbox runtime is `python:3.14` (auto-bootstrap uses `uv`, which is only available in Python runtimes).
2. For best performance, create a snapshot (see [Analytics Sandbox Setup](#analytics-sandbox-setup-python) above) and set the `sandboxSnapshotId` in agent config.

#### Snapshot creation fails with 500 error {#snapshot-creation-fails}

**Cause:** Known Agentuity platform issue — the `snapshot create` API intermittently returns HTTP 500 Internal Server Error.

**Workaround:**
1. The system works without snapshots via auto-bootstrap (Option C above). No action needed.
2. Retry snapshot creation later — this is a platform-side bug that Agentuity needs to fix.
3. Try from the dashboard UI instead of CLI (or vice versa).
4. Report to Agentuity support with the sandbox ID for investigation.

#### Analytics timeout

**Cause:** Computation exceeds the 30-second limit. Often caused by too much data or inefficient code.

**Fix:**
1. Increase timeout: Set `sandboxTimeoutMs` to `60000` (60s) in agent config
2. Increase memory: Set `sandboxMemoryMb` to `512` in agent config
3. The LLM will automatically retry with simpler code if it hits a timeout

#### "IndentationError" or "SyntaxError" in sandbox

**Cause:** LLM generated malformed Python code.

**Fix:** This is auto-handled — the error classification system returns a structured hint to the LLM, which corrects the code and retries (up to `maxSteps` iterations). If it persists:
1. Check the model in use — `gpt-4o` and `claude-sonnet-4-20250514` generate the best Python code
2. Try a different model via `modelOverride` in agent config

#### Snapshot creation fails

**Cause:** Network must be enabled during snapshot creation (to download packages). If the sandbox API is unavailable:

**Fix:**
1. Verify the deployment has sandbox access in the Agentuity console
2. Try creating the snapshot from the Agentuity console UI instead (Sandbox → Create Sandbox)
3. Check deployment logs: `agentuity cloud deployment logs <deploy_id> --limit=100`

### Report Export Issues

#### PDF/DOCX/PPTX missing "Prepared by" or Table of Contents

**Cause:** The user is not authenticated, so no name is available for the "Prepared by" field.

**Fix:** Ensure the user is logged in. The `preparedBy` field is populated from the authenticated session's `user.name`.

#### Report lacks Executive Summary or Conclusion

**Cause:** The LLM didn't follow the structured format.

**Fix:** This is enforced via the system prompt. If it persists:
1. Try a more capable model (`gpt-4o`, `claude-sonnet-4-20250514`)
2. Check custom instructions in AI settings — ensure they don't conflict

### Database Issues

#### Migration failures

```bash
# Check current migration status
bunx drizzle-kit check

# Regenerate from schema
bunx drizzle-kit generate

# Apply
bunx drizzle-kit migrate
```

#### Connection refused

**Fix:** Verify `DATABASE_URL` is set:

```bash
agentuity cloud env pull
```

---

## Onboarding Checklist

Use this checklist when deploying for a new client:

- [ ] **Create Agentuity project** — `agentuity project create --name "client-biq" --database new`
- [ ] **Set environment variables** — Company name, currency, tax rate, API keys
- [ ] **Set industry labels** — Product/Order/Customer/Warehouse terminology
- [ ] **Deploy** — `agentuity deploy` from WSL
- [ ] **Run migrations** — `bunx drizzle-kit migrate`
- [ ] **Seed admin user** — `bun demo/seed-auth.ts`
- [ ] **Register POS webhook** — `POST /api/webhooks/register` with `name: "pos"`, `handler: "pos"`
- [ ] **Configure POS terminal** — Set webhook URL + HMAC secret on client's POS
- [ ] **Test POS webhook** — Send test sale, verify order created + stock deducted
- [ ] **Create analytics snapshot** — `POST /admin/sandbox/snapshot`
- [ ] **Configure snapshot ID** — Set in insights-analyzer + data-science agent configs
- [ ] **Verify health** — `GET /api/health`
- [ ] **Test assistant** — Ask "How are sales trending?" in chat
- [ ] **Test report export** — Generate and export a sales report as PDF
- [ ] **Client handoff** — Share login URL, credentials, and user guide

---

## Quick Reference

### Deployment Commands (from Desktop PowerShell)

```powershell
# Deploy
wsl -d Ubuntu-24.04 -- bash -lc "cd ~/business-iq-enterprise && git pull && source ~/.bashrc && agentuity deploy"

# Build only (check for errors)
wsl -d Ubuntu-24.04 -- bash -lc "cd ~/business-iq-enterprise && git pull && source ~/.bashrc && agentuity build"

# View logs
wsl -d Ubuntu-24.04 -- bash -lc "source ~/.bashrc && agentuity cloud deployment logs --limit=100"
```

### API Endpoints Reference

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/health` | GET | Health check |
| `/api/config` | GET | App configuration |
| `/api/webhooks/register` | POST | Register a webhook source (e.g., POS terminal) |
| `/api/webhooks/pos` | POST | POS sale webhook endpoint (no auth — HMAC verified) |
| `/api/webhooks` | GET | List webhook sources + recent events |
| `/api/admin/sandbox/snapshot` | POST | Create Python analytics snapshot |
| `/api/agent-configs/:agentName` | GET/PUT | Agent configuration |
| `/api/admin/stats` | GET | Dashboard statistics |

### Support & Resources

- **Agentuity Docs:** [https://agentuity.dev/docs](https://agentuity.dev/docs)
- **Agentuity Console:** [https://console.agentuity.dev](https://console.agentuity.dev)
- **Repository:** [https://github.com/buddha-maitreya/business-iq-enterprise](https://github.com/buddha-maitreya/business-iq-enterprise)
