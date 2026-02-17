/**
 * AI model configuration.
 *
 * Centralizes LLM model selection so agents don't hardcode providers.
 * Uses the Vercel AI SDK provider pattern.
 *
 * Requires OPENAI_API_KEY (or equivalent) in environment.
 * Model ID defaults to AI_MODEL env var or "gpt-4o-mini".
 */

import { openai } from "@ai-sdk/openai";

/**
 * Get the configured AI language model.
 *
 * @param modelId - Override the default model (e.g. "gpt-4o", "gpt-4o-mini")
 * @returns Vercel AI SDK LanguageModel instance
 */
export function getModel(modelId?: string) {
  const id = modelId ?? process.env.AI_MODEL ?? "gpt-4o-mini";
  return openai(id);
}
