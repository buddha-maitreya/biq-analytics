# Agentuity Sandbox

Isolated execution environments for running untrusted code, AI agents, and browser automation.

---

## Overview

Sandboxes provide isolated containers for executing code safely. Use them for:
- Running untrusted or user-generated code
- AI agent execution (Claude Code, Codex, etc.)
- Browser automation and testing
- Dynamic code generation and execution

---

## Key Concepts

**Runtime → Sandbox → Snapshot**:
- **Runtime**: A pre-configured environment template (language, tools, dependencies)
- **Sandbox**: A running instance of a runtime — your isolated execution environment
- **Snapshot**: A saved filesystem state that can be restored for faster cold starts

---

## Available Runtimes

### Language Runtimes

| Runtime | Description |
|---|---|
| `base` | Minimal Linux container |
| `bun:1` | Bun 1.x JavaScript/TypeScript runtime |
| `node` | Node.js runtime |
| `python` | Python runtime |
| `golang` | Go runtime |

### Agent Runtimes

| Runtime | Description |
|---|---|
| `claude-code` | Anthropic's Claude Code agent |
| `amp` | Sourcegraph's Amp agent |
| `codex` | OpenAI's Codex agent |
| `gemini-cli` | Google's Gemini CLI agent |
| `opencode` | Open-source coding agent |
| `agentuity` | Agentuity's own agent runtime |

### Testing Runtimes

| Runtime | Description |
|---|---|
| `agent-browser` | Browser automation for agents |
| `playwright` | Playwright browser testing |

---

## Two Execution Modes

### One-Shot Execution (`sandbox.run()`)

Execute a command and get the result. The sandbox is created, runs the command, and is destroyed automatically.

```ts
import { createAgent } from '@agentuity/runtime';

const agent = createAgent('CodeRunner', {
  handler: async (ctx, input) => {
    const result = await ctx.sandbox.run({
      runtime: 'bun:1',
      command: `bun eval "${input.code}"`,
      timeout: { execution: 30000 },  // 30 second max
    });

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  },
});
```

### Interactive Sessions (`sandbox.create()`)

Create a persistent sandbox for multiple commands and file operations.

```ts
import { createAgent } from '@agentuity/runtime';

const agent = createAgent('InteractiveRunner', {
  handler: async (ctx, input) => {
    const sandbox = await ctx.sandbox.create({
      runtime: 'bun:1',
      timeout: { idle: 300000 },  // 5 min idle timeout
    });

    // Execute multiple commands
    await sandbox.exec('bun init -y');
    await sandbox.exec('bun add zod');

    // Write files
    await sandbox.writeFile('index.ts', input.code);

    // Run and get output
    const result = await sandbox.exec('bun run index.ts');

    // Optionally save state for reuse
    const snapshot = await sandbox.snapshot();

    return {
      output: result.stdout,
      snapshotId: snapshot.id,
    };
  },
});
```

---

## Access Patterns

| Context | Access |
|---|---|
| Agents | `ctx.sandbox` |
| Routes | `c.var.sandbox` |
| Standalone | `createAgentContext()` |

---

## Configuration Options

```ts
const sandbox = await ctx.sandbox.create({
  // Runtime selection
  runtime: 'bun:1',

  // Resource limits
  resources: {
    memory: '512MB',   // Memory limit
    cpu: 1,            // CPU cores
    disk: '1GB',       // Disk space
  },

  // Network controls
  network: {
    enabled: true,     // Allow network access
    port: 3000,        // Expose a port
  },

  // Timeouts
  timeout: {
    idle: 300000,      // Idle timeout (ms)
    execution: 60000,  // Max execution time (ms)
  },

  // Pre-install dependencies
  dependencies: ['zod', 'lodash'],

  // Environment variables
  env: {
    NODE_ENV: 'production',
    API_KEY: process.env.SANDBOX_API_KEY,
  },

  // Restore from snapshot
  snapshot: 'snapshot-id-here',
});
```

---

## Snapshots

Save and restore sandbox filesystem states for faster cold starts:

```ts
// Create a sandbox and install dependencies
const sandbox = await ctx.sandbox.create({ runtime: 'bun:1' });
await sandbox.exec('bun add zod drizzle-orm');

// Save snapshot
const snapshot = await sandbox.snapshot();

// Later: restore from snapshot (deps already installed)
const fastSandbox = await ctx.sandbox.create({
  runtime: 'bun:1',
  snapshot: snapshot.id,
});
```

---

## When to Use Sandboxes

| Use Case | Why Sandbox |
|---|---|
| User-submitted code | Isolation prevents malicious code from affecting your system |
| AI code generation | Let LLMs generate and test code safely |
| Browser testing | Run Playwright tests in isolated environments |
| Build pipelines | Compile and test code without polluting your environment |
| Multi-language execution | Run Python, Go, Node.js code from a Bun agent |

---

## Security

- **Isolated containers**: Each sandbox runs in its own container
- **Resource limits**: Memory, CPU, and disk are capped
- **Network controls**: Network access can be disabled entirely
- **Timeouts**: Automatic cleanup on idle or execution timeout
- **No host access**: Sandboxes cannot access the host filesystem or processes

---

## Using in Routes

```ts
import { createRouter } from '@agentuity/runtime';

const router = createRouter();

router.post('/execute', async (c) => {
  const { code, language } = await c.req.json();

  const result = await c.var.sandbox.run({
    runtime: language === 'python' ? 'python' : 'bun:1',
    command: language === 'python'
      ? `python3 -c "${code}"`
      : `bun eval "${code}"`,
    timeout: { execution: 10000 },
    network: { enabled: false },
  });

  return c.json({
    output: result.stdout,
    errors: result.stderr,
    exitCode: result.exitCode,
  });
});

export default router;
```

---

## Best Practices

- **Set resource limits** to prevent runaway processes
- **Disable network** for untrusted code execution
- **Use snapshots** for environments with heavy dependency installation
- **Set execution timeouts** to prevent infinite loops
- **Use one-shot** (`sandbox.run()`) for simple, single-command execution
- **Use interactive** (`sandbox.create()`) for multi-step workflows
