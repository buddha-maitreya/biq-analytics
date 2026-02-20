/**
 * Scheduler Agent -- "The Clockmaker"
 *
 * Handles execution of scheduled tasks for the platform:
 *   - Report generation (daily/weekly/monthly reports)
 *   - Insight analysis (periodic trend detection, anomaly alerts)
 *   - Alert checks (low stock, overdue invoices, payment reminders)
 *   - Data cleanup (old sessions, expired tokens, stale caches)
 *   - Custom tasks (user-defined via admin configuration)
 *
 * Architecture:
 *   1. Receives a schedule record with taskType and taskConfig
 *   2. Dispatches to the appropriate specialist agent or service
 *   3. Records execution result (success/failure, duration, output)
 *   4. Handles failure counting and auto-disable
 *
 * The agent is invoked by the scheduler cron route, which scans for
 * due schedules and calls this agent for each one.
 */

import { createAgent } from "@agentuity/runtime";
import { z } from "zod";
import { config } from "@lib/config";
import reportGenerator from "@agent/report-generator";
import insightsAnalyzer from "@agent/insights-analyzer";
import {
  startExecution,
  completeExecution,
  failExecution,
  markScheduleRun,
} from "@services/scheduler";
import { db, notifications, users } from "@db/index";
import { eq, sql } from "drizzle-orm";

// ── Schema ──────────────────────────────────────────────────

const inputSchema = z.object({
  /** The schedule record to execute */
  scheduleId: z.string().uuid().describe("ID of the schedule to execute"),
  /** Task type determines the execution strategy */
  taskType: z
    .enum(["report", "insight", "alert", "cleanup", "custom"])
    .describe("Type of scheduled task"),
  /** Task-specific configuration */
  taskConfig: z
    .record(z.unknown())
    .describe("Configuration parameters for the task"),
  /** What triggered this execution */
  triggerSource: z
    .enum(["cron", "manual", "api"])
    .default("cron")
    .describe("How this execution was triggered"),
});

const outputSchema = z.object({
  success: z.boolean().describe("Whether the task completed successfully"),
  scheduleId: z.string().describe("The schedule that was executed"),
  executionId: z.string().describe("Execution record ID for tracking"),
  taskType: z.string().describe("Type of task that was executed"),
  /** Result details — structure depends on taskType */
  result: z.record(z.unknown()).optional().describe("Task output details"),
  error: z.string().optional().describe("Error message if task failed"),
  durationMs: z.number().optional().describe("Execution duration in ms"),
});

// ── Task Handlers ───────────────────────────────────────────

async function executeReportTask(
  taskConfig: Record<string, unknown>,
  ctx: any
): Promise<Record<string, unknown>> {
  const reportType = (taskConfig.reportType as string) ?? "sales-summary";
  const periodDays = (taskConfig.periodDays as number) ?? 7;
  const format = ((taskConfig.format as string) ?? "markdown") as "json" | "markdown" | "csv" | "html" | "plain";

  ctx.logger.info("Executing scheduled report", { reportType, periodDays, format });

  // Compute date range from periodDays
  const endDate = new Date().toISOString();
  const startDate = new Date(Date.now() - periodDays * 86400000).toISOString();

  const result = await reportGenerator.run({
    reportType,
    startDate,
    endDate,
    format,
  });

  return {
    reportType,
    periodDays,
    format,
    reportId: (result as any)?.reportId ?? null,
    contentLength: (result as any)?.content?.length ?? 0,
    title: (result as any)?.title ?? reportType,
  };
}

async function executeInsightTask(
  taskConfig: Record<string, unknown>,
  ctx: any
): Promise<Record<string, unknown>> {
  const analysisType = (taskConfig.analysisType as string) ?? "sales-trends";
  const timeframeDays = (taskConfig.timeframeDays as number) ?? 30;

  ctx.logger.info("Executing scheduled insight", { analysisType, timeframeDays });

  const result = await insightsAnalyzer.run({
    analysis: analysisType,
    timeframeDays,
    limit: 10,
  });

  const insights = (result as any)?.insights ?? [];
  return {
    analysisType,
    timeframeDays,
    insightCount: insights.length,
    highSeverityCount: insights.filter((i: any) => i.severity === "high").length,
  };
}

async function executeAlertTask(
  taskConfig: Record<string, unknown>,
  ctx: any
): Promise<Record<string, unknown>> {
  const metric = (taskConfig.metric as string) ?? "low-stock";
  const threshold = (taskConfig.threshold as number) ?? 10;

  ctx.logger.info("Executing scheduled alert check", { metric, threshold });

  let alertCount = 0;
  let details: Record<string, unknown> = {};

  if (metric === "low-stock") {
    // Check for products below reorder point
    const lowStockProducts = await db.execute(sql`
      SELECT p.name, i.quantity, p.reorder_point
      FROM products p
      JOIN inventory i ON i.product_id = p.id
      WHERE i.quantity <= COALESCE(p.reorder_point, ${threshold})
        AND p.is_active = true
      ORDER BY i.quantity ASC
      LIMIT 50
    `);
    alertCount = (lowStockProducts as any[]).length;
    details = { metric, threshold, productsAffected: alertCount };

    // Create notifications for admins if there are alerts
    if (alertCount > 0) {
      const admins = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.isActive, true));

      for (const admin of admins.slice(0, 10)) {
        await db.insert(notifications).values({
          userId: admin.id,
          type: "alert",
          title: `Low Stock Alert: ${alertCount} ${config.labels.productPlural.toLowerCase()} below threshold`,
          message: `${alertCount} ${config.labels.productPlural.toLowerCase()} are at or below the reorder point of ${threshold} units.`,
        });
      }
    }
  } else if (metric === "overdue-invoices") {
    const overdueInvoices = await db.execute(sql`
      SELECT COUNT(*)::int AS overdue_count,
             COALESCE(SUM(total_amount::numeric - paid_amount::numeric), 0)::numeric AS total_outstanding
      FROM invoices
      WHERE status IN ('sent', 'overdue')
        AND due_date < NOW()
    `);
    const row = (overdueInvoices as any[])[0];
    alertCount = row?.overdue_count ?? 0;
    details = {
      metric,
      overdueCount: alertCount,
      totalOutstanding: row?.total_outstanding ?? 0,
    };
  }

  return { alertCount, ...details };
}

async function executeCleanupTask(
  taskConfig: Record<string, unknown>,
  ctx: any
): Promise<Record<string, unknown>> {
  const target = (taskConfig.target as string) ?? "old-sessions";
  const olderThanDays = (taskConfig.olderThanDays as number) ?? 90;

  ctx.logger.info("Executing scheduled cleanup", { target, olderThanDays });

  let rowsAffected = 0;

  if (target === "old-sessions") {
    const result = await db.execute(sql`
      DELETE FROM chat_messages
      WHERE session_id IN (
        SELECT id FROM chat_sessions
        WHERE status = 'archived'
          AND updated_at < NOW() - INTERVAL '${sql.raw(String(olderThanDays))} days'
      )
    `);
    rowsAffected = (result as any)?.rowCount ?? 0;

    // Also archive very old active sessions
    await db.execute(sql`
      UPDATE chat_sessions
      SET status = 'archived'
      WHERE status = 'active'
        AND updated_at < NOW() - INTERVAL '${sql.raw(String(olderThanDays))} days'
    `);
  } else if (target === "old-notifications") {
    const result = await db.execute(sql`
      DELETE FROM notifications
      WHERE is_read = true
        AND created_at < NOW() - INTERVAL '${sql.raw(String(olderThanDays))} days'
    `);
    rowsAffected = (result as any)?.rowCount ?? 0;
  } else if (target === "old-executions") {
    const result = await db.execute(sql`
      DELETE FROM schedule_executions
      WHERE started_at < NOW() - INTERVAL '${sql.raw(String(olderThanDays))} days'
    `);
    rowsAffected = (result as any)?.rowCount ?? 0;
  }

  return { target, olderThanDays, rowsAffected };
}

// ── Agent Definition ────────────────────────────────────────

export default createAgent("scheduler", {
  description:
    "The Clockmaker — executes scheduled tasks: reports, insights, alerts, cleanup, and custom jobs on configurable cron schedules.",
  schema: { input: inputSchema, output: outputSchema },

  handler: async (ctx, input) => {
    const startedAt = Date.now();
    ctx.state.set("startedAt", startedAt);

    ctx.logger.info("Scheduler executing task", {
      scheduleId: input.scheduleId,
      taskType: input.taskType,
      triggerSource: input.triggerSource,
    });

    // Start execution record
    const execution = await startExecution(input.scheduleId, input.triggerSource);

    try {
      let result: Record<string, unknown>;

      switch (input.taskType) {
        case "report":
          result = await executeReportTask(input.taskConfig, ctx);
          break;
        case "insight":
          result = await executeInsightTask(input.taskConfig, ctx);
          break;
        case "alert":
          result = await executeAlertTask(input.taskConfig, ctx);
          break;
        case "cleanup":
          result = await executeCleanupTask(input.taskConfig, ctx);
          break;
        case "custom":
          // Custom tasks just log their config — extensible via future plugins
          ctx.logger.info("Custom task executed", { config: input.taskConfig });
          result = { custom: true, config: input.taskConfig };
          break;
        default:
          throw new Error(`Unknown task type: ${input.taskType}`);
      }

      // Mark execution complete
      await completeExecution(execution.id, result);
      await markScheduleRun(input.scheduleId, true);

      const durationMs = Date.now() - startedAt;
      ctx.logger.info("Scheduled task completed", {
        scheduleId: input.scheduleId,
        taskType: input.taskType,
        durationMs,
        result,
      });

      return {
        success: true,
        scheduleId: input.scheduleId,
        executionId: execution.id,
        taskType: input.taskType,
        result,
        durationMs,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Mark execution failed
      await failExecution(execution.id, errorMsg);
      await markScheduleRun(input.scheduleId, false);

      const durationMs = Date.now() - startedAt;
      ctx.logger.error("Scheduled task failed", {
        scheduleId: input.scheduleId,
        taskType: input.taskType,
        error: errorMsg,
        durationMs,
      });

      return {
        success: false,
        scheduleId: input.scheduleId,
        executionId: execution.id,
        taskType: input.taskType,
        error: errorMsg,
        durationMs,
      };
    }
  },
});
