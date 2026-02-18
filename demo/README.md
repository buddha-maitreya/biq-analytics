# Demo Data & Credentials

Everything needed to set up and access the demo environment.

## Demo Login Credentials

All demo accounts use the same password: **`demo2025`**

| Role | Email | Access Level |
|------|-------|-------------|
| **Super Admin** | `superadmin@safaribiq.co.ke` | Full access — all modules, all settings, all users |
| **Admin** | `admin@safaribiq.co.ke` | Full access — all modules and settings |
| **Manager** | `ops@safaribiq.co.ke` | Dashboard, Products, Orders, Customers, Inventory, Invoices, Reports, New Order |
| **Staff** | `bookings@safaribiq.co.ke` | Dashboard, Products, Orders, Customers, Invoices, New Order |
| **Viewer** | `viewer@safaribiq.co.ke` | Dashboard, Products, Orders, Customers, Reports (read-only) |

## Seed Scripts

All scripts require `DATABASE_URL` to be set (auto-injected by Agentuity, or set manually).

### 1. `seed-demo.ts` — Full Demo Dataset
Populates categories, products, locations, inventory, customers, order statuses, users, orders, invoices, payments, pricing rules, and tax rules for a Kenyan safari & tourism company.

```bash
DATABASE_URL=<your-url> bun demo/seed-demo.ts
```

### 2. `seed-auth.ts` — Demo User Passwords
Creates/updates one user per role with bcrypt-hashed passwords. Run this **after** `seed-demo.ts`.

```bash
DATABASE_URL=<your-url> bun demo/seed-auth.ts
```

### 3. `seed-orders-90d.ts` — 90-Day Order History
Generates 65 orders spread across the last 90 days with backdated timestamps, matching invoices, and payments. Needed to populate the Dashboard sales trend chart.

```bash
DATABASE_URL=<your-url> bun demo/seed-orders-90d.ts
```

### Full Setup (run in order)
```bash
# 1. Run migrations
bunx drizzle-kit migrate

# 2. Seed all demo data
DATABASE_URL=<your-url> bun demo/seed-demo.ts

# 3. Set passwords for demo users
DATABASE_URL=<your-url> bun demo/seed-auth.ts

# 4. Generate 90-day order history (optional, for dashboard charts)
DATABASE_URL=<your-url> bun demo/seed-orders-90d.ts
```

## App URL
**Production:** https://business-iq-enterprise-38c52bf-philip-s-team-1771157881.agentuity.run
