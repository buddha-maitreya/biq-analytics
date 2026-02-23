/**
 * Product Search Log Service
 *
 * Captures every product search event for AI analytics.
 * Enables demand forecasting, cross-branch hoarding detection,
 * and inventory movement intelligence.
 */
import { db, productSearchLog } from "@db/index";
import { eq, desc, sql, and, gte } from "drizzle-orm";

export interface LogSearchParams {
  userId?: string;
  searchTerm: string;
  warehouseId?: string;
  categoryFilter?: string;
  resultCount: number;
  productIdClicked?: string;
  searchDurationMs?: number;
  source?: string;
  deviceType?: string;
  ipAddress?: string;
}

/**
 * Log a product search event. Fire-and-forget — callers should
 * not await this in the critical path.
 */
export async function logSearch(params: LogSearchParams) {
  try {
    await db.insert(productSearchLog).values({
      userId: params.userId ?? null,
      searchTerm: params.searchTerm,
      warehouseId: params.warehouseId ?? null,
      categoryFilter: params.categoryFilter ?? null,
      resultCount: params.resultCount,
      productIdClicked: params.productIdClicked ?? null,
      searchDurationMs: params.searchDurationMs ?? null,
      source: params.source ?? "products_page",
      deviceType: params.deviceType ?? null,
      ipAddress: params.ipAddress ?? null,
    });
  } catch {
    // Silently fail — search logging should never break the user flow
  }
}

/**
 * Record a product click from search results (separate call after initial log).
 */
export async function logProductClick(searchLogId: string, productId: string) {
  try {
    await db
      .update(productSearchLog)
      .set({ productIdClicked: productId })
      .where(eq(productSearchLog.id, searchLogId));
  } catch {
    // Silently fail
  }
}

/**
 * Get search analytics — top searched terms, by warehouse, time range.
 * Used by AI agents for demand intelligence.
 */
export async function getSearchAnalytics(opts?: {
  warehouseId?: string;
  days?: number;
  limit?: number;
}) {
  const days = opts?.days ?? 30;
  const limit = opts?.limit ?? 50;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const conditions = [gte(productSearchLog.createdAt, since)];
  if (opts?.warehouseId) {
    conditions.push(eq(productSearchLog.warehouseId, opts.warehouseId));
  }

  // Top search terms
  const topTerms = await db
    .select({
      searchTerm: productSearchLog.searchTerm,
      count: sql<number>`count(*)`.as("count"),
      avgResults: sql<number>`avg(${productSearchLog.resultCount})`.as("avg_results"),
    })
    .from(productSearchLog)
    .where(and(...conditions))
    .groupBy(productSearchLog.searchTerm)
    .orderBy(sql`count(*) DESC`)
    .limit(limit);

  // Searches with zero results (potential demand gaps)
  const zeroResults = await db
    .select({
      searchTerm: productSearchLog.searchTerm,
      count: sql<number>`count(*)`.as("count"),
      warehouseId: productSearchLog.warehouseId,
    })
    .from(productSearchLog)
    .where(and(...conditions, eq(productSearchLog.resultCount, 0)))
    .groupBy(productSearchLog.searchTerm, productSearchLog.warehouseId)
    .orderBy(sql`count(*) DESC`)
    .limit(limit);

  // Search volume by warehouse (hoarding detection)
  const byWarehouse = await db
    .select({
      warehouseId: productSearchLog.warehouseId,
      searchCount: sql<number>`count(*)`.as("search_count"),
      uniqueTerms: sql<number>`count(distinct ${productSearchLog.searchTerm})`.as("unique_terms"),
    })
    .from(productSearchLog)
    .where(and(...conditions))
    .groupBy(productSearchLog.warehouseId)
    .orderBy(sql`count(*) DESC`);

  // Recent searches
  const recent = await db.query.productSearchLog.findMany({
    where: and(...conditions),
    orderBy: [desc(productSearchLog.createdAt)],
    limit: 20,
    with: { user: true, warehouse: true, productClicked: true },
  });

  return { topTerms, zeroResults, byWarehouse, recent };
}
