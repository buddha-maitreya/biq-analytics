# Inventory Scanning Roadmap

## Architecture Principle

```
barcode → API → transaction → updated stock
```

Devices do not matter. Input methods do not matter.
Everything is just: **barcode → POST /api/scan → stock movement → updated level**.

Build this pipeline once, and the system scales without redesign.

---

## Current State (What Already Exists)

| Component | Status | Location |
|-----------|--------|----------|
| `products` table with `barcode` index | ✅ Built | `src/db/schema.ts` |
| `warehouses` table (= branches) | ✅ Built | `src/db/schema.ts` |
| `inventory` table (cached stock levels) | ✅ Built | `src/db/schema.ts` |
| `inventory_transactions` (audit ledger) | ✅ Built | `src/db/schema.ts` |
| `users` table with RBAC | ✅ Built | `src/db/schema.ts` |
| `adjustStock()` / `transferStock()` | ✅ Built | `src/services/inventory.ts` |
| Document scanner agent (GPT-4o vision) | ✅ Built | `src/agent/document-scanner/` |
| Document ingestion pipeline (5-layer dedup) | ✅ Built | `src/services/document-ingestion.ts` |
| Image-based scan endpoints (`/scan/barcode`, `/scan/stock`, `/scan/invoice`) | ✅ Built | `src/api/scanning.ts` |

---

## Phase 1 — Core Scan Pipeline (Foundation) ✅ BUILT

### New Database Tables

| Table | Purpose | Location |
|-------|---------|----------|
| `scan_events` | Raw log of every scan attempt (success/fail/pending) | `src/db/schema.ts` |
| `idempotency_keys` | Prevents duplicate stock changes from retries/offline sync | `src/db/schema.ts` |

### Schema Changes

- `inventory_transactions.device_type` column added (varchar, nullable)
  - Tracks: `web`, `mobile`, `scanner`, `api`

### Unified Scan Endpoint

**POST /api/scan**

```json
{
  "barcode": "8901234567890",
  "warehouseId": "uuid",
  "deviceType": "web",
  "quantity": 1,
  "scanType": "scan_add",
  "notes": "Received from supplier",
  "idempotencyKey": "client-uuid-123"
}
```

**Response:**
```json
{
  "data": {
    "success": true,
    "scanEventId": "uuid",
    "transactionId": "uuid",
    "product": {
      "id": "uuid",
      "name": "Widget A",
      "sku": "WDG-001",
      "barcode": "8901234567890",
      "unit": "piece"
    },
    "previousStock": 50,
    "newStock": 51,
    "quantityChanged": 1,
    "warehouseId": "uuid",
    "scanType": "scan_add",
    "deviceType": "web",
    "timestamp": "2026-02-23T10:30:00Z"
  }
}
```

### Atomic Pipeline Flow

```
1. Check idempotency key (return cached response if duplicate)
2. Insert scan_events record (raw log — always, even if product missing)
3. Lookup product by barcode
4. Duplicate detection (same barcode < 2 seconds)
5. Validate stock levels (for removals)
6. Insert inventory_transactions row
7. Atomically update inventory (upsert)
8. Link transaction → scan event
9. Cache response for idempotency
10. Return updated stock level
```

### Additional Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/scan` | Process single barcode scan |
| `POST` | `/api/scan/batch` | Process offline queue (array of scans) |
| `GET` | `/api/scan/lookup/:code` | Instant product lookup by barcode |
| `GET` | `/api/scan/history` | Filterable scan event log |

### Files Created/Modified

| File | Action |
|------|--------|
| `src/db/schema.ts` | Added `scanEvents`, `idempotencyKeys` tables + relations; added `deviceType` to `inventoryTransactions` |
| `src/services/scan.ts` | NEW — `processScan()`, `processBatchScan()`, `lookupBarcode()`, `getScanHistory()`, `cleanupExpiredIdempotencyKeys()` |
| `src/api/scan.ts` | NEW — REST endpoints for scan pipeline |
| `src/api/index.ts` | Added barrel export for scan routes |

### Critical Rules

1. **`inventory` = cache, `inventory_transactions` = truth.** If inventory is rebuilt from transactions, numbers must match.
2. **Every scan creates a `scan_events` record** — even failures. This enables audit, fraud detection, debugging.
3. **Never update stock without a transaction row.** The ledger is immutable.
4. **Idempotency keys prevent duplicates.** Network drops, retries, rapid double-taps are all safe.

---

## Phase 2 — Web App Scanner Support ✅ BUILT

### 2a. Scanner-as-Keyboard Input (USB/Bluetooth scanners) ✅

**Library:** `onscan.js@1.5.2` (MIT, 9.7K weekly downloads)
- Framework-agnostic keyboard-wedge detection
- Distinguishes rapid scanner input from human typing via timing analysis
- Config: `suffixKeyCodes: [13]` (Enter), `reactToPaste: true`, `minLength: 4`, `avgTimeByChar: 50`
- Dynamically imported in ScanPage.tsx useEffect
- Reports `deviceType: "usb_scanner"` to API when hardware scanner detected
- Auto-ignores when INPUT/TEXTAREA/SELECT elements are focused
- Visual "🔗 Hardware scanner detected" badge with pulse animation

This supports:
- USB barcode scanners (keyboard HID)
- Bluetooth scanners paired to device
- Warehouse handheld scanners (Zebra, Honeywell)
- POS workflow quick-add

### 2b. Camera Scanning in Browser ✅

**Library:** `barcode-detector@3.0.8` (MIT, 54.8K weekly downloads)
- W3C BarcodeDetector polyfill using ZXing-C++ WebAssembly
- Imported as ponyfill: `import { BarcodeDetector } from "barcode-detector/ponyfill"`
- Works in ALL browsers (Safari, Firefox, Chrome, Edge) — no native API dependency
- Supports: codabar, code_39, code_93, code_128, databar, ean_8, ean_13, itf, upc_a, upc_e, aztec, data_matrix, pdf417, qr_code, micro_qr_code

Frontend features built:
- "📷 Scan" camera toggle in mode selector
- `getUserMedia()` camera permission request with rear-camera preference
- Live video preview with overlay
- Continuous barcode detection loop via `detector.detect(video)`
- Auto-submit detected barcode to `POST /api/scan`
- Manual barcode entry fallback mode
- Visual confirmation: ✅ success flash + product name, ❌ error toast

**Libraries evaluated and rejected:**
- `dynamsoft-javascript-barcode` — DEPRECATED, requires paid license
- `html5-qrcode` — 3 years unmaintained, stale
- `@nicolo-ribaudo/barcode-reader` — superseded by barcode-detector polyfill

---

## Phase 3 — Real-Time Feedback ✅ BUILT

### 3a. Live Stock Updates After Scan ✅

**Implementation:** Server-Sent Events (SSE)

Backend (`src/api/scan.ts`):
- `GET /api/scan/events` SSE endpoint using `sse()` middleware from `@agentuity/runtime`
- `scanStreams` Set tracks connected SSE clients
- `broadcastStockUpdate()` pushes events to all clients after successful scans
- 20-second keepalive pings prevent connection drops
- `stream.onAbort()` cleanup removes disconnected clients
- Same SSE pattern as chat.ts (proven infrastructure)

Event payload:
```json
{
  "type": "stock_update",
  "properties": {
    "productId": "uuid",
    "productName": "Widget A",
    "barcode": "8901234567890",
    "warehouseId": "uuid",
    "warehouseName": "",
    "previousStock": 50,
    "newStock": 51,
    "scanType": "scan_add",
    "userId": "uuid"
  }
}
```

Frontend (`src/web/pages/ScanPage.tsx`):
- EventSource connecting to `/api/scan/events`
- Exponential backoff reconnect (1s → 30s max)
- Parses `stock_update` events and shows info flash notifications
- Auto-reconnects on connection loss

### 3b. Implementation Choice

| Approach | Complexity | Decision |
|----------|-----------|----------|
| Polling every 5s | Low | ❌ Rejected — unnecessary load |
| SSE (Server-Sent Events) | Medium | ✅ **Chosen** — reuses existing SSE infra |
| WebSocket | Higher | 🔲 Future — for live dashboards |

---

## Phase 4 — Offline Resilience ✅ BUILT

### 4a. Offline Scan Queue ✅

**Implementation:** IndexedDB (no Service Worker needed)

- Database: `biq-scan-queue`, object store: `pending-scans`, keyed by `idempotencyKey`
- Helpers: `openOfflineDB()`, `enqueueOfflineScan()`, `getOfflineScans()`, `clearOfflineScans()`, `removeOfflineScan()`
- Detects `navigator.onLine` state + `online`/`offline` event listeners
- **Offline:** Stores scans to IndexedDB, shows "📴 Queued offline" flash
- **Network errors during online scan:** Auto-falls back to offline queue
- **On reconnect:** Auto-calls `syncOfflineScans()` via `online` event listener
- **Manual sync:** "⚡ Sync Now" button for user-triggered sync
- **Batch upload:** Sends queued scans via `POST /api/scan/batch`
- **Per-item cleanup:** Removes successful items from IndexedDB individually
- **UI indicators:**
  - 🔴 Red status bar when offline
  - 🟡 Yellow status bar when scans pending
  - Queue count badge
  - Syncing progress state

### 4b. Conflict Resolution ✅

- Idempotency keys prevent duplicate stock changes (same key = cached response)
- Server returns cached response for retried keys
- Each scan is tagged with a client timestamp for ordering
- Offline scans include device type and all original metadata

---

## Phase 5 — Validation & Stability ✅ BUILT

### 5a. Server-Side Validation ✅

- ✅ Barcode format validation (string, 1-255 chars)
- ✅ UUID validation on warehouseId
- ✅ Quantity validation (integer, min 1)
- ✅ Device type enum validation
- ✅ Rate limiting per endpoint

### 5b. Duplicate Detection ✅

- ✅ Same barcode + same warehouse + same user within 2 seconds = rejected
- ✅ Idempotency key checked before processing
- ✅ Request hash comparison for key reuse with different payloads

### 5c. Hardware Scanner Device Support ✅

**Library:** `onscan.js@1.5.2` + `@types/onscan.js@1.5.6`
- ✅ USB barcode scanner detection via keyboard-wedge timing analysis
- ✅ Bluetooth scanner support (same HID protocol)
- ✅ Device type reported as `usb_scanner` in scan API
- ✅ Auto-submit on scan detection (no manual Enter needed)
- ✅ Visual hardware scanner badge with pulse animation

### 5d. Future Enhancements 🔲

- Configurable duplicate window (env var `SCAN_DEDUP_WINDOW_MS`)
- Barcode format validation (EAN-13, UPC-A, Code-128 pattern matching)
- Admin-configurable scan rate limits
- Scan anomaly detection (unusual patterns → admin alert)

---

## Phase 6 — Scan Approval Workflow ✅ BUILT

### Vision
Scans by lower-role users (staff) are staged for batch approval by their supervisor/manager before stock is committed. This prevents unauthorized stock changes and creates an auditable approval trail.

### What Already Exists (Foundation)
| Component | Status | Location |
|-----------|--------|----------|
| `approval_workflows` table (configurable action types, conditions) | ✅ Schema built | `src/db/schema.ts` |
| `approval_steps` table (ordered approver chain by role) | ✅ Schema built | `src/db/schema.ts` |
| `approval_requests` table (pending/approved/rejected instances) | ✅ Schema built | `src/db/schema.ts` |
| `approval_decisions` table (per-step approve/reject with comments) | ✅ Schema built | `src/db/schema.ts` |
| `users.reportsTo` column (supervisor hierarchy) | ✅ Schema built | `src/db/schema.ts` |
| `submitForApproval()`, `makeDecision()`, `getPendingApprovalsForUser()` | ✅ Service built | `src/services/approvals.ts` |
| Full API: submit, list pending, decide, cancel, hierarchy | ✅ API built | `src/api/approvals.ts` |
| ApprovalsPage UI (tabs, pending badge, decide flow) | ✅ Frontend built | `src/web/pages/ApprovalsPage.tsx` |
| Document ingestion → approval pipeline | ✅ Wired | `src/services/document-ingestion.ts` |

### What Was Built
1. **`processScan()` wired to approval system:**
   - ✅ After logging `scan_events` but BEFORE stock commit, checks `inventory.scan` workflow
   - ✅ Staff scans → `approval_request` with `entityType: "scan_event"`, scan status = `pending_approval`
   - ✅ Manager/admin scans → auto-approve via `autoApproveAboveRole: "manager"`
   - ✅ Response includes `{ requiresApproval: true, approvalRequestId: "uuid" }`

2. **Deferred stock commit on approval:**
   - ✅ `commitApprovedScan()` function in `src/services/scan.ts`
   - ✅ Approval decide endpoint calls `commitApprovedScan()` when `inventory.scan` approval is approved
   - ✅ Re-validates stock levels at approval time (prevents stale quantity commits)
   - ✅ Rejected scans leave `scan_events` as `pending_approval` (no stock change)

3. **Default `inventory.scan` workflow seeded:**
   - ✅ Auto-approve for managers and above (`autoApproveAboveRole: "manager"`)
   - ✅ Staff scans require 1-step manager approval
   - ✅ `inventory.transfer` workflow also added for transfer order approvals

4. **Future enhancements (not yet built):**
   - 🔲 Batch "Approve All" / "Reject All" for grouped scan approvals
   - 🔲 SSE notification to supervisor when staff scans are staged
   - 🔲 Configurable env vars: `SCAN_APPROVAL_THRESHOLD`, `SCAN_AUTO_APPROVE_ROLES`

---

## Phase 7 — Inter-Branch Transfer Scanning ✅ BUILT

### Vision
Full scan-based transfer workflow between warehouses/branches. Scanning at the departure warehouse creates a transfer order. Scanning at the destination warehouse accepts the incoming inventory. Goods are tracked as "in transit" between the two events.

### What Already Exists (Foundation)
| Component | Status | Location |
|-----------|--------|----------|
| `transferStock()` (deduct source, add dest, dual transactions) | ✅ Service built | `src/services/inventory.ts` |
| `inventory_transactions.type` supports `transfer_out` / `transfer_in` | ✅ Schema built | `src/db/schema.ts` |
| `scan_transfer` option in ScanPage dropdown UI | ✅ UI exists | `src/web/pages/ScanPage.tsx` |

### What Was Built

**Bug Fixed:** `scan_transfer` added to Zod enum in `scanRequestSchema` — UI dropdown now works end-to-end.

1. **Transfer Order schema (new tables):** ✅
   - `transfer_orders` table: `id`, `fromWarehouseId`, `toWarehouseId`, `status` (draft → in_transit → received | completed_with_discrepancy), `acceptanceMode`, `initiatedBy`, `receivedBy`, `dispatchedAt`, `receivedAt`, `notes`, `metadata`
   - `transfer_order_items` table: `id`, `transferOrderId`, `productId`, `expectedQuantity`, `dispatchedQuantity`, `receivedQuantity`, `discrepancyReason`, `discrepancyNote`, `acceptedAt`, `acceptedBy`
   - Relations configured for products, warehouses, users
   - Migration generated and applied (`0007_majestic_squirrel_girl.sql`)

2. **Transfer service (`src/services/transfer.ts`):** ✅
   - `createTransferOrder()` — create draft with items
   - `addTransferItem()` / `removeTransferItem()` — modify draft
   - `dispatchTransferOrder()` — validate stock, deduct source, record `transfer_out` transactions, mark `in_transit`
   - `receiveTransferItem()` — accept single item (manual entry)
   - `receiveTransferByBarcode()` — accept by barcode scan (incremental scanning)
   - `receiveTransferItems()` — batch manual count mode
   - `completeTransferOrder()` — credit destination stock, detect discrepancies, record `transfer_in` transactions
   - `cancelTransferOrder()` — cancel draft (no stock deducted)
   - `getTransferStats()` — dashboard summary stats

3. **Transfer API (`src/api/transfers.ts`):** ✅
   - `POST /api/transfers` — create transfer order
   - `GET /api/transfers` — list with filters (status, warehouse)
   - `GET /api/transfers/stats` — summary stats
   - `GET /api/transfers/:id` — get with items + product details
   - `POST /api/transfers/:id/items` — add item to draft
   - `DELETE /api/transfers/:id/items/:itemId` — remove item from draft
   - `POST /api/transfers/:id/dispatch` — dispatch (deduct source)
   - `POST /api/transfers/:id/receive` — receive batch (manual count)
   - `POST /api/transfers/:id/receive/scan` — receive by barcode scan
   - `POST /api/transfers/:id/complete` — complete transfer (credit dest)
   - `DELETE /api/transfers/:id` — cancel draft

4. **Scan pipeline integration:** ✅
   - `scanRequestSchema` now accepts `scan_add | scan_remove | scan_transfer`
   - `toWarehouseId` field added to scan request for transfers
   - Source warehouse stock validation for transfers (same as removals)
   - Transfer scan events recorded with `toWarehouseId` in raw payload

5. **Destination acceptance (two modes):** ✅
   - **Mode A — Scan to Accept:** `POST /api/transfers/:id/receive/scan` — barcode → match → increment `receivedQuantity`
   - **Mode B — Manual Count:** `POST /api/transfers/:id/receive` — batch update with quantities per item
   - Both support discrepancy detection, reasons, and notes
   - Stock NOT credited until `completeTransferOrder()` is called

6. **Discrepancy detection:** ✅
   - `receivedQuantity ≠ expectedQuantity` → auto-flags reason (missing/over_delivery)
   - Status: `received` (all match) vs `completed_with_discrepancy` (mismatch)
   - Per-item discrepancy reasons: damaged, missing, wrong_item, over_delivery, other

7. **Future enhancements (not yet built):**
   - 🔲 Frontend transfer UI (TransfersPage, dispatch flow, receive flow)
   - 🔲 SSE notification to destination warehouse on dispatch
   - 🔲 SSE notification to source warehouse on acceptance (with discrepancy summary)
   - 🔲 Configurable env vars: `TRANSFER_ACCEPTANCE_MODE`, `TRANSFER_AUTO_ACCEPT_BELOW`
   - 🔲 Integration with approval workflow for high-value transfers
   - 🔲 In-transit dashboard widget

---

## Phase 8 — AI-Native Scan Intelligence 🔲 NOT STARTED

### Vision
Transform scanning from a transactional operation into an intelligent, AI-assisted experience. The system proactively provides actionable insights after every scan.

### Planned Features

1. **Post-scan AI insight panel:**
   - After successful scan, optional AI analysis of the product/stock context
   - Powered by insights-analyzer agent or lightweight LLM call
   - Examples: "⚠️ This product is below reorder point — 3 units left", "📈 Scan velocity up 40% this week — demand spike detected", "💡 Last 5 scans were all scan_remove — check for shrinkage"
   - Non-blocking — insight loads async after stock update is confirmed

2. **Smart scan suggestions:**
   - Based on recent scan history, suggest next likely items to scan (e.g., during stock count, suggest unscanned items in same category)
   - AI-powered barcode prediction from partial input

3. **Scan pattern anomaly detection:**
   - Flag unusual patterns: scanning outside work hours, abnormal quantities, rapid-fire scans of high-value items
   - Alert supervisor via SSE notification
   - Uses scan_events history + insights-analyzer agent

---

## Phase 9 — Future Expansion 🔲 NOT STARTED

These reuse the same `POST /api/scan` pipeline:

- Native Android app (Kotlin → same API)
- Native iOS app (Swift → same API)
- Warehouse automation (PLC/conveyor → API integration)
- Supplier integrations (EDI → scan events)
- AI demand prediction (uses scan_events + inventory_transactions history)
- Multi-barcode per product (junction table: `product_barcodes`)
- Batch/lot tracking (add `lot_number`, `expiry_date` to scan_events)
- Unit conversion engine (kg ↔ g, crate ↔ piece)

No pipeline redesign needed — the architecture scales.

---

## MVP Definition of Done

- [x] **Schema:** `scan_events` + `idempotency_keys` tables created
- [x] **Service:** `processScan()` atomic pipeline with full error handling
- [x] **API:** `POST /api/scan` endpoint with auth + rate limiting
- [x] **API:** `POST /api/scan/batch` for offline sync
- [x] **API:** `GET /api/scan/lookup/:code` for barcode → product lookup
- [x] **API:** `GET /api/scan/history` for audit trail
- [x] **API:** `GET /api/scan/events` SSE real-time stock updates
- [x] **Migration:** Tables created and live (56 tables confirmed)
- [x] **Frontend:** Scan page with mode selector (Camera, Manual, Lookup, History)
- [x] **Frontend:** Camera scanning with `barcode-detector` WASM polyfill (all browsers)
- [x] **Frontend:** Manual barcode entry with Enter-key submit
- [x] **Frontend:** Visual confirmation (success/error flash)
- [x] **Frontend:** Hardware scanner support via `onscan.js`
- [x] **Frontend:** Offline scan queue (IndexedDB + auto-sync)
- [x] **Frontend:** Connectivity status bar + sync button
- [x] **Frontend:** SSE client for real-time stock change notifications
- [x] **Frontend:** Sidebar navigation + RBAC (staff, manager, admin)
- [ ] **Test:** USB scanner → stock updates correctly
- [ ] **Test:** Phone camera → stock updates correctly
- [ ] **Test:** Offline queue → syncs on reconnect
- [ ] **Test:** Duplicate scan within 2s → rejected
- [ ] **Test:** Same idempotency key → cached response returned

---

## Database Schema (New Tables)

### scan_events
```
id              uuid  PK
warehouse_id    uuid  FK → warehouses.id
user_id         uuid  FK → users.id
barcode         varchar(255)  NOT NULL, indexed
device_type     varchar(30)   NOT NULL  DEFAULT 'web'
status          varchar(30)   NOT NULL  DEFAULT 'pending_sync'
linked_transaction_id  uuid   nullable
product_id      uuid  FK → products.id, nullable
quantity        integer  NOT NULL  DEFAULT 1
scan_type       varchar(30)  NOT NULL  DEFAULT 'scan_add'
error_message   text  nullable
idempotency_key varchar(100)  unique, nullable
raw_payload     jsonb  nullable
metadata        jsonb  nullable
created_at      timestamptz  NOT NULL  DEFAULT now()
```

### idempotency_keys
```
id              uuid  PK
key             varchar(255)  NOT NULL, unique
request_hash    varchar(64)   NOT NULL
response_snapshot  jsonb  NOT NULL
expires_at      timestamptz  NOT NULL
created_at      timestamptz  NOT NULL  DEFAULT now()
```

### inventory_transactions (modified)
```
+ device_type   varchar(30)  nullable  -- NEW column
```
