# Business IQ Enterprise — Roadmap

**Product:** Analytics as a Service — AI-powered BI platform
**Developed by:** Ruskins AI Consulting LTD © 2026
**Last updated:** March 2026
**Strategic context:** See `BI-PIVOT.md`

---

## Vision

> Business IQ Enterprise is an agentic BI platform that plugs into any business system, turns raw transaction data into intelligence, and deploys AI agents that don't just surface insights — they act on them.

**Three layers:**
1. **Data layer** — Connectors ingest data from any POS, ERP, M-Pesa, Paystack, eTIMS
2. **Analytics layer** — Python microservice runs 27+ statistical modules (forecasting, classification, anomaly detection)
3. **Agent layer** — Agentuity agents reason on analytics output and take actions (draft emails, update CRMs, trigger workflows, file compliance reports)

---

## Architecture

```
External Systems (POS / ERP / M-Pesa / Paystack / eTIMS)
        │ webhooks + connectors
        ▼
  Single-tenant Postgres (per client, Neon)
        │
        ├── Analytics Microservice (FastAPI, Railway)
        │   └── 27 modules: Prophet, ARIMA, IsolationForest, RFM, CLV...
        │
        └── Agentuity Agents (7 live + action agents TBD)
                │
                ├── Data Science Assistant (orchestrator)
                ├── Insights Analyzer (Python sandbox, ad-hoc)
                ├── Report Generator (narrative + PDF/XLSX/PPTX)
                ├── Knowledge Base (RAG / document QA)
                ├── Scheduler (cron-driven automation)
                ├── Document Scanner (OCR / barcode)
                └── Data Importer (CSV / REST / webhook)
```

---

## Status Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Complete and production-ready |
| ⚠️ | Built but needs live credentials / wiring |
| 🔲 | Not started |
| 🚧 | In progress |

---

## Phase 1 — Platform Foundation ✅

- [x] Agentuity project setup + Neon Postgres
- [x] Drizzle ORM schema (53+ tables)
- [x] JWT auth + 5-tier RBAC (super_admin, admin, manager, staff, viewer)
- [x] React 19 frontend with SSE streaming
- [x] Industry-agnostic design (env-driven labels, no hardcoded domain terms)
- [x] Single-tenant isolation (dedicated DB per client)

---

## Phase 2 — Core Agents ✅

- [x] **Data Science Assistant** — orchestrator, routes queries to specialists
- [x] **Insights Analyzer** — Python sandbox, statistical analysis, chart generation
- [x] **Report Generator** — AI-narrated PDF/XLSX/PPTX reports with inline charts
- [x] **Knowledge Base** — RAG with vector embeddings (Agentuity KV)
- [x] **Scheduler Agent** — cron-driven report + alert automation
- [x] **Document Scanner** — multimodal OCR, barcode extraction, invoice parsing
- [x] **Data Importer** — CSV/REST/webhook data ingestion

---

## Phase 3 — Analytics Engine ✅

- [x] Python analytics microservice (FastAPI, Dockerized, Railway-ready)
- [x] 27 analytics modules:
  - Charts: sales_trends, heatmap, scatter, treemap, pareto, waterfall, forecast_plot, geo_map, render
  - Forecasting: Prophet (Kenyan holidays), ARIMA, Holt-Winters, safety stock + EOQ, seasonal detection
  - Classification: ABC-XYZ, RFM segmentation, CLV (BG/NBD + Gamma-Gamma), bundle detection
  - Anomaly: IsolationForest (transactions), shrinkage detection
  - Insights: value gap, dead stock, cash simulation, procurement plan, supplier analysis, stockout cost, sales velocity
- [x] TypeScript HTTP bridge (circuit breaker, retry, sandbox fallback)
- [x] Type registry + analytics query functions for all 27 modules
- [x] Dockerfile with CmdStan pre-compiled (Prophet-ready)
- [x] `railway.toml` for Railway deployment

---

## Phase 4 — BI Frontend ✅

- [x] BI Dashboard with KPI cards + period-over-period trend (▲/▼)
- [x] Date range picker with presets + natural language filter
- [x] Interactive charts (hover tooltips, clickable bars, area gradients)
- [x] Category drill-down (Dashboard → Category → Products)
- [x] Alerts panel (collapsible, clickable, badge count)
- [x] Analytics Explorer page (all 27 modules, parameter controls, results display)
- [x] AI-narrated reports page (PDF/XLSX/PPTX export)
- [x] AI Assistant page (streaming chat, tool-call visualization)
- [x] Removed all ERP/CRUD pages (Products, Orders, Inventory, POS, Scanner, etc.)

---

## Phase 5 — Data Connectors ✅

- [x] Connector framework with registry pattern
- [x] Data normalizer with auto field-detection
- [x] CSV connector (column auto-mapping, batch insert, preview)
- [x] Webhook receiver (HMAC signature verification, idempotency)
- [x] Generic REST connector
- [x] M-Pesa POS adapter (Daraja C2B normalization)
- [x] Paystack webhook adapter
- [x] `externalId` + `externalSource` columns on products/orders/customers (migration 0011)

---

## Phase 6 — Live Integrations ⚠️ CURRENT PRIORITY

### 6.1 M-Pesa (Daraja API) ⚠️
- [x] Adapter framework + field normalization
- [x] STK Push / Till / Paybill config model
- [x] Webhook receiver + signature verification
- [ ] Live API calls — replace mock responses with real Daraja HTTP calls
- [ ] STK Push initiation (C2B payment trigger)
- [ ] Payment status polling / callback handling
- [ ] M-Pesa ↔ POS transaction reconciliation analytics module
- [ ] M-Pesa cash flow dashboard (float management, velocity, peak times)

### 6.2 Paystack ⚠️
- [x] Webhook adapter + signature verification
- [x] Basic payment init structure
- [ ] Live API calls — payment initialization + status query
- [ ] Paystack ↔ orders reconciliation

### 6.3 KRA eTIMS ⚠️
- [x] Service file with all types + method stubs
- [x] API routes: /kra/status, /kra/pin/validate, /kra/tcc/validate, /kra/invoice/*
- [x] DB columns: invoices.kraVerified, kraVerifiedAt, kraInvoiceNumber
- [ ] Live OAuth token — real call to KRA authorization endpoint
- [ ] eTIMS OSCU — submit invoices to KRA in real-time
- [ ] PIN validation on customer/supplier record creation
- [ ] TCC verification
- [ ] eTIMS compliance analytics module (filing status, VAT liability, risk flags)
- [ ] Compliance dashboard in frontend

---

## Phase 7 — Action Agents 🔲 NEXT AFTER PHASE 6

These agents turn insights into action — the core differentiator positioning BIQ as fully agentic.

### 7.1 Restock Agent 🔲
- Trigger: safety stock threshold breached (analytics or scheduler)
- Action: drafts purchase order → emails supplier → audit trail

### 7.2 Collection Agent 🔲
- Trigger: invoice overdue > N days
- Action: sends M-Pesa STK Push + SMS reminder to customer

### 7.3 Compliance Agent 🔲
- Trigger: KRA filing deadline approaching (cron)
- Action: validates eTIMS data → summarizes compliance status → alerts finance

### 7.4 Weekly Digest Agent 🔲
- Trigger: Scheduled (Sunday 8pm)
- Action: generates PDF report → emails to stakeholders

### 7.5 Anomaly Response Agent 🔲
- Trigger: IsolationForest flags unusual transactions
- Action: investigates root cause → drafts summary → notifies manager

### 7.6 CRM Sync Agent 🔲
- Trigger: New/updated customer record
- Action: syncs to HubSpot / Zoho / custom API

---

## Phase 8 — Email & Notifications 🔲

- [ ] SMTP backend (transactional emails: reports, alerts, reminders)
- [ ] Email template system (report delivery, invoice reminder, low stock alert)
- [ ] WhatsApp Business API (Africa's Talking or Meta)
- [ ] Africa's Talking SMS (M-Pesa payment reminders)
- [ ] In-app notification center (SSE push)

---

## Phase 9 — Production Hardening 🚧

### 9.1 Deployment — IMMEDIATE
- [ ] Deploy analytics-service to Railway → get URL
- [ ] Set ANALYTICS_SERVICE_URL in Agentuity environment
- [ ] Deploy main platform via `agentuity deploy`
- [ ] Smoke test: Dashboard → Analytics Explorer → Prophet forecast → PDF export
- [ ] Verify /health on both services

### 9.2 Security
- [ ] Lock CORS_ORIGINS on analytics-service to Agentuity URL
- [ ] Rotate all API keys before production
- [ ] Audit webhook signature verification
- [ ] Review rate limiting thresholds

### 9.3 Testing
- [ ] Integration test: data connector → DB → analytics → report flow
- [ ] Agent evaluation framework
- [ ] Load test SSE connections (concurrent users)
- [ ] Analytics module smoke tests on Railway

### 9.4 Client Onboarding (DEPLOYMENT.md)
- [ ] Create Agentuity project + Neon Postgres
- [ ] Configure .env (currency, branding, API keys)
- [ ] Run drizzle migrations
- [ ] Deploy via `agentuity deploy`
- [ ] Set ANALYTICS_SERVICE_URL
- [ ] Seed initial users + demo data

---

## Phase 10 — Advanced BI 🔲

- [ ] Multi-period comparison (YoY, QoQ) in dashboard
- [ ] Scheduled report delivery (email PDF weekly/monthly)
- [ ] Product-level drill-down with historical trend + forecast
- [ ] eTIMS compliance analytics page
- [ ] M-Pesa reconciliation analytics (float, velocity, peak times)
- [ ] Supplier performance analytics
- [ ] Cash flow simulation dashboard
- [ ] External CRM connector (HubSpot, Zoho)

---

## Integrations Status Matrix

| Integration | Framework | Live API | Analytics Module | Agent Action |
|-------------|-----------|----------|-----------------|--------------|
| M-Pesa | ✅ | 🔲 | 🔲 reconciliation | 🔲 STK Push |
| Paystack | ✅ | 🔲 | 🔲 reconciliation | 🔲 |
| KRA eTIMS | ✅ | 🔲 | 🔲 compliance | 🔲 auto-file |
| CSV Import | ✅ | ✅ | — | — |
| REST Connector | ✅ | ✅ | — | — |
| Webhooks | ✅ | ✅ | — | — |
| Email (SMTP) | 🔲 | 🔲 | — | 🔲 digest |
| WhatsApp | 🔲 | 🔲 | — | 🔲 reminders |
| CRM | 🔲 | 🔲 | — | 🔲 sync |

---

## Deployment Architecture (Target)

```
┌─────────────────────────────────────────────┐
│  Agentuity Cloud (per client)                │
│  ├── TypeScript Platform (this repo)         │
│  │   ├── 7 agents                            │
│  │   ├── React 19 frontend                   │
│  │   └── Neon Postgres (dedicated)           │
│  └── ANALYTICS_SERVICE_URL ──────────────┐  │
└──────────────────────────────────────────│--┘
                                           │
                        ┌──────────────────▼──┐
                        │  Railway             │
                        │  analytics-service   │
                        │  FastAPI + 27 modules│
                        │  ~$10-15/mo shared   │
                        └─────────────────────┘
```
