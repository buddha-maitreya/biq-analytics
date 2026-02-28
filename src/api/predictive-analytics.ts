/**
 * Predictive Analytics API — Run pre-built Python analytics on demand.
 *
 * Routes:
 *   GET  /api/predictive-analytics/types    — List available analytics types
 *   POST /api/predictive-analytics/run      — Execute an analytics action
 *
 * The frontend ReportsPage calls these endpoints to let users select
 * and run specific predictive analytics (forecasting, classification,
 * anomaly detection). Results include structured data + chart images.
 *
 * Architecture:
 *   1. User selects analytics type + date range in ReportsPage
 *   2. Frontend calls POST /api/predictive-analytics/run
 *   3. This route queries DB for the right data (via analytics-queries)
 *   4. Passes data to runAnalytics() which executes in sandbox
 *   5. Returns structured results (summary + charts + tables)
 */

import { createRouter } from "@agentuity/runtime";
import { errorMiddleware } from "@lib/errors";
import { sessionMiddleware } from "@lib/auth";
import { runAnalytics, type AnalyticsAction } from "@lib/analytics";
import {
  getAnalyticsData,
  getDefaultRange,
  PREDICTIVE_ANALYTICS_TYPES,
  type DateRange,
} from "@lib/analytics-queries";

const router = createRouter();
router.use(errorMiddleware());
router.use(sessionMiddleware());

// ── Valid actions set for validation ────────────────────────

const VALID_ACTIONS = new Set<string>(
  PREDICTIVE_ANALYTICS_TYPES.map((t) => t.action)
);

// ── GET /api/predictive-analytics/types ─────────────────────

/**
 * Returns the list of available predictive analytics types.
 * Used by the frontend to render selection cards.
 */
router.get("/predictive-analytics/types", async (c) => {
  return c.json({
    data: PREDICTIVE_ANALYTICS_TYPES,
  });
});

// ── POST /api/predictive-analytics/run ──────────────────────

/**
 * Execute a specific pre-built analytics module.
 *
 * Request body:
 *   action:    AnalyticsAction (e.g. "forecast.prophet")
 *   startDate: ISO date string (optional, defaults based on action)
 *   endDate:   ISO date string (optional, defaults to today)
 *   params:    Optional override params for the analytics module
 *
 * Response:
 *   success: boolean
 *   summary: Structured results from the algorithm
 *   charts:  Array of { title, format, data (base64), width, height }
 *   table:   { columns, rows } for tabular results
 *   meta:    { action, dataRowCount, durationMs }
 */
router.post("/predictive-analytics/run", async (c) => {
  const body = await c.req.json();
  const { action, startDate, endDate, params } = body;

  // ── Validate action ─────────────────────────────────────
  if (!action || !VALID_ACTIONS.has(action)) {
    return c.json(
      {
        error: `Invalid action: "${action}". Valid actions: ${[...VALID_ACTIONS].join(", ")}`,
      },
      400
    );
  }

  // ── Build date range ────────────────────────────────────
  const typedAction = action as AnalyticsAction;
  const defaultRange = getDefaultRange(typedAction);
  const range: DateRange = {
    start: startDate || defaultRange.start,
    end: endDate || defaultRange.end,
  };

  // ── Fetch data from DB ──────────────────────────────────
  let analyticsData;
  try {
    analyticsData = await getAnalyticsData(typedAction, range);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Data query failed: ${msg}` }, 500);
  }

  if (analyticsData.rowCount === 0) {
    return c.json({
      success: false,
      error: `No data found for the selected date range (${range.start} to ${range.end}). Try a wider range.`,
      meta: {
        action: typedAction,
        dataRowCount: 0,
        queryMs: analyticsData.queryMs,
      },
    });
  }

  // ── Get sandbox API ─────────────────────────────────────
  const sandboxApi = (c as any).var?.sandbox;
  if (!sandboxApi) {
    return c.json(
      { error: "Sandbox API not available. Contact administrator." },
      503
    );
  }

  // ── Run analytics in sandbox ────────────────────────────
  try {
    const result = await runAnalytics(sandboxApi, {
      action: typedAction,
      data: analyticsData.data,
      params: params || undefined,
    });

    return c.json({
      ...result,
      meta: {
        ...result.meta,
        queryMs: analyticsData.queryMs,
        dateRange: range,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Analytics execution failed: ${msg}` }, 500);
  }
});

export default router;
