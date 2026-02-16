# Agentuity Logging

Structured logging for agents and routes.

---

## Overview

Use `ctx.logger` in agents and `c.var.logger` in routes for structured logging. Logs are automatically tied to session IDs for debugging.

## Log Levels

```typescript
import { createAgent } from '@agentuity/runtime';

const agent = createAgent('LoggingExample', {
  handler: async (ctx, input) => {
    ctx.logger.trace('Verbose debugging info');
    ctx.logger.debug('Debug-level details');
    ctx.logger.info('General information');
    ctx.logger.warn('Warning: potential issue');
    ctx.logger.error('Error occurred', error);

    return { success: true };
  },
});
```

Levels from most to least verbose: `trace` → `debug` → `info` → `warn` → `error`. Default minimum level is `info`.

## Structured Logging

Pass context as a second argument for searchable metadata:

```typescript
const agent = createAgent('ProductSearch', {
  handler: async (ctx, input) => {
    const startTime = Date.now();
    const results = await searchProducts(input.query);

    ctx.logger.info('Search completed', {
      query: input.query,
      resultCount: results.length,
      userId: input.userId,
      durationMs: Date.now() - startTime,
    });

    return { results };
  },
});
```

Creates structured log entries filterable and searchable in the Agentuity App or CLI.

## Child Loggers

Create component-scoped loggers that inherit parent context:

```typescript
const agent = createAgent('ChildLoggerExample', {
  handler: async (ctx, input) => {
    const dbLogger = ctx.logger.child({
      component: 'database',
      requestId: ctx.sessionId,
    });

    dbLogger.debug('Connecting to database');
    dbLogger.info('Query executed', { duration: 45, rows: 10 });

    const embeddingsLogger = ctx.logger.child({
      component: 'embeddings',
      documentId: input.documentId,
    });

    embeddingsLogger.info('Generating embeddings', { chunkCount: 12 });

    return { success: true };
  },
});
```

## Logging in Routes

Routes access the logger via `c.var.logger`:

```typescript
import { createRouter } from '@agentuity/runtime';
import paymentHandler from '@agent/payment-handler';

const router = createRouter();

router.post('/webhooks/payments', async (c) => {
  const eventType = c.req.header('x-webhook-event');

  c.var.logger.info('Webhook received', {
    provider: 'stripe',
    eventType,
  });

  const payload = await c.req.json();

  const result = await paymentHandler.run({
    event: eventType,
    customerId: payload.customer,
    amount: payload.amount,
  });

  c.var.logger.info('Webhook processed', {
    eventType,
    customerId: payload.customer,
    success: result.success,
  });

  return c.json({ received: true });
});

export default router;
```

## Configuration

Set the minimum log level with `AGENTUITY_LOG_LEVEL`:

```bash
# In .env
AGENTUITY_LOG_LEVEL=debug  # Show debug and above
```

| Level | Shows |
|-------|-------|
| `trace` | trace, debug, info, warn, error |
| `debug` | debug, info, warn, error |
| `info` | info, warn, error (default) |
| `warn` | warn, error |
| `error` | error only |

## Viewing Logs

```bash
# List recent sessions
agentuity cloud session list

# View logs for a session
agentuity cloud session logs sess_abc123xyz
```

Logs are also visible in the Agentuity App session timeline.

## Best Practices

- **Use `ctx.logger`**: Always use `ctx.logger` or `c.var.logger` instead of `console.log` for proper log collection
- **Add context**: Include IDs, counts, and timing in structured fields
- **Use appropriate levels**: `info` for normal flow, `warn` for recoverable issues, `error` for failures
- **Create child loggers**: For complex operations, create component-specific loggers
