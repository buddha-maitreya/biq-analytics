/**
 * Analytics Configs API — Admin Console routes for tuning analytics algorithms.
 *
 * Endpoints:
 *   GET  /api/admin/analytics-configs             — list all categories (merged with defaults)
 *   GET  /api/admin/analytics-configs/:category    — get one category config
 *   PUT  /api/admin/analytics-configs/:category    — upsert overrides for a category
 *   POST /api/admin/analytics-configs/:category/reset — reset to defaults
 *   POST /api/admin/analytics-configs/seed         — seed all defaults (idempotent)
 */

import { createRouter, validator } from "@agentuity/runtime";
import { errorMiddleware } from "@lib/errors";
import { sessionMiddleware } from "@lib/auth";
import { updateAnalyticsConfigSchema } from "@lib/validation";
import * as analyticsSvc from "@services/analytics-configs";
import { ANALYTICS_CATEGORIES, type AnalyticsCategory } from "@lib/analytics-defaults";

const router = createRouter();
router.use(errorMiddleware());
router.use(sessionMiddleware());

/** GET /api/admin/analytics-configs — list all categories */
router.get("/admin/analytics-configs", async (c) => {
  // Seed defaults on first access (idempotent)
  await analyticsSvc.seedAnalyticsDefaults();
  const configs = await analyticsSvc.listAnalyticsConfigs();
  return c.json({ data: configs });
});

/** GET /api/admin/analytics-configs/:category — get one category */
router.get("/admin/analytics-configs/:category", async (c) => {
  const category = c.req.param("category") as AnalyticsCategory;
  if (!ANALYTICS_CATEGORIES.includes(category)) {
    return c.json({ error: `Unknown analytics category: ${category}` }, 400);
  }
  const config = await analyticsSvc.getAnalyticsConfig(category);
  return c.json({ data: config });
});

/** PUT /api/admin/analytics-configs/:category — update overrides */
router.put(
  "/admin/analytics-configs/:category",
  validator({ input: updateAnalyticsConfigSchema }),
  async (c) => {
    const category = c.req.param("category") as AnalyticsCategory;
    if (!ANALYTICS_CATEGORIES.includes(category)) {
      return c.json({ error: `Unknown analytics category: ${category}` }, 400);
    }

    const body = c.req.valid("json");
    const updated = await analyticsSvc.upsertAnalyticsConfig({
      category,
      displayName: body.displayName,
      description: body.description,
      isEnabled: body.isEnabled,
      params: body.params,
      schedule: body.schedule,
    });

    return c.json({ data: updated });
  }
);

/** POST /api/admin/analytics-configs/:category/reset — reset to defaults */
router.post("/admin/analytics-configs/:category/reset", async (c) => {
  const category = c.req.param("category") as AnalyticsCategory;
  if (!ANALYTICS_CATEGORIES.includes(category)) {
    return c.json({ error: `Unknown analytics category: ${category}` }, 400);
  }
  const config = await analyticsSvc.resetAnalyticsConfig(category);
  return c.json({ data: config });
});

/** POST /api/admin/analytics-configs/seed — seed all defaults (idempotent) */
router.post("/admin/analytics-configs/seed", async (c) => {
  await analyticsSvc.seedAnalyticsDefaults();
  const configs = await analyticsSvc.listAnalyticsConfigs();
  return c.json({ data: configs });
});

export default router;
