/**
 * Telemetry & Tool Analytics API Routes
 *
 * Admin-only endpoints for the Observability tab.
 * Provides agent performance metrics, span data, tool usage stats,
 * and timeline data for dashboarding.
 *
 * Routes:
 *   GET  /api/admin/telemetry/agents          — Agent performance summary
 *   GET  /api/admin/telemetry/spans           — Recent spans (filterable)
 *   GET  /api/admin/telemetry/breakdown/:name — Per-agent span breakdown
 *   GET  /api/admin/telemetry/timeline        — Hourly span timeline
 *   GET  /api/admin/telemetry/tools           — Tool usage stats
 *   GET  /api/admin/telemetry/tools/trends    — Tool usage trends (daily)
 *   GET  /api/admin/telemetry/dashboard       — Combined tool dashboard
 *   DELETE /api/admin/telemetry/purge         — Purge old telemetry data
 */

import { createRouter } from "@agentuity/runtime";
import { errorMiddleware } from "@lib/errors";
import { authMiddleware } from "@services/auth";
import * as telemetrySvc from "@services/telemetry";
import * as toolAnalyticsSvc from "@services/tool-analytics";

const router = createRouter();
router.use(errorMiddleware());
router.use(authMiddleware());

// ── Agent Performance ──────────────────────────────────────

/** GET /api/admin/telemetry/agents — aggregate agent performance */
router.get("/admin/telemetry/agents", async (c) => {
  const sinceDays = parseInt(c.req.query("days") || "30", 10);
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const data = await telemetrySvc.getAgentPerformanceSummary(since);
  return c.json({ data });
});

/** GET /api/admin/telemetry/spans — recent spans with filtering */
router.get("/admin/telemetry/spans", async (c) => {
  const agentName = c.req.query("agent") || undefined;
  const spanType = (c.req.query("type") as any) || undefined;
  const status = (c.req.query("status") as any) || undefined;
  const sessionId = c.req.query("session") || undefined;
  const limit = parseInt(c.req.query("limit") || "50", 10);
  const offset = parseInt(c.req.query("offset") || "0", 10);

  const result = await telemetrySvc.listSpans({
    agentName,
    spanType,
    status,
    sessionId,
    limit: Math.min(limit, 200),
    offset,
  });
  return c.json(result);
});

/** GET /api/admin/telemetry/breakdown/:name — per-agent span type breakdown */
router.get("/admin/telemetry/breakdown/:name", async (c) => {
  const agentName = c.req.param("name");
  const sinceDays = parseInt(c.req.query("days") || "30", 10);
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const data = await telemetrySvc.getSpanBreakdown(agentName, since);
  return c.json({ data });
});

/** GET /api/admin/telemetry/timeline — hourly span timeline */
router.get("/admin/telemetry/timeline", async (c) => {
  const sinceDays = parseInt(c.req.query("days") || "7", 10);
  const agentName = c.req.query("agent") || undefined;
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const data = await telemetrySvc.getSpanTimeline(since, agentName);
  return c.json({ data });
});

// ── Tool Analytics ─────────────────────────────────────────

/** GET /api/admin/telemetry/tools — tool usage stats */
router.get("/admin/telemetry/tools", async (c) => {
  const sinceDays = parseInt(c.req.query("days") || "30", 10);
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const data = await toolAnalyticsSvc.getToolUsageStats(since);
  return c.json({ data });
});

/** GET /api/admin/telemetry/tools/trends — daily tool usage trends */
router.get("/admin/telemetry/tools/trends", async (c) => {
  const sinceDays = parseInt(c.req.query("days") || "14", 10);
  const toolName = c.req.query("tool") || undefined;
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const data = await toolAnalyticsSvc.getToolTrends(since, toolName);
  return c.json({ data });
});

/** GET /api/admin/telemetry/dashboard — combined tool analytics dashboard */
router.get("/admin/telemetry/dashboard", async (c) => {
  const sinceDays = parseInt(c.req.query("days") || "30", 10);
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const data = await toolAnalyticsSvc.getToolDashboard(since);
  return c.json({ data });
});

// ── Maintenance ────────────────────────────────────────────

/** DELETE /api/admin/telemetry/purge — purge old telemetry data */
router.delete("/admin/telemetry/purge", async (c) => {
  const days = parseInt(c.req.query("days") || "30", 10);
  const [spansPurged, toolsPurged] = await Promise.all([
    telemetrySvc.purgeTelemetry(days),
    toolAnalyticsSvc.purgeToolInvocations(days),
  ]);
  return c.json({
    success: true,
    purged: { spans: spansPurged, toolInvocations: toolsPurged },
  });
});

export default router;
