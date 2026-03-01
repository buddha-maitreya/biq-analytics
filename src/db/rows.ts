/**
 * Runtime-safe row extractor for db.execute() results.
 *
 * Local drizzle types db.execute() as Record<string, any>[] (array).
 * Cloud drizzle types it as QueryResult<Record<string, unknown>> (has .rows).
 * At RUNTIME the cloud returns a QueryResult object, not an array.
 *
 * This function works in both environments:
 *   - If result is already an array → returns it directly
 *   - If result is a QueryResult-like object → returns .rows
 *   - Otherwise → returns empty array (safe fallback)
 */
export function dbRows(result: unknown): any[] {
  if (Array.isArray(result)) return result;
  if (result && typeof result === "object" && "rows" in result) {
    return (result as any).rows;
  }
  return [];
}

/**
 * Sanitize row values for JSON serialization.
 *
 * PostgreSQL COUNT(*) and SUM() return bigint, which JavaScript maps to
 * BigInt. BigInt cannot be serialized by JSON.stringify() — it throws
 * "TypeError: Do not know how to serialize a BigInt".
 *
 * This breaks the Vercel AI SDK's tool result serialization, causing
 * LLM tool calls to fail silently and produce reports with "N/A" values.
 *
 * Call this on rows before returning them from AI tool execute() functions.
 */
export function sanitizeRows(rows: any[]): any[] {
  return rows.map((row) => {
    if (!row || typeof row !== "object") return row;
    const clean: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(row)) {
      clean[key] = typeof val === "bigint" ? Number(val) : val;
    }
    return clean;
  });
}
