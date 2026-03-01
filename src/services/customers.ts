import { db, customers } from "@db/index";
import { dbRows } from "@db/rows";
import { eq, ilike, sql, desc } from "drizzle-orm";
import { config } from "@lib/config";
import { createCustomerSchema, updateCustomerSchema } from "@lib/validation";
import { NotFoundError } from "@lib/errors";
import { type PaginationParams, paginate, offset } from "@lib/pagination";

export async function createCustomer(data: unknown) {
  const parsed = createCustomerSchema.parse(data);

  const [customer] = await db
    .insert(customers)
    .values(parsed)
    .returning();

  return customer;
}

export async function updateCustomer(id: string, data: unknown) {
  const parsed = updateCustomerSchema.parse(data);

  const [customer] = await db
    .update(customers)
    .set(parsed)
    .where(eq(customers.id, id))
    .returning();

  if (!customer) throw new NotFoundError(config.labels.customer, id);
  return customer;
}

export async function deleteCustomer(id: string) {
  const [customer] = await db
    .update(customers)
    .set({ isActive: false })
    .where(eq(customers.id, id))
    .returning();

  if (!customer) throw new NotFoundError(config.labels.customer, id);
  return customer;
}

export async function getCustomer(id: string) {
  const customer = await db.query.customers.findFirst({
    where: eq(customers.id, id),
    with: { orders: true, invoices: true },
  });
  if (!customer) throw new NotFoundError(config.labels.customer, id);
  return customer;
}

export async function listCustomers(params: PaginationParams) {
  const items = await db.query.customers.findMany({
    where: eq(customers.isActive, true),
    limit: params.limit,
    offset: offset(params),
    orderBy: [desc(customers.createdAt)],
  });

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(customers)
    .where(eq(customers.isActive, true));

  return paginate(items, Number(count), params);
}

/**
 * List customers with enriched order stats:
 * totalSpent, orderCount, firstOrderDate, lastOrderDate
 */
export async function listCustomersEnriched(params: PaginationParams) {
  const rows_ = dbRows(await db.execute(
    sql`SELECT
          c.id,
          c.name,
          c.email,
          c.phone,
          c.address,
          c.tax_id,
          c.is_active,
          c.metadata,
          c.created_at,
          COALESCE(s.total_spent, 0)  AS total_spent,
          COALESCE(s.order_count, 0)  AS order_count,
          s.first_order_date,
          s.last_order_date
        FROM customers c
        LEFT JOIN LATERAL (
          SELECT
            SUM(o.total_amount::numeric) AS total_spent,
            COUNT(*)                     AS order_count,
            MIN(o.created_at)            AS first_order_date,
            MAX(o.created_at)            AS last_order_date
          FROM orders o
          WHERE o.customer_id = c.id
        ) s ON true
        WHERE c.is_active = true
        ORDER BY c.created_at DESC
        LIMIT ${params.limit}
        OFFSET ${offset(params)}`
  ));

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(customers)
    .where(eq(customers.isActive, true));

  return paginate(rows_, Number(count), params);
}

export async function searchCustomers(term: string, limit = 20) {
  return db.query.customers.findMany({
    where: ilike(customers.name, `%${term}%`),
    limit,
  });
}
