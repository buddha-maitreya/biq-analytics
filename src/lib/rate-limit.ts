import { getRateLimits, invalidateRateLimitCache as _invalidateCache, type RateLimitSettings } from "@services/settings";

/**
 * Rate Limiting — in-memory sliding window rate limiter.
 *
 * Industry-agnostic: configurable per-key limits for any endpoint.
 * Uses sliding window counters stored in-memory (per-deployment).
 * Suitable for single-tenant deployments where each client has
 * their own server instance.
 *
 * Limits are configurable from the Admin UI via business_settings.
 * For multi-instance deployments, swap to ctx.kv-backed storage.
 */

/** Re-export so API layer can call it without importing from services */
export const invalidateRateLimitCache = _invalidateCache;

// ── Types ──────────────────────────────────────────────────

export interface RateLimitConfig {
  /** Maximum requests allowed within the window */
  max: number;
  /** Window duration in milliseconds (default: 60_000 = 1 minute) */
  windowMs?: number;
  /** Key prefix for namespacing (e.g. "api", "tool", "chat") */
  prefix?: string;
  /** Custom message when rate limited */
  message?: string;
}

interface WindowEntry {
  count: number;
  resetAt: number;
}

// ── In-memory store ────────────────────────────────────────

const store = new Map<string, WindowEntry>();

// Periodic cleanup of expired entries (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now >= entry.resetAt) store.delete(key);
  }
}, 5 * 60_000);

// ── Core functions ─────────────────────────────────────────

/**
 * Check if a key is rate limited and increment its counter.
 *
 * @param key - Unique identifier (e.g. userId, IP, toolId)
 * @param config - Rate limit configuration
 * @returns Object with allowed/remaining/resetAt
 */
export function checkRateLimit(
  key: string,
  config: RateLimitConfig
): { allowed: boolean; remaining: number; resetAt: number; retryAfterMs: number } {
  const windowMs = config.windowMs ?? 60_000;
  const fullKey = config.prefix ? `${config.prefix}:${key}` : key;
  const now = Date.now();

  let entry = store.get(fullKey);

  // Window expired or doesn't exist — start new window
  if (!entry || now >= entry.resetAt) {
    entry = { count: 1, resetAt: now + windowMs };
    store.set(fullKey, entry);
    return {
      allowed: true,
      remaining: config.max - 1,
      resetAt: entry.resetAt,
      retryAfterMs: 0,
    };
  }

  // Within window — check limit
  if (entry.count >= config.max) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: entry.resetAt,
      retryAfterMs: entry.resetAt - now,
    };
  }

  // Increment and allow
  entry.count++;
  return {
    allowed: true,
    remaining: config.max - entry.count,
    resetAt: entry.resetAt,
    retryAfterMs: 0,
  };
}

/**
 * Hono middleware factory for rate limiting.
 *
 * Usage:
 *   router.use(rateLimit({ max: 100, windowMs: 60_000, prefix: "api" }));
 *
 * Extracts key from:
 *   1. Authenticated user ID (c.var.user?.id)
 *   2. X-Forwarded-For header
 *   3. Remote IP
 */
export function rateLimit(config: RateLimitConfig) {
  return async (c: any, next: () => Promise<void>) => {
    // Extract rate limit key: user ID > forwarded IP > remote IP
    const user = c.var?.user ?? c.get?.("user");
    const key =
      user?.id ??
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      "anonymous";

    const result = checkRateLimit(key, config);

    // Set standard rate limit headers
    c.header("X-RateLimit-Limit", String(config.max));
    c.header("X-RateLimit-Remaining", String(result.remaining));
    c.header("X-RateLimit-Reset", String(Math.ceil(result.resetAt / 1000)));

    if (!result.allowed) {
      c.header("Retry-After", String(Math.ceil(result.retryAfterMs / 1000)));
      return c.json(
        {
          error: config.message ?? "Too many requests. Please try again later.",
          retryAfterMs: result.retryAfterMs,
        },
        429
      );
    }

    await next();
  };
}

/**
 * Rate limit check for custom tool execution.
 * Uses tool-specific limits from the tool's DB config.
 *
 * @param toolId - Custom tool ID
 * @param userId - User triggering the tool
 * @param maxPerDay - Maximum invocations per day (from tool config)
 */
export function checkToolRateLimit(
  toolId: string,
  userId: string,
  maxPerDay: number = 100
): { allowed: boolean; remaining: number } {
  const result = checkRateLimit(`${userId}:${toolId}`, {
    max: maxPerDay,
    windowMs: 24 * 60 * 60_000, // 24 hours
    prefix: "tool",
  });
  return { allowed: result.allowed, remaining: result.remaining };
}

// ── Dynamic (DB-configurable) rate limit middleware ─────────

/** Setting key type for rate limits */
type RateLimitKey = keyof RateLimitSettings;

/**
 * Hono middleware factory that reads the limit from DB settings.
 *
 * Unlike the static `rateLimit()` above, this reads the current max
 * from business_settings (cached 1 min) so the admin can tune limits
 * from the UI without a redeploy.
 *
 * Usage:
 *   router.post("/chat/send", dynamicRateLimit("rateLimitChat", { windowMs: 60_000, prefix: "chat-send" }), handler)
 */
export function dynamicRateLimit(
  settingKey: RateLimitKey,
  opts: { windowMs?: number; prefix?: string; message?: string }
) {
  return async (c: any, next: () => Promise<void>) => {
    const limits = await getRateLimits();
    const max = limits[settingKey] ?? 30;

    // Extract rate limit key: user ID > forwarded IP > remote IP
    const user = c.var?.user ?? c.get?.("user");
    const key =
      user?.id ??
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      "anonymous";

    const windowMs = opts.windowMs ?? 60_000;
    const result = checkRateLimit(key, { max, windowMs, prefix: opts.prefix });

    // Set standard rate limit headers
    c.header("X-RateLimit-Limit", String(max));
    c.header("X-RateLimit-Remaining", String(result.remaining));
    c.header("X-RateLimit-Reset", String(Math.ceil(result.resetAt / 1000)));

    if (!result.allowed) {
      c.header("Retry-After", String(Math.ceil(result.retryAfterMs / 1000)));
      return c.json(
        {
          error: opts.message ?? "Too many requests. Please try again later.",
          retryAfterMs: result.retryAfterMs,
        },
        429
      );
    }

    await next();
  };
}
