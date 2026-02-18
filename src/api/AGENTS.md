See [.agents/agentuity/sdk/api/AGENTS.md](../../.agents/agentuity/sdk/api/AGENTS.md) for Agentuity API development guidelines.

---

# Business IQ Enterprise — API Routes

## Route Map

All routes are mounted under `/api/` by the Agentuity router. Auth middleware protects all routes except those marked **Public**.

| Route File | Mount Path | Auth | Description |
|------------|-----------|------|-------------|
| `config.ts` | `/api/config` | Public | App configuration + health check |
| `auth.ts` | `/api/auth` | Public (login/register), Protected (me/logout) | JWT authentication |
| `products.ts` | `/api/products` | Protected | Product CRUD + search |
| `categories.ts` | `/api/categories` | Protected | Category CRUD + tree structure |
| `customers.ts` | `/api/customers` | Protected | Customer CRUD + search |
| `warehouses.ts` | `/api/warehouses` | Protected | Warehouse/location CRUD |
| `inventory.ts` | `/api/inventory` | Protected | Stock levels, adjust, transfer, low-stock alerts |
| `orders.ts` | `/api/orders` | Protected | Order lifecycle (create → fulfill → complete) |
| `invoices.ts` | `/api/invoices` | Protected | Invoice generation, payment tracking |
| `payments.ts` | `/api/payments` | Protected | Payment processing (Paystack, M-Pesa) |
| `pricing.ts` | `/api/pricing` | Protected | Price calculation, tax rules |
| `admin.ts` | `/api/admin` | Protected (admin+) | User mgmt, order statuses, tax rules |
| `documents.ts` | `/api/documents` | Protected | Knowledge base document CRUD + RAG query |
| `settings.ts` | `/api/settings` | Protected | Business settings key-value store |
| `chat.ts` | `/api/chat` | Protected | AI business assistant (calls `business-assistant` agent) |
| `reports.ts` | `/api/reports` | Protected | AI report generation (calls `report-generator` agent) |
| `kra.ts` | `/api/kra` | Protected | KRA eTIMS invoice verification |

## Authentication

- **Method:** JWT (jose HS256, 24h expiry)
- **Password:** Bun.password (bcrypt, cost 12)
- **Token transport:** Cookie `biq_token` + `Authorization: Bearer <token>` header
- **Context access:** `c.get('authUser' as any)` returns `{ id, email, name, role }`

### Roles (5-tier RBAC)
```
super_admin > admin > manager > staff > viewer
```

### Auth Endpoints
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/auth/login` | Login with email + password → JWT |
| `POST` | `/api/auth/register` | Create new user (admin+ only) |
| `GET` | `/api/auth/me` | Current user profile |
| `POST` | `/api/auth/logout` | Clear auth cookie |

## Data Routes

### Products (`/api/products`)
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | List products (paginated, filterable) |
| `GET` | `/:id` | Get product by ID |
| `POST` | `/` | Create product |
| `PUT` | `/:id` | Update product |
| `DELETE` | `/:id` | Soft-delete product |

### Categories (`/api/categories`)
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | List categories (flat or tree) |
| `POST` | `/` | Create category |
| `PUT` | `/:id` | Update category |
| `DELETE` | `/:id` | Delete category |

### Customers (`/api/customers`)
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | List customers (paginated, searchable) |
| `GET` | `/:id` | Get customer by ID with order history |
| `POST` | `/` | Create customer |
| `PUT` | `/:id` | Update customer |

### Inventory (`/api/inventory`)
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | List stock levels by warehouse |
| `GET` | `/low-stock` | Low stock alerts |
| `POST` | `/adjust` | Stock adjustment (in/out) |
| `POST` | `/transfer` | Transfer between warehouses |

### Orders (`/api/orders`)
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | List orders (paginated, filterable by status/date) |
| `GET` | `/:id` | Get order with items + customer |
| `POST` | `/` | Create order (auto-decrement stock, auto-create invoice) |
| `PUT` | `/:id/status` | Update order status |

### Invoices (`/api/invoices`)
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | List invoices |
| `GET` | `/:id` | Get invoice details |
| `POST` | `/:id/payment` | Record payment against invoice |

### Payments (`/api/payments`)
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/paystack/initialize` | Start Paystack payment |
| `POST` | `/paystack/verify` | Verify Paystack payment |
| `POST` | `/mpesa/stk-push` | Initiate M-Pesa STK push |
| `POST` | `/mpesa/callback` | M-Pesa callback handler |

## AI Routes

### Chat (`/api/chat`)
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/` | Send message → `business-assistant` agent → reply |

### Reports (`/api/reports`)
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/` | Generate AI report → `report-generator` agent |
| `POST` | `/insights` | Get insights → `insights-analyzer` agent |

### Documents (`/api/documents`)
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | List knowledge base documents |
| `POST` | `/upload` | Upload + chunk + ingest into vector store |
| `POST` | `/query` | RAG query → `knowledge-base` agent |
| `DELETE` | `/:key` | Remove document from vector store |

## Admin Routes (`/api/admin`)

Requires `admin` or `super_admin` role.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/users` | List all users |
| `POST` | `/users` | Create user |
| `PUT` | `/users/:id` | Update user (role, active status) |
| `DELETE` | `/users/:id` | Deactivate user |
| `GET` | `/order-statuses` | List order workflow statuses |
| `POST` | `/order-statuses` | Create custom status |
| `PUT` | `/order-statuses/:id` | Update status |
| `GET` | `/tax-rules` | List tax rules |
| `POST` | `/tax-rules` | Create tax rule |
| `PUT` | `/tax-rules/:id` | Update tax rule |
