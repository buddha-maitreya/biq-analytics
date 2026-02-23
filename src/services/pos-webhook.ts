/**
 * POS Webhook Service — processes incoming sales data from POS terminals.
 *
 * POS terminals handle payment collection (cash, card, M-Pesa).
 * This service receives completed sale data and:
 *   1. Validates the payload
 *   2. Checks idempotency (dedup by receipt ID)
 *   3. Resolves products by SKU or barcode (POS doesn't know our UUIDs)
 *   4. Creates an order via the existing order service (stock deducted automatically)
 *   5. Returns the created order details to the POS
 *
 * Payload format is defined by `posSaleSchema` — the POS integration layer
 * maps from the specific POS vendor format to this schema.
 */

import { createHash } from "crypto";
import { z } from "zod";
import { db, products, idempotencyKeys, customers } from "@db/index";
import { eq, and, gt, or } from "drizzle-orm";
import { createOrder } from "@services/orders";
import { ValidationError } from "@lib/errors";

// ── POS Sale Payload Schema ─────────────────────────────────

const posItemSchema = z.object({
  /** Product SKU — primary lookup key for POS items */
  sku: z.string().max(100).optional(),
  /** Barcode (EAN-13, UPC, etc.) — fallback lookup key */
  barcode: z.string().max(100).optional(),
  /** Direct product ID — if POS already knows our UUID */
  productId: z.string().uuid().optional(),
  /** Quantity sold */
  quantity: z.number().int().min(1),
  /** Unit price from POS (optional — defaults to product price if omitted) */
  unitPrice: z.number().min(0).optional(),
  /** Discount amount on this line item */
  discount: z.number().min(0).optional().default(0),
}).refine((d) => d.sku || d.barcode || d.productId, {
  message: "Each item must have a sku, barcode, or productId",
});

export const posSaleSchema = z.object({
  /** Unique receipt/transaction ID from the POS — required for idempotency */
  receiptId: z.string().min(1).max(100),
  /** POS terminal identifier */
  terminalId: z.string().max(50).optional(),
  /** Cashier/operator identifier */
  cashierId: z.string().max(100).optional(),
  /** When the sale occurred (ISO 8601). Defaults to now if omitted. */
  timestamp: z.string().optional(),
  /** Source warehouse (defaults to the deployment's default warehouse) */
  warehouseId: z.string().uuid().optional(),
  /** Line items — at least one required */
  items: z.array(posItemSchema).min(1),
  /** Payment info from the POS terminal */
  payment: z.object({
    /** Payment method: cash, card, card_pdq, mpesa, bank_transfer, etc. */
    method: z.string().max(50),
    /** External payment reference: M-Pesa receipt, card approval code, etc. */
    reference: z.string().max(255).optional(),
    /** Payment status — defaults to "paid" (POS already collected payment) */
    status: z.enum(["paid", "pending", "partial"]).default("paid"),
  }).optional(),
  /** Customer info if the POS captured it */
  customer: z.object({
    /** Customer UUID if POS knows it */
    id: z.string().uuid().optional(),
    /** Customer phone — used to look up existing customer */
    phone: z.string().max(50).optional(),
    /** Customer name — for reference only */
    name: z.string().max(255).optional(),
  }).optional(),
  /** Arbitrary metadata from the POS */
  metadata: z.record(z.unknown()).optional(),
});

export type PosSalePayload = z.infer<typeof posSaleSchema>;

// ── Idempotency ─────────────────────────────────────────────
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function hashPayload(payload: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
}

// ── Main Handler ────────────────────────────────────────────

export interface PosSaleResult {
  duplicate: boolean;
  orderId: string;
  orderNumber: string;
  totalAmount: string;
  itemsProcessed: number;
  itemsNotFound: string[];
  paymentStatus: string;
}

/**
 * Process an incoming sale from a POS terminal.
 * Creates an order, deducts stock, and returns the result.
 */
export async function handlePosSale(
  payload: unknown,
  source: string,
  eventId: string
): Promise<PosSaleResult> {
  const parsed = posSaleSchema.parse(payload);

  // ── Step 1: Idempotency check ──
  const idempotencyKey = `pos:${source}:${parsed.receiptId}`;
  const requestHash = hashPayload(payload);
  const existing = await db.query.idempotencyKeys.findFirst({
    where: and(
      eq(idempotencyKeys.key, idempotencyKey),
      gt(idempotencyKeys.expiresAt, new Date())
    ),
  });

  if (existing) {
    if (existing.requestHash === requestHash) {
      // Same receipt, same payload — return cached response
      return { duplicate: true, ...existing.responseSnapshot } as PosSaleResult;
    }
    throw new ValidationError(
      `Receipt ${parsed.receiptId} already processed with a different payload`
    );
  }

  // ── Step 2: Resolve customer (optional) ──
  let customerId: string | undefined = parsed.customer?.id;
  if (!customerId && parsed.customer?.phone) {
    const customer = await db.query.customers.findFirst({
      where: eq(customers.phone, parsed.customer.phone),
    });
    customerId = customer?.id;
  }

  // ── Step 3: Resolve products by SKU/barcode → productId ──
  const resolvedItems: Array<{
    productId: string;
    quantity: number;
    unitPrice?: number;
    discountAmount?: number;
  }> = [];
  const itemsNotFound: string[] = [];

  for (const item of parsed.items) {
    let product;

    if (item.productId) {
      product = await db.query.products.findFirst({
        where: eq(products.id, item.productId),
      });
    } else if (item.sku) {
      product = await db.query.products.findFirst({
        where: eq(products.sku, item.sku),
      });
    } else if (item.barcode) {
      product = await db.query.products.findFirst({
        where: eq(products.barcode, item.barcode),
      });
    }

    if (!product) {
      itemsNotFound.push(item.sku || item.barcode || item.productId || "unknown");
      continue;
    }

    resolvedItems.push({
      productId: product.id,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discountAmount: item.discount,
    });
  }

  if (resolvedItems.length === 0) {
    throw new ValidationError(
      `No products could be resolved. Unknown identifiers: ${itemsNotFound.join(", ")}`
    );
  }

  // ── Step 4: Create order via existing order service ──
  // Stock is deducted automatically on order creation (Option A).
  const order = await createOrder({
    customerId,
    warehouseId: parsed.warehouseId,
    items: resolvedItems,
    paymentMethod: parsed.payment?.method,
    paymentReference: parsed.payment?.reference,
    paymentStatus: parsed.payment?.status ?? "paid",
    notes: parsed.terminalId
      ? `POS sale from terminal ${parsed.terminalId}`
      : "POS sale",
    metadata: {
      ...(parsed.metadata ?? {}),
      posSource: source,
      posReceiptId: parsed.receiptId,
      posTerminalId: parsed.terminalId ?? null,
      posCashierId: parsed.cashierId ?? null,
      posTimestamp: parsed.timestamp ?? new Date().toISOString(),
    },
  });

  // ── Step 5: Cache idempotency key ──
  const result: PosSaleResult = {
    duplicate: false,
    orderId: order.id,
    orderNumber: order.orderNumber,
    totalAmount: order.totalAmount,
    itemsProcessed: resolvedItems.length,
    itemsNotFound,
    paymentStatus: parsed.payment?.status ?? "paid",
  };

  await db
    .insert(idempotencyKeys)
    .values({
      key: idempotencyKey,
      requestHash,
      responseSnapshot: result as unknown as Record<string, unknown>,
      expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
    })
    .onConflictDoNothing();

  return result;
}
