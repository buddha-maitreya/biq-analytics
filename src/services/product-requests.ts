/**
 * Product Request Service — Borrow / Request
 *
 * Tracks when staff request inventory from another location.
 * - "borrow": branch → branch (peer transfer)
 * - "request": branch → warehouse (requisition from central stock)
 *
 * This data feeds AI agents for demand forecasting, hoarding
 * detection, and redistribution recommendations.
 */
import { db, productRequests, inventory, warehouses } from "@db/index";
import { eq, and, desc, sql, gte, inArray } from "drizzle-orm";
import { z } from "zod";
import { NotFoundError } from "@lib/errors";

// ── Validation ─────────────────────────────────────────────

const uuidParam = z.string().uuid();

export const createProductRequestSchema = z.object({
  productId: uuidParam,
  fromWarehouseId: uuidParam,
  toWarehouseId: uuidParam,
  requestType: z.enum(["borrow", "request"]),
  quantity: z.number().int().min(1).default(1),
  urgency: z.enum(["low", "normal", "high", "critical"]).default("normal"),
  reason: z.string().max(1000).optional(),
  originSearchTerm: z.string().max(500).optional(),
});

export const updateRequestStatusSchema = z.object({
  status: z.enum(["approved", "rejected", "fulfilled", "cancelled"]),
  comment: z.string().max(1000).optional(),
});

// ── Service Functions ──────────────────────────────────────

/**
 * Create a borrow/request for a product from another location.
 */
export async function createProductRequest(
  requesterId: string,
  data: z.infer<typeof createProductRequestSchema>
) {
  const parsed = createProductRequestSchema.parse(data);

  const [request] = await db
    .insert(productRequests)
    .values({
      requesterId,
      productId: parsed.productId,
      fromWarehouseId: parsed.fromWarehouseId,
      toWarehouseId: parsed.toWarehouseId,
      requestType: parsed.requestType,
      quantity: parsed.quantity,
      urgency: parsed.urgency,
      reason: parsed.reason ?? null,
      originSearchTerm: parsed.originSearchTerm ?? null,
      status: "pending",
    })
    .returning();

  return request;
}

/**
 * Update a request status (approve, reject, fulfil, cancel).
 */
export async function updateRequestStatus(
  requestId: string,
  deciderId: string,
  data: z.infer<typeof updateRequestStatusSchema>
) {
  const parsed = updateRequestStatusSchema.parse(data);

  const [request] = await db
    .update(productRequests)
    .set({
      status: parsed.status,
      deciderId,
      decidedAt: new Date(),
      deciderComment: parsed.comment ?? null,
    })
    .where(eq(productRequests.id, requestId))
    .returning();

  if (!request) throw new NotFoundError("Product request", requestId);
  return request;
}

/**
 * Get a single request with relations.
 */
export async function getProductRequest(id: string) {
  const request = await db.query.productRequests.findFirst({
    where: eq(productRequests.id, id),
    with: {
      requester: true,
      product: true,
      fromWarehouse: true,
      toWarehouse: true,
      decider: true,
    },
  });
  if (!request) throw new NotFoundError("Product request", id);
  return request;
}

/**
 * List requests for a specific user (their own requests).
 */
export async function listMyRequests(requesterId: string) {
  return db.query.productRequests.findMany({
    where: eq(productRequests.requesterId, requesterId),
    orderBy: [desc(productRequests.createdAt)],
    limit: 100,
    with: {
      product: true,
      fromWarehouse: true,
      toWarehouse: true,
    },
  });
}

/**
 * List pending requests for a warehouse (for managers to action).
 */
export async function listPendingForWarehouse(warehouseId: string) {
  return db.query.productRequests.findMany({
    where: and(
      eq(productRequests.toWarehouseId, warehouseId),
      eq(productRequests.status, "pending")
    ),
    orderBy: [desc(productRequests.createdAt)],
    with: {
      requester: true,
      product: true,
      fromWarehouse: true,
    },
  });
}

/**
 * Get cross-branch stock availability for a product.
 * Returns stock levels across ALL locations so the UI can show
 * "Available at Branch X (50 units)" with borrow/request buttons.
 */
export async function getCrossBranchAvailability(
  productId: string,
  excludeWarehouseId?: string
) {
  const conditions = [eq(inventory.productId, productId)];

  const stockRows = await db.query.inventory.findMany({
    where: and(...conditions),
    with: {
      warehouse: true,
    },
  });

  // Filter out the requester's own warehouse and inactive locations
  return stockRows
    .filter((row) => {
      if (!row.warehouse?.isActive) return false;
      if (excludeWarehouseId && row.warehouseId === excludeWarehouseId) return false;
      return row.quantity > 0;
    })
    .map((row) => ({
      warehouseId: row.warehouseId,
      warehouseName: row.warehouse?.name ?? "Unknown",
      warehouseCode: row.warehouse?.code ?? "",
      locationType: (row.warehouse as any)?.locationType ?? "warehouse",
      quantity: row.quantity,
      reservedQuantity: row.reservedQuantity,
      available: row.quantity - row.reservedQuantity,
    }));
}

/**
 * Request analytics for AI agents — demand patterns, hoarding signals.
 */
export async function getRequestAnalytics(opts?: {
  days?: number;
  limit?: number;
}) {
  const days = opts?.days ?? 30;
  const limit = opts?.limit ?? 50;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // Most requested products (demand signal)
  const topRequested = await db
    .select({
      productId: productRequests.productId,
      count: sql<number>`count(*)`.as("count"),
      totalQty: sql<number>`sum(${productRequests.quantity})`.as("total_qty"),
    })
    .from(productRequests)
    .where(gte(productRequests.createdAt, since))
    .groupBy(productRequests.productId)
    .orderBy(sql`count(*) DESC`)
    .limit(limit);

  // Locations requesting the most (understocked branches)
  const topRequesters = await db
    .select({
      fromWarehouseId: productRequests.fromWarehouseId,
      count: sql<number>`count(*)`.as("count"),
    })
    .from(productRequests)
    .where(gte(productRequests.createdAt, since))
    .groupBy(productRequests.fromWarehouseId)
    .orderBy(sql`count(*) DESC`)
    .limit(limit);

  // Locations being requested from the most (potential hoarding)
  const topSources = await db
    .select({
      toWarehouseId: productRequests.toWarehouseId,
      count: sql<number>`count(*)`.as("count"),
    })
    .from(productRequests)
    .where(gte(productRequests.createdAt, since))
    .groupBy(productRequests.toWarehouseId)
    .orderBy(sql`count(*) DESC`)
    .limit(limit);

  // Fulfillment rate
  const statusBreakdown = await db
    .select({
      status: productRequests.status,
      count: sql<number>`count(*)`.as("count"),
    })
    .from(productRequests)
    .where(gte(productRequests.createdAt, since))
    .groupBy(productRequests.status);

  return { topRequested, topRequesters, topSources, statusBreakdown };
}
