import { db, sales, products, warehouses } from "@db/index";
import { eq, sql, desc, asc, and, ilike, or } from "drizzle-orm";
import { type PaginationParams, paginate, offset } from "@lib/pagination";

/** Generate sequential sale number */
async function nextSaleNumber(): Promise<string> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(sales);
  return `SLE-${String(Number(count) + 1).padStart(6, "0")}`;
}

/** List sales with pagination, optional search & warehouse filter */
export async function listSales(
  params: PaginationParams,
  opts?: { search?: string; warehouseId?: string }
) {
  const { limit } = params;
  const skip = offset(params);

  // Count query
  let countQuery = db.select({ count: sql<number>`count(*)` }).from(sales);
  let dataQuery = db
    .select()
    .from(sales)
    .orderBy(desc(sales.saleDate))
    .limit(limit)
    .offset(skip);

  // Apply filters
  const conditions: any[] = [];
  if (opts?.search) {
    const q = `%${opts.search}%`;
    conditions.push(
      or(
        ilike(sales.sku, q),
        ilike(sales.productName, q),
        ilike(sales.warehouseName, q),
        ilike(sales.saleNumber, q),
        ilike(sales.customerName, q),
        ilike(sales.category, q)
      )
    );
  }
  if (opts?.warehouseId) {
    conditions.push(eq(sales.warehouseId, opts.warehouseId));
  }

  if (conditions.length > 0) {
    const where = conditions.length === 1 ? conditions[0] : and(...conditions);
    countQuery = countQuery.where(where) as any;
    dataQuery = dataQuery.where(where) as any;
  }

  const [{ count }] = await countQuery;
  const data = await dataQuery;

  return paginate(data, Number(count), params);
}

/** Get a single sale by ID */
export async function getSale(id: string) {
  const [sale] = await db.select().from(sales).where(eq(sales.id, id));
  return sale ?? null;
}

/** Create a new sale */
export async function createSale(data: {
  productId?: string;
  sku: string;
  productName: string;
  category?: string;
  warehouseId?: string;
  warehouseName?: string;
  customerId?: string;
  customerName?: string;
  quantity: number;
  unitPrice: string;
  totalAmount: string;
  currency?: string;
  paymentMethod?: string;
  soldBy?: string;
  saleDate?: string;
  metadata?: Record<string, unknown>;
}) {
  const saleNumber = await nextSaleNumber();
  const [sale] = await db
    .insert(sales)
    .values({
      saleNumber,
      productId: data.productId,
      sku: data.sku,
      productName: data.productName,
      category: data.category,
      warehouseId: data.warehouseId,
      warehouseName: data.warehouseName,
      customerId: data.customerId,
      customerName: data.customerName,
      quantity: data.quantity,
      unitPrice: data.unitPrice,
      totalAmount: data.totalAmount,
      currency: data.currency ?? "KES",
      paymentMethod: data.paymentMethod,
      soldBy: data.soldBy,
      saleDate: data.saleDate ? new Date(data.saleDate) : new Date(),
      metadata: data.metadata,
    })
    .returning();
  return sale;
}

/** Batch insert sales (used by seed script) */
export async function batchInsertSales(
  rows: Array<{
    saleNumber: string;
    productId?: string;
    sku: string;
    productName: string;
    category?: string;
    warehouseId?: string;
    warehouseName?: string;
    customerId?: string;
    customerName?: string;
    quantity: number;
    unitPrice: string;
    totalAmount: string;
    currency?: string;
    paymentMethod?: string;
    soldBy?: string;
    saleDate?: Date;
    metadata?: Record<string, unknown>;
  }>
) {
  if (rows.length === 0) return [];
  const result = await db.insert(sales).values(rows).returning();
  return result;
}

/** Sales summary statistics */
export async function getSalesSummary(warehouseId?: string) {
  const conditions: any[] = [];
  if (warehouseId) conditions.push(eq(sales.warehouseId, warehouseId));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [stats] = await db
    .select({
      totalSales: sql<number>`count(*)`,
      totalRevenue: sql<string>`coalesce(sum(${sales.totalAmount}), 0)`,
      totalQuantity: sql<number>`coalesce(sum(${sales.quantity}), 0)`,
      avgSaleValue: sql<string>`coalesce(avg(${sales.totalAmount}), 0)`,
    })
    .from(sales)
    .where(where);

  // Top selling products
  const topProducts = await db
    .select({
      sku: sales.sku,
      productName: sales.productName,
      totalQuantity: sql<number>`sum(${sales.quantity})`,
      totalRevenue: sql<string>`sum(${sales.totalAmount})`,
    })
    .from(sales)
    .where(where)
    .groupBy(sales.sku, sales.productName)
    .orderBy(sql`sum(${sales.quantity}) desc`)
    .limit(10);

  // Sales by branch/warehouse
  const byBranch = await db
    .select({
      warehouseName: sales.warehouseName,
      totalSales: sql<number>`count(*)`,
      totalRevenue: sql<string>`sum(${sales.totalAmount})`,
    })
    .from(sales)
    .where(where)
    .groupBy(sales.warehouseName)
    .orderBy(sql`sum(${sales.totalAmount}) desc`);

  // Sales by payment method
  const byPaymentMethod = await db
    .select({
      paymentMethod: sales.paymentMethod,
      totalSales: sql<number>`count(*)`,
      totalRevenue: sql<string>`sum(${sales.totalAmount})`,
    })
    .from(sales)
    .where(where)
    .groupBy(sales.paymentMethod)
    .orderBy(sql`sum(${sales.totalAmount}) desc`);

  return {
    ...stats,
    topProducts,
    byBranch,
    byPaymentMethod,
  };
}
