/**
 * Authentication Service — JWT + Bun.password
 *
 * Provides:
 * - Password hashing (Bun.password — bcrypt, 10 rounds)
 * - JWT token signing/verification (jose, HS256)
 * - Login validation against the users table
 * - Auth middleware for Hono routes
 *
 * JWT secret is derived from AGENTUITY_SDK_KEY or a custom JWT_SECRET env var.
 * Tokens expire in 24 hours by default (configurable via JWT_EXPIRY_HOURS).
 */

import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { eq } from "drizzle-orm";
import { db, users } from "@db/index";
import type { Context, Next } from "hono";

// ── Config ───────────────────────────────────────────────────
const JWT_EXPIRY_HOURS = parseInt(process.env.JWT_EXPIRY_HOURS ?? "24", 10);

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET ?? process.env.AGENTUITY_SDK_KEY ?? "business-iq-dev-secret-change-me";
  return new TextEncoder().encode(secret);
}

// ── JWT Token Payload ────────────────────────────────────────
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  permissions: string[];
}

export interface TokenPayload extends JWTPayload {
  sub: string;       // user id
  email: string;
  name: string;
  role: string;
  permissions: string[];
}

// ── Password Hashing ─────────────────────────────────────────

export async function hashPassword(plain: string): Promise<string> {
  return Bun.password.hash(plain, { algorithm: "bcrypt", cost: 10 });
}

export async function verifyPassword(plain: string, hashed: string): Promise<boolean> {
  return Bun.password.verify(plain, hashed);
}

// ── JWT Token Operations ─────────────────────────────────────

export async function signToken(user: AuthUser): Promise<string> {
  const payload: TokenPayload = {
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    permissions: user.permissions,
  };

  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${JWT_EXPIRY_HOURS}h`)
    .setIssuer("business-iq-enterprise")
    .sign(getJwtSecret());
}

export async function verifyToken(token: string): Promise<TokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(), {
      issuer: "business-iq-enterprise",
    });
    return payload as TokenPayload;
  } catch {
    return null;
  }
}

// ── Login ────────────────────────────────────────────────────

export interface LoginResult {
  success: boolean;
  token?: string;
  user?: AuthUser;
  error?: string;
}

export async function login(email: string, password: string): Promise<LoginResult> {
  if (!email || !password) {
    return { success: false, error: "Email and password are required" };
  }

  // Find user by email
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase().trim()))
    .limit(1);

  if (!user) {
    return { success: false, error: "Invalid email or password" };
  }

  if (!user.isActive) {
    return { success: false, error: "Account is deactivated. Contact your administrator." };
  }

  if (!user.hashedPassword) {
    return { success: false, error: "No password set for this account. Contact your administrator." };
  }

  // Verify password
  const valid = await verifyPassword(password, user.hashedPassword);
  if (!valid) {
    return { success: false, error: "Invalid email or password" };
  }

  // Build auth user
  const authUser: AuthUser = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    permissions: (user.permissions as string[]) ?? [],
  };

  // Sign JWT
  const token = await signToken(authUser);

  // Update last login
  await db
    .update(users)
    .set({ lastLoginAt: new Date() })
    .where(eq(users.id, user.id));

  return { success: true, token, user: authUser };
}

// ── Get User from Token ──────────────────────────────────────

export async function getUserFromToken(token: string): Promise<AuthUser | null> {
  const payload = await verifyToken(token);
  if (!payload || !payload.sub) return null;

  return {
    id: payload.sub,
    email: payload.email,
    name: payload.name,
    role: payload.role,
    permissions: payload.permissions,
  };
}

// ── Update Password ──────────────────────────────────────────

export async function updatePassword(userId: string, hashedPassword: string): Promise<void> {
  await db.update(users).set({ hashedPassword }).where(eq(users.id, userId));
}

// ── Auth Middleware ───────────────────────────────────────────
// Extracts JWT from Authorization header or cookie
// Sets c.set("user", authUser) for downstream handlers

export function authMiddleware() {
  return async (c: Context, next: Next) => {
    // Skip auth for public routes
    const path = new URL(c.req.url).pathname;
    if (path.startsWith("/api/auth/") || path === "/api/config" || path === "/api/health") {
      await next();
      return;
    }

    // Extract token from Authorization header or cookie
    let token: string | undefined;

    const authHeader = c.req.header("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      token = authHeader.slice(7);
    }

    if (!token) {
      // Check cookie
      const cookieHeader = c.req.header("Cookie");
      if (cookieHeader) {
        const match = cookieHeader.match(/biq_token=([^;]+)/);
        if (match) token = match[1];
      }
    }

    if (!token) {
      return c.json({ error: "Authentication required", code: "UNAUTHORIZED" }, 401);
    }

    const user = await getUserFromToken(token);
    if (!user) {
      return c.json({ error: "Invalid or expired token", code: "TOKEN_EXPIRED" }, 401);
    }

    // Store user in context (use "authUser" to avoid Hono built-in type conflict)
    c.set("authUser" as any, user);
    await next();
  };
}

// ── Permission Check Middleware ───────────────────────────────
// Usage: router.use(requirePermission("orders"))

export function requirePermission(permission: string) {
  return async (c: Context, next: Next) => {
    const user = c.get("authUser" as any) as AuthUser | undefined;
    if (!user) {
      return c.json({ error: "Authentication required", code: "UNAUTHORIZED" }, 401);
    }

    // super_admin has all permissions
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
