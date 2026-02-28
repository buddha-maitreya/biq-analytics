# Python Predictive Analytics Roadmap

> **Last Updated:** February 25, 2026
> **Status:** Architecture decided. Implementation pending.
> **Related:** [docs/AGENTIC-OPTIMIZATION-RESEARCH.md](docs/AGENTIC-OPTIMIZATION-RESEARCH.md)

---

## Strategic Direction

**Python-based predictive analytics** (demand forecasting, sales trend projections, anomaly scoring, restock recommendations) is being moved off the Chat UI and onto the **Reports page**. This applies specifically to work that runs Python code in the Agentuity sandbox via the `insights-analyzer` agent.

**This does not affect narrative report generation.** Users can still ask the Chat UI to generate a sales summary, inventory health report, or any other narrative report — the `report-generator` agent (SQL-only, no sandbox) continues to serve those requests from chat without any change.

The distinction is:

| Capability | Mechanism | Where it lives |
|---|---|---|
| Narrative reports (sales summary, inventory health, etc.) | `report-generator` agent — SQL aggregation + LLM writing | **Chat UI ✅ stays** |
| Predictive analytics (forecasting, anomaly detection, trend projection) | `insights-analyzer` agent — Python sandbox execution | **Reports page only** |

This is a deliberate architectural decision for two specific reasons:

1. **Payload size & latency.** Python sandbox execution takes 10-45 seconds, generates base64-encoded charts (100-200 KB each), and returns large structured JSON payloads. The Chat UI is optimised for fast conversational back-and-forth — not for long-running computational jobs with chart output.
2. **User intent.** Predictive analytics is not an ad-hoc chat question; it is a structured analytical output the client wants to configure, download, and optionally schedule. The Reports page already has the infrastructure for this: date pickers, export formats (PDF/Excel/DOCX/PPTX/CSV), report history, and scheduler integration.

The `analyzeTrendsTool` in the `data-science` agent — which currently delegates to the `insights-analyzer` sandbox — will be removed or replaced with a redirect message. All other chat capabilities are unaffected.

**Reports page** will become the single entry point for all Python-sandbox predictive analytics.

---

## Core Concept — Pre-coded Analytics Templates (the "CRUD" model)

Your instinct is right, and the correct term is an **Analytics Template Library** — a catalogue of pre-defined analysis recipes stored in the database. The client browsesthe catalogue, selects the template that matches their business context, configures a few parameters (timeframe, products, granularity), and either runs it immediately or schedules it.

This is structurally a CRUD resource: templates can be created, listed, configured, and executed. Think of each template as a parameterised Python script that the sandbox executes. The client never writes code — they just pick from the menu.

### What a Template Contains

Each `analytics_template` record in the database stores:

| Field | Purpose |
|---|---|
| `slug` | Machine identifier — `demand-forecast`, `sales-trend`, `abc-analysis`, etc. |
| `name` | Display name shown in the UI — "Demand Forecast", "ABC Stock Analysis" |
| `description` | One-paragraph explanation of what this analysis does and who it's for |
| `category` | Groups templates in the UI — `forecasting`, `inventory`, `sales`, `customers`, `finance` |
| `industry_tags` | JSON array — `["retail", "hospitality", "wholesale"]` — used to suggest relevant templates per client |
| `python_script` | The full, tested Python analysis script (uses `query_db()` / `query_df()` API) |
| `parameters` | JSON schema defining configurable inputs (timeframe, product filter, threshold values, etc.) |
| `output_spec` | Describes the output shape — which charts, which insight fields, which KPIs |
| `default_schedule` | Suggested cadence — `weekly`, `monthly`, `none` |
| `is_active` | Whether this template is enabled for the deployment |
| `metadata` | Extensible — version notes, author, last tested date |

### Template Catalogue (Initial Library)

The following templates will be pre-coded and seeded as part of the initial release. Each is a complete, tested Python script that the existing sandbox infrastructure (`executeSandbox()` in `src/lib/sandbox.ts`) can execute without modification.

**Forecasting**
- `demand-forecast` — Sales velocity + moving averages + days-to-stockout per product. Uses `ExponentialSmoothing` from statsmodels.
- `revenue-forecast` — 30/60/90-day revenue projection using `scipy.stats.linregress` + seasonal decomposition.

**Sales Analytics**
- `sales-trends` — Overall growth rate, product momentum scoring, day-of-week patterns, top growers/decliners.
- `basket-analysis` — Frequently bought together (co-occurrence matrix). Identifies upsell pairings.

**Inventory**
- `restock-recommendations` — Safety stock, optimal reorder quantities, urgency classification (out-of-stock → critical → high → medium → low).
- `abc-analysis` — Classifies products into A (top 80% revenue), B (15%), C (5%). Standard inventory prioritisation.
- `slow-movers` — Identifies products with declining or stagnant velocity. Flags for promotion or clearance.
- `dead-stock` — Products with zero sales in the last N days. Flags for write-off or discount action.

**Customers**
- `customer-segmentation` — RFM (Recency, Frequency, Monetary) scoring. Groups customers into Champions, At Risk, Lost, etc.
- `churn-risk` — Customers whose purchase frequency has dropped below their historical baseline.
- `cohort-retention` — Monthly cohort retention rates. Shows how well new customers stick.

**Finance**
- `anomaly-detection` — Z-score and IsolationForest anomaly flagging on daily revenue, order volumes, and pricing.
- `margin-analysis` — Gross margin per product and category. Flags margin compression.

**Industry-Specific (seeded but disabled by default, activated per deployment)**
- `occupancy-forecast` *(hospitality)* — Booking rate trends and projected occupancy.
- `yield-analysis` *(agriculture/F&B)* — Production vs expected yield over time.
- `labour-cost-ratio` *(services)* — Labour as a percentage of revenue by period.

---

## Architecture

```
Reports Page (UI)
  │
  ├── [Browse Templates]
  │       └── GET /api/analytics/templates → lists all active templates for this deployment
  │
  ├── [Configure & Run]
  │       └── POST /api/analytics/templates/:slug/run
  │               → validates parameters
  │               → calls insights-analyzer agent with template script + params
  │               → saves result to saved_reports (reuses existing table, reportType = template slug)
  │               → returns { reportId, charts, insights, summary }
  │
  ├── [Schedule]
  │       └── POST /api/analytics/templates/:slug/schedule
  │               → creates/updates a row in the schedules table
  │               → scheduler agent picks it up at the configured cadence
  │               → execution saves result to saved_reports (isScheduled = true)
  │
  └── [View Results]
          └── Reuses existing saved_reports infrastructure
              Displays charts (base64 PNG) + structured insights panel
              Download as PDF/Excel via existing export pipeline
```

### Separation of Concerns

| Layer | Responsibility |
|---|---|
| `analytics_templates` DB table | Stores the template catalogue — slug, name, script, parameters |
| `src/services/analytics-templates.ts` | CRUD service — list, get, activate, seed built-in templates |
| `src/api/analytics.ts` | REST routes — `GET /api/analytics/templates`, `POST /run`, `POST /schedule` |
| `src/agent/insights-analyzer/agent.ts` | Unchanged — still executes the Python script in the sandbox |
| `src/services/scheduler.ts` | Unchanged — triggers scheduled execution via scheduler agent |
| `src/db/schema.ts` | New `analytics_templates` table + migration |
| `ReportsPage.tsx` | New "Analytics" tab within the Reports page (UI only) |

### Database Schema Addition

```typescript
// src/db/schema.ts  (new table)
export const analyticsTemplates = pgTable("analytics_templates", {
  id: id(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  name: varchar("name", { length: 200 }).notNull(),
  description: text("description").notNull(),
  category: varchar("category", { length: 50 }).notNull(),  // forecasting | inventory | sales | customers | finance
  industryTags: jsonb("industry_tags").$type<string[]>().notNull().default([]),
  pythonScript: text("python_script").notNull(),
  parameters: jsonb("parameters").$type<TemplateParameter[]>().notNull().default([]),
  outputSpec: jsonb("output_spec").$type<TemplateOutputSpec>(),
  defaultSchedule: varchar("default_schedule", { length: 20 }),  // daily | weekly | monthly | null
  isActive: boolean("is_active").notNull().default(true),
  isBuiltin: boolean("is_builtin").notNull().default(false),  // true = seeded, false = custom-added
  metadata: metadata(),
  ...timestamps(),
});
```

A `TemplateParameter` defines each configurable input:
```typescript
interface TemplateParameter {
  key: string;          // e.g. "timeframeDays"
  label: string;        // e.g. "Analysis Period"
  type: "number" | "string" | "boolean" | "date" | "product_id" | "category_id";
  default: unknown;     // e.g. 30
  min?: number;
  max?: number;
  options?: Array<{ value: unknown; label: string }>;  // for enum parameters
  required: boolean;
  description: string;
}
```

---

## Scheduler Integration

The existing `scheduler` agent and `schedules` DB table already support `taskType: "insight"`. The new templates layer maps directly onto this:

```
Schedule record (schedules table)
  taskType:   "insight"
  taskConfig: {
    templateSlug: "demand-forecast",
    parameters:   { timeframeDays: 30, limit: 20 },
    saveAs:       "demand-forecast-weekly",
    notifyUserId: "<uuid>"   // optional: notify this user on completion
  }
```

The scheduler agent will be updated to look up the `pythonScript` from `analytics_templates` by `templateSlug` before calling the insights-analyzer agent. No changes to the insights-analyzer agent are needed.

**Supported cadences:** daily, weekly (specific day of week), monthly (specific day of month), quarterly. Configured in the UI on the Reports page when scheduling a template.

---

## Reports Page — UI Changes

### New "Analytics" Tab

The Reports page will have two tabs:
- **Reports** — existing functionality (narrative text reports: sales-summary, inventory-health, etc.)
- **Analytics** — new predictive analytics templates (charts + structured insights, no narrative text)

The Analytics tab contains:
1. **Template browser** — cards grouped by category (Forecasting, Inventory, Sales, Customers, Finance). Each card shows name, description, and a "Run" button.
2. **Parameter panel** — slides in when a template is selected. Shows configurable parameters (timeframe, filters) with sensible defaults.
3. **Schedule toggle** — within the parameter panel, an option to save as a recurring schedule rather than a one-time run.
4. **Results panel** — displays the output: charts (rendered from base64 PNG), structured insights cards (title, severity, description, recommendation), and a summary banner.
5. **Download button** — exports the full analytical report (charts + insights) as PDF or Excel via the existing export pipeline.
6. **History** — reuses the existing saved_reports history panel, filtered to `reportType` matching analytics slugs.

### Eliminating Report Narrative Text in the Reports Tab

The existing Reports tab renders raw markdown in a `<pre>` tag, which is an ugly wall of text. The plan is to render the report content **as formatted HTML** instead, using a markdown renderer (e.g. `marked` or `react-markdown`). The `<pre className="report-text">` block in `ReportsPage.tsx` will be replaced with a styled markdown viewer. This means:

- Headings (`## Executive Summary`) render as visual section headers
- Tables render as proper HTML tables with alternating row colours
- Bold/italic text renders correctly
- The raw markdown string is still available for download (Copy / PDF export) — only the on-screen display changes

This is a frontend-only change — the report-generator agent output format does not change.

---

## Migration Strategy (Sandbox Analytics → Reports Page)

> **Scope:** Only the `analyzeTrendsTool` delegation to the `insights-analyzer` Python sandbox is being moved. The `generateReportTool` delegation to the `report-generator` agent remains fully operational in chat — users can still ask for sales reports, inventory reports, and any other narrative report directly from the Chat UI.

### Phase 1 — Redirect the analyzeTrendsTool

Remove `analyzeTrendsTool` from the data-science agent's tool set. When the chat detects a predictive analytics request (`"forecast"`, `"predict"`, `"anomaly"`, `"restock"` etc.), it will respond with a redirect message:

> "For demand forecasting and predictive analysis, head to the **Reports → Analytics** tab where you can run a full analysis with charts and schedule it to run automatically. You can still ask me for a written report summary here."

This eliminates the high-latency Python sandbox execution from the chat path. All other chat analysis capabilities (SQL queries, narrative reports, knowledge-base lookups) are unaffected.

### Phase 2 — Analytics Template Library (New Work)

1. Create `analytics_templates` DB table and migration
2. Create `src/services/analytics-templates.ts` (CRUD + seeding)
3. Create `src/api/analytics.ts` (REST routes)
4. Seed the built-in template catalogue (scripts ported from insights-analyzer prompts.ts + type-registry.ts)
5. Update `ReportsPage.tsx` — add Analytics tab, template browser, parameter panel, results renderer

### Phase 3 — Scheduler Integration

1. Update `scheduler` agent handler for `taskType: "insight"` to look up template script by slug
2. Add "Schedule this analysis" UI in the Analytics tab
3. Add notification on scheduled run completion (existing notifications table)

### Phase 4 — Report Output Rendering

Replace `<pre className="report-text">` in `ReportsPage.tsx` with a markdown renderer component. The raw text is preserved for export — only the on-screen presentation improves.

---

## Technical Stack

| Concern | Technology |
|---|---|
| Script execution | Agentuity sandbox (`python:3.13` runtime + snapshot) — unchanged |
| Statistical libraries | `numpy`, `pandas`, `scipy`, `scikit-learn`, `statsmodels`, `prophet` — already in snapshot |
| Chart generation | `matplotlib` / `seaborn` via `save_chart()` helper — unchanged |
| Template storage | Postgres via Drizzle ORM — new `analytics_templates` table |
| Template API | Hono router (`createRouter()`) — new `src/api/analytics.ts` |
| Scheduling | Existing `schedules` table + `scheduler` agent — extended, not replaced |
| Report storage | Existing `saved_reports` table — reused as-is |
| Export | Existing `/api/reports/export` pipeline (PDF/Excel/DOCX/PPTX) — unchanged |
| UI rendering | React — new Analytics tab in `ReportsPage.tsx`; `react-markdown` for report display |

---

## Phases

### Phase 0 — Architecture & Schema (Pre-work)
- Document architecture decisions (this file)
- Design `analytics_templates` DB schema
- Define `TemplateParameter` and `TemplateOutputSpec` TypeScript interfaces
- Decide on seeding strategy (seed script vs migration-embedded vs admin UI)

### Phase 1 — Template Library Foundation
- Create `analytics_templates` DB table + migration
- Create `src/services/analytics-templates.ts` — `listTemplates()`, `getTemplate()`, `seedBuiltins()`
- Port existing analysis scripts from `prompts.ts` and `type-registry.ts` into template records
- Write seed script: `scripts/seed-analytics-templates.ts`
- Create `src/api/analytics.ts` — `GET /api/analytics/templates`, `POST /api/analytics/templates/:slug/run`

### Phase 2 — Reports Page — Analytics Tab
- Add Analytics tab to `ReportsPage.tsx`
- Template browser (cards by category, industry tag filtering)
- Parameter configuration panel
- Results renderer: charts grid + insights cards + summary banner
- Download button (reuses existing export API)
- History panel (filtered `saved_reports` view)

### Phase 3 — Chat UI Redirect (sandbox analytics only)
- Remove `analyzeTrendsTool` from `data-science` agent's tool set (the `generateReportTool` delegation to `report-generator` is **not** changed)
- Add redirect guidance to the data-science agent's system prompt for predictive/forecasting requests
- Test that chat no longer triggers `insights-analyzer` sandbox executions
- Verify chat-based narrative report generation (`generateReportTool` → `report-generator`) continues to work normally

### Phase 4 — Scheduler Integration
- Update scheduler agent's `insight` task handler to look up `pythonScript` from `analytics_templates`
- Add `POST /api/analytics/templates/:slug/schedule` route
- Add schedule configuration UI in the Analytics tab (cadence selector, day-of-week/month picker)
- Add completion notification via existing `notifications` infrastructure

### Phase 5 — Report Output Rendering
- Install `react-markdown` + `remark-gfm` (for table support)
- Replace `<pre className="report-text">` with `<ReactMarkdown>` component in `ReportsPage.tsx`
- Style markdown output (table borders, heading hierarchy, code blocks)
- Verify raw text is still passed to PDF/Excel export (no regression)

### Phase 6 — Extended Template Library
- Add remaining templates from the catalogue above (basket analysis, ABC, RFM, etc.)
- Add `industry_tags` filtering in the UI so clients only see relevant templates
- Allow admin to add custom templates via the Admin Console (CRUD UI for `analytics_templates`)
- Add template versioning (update script without breaking existing scheduled runs)

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Sandbox cold-start latency (~10-45s) | Acceptable on the Reports page where users expect a wait. Show a progress indicator. Ensure `ANALYTICS_SNAPSHOT_ID` is set per deployment to eliminate package-install overhead. |
| Template script errors | Existing retry-with-LLM-correction in `executeSandbox()` handles script failures. Scripts are pre-tested, not LLM-generated at request time. |
| Large chart payloads (base64 PNG) | Already handled by `maxOutputBytes: 2MB` limit in the agent. Reports page loads charts lazily. |
| Chat UI regression | A/B test the redirect message UX before removing `analyzeTrendsTool` from the tool set entirely. |
| Template library maintenance | Mark templates as `is_builtin: true` so they can be updated via seed scripts without client data loss. |
| Scheduler failures | Existing `failExecution()` + failure-count tracking already in scheduler agent. |

---

## Open Questions

1. **Parameter UI complexity** — some templates (e.g. basket-analysis) have optional product filters that are multi-select. How complex should the parameter panel be before Phase 2? Decision needed before UI work starts.
2. **Custom template scripting** — should advanced clients be able to write their own Python scripts in the Admin Console? This is Phase 6+ and requires sandboxed script validation before saving.
3. **Notification delivery** — when a scheduled analysis completes, how is the client notified? In-app notification (existing `notifications` table) is confirmed. Email/SMS is a separate feature.
4. **Analytics vs Reports tab naming** — "Analytics" and "Reports" overlap in meaning to a non-technical user. Consider "Insights" for the predictive tab, or combine into a single tab with a category filter. To be decided before UI work begins.

