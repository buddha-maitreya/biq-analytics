/**
 * Analytics Execution Metrics — tracks sandbox performance per action type.
 *
 * Records durationMs, cpuTimeMs, memoryByteSec, exitCode, dataRowCount
 * for every analytics sandbox execution. Data is stored in KV with a
 * 24-hour TTL using a rolling window of the last 100 executions per action.
 *
 * Usage:
 *   // After sandbox execution (inside runAnalytics):
 *   await logAnalyticsMetric(kv, metric);
 *
 *   // Admin dashboard — get per-action stats:
 *   const summary = await getAnalyticsMetricsSummary(kv);
 *
 *   // Drill into a specific action:
 *   const runs = await getActionMetrics(kv, "chart.sales_trends");
 */

import type { KVStore } from "@lib/cache";
import { CACHE_TTL } from "@lib/cache";

// ── Types ──────────────────────────────────────────────────

/** A single sandbox execution record */
export interface AnalyticsExecutionMetric {
  /** Action that was executed (e.g. "chart.sales_trends") */
  action: string;
  /** Whether the execution succeeded */
  success: boolean;
  /** Wall-clock execution time in ms */
  durationMs: number;
  /** CPU time consumed in ms (from sandbox metrics) */
  cpuTimeMs?: number;
  /** Memory usage in byte-seconds (from sandbox metrics) */
  memoryByteSec?: number;
  /** Sandbox exit code (0 = success) */
  exitCode: number;
  /** Number of data rows sent to Python */
  dataRowCount: number;
  /** Unix timestamp in ms when execution completed */
  timestamp: number;
  /** Sandbox ID for debugging */
  sandboxId?: string;
}

/** Aggregated statistics for a single action type */
export interface ActionMetricsSummary {
  /** Action identifier */
  action: string;
  /** Total number of executions in the window */
  totalRuns: number;
  /** Number of successful executions */
  successCount: number;
  /** Number of failed executions */
  failureCount: number;
  /** Success rate as a percentage (0-100) */
  successRate: number;
  /** Average wall-clock duration in ms */
  avgDurationMs: number;
  /** 95th percentile duration in ms */
  p95DurationMs: number;
  /** Maximum duration in ms */
  maxDurationMs: number;
  /** Minimum duration in ms */
  minDurationMs: number;
  /** Average data row count */
  avgDataRowCount: number;
  /** Most recent execution timestamp */
  lastRunAt: number;
}

/** Stored shape in KV — array of recent executions per action */
interface StoredActionMetrics {
  runs: AnalyticsExecutionMetric[];
  updatedAt: number;
}

// ── Constants ──────────────────────────────────────────────

/** KV namespace for analytics execution metrics */
export const METRICS_NS = "analytics:metrics";

/** Maximum number of executions to retain per action (rolling window) */
const MAX_RUNS_PER_ACTION = 100;

/** TTL for metrics entries — 24 hours */
const METRICS_TTL = CACHE_TTL.EXTENDED; // 86400s

// ── Logging ────────────────────────────────────────────────

/**
 * Log a single analytics execution metric.
 *
 * Appends the metric to the rolling window for its action type.
 * Trims to MAX_RUNS_PER_ACTION entries (oldest dropped first).
 *
 * This is fire-and-forget safe — failures don't affect the caller.
 */
export async function logAnalyticsMetric(
  kv: KVStore,
  metric: AnalyticsExecutionMetric
): Promise<void> {
  try {
    const existing = await kv.get<StoredActionMetrics>(METRICS_NS, metric.action);

    let runs: AnalyticsExecutionMetric[] = [];
    if (existing.exists && existing.data?.runs) {
      runs = existing.data.runs;
    }

    // Append new metric, trim to rolling window
    runs.push(metric);
    if (runs.length > MAX_RUNS_PER_ACTION) {
      runs = runs.slice(runs.length - MAX_RUNS_PER_ACTION);
    }

    await kv.set(METRICS_NS, metric.action, {
      runs,
      updatedAt: Date.now(),
    } satisfies StoredActionMetrics, { ttl: METRICS_TTL });
  } catch {
    // Metrics logging is non-critical — never throw
  }
}

// ── Queries ────────────────────────────────────────────────

/**
 * Get raw execution metrics for a specific action.
 *
 * Returns the most recent executions (up to MAX_RUNS_PER_ACTION).
 */
export async function getActionMetrics(
  kv: KVStore,
  action: string
): Promise<AnalyticsExecutionMetric[]> {
  try {
    const stored = await kv.get<StoredActionMetrics>(METRICS_NS, action);
    return stored.exists && stored.data?.runs ? stored.data.runs : [];
  } catch {
    return [];
  }
}

/**
 * Get aggregated summary for a specific action.
 *
 * Returns null if no metrics exist for this action.
 */
export async function getActionSummary(
  kv: KVStore,
  action: string
): Promise<ActionMetricsSummary | null> {
  const runs = await getActionMetrics(kv, action);
  if (runs.length === 0) return null;
  return computeSummary(action, runs);
}

/**
 * Get aggregated summaries for ALL tracked actions.
 *
 * Uses KV search to discover all action keys in the metrics namespace.
 * Returns an array sorted by totalRuns descending (most-used first).
 */
export async function getAnalyticsMetricsSummary(
  kv: KVStore
): Promise<ActionMetricsSummary[]> {
  try {
    const entries = await kv.search(METRICS_NS, "");
    const summaries: ActionMetricsSummary[] = [];

    for (const entry of entries) {
      const stored = entry.data as StoredActionMetrics | undefined;
      if (stored?.runs && stored.runs.length > 0) {
        summaries.push(computeSummary(entry.key, stored.runs));
      }
    }

    // Sort by total runs descending
    summaries.sort((a, b) => b.totalRuns - a.totalRuns);
    return summaries;
  } catch {
    return [];
  }
}

/**
 * Get a platform-wide overview of analytics usage.
 *
 * Returns aggregate stats across ALL action types — useful for
 * admin dashboards showing overall analytics health.
 */
export async function getAnalyticsOverview(
  kv: KVStore
): Promise<{
  totalActions: number;
  totalRuns: number;
  overallSuccessRate: number;
  avgDurationMs: number;
  mostUsedAction: string | null;
  slowestAction: string | null;
  leastReliableAction: string | null;
}> {
  const summaries = await getAnalyticsMetricsSummary(kv);

  if (summaries.length === 0) {
    return {
      totalActions: 0,
      totalRuns: 0,
      overallSuccessRate: 0,
      avgDurationMs: 0,
      mostUsedAction: null,
      slowestAction: null,
      leastReliableAction: null,
    };
  }

  const totalRuns = summaries.reduce((s, m) => s + m.totalRuns, 0);
  const totalSuccess = summaries.reduce((s, m) => s + m.successCount, 0);
  const weightedDuration = summaries.reduce(
    (s, m) => s + m.avgDurationMs * m.totalRuns,
    0
  );

  const slowest = summaries.reduce((a, b) =>
    b.avgDurationMs > a.avgDurationMs ? b : a
  );

  const leastReliable = summaries
    .filter((m) => m.totalRuns >= 3) // need minimum sample size
    .reduce(
      (a, b) => (b.successRate < a.successRate ? b : a),
      summaries[0]
    );

  return {
    totalActions: summaries.length,
    totalRuns,
    overallSuccessRate: totalRuns > 0 ? Math.round((totalSuccess / totalRuns) * 100) : 0,
    avgDurationMs: totalRuns > 0 ? Math.round(weightedDuration / totalRuns) : 0,
    mostUsedAction: summaries[0].action, // already sorted by totalRuns desc
    slowestAction: slowest.action,
    leastReliableAction: leastReliable?.action ?? null,
  };
}

// ── Helpers ────────────────────────────────────────────────

/** Compute aggregated summary from an array of execution metrics */
function computeSummary(
  action: string,
  runs: AnalyticsExecutionMetric[]
): ActionMetricsSummary {
  const totalRuns = runs.length;
  const successCount = runs.filter((r) => r.success).length;
  const failureCount = totalRuns - successCount;

  const durations = runs.map((r) => r.durationMs).sort((a, b) => a - b);
  const avgDurationMs = Math.round(
    durations.reduce((s, d) => s + d, 0) / totalRuns
  );
  const p95Index = Math.min(
    Math.ceil(totalRuns * 0.95) - 1,
    totalRuns - 1
  );

  const dataRowCounts = runs.map((r) => r.dataRowCount);
  const avgDataRowCount = Math.round(
    dataRowCounts.reduce((s, c) => s + c, 0) / totalRuns
  );

  const lastRunAt = Math.max(...runs.map((r) => r.timestamp));

  return {
    action,
    totalRuns,
    successCount,
    failureCount,
    successRate: Math.round((successCount / totalRuns) * 100),
    avgDurationMs,
    p95DurationMs: durations[p95Index],
    maxDurationMs: durations[totalRuns - 1],
    minDurationMs: durations[0],
    avgDataRowCount,
    lastRunAt,
  };
}
