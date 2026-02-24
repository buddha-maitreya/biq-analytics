# Agents Roadmap — Business IQ Enterprise

**Purpose:** Track every action needed to evolve the agent system from its current state
to a production-grade, scalable, industry-agnostic AI architecture — grounded entirely
in the Agentuity platform capabilities documented in `.copilot/skills/`.

**Design principles:**
- Industry-agnostic — same agents serve retail, wholesale, manufacturing, F&B, healthcare, etc.
- Config-driven — behavior differences come from DB/env config, never code branches.
- Lean agent code — agents are thin orchestrators; business logic lives in services.
- Platform-native — prefer Agentuity SDK primitives over hand-rolled solutions.

---

## Current Agent Roster

| Codename | Agent ID | File | Role |
|----------|----------|------|------|
| **The Brain** | `data-science` | `src/agent/data-science/index.ts` | Orchestrator — conversation, tool routing, multi-step reasoning |
| **The Analyst** | `insights-analyzer` | `src/agent/insights-analyzer/index.ts` | Computational intelligence — sandbox code execution |
| **The Writer** | `report-generator` | `src/agent/report-generator/index.ts` | Professional narrative reports from data |
| **The Librarian** | `knowledge-base` | `src/agent/knowledge-base/index.ts` | Document retrieval via vector search (RAG) |

---

## Phase 1 — Architectural Patterns

Establish the foundational patterns that all agents follow. No feature work until
these patterns are locked in.

### 1.1 Agent Lifecycle Hooks

**Status:** ✅ Complete
**SDK ref:** `.copilot/skills/agentuity-creating-agents.md` → `setup()` / `shutdown()`

Currently none of the 4 agents use `setup()` or `shutdown()`. These hooks run once
at agent startup/teardown and are the right place for:

- [ ] **Warm caches** — pre-load `agent_configs` and `aiSettings` into memory on startup
      instead of fetching from DB on every request.
- [ ] **DB connection pool** — initialize a shared Drizzle client in `setup()` and
      store it on `ctx.app` so all requests reuse the same pool.
- [ ] **Config refresh** — set a timer in `setup()` to periodically re-read
      `agent_configs` so admin changes take effect without redeploy.

```typescript
// Target pattern for every agent
export default createAgent("agent-name", {
  schema: { input: inputSchema, output: outputSchema },
  setup: async (ctx) => {
    // Pre-load config, warm caches, initialize connections
    const config = await getAgentConfigWithDefaults("agent-name");
    ctx.app.set("config", config);
  },
  handler: async (ctx, input) => {
    const config = ctx.app.get("config"); // Fast — no DB call
    // ...
  },
});
```

### 1.2 Deduplicate DB_SCHEMA

**Status:** ✅ Complete

The `DB_SCHEMA` string constant is copy-pasted across 3 agent files (data-science,
insights-analyzer, report-generator). This causes drift and maintenance burden.

- [ ] Extract `DB_SCHEMA` into a shared module: `src/lib/db-schema.ts`
- [ ] Export as `export const DB_SCHEMA: string = ...`
- [ ] Import in all agents that need schema context for LLM prompts
- [ ] Generate `DB_SCHEMA` dynamically from the Drizzle schema at build time
      (stretch goal — ensures it never drifts from the actual schema)

### 1.3 Deduplicate SQL Safety Checks

**Status:** ✅ Complete

SQL safety validation (checking for destructive statements like DROP, DELETE, ALTER)
is duplicated 3 times across agents.

- [ ] Extract into `src/lib/sql-safety.ts` with `validateReadOnlySQL(sql: string): { safe: boolean; reason?: string }`
- [ ] Import in data-science, insights-analyzer, report-generator
- [ ] Add configurable allow-list for write operations (some deployments may want
      agents to perform UPDATE/INSERT for automated actions)

### 1.4 Streaming Architecture Migration

**Status:** ✅ Complete
**SDK ref:** `.copilot/skills/agentuity-routes.md` → `sse()`, `websocket()`

The chat system uses a hand-rolled SSE implementation with an in-memory `sessionBus`
Map. The SDK provides `sse()` and `websocket()` middleware that handle connection
lifecycle, heartbeats, and cleanup automatically.

- [ ] **Evaluate SDK SSE middleware** — determine if `sse()` from `@agentuity/runtime`
      can replace the manual `ReadableStream` construction in `src/api/chat.ts`
- [ ] **Evaluate WebSocket migration** — `websocket()` middleware enables bidirectional
      communication (client can cancel/interrupt streams). Assess feasibility.
- [ ] **Replace manual SSE** — if SDK middleware fits, migrate `src/api/chat.ts` to use it
- [ ] **Update frontend hook** — migrate `useChatStream` to `useEventStream` or
      `useWebsocket` from `@agentuity/react`

### 1.5 Agent-to-Route Pattern

**Status:** ✅ Complete
**SDK ref:** `.copilot/skills/agentuity-creating-agents.md` → `schema: { stream: true }`

`streamChat()` is exported as a bare function from `data-science/index.ts` rather than
going through the agent's lifecycle (`createAgent` → handler). This bypasses `ctx`
setup, thread tracking, and session metadata.

- [ ] **Evaluate `schema: { stream: true }`** — can the agent's handler return a streaming
      response natively? If yes, wire the chat route to call `agent.run()` instead of
      importing `streamChat()` directly.
- [ ] **If streaming handler isn't supported** — keep `streamChat()` but ensure it still
      has access to `ctx` for logging, KV, and thread state.

### 1.6 Background Task Pattern

**Status:** ✅ Complete
**SDK ref:** `.copilot/skills/agentuity-sdk-reference.md` → `ctx.waitUntil()`

`maybeCompressSummary()` is called fire-and-forget with `.catch(() => {})`. This means
errors are silently swallowed and the runtime may terminate before completion.

- [ ] **Use `ctx.waitUntil()`** for all background work: summary compression, analytics
      tracking, session auto-titling, tool execution logging
- [ ] **Audit all fire-and-forget calls** across agents and routes

### 1.7 Event System & Observability

**Status:** ✅ Complete
**SDK ref:** `.copilot/skills/agentuity-sdk-reference.md` → `addEventListener`, `ctx.tracer`

No agents use the event system or OpenTelemetry tracing.

- [ ] **Define event taxonomy** — `agent.invoked`, `tool.executed`, `sandbox.run`,
      `report.generated`, `knowledge.queried`, etc.
- [ ] **Add OpenTelemetry spans** for: LLM calls, SQL execution, sandbox runs,
      agent-to-agent calls, custom tool execution
- [ ] **Wire `ctx.logger`** consistently — replace any remaining `console.log` calls

---

## Phase 2 — Frontend (Admin Configs & UI Placements)

### 2.1 Agent Config Admin UI

**Status:** ✅ Complete

The `agent_configs` table and service layer are fully wired. The Admin Console Settings
tab has agent config editing. Needs polish and completeness.

- [ ] **Per-agent config cards** — show current model, temperature, maxSteps, timeout,
      customInstructions, and enable/disable toggle for each of the 4 agents
- [ ] **Config validation** — surface errors when setting invalid temperature (< 0 or > 2),
      maxSteps (< 1 or > 20), or timeout (< 5000 or > 300000)
- [ ] **Config history** — track when config was last changed and by whom
- [ ] **Reset to defaults** — one-click restore for each agent's config

### 2.2 Custom Tools Admin UI

**Status:** Backend complete, frontend editor exists, seed button pending

- [ ] **Seed Starter Tools button** — add a button in the Admin Console Custom Tools tab
      that calls `POST /api/custom-tools/seed` to create the 11 default tools
- [ ] **Tool testing UI** — allow admins to execute a tool with sample parameters and see
      the response before activating it for AI use
- [ ] **Tool usage analytics** — show how often each tool is used, success rate, avg latency
- [ ] **MCP tools section** — reserved area for Model Context Protocol tools (future)

### 2.3 AI Chat Improvements

**Status:** ✅ Complete

- [ ] **Streaming status indicators** — show which specialist agent is currently working
      (e.g., "The Analyst is computing..." or "The Writer is drafting...")
- [ ] **Tool call visualization** — render tool calls inline with collapsible details
      (the `ToolCallCard` component exists but may need refinement)
- [ ] **Client-side tool responses** — when a client tool returns `expectsResponse: true`,
      the frontend should send the response back to the agent via SSE/WebSocket
- [ ] **Cancel/interrupt** — allow the user to stop a long-running generation
      (requires WebSocket or abort signal)

### 2.4 Reports Page Enhancements

**Status:** ✅ Complete

- [ ] **Report scheduling UI** — configure cron-based report generation
      (uses `cron()` middleware from SDK)
- [ ] **Report download** — export generated reports as PDF or CSV
- [ ] **Report history** — persist generated reports with `ctx.kv` or durable streams
      so they can be viewed later without regeneration

### 2.5 Dashboard AI Widgets

**Status:** ✅ Complete

- [ ] **AI Insights widget** — surface top 3 insights from insights-analyzer on the
      dashboard, refreshed daily via cron
- [ ] **Natural language dashboard filter** — type "show me last week" in a search bar
      and have the AI translate to date range filters

---

## Phase 3 — DB Communication

### 3.1 Dynamic DB Schema for LLM Context

**Status:** ✅ Complete

The `DB_SCHEMA` constant is a static string. It should be generated from Drizzle at
build time or runtime to ensure it matches the actual schema.

- [ ] **Build-time schema generation** — add a script to `scripts/` that introspects
      Drizzle schema and outputs a concise schema description string
- [ ] **Schema versioning** — include a hash so agents can detect when schema changes
      require cache invalidation
- [ ] **Schema compression** — for LLM context efficiency, generate a minimal schema
      representation (table names, column names, types, relationships) without DDL

### 3.2 Query Result Caching

**Status:** ✅ Complete
**SDK ref:** `.copilot/skills/agentuity-storage.md` → KV storage

No agent uses `ctx.kv` despite it being ideal for caching:

- [ ] **Cache frequent queries** — aggregate queries (revenue, order counts, stock levels)
      with short TTLs (60-300 seconds)
- [ ] **Cache analysis results** — insights-analyzer output with medium TTLs (10-30 minutes)
- [ ] **Cache report outputs** — generated reports with longer TTLs (1-24 hours)
- [ ] **Cache invalidation** — when data changes (new order, stock update), invalidate
      relevant cached queries via KV delete or short TTL

### 3.3 Conversation Memory

**Status:** ✅ Complete (custom DB-based + ctx.thread.metadata)

The system uses a custom rolling summary + recent messages pattern stored in Postgres
(`chatSessions.metadata.summary` + `chatMessages`). This is a deliberate design choice
for unlimited conversation length and persistence beyond Agentuity's 1-hour thread TTL.

- [ ] **Evaluate hybrid approach** — use `ctx.thread.state` for the active session's
      short-term context (within 1-hour window) and DB for long-term persistence
- [ ] **Use `ctx.thread.metadata`** — store user ID and session type in unencrypted
      thread metadata for filtering and analytics
- [ ] **Optimize summary compression** — the current `maybeCompressSummary()` is
      a full LLM call. Consider extractive summarization or bullet-point compression
      without LLM for faster and cheaper compression.

### 3.4 Extensible Analysis & Report Types

**Status:** ✅ Complete

Currently `insights-analyzer` has 4 hardcoded analysis types and `report-generator`
has 4 hardcoded report types as Zod enums. These should be data-driven.

- [ ] **Move analysis types to DB** — store available analysis types in `agent_configs`
      or a dedicated `analysis_types` table, each with a prompt template
- [ ] **Move report types to DB** — same pattern for report types
- [ ] **Allow custom types** — admins can define new analysis/report types via the
      Admin Console without code changes
- [ ] **Per-type prompt templates** — each type has its own prompt section that the
      agent injects, stored in DB alongside the type definition

---

## Phase 4 — Sandbox Infrastructure

### 4.1 Sandbox Execution Hardening

**Status:** ✅ Complete
**SDK ref:** `.copilot/skills/agentuity-sandbox.md`

The insights-analyzer uses `executeSandbox()` from `src/lib/sandbox.ts` for
JavaScript/TypeScript code execution. Several improvements needed:

- [ ] **Error classification** — distinguish between: syntax error, runtime error,
      timeout, resource limit exceeded, and import failure. Return structured errors
      so the LLM can self-correct.
- [ ] **Output size limits** — cap sandbox output to prevent memory issues when
      the LLM generates code that produces very large datasets
- [ ] **Retry with correction** — if sandbox fails, feed the error back to the LLM
      and let it fix the code (up to 2 retries)

### 4.2 Sandbox Snapshots

**Status:** ✅ Complete
**SDK ref:** `.copilot/skills/agentuity-sandbox.md` → `sandbox.snapshot()`

Cold-starting a sandbox for every analysis request adds latency. Snapshots
pre-install common dependencies.

- [ ] **Create base snapshot** — `bun:1` runtime with commonly used packages
      (e.g., `simple-statistics`, `date-fns`, `lodash`) pre-installed
- [ ] **Use snapshot in insights-analyzer** — pass snapshot ID to `executeSandbox()`
      for faster cold starts
- [ ] **Snapshot versioning** — store snapshot ID in agent config so it can be
      updated without code changes

### 4.3 Interactive Sandbox Sessions

**Status:** ✅ Complete
**SDK ref:** `.copilot/skills/agentuity-sandbox.md` → Interactive sandbox

Currently all sandbox usage is one-shot (run code, get result, sandbox dies).
Interactive sessions allow multiple commands in the same sandbox.

- [ ] **Evaluate interactive sessions** — for complex multi-step analyses, an
      interactive sandbox session could be more efficient (load data once, run
      multiple computations)
- [ ] **Session lifecycle** — manage sandbox session creation, reuse, and cleanup
- [ ] **Use case: iterative analysis** — let the LLM run code, inspect results,
      then run follow-up code in the same session

### 4.4 Multi-Runtime Support

**Status:** ✅ Complete
**SDK ref:** `.copilot/skills/agentuity-sandbox.md` → 10+ runtimes

The sandbox supports Python, R, and other runtimes. Currently only `bun:1` is used.

- [ ] **Python runtime** — for data science workloads that benefit from pandas, numpy,
      scipy, scikit-learn (when Bun/JS equivalents are insufficient)
- [ ] **Runtime selection** — let the LLM or config choose the best runtime for a task
- [ ] **Per-analysis runtime** — store preferred runtime in the analysis type config

### 4.5 Analytics Sandbox Quality Engineering

**Status:** ✅ Complete

Production-grade quality infrastructure for the Phase 10 Python analytics sandbox:

- [x] **Code template library** — pre-built Python code templates stored in KV
      (`analytics:templates:<action>`), keyed by analysis type. The data-science agent
      retrieves templates and fills parameters instead of generating from scratch.
      Dramatically reduces hallucination.
- [x] **Python input validation** — `validate_input()` added to `main.py` dispatcher.
      Validates column existence, numeric data types, minimum row counts, and date
      column parsing before dispatching to any analytics module.
- [x] **Execution metrics tracking** — `logAnalyticsMetrics()` records `durationMs`,
      `cpuTimeMs`, `memoryByteSec`, `exitCode`, and `dataRowCount` per action type
      in KV storage with 24h TTL. `getAnalyticsMetrics()` retrieves aggregated stats
      for admin dashboard.
- [x] **Output schema validation** — `validateAnalyticsOutput()` in `analytics.ts`
      validates Python output structure: summary objects, chart base64 data/dimensions,
      table column/row structure. Catches malformed output early.
- [ ] **Canary execution** — run analytics on first 100 rows before full dataset.
      If canary fails, abort without wasting resources on full execution.
- [ ] **Output fingerprinting** — hash action + params + data, cache results in KV
      with TTL. Return cached result for identical repeat queries.

---

## Phase 5 — Agent Code

### 5.1 Agent Docstrings Cleanup

**Status:** ✅ Complete (no encoding issues found)

The specialist agent docstrings have issues:

1. **Cross-agent references** — each specialist lists all other agents in a
   "Vs. other agents:" or "How it differs:" section. This is maintenance burden
   and should be removed. Agents should describe only their own capability.
2. **Terminology** — "data scientist" label in insights-analyzer conflates it
   with the data-science orchestrator. Each agent has a clear codename — use it.
3. **Encoding artifacts** — em-dashes (`—`) and smart quotes (`"`) are stored as
   mojibake (`â€"`, `â€œ`) making string replacement difficult.

Resolution plan:
- [ ] **Fix encoding** — re-save each agent file with clean UTF-8 encoding
      (may require full file rewrite)
- [ ] **Simplify docstrings** — each agent describes only its own role, capability,
      and architecture. No cross-agent comparison blocks.
- [ ] **Align terminology** — use codenames consistently: The Brain, The Analyst,
      The Writer, The Librarian. Remove "data scientist" from The Analyst's docstring.

### 5.2 Data Science Agent (The Brain) Improvements

**Status:** ✅ Complete

- [ ] **Use `setup()` hook** — pre-load AI settings, agent config, and tool registry
      once on startup instead of per-request
- [ ] **KV caching for business snapshot** — `get_business_snapshot` tool queries the DB
      on every call. Cache with 60-second TTL via `ctx.kv`.
- [ ] **Structured tool result types** — define TypeScript types for each tool's
      return value for better type safety and LLM prompt accuracy
- [ ] **Max steps configurability** — already in `agent_configs` but needs testing
      across various conversation patterns (default 8 may be too many for simple queries)
- [ ] **Graceful tool failure** — when a specialist agent fails, return a structured
      error to the LLM so it can report the failure to the user instead of hanging

### 5.3 Insights Analyzer (The Analyst) Improvements

**Status:** ✅ Complete

- [ ] **Remove two-step LLM pattern** — currently does a `generateText` to get SQL+code,
      then a `generateObject` to format the result. Consolidate into a single
      tool-calling flow where the LLM can iterate.
- [ ] **Dynamic analysis types** — replace hardcoded enum with DB-driven types
      (see Phase 3.4)
- [ ] **Result caching** — cache analysis results in `ctx.kv` with TTL based on
      analysis type (trend analyses: 30 min, anomaly detection: 5 min)
- [ ] **Confidence scoring** — improve the confidence score mechanism from
      LLM-estimated to computation-based (sample size, variance, p-values)

### 5.4 Report Generator (The Writer) Improvements

**Status:** ✅ Complete

- [ ] **Report persistence** — store generated reports in `ctx.kv` or durable streams
      so they can be retrieved later without regeneration
- [ ] **Report versioning** — track when a report was last generated and allow
      comparison between versions
- [ ] **Dynamic report types** — replace hardcoded enum with DB-driven types
      (see Phase 3.4)
- [ ] **Export formats** — generate PDF, CSV, and XLSX in addition to markdown
      (use sandbox for format conversion)
- [ ] **Scheduled reports** — cron-triggered periodic report generation stored
      for later retrieval

### 5.5 Knowledge Base (The Librarian) Improvements

**Status:** ✅ Complete

- [ ] **Fix vector listing** — `query: "*"` for listing documents is semantically
      meaningless. Use metadata-only search or a dedicated listing approach.
- [ ] **Chunking in agent** — currently documents must be pre-chunked before
      ingestion. Move chunking logic into the agent using `src/lib/chunker.ts`.
- [ ] **Metadata-only search** — support searching by metadata (filename, category,
      upload date) without vector similarity
- [ ] **Similarity threshold config** — the 0.65 threshold is hardcoded. Move to
      `agent_configs` for per-deployment tuning.
- [ ] **Source citation formatting** — improve how sources are cited in answers
      (currently just filename strings)

### 5.6 New Agent: Scheduler (Future)

**Status:** ✅ Complete
**SDK ref:** `.copilot/skills/agentuity-routes.md` → `cron()` middleware

A dedicated scheduling agent for periodic tasks:

- [ ] **Design scheduler agent** — handles cron-triggered report generation,
      daily insight summaries, stock alert checks, data cleanup
- [ ] **Cron route integration** — wire `cron()` middleware routes that invoke
      the scheduler agent on configurable schedules
- [ ] **Schedule management** — admins configure schedules via the Admin Console
- [ ] **Execution history** — track what ran, when, and the result

---

## Phase 6 — Data Sources (Internal & External)

### 6.1 Internal Data Sources

All agents currently access Postgres directly via Drizzle. Improvements:

- [ ] **Service layer consistency** — all DB access should go through `src/services/`
      rather than agents writing raw SQL. Agents that use `query_database` tool
      bypass the service layer by design (LLM generates SQL), but when the agent
      itself needs data (e.g., `getBusinessSnapshot`), it should use services.
- [ ] **Vector store optimization** — knowledge-base uses vector search for RAG.
      Evaluate chunking strategies, embedding model selection, and similarity
      thresholds for better retrieval quality.
- [ ] **KV store utilization** — adopt `ctx.kv` across all agents for caching
      (see Phase 3.2)

### 6.2 External Data Sources

**Status:** ✅ Complete

The custom tools framework supports HTTP-based external API calls. Build on this:

- [ ] **API integration patterns** — document standard patterns for connecting to
      external services (accounting systems, payment gateways, shipping APIs)
- [ ] **OAuth2 token management** — the custom tools schema supports OAuth2 but
      the token refresh flow needs implementation
- [ ] **Webhook receivers** — accept webhooks from external systems (e.g., payment
      confirmations, shipping status updates) and route them to agents
- [ ] **Data import agents** — scheduled sync from external systems (ERP, CRM,
      accounting) into the local database
- [ ] **Rate limiting** — protect external API calls with configurable rate limits
      per tool / per external service

### 6.3 Durable Streams

**Status:** ✅ Complete
**SDK ref:** `.copilot/skills/agentuity-storage.md` → Durable Streams

Durable streams provide persistent, URL-addressable data streams:

- [ ] **Report downloads** — write generated reports to durable streams, return
      shareable URLs to the user
- [ ] **CSV/Excel exports** — generate export files in sandbox, write to durable
      stream, return download URL
- [ ] **Audit trails** — log all agent actions to a durable stream for compliance
- [ ] **Data pipeline** — use streams for agent-to-agent data handoff when the
      payload is too large for direct return values

### 6.4 Object Storage

**Status:** ✅ Complete
**SDK ref:** `.copilot/skills/agentuity-storage.md` → Object Storage (S3)

Bun's native `s3` module provides S3-compatible object storage:

- [ ] **Document storage** — store uploaded knowledge base documents in object
      storage instead of only as vector embeddings
- [ ] **Report PDF storage** — persist generated PDF reports
- [ ] **Attachment handling** — allow file attachments in chat that get stored
      and indexed

---

## Phase 7 — Prompt Engineering

### 7.1 System Prompt Architecture

**Status:** ✅ Complete

The data-science agent has a well-structured, config-driven `buildSystemPrompt()`.
The specialist agents have more static prompts.

- [ ] **Unified prompt builder** — create a shared `buildAgentPrompt()` utility in
      `src/lib/prompts.ts` that all agents use. Takes agent-specific sections but
      shares common structure: role → context → tools → guardrails → formatting.
- [ ] **Prompt versioning** — store prompt templates in DB with version tracking
      so admins can iterate without code changes and roll back if needed.
- [ ] **Prompt testing** — build an admin UI for editing and testing prompt changes
      against sample inputs before activating them.

### 7.2 Terminology Consistency

**Status:** ✅ Complete

- [ ] **Audit all prompts** — ensure every prompt section uses `config.labels.*`
      for product, order, customer, warehouse, invoice terminology
- [ ] **Dynamic label injection** — create a `injectLabels(promptTemplate: string): string`
      utility that replaces `{{PRODUCT_LABEL}}`, `{{ORDER_LABEL}}`, etc.
- [ ] **Test with multiple industries** — validate prompts with at least 3 different
      label configurations (retail, restaurant, manufacturing)

### 7.3 Routing Heuristic Optimization

**Status:** ✅ Complete

The orchestrator uses a hardcoded "ROUTING HEURISTIC" table in the system prompt to
decide which specialist to call. This should be more dynamic.

- [ ] **Config-driven routing** — store routing rules in `agent_configs` or settings
      so they can be tuned per-deployment
- [ ] **Routing examples** — add few-shot examples for each routing decision to
      improve accuracy
- [ ] **Routing analytics** — track which routes are taken and whether the user
      found the result useful (implicit feedback from follow-up messages)

### 7.4 Few-Shot Examples

**Status:** ✅ Complete

- [ ] **Example library** — build a collection of input→output examples for each
      agent and tool, stored in DB
- [ ] **Dynamic example selection** — use semantic similarity to select the most
      relevant examples for the current input (requires vector search on examples)
- [ ] **Example management UI** — admins can add, edit, and delete examples via
      the Admin Console

### 7.5 Guardrails & Safety

**Status:** ✅ Complete

- [ ] **SQL injection prevention** — the SQL safety check exists but should be
      more robust. Consider parameterized query enforcement in sandbox SQL execution.
- [ ] **Output validation** — validate LLM outputs against expected schemas before
      returning to the user
- [ ] **Token budget management** — track token usage per request and enforce
      configurable limits per agent
- [ ] **PII detection** — scan LLM outputs for personally identifiable information
      that shouldn't be exposed in chat responses
- [ ] **Hallucination detection** — compare LLM claims against actual DB data
      when possible (e.g., verify cited numbers match query results)

### 7.6 Evaluation Framework

**Status:** ✅ Complete
**SDK ref:** `.copilot/skills/agentuity-creating-agents.md` → `agent.createEval()`

The Agentuity SDK has a built-in evaluation system. No agents implement evals.

- [ ] **Define eval suites per agent**:
  - data-science: routing accuracy, tool selection quality, response relevance
  - insights-analyzer: insight accuracy, confidence calibration, actionability
  - report-generator: report completeness, formatting quality, factual accuracy
  - knowledge-base: retrieval relevance, answer groundedness, citation accuracy
- [ ] **Automated eval runs** — trigger evals on deploy or on schedule
- [ ] **Eval dashboard** — surface eval results in the Admin Console

---

## Dependency Graph

```
Phase 1 (Architecture) ─── foundation for everything
    │
    ├── Phase 2 (Frontend) ─── admin UI for configuring phases 3-7
    │
    ├── Phase 3 (DB Communication)
    │       │
    │       ├── Phase 5 (Agent Code) ─── depends on patterns from 1+3
    │       │       │
    │       │       └── Phase 7 (Prompt Engineering) ─── depends on agent structure
    │       │
    │       └── Phase 4 (Sandbox) ─── depends on DB patterns for data access
    │
    └── Phase 6 (Data Sources) ─── depends on architecture + DB patterns
```

**Recommended execution order:** 1 → 2+3 (parallel) → 4+5 (parallel) → 6 → 7

---

## Gap Summary

| Category | Gap | Impact | Phase | Status |
|----------|-----|--------|-------|--------|
| SDK Underuse | `ctx.kv` not used anywhere | Redundant DB queries, no caching | 3.2 | ✅ Resolved |
| SDK Underuse | `ctx.stream` (durable) not used | No persistent exports or downloads | 6.3 | ✅ Resolved |
| SDK Underuse | `setup()` hook not used | Config fetched per-request, wasted DB calls | 1.1 | ✅ Resolved |
| SDK Underuse | `ctx.waitUntil()` not used | Background tasks may be killed early | 1.6 | ✅ Resolved |
| SDK Underuse | `ctx.tracer` not used | No observability into agent internals | 1.7 | ✅ Resolved |
| SDK Underuse | `agent.createEval()` not used | No quality measurement | 7.6 | ✅ Resolved |
| SDK Underuse | `sandbox.snapshot()` not used | Slow sandbox cold starts | 4.2 | ✅ Resolved |
| SDK Underuse | `sse()` / `websocket()` middleware not used | Hand-rolled SSE is fragile | 1.4 | ✅ Resolved |
| Code Duplication | `DB_SCHEMA` in 3 agent files | Schema drift risk | 1.2 | ✅ Resolved |
| Code Duplication | SQL safety check in 3 agents | Inconsistent validation | 1.3 | ✅ Resolved |
| Hardcoding | Analysis types (4 enum values) | Can't add types without deploy | 3.4 | ✅ Resolved |
| Hardcoding | Report types (4 enum values) | Can't add types without deploy | 3.4 | ✅ Resolved |
| Hardcoding | Routing heuristic in prompt | Can't tune routing without deploy | 7.3 | ✅ Resolved |
| Missing Feature | No caching layer | Every request hits DB | 3.2 | ✅ Resolved |
| Missing Feature | No report persistence | Reports regenerated every time | 5.4 | ✅ Resolved |
| Missing Feature | No scheduled tasks | No automated report/alert generation | 5.6 | ✅ Resolved |
| Missing Feature | No Python sandbox runtime | Limited to JS for data science | 4.4 | ✅ Resolved |
| Missing Feature | No eval framework | No quality metrics | 7.6 | ✅ Resolved |
| Encoding | Agent docstrings have mojibake | Maintenance friction | 5.1 | ✅ Resolved |
| Architecture | `streamChat()` bypasses agent lifecycle | No `ctx` in streaming path | 1.5 | ✅ Resolved |

---

---

## Phase 8 — Report Export Surgery & Deployment Hardening

### 8.1 Report Export: Server-Side API (ReportsPage)

**Status:** ✅ Complete

The Reports page uses a basic client-side converter for PDF/XLSX (fake XML for xlsx,
browser print dialog for PDF). The server already has a full export pipeline using
jsPDF, ExcelJS, DOCX, PptxGenJS with company branding applied automatically.

- [x] `src/lib/report-export.ts` — Full server-side PDF/XLSX/DOCX/PPTX generation with branding
- [x] `POST /api/reports/export` — Server export API endpoint
- [x] `POST /api/reports/:id/export` — Export a saved report by ID
- [x] Fix `ReportsPage.handleDownload` — call `/api/reports/export` for pdf/xlsx/docx/pptx
      instead of client-side markdown → XML/print-dialog conversion
- [x] Add DOCX and PPTX to `FORMAT_OPTIONS` in ReportsPage (all 5 formats: PDF/XLSX/DOCX/PPTX/CSV)
- [x] Add PPTX download button to `ToolCallCard` `ReportResult` component (PDF/Excel/Word/PPTX)

### 8.2 Sandbox Infrastructure: Python Snapshot

**Status:** 🔄 In Progress (blocked by platform bug)

- [x] Sandbox created (`sbx_0d9bb09bd86dcc51b94d95d5dad61a307d1958a387ddfa02d47bc5737007`)
- [x] Dependencies installed via `uv venv && uv pip install numpy pandas scipy scikit-learn statsmodels`
- [x] Verified: `source .venv/bin/activate && python3 -c 'import numpy, pandas, scipy, sklearn, statsmodels' && echo All OK` → **All OK**
- [ ] **Blocked**: `agentuity cloud sandbox snapshot create` returns 500 Internal Server Error
      — escalated to Agentuity support. Once resolved, run snapshot + tag `biq-datascience-v1`
- [x] Safety guard added to `data-science` agent — ignores placeholder snapshot ID
- [x] Placeholder `sandboxSnapshotId: "snp_set_this_in_admin_console"` added to default agent config

### 8.3 Scheduler Overhaul (Completed)

**Status:** ✅ Complete

- [x] Master on/off switch (`schedulerEnabled` setting, defaults `false`)
- [x] `scheduler-cron.ts` — cron tick guarded by master switch (early return when disabled)
- [x] `eval-cron.ts` — removed hardcoded `cron("0 3 * * *")`, extracted `runAllEvals()` as export
- [x] Scheduler agent — added `eval` task type with handler calling `runAllEvals()`
- [x] Admin API — `GET /admin/scheduler/status` + `POST /admin/scheduler/toggle`
- [x] Admin UI sidebar — "Agents" section with Task Scheduler, Agent Configuration, Evaluations, Observability
- [x] SchedulerTab — Engine on/off toggle panel with live status indicator
- [x] `TASK_TYPE_LABELS` — `eval` entry added
- [x] InfoBox updated to state that nothing runs unless engine is enabled

### 8.4 Demo & Knowledge Base Test Document

**Status:** ✅ Complete

- [x] `demo/safari-biq-knowledge-base.txt` — Safari lodge SOPs for testing RAG pipeline
- [x] Test sequence: upload → ingest → query → assert answers grounded in document

---

## Changelog

| Date | Phase | Action |
|------|-------|--------|
| 2025-07-13 | — | Initial roadmap created from deep platform research |
| 2025-07-13 | 2.2 | Custom tools seed definitions (11 tools) + API endpoint added |
| 2025-07-13 | 5.2 | All 4 agents wired to `agent_configs` DB for runtime config |
| 2025-07-22 | 1.1-1.7 | Architecture foundations complete: barrel exports (7 agents), setup/shutdown (7 agents), shared DB_SCHEMA, SQL safety, event listeners, ctx.waitUntil, ctx.tracer |
| 2025-07-22 | 2.1-2.5 | Frontend enhancements complete: agent config admin UI, chat cancel/interrupt (AbortController), report history panel, dashboard AI widgets |
| 2025-07-22 | 3.1-3.4 | DB communication complete: dynamic DB schema, KV caching (src/lib/cache.ts), type-registry for custom analysis/report types |
| 2025-07-22 | 4.1-4.4 | Sandbox infrastructure complete: error classification, snapshots, interactive sessions, multi-runtime (bun/node/python) |
| 2025-07-22 | 5.1-5.6 | Agent code complete: docstrings clean (no mojibake), all 7 agents upgraded, scheduler agent created, data-import agent created |
| 2025-07-22 | 6.1-6.4 | Data sources complete: OAuth2 token refresh, rate limiting middleware, durable streams, S3 object storage for reports |
| 2025-07-22 | 7.1-7.6 | Prompt engineering complete: unified prompt builder (injectLabels, terminologySection, defaultGuardrails), config-driven routing, few-shot examples, SQL safety, PII detection, token budgets, output validation, hallucination detection eval |
| 2025-07-22 | 7.7 | Scalability: @agentuity/evals preset evals (safety, pii, politeness, conciseness, format, answerCompleteness) added to 4 agents with middleware transforms |
| 2025-07-22 | 7.7 | Scalability: Workbench test prompts (`welcome` exports) added to all 7 agents |
| 2025-07-22 | 7.7 | Scalability: Rate limiting wired into reports, scanning (3 endpoints), and webhooks routes |
| 2026-02-22 | 8.3 | Scheduler overhaul: master switch, hardcoded crons removed, eval task type, admin UI "Agents" section |
| 2026-02-22 | 8.2 | Python sandbox created with numpy/pandas/scipy/sklearn/statsmodels; snapshot blocked by platform 500 error (escalated) |
| 2026-02-22 | 8.4 | Demo knowledge base document created for RAG pipeline testing |
| 2026-02-22 | 8.1 | Report export surgery complete: ReportsPage calls server API (PDF/XLSX/DOCX/PPTX/CSV); ToolCallCard PPTX button added |
