/**
 * Routing Analytics + Few-Shot Examples API Routes
 *
 * Combined route module for routing analytics and example management.
 * Admin-only — requires auth middleware.
 *
 * Routes:
 *   GET  /api/admin/routing              — Recent routing decisions
 *   GET  /api/admin/routing/summary      — Aggregated routing stats
 *
 *   GET    /api/admin/examples           — List few-shot examples
 *   GET    /api/admin/examples/categories — List example categories
 *   POST   /api/admin/examples           — Create example
 *   PUT    /api/admin/examples/:id       — Update example
 *   DELETE /api/admin/examples/:id       — Delete example
 */

import { createRouter, validator } from "@agentuity/runtime";
import { errorMiddleware } from "@lib/errors";
import { authMiddleware } from "@services/auth";
import {
  createFewShotExampleSchema,
  updateFewShotExampleSchema,
} from "@lib/validation";
import * as routingSvc from "@services/routing-analytics";
import * as exampleSvc from "@services/few-shot-examples";

const router = createRouter();
router.use(errorMiddleware());
router.use(authMiddleware());

// ── Routing Analytics ──────────────────────────────────────

/** GET /api/admin/routing — recent routing decisions */
router.get("/admin/routing", async (c) => {
  const sessionId = c.req.query("session") || undefined;
  const limit = parseInt(c.req.query("limit") || "50", 10);
  const offset = parseInt(c.req.query("offset") || "0", 10);

  const result = await routingSvc.listRoutingDecisions({
    sessionId,
    limit: Math.min(limit, 200),
    offset,
  });

  return c.json(result);
});

/** GET /api/admin/routing/summary — aggregated routing stats */
router.get("/admin/routing/summary", async (c) => {
  const sinceDays = parseInt(c.req.query("days") || "30", 10);
  const data = await routingSvc.getRoutingSummary(sinceDays);
  return c.json({ data });
});

// ── Few-Shot Examples ──────────────────────────────────────

/** GET /api/admin/examples — list examples */
router.get("/admin/examples", async (c) => {
  const category = c.req.query("category") || undefined;
  const data = await exampleSvc.listExamples(category);
  return c.json({ data });
});

/** GET /api/admin/examples/categories — list categories */
router.get("/admin/examples/categories", async (c) => {
  const data = await exampleSvc.getCategories();
  return c.json({ data });
});

/** POST /api/admin/examples — create example */
router.post(
  "/admin/examples",
  validator({ input: createFewShotExampleSchema }),
  async (c) => {
    const body = c.req.valid("json");
    const data = await exampleSvc.createExample(body);
    return c.json({ data }, 201);
  }
);

/** PUT /api/admin/examples/:id — update example */
router.put(
  "/admin/examples/:id",
  validator({ input: updateFewShotExampleSchema }),
  async (c) => {
    const id = c.req.param("id");
    const body = c.req.valid("json");
    const data = await exampleSvc.updateExample(id, body);
    if (!data) return c.json({ error: "Example not found" }, 404);
    return c.json({ data });
  }
);

/** DELETE /api/admin/examples/:id — delete example */
router.delete("/admin/examples/:id", async (c) => {
  const id = c.req.param("id");
  const deleted = await exampleSvc.deleteExample(id);
  if (!deleted) return c.json({ error: "Example not found" }, 404);
  return c.json({ success: true });
});

export default router;
