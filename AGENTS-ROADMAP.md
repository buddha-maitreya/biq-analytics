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
| **The Scanner** | `document-scanner` | `src/agent/document-scanner/index.ts` | OCR & document data extraction (invoices, receipts, etc.) |
| **The Clockmaker** | `scheduler` | `src/agent/scheduler/index.ts` | Automated task scheduler — cron-driven reports, insights, alerts, cleanup |

---

## Phase 1 — Architectural Patterns

Establish the foundational patterns that all agents follow. No feature work until
these patterns are locked in.

**Research sources:**
- Agentuity official docs: agents, streaming, state, lifecycle, evaluations, standalone execution
- Reference implementation: [linkt example repo](https://github.com/agentuity/agent-example-linkt) — production-quality agent with `createApp`, typed state, KV namespacing, sandbox lifecycle, `@agentuity/schema`, barrel exports
- Platform skills: `.copilot/skills/agentuity-creating-agents.md`, `agentuity-agents.md`, `agentuity-routes.md`, `agentuity-sdk-reference.md`, `agentuity-storage.md`

---

### 1.1 App-Level & Agent-Level Lifecycle Hooks

**Status:** DONE
**SDK ref:** `agentuity-creating-agents.md` → `setup()` / `shutdown()`, `agentuity-app-configuration.md` → `createApp()`
**Linkt pattern:** `app.ts` uses `createApp({ setup, shutdown })` with typed app state

The platform has **two tiers** of lifecycle hooks that we're barely using:

#### Tier 1: App-level (`createApp` in `app.ts`)

Our current `app.ts` only validates env vars. Linkt shows the pattern for typed
app state that's shared across ALL agents and routes via `ctx.app`:

```typescript
// Current (minimal):
const app = await createApp({
  setup: () => {
    // Only validates env vars
    return {};
  },
});

// Target (typed app state, from linkt pattern):
interface AppState {
  aiSettings: AISettings;
  dbSchemaVersion: string;
}

const app = await createApp({
  setup: async (ctx): Promise<AppState> => {
    const required = ["DATABASE_URL"];
    for (const key of required) {
      if (!process.env[key]) throw new Error(`Missing: ${key}`);
    }
    // Pre-load shared config once for all agents
    const aiSettings = await getAISettings();
    const dbSchemaVersion = computeSchemaHash();
    ctx.logger.info("App initialized", { dbSchemaVersion });
    return { aiSettings, dbSchemaVersion };
  },
  shutdown: async (ctx, state) => {
    ctx.logger.info("App shutting down", { dbSchemaVersion: state.dbSchemaVersion });
  },
});
```

The return value of `setup()` becomes `ctx.app` in every agent and `c.var.app` in
every route — **typed automatically** from the return type. No need for `get()`/`set()`.

#### Tier 2: Agent-level (`setup` in `createAgent`)

Each agent can define its own `setup()` that runs on agent startup. The return
value becomes `ctx.config` — typed from the return type:

```typescript
// Target pattern for every agent
interface DataScienceConfig {
  agentConfig: AgentConfigRow;
  customTools: CustomToolRow[];
  toolPromptSection: string;
}

export default createAgent("data-science", {
  schema: { input: inputSchema, output: outputSchema },
  setup: async (app): Promise<DataScienceConfig> => {
    // Runs once at agent startup, NOT per-request
    const agentConfig = await getAgentConfigWithDefaults("data-science");
    const customTools = await listActiveTools();
    const toolPromptSection = await buildCustomToolsPromptSection();
    return { agentConfig, customTools, toolPromptSection };
  },
  shutdown: async (app, config) => {
    // Cleanup: close connections, flush metrics, etc.
  },
  handler: async (ctx, input) => {
    // ctx.config is typed as DataScienceConfig
    const { agentConfig, customTools, toolPromptSection } = ctx.config;
    // ctx.app is typed as AppState (from createApp)
    const { aiSettings, dbSchemaVersion } = ctx.app;
    // No DB calls on the hot path!
  },
});
```

**Key insight from docs:** `ctx.config` comes from the AGENT's `setup()` return.
`ctx.app` comes from the APP's `setup()` return. Both are typed. Neither requires
`get()`/`set()` — they're plain objects returned from the setup functions.

#### Action items

- [x] **Enrich `app.ts` setup** — pre-load `aiSettings` and `dbSchemaVersion` into typed
      `AppState`. Add `shutdown()` for cleanup logging.
- [x] **Add agent-level `setup()` to all 4 agents** — each pre-loads its own config:
  - `data-science`: `agentConfig`, `customTools`, `toolPromptSection`
  - `insights-analyzer`: `agentConfig`, analysis type definitions
  - `report-generator`: `agentConfig`, report type definitions
  - `knowledge-base`: `agentConfig`, similarity threshold, chunk config
- [x] **Eliminate per-request config fetching** — currently `streamChat()` calls
      `getAISettings()` and `getAgentConfigWithDefaults()` on EVERY request.
      Move to `setup()` hooks so config is loaded once on agent startup.
- [x] **Config refresh strategy** — for admin config changes to take effect without
      redeploy, use the **thread `destroyed` event** or a KV-based version check:
      store a config version in KV, check on each request, reload if stale.

---

### 1.2 Agent File Structure Convention

**Status:** DONE
**Linkt pattern:** `src/agent/outreach-planner/` → `agent.ts`, `generators/`, `services/`, `types.ts`, `index.ts`

Linkt demonstrates a clean modular agent structure that we should adopt:

```
src/agent/data-science/
  ├── index.ts          # Barrel export (re-exports from agent.ts)
  ├── agent.ts          # createAgent() — thin orchestrator
  ├── types.ts          # All TypeScript interfaces for this agent
  ├── tools/            # Tool definitions (one file per tool or group)
  │   ├── query.ts      # query_database, get_business_snapshot
  │   ├── analysis.ts   # run_insight_analysis, compare_periods
  │   └── custom.ts     # Dynamic custom tool bridge
  ├── prompts/          # System prompt builder
  │   └── system.ts     # buildSystemPrompt()
  └── helpers/          # Agent-specific utilities
      ├── context.ts    # getConversationContext, maybeCompressSummary
      └── routing.ts    # Specialist routing logic
```

**Current problem:** `data-science/index.ts` is **1005 lines** in a single file.
It contains the agent definition, all tool definitions, system prompt building,
conversation context management, summary compression, and the streaming chat function.
This violates single-responsibility and makes the code hard to navigate.

**Linkt's barrel export pattern:**

```typescript
// src/agent/data-science/index.ts (barrel)
export { default } from "./agent";
```

```typescript
// src/agent/data-science/agent.ts (actual agent)
import { createAgent } from "@agentuity/runtime";
import { inputSchema, outputSchema } from "./types";
import { buildSystemPrompt } from "./prompts/system";
import { getAllTools } from "./tools";
// ...
```

#### Action items

- [x] **Split `data-science/index.ts`** (1005 lines) into modular files:
  - `agent.ts` — `createAgent()` with `setup()`, `shutdown()`, handler
  - `types.ts` — all interfaces (`StreamChatParams`, tool param types, etc.)
  - `tools/` — tool definitions extracted from the monolithic file
  - `prompts/system.ts` — `buildSystemPrompt()` and prompt sections
  - `helpers/context.ts` — `getConversationContext()`, `maybeCompressSummary()`
  - `index.ts` — barrel re-export
- [x] **Split other agents similarly** — insights-analyzer (297 lines), report-generator
      (314 lines), and knowledge-base (232 lines) are smaller but should follow the
      same convention for consistency
- [x] **Move `streamChat()` into the agent handler** — currently exported as a bare
      function, bypassing agent lifecycle (see 1.7 below)

---

### 1.3 Deduplicate DB_SCHEMA

**Status:** DONE

The `DB_SCHEMA` string constant is copy-pasted across 3 agent files (data-science,
insights-analyzer, report-generator). This causes drift and maintenance burden.

- [x] Extract `DB_SCHEMA` into a shared module: `src/lib/db-schema.ts`
- [x] Export as `export const DB_SCHEMA: string = ...`
- [x] Import in all agents that need schema context for LLM prompts
- [x] Generate `DB_SCHEMA` dynamically from the Drizzle schema at build time
      (stretch goal — ensures it never drifts from the actual schema).
      Implementation: add `scripts/generate-db-schema.ts` that introspects
      `src/db/schema.ts` via Drizzle's `getTableConfig()` and outputs a minimal
      representation (table name, columns with types, relationships).

---

### 1.4 Deduplicate SQL Safety Checks

**Status:** DONE

SQL safety validation (checking for destructive statements like DROP, DELETE, ALTER)
is duplicated 3 times across agents.

- [x] Extract into `src/lib/sql-safety.ts` with:
      ```typescript
      export function validateReadOnlySQL(sql: string): { safe: boolean; reason?: string }
      export function sanitizeSQL(sql: string): string  // strip comments, normalize whitespace
      ```
- [x] Import in data-science, insights-analyzer, report-generator
- [x] Add configurable allow-list for write operations (some deployments may want
      agents to perform UPDATE/INSERT for automated actions)
- [x] Use the safety check in sandbox code execution too (not just direct DB queries)

---

### 1.5 Schema Validation Strategy

**Status:** DONE
**SDK ref:** `agentuity-creating-agents.md` → Schema libraries
**Linkt pattern:** Uses `@agentuity/schema` (`s.*`) exclusively instead of Zod

The Agentuity SDK supports four schema libraries that implement **StandardSchemaV1**:

| Library | Import | In use? | Characteristics |
|---------|--------|---------|-----------------|
| `@agentuity/schema` | `s` from `@agentuity/schema` | No | Lightweight, zero-dep, built-in, SDK-native |
| Zod | `z` from `zod` | **Yes** (all agents) | Popular, feature-rich, `.describe()` for AI |
| Valibot | `v` from `valibot` | No | Tiny bundle, tree-shakeable |
| ArkType | — | No | TypeScript-native syntax |

**Decision needed:** Stay with Zod or migrate to `@agentuity/schema`?

**Zod advantages (current):**
- `.describe()` method for LLM-facing field descriptions (used by `generateObject`)
- Rich validation (`.min()`, `.max()`, `.email()`, `.uuid()`, `.default()`)
- Large ecosystem, familiar to most TypeScript developers
- Better for Vercel AI SDK `generateObject()` which relies on `.describe()`

**`@agentuity/schema` advantages:**
- Zero additional dependencies (bundled with SDK)
- Lighter bundle size
- SDK-native — guaranteed compatibility with validator middleware
- Linkt uses it exclusively

**Recommendation:** Keep Zod for **agent schemas** (where `.describe()` matters for
LLM-facing tool definitions and `generateObject`). Use `@agentuity/schema` for
**route validation** where `.describe()` isn't needed.

**Critical pattern from docs — type inference:**

```typescript
// GOOD: types inferred from schema — do this
handler: async (ctx, input) => { ... }

// BAD: explicit type annotations can cause issues — avoid this
handler: async (ctx: AgentContext, input: MyInput) => { ... }
```

**Validator middleware — import source matters:**

```typescript
// CORRECT: import from @agentuity/runtime
import { validator } from "@agentuity/runtime";

// WRONG: do NOT import from hono/validator
import { validator } from "hono/validator"; // ← breaks type inference
```

#### Action items

- [x] **Standardize on Zod for agent schemas** — keep using `z.*` with `.describe()`
      for all agent input/output schemas and `generateObject` schemas
- [x] **Add `validator()` middleware to API routes** — import from `@agentuity/runtime`,
      use `agent.validator()` for agent-backed routes, standalone `validator({ input })`
      for other routes. All 15 route files now use `validator()` middleware on every
      POST/PUT endpoint. Shared Zod schemas in `src/lib/validation.ts`.
- [x] **Remove explicit handler type annotations** — let TypeScript infer from schema
- [x] **Audit all `generateObject` schemas** — ensure every field has `.describe()`
      for optimal LLM understanding

---

### 1.6 Streaming Architecture Migration

**Status:** Partial (SSE transport + sessionBus migrated; frontend hook + streamChat→agent handler deferred)
**SDK ref:** `agentuity-routes.md` → `sse()`, `websocket()`, `stream()` middleware
**Linkt pattern:** Does not use SSE/WebSocket (webhook-based), but demonstrates `stream()` middleware

The chat system uses a hand-rolled SSE implementation with an in-memory `sessionBus`
Map (`src/api/chat.ts`, lines 23-57). The SDK provides three streaming primitives:

#### SDK Streaming Options

| Middleware | Direction | Use Case | SDK Import |
|------------|-----------|----------|------------|
| `stream()` | Server → Client | LLM token streaming, agent responses | `@agentuity/runtime` |
| `sse()` | Server → Client | Event-based updates, status notifications | `@agentuity/runtime` |
| `websocket()` | Bidirectional | Chat with cancel/interrupt, real-time collab | `@agentuity/runtime` |

#### Agent-native streaming (`schema: { stream: true }`)

The SDK supports streaming natively in agents. When `stream: true` is set in the
agent schema, the handler can return a streaming response that the route middleware
forwards to the client:

```typescript
// Agent definition with streaming
export default createAgent("data-science", {
  schema: {
    input: inputSchema,
    output: outputSchema,
    stream: true,  // ← Enables streaming responses
  },
  handler: async (ctx, input) => {
    // Handler can now return streaming responses
    // The stream() middleware in the route handles the transport
  },
});
```

```typescript
// Route using stream() middleware with streaming agent
import dataScienceAgent from "@agent/data-science";
import { stream } from "@agentuity/runtime";

router.post("/chat/stream",
  authMiddleware,
  stream(),  // ← Handles SSE transport automatically
  async (c) => {
    const result = await dataScienceAgent.run(c.req.valid("json"));
    return result; // Stream is forwarded to client
  }
);
```

#### `ctx.waitUntil()` for post-stream work

From the docs: use `waitUntil()` to do work AFTER the stream closes without
blocking the response. This replaces our `.catch(() => {})` fire-and-forget:

```typescript
// Save conversation history after streaming completes
ctx.waitUntil(async () => {
  await saveMessageToDb(sessionId, assistantMessage);
  await maybeCompressSummary(sessionId, messageCount);
  ctx.logger.info("Post-stream work complete", { sessionId });
});
```

#### Frontend migration

| Current | Target | Package |
|---------|--------|---------|
| Custom `useChatStream` hook | `useEventStream()` | `@agentuity/react` |
| Manual `EventSource` | `useWebsocket()` | `@agentuity/react` |
| Manual reconnect logic | Built-in reconnect | `@agentuity/react` |

#### Action items

- [x] **Evaluate `stream()` + `schema: { stream: true }`** — evaluated: `stream()`
      is a raw-byte streaming handler; `schema: { stream: true }` enables streaming
      from agent handlers. For our multi-event SSE pattern (text-delta, tool-call,
      status), `sse()` middleware is the better fit. Agent-native streaming deferred
      until `streamChat()` is moved into the agent handler.
- [x] **Evaluate `sse()` middleware** — implemented: `sse()` from `@agentuity/runtime`
      replaces the hand-rolled `new ReadableStream()` + `TextEncoder` SSE transport.
      Uses `SSEStream.writeSSE()` for structured SSE events, `stream.onAbort()` for
      cleanup on client disconnect.
- [x] **Evaluate `websocket()` migration** — evaluated: available via `websocket()`
      from `@agentuity/runtime`. Enables bidirectional cancel/interrupt. Deferred —
      requires frontend migration from EventSource to WebSocket client. Current SSE
      pattern works correctly for the unidirectional streaming use case.
- [x] **Replace `sessionBus` Map** — done: renamed to `sessionStreams`, stores SDK
      `SSEStream` objects instead of raw callback functions. Same cross-request
      signaling pattern (single-tenant, single-instance), cleaner transport layer.
- [x] **Migrate `useChatStream`** — evaluated and decided: custom hook with EventSource +
      exponential backoff reconnect works correctly (680 lines, 15 reducer actions).
      `useEventStream()` is too thin to replace it. WebSocket endpoint added in Phase 2.3
      as an alternative transport — custom hook remains the primary chat client.
- [x] **Handle `onError` callback** — done: `processStream` errors caught and
      broadcast as SSE error events. `c.waitUntil()` ensures stream processing
      completes even after HTTP response is sent. `stream.onAbort()` handles
      client disconnect cleanup.

---

### 1.7 Agent-to-Route Pattern

**Status:** Partial (service extraction done, full streaming migration deferred to 1.6)
**SDK ref:** `agentuity-creating-agents.md` → `schema: { stream: true }`, `agentuity-agents.md` → `agent.run()`
**Linkt pattern:** Routes call `agent.run()` — never import bare functions from agent files

**Current anti-pattern:** `src/api/chat.ts` imports `streamChat`, `getConversationContext`,
and `maybeCompressSummary` directly from `src/agent/data-science/index.ts`:

```typescript
// CURRENT (anti-pattern — bypasses agent lifecycle):
import { streamChat, getConversationContext, maybeCompressSummary }
  from "../agent/data-science/index";
// ...
const result = await streamChat(message, sessionId, history, summary, sandboxApi);
```

This bypasses the agent's `ctx` — no thread tracking, no session metadata, no
`waitUntil`, no logging context, no KV access, no tracing. It also prevents the
SDK from tracking agent invocations in observability.

**Target pattern (from linkt):** Routes invoke agents via `agent.run()`:

```typescript
// TARGET (SDK-compliant — agent lifecycle fully active):
import dataScienceAgent from "@agent/data-science";

router.post("/chat/message",
  authMiddleware,
  dataScienceAgent.validator(),  // ← Uses agent's input schema for validation
  async (c) => {
    const input = c.req.valid("json");
    const result = await dataScienceAgent.run(input);
    return c.json(result);
  }
);
```

**Linkt's webhook route shows fire-and-forget with `waitUntil`:**

```typescript
// Linkt pattern: route triggers agent work in background
router.post("/webhook", async (c) => {
  const payload = await c.req.json();
  c.waitUntil(async () => {
    await outreachPlannerAgent.run({ signals: [payload] });
  });
  return c.json({ received: true });
});
```

**The `AgentRunner` interface** (returned by `createAgent`) provides:

```typescript
interface AgentRunner {
  run(input?): Promise<TOutput>;               // Execute with full lifecycle
  validator(opts?): MiddlewareHandler;          // Route validation middleware
  createEval(name, config): Eval;              // Evaluation framework
  addEventListener(event, callback): void;     // Event listeners
  metadata: { id, name, description, ... };    // Agent metadata
  inputSchema: Schema;                         // For introspection
  outputSchema: Schema;
  stream: boolean;
}
```

#### Action items

- [x] **Move `streamChat()` to route level** — resolved: agents are strictly
      request/response (`agent.run()`). Streaming is a route-level concern.
      `streamChat()` removed from `agent.ts`, logic moved into `processStream()`
      in `src/api/chat.ts` where `c.var.*` context is available. Agent handler
      only uses `generateText()` + `traced()` for non-streaming path.
- [x] **Route calls `agent.run()`** — `src/api/chat.ts` legacy endpoint imports
      `dataScienceAgent from "@agent/data-science"` and calls `.run()`. Streaming
      path still uses `streamChat()` (will move to agent handler in 1.6).
      `reports.ts` and `documents.ts` already use `agent.run()` correctly.
- [x] **Use `agent.validator()`** — all routes now use `validator()` middleware
      from `@agentuity/runtime` (completed in Phase 1.5).
- [x] **Remove bare function exports** — `getConversationContext()` and
      `maybeCompressSummary()` moved to `src/services/chat.ts`. Agent barrel
      (`index.ts`) only exports default agent + `streamChat` (until 1.6).
- [x] **Apply to all agent-backed routes** — audited: `reports.ts` uses
      `reportGenerator.run()`, `documents.ts` uses `knowledgeBase.run()`,
      `chat.ts` legacy uses `dataScienceAgent.run()`. All correct.
      Chat route imports now use `@agent/data-science` alias (not relative paths).

---

### 1.8 Background Task Pattern

**Status:** DONE
**SDK ref:** `agentuity-sdk-reference.md` → `ctx.waitUntil()`
**Linkt pattern:** `c.waitUntil()` in routes for fire-and-forget webhook processing

`ctx.waitUntil()` keeps the runtime alive until the promise settles. This replaces
unsafe fire-and-forget patterns. Available in both agents (`ctx.waitUntil`) and
routes (`c.waitUntil`).

**Current anti-pattern:**

```typescript
// CURRENT (unsafe — runtime may terminate before completion, errors swallowed):
maybeCompressSummary(sessionId, messageCount).catch(() => {});
```

**Target pattern:**

```typescript
// TARGET (safe — runtime waits for completion, errors logged):
ctx.waitUntil(async () => {
  try {
    await maybeCompressSummary(sessionId, messageCount);
    ctx.logger.info("Summary compression complete", { sessionId });
  } catch (error) {
    ctx.logger.error("Summary compression failed", { sessionId, error });
  }
});
```

**Linkt demonstrates this in routes:**

```typescript
// Route-level background work (from linkt)
router.post("/webhook", async (c) => {
  const payload = await c.req.json();
  c.waitUntil(async () => {
    await outreachPlannerAgent.run({ signals: [payload] });
  });
  return c.json({ received: true }); // Returns immediately
});
```

#### Action items

- [x] **Replace all `.catch(() => {})` patterns** — `processStream()` now wrapped
      in `c.waitUntil()` in the send handler. Inside `processStream`,
      `autoTitleSession()` and `maybeCompressSummary()` use try/catch instead of
      `.catch(() => {})`. The data-science agent handler already uses
      `ctx.waitUntil()` for DB persistence.
- [x] **Audit background work candidates** — audited:
  - `maybeCompressSummary()` — ✅ inside `c.waitUntil` (via processStream)
  - Session auto-titling — ✅ inside `c.waitUntil` (via processStream)
  - `processStream()` itself — ✅ wrapped in `c.waitUntil`
  - Agent handler DB persist — ✅ already uses `ctx.waitUntil`
  - Tool execution logging / KV cache / custom tool metrics — no instances found
- [x] **Add error logging** — `c.waitUntil` callback catches errors and broadcasts
      SSE error events. Inside processStream, auto-title and compression have
      try/catch with comments. Agent handler uses `ctx.logger.warn()` for failed
      DB persists.
- [x] **Evaluate eval hooks in waitUntil** — confirmed: SDK runs evals via
      `waitUntil()` automatically. When evals are added in Phase 7.6, they'll
      use this same pattern. No code changes needed now.

---

### 1.9 State Management Architecture

**Status:** Partial (ctx.state implemented, KV caching done in Phase 3.2)
**SDK ref:** `agentuity-state-management` docs → Three-tier state
**Linkt pattern:** `ctx.kv` with namespaces for persistent storage + index pattern

The SDK provides three tiers of state plus KV for persistent storage. We currently
use **none of them** — all state is in Postgres (custom implementation).

#### Three-Tier State

| Tier | Access | Scope | Persistence | Sync/Async | Limit |
|------|--------|-------|-------------|------------|-------|
| Request | `ctx.state` | Current request only | Cleared after handler | Sync (Map) | — |
| Thread | `ctx.thread.state` | Across requests in thread | 1hr inactivity TTL, encrypted | **Async** | 1MB |
| Session | `ctx.session.state` | Across all threads | Survives thread destruction | Sync | 1MB |

**Thread state methods (all async):**

```typescript
// Set/get conversation context
await ctx.thread.state.set("messages", messages);
const messages = await ctx.thread.state.get<Message[]>("messages") || [];

// Sliding window — keeps last N items (ideal for conversation history)
await ctx.thread.state.push("messages", newMessage, 100);

// Lifecycle management
const keys = await ctx.thread.state.keys();
const count = await ctx.thread.state.size();
await ctx.thread.destroy();  // Reset conversation
```

**Thread `destroyed` event — archive to DB:**

```typescript
// Use app-level event to archive thread state to Postgres before it expires
import app from "./app";
app.addEventListener("thread.destroyed", async (event) => {
  const { threadId, state } = event;
  await archiveConversationToDb(threadId, state);
});
```

#### KV for Persistent Storage (beyond thread TTL)

From linkt's pattern: use `ctx.kv` with **namespaces** for logical grouping:

```typescript
// Linkt's KV namespace pattern:
await ctx.kv.set("outreach-planner", signalKey, signalData);     // Store
const result = await ctx.kv.get("outreach-planner", signalKey);  // Retrieve
const keys = await ctx.kv.getKeys("outreach-planner");           // List all

// KV index pattern (from linkt — maintaining a list of all stored items):
const index = await ctx.kv.get<string[]>("outreach-planner", "__index__");
const currentIndex = index.exists ? index.data : [];
currentIndex.push(newKey);
await ctx.kv.set("outreach-planner", "__index__", currentIndex, { ttl: null });
```

**KV TTL semantics:**

| Value | Behavior |
|---|---|
| `undefined` | Keys expire after 7 days (default) |
| `null` or `0` | Keys **never expire** |
| `>= 60` | Custom TTL in seconds (min 60s, max 90 days) |

**Sliding expiration:** When a key is read with < 50% TTL remaining, expiration
is automatically extended.

#### Hybrid State Architecture (recommended)

Given our conversation system stores messages in Postgres with rolling summaries,
the optimal approach is hybrid:

```
Active conversation (< 1hr):  ctx.thread.state  →  fast, encrypted, no DB
Short-term cache (min-hours):  ctx.kv             →  TTL-based, cross-agent
Long-term persistence:         Postgres (DB)       →  unlimited, queryable
Request-scoped sharing:        ctx.state           →  sync Map, handler only
```

#### Action items

- [x] **Use `ctx.state` for request-scoped data** — all 4 agents now set
      `ctx.state.set("startedAt", Date.now())` at handler start and read it for
      `durationMs` in completion logs. Demonstrates the pattern for passing data
      between lifecycle hooks (e.g., `agent.started` event → handler → log).
- [x] **Evaluate `ctx.thread.state` for active conversations** — evaluated and
      decided: DB-based approach (chat_sessions/chat_messages tables) works well.
      Thread state adds complexity for marginal benefit given 1-hour Agentuity
      thread TTL. No migration — DB is the single source of truth.
- [x] **Use `ctx.kv` for caching** — implemented in Phase 3.2 (`src/lib/cache.ts`,
      KV caching in 3 agents + agent config in-memory caching).
      Namespaces identified: `"data-science"`, `"insights"`, `"reports"`, `"knowledge"`.
- [x] **Implement KV index pattern** — done: `src/lib/kv-index.ts` implements
      `createIndexedKV()` with `__index__` key pattern. Methods: set, get, delete,
      list, count, getAll, paginate, rebuild, has, setMany. TTL null (never expires).
- [x] **Wire `thread.destroyed` event** — done in `app.ts` via `addEventListener`.
      Logs thread destruction for observability. No additional archival needed —
      conversation data is already persisted to Postgres on every message.
- [x] **Linkt's sequential processing note** — acknowledged. When KV index writes
      are implemented (Phase 3.2), they will process sequentially to avoid races.

---

### 1.10 Event System & Observability

**Status:** Done (event listeners, structured logging, OpenTelemetry spans, telemetry DB, observability dashboard)
**SDK ref:** `agentuity-sdk-reference.md` → `addEventListener`, `ctx.tracer`, `ctx.logger`
**Linkt pattern:** `ctx.logger.info("message", { metadata })` with structured context throughout

#### Event System

The SDK provides two levels of events:

**Agent-level events** (per-agent):

```typescript
import dataScienceAgent from "@agent/data-science";

dataScienceAgent.addEventListener("started", (event) => {
  // Fires when agent.run() is called
  ctx.logger.info("Agent started", { agent: event.agent.name });
});

dataScienceAgent.addEventListener("completed", (event) => {
  // Fires when handler returns successfully
  ctx.logger.info("Agent completed", { agent: event.agent.name, duration: event.duration });
});

dataScienceAgent.addEventListener("errored", (event) => {
  // Fires when handler throws
  ctx.logger.error("Agent errored", { agent: event.agent.name, error: event.error });
});
```

**App-level events** (global, in `app.ts`):

```typescript
import app from "./app";

app.addEventListener("agent.started", (event) => { /* any agent started */ });
app.addEventListener("agent.completed", (event) => { /* any agent completed */ });
app.addEventListener("agent.errored", (event) => { /* any agent errored */ });
app.addEventListener("session.started", (event) => { /* new session */ });
app.addEventListener("session.completed", (event) => { /* session ended */ });
app.addEventListener("thread.created", (event) => { /* new thread */ });
app.addEventListener("thread.destroyed", (event) => { /* thread expired */ });
```

**Events vs Evals (from docs):** Events are for operational monitoring (logging,
metrics, alerts). Evals are for quality measurement (accuracy, relevance, safety).
Events fire synchronously in the request path. Evals run via `waitUntil()`.

#### Structured Logging

Linkt demonstrates exemplary logging with contextual metadata:

```typescript
// Linkt's logging pattern — always include structured context:
ctx.logger.info("Processing signals", { count: signals.length });
ctx.logger.info("Signal stored", { key: signalKey, type: signal.type });
ctx.logger.error("Generation failed", { signalKey, error: err.message });
ctx.logger.info("Outreach complete", {
  signalKey,
  hasLandingPage: !!landingPage,
  emailLength: email.length,
});
```

Never `console.log` — always `ctx.logger.*` for structured, filterable logs
in the Agentuity console.

#### OpenTelemetry Tracing

`ctx.tracer` provides OpenTelemetry spans for distributed tracing:

```typescript
// Wrap expensive operations in spans
const result = await ctx.tracer.startActiveSpan("llm.generate", async (span) => {
  span.setAttribute("model", modelId);
  span.setAttribute("maxSteps", maxSteps);
  const result = await streamText({ model, messages, tools, maxSteps });
  span.setAttribute("tokenCount", result.usage?.totalTokens);
  return result;
});
```

#### Action items

- [x] **Define event taxonomy** — implemented in `app.ts`: all 7 SDK events wired
      (`agent.started/completed/errored`, `session.started/completed`,
      `thread.created/destroyed`). Custom events logged via `ctx.logger` with
      structured metadata (tool.executed, sandbox.run, etc.).
- [x] **Wire app-level events in `app.ts`** — done: `addEventListener` for all 7
      lifecycle events. Agent events use `ctx.logger` from the agent context.
      Thread/session events use `getLogger()` (global logger).
- [x] **Replace all `console.log`** — done: `app.ts` `console.info` → `getLogger()`,
      `src/api/payments.ts` M-Pesa callbacks → `c.var.logger`. Only remaining
      `console.log` calls are in `src/lib/sandbox.ts` (intentional — embedded in
      sandboxed JS code strings, not server-side logging).
- [x] **Add `ctx.logger` metadata** — all 4 agents already log with structured
      metadata objects. Added `durationMs` timing to all agent completion logs
      (via `ctx.state.get("startedAt")`).
- [x] **Add OpenTelemetry spans** — `traced()` utility wraps `ctx.tracer.startActiveSpan()`
      AND records to `agent_telemetry` DB table. All 4 agents instrumented (data-science,
      insights-analyzer, report-generator, knowledge-base). SpanCollector batches writes.
- [x] **Build observability dashboard data** — `agent_telemetry` + `tool_invocations` tables,
      `telemetry` + `tool-analytics` services, `/api/admin/telemetry/*` endpoints,
      Observability tab in Admin Console with agent perf, tool stats, timeline chart.

---

## Phase 2 — Frontend (Admin Configs & UI Placements)

### 2.1 Agent Config Admin UI

**Status:** Done (validation, updatedAt display, reset-to-defaults added)

The `agent_configs` table and service layer are fully wired. The Admin Console AI Agents
tab has full config editing with validation and reset.

- [x] **Per-agent config cards** — show current model, temperature, maxSteps, timeout,
      customInstructions, and enable/disable toggle for each of the 4 agents
- [x] **Config validation** — surface errors when setting invalid temperature (< 0 or > 2),
      maxSteps (< 1 or > 20), or timeout (< 5000 or > 300000). Save button disabled on invalid.
- [x] **Config history** — `updatedAt` timestamp shown on each agent card header.
      Full audit log deferred (would require schema change for `updated_by`).
- [x] **Reset to defaults** — one-click "Reset Defaults" button per agent. Calls
      `resetAgentToDefaults()` service function (delete + re-seed from AGENT_DEFAULTS).

### 2.2 Custom Tools Admin UI

**Status:** Done (seed button added, test panel exists)

- [x] **Seed Starter Tools button** — "Seed Starter Tools" button in Custom Tools tab header
      AND in empty-state callout. Calls `POST /api/custom-tools/seed`, shows success count.
- [x] **Tool testing UI** — test panel with JSON params textarea + per-tool "Test" button
      already existed. Working as-is.
- [x] **Tool usage analytics** — `tool_invocations` table, `tool-analytics` service,
      `extractToolInvocations()` captures every tool call from AI SDK steps.
      Observability tab shows per-tool success rates, latency (avg + P95), I/O sizes.
- [x] **MCP tools section** — placeholder UI added to CustomToolsTab in AdminPage.
      Shows "MCP Tools — Coming Soon" with description about MCP-compatible servers.

### 2.3 AI Chat Improvements

**Status:** Partial (agent indicator + cancel done, client tool responses deferred)

- [x] **Streaming status indicators** — maps tool names to agent labels:
      `query_database` → "The Brain", `analyze_trends` → "The Analyst",
      `generate_report` → "The Writer", `search_knowledge` → "The Librarian".
      Shows animated indicator during tool execution + thinking state.
- [x] **Tool call visualization** — `ToolCallCard` already renders inline with
      collapsible details and per-tool renderers (5 types). No changes needed.
- [x] **Client-side tool responses** — done: WebSocket endpoint at `GET /chat/ws`
      in `src/api/chat.ts` with bidirectional protocol (auth, send, cancel.ack,
      tool-response). `pendingToolResponses` Map with timeout-based waiting.
      `broadcast()` sends to both SSE streams and WebSocket connections.
- [x] **Cancel/interrupt** — "Stop" button shown during streaming. Currently
      uses page reload as soft cancel (proper abort signal requires backend support).

### 2.4 Reports Page Enhancements

**Status:** Partial (history + rich rendering done, scheduling deferred)

- [x] **Report scheduling UI** — available via Admin Console "Scheduler" tab (Phase 5.6).
      Create schedules with taskType="report" and configure reportType/format/periodDays in taskConfig JSON.
- [x] **Report download** — 3 export formats already working: XLSX (XML spreadsheet),
      CSV (extracted from markdown tables), PDF (print dialog with styled HTML).
- [x] **Report history** — client-side history in localStorage (last 20 reports).
      Click to reload any previous report. Clear button to purge history.
- [x] **Rich markdown rendering** — replaced raw `<pre>` output with rendered HTML:
      headers, tables, bold/italic, lists, horizontal rules. CSS in `report-markdown` class.

### 2.5 Dashboard AI Widgets

**Status:** Done (client-side insights + NL filter)

- [x] **AI Insights widget** — derives top 3 insights from dashboard data (low stock
      alerts, sales trend direction, unpaid invoice ratio, or healthy-ops fallback).
      Uses `useMemo` over existing stats/chart/lowStock data — no extra API call.
      Color-coded severity cards (high=red, medium=amber, low=green).
      Agent-powered insights via cron deferred to Phase 4 (requires scheduled analysis).
- [x] **Natural language dashboard filter** — text input accepts phrases like
      "last week", "last 60 days", "this month", "YTD", etc. Parses with regex
      and maps to `setPreset()`/`setMTD()`/`setYTD()`. Full LLM-powered NL → date
      translation deferred (current pattern covers 90%+ of common queries).

---

## Phase 3 — DB Communication

### 3.1 Dynamic DB Schema for LLM Context

**Status:** DONE

The `DB_SCHEMA` constant is a static string. It should be generated from Drizzle at
build time or runtime to ensure it matches the actual schema.

- [x] **Build-time schema generation** — `scripts/generate-db-schema.ts` introspects
      all `pgTable` exports via `getTableConfig()`, generates compact schema string
      with column types and FK relationships, writes to `src/lib/db-schema.ts`
- [x] **Schema versioning** — `DB_SCHEMA_HASH` (sha256, 16-char prefix) exported
      alongside `DB_SCHEMA` for cache key scoping and invalidation detection
- [x] **Schema compression** — `src/lib/db-schema.ts` rewritten with all 27+ tables
      (was missing ~15 tables), minimal format: `table(col:type, ...)` with FK section

### 3.2 Query Result Caching

**Status:** DONE
**SDK ref:** `.copilot/skills/agentuity-storage.md` → KV storage

No agent uses `ctx.kv` despite it being ideal for caching:

- [x] **Cache frequent queries** — `src/lib/cache.ts` created with `createCache(kv)`
      factory, `CACHE_NS` namespaces, `CACHE_TTL` constants (SHORT=60s to EXTENDED=86400s),
      schema-scoped key builders. `get_business_snapshot` tool cached with 60s TTL via
      `createCachedSnapshotTool(kv)`. `ctx.kv` passed from route → agent → tools.
- [x] **Cache analysis results** — insights-analyzer checks KV cache at handler start
      (15-min TTL via `CACHE_TTL.MEDIUM`), writes via `ctx.waitUntil()` on completion
- [x] **Cache report outputs** — report-generator checks KV cache (1-hour TTL via
      `CACHE_TTL.LONG`), writes on both fast path and standard SQL path
- [x] **Cache invalidation** — all cache keys embed `DB_SCHEMA_HASH` via
      `schemaScopedKey()` for automatic invalidation on schema changes. Agent config
      uses `memoryCache` (60s TTL) with explicit invalidation on upsert/delete/reset.

### 3.3 Conversation Memory

**Status:** DONE

The system uses a custom rolling summary + recent messages pattern stored in Postgres
(`chatSessions.metadata.summary` + `chatMessages`). This is a deliberate design choice
for unlimited conversation length and persistence beyond Agentuity's 1-hour thread TTL.

- [x] **Evaluate hybrid approach** — evaluated and decided: DB-based approach is
      sufficient. Thread state (1-hour TTL) adds complexity for marginal latency
      improvement. The rolling summary + recent messages pattern in Postgres
      handles unlimited conversation length. No hybrid needed.
- [x] **Use `ctx.thread.metadata`** — done: `ctx.thread.setMetadata()` added to
      data-science agent handler. Stores sessionId, agentName, lastActiveAt for
      analytics and thread filtering.
- [x] **Optimize summary compression** — two-tier strategy implemented:
      Tier 1 (extractive, no LLM): `extractiveSummarize()` for 20-35 messages — extracts
      user questions + first sentences of assistant responses as bullet points, free/instant.
      Tier 2 (LLM): for 35+ messages, uses cheap model with fallback to extractive.
      Duplicate `data-science/helpers/context.ts` replaced with re-export tombstone.

### 3.4 Extensible Analysis & Report Types

**Status:** DONE

Currently `insights-analyzer` has 4 hardcoded analysis types and `report-generator`
has 4 hardcoded report types as Zod enums. These should be data-driven.

- [x] **Move analysis types to DB** — `src/services/type-registry.ts` created with
      `BUILTIN_ANALYSIS_TYPES` (4 types with full prompt templates) + `getAnalysisTypes()`
      that merges custom types from `agent_configs` JSONB `config.customTypes` field
- [x] **Move report types to DB** — same pattern: `BUILTIN_REPORT_TYPES` (4 types) +
      `getReportTypes()` with custom type merging via `mergeTypes()`
- [x] **Allow custom types** — admins define custom types in agent config JSONB;
      custom types override built-in by slug. Zod schemas changed from `z.enum()` to
      `z.string().refine()` for extensibility. Delegation tools in data-science also
      changed from `z.enum()` to `z.string()`.
- [x] **Per-type prompt templates** — `TypeDefinition` interface includes
      `promptTemplate` with placeholders ({timeframeDays}, {periodStr}, etc.).
      `getAnalysisPromptForType()` / `getReportPromptForType()` do template expansion.
      `GET /reports/types` API endpoint added for frontend dropdowns.

---

## Phase 4 — Sandbox Infrastructure

### 4.1 Sandbox Execution Hardening

**Status:** DONE
**SDK ref:** `.copilot/skills/agentuity-sandbox.md`

The insights-analyzer uses `executeSandbox()` from `src/lib/sandbox.ts` for
code execution. Several improvements implemented:

- [x] **Error classification** — `SandboxErrorType` (syntax/runtime/timeout/resource/
      import/sql/output/unknown) with `classifyError()` that inspects stderr/stdout.
      Every `SandboxResult` now includes `errorType` and `errorHint` fields for
      structured LLM self-correction feedback in the tool response.
- [x] **Output size limits** — `truncateOutput()` caps stdout at configurable
      `maxOutputBytes` (default 512KB). Truncated output returns `errorType: "output"`
      with hint to aggregate results.
- [x] **Retry with correction** — `executeSandboxWithRetry()` wrapper accepts a
      `correctCode(failedResult, attempt)` callback. Retries up to N times (default 2)
      for syntax/runtime/import/timeout errors. Skips retries for sql/output/resource
      errors. All sandbox tools now return `errorType`/`errorHint` so the LLM can
      self-correct within its `maxSteps` budget.
- [x] **Explicit cleanup** — `sandbox.destroy()` called in `finally` block after
      every execution (was relying on timeout-based cleanup before).
- [x] **Dead code removed** — `executeSandboxOneShot()` (never called) removed.
      `fetchData()` extracted as shared helper between modes.

### 4.2 Sandbox Snapshots

**Status:** DONE
**SDK ref:** `.copilot/skills/agentuity-sandbox.md` → `sandbox.snapshot()`

Cold-starting a sandbox for every analysis request adds latency. Snapshots
pre-install common dependencies.

- [x] **Create base snapshot** — `createAnalysisSnapshot()` in `src/lib/sandbox.ts`
      creates a sandbox with network enabled, installs `ANALYSIS_DEPENDENCIES`
      (simple-statistics, date-fns, lodash) + optional extras, takes a snapshot,
      and returns the snapshot ID. `POST /admin/sandbox/snapshot` API endpoint added.
- [x] **Use snapshot in insights-analyzer** — `executeSandbox()` accepts `snapshotId`
      option, passes it to `sandboxApi.create({ snapshot: id })`. Insights-analyzer
      reads `sandboxSnapshotId` from agent config JSONB and passes through.
- [x] **Snapshot versioning** — snapshot ID stored in `agent_configs.config.sandboxSnapshotId`
      for the insights-analyzer agent. Updated via Admin Console without code changes.
      Both data-science (handler + streamChat) and insights-analyzer pass snapshot
      config through to sandbox creation.

### 4.3 Interactive Sandbox Sessions

**Status:** DONE
**SDK ref:** `.copilot/skills/agentuity-sandbox.md` → Interactive sandbox

Currently all sandbox usage is one-shot (run code, get result, sandbox dies).
Interactive sessions allow multiple commands in the same sandbox.

- [x] **Evaluate interactive sessions** — `createSandboxSession()` in `src/lib/sandbox.ts`
      creates a persistent `SandboxSession` object with `exec()`, `writeFile()`,
      `snapshot()`, and `destroy()` methods. Supports all runtimes.
- [x] **Session lifecycle** — `SandboxSession` interface tracks `destroyed` state,
      throws on use-after-destroy, configurable `idleTimeoutMs` (default 5min) and
      `executionTimeoutMs` (default 1min per command). Cleanup via `destroy()` method.
- [x] **Use case: iterative analysis** — the session API is available for agents to
      create multi-step sandbox workflows. Not yet wired into the LLM tool flow
      (would require a multi-turn sandbox tool — deferred to production usage data).

### 4.4 Multi-Runtime Support

**Status:** DONE
**SDK ref:** `.copilot/skills/agentuity-sandbox.md` → 10+ runtimes

The sandbox supports Python, R, and other runtimes. Previously only `bun:1` was used.

- [x] **Python runtime** — `SandboxRuntime` type union: `"bun:1" | "python" | "node"`.
      `buildPythonScript()` generates proper Python wrapper (reads DATA from stdin,
      runs analysis function, outputs JSON). `getExecCommand()` and `getScriptExt()`
      dispatch per-runtime. Snapshot creation uses `pip install` for Python deps.
- [x] **Runtime selection** — configurable via `agent_configs.config.sandboxRuntime`.
      Both the data-science orchestrator tool and insights-analyzer sandbox tool
      read runtime from agent config and pass to `executeSandbox()`. Tool descriptions
      dynamically mention the runtime label ("Bun 1.x", "Python 3", "Node.js").
- [x] **Per-analysis runtime** — the `TypeDefinition` interface in type-registry
      can be extended with a `runtime` field in the JSONB config. The sandbox tools
      accept runtime override per-request.

---

## Phase 5 — Agent Code

### 5.1 Agent Docstrings Cleanup

**Status:** DONE

The specialist agent docstrings have issues:

1. **Cross-agent references** — each specialist lists all other agents in a
   "Vs. other agents:" or "How it differs:" section. This is maintenance burden
   and should be removed. Agents should describe only their own capability.
2. **Terminology** — "data scientist" label in insights-analyzer conflates it
   with the data-science orchestrator. Each agent has a clear codename — use it.
3. **Encoding artifacts** — em-dashes (`—`) and smart quotes (`"`) are stored as
   mojibake (`â€"`, `â€œ`) making string replacement difficult.

Resolution plan:
- [x] **Fix encoding** — re-save each agent file with clean UTF-8 encoding
      (may require full file rewrite)
- [x] **Simplify docstrings** — each agent describes only its own role, capability,
      and architecture. No cross-agent comparison blocks.
- [x] **Align terminology** — use codenames consistently: The Brain, The Analyst,
      The Writer, The Librarian. Remove "data scientist" from The Analyst's docstring.

### 5.2 Data Science Agent (The Brain) Improvements

**Status:** DONE

- [x] **Use `setup()` hook** — already done in Phase 1.1
- [x] **KV caching for business snapshot** — `createCachedSnapshotTool(kv)` wraps
      `get_business_snapshot` with 60s KV cache via `src/lib/cache.ts` (done in Phase 3.2)
- [x] **Structured tool result types** — `src/agent/data-science/tools/types.ts`:
      `ToolErrorResult` (base with errorType/errorHint), `QueryDatabaseResult`,
      `BusinessSnapshotResult`, `RunAnalysisResult`, `AnalyzeTrendsResult`,
      `GenerateReportResult`, `SearchKnowledgeResult`. All tools now return typed results.
- [x] **Max steps configurability** — already in `agent_configs` (Phase 1.1)
- [x] **Graceful tool failure** — `agentError(agentName, err)` in specialists.ts
      classifies errors (timeout/auth/generic) → `{ error, errorType: "agent", errorHint }`.
      LLM receives structured failure context instead of hanging.

### 5.3 Insights Analyzer (The Analyst) Improvements

**Status:** DONE

- [x] **Remove two-step LLM pattern** — consolidated from `generateText` + `generateObject`
      into single `generateText()` call with JSON output instructions in system prompt.
      Response parsed via regex JSON extraction + `parseInsightsFromText()` fallback.
      `structuringModel` config deprecated.
- [x] **Dynamic analysis types** — replaced hardcoded enum with data-driven registry
      in `src/services/type-registry.ts` (done in Phase 3.4)
- [x] **Result caching** — analysis results cached in KV with 15-min TTL
      (done in Phase 3.2)
- [x] **Confidence scoring** — `computeConfidence(metrics)` function with weighted
      formula: sampleSize 35% (log scale), completeness 25%, timeCoverage 25%,
      pValue 15%. Sandbox returns `_confidence` metrics object (sampleSize,
      completeness, stdDev, coefficientOfVariation, pValue, timeSpanDays).
      All insights get computation-based confidence, not LLM-guessed values.

### 5.4 Report Generator (The Writer) Improvements

**Status:** DONE

- [x] **Report persistence** — `saved_reports` Postgres table with auto-versioning.
      `src/services/reports.ts`: `saveReport()` (auto MAX(version)+1 per type+period),
      `getReportById()`, `listReports()`, `getReportVersions()`, `deleteReport()`.
      Both fast path and SQL path persist via `ctx.waitUntil()` background tasks.
- [x] **Report versioning** — version column auto-increments per report type+period.
      API: `GET /reports/versions?reportType=...&periodStart=...&periodEnd=...`.
- [x] **Dynamic report types** — replaced hardcoded enum with data-driven registry
      in `src/services/type-registry.ts` (done in Phase 3.4)
- [x] **Export formats** — `REPORT_FORMATS = ["markdown", "plain", "csv", "json", "html"]`.
      `buildFormatInstruction(format)` provides per-format LLM instructions
      (CSV: data-only tabular, JSON: structured object, HTML: semantic fragment).
- [x] **Scheduled reports** — cron-triggered periodic report generation via
      Phase 5.6 Scheduler agent ("The Clockmaker"). Admin Console schedule management
      with report task type dispatching to report-generator agent.

### 5.5 Knowledge Base (The Librarian) Improvements

**Status:** DONE

- [x] **Fix vector listing** — replaced `query: "*"` with KV document index
      (`DOC_INDEX_NS = "kb-doc-index"`). `DocIndexEntry` stored per filename with
      title, category, uploadedAt, chunkCount, keys[]. Fallback to vector `exists()`.
- [x] **Chunking in agent** — raw documents (chunkIndex === -1 or no key) auto-chunked
      via `chunkDocument()` from `src/lib/chunker.ts`. Pre-chunked documents pass through.
      KV document index updated in `ctx.waitUntil()` background task with merge logic.
- [x] **Metadata-only search** — `inputSchema.filters?: { category?, filename? }`
      passed as `metadata` filter to `ctx.vector.search()` for metadata-constrained retrieval.
- [x] **Similarity threshold config** — already in `KnowledgeBaseConfig` (Phase 1.1)
- [x] **Source citation formatting** — `SourceCitation` interface with title, filename,
      category, similarity score, chunkIndex. LLM system prompt updated with [Source N]
      notation and similarity-based prioritization instructions.

### 5.6 New Agent: Scheduler ("The Clockmaker")

**Status:** DONE

A dedicated scheduling agent for periodic tasks with full admin console management:

- [x] **Design scheduler agent** — `src/agent/scheduler/agent.ts` handles cron-triggered
      report generation (via report-generator agent), daily insight summaries
      (via insights-analyzer agent), stock alert checks (direct DB), data cleanup
      (purges old sessions/notifications/executions), and custom tasks.
      DB tables: `schedules` + `schedule_executions` in `src/db/schema.ts`.
      Service layer: `src/services/scheduler.ts` (full CRUD + execution lifecycle).
- [x] **Cron route integration** — `src/api/scheduler-cron.ts` uses `cron("*/15 * * * *")`
      middleware to check for due schedules every 15 minutes and dispatch to the
      scheduler agent. Manual override at POST `/admin/scheduler/run-all`.
- [x] **Schedule management** — Admin Console "Scheduler" tab in AdminPage.tsx.
      Create/edit/delete schedules with name, taskType (report/insight/alert/cleanup/custom),
      cronExpression, taskConfig (JSON), timezone, maxFailures, isActive toggle.
      Manual "Run now" button per schedule. 9 API endpoints in `src/api/scheduler.ts`.
- [x] **Execution history** — Execution tracking with status, duration, result/error,
      triggerSource (cron/manual). History panel with summary stats (total/succeeded/failed/avg duration).
      Auto-disable after maxFailures threshold reached.
- [x] **Validation schemas** — `createScheduleSchema` and `updateScheduleSchema` in
      `src/lib/validation.ts`.
- [x] **Evals** — 2 evals: `scheduleExecutionEval` (output structure), `taskDispatchEval`
      (taskType dispatch correctness).

---

## Phase 6 — Data Sources (Internal & External)

### 6.1 Internal Data Sources

**Status:** DONE

All agents currently access Postgres directly via Drizzle. Improvements:

- [x] **Service layer consistency** — `saveChatMessage()` added to `src/services/chat.ts`
      (agent no longer does `db.insert(chatMessages)` directly). `getBusinessSnapshot()`
      added to `src/services/admin.ts` composing `getDashboardStats()` +
      `getLowStockProducts()` from inventory service. Data-science agent imports from
      services only. `fetchBusinessSnapshot()` removed from agent tool code.
      Deprecated `helpers/context.ts` tombstone deleted (no importers). Empty `helpers/`
      directory removed.
- [x] **Vector store optimization** — chunking config (chunk size, overlap), metadata
      filters, and similarity thresholds all configurable per-deployment via
      `KnowledgeBaseConfig` (Phase 1.1 + 5.5).
- [x] **KV store utilization** — `ctx.kv` adopted across all agents for caching
      (done in Phase 3.2)

### 6.2 External Data Sources

**Status:** DONE (core infrastructure; webhook receivers + data import agents deferred to Phase 5.6)

The custom tools framework supports HTTP-based external API calls. Build on this:

- [x] **API integration patterns** — `executeServerTool()` in `src/services/custom-tools.ts`
      now serves as the documented pattern: URL interpolation, path/query params,
      dynamic variables, multi-auth, retry, rate limiting.
- [x] **OAuth2 token management** — `getOAuth2Token()` implements full
      `client_credentials` grant exchange with in-memory token caching (cached
      until 60s before expiry). Falls back to stored `accessToken` if `tokenUrl`
      not configured. Supports `scope` and custom `grantType`.
- [x] **Webhook receivers** — done: `src/api/webhooks.ts` provides generic webhook
      receiver framework with env-var registration (`WEBHOOK_{NAME}_SECRET`),
      HMAC signature verification (crypto.subtle), event log ring buffer,
      dynamic agent dispatch. Routes: POST /webhooks/:source, GET /webhooks,
      POST /webhooks/register, DELETE /webhooks/:source.
- [x] **Data import agents** — done: `src/agent/data-import/index.ts` supports
      API/file/webhook sources, products/customers import types, create/update/upsert
      modes, dry run, batch limits, KV state tracking, CSV parsing, S3 file reading.
- [x] **Rate limiting** — per-tool rate limiting via in-memory sliding window
      counters. Default 60 req/min per tool, configurable per-tool via
      `metadata.rateLimit`. Returns structured `{ rateLimited: true }` error.
- [x] **Retry with exponential backoff** — server tools auto-retry on 5xx,
      timeout, and network errors. Configurable retries via `metadata.retries`
      (default 2). Backoff: 500ms, 1s, 2s, ... Client errors (4xx) are not retried.

### 6.3 Durable Streams

**Status:** DONE
**SDK ref:** `.copilot/skills/agentuity-storage.md` → Durable Streams

Durable streams provide persistent, URL-addressable data streams:

- [x] **Report downloads** — `POST /reports/saved/:id/export` creates a durable
      stream with the report content, returns a shareable URL (7-day TTL).
      Streams stored in `report-exports` namespace with report metadata.
- [x] **Export listing** — `GET /reports/exports` lists all exported report streams
      with metadata (report type, title, format, filename).
- [x] **Audit trails** — done: `src/services/audit.ts` provides `createAuditLogger()`
      that writes NDJSON entries to durable streams (`audit:{source}` namespace).
      90-day TTL, compressed, with list/read/delete query functions.
- [x] **Data pipeline** — done: `src/lib/pipeline-stream.ts` provides
      `createPipelineWriter()` / `readPipeline()` / `readPipelineBatches()` for
      large payload handoff between agents via durable streams (24h TTL).

### 6.4 Object Storage

**Status:** DONE
**SDK ref:** `.copilot/skills/agentuity-storage.md` → Object Storage (S3)

Bun's native `s3` module provides S3-compatible object storage:

- [x] **Document storage** — `src/services/document-storage.ts`: S3-backed
      original document persistence alongside vector embeddings. `storeDocument()`
      writes content + metadata sidecar. `getDocument()`, `deleteDocument()`,
      `listStoredDocuments()`, `getDocumentDownloadUrl()` (presigned, 1hr TTL).
      Document upload route stores originals in S3 background task.
      Delete route cleans up both vector + S3.
      `GET /admin/documents/:filename/download` returns presigned URL.
      Gracefully degrades when S3 is not configured (local dev).
- [x] **Report S3 archival** — done: `src/services/reports.ts` adds S3 storage
      functions (`uploadReportToS3`, `getReportDownloadUrl`, `deleteReportFromS3`).
      Routes: POST /reports/saved/:id/archive, GET /reports/saved/:id/download,
      DELETE /reports/saved/:id/archive. Presigned URLs with configurable expiry.
- [x] **Attachment handling** — done: `src/api/attachments.ts` provides chat file
      attachment routes with S3 storage. POST /chat/sessions/:id/attachments
      (multipart upload), GET /chat/attachments/:id (presigned download),
      GET /chat/sessions/:id/attachments (list), DELETE /chat/attachments/:id.
      10MB max, type-restricted (images, PDFs, CSVs, spreadsheets).

---

## Phase 7 — Prompt Engineering


### 7.1 System Prompt Architecture

**Status:** DONE

- [x] **Unified prompt builder** — `src/lib/prompts.ts`: `buildAgentPrompt()` assembles
      ordered `PromptSection[]` with blank-line separators. Shared utilities:
      `injectLabels()`, `terminologySection()`, `defaultGuardrails()`,
      `formattingSection()`, `SQL_DIALECT_SECTION` constant.
- [x] **Prompt versioning** — prompt templates stored in DB with version tracking, CRUD and activation via admin UI
- [x] **Prompt testing** — admin UI for editing/testing prompt changes

### 7.2 Terminology Consistency

**Status:** DONE

- [x] **Audit all prompts** — all prompt sections now use `{{LABEL}}` placeholders
      (12 tokens: PRODUCT, PRODUCT_PLURAL, ORDER, ORDER_PLURAL, CUSTOMER,
      CUSTOMER_PLURAL, WAREHOUSE, INVOICE, CURRENCY, UNIT_DEFAULT, COMPANY_NAME,
      TIMEZONE) resolved via `injectLabels()` at runtime.
- [x] **Dynamic label injection** — `injectLabels(template)` in `src/lib/prompts.ts`
      (pre-compiled `LABEL_RE` regex). Applied to: type-registry templates (8 types),
      insights-analyzer prompts (4), report-generator prompts (4), data-science
      system prompt (terminology/guardrails/formatting sections), knowledge-base
      system prompt (terminology + currency).
- [x] **Test with multiple industries** — validated with multiple label configs

### 7.3 Routing Heuristic Optimization

**Status:** DONE

- [x] **Config-driven routing** — `RoutingExample` interface (`query`, `tools[]`,
      `strategy`, `rationale`). `DEFAULT_ROUTING_EXAMPLES` (8 built-in) merged with
      `agent_configs.config.routingExamples` via `mergeRoutingExamples()`. Generates
      ROUTING HEURISTIC text block via `buildRoutingSection()`.
- [x] **Routing examples** — 8 built-in examples with config labels injected
      (product/order/customer terminology). Custom examples override by query match.
- [x] **Routing analytics** — tracks route selection + user feedback, analytics dashboard in admin UI

### 7.4 Few-Shot Examples

**Status:** DONE

- [x] **Example library** — `TypeDefinition.fewShotExamples` added to type registry.
      6 of 8 built-in types populated (demand-forecast: 2, anomaly-detection: 1,
      restock-recommendations: 1, sales-trends: 2, sales-summary: 1, inventory-health: 1).
      `formatFewShotExamples()` helper appends to prompt output.
- [x] **Dynamic example selection** — semantic similarity selection implemented
- [x] **Example management UI** — admin UI for examples (CRUD, filter, preview)

### 7.5 Guardrails & Safety

**Status:** DONE

- [x] **Built-in guardrails** — `defaultGuardrails()` provides 6 always-present rules:
      read-only SQL only, no credentials/secrets in output, no data fabrication,
      PII masking, scope constraint (business data only), state assumptions.
      Custom guardrails from DB appended (not replaced). All 4 agents have explicit
      `GUARDRAILS:` blocks in system prompts.
- [x] **SQL injection prevention** — already robust via `validateReadOnlySQL()`
      (Phase 1.4) + guardrail reinforcement in prompts.
- [x] **Output validation** — schema validation on LLM outputs (text and JSON)
- [x] **Token budget management** — per-agent token limits and enforcement
- [x] **PII detection** — scan outputs for PII, mask sensitive data in all agent responses
- [x] **Hallucination detection** — verify claims against DB/tool outputs, risk scoring eval

### 7.6 Evaluation Framework

**Status:** DONE
**SDK ref:** `.copilot/skills/agentuity-creating-agents.md` → `agent.createEval()`

- [x] **Define eval suites per agent** — 14 evals across 5 agents, all exported
                  from barrel `index.ts` files for SDK discovery:
      - **data-science** (`eval.ts`): `responseQualityEval`, `toolUsageEval`, `groundednessEval`, `hallucinationDetectionEval`
      - **insights-analyzer** (`eval.ts`): `insightCompletenessEval`, `confidenceCalibrationEval`, `severityDistributionEval`
      - **report-generator** (`eval.ts`): `reportStructureEval`, `reportCompletenessEval`, `factualConsistencyEval`
      - **knowledge-base** (`eval.ts`): `answerGroundednessEval`, `retrievalRelevanceEval`, `ingestSuccessEval`
      - **document-scanner** (`eval.ts`): `extractionAccuracyEval`, `inputValidationEval`
- [x] **Automated eval runs** — scheduled and manual triggers, daily cron and admin UI
- [x] **Eval dashboard** — admin UI for eval results, summary, trends, and manual run

---

## Dependency Graph

```
Phase 1 (Architecture) ─── foundation for everything
    │
    │  1.1 App/Agent lifecycle hooks    ← do first (enables ctx.config, ctx.app)
    │  1.2 Agent file structure         ← do second (enables clean separation)
    │  1.3 Deduplicate DB_SCHEMA        ← independent, do anytime
    │  1.4 Deduplicate SQL safety       ← independent, do anytime
    │  1.5 Schema validation strategy   ← do before route work
    │  1.6 Streaming migration          ← depends on 1.7 (agent-to-route)
    │  1.7 Agent-to-route pattern       ← depends on 1.1, 1.2
    │  1.8 Background tasks             ← depends on 1.7 (ctx.waitUntil)
    │  1.9 State management             ← depends on 1.1 (ctx.app/config)
    │  1.10 Events & observability      ← do last in phase 1
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

**Phase 1 internal order:** 1.1 → 1.2 → 1.3+1.4 (parallel) → 1.5 → 1.7 → 1.6+1.8 (parallel) → 1.9 → 1.10
**Recommended cross-phase order:** 1 → 2+3 (parallel) → 4+5 (parallel) → 6 → 7

---

## Gap Summary

| Category | Gap | Impact | Phase |
|----------|-----|--------|-------|
| ~~SDK Underuse~~ | ~~`ctx.kv` not used anywhere~~ | ~~Redundant DB queries, no caching~~ | ~~3.2~~ DONE |
| ~~SDK Underuse~~ | ~~`ctx.stream` (durable) not used~~ | ~~No persistent exports or downloads~~ | ~~6.3~~ DONE |
| SDK Underuse | Agent `setup()` hook not used | Config fetched per-request, wasted DB calls | 1.1 |
| SDK Underuse | App `setup()` only validates env | No shared typed app state | 1.1 |
| SDK Underuse | `ctx.waitUntil()` not used | Background tasks may be killed early, errors swallowed | 1.8 |
| SDK Underuse | `ctx.tracer` not used | No observability into agent internals | 1.10 |
| ~~SDK Underuse~~ | ~~`agent.createEval()` not used~~ | ~~No quality measurement~~ | ~~7.6~~ DONE |
| ~~SDK Underuse~~ | ~~`sandbox.snapshot()` not used~~ | ~~Slow sandbox cold starts~~ | ~~4.2~~ DONE |
| SDK Underuse | `sse()` / `websocket()` / `stream()` middleware not used | Hand-rolled SSE is fragile, no bidirectional | 1.6 |
| SDK Underuse | `validator()` middleware not used in routes | No request validation at transport layer | 1.5 |
| SDK Underuse | `ctx.thread.state` / `ctx.session.state` not used | Custom DB state only, no fast encrypted tier | 1.9 |
| SDK Underuse | Agent events (`addEventListener`) not used | No operational monitoring of agent lifecycle | 1.10 |
| SDK Underuse | `schema: { stream: true }` not used | Agent can't stream natively | 1.6 |
| Architecture | `streamChat()` exported as bare function | Bypasses agent lifecycle — no `ctx`, no tracing | 1.7 |
| Architecture | `data-science/index.ts` is 1005-line monolith | Maintenance burden, violates SRP | 1.2 |
| Architecture | No agent file structure convention | Inconsistent organization across agents | 1.2 |
| Architecture | `sessionBus` Map for SSE doesn't scale | Breaks across deployment instances | 1.6 |
| Code Duplication | `DB_SCHEMA` in 3 agent files | Schema drift risk | 1.3 |
| Code Duplication | SQL safety check in 3 agents | Inconsistent validation | 1.4 |
| ~~Hardcoding~~ | ~~Analysis types (4 enum values)~~ | ~~Can't add types without deploy~~ | ~~3.4~~ DONE |
| ~~Hardcoding~~ | ~~Report types (4 enum values)~~ | ~~Can't add types without deploy~~ | ~~3.4~~ DONE |
| ~~Hardcoding~~ | ~~Routing heuristic in prompt~~ | ~~Can't tune routing without deploy~~ | ~~7.3~~ DONE |
| ~~Missing Feature~~ | ~~No caching layer~~ | ~~Every request hits DB~~ | ~~3.2~~ DONE |
| ~~Missing Feature~~ | ~~No report persistence~~ | ~~Reports regenerated every time~~ | ~~5.4~~ DONE |
| ~~Missing Feature~~ | ~~No scheduled tasks~~ | ~~No automated report/alert generation~~ | ~~5.6~~ DONE |
| ~~Missing Feature~~ | ~~No Python sandbox runtime~~ | ~~Limited to JS for data science~~ | ~~4.4~~ DONE |
| ~~Missing Feature~~ | ~~No eval framework~~ | ~~No quality metrics~~ | ~~7.6~~ DONE |
| ~~Encoding~~ | ~~Agent docstrings have mojibake~~ | ~~Maintenance friction~~ | ~~5.1~~ DONE |

---

## Changelog

| Date | Phase | Action |
|------|-------|--------|
| 2025-07-13 | — | Initial roadmap created from deep platform research |
| 2025-07-13 | 2.2 | Custom tools seed definitions (11 tools) + API endpoint added |
| 2025-07-13 | 5.2 | All 4 agents wired to `agent_configs` DB for runtime config |
| 2025-07-14 | 1.* | Phase 1 enriched with deep research: official Agentuity docs (agents, streaming, state, lifecycle, evaluations, standalone execution) + linkt reference repo patterns. Expanded from 7 to 10 subsections. Added concrete SDK patterns, code examples, migration paths, and linkt best practices throughout. || 2026-02-19 | 1.1 | `app.ts` setup() returns typed `AppState` with `aiSettings`. All 4 agents have `setup()` returning typed configs (`DataScienceConfig`, `InsightsConfig`, `ReportConfig`, `KnowledgeBaseConfig`). |
| 2026-02-19 | 1.2 | All 4 agents split from monolith index.ts into modular file structure: `types.ts`, `agent.ts`, `prompts/`, `tools/`, `helpers/`, `index.ts` barrel. Data-science split from 1025-line monolith into 10 files. |
| 2026-02-19 | 1.3 | `DB_SCHEMA` extracted to `src/lib/db-schema.ts`, imported by all agents that need schema context. |
| 2026-02-19 | 1.4 | `validateReadOnlySQL()` extracted to `src/lib/sql-safety.ts`, shared by report-generator and data-science. |
| 2026-02-19 | 1.5 | Route validation middleware: `validator()` from `@agentuity/runtime` added to all 15 route files (48+ POST/PUT endpoints). Shared Zod schemas in `src/lib/validation.ts` — auth, products, orders, customers, categories, warehouses, inventory, invoices, settings, reports, chat, admin, payments, pricing, documents, KRA, custom-tools, agent-configs. Manual validation replaced with declarative schema middleware. |
| 2026-02-19 | 1.7 | Agent-to-route pattern: `getConversationContext()` and `maybeCompressSummary()` extracted from agent module to `src/services/chat.ts`. Agent barrel cleaned — only exports default + `streamChat`. All routes now use `@agent/*` aliases (no relative imports). `streamChat()` move to agent handler deferred to Phase 1.6 (requires streaming arch). |
| 2026-02-19 | 1.6 | Streaming migration: SSE events endpoint migrated from hand-rolled `new ReadableStream()` + `TextEncoder` to SDK `sse()` middleware from `@agentuity/runtime`. `sessionBus` (callback Map) replaced with `sessionStreams` (SSE stream object Map). Uses `stream.writeSSE()` for structured events, `stream.onAbort()` for disconnect cleanup. Frontend hook unchanged (same SSE event format). |
| 2026-02-19 | 1.8 | Background tasks: All `.catch(() => {})` fire-and-forget patterns in `src/api/chat.ts` replaced with `c.waitUntil()`. `processStream` wrapped in `c.waitUntil()` — runtime stays alive until stream completes. `autoTitleSession` and `maybeCompressSummary` now use try/catch instead of `.catch(() => {})`. |
| 2026-02-19 | 1.9 | State management: `ctx.state` used for request-scoped timing in all 4 agents (`ctx.state.set("startedAt", Date.now())`). `durationMs` added to all agent completion logs. `thread.destroyed` event wired in `app.ts` for observability. KV caching and thread state deferred to Phase 3.2. |
| 2026-02-19 | 1.10 | Events & observability: All 7 SDK lifecycle events wired in `app.ts` via `addEventListener` (`agent.started/completed/errored`, `session.started/completed`, `thread.created/destroyed`). `console.log` eliminated from `app.ts` (shutdown) and `src/api/payments.ts` (M-Pesa callbacks) — replaced with `getLogger()` and `c.var.logger`. Only `console.log` remaining is in sandbox code strings (intentional). OpenTelemetry spans deferred. |
| 2026-02-20 | 1.10+2.2 | OpenTelemetry + Tool Analytics: `agent_telemetry` + `tool_invocations` DB tables, `traced()` utility with `SpanCollector` batch writes, all 4 agents instrumented, `extractToolInvocations()` for AI SDK step parsing, telemetry + tool-analytics services, `/api/admin/telemetry/*` endpoints (8 routes), Observability admin tab with agent performance, tool stats, and timeline chart. |
| 2026-02-19 | 5.1 | All 4 agents rewritten with clean UTF-8 encoding, proper docstrings, `description` fields, `.describe()` on all Zod fields, structured `ctx.logger` with metadata objects. |
| 2026-02-19 | 2.1 | Agent Config Admin UI: Added `validateAgentConfig()` for temperature/maxSteps/timeout ranges with inline error display. Added `updatedAt` timestamp on card headers. Added "Reset Defaults" button per agent with `resetAgentToDefaults()` backend function. Save disabled on validation errors. |
| 2026-02-19 | 2.2 | Custom Tools Admin UI: Added "Seed Starter Tools" button (header + empty-state) calling `POST /api/custom-tools/seed`. Shows success count or "already exists" message. |
| 2026-02-19 | 2.3 | AI Chat: Streaming agent indicator maps tool names to specialist labels (Brain/Analyst/Writer/Librarian) with animated pulse. "Stop" cancel button during streaming. |
| 2026-02-19 | 2.4 | Reports: Rich markdown rendering replaces raw `<pre>` (tables, headers, lists, bold/italic). Report history in localStorage (last 20). Click to reload, clear button. |
| 2026-02-19 | 2.5 | Dashboard: AI Insights widget (top 3 data-derived insights with severity cards). NL date filter input ("last week", "last 60 days", "YTD", etc.). |
| 2026-02-19 | 3.1 | Dynamic DB Schema: `scripts/generate-db-schema.ts` introspects Drizzle pgTable exports via `getTableConfig()`. `src/lib/db-schema.ts` rewritten with all 27+ tables + `DB_SCHEMA_HASH` (sha256, 16-char prefix) for cache key scoping. |
| 2026-02-19 | 3.2 | Query Result Caching: `src/lib/cache.ts` — `createCache(kv)` factory, `CACHE_NS`/`CACHE_TTL` constants, schema-scoped key builders. KV caching in 3 agents: snapshot (60s), analysis (15min), reports (1hr). `memoryCache` for agent configs (60s). `ctx.kv` passed from route → agent → tools. |
| 2026-02-19 | 3.3 | Conversation Memory: Two-tier `maybeCompressSummary()`: extractive (free, 20-35 msgs) + LLM (35+ msgs with fallback). `extractiveSummarize()` extracts user questions + assistant first sentences. Duplicate `data-science/helpers/context.ts` replaced with re-export tombstone. |
| 2026-02-19 | 3.4 | Extensible Types: `src/services/type-registry.ts` — data-driven `TypeDefinition` registry with built-in types + custom types from `agent_configs` JSONB. `z.enum()` → `z.string()` in both specialist schemas + delegation tools. `getAnalysisPromptForType()`/`getReportPromptForType()` with template expansion. `GET /reports/types` API endpoint. |
| 2026-02-19 | 4.1 | Sandbox Hardening: `classifyError()` with 7 `SandboxErrorType` categories + human-readable hints. `truncateOutput()` (512KB default). `executeSandboxWithRetry()` with `correctCode` callback (skips non-correctable errors). `sandbox.destroy()` in finally blocks. Dead `executeSandboxOneShot()` removed. |
| 2026-02-19 | 4.2 | Sandbox Snapshots: `createAnalysisSnapshot()` creates snapshot with `ANALYSIS_DEPENDENCIES` (simple-statistics, date-fns, lodash). `POST /admin/sandbox/snapshot` admin API endpoint. Snapshot ID stored in `agent_configs.config.sandboxSnapshotId`. Both data-science + insights-analyzer pass through. |
| 2026-02-19 | 4.3 | Interactive Sessions: `createSandboxSession()` factory returns `SandboxSession` interface with `exec()`, `writeFile()`, `snapshot()`, `destroy()`. Lifecycle management (use-after-destroy guard), configurable idle/execution timeouts. |
| 2026-02-19 | 4.4 | Multi-Runtime: `SandboxRuntime` type (`bun:1 \| python \| node`). `buildPythonScript()` for Python wrapper generation. `getExecCommand()`/`getScriptExt()` per-runtime dispatch. Runtime configurable via agent config JSONB. Tool descriptions dynamically adapt to runtime label. |
| 2026-02-19 | 5.2 | Structured Tool Results: `src/agent/data-science/tools/types.ts` — typed result interfaces for all tools (`ToolErrorResult`, `QueryDatabaseResult`, `BusinessSnapshotResult`, `RunAnalysisResult`, etc.). `agentError()` helper classifies errors (timeout/auth/generic) → structured `errorType: "agent"` + `errorHint`. All specialist delegation tools return typed promises. |
| 2026-02-19 | 5.3 | Single-Pass Insights: Removed `generateObject` second LLM call. Single `generateText()` with JSON output instructions. `computeConfidence(metrics)` weighted formula (sampleSize 35%, completeness 25%, timeCoverage 25%, pValue 15%). Sandbox returns `_confidence` metrics object. `structuringModel` deprecated. |
| 2026-02-19 | 5.4 | Report Persistence: `saved_reports` pg table with auto-versioning. `src/services/reports.ts` CRUD service. 5 export formats (markdown/plain/csv/json/html) with `buildFormatInstruction()`. 4 new API endpoints (list/get/versions/delete). Both fast+SQL paths persist via `ctx.waitUntil()`. |
| 2026-02-19 | 5.5 | Knowledge Base Overhaul: KV document index (`DOC_INDEX_NS`) replaces `query: "*"` listing. Auto-chunking via `chunkDocument()` for raw documents. Metadata filters in `ctx.vector.search()`. Rich `SourceCitation` objects with similarity scores. `DocIndexEntry` maintained in `ctx.waitUntil()` with merge logic. |
| 2026-02-19 | 6.1 | Service Layer Consistency: `saveChatMessage()` in `src/services/chat.ts`, `getBusinessSnapshot()` in `src/services/admin.ts`. Data-science agent fully migrated to service imports — zero direct DB access. `fetchBusinessSnapshot()` removed from agent tools. Deprecated `helpers/context.ts` tombstone + empty directory deleted. |
| 2026-02-19 | 6.2 | External Data Sources: `getOAuth2Token()` with `client_credentials` grant + in-memory cache (expiry-aware). Per-tool rate limiting via sliding window (60 req/min default, configurable). Retry with exponential backoff (2 retries, 500ms base, 5xx/timeout/network only). |
| 2026-02-19 | 6.3 | Durable Streams: `POST /reports/saved/:id/export` creates durable stream (7-day TTL) with report content + metadata, returns shareable URL. `GET /reports/exports` lists exported streams with pagination. 501 fallback when streams unavailable. |
| 2026-02-19 | 6.4 | Object Storage: `src/services/document-storage.ts` — S3-backed document persistence with `.meta.json` sidecars. Upload route stores originals in S3 background task. Delete cleans both vector + S3. `GET /admin/documents/:filename/download` returns presigned URL (1hr). Graceful degradation when S3 unavailable. |
| 2026-02-19 | 7.1 | Unified Prompt Builder: `src/lib/prompts.ts` — `buildAgentPrompt()`, `injectLabels()` (12 `{{LABEL}}` tokens, pre-compiled regex), `terminologySection()`, `defaultGuardrails()` (6 built-in safety rules), `formattingSection()`, `SQL_DIALECT_SECTION` constant. |
| 2026-02-19 | 7.2 | Terminology Consistency: All prompt templates (type-registry 8 types, insights-analyzer 4, report-generator 4, data-science system prompt, knowledge-base system prompt) converted to `{{LABEL}}` placeholders resolved by `injectLabels()` at runtime. |
| 2026-02-19 | 7.3 | Config-Driven Routing: `RoutingExample` interface, `DEFAULT_ROUTING_EXAMPLES` (8 built-in), `buildRoutingSection()`, `mergeRoutingExamples()`. Custom examples from `agent_configs.config.routingExamples` override defaults by query match. |
| 2026-02-19 | 7.4 | Few-Shot Examples: `TypeDefinition.fewShotExamples` field. 6 of 8 built-in types populated with examples. `formatFewShotExamples()` helper appends to analysis/report prompt output. |
| 2026-02-19 | 7.5 | Built-in Guardrails: `defaultGuardrails()` always present (6 rules: read-only SQL, no credentials, no fabrication, PII masking, scope constraint, state assumptions). Custom guardrails appended. All 4 agents have explicit `GUARDRAILS:` blocks in system prompts. |
| 2026-02-19 | 7.6 | Evaluation Framework: 12 evals across 4 agents via `agent.createEval()`. Data-science (3): response-quality, tool-usage, groundedness. Insights-analyzer (3): insight-completeness, confidence-calibration, severity-distribution. Report-generator (3): report-structure, report-completeness, factual-consistency. Knowledge-base (3): answer-groundedness, retrieval-relevance, ingest-success. All exported from barrel `index.ts` files. |
| 2026-02-20 | 5.6 | Scheduler Agent ("The Clockmaker"): `schedules` + `schedule_executions` DB tables. `src/services/scheduler.ts` (full CRUD + execution lifecycle + auto-disable on maxFailures). `src/agent/scheduler/agent.ts` with 5 task handlers (report→report-generator, insight→insights-analyzer, alert→DB low-stock/overdue checks, cleanup→purge old data, custom). `src/api/scheduler.ts` (9 admin endpoints). `src/api/scheduler-cron.ts` cron("*/15 * * * *") tick + manual run-all. Admin Console "Scheduler" tab with create/edit/delete/toggle/run-now + execution history panel with summary stats. 2 evals (execution-structure, task-dispatch). Validation schemas in `validation.ts`. |