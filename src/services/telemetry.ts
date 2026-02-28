/**
 * Tracing Service — Phase 1.10
 *
 * Provides a lightweight wrapper around OpenTelemetry tracing plus
 * a Postgres-backed span recorder. Agents call `recordSpan()` to
 * persist spans to the `agent_telemetry` table for dashboarding.
 *
 * The `traced()` utility wraps any async function in a span that
 * is both reported to OpenTelemetry (via ctx.tracer) and persisted
 * to the database for querying.
 */

import { eq, desc, sql, gte, and, lte } from "drizzle-orm";
import { db, agentTelemetry } from "@db/index";
import { dbRows } from "@db/rows";

// ── Types ──────────────────────────────────────────────────

export type SpanType = "agent" | "llm" | "tool" | "sandbox" | "db_query";
export type SpanStatus = "ok" | "error";

export interface TelemetrySpan {
  id: string;
  agentName: string;
  spanType: SpanType;
  spanName: string;
  status: SpanStatus;
  durationMs: number | null;
  sessionId: string | null;
  parentSpanId: string | null;
  errorMessage: string | null;
  attributes: Record<string, unknown> | null;
  startedAt: Date;
  createdAt: Date;
}

export interface RecordSpanInput {
  agentName: string;
  spanType: SpanType;
  spanName: string;
  status?: SpanStatus;
  durationMs?: number;
  sessionId?: string;
  parentSpanId?: string;
  errorMessage?: string;
  attributes?: Record<string, unknown>;
  startedAt?: Date;
}

export interface SpanSummary {
  agentName: string;
  spanType: string;
  totalSpans: number;
  errorCount: number;
  avgDurationMs: number | null;
  p95DurationMs: number | null;
  errorRate: number;
}

export interface AgentPerformance {
  agentName: string;
  totalInvocations: number;
  avgDurationMs: number | null;
  errorRate: number;
  llmCalls: number;
  toolCalls: number;
  avgLlmLatencyMs: number | null;
}

// ── Mutations ──────────────────────────────────────────────

/** Record a telemetry span to the database */
export async function recordSpan(input: RecordSpanInput): Promise<TelemetrySpan> {
  const [row] = await db
    .insert(agentTelemetry)
    .values({
      agentName: input.agentName,
      spanType: input.spanType,
      spanName: input.spanName,
      status: input.status ?? "ok",
      durationMs: input.durationMs,
      sessionId: input.sessionId,
      parentSpanId: input.parentSpanId,
      errorMessage: input.errorMessage,
      attributes: input.attributes,
      startedAt: input.startedAt ?? new Date(),
    })
    .returning();

  return row as unknown as TelemetrySpan;
}

/** Record multiple spans in a batch (for end-of-request flushing) */
export async function recordSpanBatch(inputs: RecordSpanInput[]): Promise<number> {
  if (inputs.length === 0) return 0;

  const values = inputs.map((input) => ({
    agentName: input.agentName,
    spanType: input.spanType as string,
    spanName: input.spanName,
    status: (input.status ?? "ok") as string,
    durationMs: input.durationMs,
    sessionId: input.sessionId,
    parentSpanId: input.parentSpanId,
    errorMessage: input.errorMessage,
    attributes: input.attributes,
    startedAt: input.startedAt ?? new Date(),
  }));

  const result = await db.insert(agentTelemetry).values(values).returning({ id: agentTelemetry.id });
  return result.length;
}

// ── Queries ────────────────────────────────────────────────

/** List recent spans with optional filters */
export async function listSpans(opts: {
  agentName?: string;
  spanType?: string;
  status?: string;
  sessionId?: string;
  since?: Date;
  limit?: number;
  offset?: number;
}): Promise<{ spans: TelemetrySpan[]; total: number }> {
  const conditions = [];
  if (opts.agentName) conditions.push(eq(agentTelemetry.agentName, opts.agentName));
  if (opts.spanType) conditions.push(eq(agentTelemetry.spanType, opts.spanType));
  if (opts.status) conditions.push(eq(agentTelemetry.status, opts.status));
  if (opts.sessionId) conditions.push(eq(agentTelemetry.sessionId, opts.sessionId));
  if (opts.since) conditions.push(gte(agentTelemetry.startedAt, opts.since));

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  const [spans, countResult] = await Promise.all([
    db
      .select()
      .from(agentTelemetry)
      .where(where)
      .orderBy(desc(agentTelemetry.startedAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(agentTelemetry)
      .where(where),
  ]);

  return {
    spans: spans as unknown as TelemetrySpan[],
    total: countResult[0]?.count ?? 0,
  };
}

/** Get aggregate performance summary per agent */
export async function getAgentPerformanceSummary(
  since?: Date
): Promise<AgentPerformance[]> {
  const sinceDate = since ?? new Date(Date.now() - 7 * 86400000); // last 7 days default

  const rows = await db.execute(sql`
    SELECT
      agent_name,
      COUNT(*) FILTER (WHERE span_type = 'agent')::int AS total_invocations,
      ROUND(AVG(duration_ms) FILTER (WHERE span_type = 'agent'))::int AS avg_duration_ms,
      ROUND(
        COUNT(*) FILTER (WHERE span_type = 'agent' AND status = 'error')::numeric /
        NULLIF(COUNT(*) FILTER (WHERE span_type = 'agent'), 0) * 100, 1
      ) AS error_rate,
      COUNT(*) FILTER (WHERE span_type = 'llm')::int AS llm_calls,
      COUNT(*) FILTER (WHERE span_type = 'tool')::int AS tool_calls,
      ROUND(AVG(duration_ms) FILTER (WHERE span_type = 'llm'))::int AS avg_llm_latency_ms
    FROM agent_telemetry
    WHERE started_at >= ${sinceDate}
    GROUP BY agent_name
    ORDER BY total_invocations DESC
  `);

  return dbRows(rows).map((r) => ({
    agentName: r.agent_name,
    totalInvocations: r.total_invocations ?? 0,
    avgDurationMs: r.avg_duration_ms,
    errorRate: parseFloat(r.error_rate ?? "0"),
    llmCalls: r.llm_calls ?? 0,
    toolCalls: r.tool_calls ?? 0,
    avgLlmLatencyMs: r.avg_llm_latency_ms,
  }));
}

/** Get span breakdown by type for a specific agent */
export async function getSpanBreakdown(
  agentName: string,
  since?: Date
): Promise<SpanSummary[]> {
  const sinceDate = since ?? new Date(Date.now() - 7 * 86400000);

  const rows = await db.execute(sql`
    SELECT
      agent_name,
      span_type,
      COUNT(*)::int AS total_spans,
      COUNT(*) FILTER (WHERE status = 'error')::int AS error_count,
      ROUND(AVG(duration_ms))::int AS avg_duration_ms,
      ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms))::int AS p95_duration_ms,
      ROUND(
        COUNT(*) FILTER (WHERE status = 'error')::numeric /
        NULLIF(COUNT(*), 0) * 100, 1
      ) AS error_rate
    FROM agent_telemetry
    WHERE agent_name = ${agentName} AND started_at >= ${sinceDate}
    GROUP BY agent_name, span_type
    ORDER BY total_spans DESC
  `);

  return dbRows(rows).map((r) => ({
    agentName: r.agent_name,
    spanType: r.span_type,
    totalSpans: r.total_spans ?? 0,
    errorCount: r.error_count ?? 0,
    avgDurationMs: r.avg_duration_ms,
    p95DurationMs: r.p95_duration_ms,
    errorRate: parseFloat(r.error_rate ?? "0"),
  }));
}

/** Get hourly span counts for timeline chart data */
export async function getSpanTimeline(
  since?: Date,
  agentName?: string
): Promise<Array<{ hour: string; count: number; errorCount: number }>> {
  const sinceDate = since ?? new Date(Date.now() - 24 * 3600000); // last 24h default

  const agentFilter = agentName
    ? sql`AND agent_name = ${agentName}`
    : sql``;

  const rows = await db.execute(sql`
    SELECT
      date_trunc('hour', started_at) AS hour,
      COUNT(*)::int AS count,
      COUNT(*) FILTER (WHERE status = 'error')::int AS error_count
    FROM agent_telemetry
    WHERE started_at >= ${sinceDate} ${agentFilter}
    GROUP BY date_trunc('hour', started_at)
    ORDER BY hour
  `);

  return dbRows(rows).map((r) => ({
    hour: r.hour?.toISOString?.() ?? String(r.hour),
    count: r.count ?? 0,
    errorCount: r.error_count ?? 0,
  }));
}

/** Purge old telemetry data (for cleanup tasks) */
export async function purgeTelemetry(olderThanDays: number = 30): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 86400000);
  const result = await db
    .delete(agentTelemetry)
    .where(lte(agentTelemetry.startedAt, cutoff))
    .returning({ id: agentTelemetry.id });
  return result.length;
}
