import {
  db,
  orders,
  orderItems,
  orderStatuses,
  products,
  inventory,
  inventoryTransactions,
  warehouses,
} from "@db/index";
import { eq, sql, and, asc, desc, gte, lte } from "drizzle-orm";
import { config } from "@lib/config";
import {
  createOrderSchema,
  updateOrderStatusSchema,
} from "@lib/validation";
import { NotFoundError, InsufficientStockError } from "@lib/errors";
import { type PaginationParams, paginate, offset } from "@lib/pagination";

/** Generate sequential order number */
async function nextOrderNumber(): Promise<string> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(orders);
  return `ORD-${String(Number(count) + 1).padStart(6, "0")}`;
}

export async function createOrder(data: unknown) {
  const parsed = createOrderSchema.parse(data);

  // Resolve default warehouse
  let warehouseId = parsed.warehouseId;
  if (!warehouseId) {
    const defaultWh = await db.query.warehouses.findFirst({
      where: eq(warehouses.isDefault, true),
    });
    warehouseId = defaultWh?.id;
  }

  // Resolve default status
  const defaultStatus = await db.query.orderStatuses.findFirst({
    where: eq(orderStatuses.isDefault, true),
  });

  // Validate stock & build line items
  let subtotal = 0;
  let totalTax = 0;
  const lineItems: Array<{
    productId: string;
    quantity: number;
    unitPrice: string;
    taxRate: string;
    taxAmount: string;
    discountAmount: string;
    totalAmount: string;
  }> = [];

  for (const item of parsed.items) {
    const product = await db.query.products.findFirst({
      where: eq(products.id, item.productId),
    });
    if (!product)
      throw new NotFoundError(config.labels.product, item.productId);

    // Check stock if warehouse is known
    if (warehouseId) {
      const stock = await db.query.inventory.findFirst({
        where: and(
          eq(inventory.productId, item.productId),
          eq(inventory.warehouseId, warehouseId)
        ),
      });
      const available = stock?.quantity ?? 0;
      if (available < item.quantity) {
        throw new InsufficientStockError(
          item.productId,
          item.quantity,
          available
        );
      }
    }

    const unitPrice = item.unitPrice ?? Number(product.price);
    const taxRate = Number(product.taxRate ?? config.taxRate);
    const lineSubtotal = unitPrice * item.quantity;
    const discount = item.discountAmount ?? 0;
    const lineTax = (lineSubtotal - discount) * taxRate;
    const lineTotal = lineSubtotal - discount + lineTax;

    subtotal += lineSubtotal;
    totalTax += lineTax;

    lineItems.push({
      productId: item.productId,
      quantity: item.quantity,
      unitPrice: String(unitPrice),
      taxRate: String(taxRate),
      taxAmount: String(lineTax),
      discountAmount: String(discount),
      totalAmount: String(lineTotal),
    });
  }

  const totalDiscount = parsed.items.reduce(
    (acc, i) => acc + (i.discountAmount ?? 0),
    0
  );
  const totalAmount = subtotal - totalDiscount + totalTax;

  // Create order
  const orderNumber = await nextOrderNumber();
  const [order] = await db
    .insert(orders)
    .values({
      orderNumber,
      customerId: parsed.customerId,
      statusId: defaultStatus?.id,
      warehouseId,
      subtotal: String(subtotal),
      taxAmount: String(totalTax),
      discountAmount: String(totalDiscount),
      totalAmount: String(totalAmount),
      notes: parsed.notes,
      paymentMethod: parsed.paymentMethod ?? null,
      paymentReference: parsed.paymentReference ?? null,
      paymentStatus: parsed.paymentStatus ?? (parsed.paymentMethod ? "paid" : "pending"),
      metadata: parsed.metadata,
    })
    .returning();

  // Create line items
  await db
    .insert(orderItems)
    .values(lineItems.map((li) => ({ ...li, orderId: order.id })));

  // Deduct stock
  if (warehouseId) {
    for (const item of parsed.items) {
      await db
        .update(inventory)
        .set({ quantity: sql`${inventory.quantity} - ${item.quantity}` })
        .where(
          and(
            eq(inventory.productId, item.productId),
            eq(inventory.warehouseId, warehouseId)
          )
        );

      await db.insert(inventoryTransactions).values({
        productId: item.productId,
        warehouseId,
        type: "sale",
        quantity: -item.quantity,
        referenceType: "order",
        referenceId: order.id,
      });
    }
  }

  return order;
}

export async function updateOrderStatus(id: string, data: unknown) {
  const parsed = updateOrderStatusSchema.parse(data);

  const [order] = await db
    .update(orders)
    .set({ statusId: parsed.statusId })
    .where(eq(orders.id, id))
    .returning();

  if (!order) throw new NotFoundError(config.labels.order, id);
  return order;
}

export async function getOrder(id: string) {
  const order = await db.query.orders.findFirst({
    where: eq(orders.id, id),
    with: {
      customer: true,
      status: true,
      warehouse: true,
      items: { with: { product: true } },
      invoices: true,
    },
  });
  if (!order) throw new NotFoundError(config.labels.order, id);
  return order;
}

export async function listOrders(
  params: PaginationParams,
  customerId?: string,
  opts?: { startDate?: string; endDate?: string }
) {
  const conditions: any[] = [];
  if (customerId) conditions.push(eq(orders.customerId, customerId));
  if (opts?.startDate) {
    const d = new Date(opts.startDate);
    if (!isNaN(d.getTime())) conditions.push(gte(orders.createdAt, d));
  }
  if (opts?.endDate) {
    const d = new Date(opts.endDate);
    d.setHours(23, 59, 59, 999);
    if (!isNaN(d.getTime())) conditions.push(lte(orders.createdAt, d));
  }

  const where =
    conditions.length === 0 ? undefined :
    conditions.length === 1 ? conditions[0] :
    and(...conditions);

  const items = await db.query.orders.findMany({
    where,
    with: { customer: true, status: true },
    limit: params.limit,
    offset: offset(params),
    orderBy: [desc(orders.createdAt)],
  });

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(orders)
    .where(where);

  return paginate(items, Number(count), params);
}

export async function cancelOrder(id: string) {
  const order = await db.query.orders.findFirst({
    where: eq(orders.id, id),
    with: { items: true },
  });
  if (!order) throw new NotFoundError(config.labels.order, id);

  // Restore stock (only for stock items with a productId)
  if (order.warehouseId) {
    for (const item of order.items) {
      if (!item.productId) continue; // skip service items

      await db
        .update(inventory)
        .set({ quantity: sql`${inventory.quantity} + ${item.quantity}` })
        .where(
          and(
            eq(inventory.productId, item.productId),
            eq(inventory.warehouseId, order.warehouseId)
          )
        );

      await db.insert(inventoryTransactions).values({
        productId: item.productId,
        warehouseId: order.warehouseId,
        type: "cancellation",
        quantity: item.quantity,
        referenceType: "order",
        referenceId: order.id,
      });
    }
  }

  return { orderNumber: order.orderNumber };
}

/** List available order statuses */
export async function listOrderStatuses() {
  return db.query.orderStatuses.findMany({
    orderBy: [asc(orderStatuses.sortOrder)],
  });
}

/** Update payment info on an existing order (e.g., PDQ approval code) */
export async function updateOrderPayment(
  id: string,
  data: { paymentMethod?: string; paymentReference?: string; paymentStatus?: string }
) {
  const existing = await db.query.orders.findFirst({ where: eq(orders.id, id) });
  if (!existing) throw new NotFoundError(config.labels.order, id);

  const [updated] = await db
    .update(orders)
    .set({
      paymentMethod: data.paymentMethod ?? existing.paymentMethod,
      paymentReference: data.paymentReference ?? existing.paymentReference,
      paymentStatus: data.paymentStatus ?? existing.paymentStatus,
    })
    .where(eq(orders.id, id))
    .returning();

  return updated;
}
