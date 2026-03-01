/**
 * KV Cache Utility — typed caching helpers for Agentuity KV storage.
 *
 * Provides a consistent caching pattern for agents and routes.
 * All cache operations use Agentuity's built-in KV storage with
 * configurable TTLs and namespaces.
 *
 * Usage in agents:
 *   const cache = createCache(ctx.kv);
 *   const data = await cache.getOrSet('ns', 'key', fetchFn, { ttl: 300 });
 *
 * Usage in routes:
 *   const cache = createCache(c.var.kv);
 *   const data = await cache.getOrSet('ns', 'key', fetchFn, { ttl: 300 });
 */

import { DB_SCHEMA_HASH } from "@lib/db-schema";

// ── Types ──────────────────────────────────────────────────

/** Agentuity KV interface (subset used by cache) */
export interface KVStore {
  get<T = unknown>(namespace: string, key: string): Promise<{ exists: boolean; data?: T }>;
  set(namespace: string, key: string, data: unknown, options?: { ttl?: number | null }): Promise<void>;
  delete(namespace: string, key: string): Promise<void>;
  search(namespace: string, prefix: string): Promise<Array<{ key: string; data: unknown }>>;
}

export interface CacheOptions {
  /** TTL in seconds. Default: 300 (5 minutes). Use null for no expiration. */
  ttl?: number | null;
}

// ── Cache Namespaces ───────────────────────────────────────

/** Standard cache namespaces used across the platform */
export const CACHE_NS = {
  /** Agent config cache — short TTL, invalidated on config update */
  AGENT_CONFIG: "cache:agent-config",
  /** Business snapshot / aggregate queries — short TTL */
  QUERY: "cache:query",
  /** Analysis results — medium TTL */
  ANALYSIS: "cache:analysis",
  /** Generated reports — longer TTL */
  REPORT: "cache:report",
  /** AI model / settings cache */
  SETTINGS: "cache:settings",
} as const;

/** Standard TTL values in seconds */
export const CACHE_TTL = {
  /** Very short — 60s for volatile aggregate data */
  SHORT: 60,
  /** Default — 5 minutes for most queries */
  DEFAULT: 300,
  /** Medium — 15 minutes for analysis results */
  MEDIUM: 900,
  /** Long — 1 hour for generated reports */
  LONG: 3600,
  /** Extended — 24 hours for rarely-changing data */
  EXTENDED: 86400,
} as const;

// ── Cache Key Builders ─────────────────────────────────────

/**
 * Build a cache key that includes the schema hash for automatic
 * invalidation when the DB schema changes.
 */
export function schemaScopedKey(parts: string[]): string {
  return `s:${DB_SCHEMA_HASH}:${parts.join(":")}`;
}

/**
 * Build a cache key for analysis results.
 * Includes analysis type, timeframe, and optional product ID.
 */
export function analysisKey(analysis: string, timeframeDays: number, productId?: string): string {
  return schemaScopedKey([
    "analysis",
    analysis,
    `${timeframeDays}d`,
    productId || "all",
  ]);
}

/**
 * Build a cache key for generated reports.
 * Includes report type and date range.
 */
export function reportKey(reportType: string, startDate: string, endDate: string): string {
  return schemaScopedKey([
    "report:v5", // bumped to invalidate cached reports without mandatory charts
    reportType,
    startDate.split("T")[0],
    endDate.split("T")[0],
  ]);
}

/**
 * Build a cache key for query results.
 */
export function queryKey(queryName: string, ...params: string[]): string {
  return schemaScopedKey(["query", queryName, ...params]);
}

// ── Cache Wrapper ──────────────────────────────────────────

export function createCache(kv: KVStore) {
  return {
    /**
     * Get a value from cache, or compute and store it if missing.
     * This is the primary caching pattern — use it everywhere.
     */
    async getOrSet<T>(
      namespace: string,
      key: string,
      fetcher: () => Promise<T>,
      options?: CacheOptions
    ): Promise<T> {
      const ttl = options?.ttl ?? CACHE_TTL.DEFAULT;

      try {
        const cached = await kv.get<T>(namespace, key);
        if (cached.exists && cached.data !== undefined) {
          return cached.data;
        }
      } catch {
        // KV unavailable — fall through to fetcher
      }

      const data = await fetcher();

      // Store in background — don't block on cache write
      try {
        await kv.set(namespace, key, data, { ttl });
      } catch {
        // Cache write failed — non-critical
      }

      return data;
    },

    /** Get a cached value. Returns undefined if not found. */
    async get<T>(namespace: string, key: string): Promise<T | undefined> {
      try {
        const cached = await kv.get<T>(namespace, key);
        return cached.exists ? cached.data : undefined;
      } catch {
        return undefined;
      }
    },

    /** Set a cached value with optional TTL. */
    async set(
      namespace: string,
      key: string,
      data: unknown,
      options?: CacheOptions
    ): Promise<void> {
      try {
        await kv.set(namespace, key, data, { ttl: options?.ttl ?? CACHE_TTL.DEFAULT });
      } catch {
        // Non-critical
      }
    },

    /** Delete a cached value. */
    async invalidate(namespace: string, key: string): Promise<void> {
      try {
        await kv.delete(namespace, key);
      } catch {
        // Non-critical
      }
    },

    /** Delete all cached values matching a prefix in a namespace. */
    async invalidatePrefix(namespace: string, prefix: string): Promise<void> {
      try {
        const matches = await kv.search(namespace, prefix);
        await Promise.all(matches.map((m) => kv.delete(namespace, m.key)));
      } catch {
        // Non-critical
      }
    },
  };
}

// ── In-Memory Cache (for services without KV context) ──────

interface MemoryCacheEntry<T> {
  data: T;
  expiresAt: number;
}

const _memoryCache = new Map<string, MemoryCacheEntry<unknown>>();

/**
 * Simple in-memory cache for service-layer code that doesn't
 * have access to Agentuity KV (e.g., agent-configs service).
 *
 * Not shared across deployments — local to this process only.
 * Use short TTLs (30-120s) for data that may change.
 */
export const memoryCache = {
  get<T>(key: string): T | undefined {
    const entry = _memoryCache.get(key) as MemoryCacheEntry<T> | undefined;
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      _memoryCache.delete(key);
      return undefined;
    }
    return entry.data;
  },

  set<T>(key: string, data: T, ttlSeconds: number = 60): void {
    _memoryCache.set(key, {
      data,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  },

  invalidate(key: string): void {
    _memoryCache.delete(key);
  },

  invalidatePrefix(prefix: string): void {
    for (const key of _memoryCache.keys()) {
      if (key.startsWith(prefix)) {
        _memoryCache.delete(key);
      }
    }
  },

  clear(): void {
    _memoryCache.clear();
  },
};
