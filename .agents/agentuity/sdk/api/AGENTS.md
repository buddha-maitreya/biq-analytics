# APIs Folder Guide

This folder contains REST API routes for your Agentuity application. Routes are organized as individual TypeScript files.

## Generated Types

The `src/generated/` folder contains auto-generated TypeScript files:

- `routes.ts` - Route registry with strongly-typed route definitions and schema types
- `registry.ts` - Agent registry (for calling agents from routes)
- `app.ts` - Application entry point (regenerated on every build)

**Important:** Never edit files in `src/generated/` - they are overwritten on every build.

## Directory Structure

This project uses a **flat file structure** for API routes (not subdirectories):

```
src/api/
├── index.ts         — Barrel file: exports all route modules
├── auth.ts          — Authentication (login, register, me, logout)
├── config.ts        — App config & health check
├── products.ts      — Product CRUD
├── categories.ts    — Category CRUD + tree
├── customers.ts     — Customer CRUD + search
├── warehouses.ts    — Warehouse CRUD
├── inventory.ts     — Stock adjust, transfer, low-stock
├── orders.ts        — Order lifecycle
├── invoices.ts      — Invoice generation & payment tracking
├── payments.ts      — Payment processing (Paystack, M-Pesa)
├── pricing.ts       — Price calculation & tax rules
├── admin.ts         — Admin console (users, order statuses, tax rules)
├── documents.ts     — Knowledge base document management (RAG)
├── settings.ts      — Business settings CRUD
├── chat.ts          — AI business assistant chat
├── reports.ts       — AI-powered report generation
└── kra.ts           — KRA eTIMS invoice verification
```

Routes are exported from `index.ts` and mounted by the Agentuity router config.

## Creating a Route

### Basic Route

```typescript
import { createRouter } from '@agentuity/runtime';

const router = createRouter();

router.get('/', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

router.post('/', async (c) => {
  const body = await c.req.json();
  return c.json({ received: body });
});

export default router;
```

### Route with Database Access

```typescript
import { createRouter } from '@agentuity/runtime';
import { db } from '@db/index';
import { products } from '@db/schema';
import { eq } from 'drizzle-orm';

const router = createRouter();

router.get('/', async (c) => {
  const allProducts = await db.query.products.findMany({
    where: eq(products.isActive, true),
    with: { category: true },
    orderBy: (p, { desc }) => [desc(p.createdAt)],
  });
  return c.json(allProducts);
});

router.get('/:id', async (c) => {
  const id = c.req.param('id');
  const product = await db.query.products.findFirst({
    where: eq(products.id, id),
    with: { category: true, inventory: true },
  });
  if (!product) return c.json({ error: 'Not found' }, 404);
  return c.json(product);
});

export default router;
```

### Route Calling Agents

Routes can call agents directly:

```typescript
import { createRouter } from '@agentuity/runtime';
import businessAssistant from '@agent/business-assistant';
import reportGenerator from '@agent/report-generator';

const router = createRouter();

router.post('/', async (c) => {
  const { message } = await c.req.json();
  const result = await businessAssistant.run({ message });
  return c.json(result);
});

router.post('/reports', async (c) => {
  const body = await c.req.json();
  const report = await reportGenerator.run(body);
  return c.json(report);
});

export default router;
```

## Authentication

### Auth Pattern

This project uses **jose (HS256 JWT)** + **Bun.password (bcrypt)** for authentication.

- Token stored in cookie `biq_token` + localStorage + `Authorization: Bearer` header
- Auth context key: `"authUser"` (NOT `"user"` — avoids Hono type conflict)
- 5-tier RBAC: `super_admin > admin > manager > staff > viewer`

### Auth Middleware

Auth middleware is defined in `src/api/auth.ts` with a public path skip-list.
Protected routes access the user via:

```typescript
const user = c.get('authUser' as any);
```

### RBAC Permission Check

```typescript
import { requireRole, requirePermission } from '@lib/validation';

router.post('/admin-only', async (c) => {
  const user = c.get('authUser' as any);
  requireRole(user.role, 'admin'); // Throws 403 if insufficient
  // ... admin operation
});
```

### Public vs Protected Routes

- **Public**: `/api/auth/login`, `/api/auth/register`, `/api/config`
- **Protected**: All other `/api/*` routes (require valid JWT)

## Route Context (c)

The handler receives a Hono context object with:

- **c.req** - Request (c.req.json(), c.req.param(), c.req.query())
- **c.json()** - Return JSON response
- **c.text()** - Return text response
- **c.redirect()** - Redirect to URL
- **c.get('authUser' as any)** - Authenticated user (from JWT middleware)
- **c.var.logger** - Structured logger (info, warn, error, debug, trace)
- **c.var.kv** - Key-value storage
- **c.var.vector** - Vector storage

## Pagination Pattern

Standard pagination helper from `src/lib/pagination.ts`:

```typescript
import { paginate } from '@lib/pagination';

router.get('/', async (c) => {
  const { page, limit, offset } = paginate(c.req.query());
  
  const items = await db.query.products.findMany({
    limit,
    offset,
    orderBy: (p, { desc }) => [desc(p.createdAt)],
  });

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(products);

  return c.json({ data: items, total: count, page, limit });
});
```

## Error Handling Pattern

Standard error responses from `src/lib/errors.ts`:

```typescript
import { AppError, notFound, badRequest, forbidden } from '@lib/errors';

router.get('/:id', async (c) => {
  const product = await db.query.products.findFirst({
    where: eq(products.id, c.req.param('id')),
  });
  if (!product) throw notFound('Product');
  return c.json(product);
});

router.post('/', async (c) => {
  const body = await c.req.json();
  if (!body.name) throw badRequest('Name is required');
  // ...
});
```

## Streaming Routes (SSE / WebSocket)

```typescript
import { createRouter, stream, sse, websocket } from '@agentuity/runtime';

const router = createRouter();

// Server-Sent Events
router.get('/events', sse((c, stream) => {
  stream.writeSSE({ data: 'Hello', event: 'message' });
}));

// WebSocket
router.get('/ws', websocket((c, ws) => {
  ws.onOpen(() => ws.send('Connected'));
  ws.onMessage((event) => ws.send(`Echo: ${event.data}`));
}));

export default router;
```

## Service Layer

Business logic is in `src/services/`:

```typescript
import { ProductService } from '@services/index';

router.post('/', async (c) => {
  const body = await c.req.json();
  const product = await ProductService.create(body);
  return c.json(product, 201);
});
```

Services available: `ProductService`, `CategoryService`, `CustomerService`, `InventoryService`, `OrderService`, `InvoiceService`, `PaymentService`, `AdminService`.

## HTTP Methods

```typescript
router.get('/path', handler);
router.post('/path', handler);
router.put('/path', handler);
router.patch('/path', handler);
router.delete('/path', handler);
```

## Path & Query Parameters

```typescript
// Path params: /api/products/:id
const id = c.req.param('id');

// Query params: /api/products?page=1&limit=20
const page = c.req.query('page') ?? '1';
const search = c.req.query('search');
```

## Response Patterns

```typescript
return c.json({ data: items }, 200);          // Success
return c.json(item, 201);                      // Created
return c.json({ error: 'Not found' }, 404);    // Not found
return c.json({ error: 'Forbidden' }, 403);    // Forbidden
return c.json({ error: 'Bad request' }, 400);  // Validation error
```

## Rules

- Route files are flat in `src/api/` (not subdirectories)
- Each file exports `default router` created via `createRouter()`
- All routes are exported from `src/api/index.ts` barrel file
- Routes are mounted at `/api/{routeName}` by the Agentuity router config
- Use `c.var.logger` for logging, never `console.log`
- Use `'authUser'` (not `'user'`) for auth context access
- Import agents directly: `import agent from '@agent/name'`
- Business logic belongs in `src/services/`, not in route handlers
- Use `paginate()` for list endpoints
- Use `AppError` / error helpers for uniform error responses
- Database access via `db` from `@db/index`
