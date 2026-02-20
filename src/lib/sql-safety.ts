/**
 * SQL Safety Validation — shared utility for all agents that execute
 * LLM-generated SQL queries.
 *
 * Single source of truth for SQL safety checks. All agents import this
 * instead of duplicating the validation logic.
 */

/** Keywords that indicate destructive SQL operations */
const DESTRUCTIVE_KEYWORDS = [
  "DROP",
  "DELETE",
  "INSERT",
  "UPDATE",
  "ALTER",
  "TRUNCATE",
  "GRANT",
  "REVOKE",
  "CREATE",
] as const;

/**
 * Validate that a SQL query is read-only (SELECT or WITH only).
 *
 * - Strips string literals before checking for destructive keywords
 *   so that `SELECT * WHERE name = 'DROP ZONE'` passes safely.
 * - Allows WITH (CTEs) as well as SELECT.
 *
 * @param query - Raw SQL query string
 * @returns `{ safe: true }` or `{ safe: false, reason: string }`
 */
export function validateReadOnlySQL(
  query: string
): { safe: true } | { safe: false; reason: string } {
  const trimmed = query.trim();
  const upper = trimmed.toUpperCase();

  if (!upper.startsWith("SELECT") && !upper.startsWith("WITH")) {
    return {
      safe: false,
      reason: "Only SELECT and WITH (CTE) queries are allowed.",
    };
  }

  // Strip string literals to avoid false positives
  const withoutStrings = trimmed.replace(/'[^']*'/g, "''");

  for (const keyword of DESTRUCTIVE_KEYWORDS) {
    const pattern = new RegExp(`\\b${keyword}\\b`, "i");
    if (pattern.test(withoutStrings)) {
      return {
        safe: false,
        reason: `Destructive keyword "${keyword}" detected. Only read-only queries are allowed.`,
      };
    }
  }

  return { safe: true };
}
