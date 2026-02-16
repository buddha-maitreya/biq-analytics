# Agentuity Routes

Reference for defining HTTP routes, middleware, cron jobs, WebSockets, and SSE in Agentuity.

---

## Where Routes Live

All routes live in `src/api/`. Files export a router created with `createRouter()`.

```
src/api/
├── index.ts          # Main routes (mounted at /api/)
├── chat.ts           # Chat routes (mounted at /api/chat/)
├── admin/
│   └── index.ts      # Admin routes (mounted at /api/admin/)
└── webhooks/
    └── stripe.ts     # Webhook routes (mounted at /api/webhooks/stripe/)
```

---

## Route Types Overview

| Type | Purpose | Example |
|---|---|---|
| HTTP | Request/response endpoints | REST APIs, form handlers |
| Middleware | Cross-cutting concerns | Auth, CORS, logging |
| Cron | Scheduled tasks | Daily reports, cleanup |
| WebSocket | Bidirectional real-time | Live chat, collaboration |
| SSE | Server push | Progress updates, dashboards |

---

## HTTP Routes

### Basic CRUD

```ts
import { createRouter } from '@agentuity/runtime';

const router = createRouter();

// GET — auto-fetched by useAPI on mount
router.get('/items', async (c) => {
  const items = await fetchItems();
  return c.json({ items });
});

// GET with path params
router.get('/items/:id', async (c) => {
  const id = c.req.param('id');
  return c.json({ item: await getItem(id) });
});

// POST
router.post('/items', async (c) => {
  const body = await c.req.json();
  const item = await createItem(body);
  return c.json({ item }, 201);
});

// PUT
router.put('/items/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const item = await updateItem(id, body);
  return c.json({ item });
});

// DELETE
router.delete('/items/:id', async (c) => {
  const id = c.req.param('id');
  await deleteItem(id);
  return c.json({ deleted: true });
});

export default router;
```

### Query Parameters

```ts
router.get('/search', async (c) => {
  const query = c.req.query('q');
  const page = parseInt(c.req.query('page') || '1');
  const limit = parseInt(c.req.query('limit') || '10');
  return c.json({ results: await search(query, page, limit) });
});
```

### Request Validation with Agent Schemas

```ts
import { createRouter } from '@agentuity/runtime';
import chat from '@agent/chat';

const router = createRouter();

router.post('/chat', chat.validator(), async (c) => {
  const data = c.req.valid('json'); // Fully typed from agent schema
  const result = await chat.run(data);
  return c.json(result);
});
```

### Custom Validation

```ts
import { createRouter, validator } from '@agentuity/runtime';
import { z } from 'zod';

const router = createRouter();

const itemSchema = z.object({
  name: z.string().min(1),
  price: z.number().positive(),
  quantity: z.number().int().min(0),
});

router.post('/items', validator({ input: itemSchema }), async (c) => {
  const data = c.req.valid('json');
  // data is typed as { name: string; price: number; quantity: number }
  return c.json({ created: true });
});
```

---

## Context Access in Routes

Routes use Hono's context (`c`) with Agentuity services on `c.var`:

```ts
router.post('/example', async (c) => {
  // Logging
  c.var.logger.info('Processing request');

  // Key-Value storage
  const result = await c.var.kv.get('cache', 'key');

  // Vector search
  const vectors = await c.var.vector.search('kb', { query: 'text' });

  // Durable streams
  const stream = await c.var.stream.create('export', { contentType: 'text/csv' });

  // Thread state (conversation context)
  await c.var.thread.state.set('key', 'value');

  // Session state
  c.var.session.state.set('key', 'value');

  // Background tasks
  c.waitUntil(async () => {
    await doBackgroundWork();
  });

  return c.json({ ok: true });
});
```

**Key difference from agents**: In agents, access services on `ctx` directly (`ctx.kv`, `ctx.logger`). In routes, use `c.var.*` (`c.var.kv`, `c.var.logger`).

---

## Middleware

### Custom Middleware

```ts
import { createMiddleware } from 'hono/factory';

const authMiddleware = createMiddleware(async (c, next) => {
  const apiKey = c.req.header('X-API-Key');
  if (!apiKey) return c.json({ error: 'API key required' }, 401);

  const keyData = await c.var.kv.get('api-keys', apiKey);
  if (!keyData.exists) return c.json({ error: 'Invalid API key' }, 401);

  c.set('userId', keyData.data.userId);
  await next();
});

// Apply to all routes
router.use('/*', authMiddleware);

// Or specific routes
router.use('/admin/*', authMiddleware);
```

### Built-in Middleware

```ts
import { createRouter, stream, cron, websocket } from '@agentuity/runtime';
```

---

## Cron Routes

Scheduled tasks using cron expressions:

```ts
import { createRouter, cron } from '@agentuity/runtime';
import cleanupAgent from '@agent/cleanup';

const router = createRouter();

// Run every hour
router.post('/cleanup', cron('0 * * * *'), async (c) => {
  const result = await cleanupAgent.run({ task: 'expired-sessions' });
  c.var.logger.info('Cleanup completed', { result });
  return c.json({ success: true });
});

// Run daily at midnight
router.post('/reports', cron('0 0 * * *'), async (c) => {
  await generateDailyReport();
  return c.json({ generated: true });
});

export default router;
```

---

## WebSocket Routes

Bidirectional real-time communication:

```ts
import { createRouter, websocket } from '@agentuity/runtime';

const router = createRouter();

router.get('/chat', websocket({
  onOpen(ws) {
    ws.send(JSON.stringify({ type: 'connected' }));
  },

  onMessage(ws, message) {
    // Process incoming message
    const data = JSON.parse(message.toString());
    ws.send(JSON.stringify({ echo: data }));
  },

  onClose(ws) {
    // Cleanup
  },
}));

export default router;
```

---

## SSE (Server-Sent Events) Routes

One-way server-to-client streaming:

```ts
import { createRouter, stream } from '@agentuity/runtime';

const router = createRouter();

router.get('/status', stream(), async (c) => {
  const writer = c.var.stream;

  // Send periodic updates
  const interval = setInterval(async () => {
    await writer.write(`data: ${JSON.stringify({ status: 'active', time: Date.now() })}\n\n`);
  }, 5000);

  // Cleanup on disconnect
  c.req.raw.signal.addEventListener('abort', () => {
    clearInterval(interval);
  });
});

export default router;
```

---

## Calling Agents from Routes

```ts
import { createRouter } from '@agentuity/runtime';
import chat from '@agent/chat';
import summarizer from '@agent/summarizer';

const router = createRouter();

// Basic call
router.post('/chat', async (c) => {
  const { message } = await c.req.json();
  const result = await chat.run({ message });
  return c.json(result);
});

// Parallel agent calls
router.post('/analyze', async (c) => {
  const { content } = await c.req.json();
  const [sentiment, summary] = await Promise.all([
    sentimentAnalyzer.run({ text: content }),
    summarizer.run({ content }),
  ]);
  return c.json({ sentiment, summary });
});

// Background agent call
router.post('/webhook', async (c) => {
  const payload = await c.req.json();
  c.waitUntil(async () => {
    await webhookProcessor.run(payload);
  });
  return c.json({ received: true });
});
```

---

## Streaming Responses from Routes

```ts
import { createRouter } from '@agentuity/runtime';
import { streamText } from 'ai';
import { openai } from '@ai-sdk/openai';

const router = createRouter();

router.post('/stream-chat', async (c) => {
  const { prompt } = await c.req.json();

  const result = streamText({
    model: openai('gpt-5-mini'),
    prompt,
  });

  return result.toTextStreamResponse();
});
```

---

## Error Handling

```ts
router.post('/safe-chat', async (c) => {
  const { message } = await c.req.json();

  try {
    const result = await chat.run({ message });
    return c.json({ success: true, result });
  } catch (error) {
    c.var.logger.error('Agent call failed', {
      agent: 'chat',
      error: error instanceof Error ? error.message : String(error),
    });
    return c.json({ success: false, error: 'Processing failed' }, 500);
  }
});
```

---

## Best Practices

- Use `createRouter()` for every route file
- Apply middleware with `router.use()` for cross-cutting concerns
- Use `agent.validator()` for type-safe request validation
- Use `c.waitUntil()` for background processing (webhooks, analytics)
- Access all Agentuity services through `c.var.*`
- Never use `console.log` — use `c.var.logger`
- Keep routes thin — delegate complex logic to agents
- Use parallel `Promise.all()` for independent agent calls
