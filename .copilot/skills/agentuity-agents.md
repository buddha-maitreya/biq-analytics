# Agentuity Agents

Comprehensive reference for creating agents, AI integration, state management, inter-agent communication, standalone execution, and best practices.

---

## Creating Agents

Each agent lives in `src/agent/<name>/agent.ts` and exports a default agent created with `createAgent()`.

### Basic Agent

```ts
import { createAgent } from '@agentuity/runtime';

const agent = createAgent('Greeter', {
  handler: async (ctx, input) => {
    ctx.logger.info('Processing request', { input });
    return { message: 'Hello from agent!' };
  },
});

export default agent;
```

### With Schema Validation

```ts
import { createAgent } from '@agentuity/runtime';
import { s } from '@agentuity/schema';

const agent = createAgent('Contact Form', {
  schema: {
    input: s.object({
      email: s.string(),
      message: s.string(),
    }),
    output: s.object({
      success: s.boolean(),
      id: s.string(),
    }),
  },
  handler: async (ctx, input) => {
    // input is typed as { email: string, message: string }
    ctx.logger.info('Received message', { from: input.email });
    return { success: true, id: crypto.randomUUID() };
  },
});

export default agent;
```

### With Zod Validation

```ts
import { createAgent } from '@agentuity/runtime';
import { z } from 'zod';

const agent = createAgent('Search', {
  schema: {
    input: z.object({
      query: z.string(),
      filters: z.object({
        category: z.enum(['tech', 'business', 'sports']),
        limit: z.number().default(10),
      }),
    }),
    output: z.object({
      results: z.array(z.string()),
      total: z.number(),
    }),
  },
  handler: async (ctx, input) => {
    const category = input.filters.category; // type: 'tech' | 'business' | 'sports'
    return { results: ['result1'], total: 1 };
  },
});
```

**Schema libraries supported**: `@agentuity/schema`, Zod, Valibot, ArkType — all implement StandardSchema.

### Type Inference

```ts
// Good: types inferred from schema
handler: async (ctx, input) => { ... }

// Bad: explicit types can cause issues
handler: async (ctx: AgentContext, input: MyInput) => { ... }
```

### Agent Name and Description

```ts
const agent = createAgent('Support Ticket Analyzer', {
  description: 'Analyzes support tickets and extracts key information',
  schema: { ... },
  handler: async (ctx, input) => { ... },
});
```

### Test Prompts for Workbench

```ts
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

---

## Handler Context (`ctx`)

```ts
handler: async (ctx, input) => {
  // Logging (ALWAYS use ctx.logger, never console.log)
  ctx.logger.info('Processing', { data: input });
  ctx.logger.error('Something failed', { error });

  // Identifiers
  ctx.sessionId;           // Unique per request (sess_...)
  ctx.thread.id;           // Conversation context (thrd_...)
  ctx.current.name;        // This agent's name
  ctx.current.agentId;     // Stable ID for namespacing

  // State management
  ctx.state.set('key', value);                    // Request-scoped (sync)
  await ctx.thread.state.set('key', value);       // Thread-scoped (async, 1hr)
  ctx.session.state.set('key', value);            // Session-scoped

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

---

## AI Integration

### With Vercel AI SDK

```ts
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
```

### With Provider SDKs Directly

```ts
import OpenAI from 'openai';
const client = new OpenAI();

handler: async (ctx, { prompt }) => {
  const completion = await client.chat.completions.create({
    model: 'gpt-5-mini',
    messages: [{ role: 'user', content: prompt }],
  });
  return completion.choices[0]?.message?.content ?? '';
}
```

### With Groq (Fast Inference)

```ts
import Groq from 'groq-sdk';
const client = new Groq();

handler: async (ctx, { prompt }) => {
  const completion = await client.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'user', content: prompt }],
  });
  return completion.choices[0]?.message?.content ?? '';
}
```

---

## AI Gateway

LLM requests are automatically routed through Agentuity's AI Gateway for unified billing, observability, and token tracking. No configuration needed.

### Supported Providers

| Provider | Package | Models |
|---|---|---|
| OpenAI | `@ai-sdk/openai` | gpt-5-mini, gpt-5 |
| Anthropic | `@ai-sdk/anthropic` | claude-sonnet-4-5, claude-haiku-4-5 |
| Google | `@ai-sdk/google` | gemini-2.5-pro, gemini-2.5-flash |
| xAI | `@ai-sdk/xai` | grok-3, grok-3-mini |
| DeepSeek | `@ai-sdk/deepseek` | deepseek-chat, deepseek-reasoner |
| Groq | `@ai-sdk/groq` | llama-3.3-70b-versatile, openai/gpt-oss-120b |
| Mistral | `@ai-sdk/mistral` | mistral-large, mistral-small |

### BYO API Keys

Set env vars to bypass the AI Gateway and use your own keys:

```
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_GENERATIVE_AI_API_KEY=...
```

---

## State Management

### State Scopes

| Scope | Lifetime | Access | Use For |
|---|---|---|---|
| Request | Single request | `ctx.state` (sync) | Timing, temp calculations |
| Thread | Up to 1 hour | `ctx.thread.state` (async) | Conversation history |
| Session | Single request | `ctx.session.state` (sync) | Session completion events |

**Threads wrap sessions**: A thread is a conversation; a session is one message in that conversation.

### Request State

```ts
ctx.state.set('startTime', Date.now());
// ... later
const duration = Date.now() - (ctx.state.get('startTime') as number);
```

### Thread State (Conversation Memory)

```ts
// All thread state methods are async
await ctx.thread.state.set('messages', messages);
const messages = await ctx.thread.state.get<Message[]>('messages') || [];
await ctx.thread.state.has('key');
await ctx.thread.state.delete('key');
await ctx.thread.state.clear();

// Array with sliding window
await ctx.thread.state.push('messages', newMessage, 100);  // Keep last 100

// Bulk access
const keys = await ctx.thread.state.keys();
const values = await ctx.thread.state.values<Message>();
const count = await ctx.thread.state.size();

// Reset conversation
await ctx.thread.destroy();
```

### Persisting to Storage (Load → Cache → Save)

```ts
handler: async (ctx, input) => {
  const key = `chat_${ctx.thread.id}`;
  let messages: Message[] = [];

  // Load from KV on first access
  if (!(await ctx.thread.state.has('kvLoaded'))) {
    const result = await ctx.kv.get<Message[]>('conversations', key);
    if (result.exists) messages = result.data;
    await ctx.thread.state.set('messages', messages);
    await ctx.thread.state.set('kvLoaded', true);
  } else {
    messages = await ctx.thread.state.get<Message[]>('messages') || [];
  }

  messages.push({ role: 'user', content: input.message });

  // Save in background
  ctx.waitUntil(async () => {
    const recentMessages = messages.slice(-20);
    await ctx.thread.state.set('messages', recentMessages);
    await ctx.kv.set('conversations', key, recentMessages, { ttl: 86400 });
  });
}
```

### Thread Lifecycle

```ts
// Archive data before thread expires (1 hour inactivity)
ctx.thread.addEventListener('destroyed', async (eventName, thread) => {
  const messages = await thread.state.get<string[]>('messages') || [];
  if (messages.length > 0) {
    await ctx.kv.set('archives', thread.id, {
      messages,
      endedAt: new Date().toISOString(),
    }, { ttl: 604800 });
  }
});
```

### State Size Limit

Thread and session state are limited to **1MB** after JSON serialization. Store large data in KV instead of state. Keep only recent messages (last 20–50).

---

## Calling Other Agents

### Basic Call

```ts
import enrichmentAgent from '@agent/enrichment';

const result = await enrichmentAgent.run({ text: input.text });
// TypeScript validates input and infers output type
```

### Communication Patterns

#### Sequential

```ts
const validated = await validatorAgent.run({ data: input.rawData });
const enriched = await enrichmentAgent.run({ data: validated.cleanData });
const analyzed = await analysisAgent.run({ data: enriched.enrichedData });
```

#### Parallel

```ts
const [webResults, dbResults, vectorResults] = await Promise.all([
  webSearchAgent.run({ query: input.query }),
  databaseAgent.run({ query: input.query }),
  vectorSearchAgent.run({ query: input.query }),
]);
```

#### Background (Fire-and-Forget)

```ts
ctx.waitUntil(async () => {
  await analyticsAgent.run({ event: 'processed', data: input.data });
});
return { status: 'accepted', id };
```

#### Conditional Routing (LLM Intent Classification)

```ts
const { object: intent } = await generateObject({
  model: groq('llama-3.3-70b'),
  schema: z.object({
    agentType: z.enum(['support', 'sales', 'technical']),
  }),
  prompt: input.message,
});

switch (intent.agentType) {
  case 'support': return supportAgent.run(input);
  case 'sales': return salesAgent.run(input);
  case 'technical': return technicalAgent.run(input);
}
```

#### Orchestrator Pattern

```ts
const draft = await writerAgent.run({ prompt: input.topic });
const evaluation = await evaluatorAgent.run({ content: draft.text });
return { content: draft.text, score: evaluation.score };
```

### Public Agents (Cross-Project)

```ts
const response = await fetch('https://agentuity.ai/api/agent-id-here', {
  method: 'POST',
  body: JSON.stringify({ query: input.query }),
  headers: { 'Content-Type': 'application/json' },
});
```

### Error Handling Patterns

#### Cascading Failures (Default)
```ts
const validated = await validatorAgent.run(input); // throws = stops
const processed = await processorAgent.run(validated);
```

#### Graceful Degradation
```ts
let enrichedData = input.data;
try {
  const enrichment = await enrichmentAgent.run({ data: input.data });
  enrichedData = enrichment.data;
} catch (error) {
  ctx.logger.warn('Enrichment failed, using original data');
}
return await processorAgent.run({ data: enrichedData });
```

#### Retry Pattern
```ts
async function callWithRetry<T>(fn: () => Promise<T>, maxRetries = 3, delayMs = 1000): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try { return await fn(); }
    catch (error) {
      if (attempt === maxRetries) throw error;
      const delay = delayMs * Math.pow(2, attempt - 1);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error('Retry failed');
}
```

#### Partial Failure
```ts
const results = await Promise.allSettled(
  input.items.map(item => processingAgent.run({ item }))
);
const successful = results.filter(r => r.status === 'fulfilled').map(r => r.value);
const failed = results.filter(r => r.status === 'rejected').map(r => r.reason);
```

### Shared Context

Agent calls share the same session context:
```ts
await ctx.thread.state.set('userId', input.userId);
const result = await processingAgent.run(input);
// processingAgent can access the same thread state
```

---

## Standalone Execution

Run agents without HTTP using `createAgentContext()`:

### Basic Usage

```ts
import { createAgentContext } from '@agentuity/runtime';
import chatAgent from '@agent/chat';

const ctx = createAgentContext();
const result = await ctx.run(chatAgent, { message: 'Hello' });
```

### Options

| Option | Type | Description |
|---|---|---|
| `sessionId` | `string` | Custom session ID |
| `trigger` | `string` | Trigger type: `'discord'`, `'cron'`, `'websocket'`, `'manual'` |
| `thread` | `Thread` | Custom thread for conversation state |
| `session` | `Session` | Custom session instance |
| `parentContext` | `Context` | Parent OpenTelemetry context |

### External Cron Job

```ts
import { createApp, createAgentContext } from '@agentuity/runtime';
import cron from 'node-cron';
import cleanupAgent from '@agent/cleanup';

await createApp();

cron.schedule('0 * * * *', async () => {
  const ctx = createAgentContext({ trigger: 'cron' });
  await ctx.run(cleanupAgent, { task: 'expired-sessions' });
});
```

### Multiple Agents in Sequence

```ts
const ctx = createAgentContext();
const analysis = await ctx.run(analyzeAgent, { text: userInput });
const response = await ctx.run(respondAgent, { analysis: analysis.summary });
```

### Detecting Context

```ts
import { inAgentContext, createAgentContext } from '@agentuity/runtime';

async function processRequest(data: unknown) {
  if (inAgentContext()) {
    return myAgent.run(data); // Inside agent handler
  }
  const ctx = createAgentContext();
  return ctx.run(myAgent, data); // Outside handler
}
```

---

## Best Practices

- **Single responsibility**: Each agent should have one clear purpose
- **Always define schemas**: Provides type safety and serves as documentation
- **Handle errors gracefully**: Wrap external calls in try-catch
- **Keep handlers focused**: Move complex logic to helper functions
- **Use ctx.logger**: Never use `console.log`
- **Use ctx.waitUntil()** for analytics, logging, notifications
- **Focused agents > monolithic agents**: Easier to test, reuse, maintain
- **Use schemas for type-safe** agent-to-agent communication
- **Bound state size**: Keep conversation history limited (last 20–50 messages)
- **Persist important data**: Don't rely on state for data that must survive restarts
