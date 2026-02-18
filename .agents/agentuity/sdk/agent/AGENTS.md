# Agents Folder Guide

This folder contains AI agents for your Agentuity application. Each agent is organized in its own subdirectory.

## Generated Types

The `src/generated/` folder contains auto-generated TypeScript files:

- `registry.ts` - Agent registry with strongly-typed agent definitions and schema types
- `routes.ts` - Route registry for API, WebSocket, and SSE endpoints
- `app.ts` - Application entry point (regenerated on every build)

**Important:** Never edit files in `src/generated/` - they are overwritten on every build.

Import generated types in your agents:

```typescript
import type { HelloInput, HelloOutput } from '../generated/registry';
```

## Directory Structure

Each agent folder must contain:

- **index.ts** (required) - Agent definition with schema and handler

Example structure:

```
src/agent/
├── business-assistant/
│   └── index.ts
├── insights-analyzer/
│   └── index.ts
├── report-generator/
│   └── index.ts
├── knowledge-base/
│   └── index.ts
└── (generated files in src/generated/)
```

**Note:** HTTP routes are defined separately in `src/api/` - see the API folder guide for details.

## Creating an Agent

### Basic Agent (index.ts)

```typescript
import { createAgent } from '@agentuity/runtime';
import { z } from 'zod';

const inputSchema = z.object({
  message: z.string().min(1),
});

const outputSchema = z.object({
  reply: z.string(),
  success: z.boolean(),
});

export default createAgent('my-agent', {
  schema: { input: inputSchema, output: outputSchema },
  handler: async (ctx, input) => {
    ctx.logger.info(`Processing: ${input.message}`);
    return { reply: `Processed: ${input.message}`, success: true };
  },
});
```

### Agent with AI (LLM)

This project uses the Vercel AI SDK (`ai` package) with OpenAI via `@ai-sdk/openai`.
The model is centralized in `src/lib/ai.ts`.

```typescript
import { createAgent } from '@agentuity/runtime';
import { generateText } from 'ai';
import { z } from 'zod';
import { getModel } from '@lib/ai';
import { config } from '@lib/config';

export default createAgent('my-ai-agent', {
  schema: {
    input: z.object({ question: z.string() }),
    output: z.object({ answer: z.string() }),
  },
  handler: async (ctx, input) => {
    const { text } = await generateText({
      model: getModel(),
      system: `You are ${config.companyName}'s assistant.`,
      prompt: input.question,
    });

    return { answer: text };
  },
});
```

### Agent with Structured Output

Use `generateObject` for structured, schema-validated LLM output:

```typescript
import { generateObject } from 'ai';
import { z } from 'zod';
import { getModel } from '@lib/ai';

const resultSchema = z.object({
  title: z.string(),
  severity: z.enum(['info', 'warning', 'critical']),
  description: z.string(),
  confidence: z.number().min(0).max(1),
});

const { object } = await generateObject({
  model: getModel(),
  schema: resultSchema,
  system: 'You are a business analyst.',
  prompt: `Analyze: ${JSON.stringify(data)}`,
});
```

### Agent with Thread Memory

Use `ctx.thread.state` for multi-turn conversation persistence:

```typescript
handler: async (ctx, input) => {
  type ChatMessage = { role: string; content: string };
  const history: ChatMessage[] =
    (await ctx.thread?.state?.get<ChatMessage[]>('messages')) ?? [];

  const { text } = await generateText({
    model: getModel(),
    system: 'You are a helpful assistant.',
    messages: [
      ...history.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      { role: 'user' as const, content: input.message },
    ],
  });

  if (ctx.thread) {
    await ctx.thread.state.push('messages', { role: 'user', content: input.message });
    await ctx.thread.state.push('messages', { role: 'assistant', content: text });
  }

  return { reply: text };
};
```

### Agent with Database Access

Agents have direct access to the Drizzle ORM database:

```typescript
import { db, products, orders, customers } from '@db/index';
import { sql, eq, desc, gte } from 'drizzle-orm';

handler: async (ctx, input) => {
  // Count query
  const [count] = await db
    .select({ count: sql<number>`count(*)` })
    .from(products)
    .where(eq(products.isActive, true));

  // Relational query
  const recentOrders = await db.query.orders.findMany({
    with: { customer: true, status: true },
    orderBy: (o, { desc }) => [desc(o.createdAt)],
    limit: 5,
  });

  // Aggregation query
  const topProducts = await db
    .select({
      name: products.name,
      totalSold: sql<number>`sum(${orderItems.quantity})`,
      totalRevenue: sql<number>`sum(${orderItems.totalAmount})`,
    })
    .from(orderItems)
    .innerJoin(products, eq(orderItems.productId, products.id))
    .groupBy(products.name)
    .orderBy(sql`sum(${orderItems.totalAmount}) desc`)
    .limit(10);

  return { count: count.count, recentOrders, topProducts };
};
```

### Agent with Vector Search (RAG)

Use `ctx.vector` for semantic search over documents:

```typescript
handler: async (ctx, input) => {
  // Search
  const results = await ctx.vector.search<DocMetadata>(NAMESPACE, {
    query: input.question,
    limit: 5,
    similarity: 0.65,
  });

  // Fetch full docs
  const keys = results.map((r) => r.key);
  const fullDocs = await ctx.vector.getMany<DocMetadata>(NAMESPACE, ...keys);

  // Upsert
  await ctx.vector.upsert(NAMESPACE, {
    key: 'doc-1',
    document: 'Full text content here',
    metadata: { title: 'My Document', category: 'general' },
  });

  // Delete
  await ctx.vector.delete(NAMESPACE, 'doc-1', 'doc-2');
};
```

## Agent Context (ctx)

The handler receives a context object with:

- **ctx.app** - Application state (appName, version, startedAt, config from createApp)
- **ctx.config** - Agent-specific config (from setup return value, fully typed)
- **ctx.logger** - Structured logger (info, warn, error, debug, trace)
- **ctx.tracer** - OpenTelemetry tracer for custom spans
- **ctx.sessionId** - Unique session identifier
- **ctx.kv** - Key-value storage
- **ctx.vector** - Vector storage for embeddings / RAG
- **ctx.stream** - Stream storage for real-time data
- **ctx.state** - In-memory request-scoped state (Map)
- **ctx.thread** - Thread information for multi-turn conversations
- **ctx.session** - Session information
- **ctx.waitUntil** - Schedule background tasks

## Environment-Driven Configuration

All agents use `src/lib/config.ts` for client-specific terminology:

```typescript
import { config } from '@lib/config';

// config.companyName    — "Business IQ" or client's name
// config.currency       — "USD", "KES", "EUR", etc.
// config.labels.product — "Product", "Item", "Ingredient", etc.
// config.labels.order   — "Order", "Ticket", "Work Order", etc.
```

**Never hardcode** company names, currency symbols, or business terms. Always use `config.*`.

## AI Model Configuration

All agents use `src/lib/ai.ts` for model selection:

```typescript
import { getModel } from '@lib/ai';

// Returns the configured OpenAI model (default: gpt-4o-mini)
// Override with AI_MODEL env var
const model = getModel();
// Or specify explicitly:
const model = getModel('gpt-4o');
```

## Calling Another Agent

```typescript
import otherAgent from '@agent/other-agent';

handler: async (ctx, input) => {
  const result = await otherAgent.run({ data: input.value });
  return { fromOther: result };
};
```

## Rules

- Each agent folder must contain `index.ts` (not `agent.ts`)
- The SDK discovers agents by scanning `src/agent/*/index.ts`
- `index.ts` must export default the agent instance
- The first argument to `createAgent()` is the agent name (must match folder name)
- Input/output schemas use Zod (not `@agentuity/schema`)
- Use `ctx.logger` for logging, never `console.log`
- Use `config.*` for all client-specific terminology
- Use `getModel()` for all LLM calls — never hardcode model IDs
- Import agents directly to call them: `import agent from '@agent/name'`
- Database schema is in `src/db/schema.ts`, client is `db` from `@db/index`
