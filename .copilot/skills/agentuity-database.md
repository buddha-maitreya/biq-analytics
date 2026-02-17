# Agentuity Database Services

Relational database storage using Bun's native SQL APIs and Drizzle ORM.

---

## Overview

Store structured data with queries, joins, and transactions using [Bun's native SQL APIs](https://bun.sh/docs/runtime/sql).

### When to Use Database Storage

| Storage Type | Best For |
|--------------|----------|
| **Database** | Structured data, complex queries, transactions, relational data |
| Key-Value | Fast lookups, caching, configuration |
| Vector | Semantic search, embeddings, RAG |
| Object (S3) | Files, images, documents, media |
| Durable Streams | Large exports, audit logs |

> **Credentials Auto-Injected**: When you create a database with `agentuity cloud db create`, the `DATABASE_URL` is automatically added to your `.env` file. During deployment, credentials are injected automatically.

---

## Creating a Database

```bash
# Create with default settings
agentuity cloud db create

# Create with name and description
agentuity cloud db create --name "users-db" --description "Primary user data store"
```

---

## Quick Start (Bun SQL)

```typescript
import { sql } from "bun";

// Query with automatic SQL injection protection
const users = await sql`SELECT * FROM users WHERE active = ${true}`;

// Insert data
await sql`INSERT INTO users (name, email) VALUES (${"Alice"}, ${"alice@example.com"})`;

// Update data
await sql`UPDATE users SET active = ${false} WHERE id = ${userId}`;

// Delete data
await sql`DELETE FROM users WHERE id = ${userId}`;
```

> **SQL Injection Prevention**: Always use template literal parameters (`${value}`) for dynamic values. Never concatenate strings into queries.

### Using in Agents

```typescript
import { createAgent } from '@agentuity/runtime';
import { sql } from "bun";

const agent = createAgent('UserQuery', {
  handler: async (ctx, input) => {
    const users = await sql`
      SELECT * FROM users
      WHERE active = ${true}
      AND created_at > ${input.since}
      ORDER BY created_at DESC
      LIMIT 10
    `;

    ctx.logger.info("Query results", { count: users.length });
    return { users };
  },
});
```

### Using in Routes

```typescript
import { createRouter } from '@agentuity/runtime';
import { sql } from "bun";

const router = createRouter();

router.get('/users', async (c) => {
  const limit = parseInt(c.req.query('limit') || '10');
  const users = await sql`
    SELECT id, name, email FROM users
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return c.json({ users });
});

router.post('/users', async (c) => {
  const body = await c.req.json();
  const result = await sql`
    INSERT INTO users (name, email)
    VALUES (${body.name}, ${body.email})
    RETURNING id, name, email
  `;
  return c.json({ user: result[0] }, 201);
});

export default router;
```

### Transactions (Bun SQL)

```typescript
import { sql } from "bun";

await sql.begin(async (tx) => {
  await tx`UPDATE accounts SET balance = balance - ${amount} WHERE id = ${fromAccount}`;
  await tx`UPDATE accounts SET balance = balance + ${amount} WHERE id = ${toAccount}`;
  await tx`INSERT INTO transfers (from_id, to_id, amount) VALUES (${fromAccount}, ${toAccount}, ${amount})`;
});
```

### Supported Databases

Bun's SQL API supports PostgreSQL, MySQL, and SQLite:

```typescript
import { SQL } from "bun";

// PostgreSQL (default, uses DATABASE_URL)
const users = await sql`SELECT * FROM users`;

// Custom PostgreSQL connection
const postgres = new SQL("postgres://user:pass@localhost:5432/mydb");

// MySQL
const mysql = new SQL("mysql://user:pass@localhost:3306/mydb");

// SQLite
const sqlite = new SQL("sqlite://data/app.db");
```

---

## Resilient Postgres Client (`@agentuity/postgres`)

Auto-reconnecting PostgreSQL client for serverless environments.

### Installation

```bash
bun add @agentuity/postgres
```

### Basic Usage

```typescript
import { postgres } from '@agentuity/postgres';

// Create client (uses DATABASE_URL by default)
const sql = postgres();

// Queries automatically retry on connection errors
const users = await sql`SELECT * FROM users WHERE active = ${true}`;
```

### Transactions

```typescript
const tx = await sql.begin();
try {
  await tx`UPDATE accounts SET balance = balance - ${100} WHERE name = ${'Alice'}`;
  await tx`UPDATE accounts SET balance = balance + ${100} WHERE name = ${'Bob'}`;
  await tx.commit();
} catch (error) {
  await tx.rollback();
  throw error;
}
```

#### Transaction Options

```typescript
const tx = await sql.begin({
  isolationLevel: 'serializable',  // 'read uncommitted' | 'read committed' | 'repeatable read' | 'serializable'
  readOnly: true,                   // Read-only transaction
  deferrable: true,                 // Deferrable transaction (only with serializable + readOnly)
});
```

#### Savepoints

```typescript
const tx = await sql.begin();
try {
  await tx`INSERT INTO users (name) VALUES (${'Alice'})`;

  const savepoint = await tx.savepoint();
  try {
    await tx`INSERT INTO users (name) VALUES (${'Bob'})`;
    throw new Error('Oops');
  } catch {
    await savepoint.rollback();  // Only rolls back Bob's insert
  }

  await tx.commit();  // Alice's insert is committed
} catch (error) {
  await tx.rollback();
  throw error;
}
```

### Configuration

```typescript
const sql = postgres({
  url: 'postgres://user:pass@localhost:5432/mydb',
  reconnect: {
    enabled: true,
    maxAttempts: 10,
    initialDelayMs: 100,
    maxDelayMs: 30000,
    multiplier: 2,
    jitterMs: 1000,
  },
  onclose: (error) => console.log('Connection closed', error),
  onreconnected: () => console.log('Reconnected!'),
});
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `url` | `string` | `DATABASE_URL` | PostgreSQL connection string |
| `hostname` | `string` | - | Database hostname |
| `port` | `number` | `5432` | Database port |
| `username` | `string` | - | Database username |
| `password` | `string` | - | Database password |
| `database` | `string` | - | Database name |
| `tls` | `boolean \| TLSConfig` | - | TLS configuration |
| `max` | `number` | `10` | Maximum connections in pool |
| `connectionTimeout` | `number` | `30000` | Connection timeout in ms |
| `idleTimeout` | `number` | `0` | Idle timeout in ms (0 = no timeout) |
| `preconnect` | `boolean` | `false` | Establish connection immediately |
| `reconnect.enabled` | `boolean` | `true` | Enable automatic reconnection |
| `reconnect.maxAttempts` | `number` | `10` | Maximum reconnection attempts |
| `reconnect.initialDelayMs` | `number` | `100` | Initial delay before first retry |
| `reconnect.maxDelayMs` | `number` | `30000` | Maximum delay between retries |
| `reconnect.multiplier` | `number` | `2` | Exponential backoff multiplier |
| `reconnect.jitterMs` | `number` | `1000` | Maximum random jitter added to delays |

### TLS Configuration

```typescript
import fs from 'node:fs';
import { postgres } from '@agentuity/postgres';

const sql = postgres({
  url: 'postgres://user:pass@localhost:5432/mydb',
  tls: {
    require: true,
    rejectUnauthorized: false,
    ca: fs.readFileSync('ca.pem'),
    cert: fs.readFileSync('cert.pem'),
    key: fs.readFileSync('key.pem'),
  },
});
```

### Lazy Connection Behavior

By default, connections are established lazily on first query:

```typescript
const sql = postgres();
console.log(sql.connected);  // false (no TCP connection yet)
await sql`SELECT 1`;
console.log(sql.connected);  // true (connection established)
```

Set `preconnect: true` to establish immediately:

```typescript
const sql = postgres({ preconnect: true });
console.log(sql.connected);  // true (if successful)
```

### Connection Stats

```typescript
const sql = postgres();
console.log(sql.stats);
```

| Property | Type | Description |
|----------|------|-------------|
| `connected` | `boolean` | Whether currently connected |
| `reconnecting` | `boolean` | Whether currently reconnecting |
| `totalConnections` | `number` | Total connections established |
| `reconnectAttempts` | `number` | Current reconnection attempt count |
| `failedReconnects` | `number` | Total failed reconnection attempts |
| `lastConnectedAt` | `Date \| null` | When last connected |
| `lastDisconnectedAt` | `Date \| null` | When last disconnected |
| `lastReconnectAttemptAt` | `Date \| null` | When last reconnection was attempted |

### Additional Methods

```typescript
// Wait for connection (up to 5 seconds)
await sql.waitForConnection(5000);

// Graceful shutdown
await sql.shutdown();

// Unsafe raw SQL (use with caution)
const result = await sql.unsafe('SELECT version()');

// Access underlying Bun.SQL instance
const bunSql = sql.raw;
```

### Error Handling

```typescript
import {
  PostgresError,
  ConnectionClosedError,
  ReconnectFailedError,
  QueryTimeoutError,
  TransactionError,
  UnsupportedOperationError,
  isRetryableError,
} from '@agentuity/postgres';
```

| Error | Description |
|-------|-------------|
| `PostgresError` | Base error for PostgreSQL issues (includes `code` and `query`) |
| `ConnectionClosedError` | Thrown when using a closed connection (`wasReconnecting` flag) |
| `ReconnectFailedError` | Thrown after exhausting all reconnection attempts |
| `QueryTimeoutError` | Thrown when a query exceeds the timeout |
| `TransactionError` | Thrown on transaction failures (has `phase`: begin, commit, rollback, etc.) |
| `UnsupportedOperationError` | Thrown for unsupported operations like `reserve()` |

### Global Registry

```typescript
import {
  shutdownAll,
  getClientCount,
  getClients,
  hasActiveClients,
} from '@agentuity/postgres';

// Check active clients
console.log('Client count:', getClientCount());

// Graceful shutdown with timeout
process.on('SIGTERM', async () => {
  await shutdownAll(5000);
  process.exit(0);
});
```

When `@agentuity/runtime` is available, the package automatically registers a shutdown hook.

---

## Drizzle ORM (`@agentuity/drizzle`)

Type-safe database access with [Drizzle ORM](https://orm.drizzle.team/), built on the resilient `@agentuity/postgres` client.

### Installation

```bash
bun add @agentuity/drizzle drizzle-orm
```

### Basic Usage

```typescript
import { createPostgresDrizzle, eq } from '@agentuity/drizzle';
import * as schema from './schema';

const { db, close } = createPostgresDrizzle({ schema });

// Type-safe queries
const activeUsers = await db
  .select()
  .from(schema.users)
  .where(eq(schema.users.active, true));

// Insert with returning
const [newUser] = await db
  .insert(schema.users)
  .values({ name: 'Alice', email: 'alice@example.com' })
  .returning();
```

### Defining Your Schema

```typescript
// schema.ts
import { pgTable, serial, text, boolean, timestamp } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  active: boolean('active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
});
```

### Transactions

```typescript
await db.transaction(async (tx) => {
  await tx.update(schema.accounts)
    .set({ balance: sql`balance - ${100}` })
    .where(eq(schema.accounts.name, 'Alice'));

  await tx.update(schema.accounts)
    .set({ balance: sql`balance + ${100}` })
    .where(eq(schema.accounts.name, 'Bob'));
});
```

### Configuration

```typescript
const { db, client, close } = createPostgresDrizzle({
  schema,
  url: 'postgres://user:pass@localhost:5432/mydb',
  logger: true,
  reconnect: { maxAttempts: 5 },
  onReconnected: () => console.log('Reconnected'),
});
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `schema` | `object` | - | Your Drizzle schema definition |
| `url` | `string` | `DATABASE_URL` | PostgreSQL connection string |
| `logger` | `boolean` | `false` | Enable query logging |
| `reconnect` | `object` | - | Reconnection settings (see postgres client section) |
| `onReconnected` | `() => void` | - | Callback when reconnection succeeds |

### Re-exported Utilities

```typescript
import {
  // Query operators
  eq, ne, gt, gte, lt, lte,
  and, or, not,
  isNull, isNotNull,
  inArray, notInArray,
  between, like, ilike,

  // Ordering
  asc, desc,

  // SQL helpers
  sql,
} from '@agentuity/drizzle';
```

### Migrations

```bash
bun add -D drizzle-kit
```

```typescript
// drizzle.config.ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

```bash
# Generate migrations from schema changes
bunx drizzle-kit generate

# Apply migrations to database
bunx drizzle-kit migrate
```

### Auth Integration

```typescript
import { createPostgresDrizzle, drizzleAdapter } from '@agentuity/drizzle';
import * as schema from './schema';

const { db } = createPostgresDrizzle({ schema });
const authAdapter = drizzleAdapter(db);
```

---

## Key Patterns for This Project

### Standalone Scripts (Seed, Migrations)

For scripts that run outside the Agentuity runtime (e.g., seed scripts), use `createPostgresDrizzle` from `@agentuity/drizzle` which reads `DATABASE_URL` automatically:

```typescript
import { createPostgresDrizzle } from '@agentuity/drizzle';
import * as schema from '../src/db/schema';

const { db, close } = createPostgresDrizzle({ schema });

// ... do work ...

await close(); // Always close when done
```

### In Agents and Routes

The app's `src/db/index.ts` exports a shared `db` instance created with `createPostgresDrizzle({ schema })`. Import and use it directly:

```typescript
import { db } from '@db/index';
```

### Database Provisioning

```bash
# Create database (auto-injects DATABASE_URL into .env and deployment secrets)
agentuity cloud db create --name "client-db"

# Pull env vars (including DATABASE_URL) to local .env
agentuity cloud env pull
```
