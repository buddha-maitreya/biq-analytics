/**
 * POS Adapter Registry — maps vendor names to adapter implementations.
 *
 * Usage:
 *   const adapter = getAdapter("mpesa");
 *   const normalized = adapter.normalize(rawPayload, fieldMapping);
 *
 * The generic adapter is the fallback for any vendor that doesn't have
 * a specific adapter. It uses the vendor config's field_mapping JSONB
 * to dynamically map fields.
 */

import type { PosAdapter } from "./types";
import { genericAdapter } from "./adapter-generic";
import { mpesaAdapter } from "./adapter-mpesa";
import { paystackAdapter } from "./adapter-paystack";

// ── Adapter Registry ────────────────────────────────────────

const adapters: Record<string, PosAdapter> = {
  generic: genericAdapter,
  mpesa: mpesaAdapter,
  paystack: paystackAdapter,
  // Future adapters:
  // ikhokha: ikhokaAdapter,
  // itax: itaxAdapter,
};

/**
 * Get the adapter for a vendor. Falls back to the generic adapter
 * if no vendor-specific adapter is registered.
 */
export function getAdapter(vendor: string): PosAdapter {
  return adapters[vendor.toLowerCase()] ?? genericAdapter;
}

/**
 * List all registered adapter vendor names.
 */
export function listAdapterVendors(): string[] {
  return Object.keys(adapters);
}

// Re-export types for convenience
export type { PosAdapter, PosTransaction, PosLineItem, PosBatchRequest, PosBatchResult } from "./types";
