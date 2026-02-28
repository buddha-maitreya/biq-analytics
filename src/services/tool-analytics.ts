/**
 * Tool Analytics Service — Phase 2.2
 *
 * Tracks every tool invocation with timing, status, and context.
 * Provides aggregated analytics: most used tools, error rates,
 * latency distributions, and usage trends over time.
 */

import { eq, desc, sql, gte, and, lte } from "drizzle-orm";
import { db, toolInvocations } from "@db/index";
import { dbRows } from "@db/rows";

// ── Types ──────────────────────────────────────────────────

export interface ToolInvocation {
  id: string;
  toolName: string;
  agentName: string;
  status: string;
  durationMs: number | null;
  sessionId: string | null;
  inputSizeChars: number | null;
  outputSizeChars: number | null;
  errorType: string | null;
  errorMessage: string | null;
  attributes: Record<string, unknown> | null;
  createdAt: Date;
}

export interface RecordToolInput {
  toolName: string;
  agentName: string;
  status?: "success" | "error" | "timeout";
  durationMs?: number;
  sessionId?: string;
  inputSizeChars?: number;
  outputSizeChars?: number;
  errorType?: string;
  errorMessage?: string;
  attributes?: Record<string, unknown>;
}

export interface ToolUsageStats {
  toolName: string;
  totalCalls: number;
  successCount: number;
  errorCount: number;
  timeoutCount: number;
  successRate: number;
  avgDurationMs: number | null;
  p95DurationMs: number | null;
  avgInputSize: number | null;
  avgOutputSize: number | null;
}

export interface ToolTrend {
  date: string;
  toolName: string;
  callCount: number;
  errorCount: number;
  avgDurationMs: number | null;
}

export interface ToolAnalyticsDashboard {
  totalCalls: number;
  totalErrors: number;
  avgDurationMs: number | null;
  toolStats: ToolUsageStats[];
  agentBreakdown: Array<{ agentName: string; toolName: string; calls: number }>;
}

// ── Mutations ──────────────────────────────────────────────

/** Record a single tool invocation */
export async function recordToolInvocation(input: RecordToolInput): Promise<ToolInvocation> {
  const [row] = await db
    .insert(toolInvocations)
    .values({
      toolName: input.toolName,
      agentName: input.agentName,
      status: input.status ?? "success",
      durationMs: input.durationMs,
      sessionId: input.sessionId,
      inputSizeChars: input.inputSizeChars,
      outputSizeChars: input.outputSizeChars,
      errorType: input.errorType,
      errorMessage: input.errorMessage,
      attributes: input.attributes,
    })
    .returning();

  return row as unknown as ToolInvocation;
}

/** Record multiple tool invocations in a batch */
export async function recordToolInvocationBatch(inputs: RecordToolInput[]): Promise<number> {
  if (inputs.length === 0) return 0;

  const values = inputs.map((input) => ({
    toolName: input.toolName,
    agentName: input.agentName,
    status: (input.status ?? "success") as string,
    durationMs: input.durationMs,
    sessionId: input.sessionId,
    inputSizeChars: input.inputSizeChars,
    outputSizeChars: input.outputSizeChars,
    errorType: input.errorType,
    errorMessage: input.errorMessage,
    attributes: input.attributes,
  }));

  const result = await db.insert(toolInvocations).values(values).returning({ id: toolInvocations.id });
  return result.length;
}

// ── Queries ────────────────────────────────────────────────

/** List recent tool invocations with filters */
export async function listToolInvocations(opts: {
  toolName?: string;
  agentName?: string;
  status?: string;
  sessionId?: string;
  since?: Date;
  limit?: number;
  offset?: number;
}): Promise<{ invocations: ToolInvocation[]; total: number }> {
  const conditions = [];
  if (opts.toolName) conditions.push(eq(toolInvocations.toolName, opts.toolName));
  if (opts.agentName) conditions.push(eq(toolInvocations.agentName, opts.agentName));
  if (opts.status) conditions.push(eq(toolInvocations.status, opts.status));
  if (opts.sessionId) conditions.push(eq(toolInvocations.sessionId, opts.sessionId));
  if (opts.since) conditions.push(gte(toolInvocations.createdAt, opts.since));

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  const [invocations, countResult] = await Promise.all([
    db
      .select()
      .from(toolInvocations)
      .where(where)
      .orderBy(desc(toolInvocations.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(toolInvocations)
      .where(where),
  ]);

  return {
    invocations: invocations as unknown as ToolInvocation[],
    total: countResult[0]?.count ?? 0,
  };
}

/** Get per-tool usage statistics */
export async function getToolUsageStats(since?: Date): Promise<ToolUsageStats[]> {
  const sinceDate = since ?? new Date(Date.now() - 7 * 86400000);

  const rows = await db.execute(sql`
    SELECT
      tool_name,
      COUNT(*)::int AS total_calls,
      COUNT(*) FILTER (WHERE status = 'success')::int AS success_count,
      COUNT(*) FILTER (WHERE status = 'error')::int AS error_count,
      COUNT(*) FILTER (WHERE status = 'timeout')::int AS timeout_count,
      ROUND(
        COUNT(*) FILTER (WHERE status = 'success')::numeric /
        NULLIF(COUNT(*), 0) * 100, 1
      ) AS success_rate,
      ROUND(AVG(duration_ms))::int AS avg_duration_ms,
      ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms))::int AS p95_duration_ms,
      ROUND(AVG(input_size_chars))::int AS avg_input_size,
      ROUND(AVG(output_size_chars))::int AS avg_output_size
    FROM tool_invocations
    WHERE created_at >= ${sinceDate}
    GROUP BY tool_name
    ORDER BY total_calls DESC
  `);

  return dbRows(rows).map((r) => ({
    toolName: r.tool_name,
    totalCalls: r.total_calls ?? 0,
    successCount: r.success_count ?? 0,
    errorCount: r.error_count ?? 0,
    timeoutCount: r.timeout_count ?? 0,
    successRate: parseFloat(r.success_rate ?? "0"),
    avgDurationMs: r.avg_duration_ms,
    p95DurationMs: r.p95_duration_ms,
    avgInputSize: r.avg_input_size,
    avgOutputSize: r.avg_output_size,
  }));
}

/** Get daily tool usage trends */
export async function getToolTrends(
  since?: Date,
  toolName?: string
): Promise<ToolTrend[]> {
  const sinceDate = since ?? new Date(Date.now() - 30 * 86400000);

  const toolFilter = toolName
    ? sql`AND tool_name = ${toolName}`
    : sql``;

  const rows = await db.execute(sql`
    SELECT
      date_trunc('day', created_at)::date AS date,
      tool_name,
      COUNT(*)::int AS call_count,
      COUNT(*) FILTER (WHERE status = 'error')::int AS error_count,
      ROUND(AVG(duration_ms))::int AS avg_duration_ms
    FROM tool_invocations
    WHERE created_at >= ${sinceDate} ${toolFilter}
    GROUP BY date_trunc('day', created_at)::date, tool_name
    ORDER BY date, call_count DESC
  `);

  return dbRows(rows).map((r) => ({
    date: r.date?.toISOString?.()?.slice(0, 10) ?? String(r.date),
    toolName: r.tool_name,
    callCount: r.call_count ?? 0,
    errorCount: r.error_count ?? 0,
    avgDurationMs: r.avg_duration_ms,
  }));
}

/** Get full dashboard data in one call */
export async function getToolDashboard(since?: Date): Promise<ToolAnalyticsDashboard> {
  const sinceDate = since ?? new Date(Date.now() - 7 * 86400000);

  const [totalsResult, toolStats, agentRows] = await Promise.all([
    db.execute(sql`
      SELECT
        COUNT(*)::int AS total_calls,
        COUNT(*) FILTER (WHERE status != 'success')::int AS total_errors,
        ROUND(AVG(duration_ms))::int AS avg_duration_ms
      FROM tool_invocations
      WHERE created_at >= ${sinceDate}
    `),
    getToolUsageStats(sinceDate),
    db.execute(sql`
      SELECT agent_name, tool_name, COUNT(*)::int AS calls
      FROM tool_invocations
      WHERE created_at >= ${sinceDate}
      GROUP BY agent_name, tool_name
      ORDER BY calls DESC
    `),
  ]);

  const totals = dbRows(totalsResult)[0] ?? {};

  return {
    totalCalls: totals.total_calls ?? 0,
    totalErrors: totals.total_errors ?? 0,
    avgDurationMs: totals.avg_duration_ms,
    toolStats,
    agentBreakdown: dbRows(agentRows).map((r) => ({
      agentName: r.agent_name,
      toolName: r.tool_name,
      calls: r.calls ?? 0,
    })),
  };
}

/** Purge old tool invocation data */
export async function purgeToolInvocations(olderThanDays: number = 30): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 86400000);
  const result = await db
    .delete(toolInvocations)
    .where(lte(toolInvocations.createdAt, cutoff))
    .returning({ id: toolInvocations.id });
  return result.length;
}
