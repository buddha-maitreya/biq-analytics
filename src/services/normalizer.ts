/**
 * Data Normalizer — transforms external data into internal types before DB insert.
 *
 * Handles field mapping, auto-detection of common column aliases,
 * preserves unmapped fields in the metadata JSONB column, and
 * extracts externalId/externalSource for sync reconciliation.
 *
 * These functions never throw — they always return a best-effort result.
 */

// ── Normalized Types ─────────────────────────────────────────

export interface NormalizedProduct {
  name: string;
  sku?: string;
  categoryName?: string;
  costPrice?: number;
  sellingPrice?: number;
  unit?: string;
  supplierName?: string;
  metadata: Record<string, unknown>;
  externalId?: string;
  externalSource?: string;
}

export interface NormalizedOrder {
  orderNumber?: string;
  customerEmail?: string;
  customerName?: string;
  totalAmount: number;
  paymentMethod?: string;
  paymentReference?: string;
  notes?: string;
  createdAt?: string;
  metadata: Record<string, unknown>;
  externalId?: string;
  externalSource?: string;
}

export interface NormalizedCustomer {
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  metadata: Record<string, unknown>;
  externalId?: string;
  externalSource?: string;
}

// ── Alias Maps ───────────────────────────────────────────────

/** Maps internal field names to arrays of external aliases (lowercase, underscore-normalized) */
const PRODUCT_FIELD_ALIASES: Record<string, string[]> = {
  name: ["name", "product_name", "item_name", "description"],
  sku: ["sku", "product_code", "item_code", "code", "barcode"],
  sellingPrice: ["price", "selling_price", "unit_price", "sale_price"],
  costPrice: ["cost", "cost_price", "purchase_price"],
  quantity: ["quantity", "qty", "stock", "on_hand", "stock_quantity"],
  categoryName: ["category", "category_name", "department"],
  supplierName: ["supplier", "supplier_name", "vendor"],
  unit: ["unit", "uom", "unit_of_measure"],
};

const CUSTOMER_FIELD_ALIASES: Record<string, string[]> = {
  name: ["name", "customer_name", "full_name"],
  email: ["email", "customer_email", "email_address"],
  phone: ["phone", "mobile", "telephone", "phone_number"],
  address: ["address", "street_address", "mailing_address"],
};

const ORDER_FIELD_ALIASES: Record<string, string[]> = {
  totalAmount: ["total", "amount", "order_total", "total_amount", "grand_total"],
  customerName: ["customer", "customer_name"],
  customerEmail: ["customer_email", "email"],
  orderNumber: ["order_number", "order_id", "reference", "ref"],
  paymentMethod: ["payment_method", "payment_type", "pay_method"],
  paymentReference: ["payment_reference", "payment_ref", "transaction_id"],
  notes: ["notes", "comments", "memo"],
  createdAt: ["created_at", "order_date", "date", "timestamp"],
};

// ── Internal Helpers ─────────────────────────────────────────

function normalizeKey(key: string): string {
  return key.toLowerCase().trim().replace(/\s+/g, "_");
}

/**
 * Apply explicit field mapping to rename fields.
 * Returns a new record with renamed keys.
 */
function applyFieldMapping(
  raw: Record<string, unknown>,
  fieldMapping?: Record<string, string>
): Record<string, unknown> {
  if (!fieldMapping || Object.keys(fieldMapping).length === 0) return { ...raw };

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    const mappedKey = fieldMapping[key];
    if (mappedKey) {
      result[mappedKey] = value;
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Auto-detect fields using alias maps.
 * Returns { matched: Record<internalField, value>, unmatched: Record<originalKey, value> }
 */
function autoDetectFields(
  raw: Record<string, unknown>,
  aliases: Record<string, string[]>
): { matched: Record<string, unknown>; unmatched: Record<string, unknown> } {
  const matched: Record<string, unknown> = {};
  const unmatched: Record<string, unknown> = {};
  const usedKeys = new Set<string>();

  // For each internal field, find matching external key
  for (const [internalField, aliasList] of Object.entries(aliases)) {
    for (const [rawKey, rawValue] of Object.entries(raw)) {
      if (usedKeys.has(rawKey)) continue;
      const normalizedRawKey = normalizeKey(rawKey);
      if (aliasList.includes(normalizedRawKey)) {
        matched[internalField] = rawValue;
        usedKeys.add(rawKey);
        break;
      }
    }
  }

  // Collect unmatched fields
  for (const [key, value] of Object.entries(raw)) {
    if (!usedKeys.has(key)) {
      unmatched[key] = value;
    }
  }

  return { matched, unmatched };
}

/**
 * Extract externalId from common field names.
 */
function extractExternalId(raw: Record<string, unknown>): string | undefined {
  const val = raw.id ?? raw.external_id ?? raw.externalId ?? raw.ext_id;
  if (val === undefined || val === null) return undefined;
  return String(val);
}

function toNumber(val: unknown): number | undefined {
  if (val === undefined || val === null || val === "") return undefined;
  const n = Number(val);
  return Number.isFinite(n) ? n : undefined;
}

function toString(val: unknown): string | undefined {
  if (val === undefined || val === null || val === "") return undefined;
  return String(val);
}

// ── Public Normalize Functions ───────────────────────────────

export function normalizeProduct(
  raw: Record<string, unknown>,
  fieldMapping?: Record<string, string>,
  source?: string
): NormalizedProduct {
  try {
    const mapped = applyFieldMapping(raw, fieldMapping);
    const { matched, unmatched } = autoDetectFields(mapped, PRODUCT_FIELD_ALIASES);

    // Remove known meta-fields from unmatched before storing in metadata
    const metadata: Record<string, unknown> = {};
    const metaExclude = new Set(["id", "external_id", "externalId", "ext_id"]);
    for (const [k, v] of Object.entries(unmatched)) {
      if (!metaExclude.has(k) && v !== undefined && v !== null && v !== "") {
        metadata[k] = v;
      }
    }

    return {
      name: toString(matched.name) ?? "",
      sku: toString(matched.sku),
      categoryName: toString(matched.categoryName),
      costPrice: toNumber(matched.costPrice),
      sellingPrice: toNumber(matched.sellingPrice),
      unit: toString(matched.unit),
      supplierName: toString(matched.supplierName),
      metadata,
      externalId: extractExternalId(mapped),
      externalSource: source,
    };
  } catch {
    // Never throw — return best-effort empty result
    return {
      name: toString(raw.name) ?? "",
      metadata: {},
      externalSource: source,
    };
  }
}

export function normalizeOrder(
  raw: Record<string, unknown>,
  fieldMapping?: Record<string, string>,
  source?: string
): NormalizedOrder {
  try {
    const mapped = applyFieldMapping(raw, fieldMapping);
    const { matched, unmatched } = autoDetectFields(mapped, ORDER_FIELD_ALIASES);

    const metadata: Record<string, unknown> = {};
    const metaExclude = new Set(["id", "external_id", "externalId", "ext_id"]);
    for (const [k, v] of Object.entries(unmatched)) {
      if (!metaExclude.has(k) && v !== undefined && v !== null && v !== "") {
        metadata[k] = v;
      }
    }

    return {
      orderNumber: toString(matched.orderNumber),
      customerEmail: toString(matched.customerEmail),
      customerName: toString(matched.customerName),
      totalAmount: toNumber(matched.totalAmount) ?? 0,
      paymentMethod: toString(matched.paymentMethod),
      paymentReference: toString(matched.paymentReference),
      notes: toString(matched.notes),
      createdAt: toString(matched.createdAt),
      metadata,
      externalId: extractExternalId(mapped),
      externalSource: source,
    };
  } catch {
    return {
      totalAmount: 0,
      metadata: {},
      externalSource: source,
    };
  }
}

export function normalizeCustomer(
  raw: Record<string, unknown>,
  fieldMapping?: Record<string, string>,
  source?: string
): NormalizedCustomer {
  try {
    const mapped = applyFieldMapping(raw, fieldMapping);
    const { matched, unmatched } = autoDetectFields(mapped, CUSTOMER_FIELD_ALIASES);

    const metadata: Record<string, unknown> = {};
    const metaExclude = new Set(["id", "external_id", "externalId", "ext_id"]);
    for (const [k, v] of Object.entries(unmatched)) {
      if (!metaExclude.has(k) && v !== undefined && v !== null && v !== "") {
        metadata[k] = v;
      }
    }

    return {
      name: toString(matched.name) ?? "",
      email: toString(matched.email),
      phone: toString(matched.phone),
      address: toString(matched.address),
      metadata,
      externalId: extractExternalId(mapped),
      externalSource: source,
    };
  } catch {
    return {
      name: toString(raw.name) ?? "",
      metadata: {},
      externalSource: source,
    };
  }
}
