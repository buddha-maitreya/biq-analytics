import { createApp } from "@agentuity/runtime";

/**
 * Agentuity application entry point.
 * - Lifecycle hooks run once on startup/shutdown.
 * - Custom services (CORS, compression) can be added here.
 * - Environment variables are validated on startup.
 */
const app = await createApp({
  setup: () => {
    // Validate required environment variables on startup
    const required = ["DATABASE_URL"];
    for (const key of required) {
      if (!process.env[key]) {
        throw new Error(`Missing required environment variable: ${key}`);
      }
    }

    return {};
  },
});

export default app;
