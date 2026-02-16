# Agentuity — Routing Overview

> Source: https://agentuity.dev/Routes

## Where Routes Live

All routes live in `src/api/`. Agents and routes are separate concerns:

| Location | Purpose |
|----------|---------|
| `src/agent/*/` | Agent logic (no routes here) |
| `src/api/` | All routes: HTTP, cron, WebSocket, SSE, etc. |

Routes in `src/api/` are automatically mounted at `/api`.

## Route Types

| Type | API | Use Cases |
|------|-----|-----------|
| HTTP | `router.get()`, `router.post()`, `stream()` | REST APIs, webhooks, LLM streaming |
| Middleware | Hono middleware | Auth, logging, validation |
| Cron | `cron()` middleware | Scheduled tasks |
| WebSocket | `websocket()` middleware | Real-time bidirectional |
| SSE | `sse()` middleware | Server-sent events |

## Quick Examples

### HTTP

```typescript
import { createRouter } from '@agentuity/runtime';
import assistant from '@agent/assistant';

const router = createRouter();

router.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: Date.now() });
});

router.post('/chat', assistant.validator(), async (c) => {
  const data = c.req.valid('json');
  const result = await assistant.run(data);
  return c.json(result);
});

export default router;
```

### Cron

```typescript
import { cron } from '@agentuity/runtime';
import reportGenerator from '@agent/report-generator';

router.post('/daily-report', cron('0 9 * * *', async (c) => {
  await reportGenerator.run({ type: 'daily' });
  return c.text('OK');
}));
```

### WebSocket

```typescript
import { websocket } from '@agentuity/runtime';
import assistant from '@agent/assistant';

router.get('/chat', websocket((c, ws) => {
  ws.onMessage(async (event) => {
    const response = await assistant.run(event.data);
    ws.send(response);
  });
}));
```

### SSE (Server-Sent Events)

```typescript
import { sse } from '@agentuity/runtime';

router.get('/stream', sse(async (c, stream) => {
  for (let i = 0; i < 5; i++) {
    await stream.writeSSE({ data: `Message ${i}` });
  }
  stream.close();
}));
```

## Context Access

In routes, use Hono's context: `c.var.logger`, `c.var.kv`, `c.var.thread`, etc.
In agents, access services directly on `ctx`: `ctx.logger`, `ctx.kv`, `ctx.thread`.

```typescript
import myAgent from '@agent/my-agent';
import analytics from '@agent/analytics';

router.post('/', async (c) => {
  const body = await c.req.json();
  const header = c.req.header('Authorization');

  c.var.logger.info('Processing request');
  const sessionId = c.var.sessionId;

  // Thread and session state
  c.var.thread.state.set('topic', body.topic);

  // Storage
  await c.var.kv.set('cache', 'key', data);
  const results = await c.var.vector.search('docs', { query: 'search term' });

  // Call agents
  const result = await myAgent.run(body);

  // Background tasks
  c.waitUntil(async () => {
    await analytics.run({ event: 'request' });
  });

  return c.json(result);
});
```
