# Agentuity — Creating Agents

> Source: https://agentuity.dev/Agents/creating-agents

## Basic Agent

Create an agent with `createAgent()`, providing a name and handler function:

```typescript
import { createAgent } from '@agentuity/runtime';

const agent = createAgent('Greeter', {
  handler: async (ctx, input) => {
    ctx.logger.info('Processing request', { input });
    return { message: 'Hello from agent!' };
  },
});

export default agent;
```

The handler receives two parameters:
- `ctx` — The agent context with logging, storage, and state management
- `input` — The data passed to the agent (validated if schema is defined)

> **Route vs Agent Context:** In agents, access services directly on `ctx`: `ctx.logger`, `ctx.kv`, `ctx.thread`, etc. In routes, use Hono's context: `c.var.logger`, `c.var.kv`, `c.var.thread`, etc.

## Adding LLM Capabilities

Most agents use an LLM for inference. Using the AI SDK:

```typescript
import { createAgent } from '@agentuity/runtime';
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { s } from '@agentuity/schema';

const agent = createAgent('Assistant', {
  schema: {
    input: s.object({ prompt: s.string() }),
    output: s.object({ response: s.string() }),
  },
  handler: async (ctx, { prompt }) => {
    const { text } = await generateText({
      model: openai('gpt-5-mini'),
      prompt,
    });
    return { response: text };
  },
});

export default agent;
```

You can also use provider SDKs directly (OpenAI, Groq, Anthropic).

## Adding Schema Validation

Define input and output schemas for type safety and runtime validation. Agentuity includes a built-in schema library, but you can also use Zod:

```typescript
import { createAgent } from '@agentuity/runtime';
import { z } from 'zod';

const agent = createAgent('Contact Form', {
  schema: {
    input: z.object({
      email: z.string().email(),
      message: z.string().min(1),
    }),
    output: z.object({
      success: z.boolean(),
      id: z.string(),
    }),
  },
  handler: async (ctx, input) => {
    ctx.logger.info('Received message', { from: input.email });
    return { success: true, id: crypto.randomUUID() };
  },
});

export default agent;
```

Validation behavior:
- Input is validated before the handler runs
- Output is validated before returning to the caller
- Invalid data throws an error with details about what failed

Supported schema libraries (all implement StandardSchema):
- `@agentuity/schema` — Lightweight, built-in, zero dependencies
- Zod — Popular, feature-rich, great ecosystem
- Valibot — Tiny bundle size, tree-shakeable
- ArkType — TypeScript-native syntax

### Type Inference

TypeScript automatically infers types from your schemas. **Don't add explicit type annotations to handler parameters:**

```typescript
// Good: types inferred from schema
handler: async (ctx, input) => { ... }

// Bad: explicit types can cause issues
handler: async (ctx: AgentContext, input: MyInput) => { ... }
```

### Schema Descriptions for AI

When using `generateObject()`, add `.describe()` to help the LLM:

```typescript
z.object({
  title: z.string().describe('Event title, concise, without names'),
  startTime: z.string().describe('Start time in HH:MM format (e.g., 14:00)'),
  priority: z.enum(['low', 'medium', 'high']).describe('Urgency level'),
})
```

## Handler Context

The handler context (`ctx`) provides access to Agentuity services:

```typescript
handler: async (ctx, input) => {
  // Logging (always use ctx.logger, not console.log)
  ctx.logger.info('Processing', { data: input });
  ctx.logger.error('Something failed', { error });

  // Identifiers
  ctx.sessionId;           // Unique per request (sess_...)
  ctx.thread.id;           // Conversation context (thrd_...)
  ctx.current.name;        // This agent's name
  ctx.current.agentId;     // Stable ID for namespacing state keys

  // State management
  ctx.state.set('key', value);                   // Request-scoped (sync)
  await ctx.thread.state.set('key', value);      // Thread-scoped (async, up to 1 hour)
  ctx.session.state.set('key', value);           // Session-scoped

  // Storage
  await ctx.kv.set('bucket', 'key', data);
  await ctx.vector.search('namespace', { query: 'text' });

  // Background tasks
  ctx.waitUntil(async () => {
    await ctx.kv.set('analytics', 'event', { timestamp: Date.now() });
  });

  return { result };
}
```

## Agent Name and Description

```typescript
const agent = createAgent('Support Ticket Analyzer', {
  description: 'Analyzes support tickets and extracts key information',
  schema: { ... },
  handler: async (ctx, input) => { ... },
});
```

## Adding Test Prompts (Workbench)

```typescript
export const welcome = () => ({
  welcome: 'Welcome to the **Support Ticket Analyzer** agent.',
  prompts: [
    {
      data: JSON.stringify({ ticketId: 'TKT-1234', subject: 'Login issue' }),
      contentType: 'application/json',
    },
  ],
});

export default agent;
```

## Best Practices

- **Single responsibility:** Each agent should have one clear purpose
- **Always define schemas:** Schemas provide type safety and serve as documentation
- **Handle errors gracefully:** Wrap external calls in try-catch blocks
- **Keep handlers focused:** Move complex logic to helper functions

```typescript
import processor from '@agent/processor';

// Good: Clear, focused handler
handler: async (ctx, input) => {
  try {
    const enriched = await enrichData(input.data);
    const result = await processor.run(enriched);
    return { success: true, result };
  } catch (error) {
    ctx.logger.error('Processing failed', { error });
    return { success: false, error: 'Processing failed' };
  }
}
```
