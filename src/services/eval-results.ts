/**
 * Eval Results Service — Phase 7.6
 *
 * Persists evaluation outcomes to the eval_results table.
 * Used by the eval dashboard and automated eval analysis.
 */

import { eq, and, desc, sql, gte } from "drizzle-orm";
import { db, evalResults } from "@db/index";

// ── Types ──────────────────────────────────────────────────

export interface EvalResultRow {
  id: string;
  agentName: string;
  evalName: string;
  passed: boolean;
  score: string | null;
  reason: string | null;
  sessionId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RecordEvalInput {
  agentName: string;
  evalName: string;
  passed: boolean;
  score?: number;
  reason?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

export interface EvalSummary {
  agentName: string;
  evalName: string;
  totalRuns: number;
  passCount: number;
  failCount: number;
  passRate: number;
  avgScore: number | null;
}

// ── Mutations ──────────────────────────────────────────────

/** Record a single eval result */
export async function recordEvalResult(
  input: RecordEvalInput
): Promise<EvalResultRow> {
  const [row] = await db
    .insert(evalResults)
    .values({
      agentName: input.agentName,
      evalName: input.evalName,
      passed: input.passed,
      score: input.score?.toFixed(4) ?? null,
      reason: input.reason ?? null,
      sessionId: input.sessionId ?? null,
      metadata: input.metadata ?? null,
    })
    .returning();

  return row as EvalResultRow;
}

/** Record multiple eval results in a batch */
export async function recordEvalResults(
  inputs: RecordEvalInput[]
): Promise<EvalResultRow[]> {
  if (!inputs.length) return [];

  const rows = await db
    .insert(evalResults)
    .values(
      inputs.map((input) => ({
        agentName: input.agentName,
        evalName: input.evalName,
        passed: input.passed,
        score: input.score?.toFixed(4) ?? null,
        reason: input.reason ?? null,
        sessionId: input.sessionId ?? null,
        metadata: input.metadata ?? null,
      }))
    )
    .returning();

  return rows as EvalResultRow[];
}

// ── Queries ────────────────────────────────────────────────

/** Get recent eval results with pagination */
export async function listEvalResults(options: {
  agentName?: string;
  evalName?: string;
  passed?: boolean;
  limit?: number;
  offset?: number;
}): Promise<{ data: EvalResultRow[]; total: number }> {
  const { agentName, evalName, passed, limit = 50, offset = 0 } = options;

  const conditions = [];
  if (agentName) conditions.push(eq(evalResults.agentName, agentName));
  if (evalName) conditions.push(eq(evalResults.evalName, evalName));
  if (passed !== undefined) conditions.push(eq(evalResults.passed, passed));

  const whereClause = conditions.length ? and(...conditions) : undefined;

  const [data, [{ count }]] = await Promise.all([
    db
      .select()
      .from(evalResults)
      .where(whereClause)
      .orderBy(desc(evalResults.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(evalResults)
      .where(whereClause),
  ]);

  return { data: data as EvalResultRow[], total: count };
}

/** Get aggregated eval summary per agent + eval name */
export async function getEvalSummary(options?: {
  agentName?: string;
  sinceDays?: number;
}): Promise<EvalSummary[]> {
  const { agentName, sinceDays = 30 } = options ?? {};

  const conditions = [];
  if (agentName) conditions.push(eq(evalResults.agentName, agentName));
  if (sinceDays) {
    conditions.push(
      gte(
        evalResults.createdAt,
        sql`NOW() - INTERVAL '${sql.raw(String(sinceDays))} days'`
      )
    );
  }

  const whereClause = conditions.length ? and(...conditions) : undefined;

  const rows = await db
    .select({
      agentName: evalResults.agentName,
      evalName: evalResults.evalName,
      totalRuns: sql<number>`count(*)::int`,
      passCount: sql<number>`count(*) FILTER (WHERE ${evalResults.passed} = true)::int`,
      failCount: sql<number>`count(*) FILTER (WHERE ${evalResults.passed} = false)::int`,
      avgScore: sql<number>`avg(${evalResults.score}::numeric)`,
    })
    .from(evalResults)
    .where(whereClause)
    .groupBy(evalResults.agentName, evalResults.evalName)
    .orderBy(evalResults.agentName, evalResults.evalName);

  return rows.map((r) => ({
    ...r,
    passRate: r.totalRuns > 0 ? r.passCount / r.totalRuns : 0,
    avgScore: r.avgScore ? Number(r.avgScore) : null,
  }));
}

/** Get pass rate trend over time (daily buckets) */
export async function getEvalTrend(options: {
  agentName?: string;
  evalName?: string;
  days?: number;
}): Promise<
  Array<{
    date: string;
    totalRuns: number;
    passCount: number;
    passRate: number;
  }>
> {
  const { agentName, evalName, days = 30 } = options;

  const conditions = [
    gte(
      evalResults.createdAt,
      sql`NOW() - INTERVAL '${sql.raw(String(days))} days'`
    ),
  ];
  if (agentName) conditions.push(eq(evalResults.agentName, agentName));
  if (evalName) conditions.push(eq(evalResults.evalName, evalName));

  const rows = await db
    .select({
      date: sql<string>`DATE(${evalResults.createdAt})::text`,
      totalRuns: sql<number>`count(*)::int`,
      passCount: sql<number>`count(*) FILTER (WHERE ${evalResults.passed} = true)::int`,
    })
    .from(evalResults)
    .where(and(...conditions))
    .groupBy(sql`DATE(${evalResults.createdAt})`)
    .orderBy(sql`DATE(${evalResults.createdAt})`);

  return rows.map((r) => ({
    ...r,
    passRate: r.totalRuns > 0 ? r.passCount / r.totalRuns : 0,
  }));
}
