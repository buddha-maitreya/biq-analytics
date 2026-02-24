# Sandbox Optimization Roadmap

## Research Sources

| Source | Author | Key Insight |
|--------|--------|-------------|
| [Code execution with MCP: building more efficient AI agents](https://www.anthropic.com/engineering/code-execution-with-mcp) | Anthropic (Adam Jones, Conor Kelly) | 98.7% token reduction by moving from tool calls to code orchestration |
| [Code Mode: the better way to use MCP](https://blog.cloudflare.com/code-mode-the-better-way-to-use-mcp) | Cloudflare (Kenton Varda, Sunil Pai) | LLMs write better code than they make tool calls; present APIs as typed stubs |
| [LLM function calls don't scale](https://jngiam.bearblog.dev/llm-function-calls-dont-scale/) | jngiam (Lutra.ai) | Variables as memory; code orchestration as computation graph |
| [MCP Context Management: Code vs Direct Tools](https://ai.plainenglish.io/mcp-context-management-code-vs-direct-tools) | Gaurav Shrivastav | Academic validation ("Executable Code Actions Elicit Better LLM Agents") |
| [Executable Code Actions Elicit Better LLM Agents](https://arxiv.org/abs/2402.01030v4) | arXiv paper | Better task completion, error handling, reduced hallucination |

---

## Problem Statement

Our analytics pipeline uses multi-step tool calling:

```
LLM generates tool call → server fetches SQL → serializes to data.json → sandbox runs Python → result back to LLM → repeat
```

Each round-trip:
- Burns ~4,000+ tokens of context (tool result re-enters LLM conversation)
- Adds network latency (LLM inference + sandbox boot per step)
- Serializes data twice (JSON encode on server → JSON decode in sandbox)
- Limited to `MAX_DATA_ROWS` (200) because data must fit in LLM context

**Measured impact:** 87,678 tokens for a single analysis (exceeded 30K TPM limit on Tier 1 org).

---

## Architecture: Before vs After

### Before (Multi-Step Tool Calling)

```
┌─────────────┐     ┌──────────┐     ┌─────────────┐     ┌─────────┐
│  LLM (GPT)  │────▶│  Tool    │────▶│  Server     │────▶│ Sandbox │
│             │◀────│  Result  │◀────│  fetchData  │◀────│ Python  │
│  (context   │     │  (+4K    │     │  (SQL→JSON) │     │         │
│   grows)    │     │  tokens) │     │             │     │         │
│             │────▶│  Tool    │────▶│  fetchData  │────▶│ Python  │
│             │◀────│  Result  │◀────│  (SQL→JSON) │◀────│         │
└─────────────┘     └──────────┘     └─────────────┘     └─────────┘
     5 round-trips × ~4K tokens each = ~20K+ tokens wasted
```

### After (Single-Script Code Orchestration)

```
┌─────────────┐     ┌─────────────────────────────────────────────┐
│  LLM (GPT)  │────▶│  Sandbox (Python)                           │
│             │     │                                             │
│  Generates  │     │  query_db("SELECT ...") → DataFrame         │
│  ONE Python │     │  df.groupby('cat').sum()                    │
│  script     │     │  model = LinearRegression().fit(X, y)       │
│             │     │  print(json.dumps(final_insights))          │
│             │◀────│                                             │
│  Sees ONLY  │     │  All intermediate data stays here           │
│  final JSON │     │  (never re-enters LLM context)              │
└─────────────┘     └─────────────────────────────────────────────┘
     1-2 round-trips × final result only = ~500 tokens
```

---

## Implementation Phases

### Phase 1: Infrastructure — Sandbox with DB Access (CURRENT)

**Goal:** Enable Python scripts in the sandbox to query the database directly, eliminating the server-side `fetchData()` middleman.

**Changes:**

1. **`src/lib/sandbox.ts` — `executeSandbox()`**
   - Inject `DATABASE_URL` as env var into sandbox `run()` options
   - Network stays enabled (already is for Python runtimes)
   - Add `query_db()` Python helper to the script wrapper that:
     - Connects to Postgres via `psycopg2`
     - Executes parameterized SELECT queries
     - Returns results as list of dicts and optionally as DataFrame
     - Validates SQL is SELECT-only (defense in depth)
   - Keep the existing `data.json` path as fallback (for callers passing `directData`)

2. **Snapshot update**
   - Add `psycopg2-binary` to the analytics snapshot packages
   - Recreate snapshot with: `uv pip install psycopg2-binary` (plus existing packages)

3. **`executeSandbox()` new mode: `directDbAccess: true`**
   - When enabled, the Python wrapper includes `query_db()` and injects `DATABASE_URL`
   - When disabled (default), existing behavior preserved (data.json)
   - Callers opt in: `executeSandbox(ctx.sandbox, { ..., directDbAccess: true })`

**Expected impact:**
- Eliminates JSON serialization bottleneck (no more data.json for DB queries)
- Removes `MAX_DATA_ROWS` ceiling — Python can paginate/stream directly
- Reduces data transfer size (no double-encoding)

---

### Phase 2: Agent Refactor — Single-Script Generation

**Goal:** Shift `insights-analyzer` from multi-step tool calling to single-script generation.

**Changes:**

1. **`insights-analyzer/agent.ts`**
   - Replace `tools: { run_analysis }` + `maxSteps: 5` with:
     - `maxSteps: 2` (generate script + optional retry on error)
     - LLM generates a complete Python script as its response (not a tool call)
     - One `executeSandbox()` call with `directDbAccess: true`
   - System prompt changes:
     - Remove tool-calling instructions
     - Present `query_db(sql)` as a Python API stub
     - Instruct: "Write ONE complete Python script. Call `query_db()` for data. `print()` final JSON."

2. **Prompt design — Python API stubs**
   ```python
   # Available in your script:
   def query_db(sql: str) -> list[dict]:
       """Execute a SELECT query against the business database.
       Returns a list of dicts (one per row). Only SELECT queries allowed."""
       ...

   def to_dataframe(rows: list[dict]) -> pd.DataFrame:
       """Convert query results to a pandas DataFrame with date columns auto-parsed."""
       ...

   # Pre-imported: numpy (np), pandas (pd), scipy.stats, sklearn, statsmodels
   # Output: print(json.dumps(result)) — only stdout JSON is captured
   ```

3. **Error retry loop**
   - If sandbox returns error, feed error back to LLM for one retry
   - LLM sees ONLY: `{ "error": "...", "errorType": "...", "errorHint": "..." }`
   - No intermediate data in context — just the error message

**Expected impact:**
- **90-98% token reduction** (matches Anthropic's measured 98.7%)
- **~3x latency reduction** (1 LLM call + 1 sandbox vs 5 round-trips)
- **Better code quality** — LLMs generate better Python than structured tool calls
- **No MAX_DATA_ROWS limit** — script handles its own data volume

---

### Phase 3: Hardened `query_db()` Implementation

**Goal:** Production-grade database access from sandbox with security and performance guarantees.

**Changes:**

1. **SQL safety enforcement**
   - `query_db()` validates SQL is SELECT-only (no DML/DDL)
   - Connection uses a read-only Postgres role (future: separate `DATABASE_READONLY_URL`)
   - Query timeout enforced at connection level (`statement_timeout`)

2. **Connection pooling**
   - Single connection per script execution (created on first `query_db()` call)
   - Auto-closed in an `atexit` handler
   - No connection pool needed — sandbox is ephemeral

3. **Result size guardrails**
   - `query_db()` logs a warning if result > 10K rows
   - Optional `limit` parameter: `query_db(sql, limit=1000)`
   - Encourage SQL-level aggregation in the prompt

4. **PII protection**
   - Raw data flows source → sandbox → aggregated result
   - LLM never sees individual records (only final insights JSON)
   - Matches Anthropic's privacy-preserving pattern

---

### Phase 4: Progressive Enhancement

**Future optimizations to revisit based on production data:**

1. **Skill persistence**
   - Cache proven Python analysis functions as "skills" in KV storage
   - LLM can import `from skills import demand_forecast` instead of regenerating
   - Matches Anthropic's SKILL.md pattern

2. **Pre-built analytics scripts (Strategy B)**
   - Curated SQL + Python scripts per analysis type (demand-forecast, anomaly-detection, etc.)
   - Deterministic execution — no LLM code generation needed
   - Useful for scheduled/cron analytics where results must be consistent

3. **Interactive sandbox sessions**
   - Use `sandbox.create()` instead of `sandbox.run()` for multi-step exploratory analysis
   - Sandbox persists between executions — no re-import, no re-connect
   - Useful for data-science agent's conversational workflow

4. **Read-only DB role**
   - Provision a `DATABASE_READONLY_URL` with a Postgres role that has only SELECT privileges
   - Defense in depth — even if SQL safety check is bypassed, the DB role blocks writes

5. **V8 isolates for JS analytics**
   - For simple computations that don't need Python, use V8 isolates (millisecond startup)
   - Currently not available in Agentuity but worth monitoring

---

## Key Metrics to Track

| Metric | Before (Multi-Step) | After (Single-Script) | Target |
|--------|--------------------|-----------------------|--------|
| Tokens per analysis | ~20,000-87,000 | ~2,000-5,000 | < 5,000 |
| LLM round-trips | 3-5 | 1-2 | ≤ 2 |
| Sandbox executions | 3-5 | 1 | 1 |
| End-to-end latency | 15-45s | 5-15s | < 15s |
| Data rows accessible | 200 (MAX_DATA_ROWS) | Unlimited (SQL-level) | No cap |
| Network in sandbox | Yes (uv install) | Yes (DB connect) | Yes |

---

## Security Model

| Layer | Control |
|-------|---------|
| SQL validation | `query_db()` rejects non-SELECT queries (defense in depth) |
| Network | Enabled for DB access; no arbitrary internet (Neon Postgres is allowlisted) |
| Credentials | `DATABASE_URL` injected as env var — LLM never sees it |
| PII | Raw data stays in sandbox; only aggregated insights return to LLM |
| Resource limits | Memory (256Mi-512Mi), CPU (500m), timeout (30-60s) |
| Sandbox isolation | Ephemeral container — destroyed after each execution |
| Snapshot | Pre-installed packages only — no runtime `pip install` needed |

---

## Snapshot Requirements

Current snapshot packages:
```
pandas, numpy, scipy, scikit-learn, matplotlib, seaborn, plotly,
statsmodels, prophet, lifetimes
```

**Add for Phase 1:**
```
psycopg2-binary    # PostgreSQL driver for direct DB access from sandbox
```

**WSL command to update snapshot:**
```bash
# 1. Create new sandbox with network
agentuity cloud sandbox create --runtime python:3.13 --name analytics-v3 --network --idle-timeout 45m

# 2. Create venv and install all packages
agentuity cloud sandbox exec <sbx_id> -- uv venv /home/agentuity/venv
agentuity cloud sandbox exec <sbx_id> -- bash -c "VIRTUAL_ENV=/home/agentuity/venv uv pip install pandas numpy scipy scikit-learn matplotlib seaborn plotly statsmodels prophet lifetimes psycopg2-binary"

# 3. Snapshot it
agentuity cloud sandbox snapshot create <sbx_id> --name analytics-snapshot-v3 --tag latest

# 4. Update env var
agentuity cloud env set ANALYTICS_SNAPSHOT_ID=<new_snapshot_id>

# 5. Clean up sandbox
agentuity cloud sandbox delete <sbx_id>
```

---

## References

- Anthropic: *"Pay the complexity cost once at the infrastructure level, then scale to hundreds of tools without context rot."*
- Cloudflare: *"LLMs are dramatically better at writing code than at making tool calls, because they've seen millions of real-world code examples."*
- jngiam: *"The core problem is that we're confounding orchestration and data processing together in the same chat thread."*
- Academic: *"Executable Code Actions Elicit Better LLM Agents"* (arXiv:2402.01030v4) — better task completion, error handling, reduced hallucination.
