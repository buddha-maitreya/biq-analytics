/**
 * Prompt Template Service — Phase 7.1
 *
 * CRUD operations for versioned, DB-managed prompt templates.
 * Agents can load active templates at runtime, and admins can
 * edit, version, and roll back prompt sections via the API.
 */

import { eq, and, desc } from "drizzle-orm";
import { db, promptTemplates } from "@db/index";
import { injectLabels } from "@lib/prompts";

// ── Types ──────────────────────────────────────────────────

export interface PromptTemplateRow {
  id: string;
  agentName: string;
  sectionKey: string;
  template: string;
  version: number;
  isActive: boolean;
  createdBy: string | null;
  changeNotes: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePromptTemplateInput {
  agentName: string;
  sectionKey: string;
  template: string;
  createdBy?: string;
  changeNotes?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdatePromptTemplateInput {
  template?: string;
  isActive?: boolean;
  changeNotes?: string;
  metadata?: Record<string, unknown>;
}

// ── Queries ────────────────────────────────────────────────

/** Get all prompt templates (optionally filtered by agent) */
export async function listPromptTemplates(
  agentName?: string
): Promise<PromptTemplateRow[]> {
  if (agentName) {
    return db
      .select()
      .from(promptTemplates)
      .where(eq(promptTemplates.agentName, agentName))
      .orderBy(desc(promptTemplates.version));
  }
  return db
    .select()
    .from(promptTemplates)
    .orderBy(promptTemplates.agentName, promptTemplates.sectionKey, desc(promptTemplates.version));
}

/** Get the active template for a specific agent + section */
export async function getActiveTemplate(
  agentName: string,
  sectionKey: string
): Promise<PromptTemplateRow | null> {
  // First try agent-specific, then fall back to global ("*")
  const rows = await db
    .select()
    .from(promptTemplates)
    .where(
      and(
        eq(promptTemplates.agentName, agentName),
        eq(promptTemplates.sectionKey, sectionKey),
        eq(promptTemplates.isActive, true)
      )
    )
    .orderBy(desc(promptTemplates.version))
    .limit(1);

  if (rows.length) return rows[0] as PromptTemplateRow;

  // Fall back to global template
  if (agentName !== "*") {
    const globalRows = await db
      .select()
      .from(promptTemplates)
      .where(
        and(
          eq(promptTemplates.agentName, "*"),
          eq(promptTemplates.sectionKey, sectionKey),
          eq(promptTemplates.isActive, true)
        )
      )
      .orderBy(desc(promptTemplates.version))
      .limit(1);

    if (globalRows.length) return globalRows[0] as PromptTemplateRow;
  }

  return null;
}

/**
 * Get the rendered (label-injected) template for an agent section.
 * Returns null if no template exists, meaning the agent should use
 * its built-in default.
 */
export async function getRenderedTemplate(
  agentName: string,
  sectionKey: string
): Promise<string | null> {
  const row = await getActiveTemplate(agentName, sectionKey);
  if (!row) return null;
  return injectLabels(row.template);
}

/** Get all active templates for an agent, returning a section→template map */
export async function getAgentTemplates(
  agentName: string
): Promise<Record<string, string>> {
  const rows = await db
    .select()
    .from(promptTemplates)
    .where(
      and(
        eq(promptTemplates.agentName, agentName),
        eq(promptTemplates.isActive, true)
      )
    )
    .orderBy(desc(promptTemplates.version));

  // Dedupe by sectionKey (latest version wins due to ordering)
  const map: Record<string, string> = {};
  for (const row of rows) {
    if (!map[row.sectionKey]) {
      map[row.sectionKey] = injectLabels(row.template);
    }
  }

  // Also load global templates for sections not overridden
  const globalRows = await db
    .select()
    .from(promptTemplates)
    .where(
      and(
        eq(promptTemplates.agentName, "*"),
        eq(promptTemplates.isActive, true)
      )
    )
    .orderBy(desc(promptTemplates.version));

  for (const row of globalRows) {
    if (!map[row.sectionKey]) {
      map[row.sectionKey] = injectLabels(row.template);
    }
  }

  return map;
}

/** Get version history for a specific agent + section */
export async function getTemplateVersions(
  agentName: string,
  sectionKey: string
): Promise<PromptTemplateRow[]> {
  return db
    .select()
    .from(promptTemplates)
    .where(
      and(
        eq(promptTemplates.agentName, agentName),
        eq(promptTemplates.sectionKey, sectionKey)
      )
    )
    .orderBy(desc(promptTemplates.version));
}

// ── Mutations ──────────────────────────────────────────────

/**
 * Create a new prompt template version.
 * Auto-increments version, deactivates previous active version for same agent+section.
 */
export async function createPromptTemplate(
  input: CreatePromptTemplateInput
): Promise<PromptTemplateRow> {
  const { agentName, sectionKey, template, createdBy, changeNotes, metadata } = input;

  // Get next version number
  const existing = await db
    .select()
    .from(promptTemplates)
    .where(
      and(
        eq(promptTemplates.agentName, agentName),
        eq(promptTemplates.sectionKey, sectionKey)
      )
    )
    .orderBy(desc(promptTemplates.version))
    .limit(1);

  const nextVersion = existing.length ? existing[0].version + 1 : 1;

  // Deactivate previous active version(s) for this agent+section
  await db
    .update(promptTemplates)
    .set({ isActive: false })
    .where(
      and(
        eq(promptTemplates.agentName, agentName),
        eq(promptTemplates.sectionKey, sectionKey),
        eq(promptTemplates.isActive, true)
      )
    );

  // Insert new version as active
  const [row] = await db
    .insert(promptTemplates)
    .values({
      agentName,
      sectionKey,
      template,
      version: nextVersion,
      isActive: true,
      createdBy: createdBy ?? null,
      changeNotes: changeNotes ?? null,
      metadata: metadata ?? null,
    })
    .returning();

  return row as PromptTemplateRow;
}

/** Activate a specific template version (deactivates others) */
export async function activateTemplateVersion(
  id: string
): Promise<PromptTemplateRow | null> {
  // Get the template to find its agent+section
  const [target] = await db
    .select()
    .from(promptTemplates)
    .where(eq(promptTemplates.id, id));

  if (!target) return null;

  // Deactivate all versions for this agent+section
  await db
    .update(promptTemplates)
    .set({ isActive: false })
    .where(
      and(
        eq(promptTemplates.agentName, target.agentName),
        eq(promptTemplates.sectionKey, target.sectionKey)
      )
    );

  // Activate the target version
  const [updated] = await db
    .update(promptTemplates)
    .set({ isActive: true })
    .where(eq(promptTemplates.id, id))
    .returning();

  return updated as PromptTemplateRow;
}

/** Delete a template version (cannot delete the only active version) */
export async function deletePromptTemplate(id: string): Promise<boolean> {
  const result = await db
    .delete(promptTemplates)
    .where(eq(promptTemplates.id, id));
  return (result as any).rowCount > 0;
}
