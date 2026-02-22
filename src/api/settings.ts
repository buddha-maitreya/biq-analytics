import { createRouter, validator } from "@agentuity/runtime";
import { errorMiddleware } from "@lib/errors";
import { sessionMiddleware } from "@lib/auth";
import { updateSettingsSchema, testModelSchema } from "@lib/validation";
import * as settingsSvc from "@services/settings";
import { invalidateConfigCache } from "./config";
import { invalidateModelCache } from "@lib/ai";
import { invalidateRateLimitCache } from "@lib/rate-limit";
import { invalidateReportCache } from "@services/settings";
import { generateText } from "ai";
import * as objectStorage from "@services/object-storage";

const router = createRouter();
router.use(errorMiddleware());
router.use(sessionMiddleware());

/** GET /api/settings — all business settings */
router.get("/settings", async (c) => {
  try {
    const settings = await settingsSvc.getAllSettings();
    return c.json({ data: settings });
  } catch (err) {
    // DB may not be ready on first load — return defaults gracefully
    console.error("Failed to load settings:", err instanceof Error ? err.message : err);
    return c.json({ data: {} }, 500);
  }
});

/** PUT /api/settings — update business settings */
router.put("/settings", validator({ input: updateSettingsSchema }), async (c) => {
  const body = c.req.valid("json");
  const updated = await settingsSvc.updateSettings(body);
  invalidateConfigCache();
  invalidateModelCache();
  invalidateRateLimitCache();
  invalidateReportCache();
  return c.json({ data: updated });
});

/** GET /api/settings/reports — report-specific settings (parsed with defaults) */
router.get("/settings/reports", async (c) => {
  try {
    const reportSettings = await settingsSvc.getReportSettings();
    return c.json({ data: reportSettings });
  } catch (err) {
    console.error("Failed to load report settings:", err instanceof Error ? err.message : err);
    return c.json({ data: settingsSvc.getReportSettingsDefaults() }, 500);
  }
});

/** POST /api/settings/test-model — test AI provider connection */
router.post("/settings/test-model", validator({ input: testModelSchema }), async (c) => {
  const { provider, model, apiKey } = c.req.valid("json");

  try {
    // Dynamically create the model based on provider
    let llm: Parameters<typeof generateText>[0]["model"];

    if (provider === "openai") {
      const { createOpenAI } = await import("@ai-sdk/openai");
      const client = createOpenAI({ apiKey });
      llm = client(model);
    } else if (provider === "anthropic") {
      const { createAnthropic } = await import("@ai-sdk/anthropic");
      const client = createAnthropic({ apiKey });
      llm = client(model);
    } else if (provider === "groq") {
      const { createGroq } = await import("@ai-sdk/groq");
      const client = createGroq({ apiKey });
      llm = client(model);
    } else {
      return c.json({ success: false, error: `Unknown provider: ${provider}` }, 400);
    }

    const result = await generateText({
      model: llm,
      prompt: "Reply with exactly: OK",
      maxTokens: 5,
    });

    return c.json({
      success: true,
      message: `Connected! Model responded: "${result.text.trim()}"`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return c.json({ success: false, error: msg }, 500);
  }
});

// ── Logo Upload ────────────────────────────────────────────

const logoStorage = objectStorage.namespace("branding");

/** Max logo file size: 2 MB */
const MAX_LOGO_SIZE = 2 * 1024 * 1024;

/** Allowed logo MIME types */
const ALLOWED_LOGO_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/svg+xml",
  "image/webp",
]);

/**
 * POST /api/settings/logo — Upload a company logo.
 *
 * Expects multipart/form-data with a "logo" field (image file).
 * Stores in S3 under branding/logo.{ext}, updates businessLogoUrl setting,
 * and returns the presigned download URL.
 */
router.post("/settings/logo", async (c) => {
  const body = await c.req.parseBody();
  const file = body["logo"];

  if (!file || typeof file === "string") {
    return c.json({ error: "No file uploaded. Send a 'logo' field in multipart/form-data." }, 400);
  }

  const contentType = file.type || "application/octet-stream";
  if (!ALLOWED_LOGO_TYPES.has(contentType)) {
    return c.json({
      error: `File type "${contentType}" not allowed. Allowed: PNG, JPG, SVG, WebP.`,
    }, 400);
  }

  const buffer = await file.arrayBuffer();
  if (buffer.byteLength > MAX_LOGO_SIZE) {
    return c.json({
      error: `Logo too large (${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB). Max: 2 MB.`,
    }, 400);
  }

  // Determine file extension
  const extMap: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/svg+xml": "svg",
    "image/webp": "webp",
  };
  const ext = extMap[contentType] || "png";
  const s3Key = `logo.${ext}`;

  try {
    // Upload to S3
    await logoStorage.put(s3Key, Buffer.from(buffer), { contentType });

    // Generate a long-lived presigned URL (7 days — will be refreshed on access)
    const downloadUrl = logoStorage.presign(s3Key, { expiresIn: 604800 });

    // Persist the URL in business settings
    await settingsSvc.updateSettings({ businessLogoUrl: downloadUrl });
    invalidateConfigCache();

    return c.json({
      data: {
        logoUrl: downloadUrl,
        filename: file.name || `logo.${ext}`,
        sizeBytes: buffer.byteLength,
        contentType,
      },
    });
  } catch (err: any) {
    const message = err?.message ?? String(err);
    console.error("[settings/logo] Upload failed:", message);
    return c.json({ error: `Logo upload failed: ${message}` }, 500);
  }
});

/**
 * DELETE /api/settings/logo — Remove the company logo.
 *
 * Clears the businessLogoUrl setting. Does not delete the S3 object
 * (it will be overwritten on next upload).
 */
router.delete("/settings/logo", async (c) => {
  await settingsSvc.updateSettings({ businessLogoUrl: "" });
  invalidateConfigCache();
  return c.json({ data: { removed: true } });
});

export default router;
