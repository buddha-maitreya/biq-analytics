/**
 * Agent Configs Service
 *
 * CRUD and lookup for per-agent configurations stored in the
 * `agent_configs` table. Each deployment can override model,
 * temperature, max steps, timeout, custom instructions, and
 * agent-specific JSON config — all from the Admin Console.
 *
 * Agents read their config at request time via `getAgentConfig(name)`
 * so changes take effect immediately without redeployment.
 */

import { db, agentConfigs } from "@db/index";
import { eq, asc } from "drizzle-orm";
import { memoryCache } from "@lib/cache";

// ── Types ──────────────────────────────────────────────────

export interface AgentConfigRow {
  id: string;
  agentName: string;
  displayName: string;
  description: string | null;
  isActive: boolean;
  modelOverride: string | null;
  temperature: string | null; // numeric comes as string from PG
  maxSteps: number | null;
  timeoutMs: number | null;
  customInstructions: string | null;
  executionPriority: number;
  config: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertAgentConfigInput {
  agentName: string;
  displayName: string;
  description?: string | null;
  isActive?: boolean;
  modelOverride?: string | null;
  temperature?: string | null;
  maxSteps?: number | null;
  timeoutMs?: number | null;
  customInstructions?: string | null;
  executionPriority?: number;
  config?: Record<string, unknown> | null;
}

/** Default seed data for when a config row doesn't exist yet */
const AGENT_DEFAULTS: Record<string, Omit<UpsertAgentConfigInput, "agentName">> = {
  "data-science": {
    displayName: "The Brain",
    description:
      "Central orchestrator — manages conversation, routes to specialists, handles ad-hoc database queries and direct analysis.",
    isActive: true,
    maxSteps: 8,
    timeoutMs: 60000,
    executionPriority: 0,
    config: { enableSandbox: true, compressionThreshold: 20 },
  },
  "insights-analyzer": {
    displayName: "The Analyst",
    description:
      "Statistical computation specialist — runs dynamically-generated code in a sandboxed environment for trend analysis, forecasting, and anomaly detection.",
    isActive: true,
    maxSteps: 5,
    timeoutMs: 45000,
    executionPriority: 1,
    config: { structuringModel: "gpt-4o-mini", sandboxMemoryMb: 256, sandboxTimeoutMs: 30000 },
  },
  "report-generator": {
    displayName: "The Writer",
    description:
      "Professional report narration — transforms raw data into polished business reports with executive summaries and recommendations.",
    isActive: true,
    maxSteps: 6,
    timeoutMs: 30000,
    executionPriority: 2,
    config: { defaultFormat: "markdown", maxSqlSteps: 6 },
  },
  "knowledge-base": {
    displayName: "The Librarian",
    description:
      "Document retrieval specialist — searches uploaded business documents via vector similarity and synthesizes cited answers.",
    isActive: true,
    maxSteps: 3,
    timeoutMs: 15000,
    executionPriority: 3,
    config: { topK: 5, similarityThreshold: 0.7 },
  },
};

/** Well-known agent names (order matters for UI) */
export const AGENT_NAMES = [
  "data-science",
  "insights-analyzer",
  "report-generator",
  "knowledge-base",
] as const;

export type AgentName = (typeof AGENT_NAMES)[number];

// ── CRUD ───────────────────────────────────────────────────

/** List all agent configs, ordered by execution priority */
export async function listAgentConfigs(): Promise<AgentConfigRow[]> {
  const rows = (await db
    .select()
    .from(agentConfigs)
    .orderBy(asc(agentConfigs.executionPriority))) as AgentConfigRow[];
  return rows;
}

/** Get config for a single agent by name. Returns defaults if no row exists. */
export async function getAgentConfig(agentName: string): Promise<AgentConfigRow | null> {
  const [row] = await db
    .select()
    .from(agentConfigs)
    .where(eq(agentConfigs.agentName, agentName))
    .limit(1);
  return (row as AgentConfigRow) ?? null;
}

/** Get config for a single agent, falling back to built-in defaults.
 *  Results are cached in-memory for 60s to avoid repeated DB lookups
 *  during a single request cycle (agents call this at setup time). */
export async function getAgentConfigWithDefaults(agentName: string): Promise<AgentConfigRow> {
  const cacheKey = `agent-config:${agentName}`;
  const cached = memoryCache.get<AgentConfigRow>(cacheKey);
  if (cached) return cached;

  const row = await getAgentConfig(agentName);
  if (row) {
    memoryCache.set(cacheKey, row, 60);
    return row;
  }

  // Return a synthetic row from defaults
  const defaults = AGENT_DEFAULTS[agentName];
  if (!defaults) {
    throw new Error(`Unknown agent: ${agentName}`);
  }
  const synthetic: AgentConfigRow = {
    id: "",
    agentName,
    displayName: defaults.displayName,
    description: defaults.description ?? null,
    isActive: defaults.isActive ?? true,
    modelOverride: null,
    temperature: null,
    maxSteps: defaults.maxSteps ?? null,
    timeoutMs: defaults.timeoutMs ?? null,
    customInstructions: null,
    executionPriority: defaults.executionPriority ?? 0,
    config: defaults.config ?? null,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  memoryCache.set(cacheKey, synthetic, 60);
  return synthetic;
}

/** Invalidate cached agent config so next read fetches fresh from DB */
export function invalidateAgentConfigCache(agentName?: string): void {
  if (agentName) {
    memoryCache.invalidate(`agent-config:${agentName}`);
  } else {
    memoryCache.invalidatePrefix("agent-config:");
  }
}

/** Upsert (insert or update) an agent config by agent_name */
export async function upsertAgentConfig(
  input: UpsertAgentConfigInput
): Promise<AgentConfigRow> {
  invalidateAgentConfigCache(input.agentName);
  const existing = await getAgentConfig(input.agentName);

  if (existing) {
    // Update
    const [updated] = await db
      .update(agentConfigs)
      .set({
        displayName: input.displayName,
        description: input.description ?? existing.description,
        isActive: input.isActive ?? existing.isActive,
        modelOverride: input.modelOverride !== undefined ? input.modelOverride : existing.modelOverride,
        temperature: input.temperature !== undefined ? input.temperature : existing.temperature,
        maxSteps: input.maxSteps !== undefined ? input.maxSteps : existing.maxSteps,
        timeoutMs: input.timeoutMs !== undefined ? input.timeoutMs : existing.timeoutMs,
        customInstructions:
          input.customInstructions !== undefined ? input.customInstructions : existing.customInstructions,
        executionPriority: input.executionPriority ?? existing.executionPriority,
        config: input.config !== undefined ? input.config : existing.config,
        updatedAt: new Date(),
      })
      .where(eq(agentConfigs.agentName, input.agentName))
      .returning();
    return updated as AgentConfigRow;
  }

  // Insert
  const defaults = AGENT_DEFAULTS[input.agentName];
  const [created] = await db
    .insert(agentConfigs)
    .values({
      agentName: input.agentName,
      displayName: input.displayName ?? defaults?.displayName ?? input.agentName,
      description: input.description ?? defaults?.description ?? null,
      isActive: input.isActive ?? defaults?.isActive ?? true,
      modelOverride: input.modelOverride ?? null,
      temperature: input.temperature ?? null,
      maxSteps: input.maxSteps ?? defaults?.maxSteps ?? null,
      timeoutMs: input.timeoutMs ?? defaults?.timeoutMs ?? null,
      customInstructions: input.customInstructions ?? null,
      executionPriority: input.executionPriority ?? defaults?.executionPriority ?? 0,
      config: input.config ?? defaults?.config ?? null,
    })
    .returning();
  return created as AgentConfigRow;
}

/** Seed all default agent configs (idempotent — skips existing rows) */
export async function seedAgentDefaults(): Promise<void> {
  for (const agentName of AGENT_NAMES) {
    const existing = await getAgentConfig(agentName);
    if (!existing) {
      const defaults = AGENT_DEFAULTS[agentName]!;
      await upsertAgentConfig({ agentName, ...defaults });
    }
  }
}

/** Delete an agent config (rarely used — prefer disabling via isActive) */
export async function deleteAgentConfig(agentName: string): Promise<boolean> {
  invalidateAgentConfigCache(agentName);
  const result = await db
    .delete(agentConfigs)
    .where(eq(agentConfigs.agentName, agentName))
    .returning({ id: agentConfigs.id });
  return result.length > 0;
}

/** Reset a single agent to its built-in defaults */
export async function resetAgentToDefaults(agentName: string): Promise<AgentConfigRow> {
  const defaults = AGENT_DEFAULTS[agentName];
  if (!defaults) throw new Error(`Unknown agent: ${agentName}`);
  // Delete existing and re-insert from defaults
  await deleteAgentConfig(agentName);
  return upsertAgentConfig({ agentName, ...defaults });
}
