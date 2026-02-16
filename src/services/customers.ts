import { db, customers } from "@db/index";
import { eq, ilike, sql } from "drizzle-orm";
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
    orderBy: (c, { desc }) => [desc(c.createdAt)],
  });

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(customers)
    .where(eq(customers.isActive, true));

  return paginate(items, Number(count), params);
}

export async function searchCustomers(term: string, limit = 20) {
  return db.query.customers.findMany({
    where: ilike(customers.name, `%${term}%`),
    limit,
  });
}
