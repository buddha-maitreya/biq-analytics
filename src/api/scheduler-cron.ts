// Scheduler Cron Route — Phase 5.6
//
// The platform-managed cron tick fires every 15 minutes. This is the
// scheduler engine's heartbeat — it cannot be removed without removing
// the route file entirely.
//
// To avoid wasting resources when no automation is needed, the handler
// checks the "schedulerEnabled" business setting (DB-driven, toggled
// from the Admin Console → Automation section). When disabled, the
// tick returns immediately — no schedule queries, no agent dispatches.
//
// Manual override: POST /admin/scheduler/run-all (triggers all due schedules now)

import { createRouter, cron } from "@agentuity/runtime";
import { errorMiddleware } from "@lib/errors";
import { sessionMiddleware } from "@lib/auth";
import { getDueSchedules } from "@services/scheduler";
import { isSchedulerEnabled } from "@services/settings";
import schedulerAgent from "@agent/scheduler";

const router = createRouter();
router.use(errorMiddleware());

// ── Cron handler — every 15 minutes ─────────────────────────

router.post(
  "/scheduler/tick",
  cron("*/15 * * * *", async (c) => {
    const logger = c.var.logger;

    // ── Master switch check (DB-driven, cached 30s) ──
    const enabled = await isSchedulerEnabled();
    if (!enabled) {
      logger.info("Scheduler engine disabled — skipping tick");
      return c.json({ skipped: true, reason: "scheduler_disabled" });
    }

    const dueSchedules = await getDueSchedules();

    if (dueSchedules.length === 0) {
      logger.info("No schedules due");
      return c.json({ executed: 0 });
    }

    logger.info("Due schedules found", { count: dueSchedules.length });

    const results: Array<{ scheduleId: string; name: string; success: boolean; error?: string }> = [];

    // Execute sequentially to avoid overwhelming resources
    for (const schedule of dueSchedules) {
      try {
        const result = await schedulerAgent.run({
          scheduleId: schedule.id,
          taskType: schedule.taskType as any,
          taskConfig: schedule.taskConfig as Record<string, unknown>,
          triggerSource: "cron",
        });

        results.push({
          scheduleId: schedule.id,
          name: schedule.name,
          success: result.success,
          error: result.error,
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error("Scheduler dispatch error", {
          scheduleId: schedule.id,
          name: schedule.name,
          error: errorMsg,
        });
        results.push({
          scheduleId: schedule.id,
          name: schedule.name,
          success: false,
          error: errorMsg,
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    logger.info("Scheduler cron tick complete", {
      total: results.length,
      successCount,
      failCount,
    });

    return c.json({ executed: results.length, successCount, failCount, results });
  })
);

// ── Manual trigger — run all due schedules now ──────────────

router.post("/admin/scheduler/run-all", sessionMiddleware(), async (c) => {
  const logger = c.var.logger;
  const dueSchedules = await getDueSchedules();

  if (dueSchedules.length === 0) {
    return c.json({ message: "No schedules are currently due", executed: 0 });
  }

  const results: Array<{ scheduleId: string; name: string; success: boolean }> = [];

  for (const schedule of dueSchedules) {
    try {
      const result = await schedulerAgent.run({
        scheduleId: schedule.id,
        taskType: schedule.taskType as any,
        taskConfig: schedule.taskConfig as Record<string, unknown>,
        triggerSource: "manual",
      });
      results.push({ scheduleId: schedule.id, name: schedule.name, success: result.success });
    } catch {
      results.push({ scheduleId: schedule.id, name: schedule.name, success: false });
    }
  }

  return c.json({
    executed: results.length,
    successCount: results.filter((r) => r.success).length,
    results,
  });
});

export default router;
