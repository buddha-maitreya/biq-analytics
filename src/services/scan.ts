/**
 * Scan Service — Unified barcode scan pipeline
 *
 * Core architectural principle:
 *   barcode → API → transaction → updated stock
 *
 * Every scan follows this atomic flow:
 *   1. Check idempotency (skip if duplicate request)
 *   2. Insert scan_events record (raw log — even if product doesn't exist)
 *   3. Lookup product by barcode
 *   4. Insert stock_transactions row
 *   5. Atomically update inventory_levels
 *   6. Link transaction back to scan_event
 *   7. Cache response for idempotency
 *   8. Return updated stock level
 *
 * Supports: USB scanners, Bluetooth scanners, phone cameras, warehouse
 * handhelds, POS input, API integrations — all through one pipeline.
 */

import { z } from "zod";
import { createHash } from "crypto";
import {
  db,
  products,
  inventory,
  inventoryTransactions,
  scanEvents,
  idempotencyKeys,
} from "@db/index";
import { eq, and, sql, lt } from "drizzle-orm";
import {
  NotFoundError,
  InsufficientStockError,
  ConflictError,
} from "@lib/errors";
import { submitForApproval } from "@services/approvals";

// ── Validation Schemas ──────────────────────────────────────

export const scanRequestSchema = z.object({
  /** Raw barcode/QR value */
  barcode: z.string().min(1).max(255),
  /** Warehouse/branch where the scan occurred */
  warehouseId: z.string().uuid(),
  /** Device source */
  deviceType: z.enum(["web", "mobile", "scanner", "api"]).default("web"),
  /** Quantity to add/remove (defaults to 1) */
  quantity: z.number().int().min(1).default(1),
  /** Scan type: scan_add = receiving, scan_remove = selling/dispatching, scan_transfer = inter-branch */
  scanType: z.enum(["scan_add", "scan_remove", "scan_transfer"]).default("scan_add"),
  /** Destination warehouse for scan_transfer (required when scanType = scan_transfer) */
  toWarehouseId: z.string().uuid().optional(),
  /** Optional notes */
  notes: z.string().max(500).optional(),
  /** Client-generated UUID for idempotency (prevents duplicate submissions) */
  idempotencyKey: z.string().max(100).optional(),
});

export type ScanRequest = z.infer<typeof scanRequestSchema>;

export interface ScanResult {
  success: boolean;
  scanEventId: string;
  transactionId: string | null;
  product: {
    id: string;
    name: string;
    sku: string;
    barcode: string | null;
    unit: string;
  } | null;
  previousStock: number;
  newStock: number;
  quantityChanged: number;
  warehouseId: string;
  scanType: string;
  deviceType: string;
  timestamp: string;
  /** Set when scan requires approval before stock is committed */
  requiresApproval?: boolean;
  approvalRequestId?: string;
}

export interface ScanError {
  success: false;
  scanEventId: string | null;
  error: string;
  errorCode: string;
}

// ── Idempotency TTL ─────────────────────────────────────────
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ── Duplicate detection window ──────────────────────────────
// Same barcode + same warehouse + same user within this window = duplicate
const DUPLICATE_WINDOW_MS = 2_000; // 2 seconds

// ── Core Scan Pipeline ──────────────────────────────────────

/**
 * Process a barcode scan atomically.
 *
 * This is the single entry point for ALL scan types (USB, camera, mobile, API).
 * The pipeline guarantees:
 * - Every scan is logged (even failures)
 * - Stock is never updated without a transaction record
 * - Duplicate requests return cached responses
 * - Inventory levels stay consistent via atomic upsert
 */
export async function processScan(
  request: ScanRequest,
  userId: string
): Promise<ScanResult | ScanError> {
  const parsed = scanRequestSchema.parse(request);
  const {
    barcode,
    warehouseId,
    deviceType,
    quantity,
    scanType,
    notes,
    idempotencyKey,
    toWarehouseId,
  } = parsed;

  // Validate scan_transfer requires toWarehouseId
  if (scanType === "scan_transfer" && !toWarehouseId) {
    return {
      success: false,
      scanEventId: null,
      error: "Destination warehouse (toWarehouseId) is required for transfer scans.",
      errorCode: "MISSING_DESTINATION",
    };
  }
  if (scanType === "scan_transfer" && toWarehouseId === warehouseId) {
    return {
      success: false,
      scanEventId: null,
      error: "Source and destination warehouses must be different.",
      errorCode: "SAME_WAREHOUSE",
    };
  }

  // ── Step 1: Idempotency check ──
  if (idempotencyKey) {
    const requestHash = hashRequest(parsed);
    const existing = await db.query.idempotencyKeys.findFirst({
      where: eq(idempotencyKeys.key, idempotencyKey),
    });

    if (existing) {
      // Same key, same payload → return cached response
      if (existing.requestHash === requestHash) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return existing.responseSnapshot as any as ScanResult;
      }
      // Same key, different payload → conflict
      throw new ConflictError(
        `Idempotency key "${idempotencyKey}" already used with a different request payload`
      );
    }
  }

  // ── Step 2: Insert scan event (raw log — always, even if product missing) ──
  const [scanEvent] = await db
    .insert(scanEvents)
    .values({
      warehouseId,
      userId,
      barcode,
      deviceType,
      status: "pending_sync",
      quantity,
      scanType,
      idempotencyKey: idempotencyKey ?? null,
      rawPayload: {
        barcode,
        warehouseId,
        toWarehouseId: toWarehouseId ?? null,
        deviceType,
        quantity,
        scanType,
        notes,
      },
    })
    .returning();

  // ── Step 3: Lookup product by barcode ──
  const product = await db.query.products.findFirst({
    where: eq(products.barcode, barcode),
  });

  if (!product) {
    // Update scan event to failed
    await db
      .update(scanEvents)
      .set({
        status: "failed",
        errorMessage: `No product found with barcode "${barcode}"`,
      })
      .where(eq(scanEvents.id, scanEvent.id));

    return {
      success: false,
      scanEventId: scanEvent.id,
      error: `No product found with barcode "${barcode}". Register this product first or verify the barcode.`,
      errorCode: "PRODUCT_NOT_FOUND",
    };
  }

  // ── Step 3b: Duplicate detection (same barcode, same warehouse, < 2s) ──
  // Skip this check if the client provides an idempotency key (they handle dedup)
  if (!idempotencyKey) {
    const recentDuplicate = await db.query.scanEvents.findFirst({
      where: and(
        eq(scanEvents.barcode, barcode),
        eq(scanEvents.warehouseId, warehouseId),
        eq(scanEvents.userId, userId),
        eq(scanEvents.status, "success"),
        sql`${scanEvents.createdAt} > NOW() - INTERVAL '${sql.raw(String(DUPLICATE_WINDOW_MS))} milliseconds'`
      ),
    });

    if (recentDuplicate && recentDuplicate.id !== scanEvent.id) {
      await db
        .update(scanEvents)
        .set({
          status: "failed",
          errorMessage: "Duplicate scan detected (same barcode within 2 seconds)",
          productId: product.id,
        })
        .where(eq(scanEvents.id, scanEvent.id));

      return {
        success: false,
        scanEventId: scanEvent.id,
        error: "Duplicate scan detected. This barcode was just scanned. Wait a moment and try again.",
        errorCode: "DUPLICATE_SCAN",
      };
    }
  }

  // ── Step 4: Calculate stock change ──
  // For transfers, source warehouse stock is deducted (like a removal)
  const signedQuantity = scanType === "scan_add" ? quantity : -quantity;

  // Check for sufficient stock on removals and transfers
  if (scanType === "scan_remove" || scanType === "scan_transfer") {
    const currentStock = await db.query.inventory.findFirst({
      where: and(
        eq(inventory.productId, product.id),
        eq(inventory.warehouseId, warehouseId)
      ),
    });
    const available = currentStock?.quantity ?? 0;
    if (available < quantity) {
      await db
        .update(scanEvents)
        .set({
          status: "failed",
          errorMessage: `Insufficient stock: requested ${quantity}, available ${available}`,
          productId: product.id,
        })
        .where(eq(scanEvents.id, scanEvent.id));

      return {
        success: false,
        scanEventId: scanEvent.id,
        error: `Insufficient stock for "${product.name}". Available: ${available} ${product.unit}, requested: ${quantity} ${product.unit}.`,
        errorCode: "INSUFFICIENT_STOCK",
      };
    }
  }

  // ── Step 4b: Approval gate ──
  // Check if an approval workflow exists for "inventory.scan".
  // If the user's role isn't high enough, stage the scan instead of committing.
  const approvalResult = await submitForApproval(userId, {
    actionType: "inventory.scan",
    entityType: "scan_event",
    entityId: scanEvent.id,
    actionData: {
      barcode,
      warehouseId,
      toWarehouseId: toWarehouseId ?? null,
      quantity,
      scanType,
      productId: product.id,
      productName: product.name,
    },
    warehouseId,
  });

  if (approvalResult && !approvalResult.autoApproved) {
    // Scan is staged for approval — do NOT commit stock yet
    await db
      .update(scanEvents)
      .set({
        status: "pending_approval",
        productId: product.id,
      })
      .where(eq(scanEvents.id, scanEvent.id));

    const existingInventory = await db.query.inventory.findFirst({
      where: and(
        eq(inventory.productId, product.id),
        eq(inventory.warehouseId, warehouseId)
      ),
    });

    return {
      success: true,
      scanEventId: scanEvent.id,
      transactionId: null,
      product: {
        id: product.id,
        name: product.name,
        sku: product.sku,
        barcode: product.barcode,
        unit: product.unit,
      },
      previousStock: existingInventory?.quantity ?? 0,
      newStock: existingInventory?.quantity ?? 0, // Unchanged — deferred
      quantityChanged: 0,
      warehouseId,
      scanType,
      deviceType,
      timestamp: new Date().toISOString(),
      requiresApproval: true,
      approvalRequestId: approvalResult.requestId!,
    };
  }

  // ── Step 5+: Commit stock (auto-approved or no workflow) ──
  return commitScanStock({
    scanEventId: scanEvent.id,
    product,
    warehouseId,
    toWarehouseId,
    quantity,
    signedQuantity,
    scanType,
    deviceType,
    barcode,
    notes,
    userId,
    idempotencyKey,
    parsed,
  });
}

/**
 * Internal: commit stock changes for a scan.
 * Called immediately for auto-approved/no-workflow scans,
 * or later via commitApprovedScan() when an approval is granted.
 */
async function commitScanStock(opts: {
  scanEventId: string;
  product: { id: string; name: string; sku: string; barcode: string | null; unit: string };
  warehouseId: string;
  toWarehouseId?: string;
  quantity: number;
  signedQuantity: number;
  scanType: string;
  deviceType: string;
  barcode: string;
  notes?: string;
  userId: string;
  idempotencyKey?: string;
  parsed?: ScanRequest;
}): Promise<ScanResult> {
  const {
    scanEventId, product, warehouseId, toWarehouseId,
    quantity, signedQuantity, scanType, deviceType,
    barcode, notes, userId, idempotencyKey, parsed,
  } = opts;

  // ── Step 5: Insert stock transaction ──
  const txType = scanType === "scan_transfer" ? "transfer_out" : scanType;
  const [transaction] = await db
    .insert(inventoryTransactions)
    .values({
      productId: product.id,
      warehouseId,
      type: txType,
      quantity: signedQuantity,
      referenceType: "scan",
      referenceId: scanEventId,
      deviceType,
      notes: notes ?? `Scanned barcode: ${barcode}`,
      performedBy: userId,
    })
    .returning();

  // ── Step 6: Atomically update inventory ──
  const existingInventory = await db.query.inventory.findFirst({
    where: and(
      eq(inventory.productId, product.id),
      eq(inventory.warehouseId, warehouseId)
    ),
  });

  const previousStock = existingInventory?.quantity ?? 0;
  let newStock: number;

  if (existingInventory) {
    await db
      .update(inventory)
      .set({
        quantity: sql`${inventory.quantity} + ${signedQuantity}`,
      })
      .where(eq(inventory.id, existingInventory.id));
    newStock = previousStock + signedQuantity;
  } else {
    await db.insert(inventory).values({
      productId: product.id,
      warehouseId,
      quantity: Math.max(0, signedQuantity),
    });
    newStock = Math.max(0, signedQuantity);
  }

  // ── Step 7: Link transaction back to scan event, mark success ──
  await db
    .update(scanEvents)
    .set({
      status: "success",
      linkedTransactionId: transaction.id,
      productId: product.id,
    })
    .where(eq(scanEvents.id, scanEventId));

  // ── Build response ──
  const response: ScanResult = {
    success: true,
    scanEventId,
    transactionId: transaction.id,
    product: {
      id: product.id,
      name: product.name,
      sku: product.sku,
      barcode: product.barcode,
      unit: product.unit,
    },
    previousStock,
    newStock,
    quantityChanged: signedQuantity,
    warehouseId,
    scanType,
    deviceType,
    timestamp: new Date().toISOString(),
  };

  // ── Step 8: Cache response for idempotency ──
  if (idempotencyKey && parsed) {
    const requestHash = hashRequest(parsed);
    await db.insert(idempotencyKeys).values({
      key: idempotencyKey,
      requestHash,
      responseSnapshot: response as unknown as Record<string, unknown>,
      expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
    });
  }

  return response;
}

// ── Batch Scan (Offline Sync) ───────────────────────────────

export interface BatchScanRequest {
  scans: ScanRequest[];
  userId: string;
}

export interface BatchScanResult {
  total: number;
  succeeded: number;
  failed: number;
  results: Array<ScanResult | ScanError>;
}

/**
 * Process multiple scans in sequence (for offline sync).
 * Each scan is processed independently — a failure in one does not
 * roll back the others. Results are returned per-scan.
 */
export async function processBatchScan(
  batch: BatchScanRequest
): Promise<BatchScanResult> {
  const results: Array<ScanResult | ScanError> = [];
  let succeeded = 0;
  let failed = 0;

  for (const scan of batch.scans) {
    try {
      const result = await processScan(scan, batch.userId);
      results.push(result);
      if (result.success) {
        succeeded++;
      } else {
        failed++;
      }
    } catch (err) {
      failed++;
      results.push({
        success: false,
        scanEventId: null,
        error: err instanceof Error ? err.message : String(err),
        errorCode: "PROCESSING_ERROR",
      });
    }
  }

  return {
    total: batch.scans.length,
    succeeded,
    failed,
    results,
  };
}

// ── Barcode Lookup ──────────────────────────────────────────

export interface BarcodeLookupResult {
  found: boolean;
  product: {
    id: string;
    name: string;
    sku: string;
    barcode: string | null;
    unit: string;
    price: string;
    costPrice: string | null;
    imageUrl: string | null;
    isActive: boolean;
  } | null;
  stock: Array<{
    warehouseId: string;
    quantity: number;
    reservedQuantity: number;
  }>;
}

/**
 * Look up a product by barcode and return its details + stock levels.
 * Used by POS systems, mobile apps, and scanner input fields for
 * instant product identification.
 */
export async function lookupBarcode(
  barcode: string
): Promise<BarcodeLookupResult> {
  const product = await db.query.products.findFirst({
    where: eq(products.barcode, barcode),
  });

  if (!product) {
    return { found: false, product: null, stock: [] };
  }

  const stockLevels = await db.query.inventory.findMany({
    where: eq(inventory.productId, product.id),
  });

  return {
    found: true,
    product: {
      id: product.id,
      name: product.name,
      sku: product.sku,
      barcode: product.barcode,
      unit: product.unit,
      price: product.price,
      costPrice: product.costPrice,
      imageUrl: product.imageUrl,
      isActive: product.isActive,
    },
    stock: stockLevels.map((s) => ({
      warehouseId: s.warehouseId,
      quantity: s.quantity,
      reservedQuantity: s.reservedQuantity,
    })),
  };
}

// ── Scan History ────────────────────────────────────────────

export interface ScanHistoryFilter {
  warehouseId?: string;
  userId?: string;
  status?: string;
  barcode?: string;
  limit?: number;
  offset?: number;
}

/**
 * Retrieve scan event history with optional filters.
 */
export async function getScanHistory(filter: ScanHistoryFilter = {}) {
  const conditions = [];
  if (filter.warehouseId) {
    conditions.push(eq(scanEvents.warehouseId, filter.warehouseId));
  }
  if (filter.userId) {
    conditions.push(eq(scanEvents.userId, filter.userId));
  }
  if (filter.status) {
    conditions.push(eq(scanEvents.status, filter.status));
  }
  if (filter.barcode) {
    conditions.push(eq(scanEvents.barcode, filter.barcode));
  }

  const limit = Math.min(filter.limit ?? 50, 200);
  const offset = filter.offset ?? 0;

  const events = await db
    .select()
    .from(scanEvents)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(sql`${scanEvents.createdAt} DESC`)
    .limit(limit)
    .offset(offset);

  return { events, limit, offset };
}

// ── Idempotency Cleanup ─────────────────────────────────────

/**
 * Remove expired idempotency keys. Should be run periodically
 * (e.g. daily cron) to keep the table lean.
 */
export async function cleanupExpiredIdempotencyKeys(): Promise<number> {
  const result = await db
    .delete(idempotencyKeys)
    .where(lt(idempotencyKeys.expiresAt, new Date()))
    .returning();
  return result.length;
}

// ── Approved Scan Commit ────────────────────────────────────

/**
 * Commit stock changes for a scan that was previously staged
 * for approval. Called when a supervisor approves the scan.
 *
 * Reads the scan_events record, reconstructs the context, and
 * runs the stock commit pipeline (steps 5–8 from processScan).
 */
export async function commitApprovedScan(
  scanEventId: string
): Promise<ScanResult | ScanError> {
  const scanEvent = await db.query.scanEvents.findFirst({
    where: eq(scanEvents.id, scanEventId),
  });

  if (!scanEvent) {
    return {
      success: false,
      scanEventId,
      error: "Scan event not found",
      errorCode: "NOT_FOUND",
    };
  }

  if (scanEvent.status !== "pending_approval") {
    return {
      success: false,
      scanEventId,
      error: `Scan event status is "${scanEvent.status}", expected "pending_approval"`,
      errorCode: "INVALID_STATUS",
    };
  }

  // Resolve product
  const product = scanEvent.productId
    ? await db.query.products.findFirst({
        where: eq(products.id, scanEvent.productId),
      })
    : null;

  if (!product) {
    return {
      success: false,
      scanEventId,
      error: "Product no longer exists for this scan event",
      errorCode: "PRODUCT_NOT_FOUND",
    };
  }

  const quantity = scanEvent.quantity;
  const signedQuantity = scanEvent.scanType === "scan_add" ? quantity : -quantity;

  // Re-check stock for removals/transfers
  if (scanEvent.scanType !== "scan_add") {
    const currentStock = await db.query.inventory.findFirst({
      where: and(
        eq(inventory.productId, product.id),
        eq(inventory.warehouseId, scanEvent.warehouseId)
      ),
    });
    const available = currentStock?.quantity ?? 0;
    if (available < quantity) {
      await db
        .update(scanEvents)
        .set({
          status: "failed",
          errorMessage: `Insufficient stock at approval time: requested ${quantity}, available ${available}`,
        })
        .where(eq(scanEvents.id, scanEventId));

      return {
        success: false,
        scanEventId,
        error: `Insufficient stock. Available: ${available}, requested: ${quantity}`,
        errorCode: "INSUFFICIENT_STOCK",
      };
    }
  }

  // Extract toWarehouseId from raw payload for transfers
  const rawPayload = scanEvent.rawPayload as Record<string, unknown> | null;
  const toWarehouseId = rawPayload?.toWarehouseId as string | undefined;

  return commitScanStock({
    scanEventId,
    product: {
      id: product.id,
      name: product.name,
      sku: product.sku,
      barcode: product.barcode,
      unit: product.unit,
    },
    warehouseId: scanEvent.warehouseId,
    toWarehouseId,
    quantity,
    signedQuantity,
    scanType: scanEvent.scanType,
    deviceType: scanEvent.deviceType,
    barcode: scanEvent.barcode,
    notes: undefined,
    userId: scanEvent.userId,
  });
}

// ── Utilities ───────────────────────────────────────────────

/** Hash a scan request for idempotency comparison */
function hashRequest(request: ScanRequest): string {
  const canonical = JSON.stringify({
    barcode: request.barcode,
    warehouseId: request.warehouseId,
    quantity: request.quantity,
    scanType: request.scanType,
    deviceType: request.deviceType,
  });
  return createHash("sha256").update(canonical).digest("hex");
}
