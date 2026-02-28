/**
 * Paystack Adapter — normalizes Paystack webhook events for card payments
 * (Visa, Mastercard, Verve, etc.) via the Paystack payment gateway.
 *
 * Paystack webhook payload structure (charge.success):
 *   event              — "charge.success", "refund.processed", etc.
 *   data.id            — Paystack internal transaction ID
 *   data.reference     — Merchant-generated reference (idempotency key)
 *   data.amount        — Amount in smallest currency unit (kobo for NGN, pesewas for GHS, cents for USD/ZAR)
 *   data.currency      — "NGN", "GHS", "USD", "ZAR"
 *   data.channel       — "card", "bank", "ussd", "qr", "mobile_money", "bank_transfer"
 *   data.fees          — Paystack processing fees (kobo)
 *   data.paid_at       — ISO 8601 payment timestamp
 *   data.authorization — Card details (brand, last4, bank, card_type, etc.)
 *   data.customer      — Customer info (email, phone, first_name, last_name, customer_code)
 *   data.metadata      — Merchant-defined metadata (can contain cart items, POS terminal info, etc.)
 *
 * Signature verification:
 *   Header: x-paystack-signature
 *   Algorithm: HMAC SHA-512 of raw request body using Paystack secret key
 *
 * Amount conversion:
 *   All amounts are in the smallest currency unit (e.g., 50000 kobo = ₦500.00).
 *   The adapter divides by 100 to convert to standard decimal amounts.
 */

import { createHmac, timingSafeEqual } from "crypto";
import type { PosAdapter, PosTransaction, PosLineItem } from "./types";

// ── Paystack Webhook Types ──────────────────────────────────

interface PaystackAuthorization {
  authorization_code?: string;
  bin?: string;
  last4?: string;
  exp_month?: string;
  exp_year?: string;
  channel?: string;
  card_type?: string;
  bank?: string;
  country_code?: string;
  brand?: string; // "visa", "mastercard", "verve", etc.
  reusable?: boolean;
  signature?: string;
}

interface PaystackCustomer {
  id?: number;
  first_name?: string;
  last_name?: string;
  email?: string;
  customer_code?: string;
  phone?: string;
  metadata?: Record<string, unknown>;
}

interface PaystackLineItem {
  sku?: string;
  barcode?: string;
  product_id?: string;
  name?: string;
  quantity?: number;
  amount?: number; // in kobo
  unit_price?: number; // in kobo
  tax_amount?: number; // in kobo
  discount_amount?: number; // in kobo
}

interface PaystackMetadata {
  /** POS terminal identifier */
  terminal_id?: string;
  /** Cashier/staff identifier */
  cashier_id?: string;
  /** Store/branch location identifier — maps to warehouse code */
  location_id?: string;
  /** Itemized cart contents (merchant-defined) */
  items?: PaystackLineItem[];
  /** Alternative: custom_fields array from Paystack dashboard config */
  custom_fields?: Array<{
    display_name?: string;
    variable_name?: string;
    value?: string;
  }>;
  /** Catch-all for any other merchant-defined fields */
  [key: string]: unknown;
}

interface PaystackChargeData {
  id?: number;
  domain?: string;
  status?: string;
  reference?: string;
  amount?: number; // in kobo
  currency?: string;
  channel?: string;
  fees?: number; // in kobo
  paid_at?: string;
  created_at?: string;
  gateway_response?: string;
  ip_address?: string;
  authorization?: PaystackAuthorization;
  customer?: PaystackCustomer;
  metadata?: PaystackMetadata | null;
}

interface PaystackWebhookPayload {
  event?: string;
  data?: PaystackChargeData;
}

// ── Helpers ─────────────────────────────────────────────────

/** Convert amount from smallest currency unit (kobo/pesewas/cents) to decimal */
function fromMinorUnit(amount?: number): number {
  return typeof amount === "number" ? amount / 100 : 0;
}

/** Determine event type from Paystack event name */
function mapEventType(event?: string): "sale" | "return" {
  if (event === "refund.processed" || event === "refund.created") return "return";
  return "sale";
}

/** Build card payment method string from authorization details */
function buildPaymentMethod(auth?: PaystackAuthorization, channel?: string): string {
  if (!auth) return channel ?? "card";
  const brand = auth.brand?.toLowerCase() ?? auth.card_type?.toLowerCase();
  if (brand) {
    const last4 = auth.last4 ? ` ****${auth.last4}` : "";
    return `${brand}${last4}`;
  }
  return channel ?? "card";
}

/** Build customer name from Paystack customer object */
function buildCustomerName(customer?: PaystackCustomer): string | undefined {
  if (!customer) return undefined;
  const parts = [customer.first_name, customer.last_name].filter(Boolean).join(" ").trim();
  return parts || undefined;
}

// ── Adapter ─────────────────────────────────────────────────

export const paystackAdapter: PosAdapter = {
  vendor: "paystack",

  normalize(payload: unknown): PosTransaction {
    const webhook = payload as PaystackWebhookPayload;
    const data = webhook.data ?? {};
    const meta = data.metadata ?? {};

    const eventType = mapEventType(webhook.event);
    const posTxId = data.reference ?? String(data.id ?? crypto.randomUUID());
    const totalAmountDecimal = fromMinorUnit(data.amount);
    const feesDecimal = fromMinorUnit(data.fees);

    // ── Build line items from metadata.items (if merchant sends them) ──
    const items: PosLineItem[] = [];
    if (Array.isArray(meta.items) && meta.items.length > 0) {
      for (const item of meta.items) {
        const qty = item.quantity ?? 1;
        const unitPrice = fromMinorUnit(item.unit_price ?? item.amount);
        const lineTotal = fromMinorUnit(item.amount) || unitPrice * qty;
        items.push({
          sku: item.sku,
          barcode: item.barcode,
          productId: item.product_id,
          name: item.name ?? "Unknown item",
          quantity: qty,
          unitPrice,
          taxAmount: item.tax_amount ? fromMinorUnit(item.tax_amount) : undefined,
          discountAmount: item.discount_amount ? fromMinorUnit(item.discount_amount) : undefined,
          totalAmount: lineTotal,
        });
      }
    } else {
      // No itemized data — create a single aggregate line item
      // The ingestion pipeline will attempt to resolve by reference
      items.push({
        sku: posTxId,
        name: `Paystack card payment (ref: ${posTxId})`,
        quantity: 1,
        unitPrice: totalAmountDecimal,
        totalAmount: totalAmountDecimal,
      });
    }

    // Compute subtotal from items or fall back to total
    const subtotal = items.reduce((sum, i) => sum + i.totalAmount, 0);
    const taxAmount = items.reduce((sum, i) => sum + (i.taxAmount ?? 0), 0);
    const discountAmount = items.reduce((sum, i) => sum + (i.discountAmount ?? 0), 0);

    return {
      posVendor: "paystack",
      posTxId,
      eventType,
      timestamp: data.paid_at ? new Date(data.paid_at) : new Date(),
      items,
      subtotal: subtotal || totalAmountDecimal,
      taxAmount,
      discountAmount,
      totalAmount: totalAmountDecimal,
      paymentMethod: buildPaymentMethod(data.authorization, data.channel),
      paymentReference: data.reference,
      customerId: data.customer?.customer_code ?? data.customer?.email,
      customerName: buildCustomerName(data.customer),
      cashierId: typeof meta.cashier_id === "string" ? meta.cashier_id : undefined,
      terminalId: typeof meta.terminal_id === "string" ? meta.terminal_id : undefined,
      locationId: typeof meta.location_id === "string" ? meta.location_id : undefined,
      currency: data.currency,
      rawPayload: payload,
    };
  },

  /**
   * Verify Paystack webhook signature.
   * Paystack uses HMAC SHA-512 with the secret key, sent in x-paystack-signature header.
   */
  verifySignature(payload: string, signature: string, secret: string): boolean {
    const expected = createHmac("sha512", secret).update(payload).digest("hex");
    // Constant-time comparison to prevent timing attacks
    try {
      return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
    } catch {
      // Buffer lengths differ — signature is invalid
      return false;
    }
  },
};
