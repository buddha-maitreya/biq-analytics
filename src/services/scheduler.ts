/**
 * Scheduler Service — CRUD + execution management for scheduled tasks
 *
 * Provides operations on the `schedules` and `schedule_executions` tables.
 * Handles schedule lifecycle: create, update, enable/disable, delete,
 * and execution tracking with failure counting.
 */

import { eq, and, desc, sql, lte, asc, count } from "drizzle-orm";
import { db, schedules, scheduleExecutions } from "@db/index";

// ── Types ───────────────────────────────────────────────────

export type ScheduleRow = typeof schedules.$inferSelect;
export type ScheduleInsert = typeof schedules.$inferInsert;
export type ExecutionRow = typeof scheduleExecutions.$inferSelect;

export interface ScheduleWithLastExecution extends ScheduleRow {
  lastExecution?: ExecutionRow | null;
}

export type TaskType = "report" | "insight" | "alert" | "cleanup" | "custom";

// ── Schedule CRUD ───────────────────────────────────────────

/** List all schedules with optional filters */
export async function listSchedules(opts: {
  taskType?: string;
  isActive?: boolean;
  limit?: number;
  offset?: number;
} = {}): Promise<{ data: ScheduleRow[]; total: number }> {
  const conditions = [];
  if (opts.taskType) conditions.push(eq(schedules.taskType, opts.taskType));
  if (opts.isActive !== undefined) conditions.push(eq(schedules.isActive, opts.isActive));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [data, [{ total }]] = await Promise.all([
    db
      .select()
      .from(schedules)
      .where(where)
      .orderBy(asc(schedules.name))
      .limit(opts.limit ?? 50)
      .offset(opts.offset ?? 0),
    db
      .select({ total: count() })
      .from(schedules)
      .where(where),
  ]);

  return { data, total };
}

/** Get a single schedule by ID */
export async function getScheduleById(id: string): Promise<ScheduleRow | null> {
  const [row] = await db.select().from(schedules).where(eq(schedules.id, id)).limit(1);
  return row ?? null;
}

/** Create a new schedule */
export async function createSchedule(input: {
  name: string;
  taskType: string;
  cronExpression?: string;
  taskConfig: Record<string, unknown>;
  timezone?: string;
  maxFailures?: number;
  createdBy?: string;
  isActive?: boolean;
  metadata?: Record<string, unknown>;
}): Promise<ScheduleRow> {
  const nextRunAt = input.cronExpression ? computeNextRun(input.cronExpression) : null;

  const [row] = await db
    .insert(schedules)
    .values({
      name: input.name,
      taskType: input.taskType,
      cronExpression: input.cronExpression ?? null,
      taskConfig: input.taskConfig,
      timezone: input.timezone ?? "UTC",
      maxFailures: input.maxFailures ?? 5,
      createdBy: input.createdBy ?? null,
      isActive: input.isActive ?? true,
      nextRunAt,
      metadata: input.metadata ?? null,
    })
    .returning();

  return row;
}

/** Update an existing schedule */
export async function updateSchedule(
  id: string,
  updates: Partial<{
    name: string;
    cronExpression: string | null;
    taskConfig: Record<string, unknown>;
    timezone: string;
    maxFailures: number;
    isActive: boolean;
    metadata: Record<string, unknown>;
  }>
): Promise<ScheduleRow | null> {
  // If cron expression changed, recompute next run
  const nextRunAt = updates.cronExpression !== undefined
    ? updates.cronExpression ? computeNextRun(updates.cronExpression) : null
    : undefined;

  const values: Record<string, unknown> = { ...updates };
  if (nextRunAt !== undefined) values.nextRunAt = nextRunAt;
  // Reset failure count when re-enabling
  if (updates.isActive === true) values.failureCount = 0;

  const [row] = await db
    .update(schedules)
    .set(values)
    .where(eq(schedules.id, id))
    .returning();

  return row ?? null;
}

/** Delete a schedule and its execution history (cascade) */
export async function deleteSchedule(id: string): Promise<boolean> {
  const result = await db.delete(schedules).where(eq(schedules.id, id)).returning({ id: schedules.id });
  return result.length > 0;
}

/** Toggle a schedule active/inactive */
export async function toggleSchedule(id: string, isActive: boolean): Promise<ScheduleRow | null> {
  return updateSchedule(id, { isActive });
}

// ── Execution Tracking ──────────────────────────────────────

/** Start an execution record (returns the execution ID) */
export async function startExecution(
  scheduleId: string,
  triggerSource: "cron" | "manual" | "api" = "cron"
): Promise<ExecutionRow> {
  const [row] = await db
    .insert(scheduleExecutions)
    .values({
      scheduleId,
      status: "running",
      triggerSource,
    })
    .returning();

  return row;
}

/** Complete an execution successfully */
export async function completeExecution(
  executionId: string,
  result: Record<string, unknown>
): Promise<void> {
  const now = new Date();
  await db
    .update(scheduleExecutions)
    .set({
      status: "completed",
      completedAt: now,
      durationMs: sql<number>`EXTRACT(EPOCH FROM (${now.toISOString()}::timestamptz - ${scheduleExecutions.startedAt})) * 1000`,
      result,
    })
    .where(eq(scheduleExecutions.id, executionId));
}

/** Mark an execution as failed */
export async function failExecution(
  executionId: string,
  errorMessage: string
): Promise<void> {
  const now = new Date();
  await db
    .update(scheduleExecutions)
    .set({
      status: "failed",
      completedAt: now,
      durationMs: sql<number>`EXTRACT(EPOCH FROM (${now.toISOString()}::timestamptz - ${scheduleExecutions.startedAt})) * 1000`,
      errorMessage,
    })
    .where(eq(scheduleExecutions.id, executionId));
}

/** Update the schedule's last run timestamp and compute next run */
export async function markScheduleRun(
  scheduleId: string,
  success: boolean
): Promise<void> {
  const schedule = await getScheduleById(scheduleId);
  if (!schedule) return;

  const now = new Date();
  const nextRunAt = schedule.cronExpression ? computeNextRun(schedule.cronExpression) : null;

  if (success) {
    await db
      .update(schedules)
      .set({
        lastRunAt: now,
        nextRunAt,
        failureCount: 0,
      })
      .where(eq(schedules.id, scheduleId));
  } else {
    const newFailureCount = (schedule.failureCount ?? 0) + 1;
    const shouldDisable = schedule.maxFailures > 0 && newFailureCount >= schedule.maxFailures;

    await db
      .update(schedules)
      .set({
        lastRunAt: now,
        nextRunAt,
        failureCount: newFailureCount,
        isActive: shouldDisable ? false : schedule.isActive,
      })
      .where(eq(schedules.id, scheduleId));
  }
}

/** List execution history for a schedule */
export async function listExecutions(
  scheduleId: string,
  opts: { limit?: number; offset?: number } = {}
): Promise<{ data: ExecutionRow[]; total: number }> {
  const [data, [{ total }]] = await Promise.all([
    db
      .select()
      .from(scheduleExecutions)
      .where(eq(scheduleExecutions.scheduleId, scheduleId))
      .orderBy(desc(scheduleExecutions.startedAt))
      .limit(opts.limit ?? 20)
      .offset(opts.offset ?? 0),
    db
      .select({ total: count() })
      .from(scheduleExecutions)
      .where(eq(scheduleExecutions.scheduleId, scheduleId)),
  ]);

  return { data, total };
}

/** Get schedules that are due to run (nextRunAt <= now, isActive = true) */
export async function getDueSchedules(): Promise<ScheduleRow[]> {
  const now = new Date();
  return db
    .select()
    .from(schedules)
    .where(
      and(
        eq(schedules.isActive, true),
        lte(schedules.nextRunAt, now)
      )
    )
    .orderBy(asc(schedules.nextRunAt));
}

/** Get execution summary stats */
export async function getExecutionSummary(sinceDays: number = 30): Promise<{
  totalRuns: number;
  successCount: number;
  failureCount: number;
  avgDurationMs: number | null;
}> {
  const [row] = await db
    .select({
      totalRuns: sql<number>`count(*)::int`,
      successCount: sql<number>`count(*) FILTER (WHERE ${scheduleExecutions.status} = 'completed')::int`,
      failureCount: sql<number>`count(*) FILTER (WHERE ${scheduleExecutions.status} = 'failed')::int`,
      avgDurationMs: sql<number>`avg(${scheduleExecutions.durationMs})`,
    })
    .from(scheduleExecutions)
    .where(
      sql`${scheduleExecutions.startedAt} >= NOW() - INTERVAL '${sql.raw(String(sinceDays))} days'`
    );

  return {
    totalRuns: row.totalRuns,
    successCount: row.successCount,
    failureCount: row.failureCount,
    avgDurationMs: row.avgDurationMs ? Number(row.avgDurationMs) : null,
  };
}

// ── Helpers ─────────────────────────────────────────────────

/**
 * Parse a cron expression and compute the next run time.
 * Simple implementation for standard 5-field cron (minute hour dayOfMonth month dayOfWeek).
 * Returns the next occurrence after now, or null if unparseable.
 */
function computeNextRun(cronExpr: string): Date | null {
  try {
    const parts = cronExpr.trim().split(/\s+/);
    if (parts.length < 5) return null;

    const [minStr, hourStr] = parts;
    const now = new Date();
    const next = new Date(now);

    // Simple handling for common patterns: "M H * * *" (daily at H:M)
    const minute = minStr === "*" ? 0 : parseInt(minStr, 10);
    const hour = hourStr === "*" ? 0 : parseInt(hourStr, 10);

    if (isNaN(minute) || isNaN(hour)) {
      // Fallback: run in 24 hours
      next.setTime(now.getTime() + 24 * 60 * 60 * 1000);
      return next;
    }

    next.setHours(hour, minute, 0, 0);
    // If that time already passed today, schedule for tomorrow
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }

    return next;
  } catch {
    return null;
  }
}
