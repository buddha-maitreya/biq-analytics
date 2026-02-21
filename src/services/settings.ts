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
};

/** Get a single setting by key */
export async function getSetting(key: string): Promise<string> {
  const row = await db.query.businessSettings.findFirst({
    where: eq(businessSettings.key, key),
  });
  return row?.value ?? DEFAULTS[key] ?? "";
}

/** Get all settings as a key-value map */
export async function getAllSettings(): Promise<Record<string, string>> {
  const rows = await db.query.businessSettings.findMany();
  const map: Record<string, string> = { ...DEFAULTS };
  for (const row of rows) {
    map[row.key] = row.value;
  }
  return map;
}

/** Update one or more settings (upsert) */
export async function updateSettings(
  updates: Record<string, string>
): Promise<Record<string, string>> {
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

/** Get only AI-related settings (used by agents at request time) */
export async function getAISettings(): Promise<AISettings> {
  const all = await getAllSettings();
  const ai: Record<string, string> = {};
  for (const key of AI_KEYS) {
    ai[key] = all[key] ?? "";
  }
  return ai as AISettings;
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
