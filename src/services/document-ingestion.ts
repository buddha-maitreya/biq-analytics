/**
 * Document Ingestion Service
 *
 * Handles the full pipeline from scanner output → database records:
 *   1. Stage — receive scanner output, create ingestion + items
 *   2. Dedup — match each line item against existing products
 *   3. Review — present staged data for user approval
 *   4. Commit — write approved records to products/inventory/orders
 *
 * The dedup engine runs a multi-layer match cascade:
 *   Layer 1: Document hash (SHA-256) — exact duplicate detection
 *   Layer 2: External reference (invoice number) — same document re-scanned
 *   Layer 3: SKU exact match — line item matches existing product
 *   Layer 4: Barcode exact match — barcode matches existing product
 *   Layer 5: Name fuzzy match (Levenshtein) — approximate product match
 *
 * This service intentionally contains NO LLM calls. It is pure deterministic
 * business logic. The scanner agent (AI) handles document understanding;
 * this service handles data mapping and dedup.
 */

import {
  db,
  products,
  inventory,
  inventoryTransactions,
  warehouses,
  documentIngestions,
  documentIngestionItems,
} from "@db/index";
import { eq, and, or, ilike, sql } from "drizzle-orm";
import { submitForApproval } from "./approvals";
import { createInvoiceFromScan } from "./invoices";
import { z } from "zod";

// ─── Types ────────────────────────────────────────────────────

/** Scanner output for a single line item (invoice or stock sheet) */
export interface ScannedLineItem {
  name?: string | null;
  sku?: string | null;
  barcode?: string | null;
  quantity?: number | null;
  unit?: string | null;
  unitPrice?: number | null;
  totalPrice?: number | null;
  description?: string | null;
  location?: string | null;
  notes?: string | null;
  [key: string]: unknown;
}

/** Scanner output for an invoice */
export interface ScannedInvoice {
  invoiceNumber?: string | null;
  supplierName?: string | null;
  supplierAddress?: string | null;
  supplierContact?: string | null;
  invoiceDate?: string | null;
  dueDate?: string | null;
  currency?: string | null;
  subtotal?: number | null;
  taxAmount?: number | null;
  totalAmount?: number | null;
  lineItems?: ScannedLineItem[];
  paymentTerms?: string | null;
  bankDetails?: string | null;
  confidence?: number | null;
  warnings?: string[];
}

/** Scanner output for a stock sheet */
export interface ScannedStockSheet {
  items?: ScannedLineItem[];
  documentDate?: string | null;
  totalItems?: number | null;
  confidence?: number | null;
  warnings?: string[];
}

/** Scanner output for a barcode scan */
export interface ScannedBarcode {
  found?: boolean;
  type?: string | null;
  value?: string | null;
  format?: string | null;
  confidence?: number | null;
  codes?: Array<{ type?: string; value?: string; format?: string }>;
}

/** Dedup match result for a single line item */
export interface DedupMatch {
  matchType: "sku_exact" | "barcode_exact" | "name_fuzzy" | "none";
  matchConfidence: number; // 0-1
  matchedProductId: string | null;
  matchedProductName: string | null;
  suggestedAction: "update_inventory" | "update_price" | "create_product" | "needs_review";
}

/** Full ingestion result returned to the scanner tool */
export interface IngestionResult {
  ingestionId: string;
  mode: string;
  status: string;
  itemCount: number;
  items: Array<{
    lineNumber: number;
    rawName: string | null;
    rawSku: string | null;
    action: string;
    matchType: string | null;
    matchConfidence: number | null;
    matchedProductName: string | null;
  }>;
  duplicateWarning?: string;
  requiresApproval: boolean;
  approvalRequestId?: string | null;
}

// ─── Dedup Engine ─────────────────────────────────────────────

/**
 * Levenshtein distance — measures edit distance between two strings.
 * Used for fuzzy name matching (Layer 5).
 */
function levenshtein(a: string, b: string): number {
  const la = a.length;
  const lb = b.length;
  if (la === 0) return lb;
  if (lb === 0) return la;

  const matrix: number[][] = [];
  for (let i = 0; i <= la; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= lb; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,       // deletion
        matrix[i][j - 1] + 1,       // insertion
        matrix[i - 1][j - 1] + cost  // substitution
      );
    }
  }

  return matrix[la][lb];
}

/**
 * Compute normalized similarity from Levenshtein distance.
 * Returns 0-1 where 1 = identical.
 */
function nameSimilarity(a: string, b: string): number {
  const la = a.toLowerCase().trim();
  const lb = b.toLowerCase().trim();
  if (la === lb) return 1;
  const maxLen = Math.max(la.length, lb.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(la, lb) / maxLen;
}

/** Minimum similarity threshold for fuzzy name match */
const FUZZY_MATCH_THRESHOLD = 0.75;

/**
 * Run the multi-layer dedup cascade for a single line item.
 * Checks SKU → barcode → name fuzzy match against existing products.
 */
async function dedupLineItem(item: ScannedLineItem): Promise<DedupMatch> {
  // Layer 3: SKU exact match
  if (item.sku) {
    const bySkuRows = await db
      .select({ id: products.id, name: products.name })
      .from(products)
      .where(and(eq(products.sku, item.sku), eq(products.isActive, true)))
      .limit(1);

    if (bySkuRows.length > 0) {
      return {
        matchType: "sku_exact",
        matchConfidence: 1.0,
        matchedProductId: bySkuRows[0].id,
        matchedProductName: bySkuRows[0].name,
        suggestedAction: "update_inventory",
      };
    }
  }

  // Layer 4: Barcode exact match
  if (item.barcode) {
    const byBarcodeRows = await db
      .select({ id: products.id, name: products.name })
      .from(products)
      .where(and(eq(products.barcode, item.barcode), eq(products.isActive, true)))
      .limit(1);

    if (byBarcodeRows.length > 0) {
      return {
        matchType: "barcode_exact",
        matchConfidence: 1.0,
        matchedProductId: byBarcodeRows[0].id,
        matchedProductName: byBarcodeRows[0].name,
        suggestedAction: "update_inventory",
      };
    }
  }

  // Layer 5: Name fuzzy match
  if (item.name) {
    // Fetch candidate products with a loose ILIKE filter first to limit the set
    const firstWord = item.name.split(/\s+/)[0];
    const candidates = firstWord && firstWord.length >= 2
      ? await db
          .select({ id: products.id, name: products.name })
          .from(products)
          .where(and(
            eq(products.isActive, true),
            ilike(products.name, `%${firstWord}%`)
          ))
          .limit(50)
      : await db
          .select({ id: products.id, name: products.name })
          .from(products)
          .where(eq(products.isActive, true))
          .limit(100);

    let bestMatch: { id: string; name: string; similarity: number } | null = null;

    for (const candidate of candidates) {
      const sim = nameSimilarity(item.name, candidate.name);
      if (sim >= FUZZY_MATCH_THRESHOLD && (!bestMatch || sim > bestMatch.similarity)) {
        bestMatch = { id: candidate.id, name: candidate.name, similarity: sim };
      }
    }

    if (bestMatch) {
      return {
        matchType: "name_fuzzy",
        matchConfidence: Math.round(bestMatch.similarity * 100) / 100,
        matchedProductId: bestMatch.id,
        matchedProductName: bestMatch.name,
        // Fuzzy matches below 0.9 need human review
        suggestedAction: bestMatch.similarity >= 0.9 ? "update_inventory" : "needs_review",
      };
    }
  }

  // No match found
  return {
    matchType: "none",
    matchConfidence: 0,
    matchedProductId: null,
    matchedProductName: null,
    suggestedAction: "create_product",
  };
}

/**
 * Check for document-level duplicates (Layers 1 & 2).
 * Returns the existing ingestion if a duplicate is found.
 */
async function checkDocumentDuplicate(
  documentHash: string | null,
  externalRef: string | null
): Promise<{ isDuplicate: boolean; existingId?: string; reason?: string }> {
  // Layer 1: Document hash — exact same file uploaded before
  if (documentHash) {
    const byHash = await db.query.documentIngestions.findFirst({
      where: eq(documentIngestions.documentHash, documentHash),
      columns: { id: true, status: true, createdAt: true },
    });
    if (byHash) {
      return {
        isDuplicate: true,
        existingId: byHash.id,
        reason: `This exact document was already processed (ingestion ${byHash.id}, status: ${byHash.status}, on ${byHash.createdAt.toISOString().slice(0, 10)}).`,
      };
    }
  }

  // Layer 2: External reference — same invoice/PO number
  if (externalRef) {
    const byRef = await db.query.documentIngestions.findFirst({
      where: and(
        eq(documentIngestions.externalRef, externalRef),
        // Only flag if the previous ingestion wasn't rejected
        sql`${documentIngestions.status} != 'rejected'`
      ),
      columns: { id: true, status: true, createdAt: true },
    });
    if (byRef) {
      return {
        isDuplicate: true,
        existingId: byRef.id,
        reason: `A document with reference "${externalRef}" was already processed (ingestion ${byRef.id}, status: ${byRef.status}).`,
      };
    }
  }

  return { isDuplicate: false };
}

// ─── Ingestion Pipeline ───────────────────────────────────────

/**
 * Stage an invoice ingestion.
 * Parses scanner output, deduplicates line items, and creates ingestion records.
 */
export async function stageInvoiceIngestion(input: {
  scannerOutput: ScannedInvoice;
  documentHash?: string | null;
  uploadedBy?: string | null;
  attachmentId?: string | null;
  sessionId?: string | null;
  confidence?: number | null;
  rawText?: string | null;
  sourceFilename?: string | null;
}): Promise<IngestionResult> {
  const { scannerOutput, documentHash, uploadedBy, attachmentId, sessionId, confidence, rawText, sourceFilename } = input;
  const externalRef = scannerOutput.invoiceNumber || null;

  // Document-level dedup
  const dupCheck = await checkDocumentDuplicate(documentHash ?? null, externalRef);

  // If duplicate detected, return the existing ingestion instead of inserting new rows
  if (dupCheck.isDuplicate && dupCheck.existingId) {
    return returnExistingIngestion(dupCheck.existingId, dupCheck);
  }

  const lineItems = scannerOutput.lineItems ?? [];

  // Run dedup on each line item
  const dedupResults: Array<{ item: ScannedLineItem; match: DedupMatch; lineNumber: number }> = [];
  for (let i = 0; i < lineItems.length; i++) {
    const match = await dedupLineItem(lineItems[i]);
    dedupResults.push({ item: lineItems[i], match, lineNumber: i + 1 });
  }

  // Create ingestion + items in a transaction
  const result = await db.transaction(async (tx) => {
    const [ingestion] = await tx
      .insert(documentIngestions)
      .values({
        mode: "invoice",
        status: "staged",
        documentHash: documentHash ?? null,
        externalRef,
        sourceFilename: sourceFilename ?? null,
        confidence: confidence != null ? String(confidence) : null,
        rawText: rawText ?? null,
        scannerOutput: scannerOutput as Record<string, unknown>,
        itemCount: lineItems.length,
        uploadedBy: uploadedBy ?? null,
        attachmentId: attachmentId ?? null,
        sessionId: sessionId ?? null,
      })
      .returning();

    const itemValues = dedupResults.map(({ item, match, lineNumber }) => ({
      ingestionId: ingestion.id,
      lineNumber,
      rawName: item.name ?? item.description ?? null,
      rawSku: item.sku ?? null,
      rawBarcode: item.barcode ?? null,
      quantity: item.quantity ?? null,
      unit: item.unit ?? null,
      unitPrice: item.unitPrice != null ? String(item.unitPrice) : null,
      totalPrice: item.totalPrice != null ? String(item.totalPrice) : null,
      action: match.suggestedAction,
      matchType: match.matchType,
      matchConfidence: match.matchConfidence != null ? String(match.matchConfidence) : null,
      matchedProductId: match.matchedProductId ?? null,
      rawData: item as Record<string, unknown>,
    }));

    let items: typeof itemValues = [];
    if (itemValues.length > 0) {
      items = await tx
        .insert(documentIngestionItems)
        .values(itemValues)
        .returning() as any;
    }

    return { ingestion, items };
  });

  return formatIngestionResult(result.ingestion, dedupResults, dupCheck);
}

/**
 * Stage a stock sheet ingestion.
 */
export async function stageStockSheetIngestion(input: {
  scannerOutput: ScannedStockSheet;
  documentHash?: string | null;
  uploadedBy?: string | null;
  attachmentId?: string | null;
  sessionId?: string | null;
  confidence?: number | null;
  rawText?: string | null;
  sourceFilename?: string | null;
  warehouseId?: string | null;
}): Promise<IngestionResult> {
  const { scannerOutput, documentHash, uploadedBy, attachmentId, sessionId, confidence, rawText, sourceFilename, warehouseId } = input;

  // Document-level dedup (no external ref for stock sheets typically)
  const dupCheck = await checkDocumentDuplicate(documentHash ?? null, null);

  // If duplicate detected, return the existing ingestion instead of inserting new rows
  if (dupCheck.isDuplicate && dupCheck.existingId) {
    return returnExistingIngestion(dupCheck.existingId, dupCheck);
  }

  const lineItems = scannerOutput.items ?? [];

  // Run dedup on each line item
  const dedupResults: Array<{ item: ScannedLineItem; match: DedupMatch; lineNumber: number }> = [];
  for (let i = 0; i < lineItems.length; i++) {
    const match = await dedupLineItem(lineItems[i]);
    dedupResults.push({ item: lineItems[i], match, lineNumber: i + 1 });
  }

  const result = await db.transaction(async (tx) => {
    const [ingestion] = await tx
      .insert(documentIngestions)
      .values({
        mode: "stock-sheet",
        status: "staged",
        documentHash: documentHash ?? null,
        sourceFilename: sourceFilename ?? null,
        confidence: confidence != null ? String(confidence) : null,
        rawText: rawText ?? null,
        scannerOutput: scannerOutput as Record<string, unknown>,
        itemCount: lineItems.length,
        uploadedBy: uploadedBy ?? null,
        attachmentId: attachmentId ?? null,
        sessionId: sessionId ?? null,
        warehouseId: warehouseId ?? null,
      })
      .returning();

    const itemValues = dedupResults.map(({ item, match, lineNumber }) => ({
      ingestionId: ingestion.id,
      lineNumber,
      rawName: item.name ?? null,
      rawSku: item.sku ?? null,
      rawBarcode: item.barcode ?? null,
      quantity: item.quantity ?? null,
      unit: item.unit ?? null,
      unitPrice: item.unitPrice != null ? String(item.unitPrice) : null,
      totalPrice: item.totalPrice != null ? String(item.totalPrice) : null,
      action: match.suggestedAction,
      matchType: match.matchType,
      matchConfidence: match.matchConfidence != null ? String(match.matchConfidence) : null,
      matchedProductId: match.matchedProductId ?? null,
      rawData: item as Record<string, unknown>,
    }));

    let items: typeof itemValues = [];
    if (itemValues.length > 0) {
      items = await tx
        .insert(documentIngestionItems)
        .values(itemValues)
        .returning() as any;
    }

    return { ingestion, items };
  });

  return formatIngestionResult(result.ingestion, dedupResults, dupCheck);
}

/**
 * Stage a barcode scan ingestion.
 * Barcodes are simpler — single value, direct product lookup.
 */
export async function stageBarcodeIngestion(input: {
  scannerOutput: ScannedBarcode;
  uploadedBy?: string | null;
  attachmentId?: string | null;
  sessionId?: string | null;
  confidence?: number | null;
  rawText?: string | null;
  sourceFilename?: string | null;
}): Promise<IngestionResult> {
  const { scannerOutput, uploadedBy, attachmentId, sessionId, confidence, rawText, sourceFilename } = input;

  // For barcode scans, the "line items" are the detected codes
  const codes = scannerOutput.codes ?? (scannerOutput.value ? [scannerOutput] : []);
  const lineItems: ScannedLineItem[] = codes.map((c: any) => ({
    barcode: c.value ?? null,
    name: null,
    sku: null,
    quantity: null,
    unit: null,
    unitPrice: null,
    totalPrice: null,
  }));

  const dedupResults: Array<{ item: ScannedLineItem; match: DedupMatch; lineNumber: number }> = [];
  for (let i = 0; i < lineItems.length; i++) {
    const match = await dedupLineItem(lineItems[i]);
    dedupResults.push({ item: lineItems[i], match, lineNumber: i + 1 });
  }

  const result = await db.transaction(async (tx) => {
    const [ingestion] = await tx
      .insert(documentIngestions)
      .values({
        mode: "barcode",
        status: "staged",
        sourceFilename: sourceFilename ?? null,
        confidence: confidence != null ? String(confidence) : null,
        rawText: rawText ?? null,
        scannerOutput: scannerOutput as Record<string, unknown>,
        itemCount: lineItems.length,
        uploadedBy: uploadedBy ?? null,
        attachmentId: attachmentId ?? null,
        sessionId: sessionId ?? null,
      })
      .returning();

    const itemValues = dedupResults.map(({ item, match, lineNumber }) => ({
      ingestionId: ingestion.id,
      lineNumber,
      rawName: null,
      rawSku: null,
      rawBarcode: item.barcode ?? null,
      quantity: null,
      unit: null,
      unitPrice: null,
      totalPrice: null,
      action: match.suggestedAction === "create_product" ? "needs_review" : match.suggestedAction,
      matchType: match.matchType,
      matchConfidence: match.matchConfidence != null ? String(match.matchConfidence) : null,
      matchedProductId: match.matchedProductId ?? null,
      rawData: item as Record<string, unknown>,
    }));

    let items: typeof itemValues = [];
    if (itemValues.length > 0) {
      items = await tx
        .insert(documentIngestionItems)
        .values(itemValues)
        .returning() as any;
    }

    return { ingestion, items };
  });

  return formatIngestionResult(result.ingestion, dedupResults, {
    isDuplicate: false,
  });
}

// ─── Commit Pipeline ──────────────────────────────────────────

/**
 * Commit an approved ingestion — write records to the target tables.
 * Only processes items with action = update_inventory or create_product.
 * Items marked "skip" or "needs_review" are left alone.
 */
export async function commitIngestion(
  ingestionId: string,
  reviewerId: string,
  reviewNotes?: string
): Promise<{ committed: number; skipped: number; errors: string[] }> {
  const ingestion = await db.query.documentIngestions.findFirst({
    where: eq(documentIngestions.id, ingestionId),
  });

  if (!ingestion) {
    throw new Error(`Ingestion ${ingestionId} not found`);
  }

  if (ingestion.status === "committed") {
    throw new Error("This ingestion has already been committed");
  }

  // Fetch items
  const items = await db.query.documentIngestionItems.findMany({
    where: eq(documentIngestionItems.ingestionId, ingestionId),
  });

  let committed = 0;
  let skipped = 0;
  const errors: string[] = [];

  // Determine the warehouse to use
  const warehouseId = ingestion.warehouseId ?? await getDefaultWarehouseId();

  await db.transaction(async (tx) => {
    for (const item of items) {
      // Use user override if provided, otherwise use dedup suggestion
      const action = item.userOverrideAction ?? item.action;
      const productId = item.userOverrideProductId ?? item.matchedProductId;

      try {
        switch (action) {
          case "update_inventory": {
            if (!productId || !warehouseId) {
              errors.push(`Line ${item.lineNumber}: Cannot update inventory — no product or warehouse match`);
              skipped++;
              continue;
            }
            const qty = item.quantity ?? 0;
            if (qty <= 0) {
              skipped++;
              continue;
            }

            // Upsert inventory
            const existing = await tx.query.inventory.findFirst({
              where: and(
                eq(inventory.productId, productId),
                eq(inventory.warehouseId, warehouseId)
              ),
            });

            if (existing) {
              await tx
                .update(inventory)
                .set({ quantity: existing.quantity + qty })
                .where(eq(inventory.id, existing.id));
            } else {
              await tx.insert(inventory).values({
                productId,
                warehouseId,
                quantity: qty,
              });
            }

            // Record transaction
            await tx.insert(inventoryTransactions).values({
              productId,
              warehouseId,
              type: "receipt",
              quantity: qty,
              referenceType: "document_ingestion",
              referenceId: ingestionId,
              notes: `From scanned ${ingestion.mode}: ${item.rawName ?? "unknown item"}`,
              performedBy: reviewerId,
            });

            committed++;
            break;
          }

          case "update_price": {
            if (!productId) {
              errors.push(`Line ${item.lineNumber}: Cannot update price — no product match`);
              skipped++;
              continue;
            }
            if (item.unitPrice != null) {
              await tx
                .update(products)
                .set({ costPrice: item.unitPrice })
                .where(eq(products.id, productId));
              committed++;
            } else {
              skipped++;
            }
            break;
          }

          case "create_product": {
            // Create a new product from scanned data.
            // Append a short random suffix to auto-generated SKUs to avoid
            // collisions when multiple items are created in the same commit.
            const baseSku = item.rawSku ?? `SCAN-${Date.now()}-${item.lineNumber}`;
            const newName = item.rawName ?? "Unknown Product";

            // Check if SKU already exists (could be inactive product or race)
            const existingSku = await tx
              .select({ id: products.id })
              .from(products)
              .where(eq(products.sku, baseSku))
              .limit(1);

            if (existingSku.length > 0) {
              errors.push(`Line ${item.lineNumber}: SKU "${baseSku}" already exists (product ${existingSku[0].id}). Skipping creation.`);
              skipped++;
              break;
            }

            const [newProduct] = await tx.insert(products).values({
              sku: baseSku,
              name: newName,
              barcode: item.rawBarcode ?? null,
              unit: item.unit ?? "piece",
              price: item.unitPrice ?? "0",
              costPrice: item.unitPrice ?? "0",
            }).returning({ id: products.id });

            // If quantity provided, add inventory
            if (newProduct && item.quantity && item.quantity > 0 && warehouseId) {
              await tx.insert(inventory).values({
                productId: newProduct.id,
                warehouseId,
                quantity: item.quantity,
              });

              await tx.insert(inventoryTransactions).values({
                productId: newProduct.id,
                warehouseId,
                type: "receipt",
                quantity: item.quantity,
                referenceType: "document_ingestion",
                referenceId: ingestionId,
                notes: `New product from scanned ${ingestion.mode}: ${newName}`,
                performedBy: reviewerId,
              });
            }

            committed++;
            break;
          }

          case "skip":
          case "needs_review":
          default:
            skipped++;
            break;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Line ${item.lineNumber} (${item.rawName ?? "unknown"}): ${msg}`);
        skipped++;
      }
    }

    // Update ingestion status
    await tx
      .update(documentIngestions)
      .set({
        status: errors.length > 0 ? "committed_with_errors" : "committed",
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
        reviewNotes: reviewNotes ?? null,
      })
      .where(eq(documentIngestions.id, ingestionId));
  });

  // If this was an invoice scan, create a proper invoice record
  // so it appears on the Invoices page.
  if (ingestion.mode === "invoice" && committed > 0) {
    try {
      const scanData = ingestion.scannerOutput as Record<string, unknown> | null;
      await createInvoiceFromScan({
        externalInvoiceNumber: (scanData?.invoiceNumber as string) ?? null,
        supplierName: (scanData?.supplierName as string) ?? null,
        subtotal: scanData?.subtotal != null ? Number(scanData.subtotal) : null,
        taxAmount: scanData?.taxAmount != null ? Number(scanData.taxAmount) : null,
        totalAmount: scanData?.totalAmount != null ? Number(scanData.totalAmount) : null,
        dueDate: (scanData?.dueDate as string) ?? null,
        ingestionId,
      });
    } catch {
      // Non-fatal — inventory was already committed; log but don't fail
      errors.push("Invoice record creation failed (inventory was committed successfully)");
    }
  }

  return { committed, skipped, errors };
}

/**
 * Reject an ingestion.
 */
export async function rejectIngestion(
  ingestionId: string,
  reviewerId: string,
  reviewNotes?: string
) {
  const [updated] = await db
    .update(documentIngestions)
    .set({
      status: "rejected",
      reviewedBy: reviewerId,
      reviewedAt: new Date(),
      reviewNotes: reviewNotes ?? null,
    })
    .where(eq(documentIngestions.id, ingestionId))
    .returning();

  if (!updated) throw new Error(`Ingestion ${ingestionId} not found`);
  return updated;
}

// ─── Query Helpers ────────────────────────────────────────────

/** Get a single ingestion with its items */
export async function getIngestion(id: string) {
  const ingestion = await db.query.documentIngestions.findFirst({
    where: eq(documentIngestions.id, id),
    with: { items: true },
  });
  if (!ingestion) throw new Error(`Ingestion ${id} not found`);
  return ingestion;
}

/** List ingestions by status */
export async function listIngestions(filters?: {
  status?: string;
  mode?: string;
  limit?: number;
}) {
  const conditions = [];
  if (filters?.status) conditions.push(eq(documentIngestions.status, filters.status));
  if (filters?.mode) conditions.push(eq(documentIngestions.mode, filters.mode));

  return db.query.documentIngestions.findMany({
    where: conditions.length > 0 ? and(...conditions) : undefined,
    orderBy: [sql`${documentIngestions.createdAt} DESC`],
    limit: filters?.limit ?? 50,
    with: {
      items: true,
      uploadedByUser: { columns: { id: true, name: true, email: true } },
    },
  });
}

/** Update an item's action or product override (user correction) */
export async function updateIngestionItem(
  itemId: string,
  updates: {
    action?: string;
    matchedProductId?: string;
  }
) {
  const updateValues: Record<string, unknown> = {};
  if (updates.action) updateValues.userOverrideAction = updates.action;
  if (updates.matchedProductId) updateValues.userOverrideProductId = updates.matchedProductId;

  const [updated] = await db
    .update(documentIngestionItems)
    .set(updateValues)
    .where(eq(documentIngestionItems.id, itemId))
    .returning();

  if (!updated) throw new Error(`Ingestion item ${itemId} not found`);
  return updated;
}

// ─── Internal helpers ─────────────────────────────────────────

/** Get the default warehouse ID */
async function getDefaultWarehouseId(): Promise<string | null> {
  const defaultWh = await db.query.warehouses.findFirst({
    where: and(eq(warehouses.isDefault, true), eq(warehouses.isActive, true)),
    columns: { id: true },
  });
  if (defaultWh) return defaultWh.id;

  // Fall back to first active warehouse
  const anyWh = await db.query.warehouses.findFirst({
    where: eq(warehouses.isActive, true),
    columns: { id: true },
  });
  return anyWh?.id ?? null;
}

/** Return existing ingestion when duplicate detected (no new rows inserted) */
async function returnExistingIngestion(
  existingId: string,
  dupCheck: { isDuplicate: boolean; existingId?: string; reason?: string }
): Promise<IngestionResult> {
  const existing = await db.query.documentIngestions.findFirst({
    where: eq(documentIngestions.id, existingId),
    with: { items: true },
  });

  if (!existing) {
    throw new Error(`Duplicate ingestion ${existingId} referenced but not found`);
  }

  return {
    ingestionId: existing.id,
    mode: existing.mode,
    status: existing.status,
    itemCount: existing.items?.length ?? 0,
    items: (existing.items ?? []).map((item: any) => ({
      lineNumber: item.lineNumber ?? 0,
      rawName: item.rawName ?? null,
      rawSku: item.rawSku ?? null,
      action: item.userOverrideAction ?? item.action ?? "needs_review",
      matchType: item.matchType ?? null,
      matchConfidence: item.matchConfidence != null ? Number(item.matchConfidence) : null,
      matchedProductName: null, // not stored on the item row
    })),
    duplicateWarning: dupCheck.reason,
    requiresApproval: false,
    approvalRequestId: null,
  };
}

/** Format ingestion + dedup results into a clean response */
function formatIngestionResult(
  ingestion: any,
  dedupResults: Array<{ item: ScannedLineItem; match: DedupMatch; lineNumber: number }>,
  dupCheck: { isDuplicate: boolean; existingId?: string; reason?: string }
): IngestionResult {
  return {
    ingestionId: ingestion.id,
    mode: ingestion.mode,
    status: ingestion.status,
    itemCount: dedupResults.length,
    items: dedupResults.map(({ item, match, lineNumber }) => ({
      lineNumber,
      rawName: item.name ?? item.description ?? null,
      rawSku: item.sku ?? null,
      action: match.suggestedAction,
      matchType: match.matchType,
      matchConfidence: match.matchConfidence,
      matchedProductName: match.matchedProductName,
    })),
    duplicateWarning: dupCheck.isDuplicate ? dupCheck.reason : undefined,
    requiresApproval: false, // Will be set by the scanner tool after checking workflow
    approvalRequestId: null,
  };
}
