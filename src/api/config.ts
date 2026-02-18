import { createRouter } from "@agentuity/runtime";
import { config } from "@lib/config";
import * as settingsSvc from "@services/settings";

const router = createRouter();

/** Return deployment config for frontend consumption, merged with DB settings */
router.get("/config", async (c) => {
  const dbSettings = await settingsSvc.getAllSettings();

  return c.json({
    companyName: dbSettings.businessName || config.companyName,
    companyLogoUrl: dbSettings.businessLogoUrl || config.companyLogoUrl,
    companyTagline: dbSettings.businessTagline || "",
    primaryColor: dbSettings.primaryColor || "#3b82f6",
    currency: dbSettings.currency || config.currency,
    timezone: dbSettings.timezone || config.timezone,
    labels: config.labels,
  });
});

/** Health check */
router.get("/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

export default router;
