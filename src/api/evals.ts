/**
 * Eval Results API Routes — Phase 7.6
 *
 * Endpoints for viewing evaluation results and trends.
 * Admin-only — requires auth middleware.
 *
 * Routes:
 *   GET  /api/admin/evals          — List eval results (paginated)
 *   GET  /api/admin/evals/summary  — Aggregated pass rates per agent+eval
 *   GET  /api/admin/evals/trends   — Daily pass rate trends
 */

import { createRouter } from "@agentuity/runtime";
import { errorMiddleware } from "@lib/errors";
import { authMiddleware } from "@services/auth";
import * as evalSvc from "@services/eval-results";

const router = createRouter();
router.use(errorMiddleware());
router.use(authMiddleware());

/** GET /api/admin/evals — paginated eval results */
router.get("/admin/evals", async (c) => {
  const agentName = c.req.query("agent") || undefined;
  const evalName = c.req.query("eval") || undefined;
  const passedStr = c.req.query("passed");
  const limit = parseInt(c.req.query("limit") || "50", 10);
  const offset = parseInt(c.req.query("offset") || "0", 10);

  const passed =
    passedStr === "true" ? true : passedStr === "false" ? false : undefined;

  const result = await evalSvc.listEvalResults({
    agentName,
    evalName,
    passed,
    limit: Math.min(limit, 200),
    offset,
  });

  return c.json(result);
});

/** GET /api/admin/evals/summary — aggregated summary per agent+eval */
router.get("/admin/evals/summary", async (c) => {
  const agentName = c.req.query("agent") || undefined;
  const sinceDays = parseInt(c.req.query("days") || "30", 10);

  const data = await evalSvc.getEvalSummary({ agentName, sinceDays });
  return c.json({ data });
});

/** GET /api/admin/evals/trends — daily pass rate trends */
router.get("/admin/evals/trends", async (c) => {
  const agentName = c.req.query("agent") || undefined;
  const evalName = c.req.query("eval") || undefined;
  const days = parseInt(c.req.query("days") || "30", 10);

  const data = await evalSvc.getEvalTrend({ agentName, evalName, days });
  return c.json({ data });
});

export default router;
