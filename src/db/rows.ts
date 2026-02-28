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
