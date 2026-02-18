# Web Folder Guide

This folder contains the React-based web application that communicates with the Agentuity backend.

## Generated Types

The `src/generated/` folder contains auto-generated TypeScript files:

- `routes.ts` - Route registry with type-safe API, WebSocket, and SSE route definitions
- `registry.ts` - Agent registry with input/output types

**Important:** Never edit files in `src/generated/` - they are overwritten on every build.

## Directory Structure

```
src/web/
├── App.tsx           — Main application component (routing, layout, state)
├── main.tsx          — Frontend entry point (React root render)
├── index.html        — HTML template
├── types.ts          — Shared frontend type definitions
├── components/
│   └── Sidebar.tsx   — Navigation sidebar (mobile drawer + desktop)
├── pages/
│   ├── LoginPage.tsx
│   ├── Dashboard.tsx
│   ├── ProductsPage.tsx
│   ├── OrdersPage.tsx
│   ├── InventoryPage.tsx
│   ├── InvoicesPage.tsx
│   ├── CustomersPage.tsx
│   ├── ReportsPage.tsx
│   ├── AssistantPage.tsx
│   ├── AdminPage.tsx
│   ├── EmailPage.tsx
│   ├── POSPage.tsx
│   ├── InvoiceCheckerPage.tsx
│   ├── AboutPage.tsx
│   └── SettingsPage.tsx
└── styles/
    └── global.css    — All styles (no Tailwind — pure CSS)
```

## Architecture

### Single-Page Application

The app uses a **page-based SPA** pattern managed by `App.tsx`:

- `App.tsx` holds the current page state (`currentPage`)
- `Sidebar.tsx` handles navigation (desktop + mobile drawer)
- Each page is a self-contained React component
- Pages use `useAPI` from `@agentuity/react` for data fetching

### No Router Library

Navigation is state-based, not URL-based:

```typescript
// In App.tsx
const [currentPage, setCurrentPage] = useState<Page>('dashboard');

// Render current page
{currentPage === 'dashboard' && <Dashboard />}
{currentPage === 'products' && <ProductsPage />}
```

### Authentication Flow

1. `LoginPage` calls `POST /api/auth/login`
2. JWT token stored in cookie `biq_token` + localStorage
3. `App.tsx` checks auth on mount, redirects to login if invalid
4. Token sent via `Authorization: Bearer` header on all API calls

## Creating Components

### Page Component

```typescript
import { useAPI } from '@agentuity/react';
import { useState, useEffect } from 'react';

export default function MyPage() {
  const { data, isLoading, error, refetch } = useAPI('GET /api/my-endpoint');
  const { invoke: createItem } = useAPI('POST /api/my-endpoint');

  if (isLoading) return <div className="loading-spinner" />;
  if (error) return <div className="error-message">{error.message}</div>;

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>My Page</h1>
        <button className="btn btn-primary" onClick={() => createItem({ name: 'New' })}>
          Add New
        </button>
      </div>
      <div className="card">
        {/* content */}
      </div>
    </div>
  );
}
```

### Adding a New Page

1. Create `src/web/pages/NewPage.tsx`
2. Add page key to `types.ts`: `export type Page = ... | 'newpage';`
3. Import and render in `App.tsx`
4. Add navigation item in `Sidebar.tsx`
5. Add RBAC visibility in `Sidebar.tsx` `ROLE_VISIBLE` map

## React Hooks

### useAPI — Type-Safe API Calls

**Always use `useAPI` instead of `fetch()`.**

```typescript
import { useAPI } from '@agentuity/react';

// GET — auto-executes, returns data + refetch
const { data, isLoading, error, refetch } = useAPI('GET /api/products');

// POST — returns invoke for manual execution
const { invoke, data: result, isLoading: saving } = useAPI('POST /api/products');

const handleCreate = async () => {
  await invoke({ name: 'Widget', price: 9.99, unit: 'piece' });
};
```

**Return values:**

| Property     | Type                     | Description                             |
| ------------ | ------------------------ | --------------------------------------- |
| `data`       | `T \| undefined`         | Response data (typed from route schema) |
| `error`      | `Error \| null`          | Error if request failed                 |
| `isLoading`  | `boolean`                | True during initial load                |
| `isFetching` | `boolean`                | True during any fetch (including refetch) |
| `isSuccess`  | `boolean`                | True if last request succeeded          |
| `isError`    | `boolean`                | True if last request failed             |
| `invoke`     | `(input?) => Promise<T>` | Manual trigger (POST/PUT/DELETE)        |
| `refetch`    | `() => Promise<void>`    | Refetch data (GET)                      |
| `reset`      | `() => void`             | Reset state to initial                  |

### useAPI Options

```typescript
// GET with query parameters
const { data } = useAPI({
  route: 'GET /api/products',
  query: { page: '1', limit: '20', search: 'widget' },
  staleTime: 5000,
  refetchInterval: 30000,
});

// POST with callbacks
const { invoke } = useAPI({
  route: 'POST /api/orders',
  onSuccess: (data) => { refetchOrders(); showToast('Order created'); },
  onError: (error) => { showToast(error.message, 'error'); },
});
```

### useWebsocket — Real-Time Communication

```typescript
import { useWebsocket } from '@agentuity/react';

const { isConnected, data, send, messages, clearMessages } = useWebsocket('/api/live');
```

### useEventStream — Server-Sent Events

```typescript
import { useEventStream } from '@agentuity/react';

const { isConnected, data, error, close } = useEventStream('/api/notifications');
```

### useAuth — Authentication State

```typescript
import { useAuth } from '@agentuity/react';

const { isAuthenticated, authHeader, setAuthHeader } = useAuth();
```

## Styling

### CSS Architecture

This project uses **pure CSS** (no Tailwind). All styles are in `src/web/styles/global.css`.

Common CSS classes:

| Class | Purpose |
|-------|---------|
| `.page-container` | Page wrapper with padding |
| `.page-header` | Flex header with title + actions |
| `.card` | Content card with border, shadow |
| `.table-card` | Scrollable table container |
| `.btn` | Base button styles |
| `.btn-primary` | Primary action button |
| `.btn-secondary` | Secondary button |
| `.btn-danger` | Destructive action button |
| `.form-group` | Form field wrapper |
| `.form-label` | Input label |
| `.form-input` | Text input / select |
| `.modal-overlay` | Modal backdrop |
| `.modal-content` | Modal body |
| `.loading-spinner` | Loading indicator |
| `.error-message` | Error display |
| `.badge` | Status / category badge |

### Mobile Responsive

The app is mobile-optimized with:

- Sidebar becomes a drawer (hamburger toggle) on mobile
- Touch targets ≥ 44px
- Input font-size 16px (prevents iOS zoom)
- Tables have horizontal scroll on narrow screens
- Media queries at 768px and 480px breakpoints

### Adding Styles

Add to `src/web/styles/global.css`:

```css
.my-component {
  padding: 1rem;
  border-radius: 8px;
  background: var(--bg-card);
}

@media (max-width: 768px) {
  .my-component {
    padding: 0.5rem;
  }
}
```

## RBAC (Role-Based Access Control)

Pages are visibility-controlled by user role in `Sidebar.tsx`:

```typescript
const ROLE_VISIBLE: Record<string, Page[]> = {
  super_admin: ['dashboard', 'products', 'orders', 'inventory', ...all pages],
  admin:       ['dashboard', 'products', 'orders', ...most pages],
  manager:     ['dashboard', 'products', 'orders', ...operational pages],
  staff:       ['dashboard', 'products', 'orders'],
  viewer:      ['dashboard'],
};
```

The `EmailPage` is restricted to `super_admin` only.

## Chart Components

Pure SVG chart components (no D3 or chart libraries):

```typescript
import { LineChart, BarChart, PieChart } from './components/Charts';

<LineChart
  data={revenueData}
  xKey="date"
  yKey="revenue"
  xLabel="Date"
  yLabel="Revenue"
/>

<BarChart
  data={productData}
  xKey="name"
  yKey="sales"
/>

<PieChart
  data={categoryData}
  labelKey="category"
  valueKey="amount"
  size={150}
/>
```

## Configuration-Driven Labels

UI labels come from the backend config endpoint (`GET /api/config`):

```typescript
// Labels from environment variables
config.labels.product      // "Product", "Item", "Ingredient", etc.
config.labels.order        // "Order", "Ticket", "Work Order", etc.
config.labels.customer     // "Customer", "Client", "Account", etc.
```

**Never hardcode** business terms in the frontend. Always use config labels.

Exception: "Business IQ Enterprise" and "Powered by Ruskins AI" are hardcoded branding.

## Entry Point

### main.tsx

```typescript
import { AgentuityProvider } from '@agentuity/react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <AgentuityProvider>
    <App />
  </AgentuityProvider>
);
```

### index.html

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Business IQ Enterprise</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/web/main.tsx"></script>
</body>
</html>
```

## Rules

- **App.tsx** must export function `App`
- **main.tsx** renders `App` into `#root` wrapped in `AgentuityProvider`
- **Never use raw `fetch()`** — always use `useAPI` or `createClient`
- All styles in `src/web/styles/global.css` — no inline styles, no Tailwind
- Navigate via `setCurrentPage()` state — no URL router
- Access auth user via `useAuth()` hook
- Config labels via `GET /api/config` — never hardcode business terms
- SVG chart components — no external chart libraries
- Mobile-first: always add responsive styles for new components
- RBAC: restrict pages by role in `Sidebar.tsx` `ROLE_VISIBLE`
