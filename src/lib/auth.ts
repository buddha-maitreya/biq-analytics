/**
 * Agentuity Auth Instance — @agentuity/auth (BetterAuth)
 *
 * Central auth configuration for the platform. This wraps BetterAuth
 * with sensible defaults:
 *   - Email/password sign-in (enabled by default)
 *   - Organization plugin (multi-user orgs with owner/admin/member roles)
 *   - JWT + Bearer token support
 *   - API key plugin for programmatic access
 *   - Server-side sessions (revocable, stored in DB)
 *
 * Usage:
 *   Server: import { auth, sessionMiddleware } from "@lib/auth"
 *   React:  import { authClient } from (see @lib/auth-client when ready)
 *
 * Migration note: This coexists with the legacy JWT auth in
 * src/services/auth.ts during the transition period. Once all
 * routes are migrated, the legacy module will be removed.
 */

import {
  createAuth,
  createSessionMiddleware,
  createApiKeyMiddleware,
  mountAuthRoutes,
} from "@agentuity/auth";
import type {
  AuthUser,
  AuthSession,
  AuthOrgContext,
  AuthInterface,
  AuthMiddlewareOptions,
  ApiKeyMiddlewareOptions,
} from "@agentuity/auth";
import type { Context, Next } from "hono";
import { eq } from "drizzle-orm";
import { db, users } from "@db/index";

// ── Auth Instance ──────────────────────────────────────────

export const auth = createAuth({
  connectionString: process.env.DATABASE_URL,
  basePath: "/api/auth",
  trustedOrigins: [process.env.APP_URL],
  emailAndPassword: {
    enabled: true,
  },
});

// ── Extended User Type ─────────────────────────────────────
// During migration, we enrich the BetterAuth user with fields
// from the legacy `users` table (role, permissions, etc.)

export interface AppUser {
  id: string;
  email: string;
  name: string;
  role: string;
  permissions: string[];
  primaryWarehouseId?: string | null;
  assignedWarehouses?: string[] | null;
  isActive?: boolean;
}

// ── Compatibility Middleware ────────────────────────────────
// Wraps @agentuity/auth session middleware, then enriches
// c.var.user with legacy `users` table fields (role, permissions).
//
// This allows a gradual migration: routes that read c.var.user
// get the same shape they had with the old authMiddleware.

/**
 * Session middleware with legacy field enrichment.
 *
 * - Validates session via BetterAuth (cookie or Bearer)
 * - Falls back to legacy JWT validation if no BetterAuth session
 * - Enriches c.var.user with role/permissions from legacy `users` table
 * - Sets c.var.appUser with the enriched user for typed access
 *
 * @param options - Auth middleware options (optional auth, role checks)
 */
export function sessionMiddleware(options?: AuthMiddlewareOptions) {
  const betterAuthMw = createSessionMiddleware(auth, { ...options, optional: true });

  return async (c: Context, next: Next) => {
    // Skip auth for public routes
    const path = new URL(c.req.url).pathname;
    if (
      path.startsWith("/api/auth/") ||
      path === "/api/config" ||
      path === "/api/health"
    ) {
      await next();
      return;
    }

    // Try BetterAuth session first
    await betterAuthMw(c, async () => {});

    let appUser: AppUser | null = null;

    if (c.var.user) {
      // BetterAuth session found — enrich with legacy fields
      appUser = await enrichUserFromLegacyTable(c.var.user.email);
    }

    if (!appUser) {
      // Fall back to legacy JWT validation
      appUser = await tryLegacyJwt(c);
    }

    if (!appUser && !options?.optional) {
      return c.json(
        { error: "Authentication required", code: "UNAUTHORIZED" },
        401
      );
    }

    // Set both the typed appUser and the generic authUser (for backwards compat)
    if (appUser) {
      c.set("appUser" as any, appUser);
      c.set("authUser" as any, appUser);
    }

    await next();
  };
}

/**
 * Look up a user's role & permissions from the legacy `users` table by email.
 */
async function enrichUserFromLegacyTable(
  email: string
): Promise<AppUser | null> {
  try {
    const [row] = await db
      .select()
      .from(users)
      .where(eq(users.email, email.toLowerCase().trim()))
      .limit(1);

    if (!row || !row.isActive) return null;

    return {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      permissions: (row.permissions as string[]) ?? [],
      primaryWarehouseId: row.primaryWarehouseId ?? null,
      assignedWarehouses: row.assignedWarehouses as string[] | null,
      isActive: row.isActive,
    };
  } catch {
    return null;
  }
}

/**
 * Legacy JWT fallback — validates old biq_token JWT tokens.
 * Imported dynamically to avoid circular dependency.
 */
async function tryLegacyJwt(c: Context): Promise<AppUser | null> {
  try {
    const { getUserFromToken } = await import("@services/auth");

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
    if (!token) return null;

    const legacyUser = await getUserFromToken(token);
    if (!legacyUser) return null;

    return {
      id: legacyUser.id,
      email: legacyUser.email,
      name: legacyUser.name,
      role: legacyUser.role,
      permissions: legacyUser.permissions,
    };
  } catch {
    return null;
  }
}

// ── Permission Helpers ─────────────────────────────────────

/**
 * Get the AppUser from Hono context (set by sessionMiddleware).
 * Returns null if not authenticated.
 */
export function getAppUser(c: Context): AppUser | null {
  return (c.get("appUser" as any) as AppUser) ?? null;
}

/**
 * Permission check middleware.
 * super_admin bypasses all permission checks.
 */
export function requirePermission(permission: string) {
  return async (c: Context, next: Next) => {
    const user = getAppUser(c);
    if (!user) {
      return c.json(
        { error: "Authentication required", code: "UNAUTHORIZED" },
        401
      );
    }

    if (user.role === "super_admin") {
      await next();
      return;
    }

    if (!user.permissions.includes(permission)) {
      return c.json(
        { error: `Permission '${permission}' required`, code: "FORBIDDEN" },
        403
      );
    }

    await next();
  };
}

/**
 * API key middleware — validates x-agentuity-auth-api-key header.
 *
 * @param options - Optional config (optional auth, permission checks)
 */
export function apiKeyMiddleware(options?: ApiKeyMiddlewareOptions) {
  return createApiKeyMiddleware(auth, options);
}

/**
 * Mount all BetterAuth routes (sign-in, sign-up, sign-out, session, etc.)
 * Use: api.on(["GET", "POST"], "/api/auth/*", authRouteHandler)
 */
export const authRouteHandler = mountAuthRoutes(auth);

// ── Re-exports ─────────────────────────────────────────────

export type {
  AuthUser,
  AuthSession,
  AuthOrgContext,
  AuthInterface,
  AuthMiddlewareOptions,
  ApiKeyMiddlewareOptions,
};
