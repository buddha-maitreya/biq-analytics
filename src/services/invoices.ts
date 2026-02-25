import { db, invoices, payments, orders } from "@db/index";
import { eq, sql, desc, and, gte, lte } from "drizzle-orm";
import { config } from "@lib/config";
import { createInvoiceSchema, recordPaymentSchema } from "@lib/validation";
import { NotFoundError } from "@lib/errors";
import { type PaginationParams, paginate, offset } from "@lib/pagination";

/** Generate sequential invoice number */
async function nextInvoiceNumber(): Promise<string> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(invoices);
  return `INV-${String(Number(count) + 1).padStart(6, "0")}`;
}

export async function generateInvoice(data: unknown) {
  const parsed = createInvoiceSchema.parse(data);

  const order = await db.query.orders.findFirst({
    where: eq(orders.id, parsed.orderId),
  });
  if (!order) throw new NotFoundError(config.labels.order, parsed.orderId);

  const invoiceNumber = await nextInvoiceNumber();
  const [invoice] = await db
    .insert(invoices)
    .values({
      invoiceNumber,
      orderId: order.id,
      customerId: order.customerId,
      subtotal: order.subtotal,
      taxAmount: order.taxAmount,
      discountAmount: order.discountAmount,
      totalAmount: order.totalAmount,
      dueDate: parsed.dueDate ? new Date(parsed.dueDate) : undefined,
      notes: parsed.notes,
      metadata: parsed.metadata,
    })
    .returning();

  return invoice;
}

/**
 * Create an invoice record from a scanned document.
 * Unlike generateInvoice(), this does NOT require an orderId —
 * the invoice is created directly from extracted scanner data.
 */
export async function createInvoiceFromScan(data: {
  externalInvoiceNumber?: string | null;
  supplierName?: string | null;
  subtotal?: number | null;
  taxAmount?: number | null;
  totalAmount?: number | null;
  dueDate?: string | null;
  ingestionId: string;
  notes?: string | null;
}) {
  // Use the external invoice number if available, otherwise generate one
  const invoiceNumber = data.externalInvoiceNumber || await nextInvoiceNumber();

  // Check if an invoice with this number already exists (idempotency)
  const existing = await db.query.invoices.findFirst({
    where: eq(invoices.invoiceNumber, invoiceNumber),
  });
  if (existing) return existing;

  const [invoice] = await db
    .insert(invoices)
    .values({
      invoiceNumber,
      status: "draft",
      subtotal: data.subtotal != null ? String(data.subtotal) : "0",
      taxAmount: data.taxAmount != null ? String(data.taxAmount) : "0",
      discountAmount: "0",
      totalAmount: data.totalAmount != null ? String(data.totalAmount) : "0",
      dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
      notes: data.notes ?? `Created from scanned document (ingestion ${data.ingestionId})`,
      metadata: {
        source: "document_scan",
        ingestionId: data.ingestionId,
        supplierName: data.supplierName ?? null,
        externalInvoiceNumber: data.externalInvoiceNumber ?? null,
      },
    })
    .returning();

  return invoice;
}

export async function recordPayment(data: unknown) {
  const parsed = recordPaymentSchema.parse(data);
  const label = config.labels.invoice;

  const invoice = await db.query.invoices.findFirst({
    where: eq(invoices.id, parsed.invoiceId),
  });
  if (!invoice) throw new NotFoundError(label, parsed.invoiceId);

  // Record payment
  const [payment] = await db
    .insert(payments)
    .values({
      invoiceId: parsed.invoiceId,
      amount: String(parsed.amount),
      method: parsed.method,
      reference: parsed.reference,
      notes: parsed.notes,
      metadata: parsed.metadata,
    })
    .returning();

  // Update invoice paid amount
  const newPaid = Number(invoice.paidAmount) + parsed.amount;
  const isPaid = newPaid >= Number(invoice.totalAmount);

  await db
    .update(invoices)
    .set({
      paidAmount: String(newPaid),
      status: isPaid ? "paid" : "partial",
      paidAt: isPaid ? new Date() : undefined,
    })
    .where(eq(invoices.id, parsed.invoiceId));

  return payment;
}

export async function getInvoice(id: string) {
  const invoice = await db.query.invoices.findFirst({
    where: eq(invoices.id, id),
    with: { order: true, customer: true, payments: true },
  });
  if (!invoice) throw new NotFoundError(config.labels.invoice, id);
  return invoice;
}

export async function listInvoices(
  params: PaginationParams,
  filters?: { customerId?: string; status?: string; startDate?: string; endDate?: string }
) {
  const conditions: any[] = [];
  if (filters?.customerId) conditions.push(eq(invoices.customerId, filters.customerId));
  if (filters?.status)     conditions.push(eq(invoices.status, filters.status));
  if (filters?.startDate) {
    const d = new Date(filters.startDate);
    if (!isNaN(d.getTime())) conditions.push(gte(invoices.createdAt, d));
  }
  if (filters?.endDate) {
    const d = new Date(filters.endDate);
    d.setHours(23, 59, 59, 999);
    if (!isNaN(d.getTime())) conditions.push(lte(invoices.createdAt, d));
  }

  const where =
    conditions.length === 0 ? undefined :
    conditions.length === 1 ? conditions[0] :
    and(...conditions);

  const items = await db.query.invoices.findMany({
    where,
    with: { customer: true },
    limit: params.limit,
    offset: offset(params),
    orderBy: [desc(invoices.createdAt)],
  });

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(invoices)
    .where(where);

  return paginate(items, Number(count), params);
}

export async function markInvoiceSent(id: string) {
  const [invoice] = await db
    .update(invoices)
    .set({ status: "sent" })
    .where(eq(invoices.id, id))
    .returning();

  if (!invoice) throw new NotFoundError(config.labels.invoice, id);
  return invoice;
}

export async function voidInvoice(id: string) {
  const [invoice] = await db
    .update(invoices)
    .set({ status: "cancelled" })
    .where(eq(invoices.id, id))
    .returning();

  if (!invoice) throw new NotFoundError(config.labels.invoice, id);
  return invoice;
}
