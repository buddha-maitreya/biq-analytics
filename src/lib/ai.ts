/**
 * AI model configuration.
 *
 * Centralizes LLM model selection so agents don't hardcode providers.
 * Uses the Vercel AI SDK provider pattern.
 *
 * Priority for model selection:
 *   1. Explicit `modelId` parameter passed to getModel()
 *   2. DB-stored settings (aiModelProvider, aiModelName, aiModelApiKey)
 *   3. Environment variables (AI_MODEL, OPENAI_API_KEY, etc.)
 *   4. Defaults: openai / gpt-4o-mini
 */

import { openai } from "@ai-sdk/openai";
import type { LanguageModelV1 } from "ai";

/** Cached DB model config — refreshed every 60s */
let _cachedConfig: { provider: string; model: string; apiKey: string } | null = null;
let _cacheTime = 0;
const CACHE_TTL = 60_000; // 60 seconds

async function loadDBConfig(): Promise<{ provider: string; model: string; apiKey: string }> {
  const now = Date.now();
  if (_cachedConfig && now - _cacheTime < CACHE_TTL) return _cachedConfig;

  try {
    const { getAllSettings } = await import("@services/settings");
    const s = await getAllSettings();
    _cachedConfig = {
      provider: s.aiModelProvider || "openai",
      model: s.aiModelName || "",
      apiKey: s.aiModelApiKey || "",
    };
    _cacheTime = now;
    return _cachedConfig;
  } catch {
    return { provider: "openai", model: "", apiKey: "" };
  }
}

/** Invalidate cached model config (call after settings update) */
export function invalidateModelCache() {
  _cachedConfig = null;
  _cacheTime = 0;
}

/**
 * Get the configured AI language model.
 *
 * @param modelId - Override the default model (e.g. "gpt-4o", "gpt-4o-mini")
 * @returns Vercel AI SDK LanguageModel instance
 */
export async function getModel(modelId?: string): Promise<LanguageModelV1> {
  const dbCfg = await loadDBConfig();

  const provider = dbCfg.provider || "openai";
  const id = modelId ?? (dbCfg.model || process.env.AI_MODEL || "gpt-4o-mini");
  const apiKey = dbCfg.apiKey || undefined; // undefined falls back to env var

  if (provider === "anthropic") {
    const { createAnthropic } = await import("@ai-sdk/anthropic");
    const client = createAnthropic(apiKey ? { apiKey } : {});
    return client(id);
  }

  if (provider === "groq") {
    const { createGroq } = await import("@ai-sdk/groq");
    const client = createGroq(apiKey ? { apiKey } : {});
    return client(id);
  }

  // Default: OpenAI
  if (apiKey) {
    const { createOpenAI } = await import("@ai-sdk/openai");
    const client = createOpenAI({ apiKey });
    return client(id);
  }

  return openai(id);
}

/**
 * Synchronous model getter — uses env vars only (no DB lookup).
 * Use this in contexts where async is not possible.
 */
export function getModelSync(modelId?: string) {
  const id = modelId ?? process.env.AI_MODEL ?? "gpt-4o-mini";
  return openai(id);
}
