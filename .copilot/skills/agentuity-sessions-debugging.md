# Agentuity Sessions & Debugging

Debug agents using session IDs, CLI commands, and trace timelines.

---

## Overview

Every request to your agents gets a unique session ID (`sess_...`). Sessions link logs, traces, and state, making them essential for debugging.

## Why Sessions?

Agents go beyond single HTTP requests — a conversation might span dozens of LLM calls, tool executions, and orchestration steps across multiple interactions.

Agentuity tracks all of this automatically:

- **Unified tracing**: All logs, spans, and state from a single request are linked by session ID
- **Conversation context**: Sessions group into threads for multi-turn conversations
- **Automatic correlation**: No manual tracking code needed — every call in a session is connected
- **Session inspection**: Review what happened in a session to reproduce issues

## Sessions vs Threads

| Scope | Lifetime | ID Prefix | Use For |
|-------|----------|-----------|---------|
| **Session** | Single request | `sess_` | Debugging, request-scoped state |
| **Thread** | 1 hour (conversation) | `thrd_` | Chat history, user preferences |

A thread contains multiple sessions. Each message in a multi-turn conversation creates a new session within the same thread.

**Mental model:** Threads "wrap" sessions. A *thread* is a conversation, a *session* is one message in that conversation.

## Accessing Session ID

### In Agents

```typescript
import { createAgent } from '@agentuity/runtime';

const agent = createAgent('SessionExample', {
  handler: async (ctx, input) => {
    ctx.logger.info('Processing request', { sessionId: ctx.sessionId });
    ctx.logger.info('Thread context', { threadId: ctx.thread.id });

    return { sessionId: ctx.sessionId };
  },
});
```

### In Routes

```typescript
import { createRouter } from '@agentuity/runtime';
import myAgent from '@agent/my-agent';

const router = createRouter();

router.post('/', myAgent.validator(), async (c) => {
  const input = c.req.valid('json');
  c.var.logger.info('Route called', { sessionId: c.var.sessionId });

  const result = await myAgent.run(input);
  return c.json({ ...result, sessionId: c.var.sessionId });
});

export default router;
```

## Viewing Session Logs

```bash
agentuity cloud session logs sess_abc123xyz
```

## Including Session ID in Responses

For easier debugging, include the session ID in error responses:

```typescript
const agent = createAgent('ErrorHandler', {
  handler: async (ctx, input) => {
    try {
      const result = await processRequest(input);
      return { success: true, data: result };
    } catch (error) {
      ctx.logger.error('Request failed', {
        sessionId: ctx.sessionId,
        error: error.message,
      });

      return {
        success: false,
        error: 'Processing failed',
        sessionId: ctx.sessionId,
      };
    }
  },
});
```

## Linking External Logs

Include session ID when calling external services so logs stay connected:

```typescript
const agent = createAgent('WebhookHandler', {
  handler: async (ctx, input) => {
    const requestLogger = ctx.logger.child({
      sessionId: ctx.sessionId,
      threadId: ctx.thread.id,
      service: 'webhook-handler',
    });

    requestLogger.info('Processing webhook', { eventType: input.event });

    await externalApi.process({
      ...input,
      metadata: { agentuitySessionId: ctx.sessionId },
    });

    return { success: true };
  },
});
```

## Session State

Request-scoped data that doesn't persist after response:

```typescript
const agent = createAgent('TimingExample', {
  handler: async (ctx, input) => {
    ctx.session.state.set('startTime', Date.now());

    const result = await processRequest(input);

    const duration = Date.now() - (ctx.session.state.get('startTime') as number);
    ctx.logger.info('Request completed', { durationMs: duration });

    return result;
  },
});
```

For persistent data, use thread state or KV storage.

## Thread and Session Metadata

Store unencrypted metadata for filtering and querying. Unlike state (encrypted), metadata is stored as-is with database indexes.

```typescript
import { createAgent } from '@agentuity/runtime';

const agent = createAgent('UserContext', {
  handler: async (ctx, input) => {
    // Thread metadata — persists across sessions within a thread
    ctx.thread.metadata.userId = input.userId;
    ctx.thread.metadata.department = 'sales';
    ctx.thread.metadata.plan = 'enterprise';

    // Session metadata — request-scoped
    ctx.session.metadata.requestType = 'chat';
    ctx.session.metadata.clientVersion = input.clientVersion;
    ctx.session.metadata.source = 'web';

    ctx.logger.info('Request context', {
      threadId: ctx.thread.id,
      userId: ctx.thread.metadata.userId,
      requestType: ctx.session.metadata.requestType,
    });

    return { success: true };
  },
});

export default agent;
```

### Metadata vs State

| Aspect | Metadata | State |
|--------|----------|-------|
| **Storage** | Unencrypted, indexed | Encrypted |
| **Use case** | Filtering, querying, analytics | Sensitive data, conversation history |
| **Access** | `ctx.thread.metadata` / `ctx.session.metadata` | `ctx.thread.state` / `ctx.session.state` |
| **Best for** | User IDs, request types, feature flags | Messages, preferences, tokens |

Use metadata for values you might filter or query on later. Use state for data that should remain private.

## Best Practices

- **Include session ID in logs and error responses**: Makes it easy to trace issues
- **Use structured logging**: Add context for easier filtering
- **Create child loggers**: Add session context to component-specific loggers
