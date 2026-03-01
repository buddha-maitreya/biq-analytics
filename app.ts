import {
  createApp,
  addEventListener,
  getLogger,
} from "@agentuity/runtime";
import { getAISettings } from "@services/settings";
import type { AISettings } from "@services/settings";
import {
  PWA_MANIFEST,
  SERVICE_WORKER_SCRIPT,
  ICON_192_SVG,
  ICON_512_SVG,
  APPLE_TOUCH_ICON_SVG,
} from "@lib/pwa-assets";

// PNG icons are large (88KB base64 total). Lazy-load to avoid decoding on cold start.
let _pngIcons: {
  ICON_192_PNG: Buffer;
  ICON_512_PNG: Buffer;
  ICON_MASKABLE_192_PNG: Buffer;
  ICON_MASKABLE_512_PNG: Buffer;
  APPLE_TOUCH_ICON_PNG: Buffer;
} | null = null;

async function getPngIcons() {
  if (!_pngIcons) {
    const m = await import("@lib/pwa-assets");
    _pngIcons = {
      ICON_192_PNG: m.ICON_192_PNG,
      ICON_512_PNG: m.ICON_512_PNG,
      ICON_MASKABLE_192_PNG: m.ICON_MASKABLE_192_PNG,
      ICON_MASKABLE_512_PNG: m.ICON_MASKABLE_512_PNG,
      APPLE_TOUCH_ICON_PNG: m.APPLE_TOUCH_ICON_PNG,
    };
  }
  return _pngIcons;
}

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

// ────────────────────────────────────────────────────────────
// PWA routes — served at root level (no auth middleware)
//
// These must NOT live in src/web/public/ because the Agentuity CLI
// generates unquoted property names for dotted filenames in
// src/generated/routes.ts, breaking the TypeScript typecheck.
// Registering here (step 4 in the generated app lifecycle) puts
// these routes on the shared Hono router before API routes and
// the serveStatic catch-all, so they respond first.
// ────────────────────────────────────────────────────────────

app.router.get("/manifest.json", (c) => {
  return new Response(JSON.stringify(PWA_MANIFEST), {
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
});

app.router.get("/sw.js", (c) => {
  return new Response(SERVICE_WORKER_SCRIPT, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Service-Worker-Allowed": "/",
      "Cache-Control": "no-cache",
    },
  });
});

// ────────────────────────────────────────────────────────────
// PWA icon routes — served inline to avoid production serveStatic
// path mismatch (Vite copies public/ contents to build root, but
// the generated serveStatic does not strip the /public/ prefix).
// ────────────────────────────────────────────────────────────

const ICON_CACHE = "public, max-age=604800, immutable";

app.router.get("/public/icons/icon-192.svg", () => {
  return new Response(ICON_192_SVG, {
    headers: { "Content-Type": "image/svg+xml", "Cache-Control": ICON_CACHE },
  });
});

app.router.get("/public/icons/icon-512.svg", () => {
  return new Response(ICON_512_SVG, {
    headers: { "Content-Type": "image/svg+xml", "Cache-Control": ICON_CACHE },
  });
});

app.router.get("/public/icons/apple-touch-icon.svg", () => {
  return new Response(APPLE_TOUCH_ICON_SVG, {
    headers: { "Content-Type": "image/svg+xml", "Cache-Control": ICON_CACHE },
  });
});

app.router.get("/public/icons/icon-192.png", async () => {
  const icons = await getPngIcons();
  return new Response(new Uint8Array(icons.ICON_192_PNG), {
    headers: { "Content-Type": "image/png", "Cache-Control": ICON_CACHE },
  });
});

app.router.get("/public/icons/icon-512.png", async () => {
  const icons = await getPngIcons();
  return new Response(new Uint8Array(icons.ICON_512_PNG), {
    headers: { "Content-Type": "image/png", "Cache-Control": ICON_CACHE },
  });
});

app.router.get("/public/icons/icon-maskable-192.png", async () => {
  const icons = await getPngIcons();
  return new Response(new Uint8Array(icons.ICON_MASKABLE_192_PNG), {
    headers: { "Content-Type": "image/png", "Cache-Control": ICON_CACHE },
  });
});

app.router.get("/public/icons/icon-maskable-512.png", async () => {
  const icons = await getPngIcons();
  return new Response(new Uint8Array(icons.ICON_MASKABLE_512_PNG), {
    headers: { "Content-Type": "image/png", "Cache-Control": ICON_CACHE },
  });
});

app.router.get("/public/icons/apple-touch-icon.png", async () => {
  const icons = await getPngIcons();
  return new Response(new Uint8Array(icons.APPLE_TOUCH_ICON_PNG), {
    headers: { "Content-Type": "image/png", "Cache-Control": ICON_CACHE },
  });
});

export default app;
