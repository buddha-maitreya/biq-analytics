import { createRouter } from "@agentuity/runtime";
import { config } from "@lib/config";

const router = createRouter();

/** Return deployment config for frontend consumption */
router.get("/config", (c) => {
  return c.json({
    companyName: config.companyName,
    companyLogoUrl: config.companyLogoUrl,
    currency: config.currency,
    timezone: config.timezone,
    labels: config.labels,
  });
});

/** Health check */
router.get("/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

export default router;
