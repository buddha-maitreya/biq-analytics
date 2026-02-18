import { createRouter } from "@agentuity/runtime";
import { errorMiddleware } from "@lib/errors";
import { authMiddleware } from "@services/auth";
import * as settingsSvc from "@services/settings";
import { invalidateConfigCache } from "./config";

const router = createRouter();
router.use(errorMiddleware());
router.use(authMiddleware());

/** GET /api/settings — all business settings */
router.get("/settings", async (c) => {
  const settings = await settingsSvc.getAllSettings();
  return c.json({ data: settings });
});

/** PUT /api/settings — update business settings */
router.put("/settings", async (c) => {
  const body = await c.req.json();
  const updated = await settingsSvc.updateSettings(body);
  invalidateConfigCache();
  return c.json({ data: updated });
});

export default router;
