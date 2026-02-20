/**
 * Few-Shot Examples Service — Phase 7.4
 *
 * CRUD + dynamic selection for few-shot examples.
 * Supports both DB-stored examples and vector-based semantic selection.
 */

import { eq, and, desc, sql } from "drizzle-orm";
import { db, fewShotExamples } from "@db/index";

// ── Types ──────────────────────────────────────────────────

export interface FewShotExampleRow {
  id: string;
  category: string;
  userInput: string;
  expectedBehavior: string;
  isActive: boolean;
  sortOrder: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateFewShotInput {
  category: string;
  userInput: string;
  expectedBehavior: string;
  sortOrder?: number;
  metadata?: Record<string, unknown>;
}

export interface UpdateFewShotInput {
  userInput?: string;
  expectedBehavior?: string;
  category?: string;
  isActive?: boolean;
  sortOrder?: number;
  metadata?: Record<string, unknown>;
}

// ── Queries ────────────────────────────────────────────────

/** List all examples, optionally filtered by category */
export async function listExamples(
  category?: string
): Promise<FewShotExampleRow[]> {
  if (category) {
    return db
      .select()
      .from(fewShotExamples)
      .where(eq(fewShotExamples.category, category))
      .orderBy(fewShotExamples.sortOrder, fewShotExamples.createdAt) as any;
  }
  return db
    .select()
    .from(fewShotExamples)
    .orderBy(fewShotExamples.category, fewShotExamples.sortOrder) as any;
}

/** Get active examples for a category */
export async function getActiveExamples(
  category: string
): Promise<FewShotExampleRow[]> {
  return db
    .select()
    .from(fewShotExamples)
    .where(
      and(
        eq(fewShotExamples.category, category),
        eq(fewShotExamples.isActive, true)
      )
    )
    .orderBy(fewShotExamples.sortOrder, fewShotExamples.createdAt) as any;
}

/** Get all unique categories */
export async function getCategories(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ category: fewShotExamples.category })
    .from(fewShotExamples)
    .orderBy(fewShotExamples.category);
  return rows.map((r) => r.category);
}

/**
 * Select the most relevant examples for a given user input.
 *
 * Strategy:
 * 1. First tries vector similarity search if a vector store is provided
 * 2. Falls back to keyword matching
 * 3. Always includes manually prioritized examples (low sortOrder)
 *
 * @param userInput - The current user message
 * @param category - Which category to search in
 * @param maxExamples - Maximum number of examples to return
 * @param vectorStore - Optional vector store for semantic search
 */
export async function selectRelevantExamples(
  userInput: string,
  category: string,
  maxExamples: number = 3,
  vectorStore?: {
    search: (
      query: string,
      options?: { topK?: number; metadata?: Record<string, unknown> }
    ) => Promise<
      Array<{
        id: string;
        score: number;
        metadata?: Record<string, unknown>;
      }>
    >;
  }
): Promise<FewShotExampleRow[]> {
  // Get all active examples for the category
  const allExamples = await getActiveExamples(category);
  if (allExamples.length <= maxExamples) return allExamples;

  // Strategy 1: Vector similarity if available
  if (vectorStore) {
    try {
      const results = await vectorStore.search(userInput, {
        topK: maxExamples,
        metadata: { type: "few-shot", category },
      });

      if (results.length > 0) {
        const matchedIds = new Set(results.map((r) => r.id));
        const matched = allExamples.filter((e) => matchedIds.has(e.id));
        if (matched.length > 0) return matched.slice(0, maxExamples);
      }
    } catch {
      // Fall through to keyword matching
    }
  }

  // Strategy 2: Simple keyword overlap scoring
  const inputWords = new Set(
    userInput
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3) // Ignore short words
  );

  const scored = allExamples.map((ex) => {
    const exWords = ex.userInput
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3);
    const overlap = exWords.filter((w) => inputWords.has(w)).length;
    // Prioritize manually ordered examples (low sortOrder wins)
    const sortBonus = ex.sortOrder != null ? Math.max(0, 10 - ex.sortOrder) : 0;
    return { example: ex, score: overlap + sortBonus };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxExamples).map((s) => s.example);
}

/**
 * Upsert examples into a vector store for semantic search.
 * Call this when examples are created or updated.
 */
export async function syncExamplesToVector(
  category: string,
  vectorStore: {
    upsert: (items: Array<{
      id: string;
      data: string;
      metadata: Record<string, unknown>;
    }>) => Promise<void>;
  }
): Promise<number> {
  const examples = await getActiveExamples(category);
  if (!examples.length) return 0;

  await vectorStore.upsert(
    examples.map((ex) => ({
      id: ex.id,
      data: `${ex.userInput}\n${ex.expectedBehavior}`,
      metadata: { type: "few-shot", category: ex.category },
    }))
  );

  return examples.length;
}

// ── Mutations ──────────────────────────────────────────────

/** Create a new few-shot example */
export async function createExample(
  input: CreateFewShotInput
): Promise<FewShotExampleRow> {
  const [row] = await db
    .insert(fewShotExamples)
    .values({
      category: input.category,
      userInput: input.userInput,
      expectedBehavior: input.expectedBehavior,
      sortOrder: input.sortOrder ?? 0,
      metadata: input.metadata ?? null,
    })
    .returning();

  return row as FewShotExampleRow;
}

/** Update an existing few-shot example */
export async function updateExample(
  id: string,
  input: UpdateFewShotInput
): Promise<FewShotExampleRow | null> {
  const updates: Record<string, unknown> = {};
  if (input.userInput !== undefined) updates.userInput = input.userInput;
  if (input.expectedBehavior !== undefined)
    updates.expectedBehavior = input.expectedBehavior;
  if (input.category !== undefined) updates.category = input.category;
  if (input.isActive !== undefined) updates.isActive = input.isActive;
  if (input.sortOrder !== undefined) updates.sortOrder = input.sortOrder;
  if (input.metadata !== undefined) updates.metadata = input.metadata;

  if (Object.keys(updates).length === 0) return null;

  const [row] = await db
    .update(fewShotExamples)
    .set(updates)
    .where(eq(fewShotExamples.id, id))
    .returning();

  return (row as FewShotExampleRow) ?? null;
}

/** Delete a few-shot example */
export async function deleteExample(id: string): Promise<boolean> {
  const result = await db
    .delete(fewShotExamples)
    .where(eq(fewShotExamples.id, id));
  return (result as any).rowCount > 0;
}
