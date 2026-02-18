import { db, orderStatuses, taxRules, users, orders, invoices, payments, products, inventory, categories, customers, warehouses } from "@db/index";
import { eq, sql, gte, and, inArray, ne, asc, desc } from "drizzle-orm";
import { NotFoundError } from "@lib/errors";
import { z } from "zod";

// ─── Order Status Management ─────────────────────────────────

export const orderStatusSchema = z.object({
  name: z.string().min(1).max(100),
  label: z.string().min(1).max(100),
  color: z.string().max(20).optional(),
  sortOrder: z.number().int().optional(),
  isFinal: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export async function listOrderStatuses() {
  return db.query.orderStatuses.findMany({
    orderBy: [asc(orderStatuses.sortOrder)],
  });
}

export async function createOrderStatus(data: unknown) {
  const parsed = orderStatusSchema.parse(data);

  // If setting as default, unset others
  if (parsed.isDefault) {
    await db
      .update(orderStatuses)
      .set({ isDefault: false })
      .where(eq(orderStatuses.isDefault, true));
  }

  const [status] = await db
    .insert(orderStatuses)
    .values(parsed)
    .returning();

  return status;
}

export async function updateOrderStatus(id: string, data: unknown) {
  const parsed = orderStatusSchema.partial().parse(data);

  if (parsed.isDefault) {
    await db
      .update(orderStatuses)
      .set({ isDefault: false })
      .where(eq(orderStatuses.isDefault, true));
  }

  const [status] = await db
    .update(orderStatuses)
    .set(parsed)
    .where(eq(orderStatuses.id, id))
    .returning();

  if (!status) throw new NotFoundError("Order Status", id);
  return status;
}

export async function deleteOrderStatus(id: string) {
  const [status] = await db
    .delete(orderStatuses)
    .where(eq(orderStatuses.id, id))
    .returning();

  if (!status) throw new NotFoundError("Order Status", id);
  return status;
}

// ─── Tax Rule Management ─────────────────────────────────────

export const taxRuleSchema = z.object({
  name: z.string().min(1).max(255),
  rate: z.number().min(0).max(1),
  appliesTo: z.string().max(50).optional(),
  referenceId: z.string().uuid().optional(),
  isDefault: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export async function listTaxRules() {
  return db.query.taxRules.findMany({
    orderBy: [asc(taxRules.name)],
  });
}

export async function createTaxRule(data: unknown) {
  const parsed = taxRuleSchema.parse(data);

  if (parsed.isDefault) {
    await db
      .update(taxRules)
      .set({ isDefault: false })
      .where(eq(taxRules.isDefault, true));
  }

  const [rule] = await db
    .insert(taxRules)
    .values({ ...parsed, rate: String(parsed.rate) })
    .returning();

  return rule;
}

export async function updateTaxRule(id: string, data: unknown) {
  const parsed = taxRuleSchema.partial().parse(data);

  if (parsed.isDefault) {
    await db
      .update(taxRules)
      .set({ isDefault: false })
      .where(eq(taxRules.isDefault, true));
  }

  const vals: Record<string, unknown> = { ...parsed };
  if (parsed.rate != null) vals.rate = String(parsed.rate);

  const [rule] = await db
    .update(taxRules)
    .set(vals)
    .where(eq(taxRules.id, id))
    .returning();

  if (!rule) throw new NotFoundError("Tax Rule", id);
  return rule;
}

export async function deleteTaxRule(id: string) {
  const [rule] = await db
    .delete(taxRules)
    .where(eq(taxRules.id, id))
    .returning();

  if (!rule) throw new NotFoundError("Tax Rule", id);
  return rule;
}

// ─── RBAC Constants ──────────────────────────────────────────

export const ROLES = ["super_admin", "admin", "manager", "staff", "viewer"] as const;
export type Role = (typeof ROLES)[number];

/** Role hierarchy — higher index = more privilege */
const ROLE_RANK: Record<Role, number> = {
  viewer: 0,
  staff: 1,
  manager: 2,
  admin: 3,
  super_admin: 4,
};

/** All available permission modules */
export const ALL_PERMISSIONS = [
  "dashboard",
  "products",
  "orders",
  "customers",
  "inventory",
  "invoices",
  "reports",
  "pos",
  "assistant",
  "admin",
  "settings",
] as const;
export type Permission = (typeof ALL_PERMISSIONS)[number];

/** Default permissions per role (when no explicit permissions are set) */
const DEFAULT_PERMS: Record<Role, Permission[]> = {
  super_admin: [...ALL_PERMISSIONS],
  admin: ["dashboard", "products", "orders", "customers", "inventory", "invoices", "reports", "pos", "admin"],
  manager: ["dashboard", "products", "orders", "customers", "inventory", "invoices", "reports", "pos"],
  staff: ["dashboard", "pos"],
  viewer: ["dashboard"],
};

/** Check if actingRole can manage targetRole */
export function canManageRole(actingRole: Role, targetRole: Role): boolean {
  return ROLE_RANK[actingRole] > ROLE_RANK[targetRole];
}

/** Roles that a given role can assign to new users */
export function assignableRoles(actingRole: Role): Role[] {
  return ROLES.filter((r) => ROLE_RANK[r] < ROLE_RANK[actingRole]);
}

// ─── User Management (RBAC-enhanced) ─────────────────────────

export const userSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(255),
  role: z.enum(ROLES).default("staff"),
  permissions: z.array(z.string()).optional(),
  assignedWarehouses: z.array(z.string().uuid()).optional().nullable(),
  isActive: z.boolean().optional(),
});

export async function listAllUsers(includeInactive = false) {
  const conditions = includeInactive ? undefined : eq(users.isActive, true);
  const rows = await db.query.users.findMany({
    where: conditions,
    orderBy: [asc(users.name)],
    columns: { hashedPassword: false },
  });
  return rows;
}

/** List users + their assigned warehouse names (for admin display) */
export async function listUsersWithWarehouses() {
  const allUsers = await db.query.users.findMany({
    orderBy: [asc(users.name)],
    columns: { hashedPassword: false },
  });
  const allWarehouses = await db.query.warehouses.findMany({
    columns: { id: true, name: true, code: true },
  });
  const warehouseMap = new Map(allWarehouses.map((w: { id: string; name: string; code: string | null }) => [w.id, w]));

  return allUsers.map((u: typeof allUsers[number]) => ({
    ...u,
    permissions: (u.permissions as string[] | null) ?? DEFAULT_PERMS[(u.role as Role) ?? "staff"],
    warehouseDetails: ((u.assignedWarehouses as string[] | null) ?? [])
      .map((wid) => warehouseMap.get(wid))
      .filter(Boolean),
    allAccess: !(u.assignedWarehouses as string[] | null) || (u.assignedWarehouses as string[]).length === 0,
  }));
}

export async function createUser(data: unknown) {
  const parsed = userSchema.parse(data);
  const perms = parsed.permissions ?? DEFAULT_PERMS[(parsed.role as Role) ?? "staff"];

  const [user] = await db
    .insert(users)
    .values({
      email: parsed.email,
      name: parsed.name,
      role: parsed.role,
      permissions: perms,
      assignedWarehouses: parsed.assignedWarehouses ?? null,
    })
    .returning({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      isActive: users.isActive,
      permissions: users.permissions,
      assignedWarehouses: users.assignedWarehouses,
      createdAt: users.createdAt,
    });

  return user;
}

export async function updateUser(id: string, data: unknown) {
  const parsed = userSchema.partial().parse(data);

  const vals: Record<string, unknown> = {};
  if (parsed.email != null) vals.email = parsed.email;
  if (parsed.name != null) vals.name = parsed.name;
  if (parsed.role != null) vals.role = parsed.role;
  if (parsed.permissions !== undefined) vals.permissions = parsed.permissions;
  if (parsed.assignedWarehouses !== undefined) vals.assignedWarehouses = parsed.assignedWarehouses;
  if (parsed.isActive !== undefined) vals.isActive = parsed.isActive;

  const [user] = await db
    .update(users)
    .set(vals)
    .where(eq(users.id, id))
    .returning({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      isActive: users.isActive,
      permissions: users.permissions,
      assignedWarehouses: users.assignedWarehouses,
    });

  if (!user) throw new NotFoundError("User", id);
  return user;
}

export async function updateUserPermissions(
  id: string,
  permissions: string[],
  assignedWarehouses?: string[] | null
) {
  const vals: Record<string, unknown> = { permissions };
  if (assignedWarehouses !== undefined) vals.assignedWarehouses = assignedWarehouses;

  const [user] = await db
    .update(users)
    .set(vals)
    .where(eq(users.id, id))
    .returning({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      permissions: users.permissions,
      assignedWarehouses: users.assignedWarehouses,
    });

  if (!user) throw new NotFoundError("User", id);
  return user;
}

export async function deactivateUser(id: string) {
  const [user] = await db
    .update(users)
    .set({ isActive: false })
    .where(eq(users.id, id))
    .returning({ id: users.id, email: users.email });

  if (!user) throw new NotFoundError("User", id);
  return user;
}

export async function activateUser(id: string) {
  const [user] = await db
    .update(users)
    .set({ isActive: true })
    .where(eq(users.id, id))
    .returning({ id: users.id, email: users.email, name: users.name });

  if (!user) throw new NotFoundError("User", id);
  return user;
}

/** Get RBAC metadata for the frontend */
export function getRBACConfig() {
  return {
    roles: ROLES,
    roleRank: ROLE_RANK,
    allPermissions: ALL_PERMISSIONS,
    defaultPerms: DEFAULT_PERMS,
  };
}

// ─── Dashboard Stats ─────────────────────────────────────────

export async function getDashboardStats() {
  // Run all 4 count queries in parallel instead of sequentially
  const [products_, orders_, customers_, revenue_] = await Promise.all([
    db.execute(sql`SELECT count(*) as "productCount" FROM products WHERE is_active = true`) as Promise<any[]>,
    db.execute(sql`SELECT count(*) as "orderCount" FROM orders`) as Promise<any[]>,
    db.execute(sql`SELECT count(*) as "customerCount" FROM customers WHERE is_active = true`) as Promise<any[]>,
    db.execute(sql`SELECT COALESCE(sum(total_amount), 0) as "totalRevenue" FROM orders`) as Promise<any[]>,
  ]);

  return {
    productCount: Number(products_[0].productCount),
    orderCount: Number(orders_[0].orderCount),
    customerCount: Number(customers_[0].customerCount),
    totalRevenue: Number(revenue_[0].totalRevenue),
  };
}

// ─── Dashboard Chart Data ────────────────────────────────────

export async function getDashboardChartData(startDate?: string, endDate?: string) {
  const now = new Date();
  const start = startDate ? new Date(startDate) : new Date(now.getFullYear(), now.getMonth(), 1);
  const end = endDate ? new Date(endDate) : now;

  // Run all 8 dashboard queries in PARALLEL instead of sequentially
  const startISO = start.toISOString();
  const endISO = end.toISOString();

  const [
    salesByDay,
    revenueByStatus,
    inventoryByCategory,
    invoiceStats,
    topCustomers,
    topProducts,
    lowStockResult,
    paymentStats,
  ] = await Promise.all([
    // 1. Sales by day (line chart)
    db.execute(
      sql`SELECT
            TO_CHAR(created_at, 'YYYY-MM-DD') as date,
            COUNT(*) as order_count,
            COALESCE(SUM(total_amount), 0) as revenue
          FROM orders
          WHERE created_at >= ${startISO} AND created_at <= ${endISO}
          GROUP BY TO_CHAR(created_at, 'YYYY-MM-DD')
          ORDER BY date ASC`
    ) as Promise<any[]>,

    // 2. Revenue by order status (pie chart)
    db.execute(
      sql`SELECT
            os.name as status_name,
            os.label as status_label,
            os.color as status_color,
            COUNT(o.id) as order_count,
            COALESCE(SUM(o.total_amount), 0) as revenue
          FROM orders o
          LEFT JOIN order_statuses os ON o.status_id = os.id
          WHERE o.created_at >= ${startISO} AND o.created_at <= ${endISO}
          GROUP BY os.name, os.label, os.color
          ORDER BY revenue DESC`
    ) as Promise<any[]>,

    // 3. Inventory by category (bar chart)
    db.execute(
      sql`SELECT
            c.name as category_name,
            COUNT(DISTINCT i.product_id) as product_count,
            COALESCE(SUM(i.quantity), 0) as total_qty,
            COALESCE(SUM(i.quantity * CAST(p.price AS NUMERIC)), 0) as total_value
          FROM inventory i
          INNER JOIN products p ON i.product_id = p.id
          LEFT JOIN categories c ON p.category_id = c.id
          WHERE p.is_active = true
          GROUP BY c.name
          ORDER BY total_value DESC`
    ) as Promise<any[]>,

    // 4. Invoice receivables
    db.execute(
      sql`SELECT
            status,
            COUNT(*) as invoice_count,
            COALESCE(SUM(total_amount), 0) as total_billed,
            COALESCE(SUM(paid_amount), 0) as total_paid,
            COALESCE(SUM(total_amount - paid_amount), 0) as outstanding
          FROM invoices
          WHERE created_at >= ${startISO} AND created_at <= ${endISO}
          GROUP BY status
          ORDER BY total_billed DESC`
    ) as Promise<any[]>,

    // 5. Top customers by revenue
    db.execute(
      sql`SELECT
            cu.name as customer_name,
            COUNT(o.id) as order_count,
            COALESCE(SUM(o.total_amount), 0) as revenue
          FROM orders o
          INNER JOIN customers cu ON o.customer_id = cu.id
          WHERE o.created_at >= ${startISO} AND o.created_at <= ${endISO}
          GROUP BY cu.name
          ORDER BY revenue DESC
          LIMIT 10`
    ) as Promise<any[]>,

    // 6. Top selling products
    db.execute(
      sql`SELECT
            p.name as product_name,
            p.sku,
            COALESCE(SUM(oi.quantity), 0) as units_sold,
            COALESCE(SUM(oi.total_amount), 0) as revenue
          FROM order_items oi
          INNER JOIN products p ON oi.product_id = p.id
          INNER JOIN orders o ON oi.order_id = o.id
          WHERE o.created_at >= ${startISO} AND o.created_at <= ${endISO}
          GROUP BY p.name, p.sku
          ORDER BY revenue DESC
          LIMIT 10`
    ) as Promise<any[]>,

    // 7. Low stock count
    db.execute(
      sql`SELECT COUNT(*) as "lowStockCount"
          FROM inventory i
          INNER JOIN products p ON i.product_id = p.id
          WHERE i.quantity <= COALESCE(p.reorder_point, p.min_stock_level, 0)
            AND COALESCE(p.reorder_point, p.min_stock_level, 0) > 0`
    ) as Promise<any>,

    // 8. Payment collection
    db.execute(
      sql`SELECT
            COALESCE(SUM(CASE WHEN i.status = 'paid' THEN i.total_amount ELSE 0 END), 0) as fully_paid,
            COALESCE(SUM(CASE WHEN i.status = 'partial' THEN i.paid_amount ELSE 0 END), 0) as partially_paid,
            COALESCE(SUM(CASE WHEN i.status IN ('sent', 'draft', 'overdue') THEN i.total_amount - i.paid_amount ELSE 0 END), 0) as unpaid
          FROM invoices i
          WHERE i.created_at >= ${startISO} AND i.created_at <= ${endISO}`
    ) as Promise<any[]>,
  ]);

  const lowStockCount = (lowStockResult as any)[0]?.lowStockCount ?? 0;

  // Fill missing dates in salesByDay so the chart draws a continuous line
  const salesByDayMap = new Map(salesByDay.map((r: any) => [r.date, r]));
  const filledSalesByDay: { date: string; orderCount: number; revenue: number }[] = [];
  const cursor = new Date(start);
  cursor.setUTCHours(0, 0, 0, 0);
  const endDay = new Date(end);
  endDay.setUTCHours(0, 0, 0, 0);
  while (cursor <= endDay) {
    const key = cursor.toISOString().slice(0, 10);
    const row = salesByDayMap.get(key);
    filledSalesByDay.push({
      date: key,
      orderCount: row ? Number(row.order_count) : 0,
      revenue: row ? Number(row.revenue) : 0,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return {
    period: { start: start.toISOString(), end: end.toISOString() },
    salesByDay: filledSalesByDay,
    revenueByStatus: revenueByStatus.map((r: any) => ({
      name: r.status_name,
      label: r.status_label ?? r.status_name,
      color: r.status_color ?? "#888",
      orderCount: Number(r.order_count),
      revenue: Number(r.revenue),
    })),
    inventoryByCategory: inventoryByCategory.map((r: any) => ({
      category: r.category_name ?? "Uncategorized",
      productCount: Number(r.product_count),
      totalQty: Number(r.total_qty),
      totalValue: Number(r.total_value),
    })),
    invoiceStats: invoiceStats.map((r: any) => ({
      status: r.status,
      count: Number(r.invoice_count),
      totalBilled: Number(r.total_billed),
      totalPaid: Number(r.total_paid),
      outstanding: Number(r.outstanding),
    })),
    topCustomers: topCustomers.map((r: any) => ({
      name: r.customer_name,
      orderCount: Number(r.order_count),
      revenue: Number(r.revenue),
    })),
    topProducts: topProducts.map((r: any) => ({
      name: r.product_name,
      sku: r.sku,
      unitsSold: Number(r.units_sold),
      revenue: Number(r.revenue),
    })),
    lowStockCount: Number(lowStockCount),
    paymentCollection: {
      fullyPaid: Number(paymentStats[0]?.fully_paid ?? 0),
      partiallyPaid: Number(paymentStats[0]?.partially_paid ?? 0),
      unpaid: Number(paymentStats[0]?.unpaid ?? 0),
    },
  };
}
