import { db, orderStatuses, taxRules, users } from "@db/index";
import { eq, sql } from "drizzle-orm";
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
    orderBy: (s, { asc }) => [asc(s.sortOrder)],
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
    orderBy: (r, { asc }) => [asc(r.name)],
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

// ─── User Management ─────────────────────────────────────────

export const userSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(255),
  role: z.enum(["admin", "manager", "staff"]).default("staff"),
});

export async function listUsers() {
  return db.query.users.findMany({
    where: eq(users.isActive, true),
    orderBy: (u, { asc }) => [asc(u.name)],
    columns: { hashedPassword: false },
  });
}

export async function createUser(data: unknown) {
  const parsed = userSchema.parse(data);

  const [user] = await db
    .insert(users)
    .values(parsed)
    .returning({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      isActive: users.isActive,
      createdAt: users.createdAt,
    });

  return user;
}

export async function updateUser(id: string, data: unknown) {
  const parsed = userSchema.partial().parse(data);

  const [user] = await db
    .update(users)
    .set(parsed)
    .where(eq(users.id, id))
    .returning({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      isActive: users.isActive,
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

// ─── Dashboard Stats ─────────────────────────────────────────

export async function getDashboardStats() {
  const [{ productCount }] = await db.execute(
    sql`SELECT count(*) as "productCount" FROM products WHERE is_active = true`
  ) as any;
  const [{ orderCount }] = await db.execute(
    sql`SELECT count(*) as "orderCount" FROM orders`
  ) as any;
  const [{ customerCount }] = await db.execute(
    sql`SELECT count(*) as "customerCount" FROM customers WHERE is_active = true`
  ) as any;
  const [{ totalRevenue }] = await db.execute(
    sql`SELECT COALESCE(sum(total_amount), 0) as "totalRevenue" FROM orders`
  ) as any;

  return {
    productCount: Number(productCount),
    orderCount: Number(orderCount),
    customerCount: Number(customerCount),
    totalRevenue: Number(totalRevenue),
  };
}
