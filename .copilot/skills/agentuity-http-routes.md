# Agentuity — HTTP Routes

> Source: https://agentuity.dev/Routes/http

## Basic Routes

```typescript
import { createRouter } from '@agentuity/runtime';

const router = createRouter();

router.get('/', async (c) => {
  return c.json({ status: 'healthy' });
});

router.post('/process', async (c) => {
  const body = await c.req.json();
  return c.json({ received: body });
});

export default router;
```

Return values are automatically converted: `string` → text, `object` → JSON, `ReadableStream` → streamed.

## HTTP Methods

```typescript
router.get('/items', handler);        // Read
router.post('/items', handler);       // Create
router.put('/items/:id', handler);    // Replace
router.patch('/items/:id', handler);  // Update
router.delete('/items/:id', handler); // Delete
```

## Route Parameters

```typescript
router.get('/users/:id', async (c) => {
  const userId = c.req.param('id');
  return c.json({ userId });
});

router.get('/posts/:year/:month/:slug', async (c) => {
  const { year, month, slug } = c.req.param();
  return c.json({ year, month, slug });
});
```

## Query Parameters

```typescript
router.get('/search', async (c) => {
  const query = c.req.query('q');
  const page = c.req.query('page') || '1';
  const limit = c.req.query('limit') || '10';
  return c.json({ query, page, limit });
});
```

## Calling Agents

```typescript
import { createRouter } from '@agentuity/runtime';
import assistant from '@agent/assistant';

const router = createRouter();

router.post('/chat', async (c) => {
  const { message } = await c.req.json();
  const response = await assistant.run({ message });
  return c.json(response);
});
```

Background processing:

```typescript
import webhookProcessor from '@agent/webhook-processor';

router.post('/webhook', async (c) => {
  const payload = await c.req.json();
  c.waitUntil(async () => {
    await webhookProcessor.run(payload);
  });
  return c.json({ status: 'accepted' });
});
```

## Request Validation

### With Agents

```typescript
import { createRouter } from '@agentuity/runtime';
import userCreator from '@agent/user-creator';

const router = createRouter();

router.post('/users', userCreator.validator(), async (c) => {
  const data = c.req.valid('json'); // Fully typed from agent schema
  const user = await userCreator.run(data);
  return c.json(user);
});
```

Validator overloads:
- `agent.validator()` — Uses agent's input/output schemas
- `agent.validator({ output: schema })` — Output-only validation
- `agent.validator({ input: schema, output?: schema })` — Custom schemas

### Standalone Validation

```typescript
import { createRouter, validator } from '@agentuity/runtime';
import { s } from '@agentuity/schema';

const createUserSchema = s.object({
  name: s.string(),
  email: s.string(),
  age: s.number(),
});

router.post('/',
  validator({ input: createUserSchema }),
  async (c) => {
    const data = c.req.valid('json');
    return c.json({ success: true, user: data });
  }
);
```

> **Important:** Import `validator` from `@agentuity/runtime`, not from `hono/validator`.

## Request Context

```typescript
// Request data
await c.req.json();        // Parse JSON body
c.req.param('id');         // Route parameter
c.req.query('page');       // Query string
c.req.header('Authorization'); // Request header

// Responses
c.json({ data });          // JSON response
c.text('OK');              // Plain text
c.redirect('/other');      // Redirect

// Agentuity services
import myAgent from '@agent/my-agent';
await myAgent.run(input);     // Call an agent

c.var.kv.get('bucket', 'key');       // Key-value storage
c.var.vector.search('ns', opts);     // Vector search
c.var.logger.info('message');        // Logging

// Thread and session
c.var.thread.id;                     // Thread ID
await c.var.thread.state.get('key'); // Thread state
```

## Streaming Responses

```typescript
import { createRouter, stream } from '@agentuity/runtime';
import chatAgent from '@agent/chat';

const router = createRouter();

router.post('/chat', stream(async (c) => {
  const body = await c.req.json();
  return chatAgent.run(body); // Returns a ReadableStream
}));
```

| Type | Direction | Use |
|------|-----------|-----|
| `stream()` | Server → Client | LLM responses, file downloads |
| `sse()` | Server → Client | Progress updates, notifications |
| `websocket()` | Bidirectional | Chat, collaboration |

## Routes Without Agents

For simple CRUD, webhook handlers, health checks:

```typescript
import { createRouter, validator } from '@agentuity/runtime';
import * as v from 'valibot';

const router = createRouter();
const itemSchema = v.object({ name: v.string(), value: v.number() });

router.get('/items/:key', async (c) => {
  const key = c.req.param('key');
  const result = await c.var.kv.get('items', key);
  if (!result.exists) return c.json({ error: 'Not found' }, 404);
  return c.json({ data: result.data });
});

router.post('/items/:key',
  validator({ input: itemSchema }),
  async (c) => {
    const key = c.req.param('key');
    const data = c.req.valid('json');
    await c.var.kv.set('items', key, data);
    return c.json({ success: true, key }, 201);
  }
);
```
