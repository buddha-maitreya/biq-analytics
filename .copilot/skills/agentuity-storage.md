# Agentuity Storage Services

Comprehensive reference for all Agentuity storage types: Key-Value, Vector, Object (S3), Durable Streams, and Custom Storage.

---

## Storage Types Overview

| Storage Type | Use Case | Access in Agents | Access in Routes |
|---|---|---|---|
| Key-Value | Fast lookups, caching, configuration, rate limits | `ctx.kv` | `c.var.kv` |
| Vector | Semantic search, embeddings, RAG, recommendations | `ctx.vector` | `c.var.vector` |
| Object (S3) | Files, images, documents, media, backups | `import { s3 } from "bun"` | `import { s3 } from "bun"` |
| Durable Streams | Large exports, audit logs, streaming data | `ctx.stream` | `c.var.stream` |
| Database | Structured data, complex queries, transactions | Drizzle ORM | Drizzle ORM |

**Same API Everywhere** — The storage APIs are identical in agents (`ctx.*`), routes (`c.var.*`), and standalone (`createAgentContext()`).

---

## Key-Value Storage

Fast, ephemeral storage for caching, session data, and configuration.

### Basic Operations

```ts
import { createAgent } from '@agentuity/runtime';

const agent = createAgent('CacheManager', {
  handler: async (ctx, input) => {
    // Store with custom TTL (min 60s, max 90 days)
    await ctx.kv.set('cache', 'api-response', responseData, {
      ttl: 3600,  // 1 hour
      contentType: 'application/json',
    });

    // Store with default TTL (7 days)
    await ctx.kv.set('cache', 'user-prefs', { theme: 'dark' });

    // Store with no expiration
    await ctx.kv.set('config', 'feature-flags', { darkMode: true }, {
      ttl: null,  // never expires (0 also works)
    });

    // Retrieve
    const result = await ctx.kv.get('cache', 'api-response');
    if (result.exists) {
      // result.data, result.contentType, result.expiresAt
    }

    // Delete
    await ctx.kv.delete('sessions', input.sessionId);
  },
});
```

### TTL Semantics

| Value | Behavior |
|---|---|
| `undefined` | Keys expire after 7 days (default) |
| `null` or `0` | Keys never expire |
| `>= 60` | Custom TTL in seconds (min 60s, max 90 days / 7,776,000s) |

**Sliding Expiration**: When a key is read with less than 50% TTL remaining, expiration is automatically extended.

### Type Safety

```ts
const result = await ctx.kv.get<UserPreferences>('prefs', input.userId);
if (result.exists) {
  const theme = result.data.theme; // TypeScript knows the shape
}
```

### Additional Methods

```ts
// Search keys by keyword
const matches = await ctx.kv.search('cache', 'user-');

// List all keys in namespace
const keys = await ctx.kv.getKeys('cache');

// List all namespaces
const namespaces = await ctx.kv.getNamespaces();

// Get statistics
const stats = await ctx.kv.getStats('cache');
const allStats = await ctx.kv.getAllStats();
```

### Namespace Management

```ts
// Create namespace with default TTL
await ctx.kv.createNamespace('cache', {
  defaultTTLSeconds: 3600,
});

// Create namespace with no expiration
await ctx.kv.createNamespace('config', {
  defaultTTLSeconds: 0,
});

// Delete namespace (removes all keys — DESTRUCTIVE)
await ctx.kv.deleteNamespace('old-cache');
```

### TTL Strategy Guide

| Data Type | Recommended TTL |
|---|---|
| API cache | 5–60 minutes (300–3600s) |
| Session data | 24–48 hours (86400–172800s) |
| Rate limit counters | Until period reset |
| Feature flags | No TTL (persistent) |

### KV vs Built-in State

Use built-in state (`ctx.state`, `ctx.thread.state`, `ctx.session.state`) for data tied to active requests. Use KV when you need custom TTL, persistent data across sessions, or shared state across agents.

### Using in Routes

```ts
import { createRouter } from '@agentuity/runtime';

const router = createRouter();

router.get('/session/:id', async (c) => {
  const sessionId = c.req.param('id');
  const result = await c.var.kv.get('sessions', sessionId);
  if (!result.exists) return c.json({ error: 'Session not found' }, 404);
  return c.json({ session: result.data });
});
```

### Best Practices

- Use descriptive keys: `user:{userId}:prefs` instead of `u123`
- Set appropriate TTLs to prevent storage bloat
- Always check `result.exists` before accessing data
- Keep values small; use Object Storage for large files

---

## Vector Storage

Semantic search and retrieval for knowledge bases and RAG systems.

### Upserting Documents

```ts
const results = await ctx.vector.upsert('knowledge-base',
  {
    key: 'doc-1',
    document: 'Agentuity is an agent-native cloud platform',
    metadata: { category: 'platform', source: 'docs' },
    ttl: 86400 * 7,  // 7 days
  },
  {
    key: 'doc-2',
    document: 'Vector storage enables semantic search',
    metadata: { category: 'features', source: 'docs' },
    // No TTL: uses 30-day default
  }
);
// Returns: [{ key: 'doc-1', id: 'internal-id' }, ...]
```

**Upsert is idempotent**: using an existing key updates rather than duplicates.

With pre-computed embeddings:
```ts
await ctx.vector.upsert('custom-embeddings', {
  key: 'embedding-1',
  embeddings: [0.1, 0.2, 0.3, 0.4, ...],
  metadata: { source: 'external' },
  ttl: null,  // never expires
});
```

### TTL Semantics (Vector)

| Value | Behavior |
|---|---|
| `undefined` | Vectors expire after 30 days (default) |
| `null` or `0` | Vectors never expire |
| `>= 60` | Custom TTL in seconds (min 60s, max 90 days) |

### Searching

```ts
const results = await ctx.vector.search('knowledge-base', {
  query: 'What is an AI agent?',
  limit: 5,
  similarity: 0.7,  // minimum similarity threshold
  metadata: { category: 'platform' },  // filter by metadata
});

// Each result has: id, key, similarity, metadata, expiresAt
```

### Direct Retrieval

```ts
// Single item
const result = await ctx.vector.get('knowledge-base', 'doc-1');
if (result.exists) { /* result.data.id, .key, .metadata */ }

// Batch retrieval
const resultMap = await ctx.vector.getMany('knowledge-base', ...keys);
// Map<string, VectorSearchResultWithDocument>

// Check if namespace has vectors
const hasData = await ctx.vector.exists('knowledge-base');

// Delete vectors
await ctx.vector.delete('knowledge-base', 'doc-1', 'doc-2');
```

### Type Safety (Vector)

```ts
interface DocumentMetadata {
  title: string;
  category: 'guide' | 'api' | 'tutorial';
  author: string;
}

await ctx.vector.upsert<DocumentMetadata>('docs', {
  key: 'guide-1',
  document: 'Getting started with agents',
  metadata: { title: 'Getting Started', category: 'guide', author: 'team' },
});

const results = await ctx.vector.search<DocumentMetadata>('docs', {
  query: input.question,
});
const titles = results.map(r => r.metadata?.title);
```

### Simple RAG Example

```ts
import { createAgent } from '@agentuity/runtime';
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { s } from '@agentuity/schema';

const ragAgent = createAgent('RAG', {
  schema: {
    input: s.object({ question: s.string() }),
    output: s.object({ answer: s.string(), sources: s.array(s.string()) }),
  },
  handler: async (ctx, input) => {
    const results = await ctx.vector.search('knowledge-base', {
      query: input.question,
      limit: 3,
      similarity: 0.7,
    });

    if (results.length === 0) {
      return { answer: "I couldn't find relevant information.", sources: [] };
    }

    const context = results.map(r => r.metadata?.content || '').join('\n\n');

    const { text } = await generateText({
      model: openai('gpt-5-mini'),
      prompt: `Answer based on this context:\n\n${context}\n\nQuestion: ${input.question}`,
    });

    return { answer: text, sources: results.map(r => r.key) };
  },
});
```

### Best Practices (Vector)

- Include context in documents so they're meaningful when retrieved
- Use descriptive metadata for filtering and identification
- Batch upserts (100–500 documents) for performance
- Combine `search` for finding + `getMany` for fetching full details

---

## Object Storage (S3)

Durable file storage using Bun's native S3 APIs. Credentials (`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET`, `S3_ENDPOINT`) are auto-injected by Agentuity.

### Quick Start

```ts
import { s3 } from "bun";

// Create file reference
const file = s3.file("documents/report.pdf");

// Write content
await file.write("Hello, World!");
await file.write(jsonData, { type: "application/json" });

// Read content
const text = await file.text();
const json = await file.json();
const bytes = await file.bytes();

// Check existence and delete
if (await file.exists()) {
  await file.delete();
}
```

### Using in Agents

```ts
import { createAgent } from '@agentuity/runtime';
import { s3 } from "bun";

const agent = createAgent('FileProcessor', {
  handler: async (ctx, input) => {
    const file = s3.file(`uploads/${input.userId}/data.json`);
    if (!(await file.exists())) return { error: "File not found" };
    const data = await file.json();
    return { data };
  },
});
```

### Using in Routes

```ts
import { createRouter } from '@agentuity/runtime';
import { s3 } from "bun";

const router = createRouter();

// File upload
router.post('/upload/:filename', async (c) => {
  const filename = c.req.param('filename');
  const file = s3.file(`uploads/${filename}`);
  const buffer = await c.req.arrayBuffer();
  await file.write(new Uint8Array(buffer), {
    type: c.req.header('content-type') || 'application/octet-stream',
  });
  return c.json({ success: true, url: file.presign({ expiresIn: 3600 }) });
});

// File download (302 redirect to S3)
router.get('/download/:filename', async (c) => {
  const file = s3.file(`uploads/${c.req.param('filename')}`);
  if (!(await file.exists())) return c.json({ error: 'Not found' }, 404);
  return new Response(file); // Returns 302 redirect to presigned URL
});
```

### Presigned URLs

```ts
import { s3 } from "bun";

// Download URL (default: GET, 24 hours)
const downloadUrl = s3.presign("uploads/document.pdf", { expiresIn: 3600 });

// Upload URL
const uploadUrl = s3.presign("uploads/new-file.pdf", {
  method: "PUT",
  expiresIn: 900,
  type: "application/pdf",
});
```

### Custom S3 Clients

```ts
import { S3Client } from "bun";

// Cloudflare R2
const r2 = new S3Client({
  accessKeyId: process.env.R2_ACCESS_KEY,
  secretAccessKey: process.env.R2_SECRET_KEY,
  bucket: "my-bucket",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
});

// AWS S3
const aws = new S3Client({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  bucket: "my-bucket",
  region: "us-east-1",
});
```

For complete API docs: [Bun S3 documentation](https://bun.sh/docs/runtime/s3)

---

## Durable Streams

Streaming storage for large exports, audit logs, and real-time data. Write-once, read-many pattern — once closed, content is immutable and accessible via URL.

### Why Durable Streams?

- **Refresh-safe**: If someone refreshes mid-stream, the URL still works
- **Background processing**: Return URL immediately, write data with `ctx.waitUntil()`
- **Shareable URLs**: A stream is just a URL, shareable across devices
- **Durable artifacts**: Once closed, immutable and accessible until deleted

### Creating Streams

```ts
const stream = await ctx.stream.create('export', {
  contentType: 'text/csv',
  compress: true,       // optional gzip compression
  metadata: { userId: input.userId },
  ttl: 86400 * 7,       // 7 days
});

// stream.id, stream.url, stream.bytesWritten
```

### TTL Semantics (Streams)

| Value | Behavior |
|---|---|
| `undefined` | Streams expire after 30 days (default) |
| `null` or `0` | Streams never expire |
| `>= 60` | Custom TTL in seconds (min 60s, max 90 days) |

### Writing Data

```ts
const stream = await ctx.stream.create('export', { contentType: 'text/csv' });

await stream.write('Name,Email,Created\n');
for (const user of input.users) {
  await stream.write(`${user.name},${user.email},${user.created}\n`);
}
await stream.close(); // ALWAYS close streams manually

return { url: stream.url };
```

### Background Processing

```ts
const stream = await ctx.stream.create('report', { contentType: 'application/json' });
const response = { streamUrl: stream.url };

ctx.waitUntil(async () => {
  const data = await fetchLargeDataset(input.query);
  await stream.write(JSON.stringify(data, null, 2));
  await stream.close();
});

return response; // Returns immediately
```

### Managing Streams

```ts
// List streams
const result = await ctx.stream.list({
  namespace: 'export',
  metadata: { userId: input.userId },
  limit: 100,
  offset: 0,
});

// Get stream metadata
const info = await ctx.stream.get(streamId);
// info.namespace, info.sizeBytes, info.expiresAt

// Download stream content
const content = await ctx.stream.download(streamId);

// Delete stream
await ctx.stream.delete(streamId);
```

### Dual Stream Pattern

Create two streams simultaneously — one for client, one for audit:

```ts
const mainStream = await ctx.stream.create('output', { contentType: 'text/plain' });
const auditStream = await ctx.stream.create('audit', {
  contentType: 'application/json',
  metadata: { userId: input.userId },
});

ctx.waitUntil(async () => {
  const { textStream } = streamText({ model: openai('gpt-5-mini'), prompt: input.message });

  const chunks: string[] = [];
  for await (const chunk of textStream) {
    await mainStream.write(chunk);
    chunks.push(chunk);
  }

  await auditStream.write(JSON.stringify({
    timestamp: new Date().toISOString(),
    userId: input.userId,
    response: chunks.join(''),
  }));

  await mainStream.close();
  await auditStream.close();
});

return { streamUrl: mainStream.url };
```

### Best Practices (Streams)

- Enable `compress: true` for large text exports
- Return URLs early with `ctx.waitUntil()`
- Delete streams after they're no longer needed
- Always specify the correct content type

---

## Custom Storage

### Local Development

During local dev, storage is backed by SQLite and persists between runs:

```ts
const app = await createApp({
  services: {
    useLocal: true,  // Force local storage even when authenticated
  },
});
```

### Custom Implementations

Replace any storage type with your own:

```ts
import { createApp } from '@agentuity/runtime';
import { MyRedisKV, MyPineconeVector } from './my-storage';

const app = await createApp({
  services: {
    keyvalue: new MyRedisKV(),
    vector: new MyPineconeVector(),
    // object and stream use Agentuity defaults
  },
});
```

### Storage Interfaces

Implementations must satisfy these interfaces (exported from `@agentuity/core`):

- **KeyValueStorage**: `get`, `set`, `delete`, `getStats`, `getNamespaces`, `search`, `getKeys`
- **VectorStorage**: `upsert`, `get`, `getMany`, `search`, `delete`, `exists`
- **ObjectStorage**: `get`, `put`, `delete`, `createPublicURL`, `listBuckets`, `listObjects`, `headObject`
- **StreamStorage**: `create`, `get`, `download`, `list`, `delete`

---

## Standalone Usage (All Storage Types)

```ts
import { createApp, createAgentContext } from '@agentuity/runtime';
await createApp();

const ctx = createAgentContext();
await ctx.invoke(async () => {
  // Full access to ctx.kv, ctx.vector, ctx.stream
  await ctx.kv.set('prefs', 'key', { value: true });
  await ctx.vector.upsert('kb', { key: 'doc', document: 'text' });
  const stream = await ctx.stream.create('export', { contentType: 'text/csv' });
});
```

See [Running Agents Without HTTP](https://agentuity.dev/Agents/standalone-execution) for more patterns.
