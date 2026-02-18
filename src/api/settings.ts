import { createRouter } from "@agentuity/runtime";
import { errorMiddleware } from "@lib/errors";
import { authMiddleware } from "@services/auth";
import * as settingsSvc from "@services/settings";
import { invalidateConfigCache } from "./config";
import { invalidateModelCache } from "@lib/ai";
import { generateText } from "ai";

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
  invalidateModelCache();
  return c.json({ data: updated });
});

/** POST /api/settings/test-model — test AI provider connection */
router.post("/settings/test-model", async (c) => {
  const { provider, model, apiKey } = await c.req.json();
  if (!provider || !model || !apiKey) {
    return c.json({ success: false, error: "Provider, model, and API key are required." }, 400);
  }

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
