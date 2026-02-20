import { db, invoices, payments, orders } from "@db/index";
import { eq, sql, desc } from "drizzle-orm";
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
  filters?: { customerId?: string; status?: string }
) {
  const where = filters?.customerId
    ? eq(invoices.customerId, filters.customerId)
    : filters?.status
      ? eq(invoices.status, filters.status)
      : undefined;

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

/** Check if an invoice number already exists (deduplication) */
export async function checkInvoiceExists(invoiceNumber: string) {
  const existing = await db.query.invoices.findFirst({
    where: eq(invoices.invoiceNumber, invoiceNumber),
  });
  return existing ?? null;
}

/** Create an invoice from OCR-scanned data */
export async function createFromScan(data: {
  invoiceNumber: string;
  supplierName?: string;
  invoiceDate?: string;
  dueDate?: string;
  subtotal?: number;
  taxAmount?: number;
  totalAmount?: number;
  notes?: string;
  lineItems?: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
  }>;
  metadata?: Record<string, unknown>;
}) {
  // Deduplication check
  const existing = await checkInvoiceExists(data.invoiceNumber);
  if (existing) {
    return {
      duplicate: true,
      existingInvoice: existing,
      message: `Invoice ${data.invoiceNumber} already exists (ID: ${existing.id})`,
    };
  }

  const [invoice] = await db
    .insert(invoices)
    .values({
      invoiceNumber: data.invoiceNumber,
      subtotal: data.subtotal != null ? String(data.subtotal) : "0",
      taxAmount: data.taxAmount != null ? String(data.taxAmount) : "0",
      totalAmount: data.totalAmount != null ? String(data.totalAmount) : "0",
      dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
      notes: data.notes ?? `Scanned invoice from ${data.supplierName ?? "unknown supplier"}`,
      metadata: {
        source: "ocr_scan",
        supplierName: data.supplierName,
        invoiceDate: data.invoiceDate,
        lineItems: data.lineItems,
        ...data.metadata,
      },
    })
    .returning();

  return { duplicate: false, invoice };
}
