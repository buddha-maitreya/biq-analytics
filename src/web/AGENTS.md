# AI Agent Instructions — Frontend (`src/web/`)

> **SDK reference:** For full hook APIs, styling patterns, and RBAC conventions, see
> [`.agents/agentuity/sdk/web/AGENTS.md`](../../.agents/agentuity/sdk/web/AGENTS.md).

---

## Architecture

| Aspect             | Detail |
|--------------------|--------|
| Framework          | React 19 |
| State management   | `useState` / `useCallback` in `App.tsx` (no external state lib) |
| Navigation         | State-based — **no URL router** (`page` state drives `renderPage()`) |
| Styling            | Pure CSS in `styles/global.css` — **no Tailwind** |
| Charts             | Pure SVG — **no external chart libraries** |
| Hooks              | `@agentuity/react` (`useAPI`, `useWebsocket`, `useEventStream`, `useAuth`) |
| Provider           | `AgentuityProvider` wraps `<App />` in `main.tsx` |
| Auth               | JWT from `localStorage('biq_token')` + cookie fallback, checked on mount |
| Config             | `AppConfig` loaded via `useAPI<AppConfig>('GET /api/config')` |

---

## Entry Points

| File | Purpose |
|------|---------|
| `index.html` | HTML shell — mounts `#root`, loads `main.tsx` |
| `main.tsx` | React root — `StrictMode` → `AgentuityProvider` → `App` |
| `App.tsx` | Master layout — auth gate, sidebar, page routing, config hydration |
| `types.ts` | Shared types: `Page`, `AuthUser`, `AppConfig` |

---

## Pages (in `pages/`)

All pages receive `config: AppConfig` as a prop. Use `config.labels.*` for display text — never hardcode domain terms.

| File | Page Key | Description | RBAC |
|------|----------|-------------|------|
| `Dashboard.tsx` | `dashboard` | KPI cards, charts, recent activity | All roles |
| `ProductsPage.tsx` | `products` | Product CRUD, search, categories | manager+ |
| `OrdersPage.tsx` | `orders` | Order list, status workflow, details | staff+ |
| `CustomersPage.tsx` | `customers` | Customer directory, purchase history | staff+ |
| `InventoryPage.tsx` | `inventory` | Stock levels, movements, alerts | staff+ |
| `InvoicesPage.tsx` | `invoices` | Invoice generation, list, PDF | staff+ |
| `AssistantPage.tsx` | `assistant` | AI chat (business-assistant agent) | All roles |
| `ReportsPage.tsx` | `reports` | AI-narrated business reports | manager+ |
| `POSPage.tsx` | `pos` | Quick-sale / new order entry | staff+ |
| `InvoiceCheckerPage.tsx` | `invoice_checker` | Invoice validation tool | manager+ |
| `AdminPage.tsx` | `admin` / `settings` | Company settings, users, config | admin+ |
| `EmailPage.tsx` | `email` | Email composition | manager+ |
| `LoginPage.tsx` | — | Login form (shown when `!user`) | Public |
| `AboutPage.tsx` | `about` | Version, branding, credits | All roles |

---

## Components (in `components/`)

| File | Purpose |
|------|---------|
| `Sidebar.tsx` | Navigation sidebar — role-filtered nav items, mobile drawer, company branding |

### Adding new components

Place them in `components/`. If a component is page-specific and large, consider a subdirectory:

```
components/
  Sidebar.tsx
  ChatPanel/
    ChatPanel.tsx
    MessageBubble.tsx
    ToolCallCard.tsx
```

---

## Navigation Pattern

Navigation is state-driven in `App.tsx`:

```tsx
const [page, setPage] = useState<Page>('dashboard');

// Sidebar calls setPage via onNavigate prop
<Sidebar currentPage={page} onNavigate={setPage} ... />

// renderPage() switches on page state
const renderPage = () => {
  switch (page) {
    case 'dashboard': return <Dashboard config={cfg} />;
    case 'assistant': return <AssistantPage config={cfg} />;
    // ...
  }
};
```

**To add a new page:**
1. Add the page key to `Page` union in `types.ts`
2. Add entry to `PAGE_TITLES` record in `App.tsx`
3. Add `case` to `renderPage()` switch in `App.tsx`
4. Add nav item in `Sidebar.tsx` (with role gating)

---

## Auth Flow

1. On mount, `App.tsx` checks `/api/auth/me` (cookie + `biq_token` header).
2. If valid → `setUser(data.user)` → app renders.
3. If invalid → `<LoginPage>` renders.
4. `LoginPage` posts to `/api/auth/login` → receives JWT → stores in `localStorage('biq_token')` → calls `onLogin(user)`.
5. Logout: POST `/api/auth/logout` → clear `biq_token` → `setUser(null)`.

**AuthUser shape:**
```ts
interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;         // 'super_admin' | 'admin' | 'manager' | 'staff' | 'viewer'
  permissions: string[];
}
```

---

## Config-Driven Labels

**Never hardcode domain terms.** Always use `config.labels`:

```tsx
// ✅ Correct
<h1>{config.labels.productPlural}</h1>
<p>Create a new {config.labels.order}</p>

// ❌ Wrong — industry-specific
<h1>Products</h1>
<p>Create a new Sales Order</p>
```

Available labels: `product`, `productPlural`, `order`, `orderPlural`, `customer`, `customerPlural`, `warehouse`, `invoice`, `unitDefault`.

Other config values: `config.companyName`, `config.currency`, `config.timezone`, `config.primaryColor`, `config.companyLogoUrl`.

---

## Styling Rules

- **One global stylesheet:** `styles/global.css`
- **No Tailwind, no CSS-in-JS** — use semantic class names
- CSS class naming: `.page-header`, `.data-table`, `.stat-card`, `.nav-item.active`, etc.
- Mobile responsive: `.mobile-header` + `.hamburger-btn` in `App.tsx`, sidebar drawer via `mobileOpen` prop
- Use `config.primaryColor` for brand-accent when styling dynamically

---

## Data Fetching

Use `useAPI` from `@agentuity/react`:

```tsx
const { data, loading, error, refetch } = useAPI<Product[]>('GET /api/products');
```

For mutations, use `fetch` directly with the JWT header:

```tsx
const token = localStorage.getItem('biq_token');
const res = await fetch('/api/products', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  },
  body: JSON.stringify(payload),
});
```

---

## Real-Time Patterns (for Phase 8)

For streaming AI responses, use `useEventStream`:

```tsx
const { events, connected } = useEventStream('/api/chat/stream?sessionId=xxx');
```

Or raw `EventSource` with a reducer for complex state (see coder project patterns in SDK guide).

---

## File Quick-Reference

```
src/web/
├── index.html          ← HTML shell
├── main.tsx            ← React root (AgentuityProvider)
├── App.tsx             ← Auth gate + navigation + layout
├── types.ts            ← Page, AuthUser, AppConfig
├── styles/
│   └── global.css      ← All styles (no Tailwind)
├── components/
│   └── Sidebar.tsx     ← Navigation sidebar
└── pages/
    ├── Dashboard.tsx
    ├── ProductsPage.tsx
    ├── OrdersPage.tsx
    ├── CustomersPage.tsx
    ├── InventoryPage.tsx
    ├── InvoicesPage.tsx
    ├── AssistantPage.tsx   ← AI chat page (Phase 8 focus)
    ├── ReportsPage.tsx
    ├── POSPage.tsx
    ├── InvoiceCheckerPage.tsx
    ├── AdminPage.tsx
    ├── SettingsPage.tsx
    ├── EmailPage.tsx
    ├── LoginPage.tsx
    └── AboutPage.tsx
```
