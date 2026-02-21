/**
 * SQL Safety Tests — validates read-only SQL enforcement
 */
import { describe, expect, test } from "bun:test";
import { validateReadOnlySQL } from "../src/lib/sql-safety";

describe("validateReadOnlySQL", () => {
  test("allows basic SELECT queries", () => {
    expect(validateReadOnlySQL("SELECT * FROM products")).toEqual({ safe: true });
    expect(validateReadOnlySQL("SELECT id, name FROM categories WHERE id = 1")).toEqual({ safe: true });
  });

  test("allows WITH (CTE) queries", () => {
    expect(validateReadOnlySQL("WITH cte AS (SELECT 1) SELECT * FROM cte")).toEqual({ safe: true });
  });

  test("rejects DROP statements", () => {
    const result = validateReadOnlySQL("DROP TABLE products");
    expect(result.safe).toBe(false);
  });

  test("rejects DELETE statements", () => {
    const result = validateReadOnlySQL("DELETE FROM products WHERE id = 1");
    expect(result.safe).toBe(false);
  });

  test("rejects INSERT statements", () => {
    const result = validateReadOnlySQL("INSERT INTO products (name) VALUES ('test')");
    expect(result.safe).toBe(false);
  });

  test("rejects UPDATE statements", () => {
    const result = validateReadOnlySQL("UPDATE products SET name = 'x' WHERE id = 1");
    expect(result.safe).toBe(false);
  });

  test("rejects ALTER statements", () => {
    const result = validateReadOnlySQL("ALTER TABLE products ADD COLUMN foo TEXT");
    expect(result.safe).toBe(false);
  });

  test("rejects TRUNCATE statements", () => {
    const result = validateReadOnlySQL("TRUNCATE TABLE products");
    expect(result.safe).toBe(false);
  });

  test("rejects GRANT/REVOKE", () => {
    expect(validateReadOnlySQL("GRANT ALL ON products TO public").safe).toBe(false);
    expect(validateReadOnlySQL("REVOKE ALL ON products FROM public").safe).toBe(false);
  });

  test("allows destructive keywords inside string literals", () => {
    // "DROP ZONE" is a value, not a SQL keyword
    expect(validateReadOnlySQL("SELECT * FROM products WHERE name = 'DROP ZONE'")).toEqual({ safe: true });
    expect(validateReadOnlySQL("SELECT * FROM products WHERE desc = 'DELETE ME'")).toEqual({ safe: true });
  });

  test("rejects non-SELECT/WITH starting queries", () => {
    const result = validateReadOnlySQL("EXPLAIN SELECT 1");
    expect(result.safe).toBe(false);
  });

  test("handles whitespace-padded queries", () => {
    expect(validateReadOnlySQL("  SELECT 1  ")).toEqual({ safe: true });
  });

  test("rejects SELECT with embedded destructive subquery", () => {
    // This looks like SELECT but has DROP inside a non-string context
    const result = validateReadOnlySQL("SELECT 1; DROP TABLE products");
    expect(result.safe).toBe(false);
  });
});
