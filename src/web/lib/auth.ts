/**
 * Frontend auth client setup.
 *
 * Creates the BetterAuth client for use with AuthProvider.
 * During the transition from legacy JWT → BetterAuth sessions,
 * this provides the client infrastructure. Legacy endpoints
 * (/api/auth/login, /api/auth/me) still work via cookies.
 */
import { createAuthClient } from "@agentuity/auth/react";

export const authClient = createAuthClient({
  basePath: "/api/auth",
});
