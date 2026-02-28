/**
 * Generic REST Adapter — handles any POS system that sends JSON webhooks.
 *
 * Uses `pos_vendor_configs.field_mapping` JSONB to dynamically map fields
 * from the vendor's payload format to our `PosTransaction` interface.
 * This is the default adapter when no vendor-specific adapter exists.
 *
 * Field mapping example:
 * {
 *   "posTxId": "transaction.id",
 *   "totalAmount": "transaction.total",
 *   "items": "line_items",
 *   "items.sku": "product_code",
 *   "items.name": "product_name",
 *   "items.quantity": "qty",
 *   "items.unitPrice": "unit_price",
 *   "items.totalAmount": "line_total",
 *   "paymentMethod": "payment.type",
 *   "paymentReference": "payment.reference",
 *   "customerId": "customer.phone",
 *   "customerName": "customer.name",
 *   "terminalId": "terminal_id",
 *   "locationId": "store_id",
 *   "timestamp": "created_at"
 * }
 */

import { createHash, createHmac } from "crypto";
import type { PosAdapter, PosTransaction, PosLineItem } from "./types";

// ── Path resolution (lodash _.get style) ────────────────────

function getByPath(obj: unknown, path: string): unknown {
  if (!path || obj == null) return undefined;
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function toNumber(val: unknown, fallback = 0): number {
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const n = Number(val);
    return Number.isNaN(n) ? fallback : n;
  }
  return fallback;
}

function toString(val: unknown, fallback = ""): string {
  if (typeof val === "string") return val;
  if (val == null) return fallback;
  return String(val);
}

// ── Generic Adapter ─────────────────────────────────────────

export const genericAdapter: PosAdapter = {
  vendor: "generic",

  normalize(payload: unknown, fieldMapping?: Record<string, string>): PosTransaction {
    const data = payload as Record<string, unknown>;
    const m = fieldMapping ?? {};

    // Resolve top-level fields using mapping or sensible defaults
    const posTxId = toString(
      getByPath(data, m["posTxId"] ?? "receiptId") ??
      getByPath(data, "transactionId") ??
      getByPath(data, "id") ??
      crypto.randomUUID(),
    );

    const timestamp = new Date(
      toString(
        getByPath(data, m["timestamp"] ?? "timestamp") ??
        getByPath(data, "createdAt") ??
        getByPath(data, "date"),
        new Date().toISOString(),
      ),
    );

    const totalAmount = toNumber(
      getByPath(data, m["totalAmount"] ?? "totalAmount") ??
      getByPath(data, "total") ??
      getByPath(data, "amount"),
    );

    const subtotal = toNumber(
      getByPath(data, m["subtotal"] ?? "subtotal") ?? totalAmount,
    );

    const taxAmount = toNumber(
      getByPath(data, m["taxAmount"] ?? "taxAmount") ??
      getByPath(data, "tax"),
    );

    const discountAmount = toNumber(
      getByPath(data, m["discountAmount"] ?? "discountAmount") ??
      getByPath(data, "discount"),
    );

    const paymentMethod = toString(
      getByPath(data, m["paymentMethod"] ?? "paymentMethod") ??
      getByPath(data, "payment.method") ??
      getByPath(data, "payment.type"),
      "cash",
    );

    const paymentReference = toString(
      getByPath(data, m["paymentReference"] ?? "paymentReference") ??
      getByPath(data, "payment.reference"),
    ) || undefined;

    const customerId = toString(
      getByPath(data, m["customerId"] ?? "customerId") ??
      getByPath(data, "customer.phone") ??
      getByPath(data, "customer.id"),
    ) || undefined;

    const customerName = toString(
      getByPath(data, m["customerName"] ?? "customerName") ??
      getByPath(data, "customer.name"),
    ) || undefined;

    const cashierId = toString(
      getByPath(data, m["cashierId"] ?? "cashierId"),
    ) || undefined;

    const terminalId = toString(
      getByPath(data, m["terminalId"] ?? "terminalId") ??
      getByPath(data, "terminal_id"),
    ) || undefined;

    const locationId = toString(
      getByPath(data, m["locationId"] ?? "locationId") ??
      getByPath(data, "storeId") ??
      getByPath(data, "branchId"),
    ) || undefined;

    const currency = toString(
      getByPath(data, m["currency"] ?? "currency"),
    ) || undefined;

    const eventType = toString(
      getByPath(data, m["eventType"] ?? "eventType"),
      "sale",
    ) as "sale" | "return";

    // Resolve items array
    const rawItems = getByPath(data, m["items"] ?? "items") as unknown[];
    const items: PosLineItem[] = [];

    if (Array.isArray(rawItems)) {
      // Field mapping keys for item sub-fields
      const itemSkuKey = m["items.sku"] ?? "sku";
      const itemBarcodeKey = m["items.barcode"] ?? "barcode";
      const itemProductIdKey = m["items.productId"] ?? "productId";
      const itemNameKey = m["items.name"] ?? "name";
      const itemQuantityKey = m["items.quantity"] ?? "quantity";
      const itemUnitPriceKey = m["items.unitPrice"] ?? "unitPrice";
      const itemTaxRateKey = m["items.taxRate"] ?? "taxRate";
      const itemTaxAmountKey = m["items.taxAmount"] ?? "taxAmount";
      const itemDiscountKey = m["items.discountAmount"] ?? "discountAmount";
      const itemTotalKey = m["items.totalAmount"] ?? "totalAmount";

      for (const raw of rawItems) {
        if (!raw || typeof raw !== "object") continue;
        const item = raw as Record<string, unknown>;

        const qty = toNumber(getByPath(item, itemQuantityKey), 1);
        const price = toNumber(getByPath(item, itemUnitPriceKey));
        const lineTotal = toNumber(getByPath(item, itemTotalKey), qty * price);

        items.push({
          sku: toString(getByPath(item, itemSkuKey)) || undefined,
          barcode: toString(getByPath(item, itemBarcodeKey)) || undefined,
          productId: toString(getByPath(item, itemProductIdKey)) || undefined,
          name: toString(getByPath(item, itemNameKey), "Unknown Item"),
          quantity: qty,
          unitPrice: price,
          taxRate: toNumber(getByPath(item, itemTaxRateKey)) || undefined,
          taxAmount: toNumber(getByPath(item, itemTaxAmountKey)) || undefined,
          discountAmount: toNumber(getByPath(item, itemDiscountKey)) || undefined,
          totalAmount: lineTotal,
        });
      }
    }

    return {
      posVendor: "generic",
      posTxId,
      eventType,
      timestamp,
      items,
      subtotal,
      taxAmount,
      discountAmount,
      totalAmount,
      paymentMethod,
      paymentReference,
      customerId,
      customerName,
      cashierId,
      terminalId,
      locationId,
      currency,
      rawPayload: payload,
    };
  },

  verifySignature(payload: string, signature: string, secret: string): boolean {
    const expected = createHmac("sha256", secret)
      .update(payload)
      .digest("hex");
    return expected === signature.replace("sha256=", "");
  },
};
