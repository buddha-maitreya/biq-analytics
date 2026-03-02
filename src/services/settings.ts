import { db, businessSettings } from "@db/index";
import { eq } from "drizzle-orm";

/** Default settings for a new deployment */
const DEFAULTS: Record<string, string> = {
  businessName: "",
  businessLogoUrl: "",
  businessTagline: "",
  primaryColor: "#3b82f6",

  // ── Industry ──────────────────────────────────────────────
  /** Industry vertical (e.g. Hospitality, Retail, Agriculture). Drives prompt templates. */
  industry: "",
  /** Sub-industry within the vertical (e.g. Tourism, Fashion, Dairy). Drives prompt templates. */
  subIndustry: "",

  // ── Localization ──────────────────────────────────────────
  /** Currency code (e.g. USD, KES, EUR). Falls back to env CURRENCY. */
  currency: "",
  /** IANA timezone (e.g. Africa/Nairobi, America/New_York). Falls back to env TIMEZONE. */
  timezone: "",

  // ── Rate Limits ───────────────────────────────────────────
  /** Max chat messages per user per minute */
  rateLimitChat: "30",
  /** Max scan requests per user per minute */
  rateLimitScan: "20",
  /** Max report generations per user per minute */
  rateLimitReport: "10",
  /** Max webhook events per source per minute */
  rateLimitWebhook: "100",
  /** Max custom tool invocations per user per 24h */
  rateLimitToolDaily: "100",

  // ── Automation Engine ─────────────────────────────────────
  /** Master switch for the scheduler cron engine. When "false", the
   *  platform-managed cron tick still fires (unavoidable) but returns
   *  immediately without checking for due schedules — zero work done. */
  schedulerEnabled: "false",
  approvalsPolling: "disabled",

  // ── AI Configuration ──────────────────────────────────────
  // These control how the AI assistant behaves for this deployment.
  // All are optional — sensible defaults are used when empty.
  // Modeled after ElevenLabs-style agent configuration for maximum flexibility.

  /** Personality — who the AI is, its role, expertise, and character traits. */
  aiPersonality: "",

  /** Environment — where/how the AI operates (interface type, user context, available capabilities). */
  aiEnvironment: "",

  /** Tone — voice and communication style (enthusiastic, professional, casual, etc.) */
  aiTone: "",

  /** Goal — the AI's primary objective and what it should help users achieve. */
  aiGoal: "",

  /** Business Context — domain knowledge (products, policies, specialties, seasonality, etc.) */
  aiBusinessContext: "",

  /** Response Formatting — how to format output (markdown, currency, lists, bold, etc.) */
  aiResponseFormatting: "",

  /** Query Reasoning — instructions for how the AI should reason before calling tools. */
  aiQueryReasoning: "",

  /** Tool Usage Guidelines — when to use which tool, priority rules. */
  aiToolGuidelines: "",

  /** Guardrails — safety rules, boundaries, escalation policies, data constraints. */
  aiGuardrails: "",

  /** Custom instructions for the insights/trends analyzer */
  aiInsightsInstructions: "",

  /** Custom instructions for report generation */
  aiReportInstructions: "",

  /** Custom greeting/welcome message for new chat sessions */
  aiWelcomeMessage: "",

  // ── AI Model Configuration ────────────────────────────────
  /** AI provider: "openai" | "anthropic" | "groq" */
  aiModelProvider: "openai",
  /** Model identifier (e.g. "gpt-4o-mini", "claude-sonnet-4-20250514") */
  aiModelName: "gpt-4o-mini",
  /** Provider API key (stored encrypted in DB) */
  aiModelApiKey: "",

  // ── Analytics Configuration ─────────────────────────────────
  /** Default number of days of historical data to analyze (used by insights agent) */
  analyticsDefaultTimeframeDays: "30",
  /** Maximum allowed timeframe in days (caps LLM-chosen values) */
  analyticsMaxTimeframeDays: "90",
  /** Default number of items to include in analysis results */
  analyticsDefaultResultLimit: "10",
  /** Maximum allowed result items */
  analyticsMaxResultLimit: "50",

  // ── Report Configuration ──────────────────────────────────
  /** Whether to include a branded title/cover page */
  reportTitlePage: "true",
  /** Whether to include a Table of Contents page */
  reportTocPage: "true",
  /** Target word count for the Executive Summary section */
  reportExecSummaryWords: "200",
  /** Maximum number of pages for generated reports */
  reportMaxPages: "20",
  /** Maximum word count for the entire report */
  reportMaxWords: "5000",
  /** Whether to include a References section at the end */
  reportReferencesPage: "true",
  /** Whether to include data visualizations (charts/graphs) */
  reportChartsEnabled: "true",
  /** Maximum number of data points per chart (prevents clutter) */
  reportMaxChartDataPoints: "50",
  /** Whether to show "Confidential" in the footer */
  reportConfidentialFooter: "true",
  /** Maximum number of charts per report */
  reportMaxCharts: "4",
};

/** Get a single setting by key */
export async function getSetting(key: string): Promise<string> {
  const row = await db.query.businessSettings.findFirst({
    where: eq(businessSettings.key, key),
  });
  return row?.value ?? DEFAULTS[key] ?? "";
}

let _allSettingsCache: Record<string, string> | null = null;
let _allSettingsCacheAt = 0;
const ALL_SETTINGS_TTL = 60_000;

/** Get all settings as a key-value map */
export async function getAllSettings(): Promise<Record<string, string>> {
  const now = Date.now();
  if (_allSettingsCache && now - _allSettingsCacheAt < ALL_SETTINGS_TTL) {
    return { ..._allSettingsCache };
  }
  const rows = await db.query.businessSettings.findMany();
  const map: Record<string, string> = { ...DEFAULTS };
  for (const row of rows) {
    map[row.key] = row.value;
  }
  _allSettingsCache = map;
  _allSettingsCacheAt = now;
  return { ...map };
}

/** Update one or more settings (upsert) */
export async function updateSettings(
  updates: Record<string, string>
): Promise<Record<string, string>> {
  _allSettingsCache = null; // invalidate on write
  for (const [key, value] of Object.entries(updates)) {
    const existing = await db.query.businessSettings.findFirst({
      where: eq(businessSettings.key, key),
    });

    if (existing) {
      await db
        .update(businessSettings)
        .set({ value })
        .where(eq(businessSettings.key, key));
    } else {
      await db.insert(businessSettings).values({ key, value });
    }
  }
  return getAllSettings();
}

/**
 * Industry → Sub-industry map.
 * Used by the UI for cascading dropdowns and by seed scripts
 * to generate industry-appropriate prompt templates.
 */
export const INDUSTRY_MAP: Record<string, string[]> = {
  Hospitality: ["Tourism", "Hotels & Lodging", "Restaurants & Catering", "Events & Conferences", "Travel Agencies"],
  Retail: ["Fashion & Apparel", "Electronics", "Grocery & Supermarket", "Furniture & Home", "Pharmacy", "General Merchandise"],
  "Food & Beverage": ["Restaurants", "Bars & Nightlife", "Bakeries & Confectionery", "Catering Services", "Food Processing"],
  Agriculture: ["Crop Farming", "Dairy", "Livestock", "Horticulture", "Aquaculture", "Agro-Processing"],
  Manufacturing: ["Textiles", "Food Processing", "Construction Materials", "Chemicals", "Plastics", "Metal & Engineering"],
  Healthcare: ["Hospitals & Clinics", "Pharmaceuticals", "Medical Devices", "Wellness & Fitness", "Dental", "Veterinary"],
  Education: ["Schools (K-12)", "Higher Education", "Vocational Training", "E-Learning", "Tutoring Services"],
  Technology: ["Software & SaaS", "IT Consulting", "Cybersecurity", "E-Commerce", "Fintech", "Hardware"],
  Construction: ["Residential", "Commercial", "Infrastructure", "Real Estate Development", "Interior Design"],
  Transport: ["Logistics & Freight", "Passenger Transport", "Vehicle Hire", "Courier & Delivery"],
  "Professional Services": ["Legal", "Accounting & Tax", "HR & Recruitment", "Marketing & Advertising", "Consulting"],
  "Beauty & Personal Care": ["Salons & Spas", "Cosmetics", "Barbershops", "Skincare"],
  Energy: ["Solar & Renewables", "Oil & Gas", "Utilities", "Fuel Distribution"],
  "Arts & Entertainment": ["Media & Production", "Music", "Gaming", "Sports & Recreation"],
};

/** AI setting keys */
const AI_KEYS = [
  "aiPersonality",
  "aiEnvironment",
  "aiTone",
  "aiGoal",
  "aiBusinessContext",
  "aiResponseFormatting",
  "aiQueryReasoning",
  "aiToolGuidelines",
  "aiGuardrails",
  "aiInsightsInstructions",
  "aiReportInstructions",
  "aiWelcomeMessage",
] as const;

export type AISettings = Record<(typeof AI_KEYS)[number], string>;

/** In-memory cache for AI settings */
let _aiSettingsCache: AISettings | null = null;
let _aiSettingsCacheAt = 0;
const AI_SETTINGS_TTL = 60_000; // 1 minute

/** Invalidate the AI settings cache (called when settings are saved) */
export function invalidateAISettingsCache() {
  _aiSettingsCache = null;
  _aiSettingsCacheAt = 0;
}

/** Get only AI-related settings (used by agents at request time, cached for 1 min) */
export async function getAISettings(): Promise<AISettings> {
  const now = Date.now();
  if (_aiSettingsCache && now - _aiSettingsCacheAt < AI_SETTINGS_TTL) {
    return _aiSettingsCache;
  }
  const all = await getAllSettings();
  const ai: Record<string, string> = {};
  for (const key of AI_KEYS) {
    ai[key] = all[key] ?? "";
  }
  _aiSettingsCache = ai as AISettings;
  _aiSettingsCacheAt = now;
  return _aiSettingsCache;
}

// ── Report Settings ─────────────────────────────────────────

export interface ReportSettings {
  /** Whether to include a branded title/cover page */
  titlePage: boolean;
  /** Whether to include a Table of Contents page */
  tocPage: boolean;
  /** Target word count for the Executive Summary section */
  execSummaryMaxWords: number;
  /** Maximum number of pages for generated reports */
  maxPages: number;
  /** Maximum word count for the entire report */
  maxWords: number;
  /** Whether to include a References section at the end */
  referencesPage: boolean;
  /** Whether to include data visualizations (charts/graphs) */
  chartsEnabled: boolean;
  /** Maximum number of data points per chart */
  maxChartDataPoints: number;
  /** Whether to show "Confidential" in the footer */
  confidentialFooter: boolean;
  /** Maximum number of charts per report */
  maxCharts: number;
}

/** In-memory cache for report settings */
let _reportCache: ReportSettings | null = null;
let _reportCacheAt = 0;
const REPORT_CACHE_TTL = 60_000; // 1 minute

/** Invalidate the report settings cache */
export function invalidateReportCache() {
  _reportCache = null;
  _reportCacheAt = 0;
}

/** Get report settings as parsed values (cached for 1 min) */
export async function getReportSettings(): Promise<ReportSettings> {
  const now = Date.now();
  if (_reportCache && now - _reportCacheAt < REPORT_CACHE_TTL) return _reportCache;

  const all = await getAllSettings();
  _reportCache = {
    titlePage: all.reportTitlePage !== "false",
    tocPage: all.reportTocPage !== "false",
    execSummaryMaxWords: parseInt(all.reportExecSummaryWords, 10) || 200,
    maxPages: parseInt(all.reportMaxPages, 10) || 20,
    maxWords: parseInt(all.reportMaxWords, 10) || 5000,
    referencesPage: all.reportReferencesPage !== "false",
    chartsEnabled: all.reportChartsEnabled !== "false",
    maxChartDataPoints: parseInt(all.reportMaxChartDataPoints, 10) || 50,
    confidentialFooter: all.reportConfidentialFooter !== "false",
    maxCharts: parseInt(all.reportMaxCharts, 10) || 4,
  };
  _reportCacheAt = now;
  return _reportCache;
}

/** Return default report settings (for fallback when DB is unavailable) */
export function getReportSettingsDefaults(): ReportSettings {
  return {
    titlePage: true,
    tocPage: true,
    execSummaryMaxWords: 200,
    maxPages: 20,
    maxWords: 5000,
    referencesPage: true,
    chartsEnabled: true,
    maxChartDataPoints: 50,
    confidentialFooter: true,
    maxCharts: 4,
  };
}

// ── Analytics Settings ───────────────────────────────────────

export interface AnalyticsSettings {
  /** Default number of days of historical data to analyze */
  defaultTimeframeDays: number;
  /** Maximum allowed timeframe in days (caps LLM-chosen values) */
  maxTimeframeDays: number;
  /** Default number of items to include in analysis results */
  defaultResultLimit: number;
  /** Maximum allowed result items */
  maxResultLimit: number;
}

/** In-memory cache for analytics settings */
let _analyticsCache: AnalyticsSettings | null = null;
let _analyticsCacheAt = 0;
const ANALYTICS_CACHE_TTL = 60_000; // 1 minute

/** Invalidate the analytics settings cache */
export function invalidateAnalyticsCache() {
  _analyticsCache = null;
  _analyticsCacheAt = 0;
}

/** Get analytics settings as parsed values (cached for 1 min) */
export async function getAnalyticsSettings(): Promise<AnalyticsSettings> {
  const now = Date.now();
  if (_analyticsCache && now - _analyticsCacheAt < ANALYTICS_CACHE_TTL) return _analyticsCache;

  const all = await getAllSettings();
  _analyticsCache = {
    defaultTimeframeDays: Math.max(1, Math.min(365, parseInt(all.analyticsDefaultTimeframeDays, 10) || 30)),
    maxTimeframeDays: Math.max(1, Math.min(365, parseInt(all.analyticsMaxTimeframeDays, 10) || 90)),
    defaultResultLimit: Math.max(1, Math.min(100, parseInt(all.analyticsDefaultResultLimit, 10) || 10)),
    maxResultLimit: Math.max(1, Math.min(100, parseInt(all.analyticsMaxResultLimit, 10) || 50)),
  };
  _analyticsCacheAt = now;
  return _analyticsCache;
}

/** Return default analytics settings (for fallback when DB is unavailable) */
export function getAnalyticsSettingsDefaults(): AnalyticsSettings {
  return {
    defaultTimeframeDays: 30,
    maxTimeframeDays: 90,
    defaultResultLimit: 10,
    maxResultLimit: 50,
  };
}

// ── Rate Limit Settings ─────────────────────────────────────

const RATE_LIMIT_KEYS = [
  "rateLimitChat",
  "rateLimitScan",
  "rateLimitReport",
  "rateLimitWebhook",
  "rateLimitToolDaily",
] as const;

export interface RateLimitSettings {
  /** Max chat messages per user per minute */
  rateLimitChat: number;
  /** Max scan requests per user per minute */
  rateLimitScan: number;
  /** Max report generations per user per minute */
  rateLimitReport: number;
  /** Max webhook events per source per minute */
  rateLimitWebhook: number;
  /** Max custom tool invocations per user per 24h */
  rateLimitToolDaily: number;
}

/** In-memory cache so we don't hit the DB on every request */
let _rlCache: RateLimitSettings | null = null;
let _rlCacheAt = 0;
const RL_CACHE_TTL = 60_000; // 1 minute

/** Invalidate the rate limit cache (called when settings are saved) */
export function invalidateRateLimitCache() {
  _rlCache = null;
  _rlCacheAt = 0;
}

/** Get rate limit settings as parsed numbers (cached for 1 min) */
export async function getRateLimits(): Promise<RateLimitSettings> {
  const now = Date.now();
  if (_rlCache && now - _rlCacheAt < RL_CACHE_TTL) return _rlCache;

  const all = await getAllSettings();
  _rlCache = {
    rateLimitChat: parseInt(all.rateLimitChat, 10) || 30,
    rateLimitScan: parseInt(all.rateLimitScan, 10) || 20,
    rateLimitReport: parseInt(all.rateLimitReport, 10) || 10,
    rateLimitWebhook: parseInt(all.rateLimitWebhook, 10) || 100,
    rateLimitToolDaily: parseInt(all.rateLimitToolDaily, 10) || 100,
  };
  _rlCacheAt = now;
  return _rlCache;
}

// ── Scheduler Engine Control ────────────────────────────────

/** In-memory cache for scheduler enabled flag (short TTL to pick up changes fast) */
let _schedulerEnabledCache: boolean | null = null;
let _schedulerEnabledAt = 0;
const SCHEDULER_CACHE_TTL = 30_000; // 30 seconds

/** Invalidate the scheduler enabled cache (called when toggled via admin) */
export function invalidateSchedulerCache() {
  _schedulerEnabledCache = null;
  _schedulerEnabledAt = 0;
}

/**
 * Check if the scheduler engine is enabled. Cached for 30s.
 * When disabled, the cron tick still fires (platform-managed) but
 * returns immediately without executing any schedules.
 */
export async function isSchedulerEnabled(): Promise<boolean> {
  const now = Date.now();
  if (_schedulerEnabledCache !== null && now - _schedulerEnabledAt < SCHEDULER_CACHE_TTL) {
    return _schedulerEnabledCache;
  }
  const val = await getSetting("schedulerEnabled");
  _schedulerEnabledCache = val === "true";
  _schedulerEnabledAt = now;
  return _schedulerEnabledCache;
}

/**
 * Enable or disable the scheduler engine.
 * Persists to business_settings and invalidates cache immediately.
 */
export async function setSchedulerEnabled(enabled: boolean): Promise<void> {
  await updateSettings({ schedulerEnabled: enabled ? "true" : "false" });
  invalidateSchedulerCache();
}
