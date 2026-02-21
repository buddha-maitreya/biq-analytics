import { createRouter, validator } from "@agentuity/runtime";
import { errorMiddleware } from "@lib/errors";
import { sessionMiddleware } from "@lib/auth";
import { updateSettingsSchema, testModelSchema } from "@lib/validation";
import * as settingsSvc from "@services/settings";
import { invalidateConfigCache } from "./config";
import { invalidateModelCache } from "@lib/ai";
import { invalidateRateLimitCache } from "@lib/rate-limit";
import { generateText } from "ai";

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
  return c.json({ data: updated });
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

export default router;
