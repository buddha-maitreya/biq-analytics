# Agentuity SDK Reference

Comprehensive reference for the Agentuity TypeScript/JavaScript SDK — method signatures, parameters, return values, and examples.

---

## Table of Contents

- [Application Entry Point](#application-entry-point)
- [Agent Creation](#agent-creation)
- [Schema Validation](#schema-validation)
- [Agent Handler](#agent-handler)
- [Context API](#context-api)
- [Router & Routes](#router--routes)
- [Agent Communication](#agent-communication)
- [Storage APIs](#storage-apis)
- [Logging](#logging)
- [Telemetry](#telemetry)
- [Session & Thread Management](#session--thread-management)
- [Evaluations](#evaluations)
- [Event System](#event-system)
- [Advanced Features](#advanced-features)

---

## Application Entry Point

Every Agentuity v1 application starts with `createApp()`.

### createApp

`createApp(config?: AppConfig): App`

**Parameters**

- `config` (optional):
  - `cors`: Override default CORS settings
  - `services`: Override default services (KV, Vector, Stream)
    - `useLocal`: Use local services for development (default: false)
    - `keyvalue`: Custom KeyValueStorage implementation
    - `vector`: Custom VectorStorage implementation
    - `stream`: Custom StreamStorage implementation
  - `setup`: Async function called before server starts, returns app state available via `ctx.app`
  - `shutdown`: Async cleanup function called when server stops, receives app state

**Return Value**

```typescript
interface App {
  router: Hono;           // The main application router
  server: Server;         // Server instance with .url property
  logger: Logger;         // Application-level logger
}
```

Also provides `addEventListener()` and `removeEventListener()` for lifecycle events.

**Basic Example**

```typescript
import { createApp } from '@agentuity/runtime';

const { server, logger } = await createApp();
logger.info(`Server running at ${server.url}`);
```

**With Configuration**

```typescript
import { createApp } from '@agentuity/runtime';

const { server, logger } = await createApp({
  cors: {
    origin: ['https://example.com'],
    credentials: true
  },
  services: {
    useLocal: true
  }
});
```

**With Setup and Shutdown**

```typescript
import { createApp } from '@agentuity/runtime';

const { server, logger } = await createApp({
  setup: async () => {
    const db = await connectDatabase();
    const redis = await connectRedis();
    return { db, redis };
  },
  shutdown: async (state) => {
    await state.db.close();
    await state.redis.quit();
  },
});

// In agents, access via ctx.app:
// ctx.app.db.query('SELECT * FROM users')
```

### Environment Variables

- `AGENTUITY_SDK_KEY` — SDK-level API key (used in development)
- `AGENTUITY_PROJECT_KEY` — Project-level API key (used when deployed)

```typescript
const apiEndpoint = process.env.API_ENDPOINT || 'https://api.example.com';
const openaiKey = process.env.OPENAI_API_KEY;
// Optional: use the AI Gateway without needing provider API keys
```

---

## Agent Creation

### createAgent

`createAgent(name: string, config: AgentConfig): AgentRunner`

**Parameters**

- `name`: Unique agent name within the project
- `config`:
  - `description` (optional): Human-readable description
  - `schema` (optional):
    - `input`: Input validation schema (Zod, Valibot, ArkType, or any StandardSchemaV1)
    - `output`: Output validation schema
    - `stream`: Enable streaming responses (boolean, defaults to false)
  - `handler`: The agent function `(ctx, input) => output`
  - `setup` (optional): Async function called once on app startup, returns agent-specific config accessible via `ctx.config`
  - `shutdown` (optional): Async cleanup function called on app shutdown

**Return Value — AgentRunner**

- `metadata`: Agent metadata (id, identifier, filename, version, name, description)
- `run(input?)`: Execute the agent with optional input
- `createEval(name, config)`: Create quality evaluations
- `addEventListener(eventName, callback)`: Attach lifecycle event listeners
- `removeEventListener(eventName, callback)`: Remove event listeners
- `validator(options?)`: Route validation middleware
- `inputSchema` (conditional): Present if input schema is defined
- `outputSchema` (conditional): Present if output schema is defined
- `stream` (conditional): Present if streaming is enabled

**To call agents from other agents:** `import otherAgent from '@agent/other'; otherAgent.run(input)`

**Example**

```typescript
import { createAgent } from '@agentuity/runtime';
import { z } from 'zod';

const agent = createAgent('GreetingAgent', {
  description: 'A simple greeting agent',
  schema: {
    input: z.object({
      message: z.string().min(1),
      userId: z.string().optional(),
    }),
    output: z.object({
      response: z.string(),
      timestamp: z.number(),
    }),
  },
  handler: async (ctx, input) => {
    ctx.logger.info(`Processing message from user: ${input.userId ?? 'anonymous'}`);
    return {
      response: `Hello! You said: ${input.message}`,
      timestamp: Date.now(),
    };
  },
});

export default agent;
```

### Agent Setup and Shutdown

```typescript
const agent = createAgent('CachedProcessor', {
  schema: {
    input: z.object({ key: z.string() }),
    output: z.object({ value: z.string() }),
  },
  setup: async (app) => {
    const cache = new Map<string, string>();
    const client = await initializeExternalService();
    return { cache, client };
  },
  shutdown: async (app, config) => {
    await config.client.disconnect();
    config.cache.clear();
  },
  handler: async (ctx, input) => {
    // ctx.config is fully typed from setup's return value
    const cached = ctx.config.cache.get(input.key);
    if (cached) return { value: cached };

    const value = await ctx.config.client.fetch(input.key);
    ctx.config.cache.set(input.key, value);
    return { value };
  },
});

export default agent;
```

### registerShutdownHook

`registerShutdownHook(hook: () => Promise<void> | void): () => void`

Register cleanup functions that run during graceful shutdown. Runs after the app's `shutdown` callback and agent shutdowns, in LIFO order.

**Returns** an unregister function to remove the hook.

```typescript
import { registerShutdownHook } from '@agentuity/runtime';

let dbPool: Pool | null = null;

export function getDatabase() {
  if (!dbPool) {
    dbPool = createPool();
    registerShutdownHook(async () => {
      if (dbPool) {
        await dbPool.end();
        dbPool = null;
      }
    });
  }
  return dbPool;
}
```

### agent.validator()

Creates Hono middleware for type-safe request validation using the agent's schema.

```typescript
agent.validator(): MiddlewareHandler
agent.validator(options: { output: Schema }): MiddlewareHandler
agent.validator(options: { input: Schema; output?: Schema }): MiddlewareHandler
```

Returns 400 Bad Request with validation error details if input validation fails.

```typescript
import { createRouter } from '@agentuity/runtime';
import agent from './agent';

const router = createRouter();

// Use agent's schema
router.post('/', agent.validator(), async (c) => {
  const data = c.req.valid('json'); // Fully typed
  return c.json(data);
});

// Custom schema override
router.post('/custom',
  agent.validator({ input: z.object({ custom: z.string() }) }),
  async (c) => {
    const data = c.req.valid('json');
    return c.json(data);
  }
);
```

---

## Schema Validation

### StandardSchema Support

The SDK supports any validation library implementing StandardSchemaV1:

- **Zod** — Most popular, recommended for new projects
- **Valibot** — Lightweight alternative
- **ArkType** — TypeScript-first validation

**Example with Zod:**

```typescript
const agent = createAgent('UserCreator', {
  schema: {
    input: z.object({
      email: z.string().email(),
      age: z.number().min(0).max(120),
      preferences: z.object({
        newsletter: z.boolean(),
        notifications: z.boolean(),
      }).optional(),
    }),
    output: z.object({
      userId: z.string().uuid(),
      created: z.date(),
    }),
  },
  handler: async (ctx, input) => {
    ctx.logger.info(`Creating user: ${input.email}`);
    return { userId: crypto.randomUUID(), created: new Date() };
  },
});
```

**Validation Behavior:**

- **Input validation**: Automatic before handler execution. Error thrown if fails; handler not called.
- **Output validation**: Automatic after handler execution. Error thrown if fails before returning.
- **Error messages**: Detailed information about what failed and why.

### Type Inference

TypeScript automatically infers types from schemas — full autocomplete and compile-time type checking:

```typescript
const agent = createAgent('SearchAgent', {
  schema: {
    input: z.object({
      query: z.string(),
      filters: z.object({
        category: z.enum(['tech', 'business', 'sports']),
        limit: z.number().default(10),
      }),
    }),
    output: z.object({
      results: z.array(z.object({
        id: z.string(),
        title: z.string(),
        score: z.number(),
      })),
      total: z.number(),
    }),
  },
  handler: async (ctx, input) => {
    // TypeScript knows exact shapes of input and return
    return {
      results: [{ id: '1', title: 'Example', score: 0.95 }],
      total: 1,
    };
  },
});

// When calling from another agent:
import searchAgent from '@agent/search';
const result = await searchAgent.run({
  query: 'agentic AI',
  filters: { category: 'tech', limit: 5 },
});
// result is fully typed
```

---

## Agent Handler

### Handler Signature

```typescript
type AgentHandler<TInput, TOutput> = (
  ctx: AgentContext,
  input: TInput
) => Promise<TOutput> | TOutput;
```

**Key Differences from v0:**

| Aspect | v0 | v1 |
|--------|-----|-----|
| Parameters | `(request, response, context)` | `(ctx, input)` |
| Input access | `await request.data.json()` | Direct `input` parameter |
| Return pattern | `return response.json(data)` | `return data` |
| Validation | Manual | Automatic via schemas |
| Type safety | Manual types | Auto-inferred from schemas |

### Input Validation

Happens automatically before the handler executes. If validation fails, the handler is not called and an error is thrown.

### Return Values

Return data directly — no response builder methods needed:

```typescript
// Simple return
handler: async (ctx, input) => {
  return { sum: input.x + input.y };
}

// Error handling
handler: async (ctx, input) => {
  try {
    const data = await riskyOperation(input.id);
    return { data };
  } catch (error) {
    ctx.logger.error('Operation failed', { error });
    throw new Error('Failed to process request');
  }
}
```

Output is automatically validated against the output schema.

---

## Context API

### Context Properties

```typescript
interface AgentContext<TConfig = unknown, TAppState = unknown> {
  // Identifiers
  sessionId: string;                  // Unique ID for this execution
  current: {
    name: string;                     // Agent name from createAgent()
    agentId: string;                  // Stable across deployments
    id: string;                       // Changes each deployment
    filename: string;                 // Path to agent file
    version: string;                  // Changes when code changes
    description?: string;
    inputSchemaCode?: string;
    outputSchemaCode?: string;
  };

  // Configuration
  config: TConfig;                    // Agent-specific config from setup()
  app: TAppState;                     // App-wide state from createApp setup()

  // State Management
  session: Session;                   // Cross-request state
  thread: Thread;                     // Conversation state
  state: Map<string, unknown>;        // Request-scoped state

  // Storage Services
  kv: KeyValueStorage;                // Key-value storage
  vector: VectorStorage;              // Vector database
  stream: StreamStorage;              // Stream storage

  // Observability
  logger: Logger;                     // Structured logging
  tracer: Tracer;                     // OpenTelemetry tracing

  // Lifecycle
  waitUntil(promise: Promise<void> | (() => void | Promise<void>)): void;
}
```

**Example:**

```typescript
handler: async (ctx, input) => {
  ctx.logger.info(`Session ID: ${ctx.sessionId}`);
  await ctx.kv.set('cache', 'last-query', input.query);
  ctx.state.set('startTime', Date.now());

  // Call another agent
  import enrichmentAgent from '@agent/enrichment';
  const enrichedData = await enrichmentAgent.run({ text: input.query });

  ctx.session.state.set('queryCount',
    (ctx.session.state.get('queryCount') as number || 0) + 1
  );

  return { result: enrichedData.output };
}
```

### Background Tasks (waitUntil)

`waitUntil(callback: Promise<void> | (() => void | Promise<void>)): void`

Execute background tasks that don't block the response:

```typescript
handler: async (ctx, input) => {
  const responseData = { status: 'received', timestamp: Date.now() };

  ctx.waitUntil(async () => {
    await logMessageToDatabase(input.userId, input.message);
  });

  ctx.waitUntil(async () => {
    await sendPushNotification(input.userId, input.message);
  });

  return responseData; // Returns immediately
}
```

**Use Cases:** logging, analytics, push notifications, DB cleanup, third-party API calls, background data processing.

---

## Storage APIs

Five storage options: Key-Value, Vector, Database (SQL), Object (S3), and Stream.

### Key-Value Storage (`ctx.kv`)

#### get

`get(name: string, key: string): Promise<DataResult>`

```typescript
const result = await ctx.kv.get<{ theme: string }>('user-preferences', 'user-123');
if (result.exists) {
  ctx.logger.info('User preferences:', result.data);
}
```

Returns `DataResult<T>`: `{ exists: boolean, data: T, contentType: string }`

#### set

`set(name: string, key: string, value: ArrayBuffer | string | Json, ttl?: number): Promise<void>`

```typescript
await ctx.kv.set('user-preferences', 'user-123', { theme: 'dark' });
await ctx.kv.set('session', 'user-123', 'active', { ttl: 3600 }); // TTL min 60s
```

#### delete

`delete(name: string, key: string): Promise<void>`

```typescript
await ctx.kv.delete('user-preferences', 'user-123');
```

#### search

`search<T>(name: string, keyword: string): Promise<Record<string, KeyValueItemWithMetadata<T>>>`

```typescript
const matches = await ctx.kv.search<{ theme: string }>('preferences', 'user-');
for (const [key, item] of Object.entries(matches)) {
  ctx.logger.info('Found', { key, value: item.value, size: item.size });
}
```

Returns items with: `value`, `contentType`, `size`, `created_at`, `updated_at`.

#### Other KV Methods

- `getKeys(name: string): Promise<string[]>` — All keys in a namespace
- `getNamespaces(): Promise<string[]>` — All namespace names
- `getStats(name: string): Promise<KeyValueStats>` — Stats for a namespace (`sum`, `count`, `createdAt?`, `lastUsedAt?`)
- `getAllStats(): Promise<Record<string, KeyValueStats>>` — Stats for all namespaces
- `createNamespace(name: string): Promise<void>` — Create a namespace
- `deleteNamespace(name: string): Promise<void>` — Delete a namespace (irreversible)

### Vector Storage (`ctx.vector`)

#### upsert

`upsert(name: string, ...documents: VectorUpsertParams[]): Promise<string[]>`

```typescript
const ids = await ctx.vector.upsert(
  'product-descriptions',
  { key: 'chair-001', document: 'Ergonomic office chair with lumbar support', metadata: { category: 'furniture' } },
  { key: 'headphones-001', document: 'Wireless noise-cancelling headphones', metadata: { category: 'electronics' } }
);

// With embeddings
const ids2 = await ctx.vector.upsert(
  'product-embeddings',
  { key: 'embed-123', embeddings: [0.1, 0.2, 0.3, 0.4], metadata: { productId: '123' } }
);
```

#### search

`search(name: string, params: VectorSearchParams): Promise<VectorSearchResult[]>`

- `query` (string, required): Text query for semantic search
- `limit` (number, optional): Max results
- `similarity` (number, optional): Min similarity threshold (0.0–1.0)
- `metadata` (object, optional): Metadata filters

```typescript
const results = await ctx.vector.search('product-descriptions', {
  query: 'comfortable office chair',
  limit: 5,
  similarity: 0.7,
  metadata: { category: 'furniture' }
});
```

#### get

`get(name: string, key: string): Promise<VectorSearchResult | null>`

```typescript
const vector = await ctx.vector.get('product-descriptions', 'chair-001');
```

#### delete

`delete(name: string, ...keys: string[]): Promise<number>`

```typescript
const deletedCount = await ctx.vector.delete('product-descriptions', 'chair-001', 'headphones-001');
```

### Database (Bun SQL)

Uses Bun's native SQL APIs. Agentuity auto-injects `DATABASE_URL`.

```typescript
import { sql } from 'bun';

// Basic queries
const users = await sql`SELECT * FROM users WHERE active = ${true}`;
await sql`INSERT INTO users (name, email) VALUES (${"Alice"}, ${"alice@example.com"})`;

// Transactions
await sql.begin(async (tx) => {
  await tx`UPDATE accounts SET balance = balance - ${amount} WHERE id = ${fromId}`;
  await tx`UPDATE accounts SET balance = balance + ${amount} WHERE id = ${toId}`;
});

// Dynamic queries
const users = await sql`
  SELECT * FROM users WHERE 1=1
  ${minAge ? sql`AND age >= ${minAge}` : sql``}
  ${active !== undefined ? sql`AND active = ${active}` : sql``}
`;

// Bulk insert
const newUsers = [
  { name: "Alice", email: "alice@example.com" },
  { name: "Bob", email: "bob@example.com" },
];
await sql`INSERT INTO users ${sql(newUsers)}`;

// Custom connections
import { SQL } from "bun";
const postgres = new SQL({ url: process.env.POSTGRES_URL, max: 20, idleTimeout: 30 });
const mysql = new SQL("mysql://user:pass@localhost:3306/mydb");
const sqlite = new SQL("sqlite://data/app.db");
```

### Object Storage (Bun S3)

Uses Bun's native S3 APIs. Agentuity auto-injects `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET`, `S3_ENDPOINT`.

```typescript
import { s3 } from 'bun';

// Reading
const file = s3.file('uploads/profile-123.jpg');
if (await file.exists()) {
  const text = await file.text();
  const json = await file.json();
  const bytes = await file.bytes();
}

// Writing
await s3.file('documents/readme.txt').write('Hello, world!', { type: 'text/plain' });
await s3.file('data.json').write(JSON.stringify({ name: 'John' }), { type: 'application/json' });

// Deleting
await s3.file('uploads/old-file.pdf').delete();

// Presigned URLs (synchronous)
const downloadUrl = s3.presign('uploads/document.pdf', { expiresIn: 3600, method: 'GET' });
const uploadUrl = s3.presign('uploads/new-file.pdf', { expiresIn: 3600, method: 'PUT' });

// File metadata
const stat = await s3.file('uploads/document.pdf').stat(); // { etag, lastModified, size, type }

// Listing
import { S3Client } from 'bun';
const objects = await S3Client.list({ prefix: 'uploads/', maxKeys: 100 });

// Streaming large files
const writer = s3.file('large-file.zip').writer({ partSize: 5 * 1024 * 1024 });
writer.write(chunk1);
writer.write(chunk2);
await writer.end();
```

### Stream Storage (`ctx.stream`)

#### create

`create(name: string, props?: StreamCreateProps): Promise<Stream>`

- `metadata`: Key-value pairs for searching
- `contentType`: Content type (defaults to `application/octet-stream`)
- `compress`: Enable gzip compression (defaults to `false`)

```typescript
interface Stream {
  id: string;
  url: string;
  bytesWritten: number;
  compressed: boolean;
  write(chunk: string | Uint8Array | ArrayBuffer | object): Promise<void>;
  close(): Promise<void>;
  getReader(): ReadableStream<Uint8Array>;
}
```

Streams are **read-many**, **re-readable**, **resumable** (HTTP Range), and **persistent**.

```typescript
const stream = await ctx.stream.create('user-export', {
  contentType: 'text/csv',
  metadata: { userId: input.userId, timestamp: Date.now() },
});

ctx.waitUntil(async () => {
  try {
    await stream.write('Name,Email\n');
    await stream.write('John,john@example.com\n');
  } finally {
    await stream.close();
  }
});

return { streamId: stream.id, streamUrl: stream.url };
```

#### get

`get(id: string): Promise<StreamInfo>` — Returns `{ id, name, metadata, url, sizeBytes }`.

#### download

`download(id: string): Promise<ReadableStream<Uint8Array>>` — Downloads stream content.

#### list

`list(params?: ListStreamsParams): Promise<ListStreamsResponse>`

- `name`: Filter by stream name
- `metadata`: Filter by metadata key-value pairs
- `limit`: Max streams (1–1000, default 100)
- `offset`: Number to skip

Returns `{ success, message?, streams: StreamInfo[], total }`.

#### delete

`delete(id: string): Promise<void>` — Deletes a stream by ID.

---

## Logging

### Logger Interface

```typescript
interface Logger {
  trace(message: unknown, ...args: unknown[]): void;
  debug(message: unknown, ...args: unknown[]): void;
  info(message: unknown, ...args: unknown[]): void;
  warn(message: unknown, ...args: unknown[]): void;
  error(message: unknown, ...args: unknown[]): void;
  fatal(message: unknown, ...args: unknown[]): never;  // Terminates process
  child(opts: Record<string, unknown>): Logger;         // Child logger with extra context
}
```

```typescript
ctx.logger.info('Request processed', { requestId: '123' });
ctx.logger.error('Failed to process', error);
ctx.logger.fatal('Critical failure', { error, context }); // Process exits

const requestLogger = ctx.logger.child({ requestId: '123', userId: '456' });
requestLogger.info('Processing request'); // Includes requestId & userId
```

---

## Telemetry

OpenTelemetry tracing via `ctx.tracer`:

```typescript
ctx.tracer.startActiveSpan('process-data', async (span) => {
  try {
    span.setAttribute('userId', '123');
    const result = await processData();
    span.addEvent('data-processed', { itemCount: result.length });
    return result;
  } catch (error) {
    span.recordException(error);
    span.setStatus({ code: SpanStatusCode.ERROR });
    throw error;
  } finally {
    span.end();
  }
});
```

---

## Agent Communication

Import other agents directly with full type safety:

```typescript
import otherAgent from '@agent/other';
const result = await otherAgent.run(input);
```

**Features:** type-safe calls, automatic validation, IDE autocomplete, error handling.

### Calling Multiple Agents in Parallel

```typescript
const [webResults, dbResults, cacheResults] = await Promise.all([
  webSearchAgent.run({ query: input.query }),
  databaseAgent.run({ query: input.query }),
  cacheAgent.run({ key: input.query }),
]);
```

### Error Handling

```typescript
try {
  const result = await externalService.run({ userId: input.userId });
  return { success: true, data: result };
} catch (error) {
  ctx.logger.error('External service failed', { error });
  const cached = await ctx.kv.get('user-cache', input.userId);
  if (cached.exists) return { success: true, data: cached.data };
  return { success: false, data: null };
}
```

---

## Router & Routes

### Creating Routes

```typescript
// src/api/index.ts
import { createRouter } from '@agentuity/runtime';

const router = createRouter();

router.get('/', (c) => c.json({ message: 'Hello from route' }));

export default router;
```

### Router Context

| Feature | Router Context (Hono) | Agent Context |
|---------|----------------------|---------------|
| Type | Hono Context | `AgentContext` |
| Used in | `src/api/index.ts` | `agent.ts` files |
| Request | `c.req` (Hono Request) | Direct `input` parameter |
| Response | Builder methods (`.json()`, `.text()`) | Direct returns |
| Services | `c.var.kv`, `c.var.logger`, etc. | `ctx.kv`, `ctx.logger`, etc. |
| Agent calling | `agent.run()` | `agent.run()` |
| State | Via Hono middleware | Built-in (`.state`, `.session`, `.thread`) |

### Accessing Services — Quick Reference

| Service | In Agents | In Routes | In Standalone |
|---------|-----------|-----------|---------------|
| Key-Value | `ctx.kv` | `c.var.kv` | `ctx.kv` |
| Vector | `ctx.vector` | `c.var.vector` | `ctx.vector` |
| Streams | `ctx.stream` | `c.var.stream` | `ctx.stream` |
| Logger | `ctx.logger` | `c.var.logger` | `ctx.logger` |
| Tracer | `ctx.tracer` | `c.var.tracer` | `ctx.tracer` |
| State | `ctx.state` | `c.var.state` | `ctx.state` |
| Thread | `ctx.thread` | `c.var.thread` | `ctx.thread` |
| Session | `ctx.session` | `c.var.session` | `ctx.session` |

### Standalone Context

For Discord bots, CLI tools, or queue workers:

```typescript
import { createApp, createAgentContext } from '@agentuity/runtime';

await createApp();

const ctx = createAgentContext();
await ctx.invoke(async () => {
  await ctx.kv.set('cache', 'key', { data: 'value' });
  ctx.logger.info('Data cached from standalone context');
});
```

### External Backends (Next.js, Express)

Create authenticated routes in Agentuity that expose storage, then call via HTTP from external backends.

### HTTP Methods

```typescript
router.get('/users', (c) => c.json({ users: [] }));
router.get('/users/:id', (c) => c.json({ userId: c.req.param('id') }));
router.post('/users', async (c) => c.json({ created: true, user: await c.req.json() }));
router.put('/users/:id', async (c) => { /* ... */ });
router.patch('/users/:id', async (c) => { /* ... */ });
router.delete('/users/:id', (c) => c.json({ deleted: true, id: c.req.param('id') }));

// Calling agents from routes
import processorAgent from '@agent/processor';
router.post('/process', processorAgent.validator(), async (c) => {
  const input = c.req.valid('json');
  const result = await processorAgent.run({ data: input.data });
  return c.json(result);
});
```

### Specialized Routes

#### WebSocket Routes

```typescript
import { createRouter, websocket } from '@agentuity/runtime';
import chatAgent from '@agent/chat';

const router = createRouter();

router.get('/chat', websocket((c, ws) => {
  ws.onOpen((event) => {
    ws.send(JSON.stringify({ type: 'connected' }));
  });
  ws.onMessage(async (event) => {
    const message = JSON.parse(event.data);
    const response = await chatAgent.run({ message: message.text });
    ws.send(JSON.stringify({ type: 'response', data: response }));
  });
  ws.onClose((event) => {
    c.var.logger.info('WebSocket disconnected');
  });
}));
```

#### Server-Sent Events (SSE)

```typescript
import { createRouter, sse } from '@agentuity/runtime';

router.get('/updates', sse(async (c, stream) => {
  await stream.write({ type: 'connected' });
  const updates = await longRunningAgent.run({ task: 'process' });
  for (const update of updates) {
    await stream.write({ type: 'progress', data: update });
  }
  stream.onAbort(() => c.var.logger.info('Client disconnected'));
}));
```

#### Stream Routes

```typescript
import { createRouter, stream } from '@agentuity/runtime';

router.post('/data', stream(async (c) => {
  return new ReadableStream({
    async start(controller) {
      const data = await dataGenerator.run({ query: 'all' });
      for (const chunk of data) {
        controller.enqueue(new TextEncoder().encode(JSON.stringify(chunk) + '\n'));
      }
      controller.close();
    },
  });
}));
```

#### Cron Routes

```typescript
import { createRouter, cron } from '@agentuity/runtime';

// Run daily at 9am
router.post('/daily-report', cron('0 9 * * *', async (c) => {
  const report = await reportGenerator.run({ type: 'daily', date: new Date().toISOString() });
  await c.var.kv.set('reports', `daily-${Date.now()}`, report);
  return c.json({ success: true });
}));

// Run every 5 minutes
router.post('/health-check', cron('*/5 * * * *', async (c) => {
  await healthCheck.run({});
  return c.json({ checked: true });
}));
```

### Route Parameters

```typescript
// Path params
router.get('/posts/:postId/comments/:commentId', (c) => {
  return c.json({ postId: c.req.param('postId'), commentId: c.req.param('commentId') });
});

// Query params
router.get('/search', (c) => {
  const query = c.req.query('q');
  const limit = c.req.query('limit') || '10';
  return c.json({ query, limit: parseInt(limit) });
});

// Request headers
router.get('/protected', (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader) return c.json({ error: 'Unauthorized' }, 401);
  return c.json({ authorized: true });
});
```

---

## Session & Thread Management

### Sessions

```typescript
interface Session {
  id: string;
  thread: Thread;
  state: Map<string, unknown>;      // Session-scoped persistent state
  addEventListener(eventName: 'completed', callback): void;
  removeEventListener(eventName: 'completed', callback): void;
}
```

```typescript
handler: async (ctx, input) => {
  const count = (ctx.session.state.get('messageCount') as number) || 0;
  ctx.session.state.set('messageCount', count + 1);
  ctx.session.state.set('lastMessage', input.message);
}
```

### Threads

```typescript
interface Thread {
  id: string;
  state: Map<string, unknown>;      // Thread-scoped state (async methods)
  addEventListener(eventName: 'destroyed', callback): void;
  removeEventListener(eventName: 'destroyed', callback): void;
  destroy(): Promise<void>;
}
```

```typescript
handler: async (ctx, input) => {
  const history = (await ctx.thread.state.get<string[]>('history')) || [];
  history.push(input.message);
  await ctx.thread.state.set('history', history);
}
```

### Three Levels of State

| Level | Access | Scope | Persistence | Sync/Async |
|-------|--------|-------|-------------|------------|
| Request | `ctx.state` | Current request only | Cleared after handler | Sync |
| Thread | `ctx.thread.state` | Across requests in same thread | Until thread destroyed | **Async** |
| Session | `ctx.session.state` | Across all threads in session | Survives thread destruction | Sync |

---

## Evaluations

Evals assess agent quality and performance. Defined in `eval.ts` next to `agent.ts`, using **named exports**.

```
src/agent/my-agent/
├── agent.ts       # Agent definition
└── eval.ts        # Evals with named exports
```

### Creating Evals

```typescript
// src/agent/qa-agent/eval.ts
import agent from './agent';

export const confidenceEval = agent.createEval('confidence-check', {
  description: 'Ensures confidence is above threshold',
  handler: async (ctx, input, output) => {
    const passed = output.confidence >= 0.8;
    return {
      passed,
      reason: passed ? 'Confidence acceptable' : 'Confidence too low',
      metadata: { confidence: output.confidence, threshold: 0.8 },
    };
  },
});

export const qualityEval = agent.createEval('quality-score', {
  description: 'Overall quality score',
  handler: async (ctx, input, output) => {
    let score = 0;
    if (output.answer.length > 20) score += 0.3;
    if (output.confidence > 0.8) score += 0.4;
    if (output.answer.includes(input.query)) score += 0.3;

    return {
      passed: score >= 0.7,
      score,
      reason: score >= 0.7 ? 'High quality' : 'Below threshold',
    };
  },
});
```

### Eval Result Types

```typescript
type EvalRunResult =
  | { passed: boolean; reason?: string; score?: number; metadata?: object }
  | { success: false; passed: false; error: string; reason?: string; metadata?: object };
```

### Execution Flow

1. Agent handler executes and returns output
2. Output validated against schema
3. Agent emits `completed` event
4. All evals run via `waitUntil()` (non-blocking)
5. Results sent to eval tracking service
6. Response returned to caller without waiting for evals

---

## Event System

### Agent Events

```typescript
agent.addEventListener('started', (eventName, agent, ctx) => { /* ... */ });
agent.addEventListener('completed', (eventName, agent, ctx) => { /* ... */ });
agent.addEventListener('errored', (eventName, agent, ctx, error) => { /* ... */ });
```

### App Events

```typescript
app.addEventListener('agent.started', (eventName, agent, ctx) => {});
app.addEventListener('agent.completed', (eventName, agent, ctx) => {});
app.addEventListener('agent.errored', (eventName, agent, ctx, error) => {});
app.addEventListener('session.started', (eventName, session) => {});
app.addEventListener('session.completed', (eventName, session) => {});
app.addEventListener('thread.created', (eventName, thread) => {});
app.addEventListener('thread.destroyed', (eventName, thread) => {});
```

### Removing Listeners

```typescript
const handler = (eventName, agent, ctx) => { /* ... */ };
agent.addEventListener('started', handler);
agent.removeEventListener('started', handler); // Must keep handler reference
```

---

## Advanced Features

### File Imports

Files are processed at build time and embedded in the agent bundle — no disk I/O at runtime.

| Extension | Type | Description |
|-----------|------|-------------|
| `.json` | `object` | Parsed JSON |
| `.yaml`, `.yml` | `object` | Parsed YAML |
| `.toml` | `object` | Parsed TOML |
| `.sql` | `string` | SQL content |
| `.txt` | `string` | Text content |
| `.md` | `string` | Markdown |
| `.csv` | `string` | CSV data |
| `.xml` | `string` | XML content |
| `.html` | `string` | HTML content |
| `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.webp` | `string` | Base64 data URL |

```typescript
import config from './config.json';
import emailTemplate from './templates/welcome.txt';
import getUserQuery from './queries/getUser.sql';
import logo from './assets/logo.png';

handler: async (ctx, input) => {
  const apiUrl = config.api.baseUrl;
  const message = emailTemplate.replace('{{userId}}', input.userId);
  const user = await database.query(getUserQuery, [input.userId]);
  // ...
}
```

**TypeScript declarations:**

```typescript
// src/types/assets.d.ts
declare module '*.json' { const value: any; export default value; }
declare module '*.sql' { const value: string; export default value; }
declare module '*.png' { const value: string; export default value; }
declare module '*.txt' { const value: string; export default value; }
```

**Best Practices:** Keep files small (bundled with code), use for static data, use Object/Vector Storage for large/dynamic data.

---

## Migration from v0

| Aspect | v0 | v1 |
|--------|-----|-----|
| Agent definition | Function exports | `createAgent('Name', { ... })` |
| Handler | `(request, response, context)` | `(ctx, input)` |
| Returns | `response.json()` | Direct returns with schema validation |
| Agent calls | `context.getAgent()` | `import agent from '@agent/name'; agent.run()` |
| File structure | Single agent file | `src/agent/` for agents, `src/api/` for routes |
| Context | `runId` | `sessionId`, plus `session`, `thread`, `state` |
| Package | `@agentuity/sdk` | `@agentuity/runtime` |
