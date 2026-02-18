# Business IQ Enterprise — Agents

See [.agents/agentuity/sdk/agent/AGENTS.md](../../.agents/agentuity/sdk/agent/AGENTS.md) for Agentuity agent development guidelines.

---

## System Agents

This project has 4 AI agents that power the intelligent features of the platform.
All agents use the Vercel AI SDK (`ai` package) with OpenAI models via `src/lib/ai.ts`.

### 1. Business Assistant (`business-assistant`)

**File:** `src/agent/business-assistant/index.ts` (176 lines)

**Purpose:** Conversational AI that answers natural-language business questions by querying live database data and explaining results in plain English.

**Input:**
```typescript
{ message: string, context?: Record<string, unknown> }
```

**Output:**
```typescript
{ reply: string, data?: unknown, suggestedActions?: string[] }
```

**How it works:**
1. `getBusinessSnapshot()` gathers real-time data from the database:
   - Product count, order count, customer count, total revenue
   - Low stock items (quantity ≤ reorder point)
   - 5 most recent orders with customer + status
   - Top 10 products by revenue
2. Snapshot is injected into the LLM system prompt as JSON context
3. LLM generates a natural-language answer grounded in actual data
4. Conversation history persisted via `ctx.thread.state` for multi-turn chat
5. Suggested actions are extracted from the response via regex

**Called by:** `POST /api/chat` → `src/api/chat.ts`

**Example questions:**
- "What are my top selling products this month?"
- "Which customers haven't ordered in 30 days?"
- "How's inventory looking? Anything running low?"
- "What's my revenue this week?"

---

### 2. Insights Analyzer (`insights-analyzer`)

**File:** `src/agent/insights-analyzer/index.ts` (177 lines)

**Purpose:** AI-powered pattern detection that finds business insights humans would miss — demand trends, anomalies, restock urgency, and sales patterns.

**Input:**
```typescript
{
  analysis: 'demand-forecast' | 'anomaly-detection' | 'restock-recommendations' | 'sales-trends',
  timeframeDays: number,   // 1-365, default 30
  productId?: string,      // Optional: focus on one product
  limit?: number,          // 1-50, default 10
}
```

**Output:**
```typescript
{
  analysisType: string,
  generatedAt: string,
  insights: Array<{
    title: string,
    severity: 'info' | 'warning' | 'critical',
    description: string,
    recommendation: string,
    affectedItems?: string[],
    confidence: number,  // 0.0 – 1.0
  }>,
  summary: string,
}
```

**How it works:**
1. Gathers three data sets in parallel:
   - `getSalesVelocity(days)` — per-product sales volume, revenue, order frequency
   - `getStockContext()` — current stock vs. reorder points for all active products
   - `getRecentMovements(days)` — inventory transaction volumes by type
2. Uses `generateObject` for structured, schema-validated output
3. LLM reasons over multi-dimensional data to produce actionable insights
4. Each insight includes confidence score and specific recommendations

**Called by:** `POST /api/reports` (insights endpoint) and the upcoming Data Science Assistant

---

### 3. Report Generator (`report-generator`)

**File:** `src/agent/report-generator/index.ts` (230 lines)

**Purpose:** AI-narrated business reports that go beyond raw data to interpret trends, highlight key findings, and recommend actions.

**Input:**
```typescript
{
  reportType: 'sales-summary' | 'inventory-health' | 'customer-activity' | 'financial-overview',
  startDate?: string,   // ISO datetime, defaults to 30 days ago
  endDate?: string,     // ISO datetime, defaults to now
  format: 'markdown' | 'plain',
}
```

**Output:**
```typescript
{
  title: string,
  reportType: string,
  period: { start: string, end: string },
  content: string,       // Full formatted report text
  generatedAt: string,
}
```

**How it works:**
1. Gathers data based on report type:
   - **sales-summary**: Revenue, tax, discounts, avg order value, top products, top customers
   - **inventory-health**: Stock summary, low stock count, out-of-stock count, low stock items
   - **customer-activity**: Reuses sales data focused on customer ordering patterns
   - **financial-overview**: Sales data + invoice summary (total invoiced, paid, outstanding, overdue) + payments
2. LLM generates a structured report with: Executive Summary → Key Metrics → Details & Analysis → Recommendations
3. Respects deployment terminology (`config.labels.*`) and currency

**Called by:** `POST /api/reports` → `src/api/reports.ts`, Reports page in frontend

---

### 4. Knowledge Base (`knowledge-base`)

**File:** `src/agent/knowledge-base/index.ts` (214 lines)

**Purpose:** RAG (Retrieval-Augmented Generation) agent that searches uploaded business documents and answers questions grounded in company knowledge.

**Input:**
```typescript
{
  action: 'query' | 'ingest' | 'delete' | 'list',
  question?: string,              // For 'query'
  documents?: Array<{             // For 'ingest'
    key: string,
    content: string,
    title: string,
    filename: string,
    category?: string,
    chunkIndex?: number,
  }>,
  keys?: string[],                // For 'delete'
}
```

**Output:**
```typescript
{
  answer?: string,
  sources?: string[],
  ingested?: number,
  deleted?: number,
  documents?: unknown[],
  success: boolean,
}
```

**Actions:**
- **query**: Semantic search → retrieve top 5 chunks (similarity ≥ 0.65) → LLM synthesizes answer with source citations
- **ingest**: Upsert documents into vector store with metadata (title, filename, category, upload date)
- **delete**: Remove documents by key
- **list**: Broad search to enumerate stored documents (deduplicated by filename)

**Vector namespace:** `"knowledge-base"`

**Called by:** `POST /api/documents/query` and Admin Console Knowledge Base tab

---

## Agent Communication Pattern

Agents can call each other directly:

```typescript
import insightsAnalyzer from '@agent/insights-analyzer';
import reportGenerator from '@agent/report-generator';
import knowledgeBase from '@agent/knowledge-base';

// From within another agent's handler:
const insights = await insightsAnalyzer.run({
  analysis: 'demand-forecast',
  timeframeDays: 14,
});

const report = await reportGenerator.run({
  reportType: 'sales-summary',
  format: 'markdown',
});

const answer = await knowledgeBase.run({
  action: 'query',
  question: 'What is our return policy?',
});
```

## Shared Dependencies

All agents share:

| Dependency | Import | Purpose |
|-----------|--------|---------|
| `@lib/ai` | `getModel()` | Centralized LLM model selection (default: `gpt-4o-mini`) |
| `@lib/config` | `config` | Environment-driven company name, currency, labels |
| `@db/index` | `db, products, orders, ...` | Drizzle ORM database client + schema tables |
| `ai` | `generateText`, `generateObject` | Vercel AI SDK for LLM calls |
| `zod` | `z` | Schema validation for inputs/outputs |

## Adding a New Agent

1. Create `src/agent/<name>/index.ts`
2. Define Zod input/output schemas
3. Use `createAgent('<name>', { schema, handler })` and export default
4. Wire up an API route in `src/api/` to expose it
5. The Agentuity build system auto-discovers agents from `src/agent/*/index.ts`
