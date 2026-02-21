/**
 * Auth API Routes
 *
 * Legacy endpoints (will be removed after full migration):
 *   POST /auth/login    — Authenticate with email + password, returns JWT
 *   GET  /auth/me       — Get current user from token
 *   POST /auth/logout   — Clear auth cookie (client-side token removal)
 *   POST /auth/password — Change password (authenticated)
 *
 * BetterAuth endpoints (new — @agentuity/auth):
 *   ALL /auth/*         — BetterAuth handles sign-in, sign-up, sign-out,
 *                         session, OAuth, email verification, org management,
 *                         API key management, etc.
 */

import { createRouter } from "@agentuity/runtime";
import { errorMiddleware } from "@lib/errors";
import * as authSvc from "@services/auth";
import { authRouteHandler } from "@lib/auth";

const router = createRouter();
router.use(errorMiddleware());

// ── Login ────────────────────────────────────────────────────
router.post("/auth/login", async (c) => {
  const { email, password } = await c.req.json<{
    email: string;
    password: string;
  }>();

  const result = await authSvc.login(email, password);

  if (!result.success) {
    return c.json({ error: result.error }, 401);
  }

  // Set HTTP-only cookie + return token in body
  // Cookie: secure in production, max-age 24h
  const isSecure = c.req.url.startsWith("https");
  const maxAge = 60 * 60 * 24; // 24 hours
  c.header(
    "Set-Cookie",
    `biq_token=${result.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isSecure ? "; Secure" : ""}`
  );

  return c.json({
    token: result.token,
    user: result.user,
  });
});

// ── Get Current User ─────────────────────────────────────────
router.get("/auth/me", async (c) => {
  // Extract token
  let token: string | undefined;
  const authHeader = c.req.header("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    token = authHeader.slice(7);
  }
  if (!token) {
    const cookieHeader = c.req.header("Cookie");
    if (cookieHeader) {
      const match = cookieHeader.match(/biq_token=([^;]+)/);
      if (match) token = match[1];
    }
  }

  if (!token) {
    return c.json({ user: null }, 200);
  }

  const user = await authSvc.getUserFromToken(token);
  if (!user) {
    return c.json({ user: null }, 200);
  }

  return c.json({ user });
});

// ── Logout ───────────────────────────────────────────────────
router.post("/auth/logout", (c) => {
  // Clear the cookie
  c.header(
    "Set-Cookie",
    "biq_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"
  );
  return c.json({ ok: true });
});

// ── Change Password (authenticated) ──────────────────────────
router.post("/auth/password", async (c) => {
  // Verify current auth
  let token: string | undefined;
  const authHeader = c.req.header("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    token = authHeader.slice(7);
  }
  if (!token) {
    const cookieHeader = c.req.header("Cookie");
    if (cookieHeader) {
      const match = cookieHeader.match(/biq_token=([^;]+)/);
      if (match) token = match[1];
    }
  }

  if (!token) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const user = await authSvc.getUserFromToken(token);
  if (!user) {
    return c.json({ error: "Invalid token" }, 401);
  }

  const { currentPassword, newPassword } = await c.req.json<{
    currentPassword: string;
    newPassword: string;
  }>();

  if (!newPassword || newPassword.length < 6) {
    return c.json({ error: "New password must be at least 6 characters" }, 400);
  }

  // Re-validate current password via login
  const check = await authSvc.login(user.email, currentPassword);
  if (!check.success) {
    return c.json({ error: "Current password is incorrect" }, 401);
  }

  // Hash new password and update
  const hashed = await authSvc.hashPassword(newPassword);
  await authSvc.updatePassword(user.id, hashed);

  return c.json({ ok: true, message: "Password updated successfully" });
});

// ── BetterAuth Routes (new) ──────────────────────────────────
// Mount all BetterAuth endpoints: sign-in/email, sign-up/email,
// sign-out, get-session, organization/*, api-key/*, etc.
// These coexist with legacy endpoints above during migration.
router.on(["GET", "POST"], "/auth/*", authRouteHandler);

export default router;
