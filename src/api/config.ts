import { createRouter } from "@agentuity/runtime";
import { config } from "@lib/config";
import * as settingsSvc from "@services/settings";

const router = createRouter();

/** In-memory cache for config to avoid DB hit on every request */
let cachedConfig: any = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 30_000; // 30 seconds

/** Invalidate config cache (called when settings are updated) */
export function invalidateConfigCache() {
  cachedConfig = null;
  cacheTimestamp = 0;
}

/** Return deployment config for frontend consumption, merged with DB settings */
router.get("/config", async (c) => {
  const now = Date.now();
  if (cachedConfig && now - cacheTimestamp < CACHE_TTL_MS) {
    return c.json(cachedConfig);
  }

  const dbSettings = await settingsSvc.getAllSettings();

  cachedConfig = {
    companyName: dbSettings.businessName || config.companyName,
    companyLogoUrl: dbSettings.businessLogoUrl || config.companyLogoUrl,
    companyTagline: dbSettings.businessTagline || "",
    primaryColor: dbSettings.primaryColor || "#3b82f6",
    currency: dbSettings.currency || config.currency,
    timezone: dbSettings.timezone || config.timezone,
    labels: config.labels,
  };
  cacheTimestamp = now;

  return c.json(cachedConfig);
});

/** Health check */
router.get("/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

export default router;
