// Scheduler Cron Route — Phase 5.6
//
// The automatic cron trigger has been removed to eliminate the base
// Agentuity session cost ($0.00089) charged on every platform-managed tick
// regardless of whether any work is done.
//
// The scheduler now runs ONLY when explicitly triggered:
//   - POST /scheduler/tick       — called by the Admin UI engine toggle
//   - POST /admin/scheduler/run-all — manual "run now" from Admin Console
//
// To re-enable automatic scheduling, restore the cron() wrapper and
// set the appropriate schedule expression.

import { createRouter } from "@agentuity/runtime";
import { errorMiddleware } from "@lib/errors";
import { sessionMiddleware } from "@lib/auth";
import { getDueSchedules } from "@services/scheduler";
import { isSchedulerEnabled } from "@services/settings";
import schedulerAgent from "@agent/scheduler";

const router = createRouter();
router.use(errorMiddleware());

// ── Tick handler — manual trigger only (no automatic cron) ──

router.post(
  "/scheduler/tick",
  sessionMiddleware(),
  async (c) => {
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
  }
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
