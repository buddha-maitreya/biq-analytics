/**
 * Scheduler API Routes — Phase 5.6
 *
 * CRUD for scheduled tasks + execution history.
 * All endpoints require admin authentication.
 *
 * Routes:
 *   GET    /admin/schedules              — List all schedules
 *   GET    /admin/schedules/:id          — Get schedule detail
 *   POST   /admin/schedules              — Create schedule
 *   PUT    /admin/schedules/:id          — Update schedule
 *   DELETE /admin/schedules/:id          — Delete schedule
 *   POST   /admin/schedules/:id/toggle   — Enable/disable schedule
 *   POST   /admin/schedules/:id/run      — Manually trigger schedule
 *   GET    /admin/schedules/:id/history  — Execution history
 *   GET    /admin/schedules/summary      — Execution summary stats
 */

import { createRouter, validator } from "@agentuity/runtime";
import { s } from "@agentuity/schema";
import { errorMiddleware } from "@lib/errors";
import { sessionMiddleware } from "@lib/auth";
import {
  listSchedules,
  getScheduleById,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  toggleSchedule,
  listExecutions,
  getExecutionSummary,
} from "@services/scheduler";
import {
  isSchedulerEnabled,
  setSchedulerEnabled,
} from "@services/settings";
import scheduler from "@agent/scheduler";

// ── Request schemas ───────────────────────────────────────
export const createScheduleSchema = s.object({
  name: s.string(),
  taskType: s.string(),
  cronExpression: s.optional(s.string()),
  taskConfig: s.optional(s.record(s.string(), s.unknown())),
  timezone: s.optional(s.string()),
  maxFailures: s.optional(s.number()),
  isActive: s.optional(s.boolean()),
  metadata: s.optional(s.record(s.string(), s.unknown())),
});

const router = createRouter();
router.use(errorMiddleware());
router.use(sessionMiddleware());

// ── List schedules ──────────────────────────────────────────

router.get("/admin/schedules", async (c) => {
  const url = new URL(c.req.url);
  const taskType = url.searchParams.get("taskType") ?? undefined;
  const isActive = url.searchParams.has("isActive")
    ? url.searchParams.get("isActive") === "true"
    : undefined;
  const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
  const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);

  const result = await listSchedules({ taskType, isActive, limit, offset });
  return c.json(result);
});

// ── Get schedule detail ─────────────────────────────────────

router.get("/admin/schedules/:id", async (c) => {
  const schedule = await getScheduleById(c.req.param("id"));
  if (!schedule) return c.json({ error: "Schedule not found" }, 404);
  return c.json(schedule);
});

// ── Create schedule ─────────────────────────────────────────

router.post("/admin/schedules", validator({ input: createScheduleSchema }), async (c) => {
  const body = c.req.valid("json");

  const schedule = await createSchedule({
    name: body.name,
    taskType: body.taskType,
    cronExpression: body.cronExpression,
    taskConfig: body.taskConfig ?? {},
    timezone: body.timezone,
    maxFailures: body.maxFailures,
    isActive: body.isActive,
    metadata: body.metadata,
  });

  return c.json(schedule, 201);
});

// ── Update schedule ─────────────────────────────────────────

router.put("/admin/schedules/:id", async (c) => {
  const body = await c.req.json();
  const schedule = await updateSchedule(c.req.param("id"), body);
  if (!schedule) return c.json({ error: "Schedule not found" }, 404);
  return c.json(schedule);
});

// ── Delete schedule ─────────────────────────────────────────

router.delete("/admin/schedules/:id", async (c) => {
  const deleted = await deleteSchedule(c.req.param("id"));
  if (!deleted) return c.json({ error: "Schedule not found" }, 404);
  return c.json({ success: true });
});

// ── Toggle active/inactive ──────────────────────────────────

router.post("/admin/schedules/:id/toggle", async (c) => {
  const body = await c.req.json();
  const schedule = await toggleSchedule(c.req.param("id"), !!body.isActive);
  if (!schedule) return c.json({ error: "Schedule not found" }, 404);
  return c.json(schedule);
});

// ── Manual trigger ──────────────────────────────────────────

router.post("/admin/schedules/:id/run", async (c) => {
  const schedule = await getScheduleById(c.req.param("id"));
  if (!schedule) return c.json({ error: "Schedule not found" }, 404);

  // Run the scheduler agent
  const result = await scheduler.run({
    scheduleId: schedule.id,
    taskType: schedule.taskType as any,
    taskConfig: schedule.taskConfig as Record<string, unknown>,
    triggerSource: "manual",
  });

  return c.json(result);
});

// ── Execution history ───────────────────────────────────────

router.get("/admin/schedules/:id/history", async (c) => {
  const url = new URL(c.req.url);
  const limit = parseInt(url.searchParams.get("limit") ?? "20", 10);
  const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);

  const result = await listExecutions(c.req.param("id"), { limit, offset });
  return c.json(result);
});

// ── Execution summary ───────────────────────────────────────

router.get("/admin/schedules/summary", async (c) => {
  const url = new URL(c.req.url);
  const sinceDays = parseInt(url.searchParams.get("sinceDays") ?? "30", 10);
  const summary = await getExecutionSummary(sinceDays);
  return c.json(summary);
});

// ── Scheduler engine status ─────────────────────────────────

/** GET /admin/scheduler/status — Check if the scheduler engine is enabled */
router.get("/admin/scheduler/status", async (c) => {
  const enabled = await isSchedulerEnabled();
  return c.json({ enabled });
});

/** POST /admin/scheduler/toggle — Enable or disable the scheduler engine */
router.post("/admin/scheduler/toggle", async (c) => {
  const body = await c.req.json();
  const enabled = !!body.enabled;
  await setSchedulerEnabled(enabled);
  return c.json({ enabled });
});

export default router;
