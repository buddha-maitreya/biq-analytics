# Agentuity — App Configuration

> Source: https://agentuity.dev/Get-Started/app-configuration

## agentuity.json

The project configuration file:

```json
{
  "name": "business-iq-enterprise",
  "orgId": "org_...",
  "projectId": "proj_..."
}
```

No agent definitions, no trigger configurations. Those live in your code.

## app.ts

The app entry point configures your application:

```typescript
import { createApp } from '@agentuity/runtime';

const { server, logger } = await createApp();
logger.debug('Running %s', server.url);
```

### With Lifecycle Hooks

Use `setup` to initialize resources (databases, clients) and `shutdown` to clean up:

```typescript
import { createApp } from '@agentuity/runtime';

const { server, logger } = await createApp({
  setup: async () => {
    const db = await connectDatabase();
    return { db }; // Available in agents via ctx.app
  },
  shutdown: async (state) => {
    await state.db.close();
  },
});

logger.debug('Running %s', server.url);
```

### With Custom Services

```typescript
import { createApp } from '@agentuity/runtime';

const { server, logger } = await createApp({
  cors: {
    origin: ['https://myapp.com'],
    credentials: true,
  },
  compression: {
    threshold: 1024, // Compress responses larger than 1KB
  },
  services: {
    keyvalue: myCustomKV,
    vector: myCustomVector,
  },
});
```

### Event Listeners

```typescript
import { createApp } from '@agentuity/runtime';

const app = await createApp();

app.addEventListener('agent.started', (event, agent, ctx) => {
  app.logger.info('Agent started', { name: agent.metadata.name });
});

app.addEventListener('agent.completed', (event, agent, ctx) => {
  app.logger.info('Agent completed', { session: ctx.sessionId });
});
```

## Build Configuration

For advanced build customization, create `agentuity.config.ts`:

```typescript
import type { AgentuityConfig } from '@agentuity/cli';

export default {
  // Configuration options here (Vite plugins, build-time constants, etc.)
} satisfies AgentuityConfig;
```

## Environment Variables

```bash
# Required
AGENTUITY_SDK_KEY=...        # API key for Agentuity services

# Optional
AGENTUITY_LOG_LEVEL=info     # trace, debug, info, warn, error
AGENTUITY_PORT=3500          # Dev server port (default: 3500)

# Resource Credentials (auto-added by CLI)
DATABASE_URL=postgresql://...   # Added by: agentuity cloud db create

# LLM Provider Keys (optional; if using your own API keys instead of AI Gateway)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...

# Frontend-accessible (exposed to browser)
AGENTUITY_PUBLIC_API_URL=...
VITE_MY_VAR=...
PUBLIC_MY_VAR=...
```

> **AI Gateway:** If you don't set provider API keys, LLM requests are routed through the Agentuity AI Gateway using your SDK key.

> **Public Environment Variables:** Variables prefixed with `AGENTUITY_PUBLIC_`, `VITE_`, or `PUBLIC_` are exposed to the frontend bundle. Never put secrets in these.

## Infrastructure as Code

Routes are defined in your codebase and automatically discovered:

```typescript
// src/api/index.ts
import { createRouter, cron, websocket } from '@agentuity/runtime';
import scheduler from '@agent/scheduler';
import chatHandler from '@agent/chat';

const router = createRouter();

// Cron job - runs every hour
router.post('/cleanup', cron('0 * * * *', async (c) => {
  await scheduler.run({ task: 'cleanup' });
  return c.text('OK');
}));

// WebSocket endpoint
router.get('/chat', websocket((c, ws) => {
  ws.onMessage(async (event) => {
    const response = await chatHandler.run({ message: event.data as string });
    ws.send(response);
  });
}));

export default router;
```

Benefits:
- **Self-contained deployments:** Rolling back restores exact configuration
- **Version control:** Infrastructure changes tracked in Git
- **No config drift:** What's in code is what runs
