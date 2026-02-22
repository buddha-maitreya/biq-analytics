import {
  createApp,
  addEventListener,
  getLogger,
} from "@agentuity/runtime";
import { getAISettings } from "@services/settings";
import type { AISettings } from "@services/settings";

/**
 * Agentuity application entry point.
 *
 * The return value of setup() becomes `ctx.app` in every agent handler
 * and `c.var.app` in every route — typed automatically from AppState.
 *
 * Lifecycle:
 *   setup()    — runs once on cold start. Pre-loads shared config.
 *   shutdown() — runs on graceful teardown. Logs final state.
 */

export interface AppState {
  /** AI personality, tone, guardrails — shared across all agents. */
  aiSettings: AISettings;
  /** Timestamp of app initialization (for uptime tracking). */
  startedAt: number;
}

// ────────────────────────────────────────────────────────────
// App-level event listeners (Phase 1.10)
//
// Events fire on the global event bus. These provide structured
// operational logging for all agent invocations, session lifecycle,
// and thread lifecycle — visible in the Agentuity console.
// ────────────────────────────────────────────────────────────

addEventListener("agent.started", (eventName, agent, ctx) => {
  ctx.logger.info("Agent started", {
    agent: agent.metadata.name,
    sessionId: ctx.sessionId,
  });
});

addEventListener("agent.completed", (eventName, agent, ctx) => {
  ctx.logger.info("Agent completed", {
    agent: agent.metadata.name,
    sessionId: ctx.sessionId,
  });
});

addEventListener("agent.errored", (eventName, agent, ctx, error) => {
  ctx.logger.error("Agent errored", {
    agent: agent.metadata.name,
    sessionId: ctx.sessionId,
    error: error instanceof Error ? error.message : String(error),
  });
});

addEventListener("thread.destroyed", (eventName, thread) => {
  // Phase 1.9: Log thread destruction for observability.
  // Thread state is encrypted and auto-archived by the SDK.
  // Our conversation data is already persisted to Postgres (chatMessages
  // table) on every message, so no additional archival is needed here.
  getLogger()?.info("Thread destroyed", { threadId: thread.id });
});

addEventListener("session.started", (eventName, session) => {
  getLogger()?.info("Session started", { sessionId: session.id });
});

addEventListener("session.completed", (eventName, session) => {
  getLogger()?.info("Session completed", { sessionId: session.id });
});

addEventListener("thread.created", (eventName, thread) => {
  getLogger()?.info("Thread created", { threadId: thread.id });
});

// ────────────────────────────────────────────────────────────
// Application lifecycle
// ────────────────────────────────────────────────────────────

const app = await createApp({
  setup: async (): Promise<AppState> => {
    // Validate required environment variables
    const required = ["DATABASE_URL"];
    for (const key of required) {
      if (!process.env[key]) {
        throw new Error(`Missing required environment variable: ${key}`);
      }
    }

    // Pre-load AI settings once on startup (not per-request)
    // Wrapped in try-catch so a transient DB issue doesn't crash the entire app.
    let aiSettings: AISettings;
    try {
      aiSettings = await getAISettings();
    } catch (err) {
      console.error("[app] Failed to load AI settings, using empty defaults:", err);
      aiSettings = {
        aiPersonality: "",
        aiEnvironment: "",
        aiTone: "",
        aiGoal: "",
        aiBusinessContext: "",
        aiResponseFormatting: "",
        aiQueryReasoning: "",
        aiToolGuidelines: "",
        aiGuardrails: "",
        aiInsightsInstructions: "",
        aiReportInstructions: "",
        aiWelcomeMessage: "",
      };
    }

    getLogger()?.info("App started", { timestamp: Date.now() });

    return { aiSettings, startedAt: Date.now() };
  },

  shutdown: async (state) => {
    const uptimeMs = Date.now() - state.startedAt;
    getLogger()?.info("App shutting down", {
      uptimeMinutes: Math.round(uptimeMs / 60_000),
    });
  },
});

export default app;
