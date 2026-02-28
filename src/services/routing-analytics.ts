/**
 * Routing Analytics Service — Phase 7.3
 *
 * Tracks orchestrator routing decisions for analysis.
 * Enables understanding which tools are used most, which queries
 * are routed incorrectly (via correction detection), and overall
 * routing effectiveness.
 */

import { eq, desc, sql, gte, and } from "drizzle-orm";
import { db, routingAnalytics } from "@db/index";
import { dbRows } from "@db/rows";

// ── Types ──────────────────────────────────────────────────

export interface RoutingAnalyticsRow {
  id: string;
  sessionId: string | null;
  userMessage: string;
  toolsSelected: string[];
  strategy: string | null;
  hadCorrection: boolean | null;
  feedbackScore: number | null;
  latencyMs: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RecordRoutingInput {
  sessionId?: string;
  userMessage: string;
  toolsSelected: string[];
  strategy?: string;
  latencyMs?: number;
  metadata?: Record<string, unknown>;
}

export interface ToolUsageSummary {
  toolName: string;
  totalUses: number;
  avgLatencyMs: number | null;
  correctionRate: number;
}

export interface RoutingSummary {
  totalDecisions: number;
  correctionRate: number;
  avgLatencyMs: number | null;
  toolUsage: ToolUsageSummary[];
  strategyBreakdown: Record<string, number>;
}

// ── Mutations ──────────────────────────────────────────────

/** Record a routing decision */
export async function recordRoutingDecision(
  input: RecordRoutingInput
): Promise<RoutingAnalyticsRow> {
  const [row] = await db
    .insert(routingAnalytics)
    .values({
      sessionId: input.sessionId ?? null,
      userMessage: input.userMessage.slice(0, 1000), // Truncate to prevent bloat
      toolsSelected: input.toolsSelected,
      strategy: input.strategy ?? null,
      latencyMs: input.latencyMs ?? null,
      metadata: input.metadata ?? null,
    })
    .returning();

  return row as RoutingAnalyticsRow;
}

/** Mark a routing decision as having a correction (negative signal) */
export async function markCorrection(id: string): Promise<void> {
  await db
    .update(routingAnalytics)
    .set({ hadCorrection: true })
    .where(eq(routingAnalytics.id, id));
}

/** Record user feedback on a routing decision */
export async function recordFeedback(
  id: string,
  score: number
): Promise<void> {
  await db
    .update(routingAnalytics)
    .set({ feedbackScore: score })
    .where(eq(routingAnalytics.id, id));
}

// ── Queries ────────────────────────────────────────────────

/** Get recent routing decisions with pagination */
export async function listRoutingDecisions(options: {
  sessionId?: string;
  limit?: number;
  offset?: number;
}): Promise<{ data: RoutingAnalyticsRow[]; total: number }> {
  const { sessionId, limit = 50, offset = 0 } = options;

  const whereClause = sessionId
    ? eq(routingAnalytics.sessionId, sessionId)
    : undefined;

  const [data, [{ count }]] = await Promise.all([
    db
      .select()
      .from(routingAnalytics)
      .where(whereClause)
      .orderBy(desc(routingAnalytics.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(routingAnalytics)
      .where(whereClause),
  ]);

  return { data: data as RoutingAnalyticsRow[], total: count };
}

/** Get aggregated routing summary for a time period */
export async function getRoutingSummary(
  sinceDays: number = 30
): Promise<RoutingSummary> {
  const sinceDate = gte(
    routingAnalytics.createdAt,
    sql`NOW() - INTERVAL '${sql.raw(String(sinceDays))} days'`
  );

  // Overall stats
  const [overall] = await db
    .select({
      totalDecisions: sql<number>`count(*)::int`,
      correctionCount: sql<number>`count(*) FILTER (WHERE ${routingAnalytics.hadCorrection} = true)::int`,
      avgLatencyMs: sql<number>`avg(${routingAnalytics.latencyMs})`,
    })
    .from(routingAnalytics)
    .where(sinceDate);

  // Tool usage breakdown (unnest the JSONB array)
  const toolRows = await db.execute(sql`
    SELECT 
      tool::text AS tool_name,
      count(*)::int AS total_uses,
      avg(${routingAnalytics.latencyMs})::numeric AS avg_latency_ms,
      count(*) FILTER (WHERE ${routingAnalytics.hadCorrection} = true)::int AS correction_count
    FROM ${routingAnalytics},
      jsonb_array_elements_text(${routingAnalytics.toolsSelected}) AS tool
    WHERE ${routingAnalytics.createdAt} >= NOW() - INTERVAL '${sql.raw(String(sinceDays))} days'
    GROUP BY tool
    ORDER BY total_uses DESC
  `);

  // Strategy breakdown
  const strategyRows = await db
    .select({
      strategy: routingAnalytics.strategy,
      count: sql<number>`count(*)::int`,
    })
    .from(routingAnalytics)
    .where(sinceDate)
    .groupBy(routingAnalytics.strategy);

  const toolUsage: ToolUsageSummary[] = dbRows(toolRows).map((r: any) => ({
    toolName: r.tool_name,
    totalUses: r.total_uses,
    avgLatencyMs: r.avg_latency_ms ? Number(r.avg_latency_ms) : null,
    correctionRate: r.total_uses > 0 ? r.correction_count / r.total_uses : 0,
  }));

  const strategyBreakdown: Record<string, number> = {};
  for (const r of strategyRows) {
    strategyBreakdown[r.strategy ?? "unknown"] = r.count;
  }

  return {
    totalDecisions: overall.totalDecisions,
    correctionRate:
      overall.totalDecisions > 0
        ? overall.correctionCount / overall.totalDecisions
        : 0,
    avgLatencyMs: overall.avgLatencyMs ? Number(overall.avgLatencyMs) : null,
    toolUsage,
    strategyBreakdown,
  };
}
