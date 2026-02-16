# Agentuity APIs — Routes vs Agents & Calling Agents from Routes

Reference for when to use routes vs agents, and how to call agents from routes.

---

## Routes vs Agents — Decision Guide

All request handling lives in `src/api/`. You have two options:

1. **Simple routes** — Handle HTTP directly (health checks, CRUD, webhooks)
2. **Call an agent** — Import an agent for structured processing with validation

### Quick Decision

| Use Simple Route | Use Agent |
|---|---|
| Health checks, status endpoints | LLM-powered processing |
| Simple CRUD operations | Schema-validated input/output |
| Webhook signature verification | Evaluations or lifecycle events |
| Static responses | Multi-step workflows |

### Simple Route Example

```ts
// src/api/index.ts
import { createRouter } from '@agentuity/runtime';

const router = createRouter();

router.get('/health', async (c) => {
  const dbHealthy = await checkDatabase();
  return c.json({ status: dbHealthy ? 'healthy' : 'degraded' });
});

export default router;
```

### Calling an Agent from a Route

```ts
// src/api/index.ts
import { createRouter } from '@agentuity/runtime';
import chat from '@agent/chat';

const router = createRouter();

router.post('/chat', chat.validator(), async (c) => {
  const data = c.req.valid('json'); // Fully typed from agent schema
  const result = await chat.run(data);
  return c.json(result);
});

export default router;
```

### When Agents Add Value

Agents provide:
- **Schema validation** with `agent.validator()` middleware
- **Evaluations** to measure output quality
- **Lifecycle events** for monitoring
- **Type safety** for agent-to-agent calls

---

## Calling Agents from Routes

### Basic Call

```ts
import { createRouter } from '@agentuity/runtime';
import chat from '@agent/chat';

const router = createRouter();

router.post('/chat', async (c) => {
  const { message } = await c.req.json();
  const result = await chat.run({ message });
  return c.json(result);
});
```

### With agent.validator()

```ts
router.post('/chat', chat.validator(), async (c) => {
  const data = c.req.valid('json'); // Fully typed
  const result = await chat.run(data);
  return c.json(result);
});
```

### Custom Schema Validation

```ts
import { s } from '@agentuity/schema';

router.post('/analyze',
  sentimentAnalyzer.validator({
    input: s.object({ content: s.string() }),
  }),
  async (c) => {
    const { content } = c.req.valid('json');
    const result = await sentimentAnalyzer.run({ text: content });
    return c.json(result);
  }
);
```

### Multiple Agents

```ts
import chat from '@agent/chat';
import summarizer from '@agent/summarizer';
import teamMembers from '@agent/team/members';

router.post('/process', async (c) => {
  const input = await c.req.json();
  const chatResult = await chat.run({ message: input.text });
  const summary = await summarizer.run({ content: input.text });
  const members = await teamMembers.run({ teamId: input.teamId });
  return c.json({ chatResult, summary, members });
});
```

### Parallel Agent Calls

```ts
router.post('/analyze', async (c) => {
  const { content } = await c.req.json();

  const [sentiment, topics, summary] = await Promise.all([
    sentimentAnalyzer.run({ text: content }),
    topicExtractor.run({ text: content }),
    summarizer.run({ content }),
  ]);

  return c.json({ sentiment, topics, summary });
});
```

### Background Agent Calls

```ts
router.post('/webhook', async (c) => {
  const payload = await c.req.json();

  // Acknowledge immediately
  c.waitUntil(async () => {
    await webhookProcessor.run(payload);
    c.var.logger.info('Webhook processed');
  });

  return c.json({ received: true });
});
```

**Webhook Best Practice**: Webhook providers expect fast responses (< 3s). Use `c.waitUntil()` to acknowledge receipt immediately.

### Error Handling

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
    return c.json({ success: false, error: 'Chat processing failed' }, 500);
  }
});
```

---

## Webhook Pattern

Verify signatures in the route, then delegate to an agent:

```ts
import paymentProcessor from '@agent/payment-processor';

router.post('/webhooks/stripe', async (c) => {
  const signature = c.req.header('stripe-signature');
  const rawBody = await c.req.text();

  if (!verifyStripeSignature(rawBody, signature)) {
    return c.json({ error: 'Invalid signature' }, 401);
  }

  c.waitUntil(async () => {
    await paymentProcessor.run(JSON.parse(rawBody));
  });

  return c.json({ received: true });
});
```

---

## Full Example: Multi-Endpoint API

```ts
import { createRouter } from '@agentuity/runtime';
import { createMiddleware } from 'hono/factory';
import { s } from '@agentuity/schema';
import chat from '@agent/chat';
import summarizer from '@agent/summarizer';
import sentimentAnalyzer from '@agent/sentiment-analyzer';

const router = createRouter();

// Auth middleware
const authMiddleware = createMiddleware(async (c, next) => {
  const apiKey = c.req.header('X-API-Key');
  if (!apiKey) return c.json({ error: 'API key required' }, 401);

  const keyData = await c.var.kv.get('api-keys', apiKey);
  if (!keyData.exists) return c.json({ error: 'Invalid API key' }, 401);

  c.set('userId', keyData.data.userId);
  await next();
});

router.use('/*', authMiddleware);

// Chat — uses agent's schema for validation
router.post('/chat', chat.validator(), async (c) => {
  const userId = c.var.userId;
  const data = c.req.valid('json');
  const result = await chat.run({ ...data, userId });

  c.waitUntil(async () => {
    await c.var.kv.set('usage', `${userId}:${Date.now()}`, {
      endpoint: 'chat',
      tokens: result.tokensUsed,
    });
  });

  return c.json(result);
});

// Summarize — uses summarizer's schema
router.post('/summarize', summarizer.validator(), async (c) => {
  const data = c.req.valid('json');
  const result = await summarizer.run(data);
  return c.json(result);
});

// Multi-agent analysis — custom schema
router.post('/analyze',
  sentimentAnalyzer.validator({ input: s.object({ content: s.string() }) }),
  async (c) => {
    const { content } = c.req.valid('json');
    const [sentiment, summary] = await Promise.all([
      sentimentAnalyzer.run({ text: content }),
      summarizer.run({ content, maxLength: 100 }),
    ]);
    return c.json({ sentiment: sentiment.score, summary: summary.text });
  }
);

export default router;
```

---

## Type Safety

If agents have schemas, TypeScript provides full type checking:

```ts
// Agent definition (src/agent/chat/agent.ts)
const chatAgent = createAgent('Chat', {
  schema: {
    input: s.object({ message: s.string() }),
    output: s.object({ response: s.string(), tokensUsed: s.number() }),
  },
  handler: async (ctx, input) => { ... },
});

// In route — TypeScript knows the types
import chat from '@agent/chat';

router.post('/chat', async (c) => {
  const result = await chat.run({ message: 'Hello' });
  // result is typed as { response: string, tokensUsed: number }
  return c.json({ text: result.response });
});
```

---

## Best Practices

- Use simple routes for health checks and CRUD — don't over-engineer with agents
- Use agents when you need schema validation, evals, or LLM processing
- Use `agent.validator()` for type-safe request validation
- Use `c.waitUntil()` for background processing
- Keep routes thin — delegate complex logic to agents
- Use `Promise.all()` for parallel independent agent calls
