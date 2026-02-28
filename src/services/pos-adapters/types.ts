/**
 * POS Adapter Types — shared interfaces for the vendor adapter layer.
 *
 * Every external POS payload gets normalized to `PosTransaction` before
 * entering the ingestion pipeline. The adapter pattern allows each vendor
 * to have its own normalization logic while the core pipeline stays generic.
 */

// ── Normalized Transaction (output of every adapter) ────────

export interface PosLineItem {
  /** Product SKU — primary lookup key */
  sku?: string;
  /** Barcode (EAN-13, UPC, etc.) — fallback lookup key */
  barcode?: string;
  /** Direct product UUID — if POS already knows our ID */
  productId?: string;
  /** Display name from POS (used for logging if product not found) */
  name: string;
  /** Quantity sold/returned */
  quantity: number;
  /** Unit price from POS */
  unitPrice: number;
  /** Tax rate applied at POS (0-1 decimal) */
  taxRate?: number;
  /** Tax amount on this line item */
  taxAmount?: number;
  /** Discount amount on this line item */
  discountAmount?: number;
  /** Line total (quantity * unitPrice - discount + tax) */
  totalAmount: number;
}

export interface PosTransaction {
  /** Vendor identifier: "mpesa", "ikhokha", "itax", "generic", "custom" */
  posVendor: string;
  /** External transaction ID — idempotency key */
  posTxId: string;
  /** Event type: "sale", "return" */
  eventType: "sale" | "return";
  /** When the sale occurred at the POS */
  timestamp: Date;
  /** Itemized line items (empty for aggregated payments like M-Pesa) */
  items: PosLineItem[];
  /** Sale subtotal before tax/discount */
  subtotal: number;
  /** Total tax amount */
  taxAmount: number;
  /** Total discount amount */
  discountAmount: number;
  /** Grand total */
  totalAmount: number;
  /** Payment method: "cash", "card", "mpesa", "bank_transfer", etc. */
  paymentMethod: string;
  /** External payment reference: M-Pesa receipt, card approval code, etc. */
  paymentReference?: string;
  /** Customer identifier: phone number, loyalty ID, etc. */
  customerId?: string;
  /** Customer display name from POS */
  customerName?: string;
  /** Cashier/staff identifier from POS */
  cashierId?: string;
  /** POS terminal identifier */
  terminalId?: string;
  /** Location/branch identifier — maps to warehouse code */
  locationId?: string;
  /** Currency code (defaults to deployment currency) */
  currency?: string;
  /** Original payload for debugging */
  rawPayload: unknown;
}

// ── Adapter Interface ───────────────────────────────────────

export interface PosAdapter {
  /** Vendor name this adapter handles */
  vendor: string;
  /** Normalize a raw POS payload into our standard PosTransaction */
  normalize(payload: unknown, fieldMapping?: Record<string, string>): PosTransaction;
  /** Verify webhook signature (optional — not all vendors support it) */
  verifySignature?(payload: string, signature: string, secret: string): boolean;
}

// ── Batch Types ─────────────────────────────────────────────

export interface PosBatchRequest {
  /** Array of raw POS events to process */
  events: unknown[];
}

export interface PosBatchResult {
  /** Total events in the batch */
  total: number;
  /** Successfully processed */
  processed: number;
  /** Skipped as duplicates */
  duplicates: number;
  /** Failed to process */
  failed: number;
  /** Error details for failed events */
  errors: Array<{ index: number; error: string }>;
}
