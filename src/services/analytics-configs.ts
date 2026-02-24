/**
 * Analytics Configs Service
 *
 * CRUD and lookup for analytics algorithm configurations stored in
 * the `analytics_configs` table. Each deployment can tune forecast
 * horizons, anomaly sensitivity, chart colors, classification thresholds,
 * and more — all from the Admin Console.
 *
 * Ships out-of-box: every category has sensible defaults in TypeScript.
 * DB rows only store overrides. At runtime, overrides are deep-merged
 * on top of defaults so businesses only configure what they need.
 *
 * Cache: configs are cached in memory (60s TTL) since they rarely change
 * but are read on every analytics call.
 */

import { db, analyticsConfigs } from "@db/index";
import { eq, asc } from "drizzle-orm";
import { memoryCache } from "@lib/cache";
import {
  ANALYTICS_DEFAULTS,
  ANALYTICS_CATEGORIES,
  deepMerge,
  type AnalyticsCategory,
  type AnalyticsCategoryConfig,
} from "@lib/analytics-defaults";

// ── Types ──────────────────────────────────────────────────

export interface AnalyticsConfigRow {
  id: string;
  category: string;
  displayName: string;
  description: string | null;
  isEnabled: boolean;
  params: Record<string, unknown>;
  schedule: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertAnalyticsConfigInput {
  category: string;
  displayName?: string;
  description?: string | null;
  isEnabled?: boolean;
  params?: Record<string, unknown>;
  schedule?: Record<string, unknown> | null;
}

/** Merged config = defaults + DB overrides, ready for consumption */
export interface MergedAnalyticsConfig {
  category: AnalyticsCategory;
  displayName: string;
  description: string;
  isEnabled: boolean;
  params: Record<string, unknown>;
  schedule: Record<string, unknown> | null;
  /** Whether this config has been customized (has a DB row) */
  isCustomized: boolean;
}

// ── Cache ──────────────────────────────────────────────────

const CACHE_KEY_PREFIX = "analytics-config:";
const CACHE_KEY_ALL = "analytics-config:__all__";
const CACHE_TTL = 60; // seconds

/** Invalidate all analytics config caches */
export function invalidateAnalyticsConfigCache(category?: string): void {
  if (category) {
    memoryCache.invalidate(`${CACHE_KEY_PREFIX}${category}`);
  }
  memoryCache.invalidate(CACHE_KEY_ALL);
}

// ── Read ───────────────────────────────────────────────────

/**
 * Get the merged config for a single category.
 * Deep-merges DB overrides on top of TypeScript defaults.
 * Cached for 60s.
 */
export async function getAnalyticsConfig(
  category: AnalyticsCategory
): Promise<MergedAnalyticsConfig> {
  const cacheKey = `${CACHE_KEY_PREFIX}${category}`;
  const cached = memoryCache.get<MergedAnalyticsConfig>(cacheKey);
  if (cached) return cached;

  const defaults = ANALYTICS_DEFAULTS[category];
  if (!defaults) {
    throw new Error(`Unknown analytics category: ${category}`);
  }

  const [row] = await db
    .select()
    .from(analyticsConfigs)
    .where(eq(analyticsConfigs.category, category))
    .limit(1);

  const merged: MergedAnalyticsConfig = {
    category,
    displayName: (row?.displayName as string) ?? defaults.displayName,
    description: (row?.description as string) ?? defaults.description,
    isEnabled: row ? (row.isEnabled as boolean) : defaults.isEnabled,
    params: deepMerge(defaults.params, row?.params as Record<string, unknown> | null),
    schedule: row?.schedule
      ? deepMerge(
          (defaults.schedule ?? {}) as Record<string, unknown>,
          row.schedule as Record<string, unknown>
        )
      : (defaults.schedule ?? null),
    isCustomized: !!row,
  };

  memoryCache.set(cacheKey, merged, CACHE_TTL);
  return merged;
}

/**
 * Get all analytics configs (all categories), merged with defaults.
 * Returns one entry per category even if no DB row exists.
 * Cached for 60s.
 */
export async function listAnalyticsConfigs(): Promise<MergedAnalyticsConfig[]> {
  const cached = memoryCache.get<MergedAnalyticsConfig[]>(CACHE_KEY_ALL);
  if (cached) return cached;

  // Fetch all DB rows at once
  const rows = await db
    .select()
    .from(analyticsConfigs)
    .orderBy(asc(analyticsConfigs.category));

  const rowMap = new Map<string, typeof rows[number]>();
  for (const row of rows) {
    rowMap.set(row.category, row);
  }

  // Merge each category with defaults
  const result: MergedAnalyticsConfig[] = ANALYTICS_CATEGORIES.map((category) => {
    const defaults = ANALYTICS_DEFAULTS[category];
    const row = rowMap.get(category);

    return {
      category,
      displayName: (row?.displayName as string) ?? defaults.displayName,
      description: (row?.description as string) ?? defaults.description,
      isEnabled: row ? (row.isEnabled as boolean) : defaults.isEnabled,
      params: deepMerge(defaults.params, row?.params as Record<string, unknown> | null),
      schedule: row?.schedule
        ? deepMerge(
            (defaults.schedule ?? {}) as Record<string, unknown>,
            row.schedule as Record<string, unknown>
          )
        : (defaults.schedule ?? null),
      isCustomized: !!row,
    };
  });

  memoryCache.set(CACHE_KEY_ALL, result, CACHE_TTL);
  return result;
}

// ── Write ──────────────────────────────────────────────────

/**
 * Upsert analytics config for a category.
 * Only stores the fields the user has changed — defaults are not persisted.
 * Invalidates cache immediately.
 */
export async function upsertAnalyticsConfig(
  input: UpsertAnalyticsConfigInput
): Promise<MergedAnalyticsConfig> {
  const category = input.category as AnalyticsCategory;
  const defaults = ANALYTICS_DEFAULTS[category];
  if (!defaults) {
    throw new Error(`Unknown analytics category: ${category}`);
  }

  invalidateAnalyticsConfigCache(category);

  const existing = await db
    .select()
    .from(analyticsConfigs)
    .where(eq(analyticsConfigs.category, category))
    .limit(1);

  if (existing.length > 0) {
    // Update existing row
    await db
      .update(analyticsConfigs)
      .set({
        displayName: input.displayName ?? existing[0].displayName,
        description: input.description !== undefined ? input.description : existing[0].description,
        isEnabled: input.isEnabled !== undefined ? input.isEnabled : existing[0].isEnabled,
        params: input.params ?? (existing[0].params as Record<string, unknown>),
        schedule: input.schedule !== undefined ? input.schedule : existing[0].schedule,
        updatedAt: new Date(),
      })
      .where(eq(analyticsConfigs.category, category));
  } else {
    // Insert new row
    await db.insert(analyticsConfigs).values({
      category,
      displayName: input.displayName ?? defaults.displayName,
      description: input.description ?? defaults.description,
      isEnabled: input.isEnabled ?? defaults.isEnabled,
      params: input.params ?? {},
      schedule: input.schedule ?? null,
    });
  }

  // Return the merged config (fresh from DB)
  return getAnalyticsConfig(category);
}

/**
 * Reset a category to defaults by deleting its DB row.
 * Next read will return pure defaults.
 */
export async function resetAnalyticsConfig(
  category: AnalyticsCategory
): Promise<MergedAnalyticsConfig> {
  if (!ANALYTICS_DEFAULTS[category]) {
    throw new Error(`Unknown analytics category: ${category}`);
  }

  invalidateAnalyticsConfigCache(category);

  await db
    .delete(analyticsConfigs)
    .where(eq(analyticsConfigs.category, category));

  return getAnalyticsConfig(category);
}

/**
 * Seed all default categories (idempotent — skips existing rows).
 * Called on first load or when seeding a new deployment.
 */
export async function seedAnalyticsDefaults(): Promise<void> {
  for (const category of ANALYTICS_CATEGORIES) {
    const existing = await db
      .select({ id: analyticsConfigs.id })
      .from(analyticsConfigs)
      .where(eq(analyticsConfigs.category, category))
      .limit(1);

    if (existing.length === 0) {
      const defaults = ANALYTICS_DEFAULTS[category];
      await db.insert(analyticsConfigs).values({
        category,
        displayName: defaults.displayName,
        description: defaults.description,
        isEnabled: defaults.isEnabled,
        params: defaults.params,
        schedule: defaults.schedule ?? null,
      });
    }
  }
}

// ── Quick Accessors (for agents) ───────────────────────────

/** Check if a category is enabled (cached) */
export async function isCategoryEnabled(category: AnalyticsCategory): Promise<boolean> {
  const config = await getAnalyticsConfig(category);
  return config.isEnabled;
}

/** Get params for a specific category, typed and merged */
export async function getCategoryParams<T extends Record<string, unknown>>(
  category: AnalyticsCategory
): Promise<T> {
  const config = await getAnalyticsConfig(category);
  return config.params as T;
}

/** Re-export categories and types for convenience */
export { ANALYTICS_CATEGORIES, type AnalyticsCategory } from "@lib/analytics-defaults";
