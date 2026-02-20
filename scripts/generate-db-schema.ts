/**
 * Build-time DB Schema Generator
 *
 * Introspects the Drizzle schema definitions and generates a compact
 * schema description string for LLM prompt injection. The output file
 * includes a content hash so agents can detect when caches should be
 * invalidated after schema changes.
 *
 * Usage: bun scripts/generate-db-schema.ts
 *
 * This replaces the manually-maintained DB_SCHEMA constant with an
 * auto-generated version that is always in sync with the Drizzle
 * definitions in src/db/schema.ts.
 */

import { getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "../src/db/schema";

// ── Discover all pgTable exports ────────────────────────────

interface ColumnInfo {
  name: string;
  type: string;
  notNull: boolean;
  primaryKey: boolean;
}

interface ForeignKeyInfo {
  columns: string[];
  foreignTable: string;
  foreignColumns: string[];
}

interface TableInfo {
  name: string;
  columns: ColumnInfo[];
  foreignKeys: ForeignKeyInfo[];
}

function getColumnType(col: any): string {
  const dt = col.dataType as string;
  const colType = col.columnType as string;

  // Map Drizzle column types to concise SQL types
  if (colType?.includes("PgUUID")) return "uuid";
  if (colType?.includes("PgVarchar")) {
    const len = col.length;
    return len ? `varchar(${len})` : "varchar";
  }
  if (colType?.includes("PgText")) return "text";
  if (colType?.includes("PgInteger")) return "int";
  if (colType?.includes("PgNumeric")) return "numeric";
  if (colType?.includes("PgBoolean")) return "boolean";
  if (colType?.includes("PgTimestamp")) return "timestamptz";
  if (colType?.includes("PgJsonb")) return "jsonb";

  // Fallbacks by dataType
  if (dt === "string") return "varchar";
  if (dt === "number") return "int";
  if (dt === "boolean") return "boolean";
  if (dt === "json") return "jsonb";
  if (dt === "date") return "timestamptz";
  if (dt === "bigint") return "bigint";

  return dt || "unknown";
}

function introspectTable(table: any): TableInfo {
  const config = getTableConfig(table);

  const columns: ColumnInfo[] = config.columns.map((col: any) => ({
    name: col.name,
    type: getColumnType(col),
    notNull: col.notNull ?? false,
    primaryKey: col.primary ?? false,
  }));

  const foreignKeys: ForeignKeyInfo[] = config.foreignKeys.map((fk: any) => {
    const ref = fk.reference();
    return {
      columns: ref.columns.map((c: any) => c.name),
      foreignTable: getTableConfig(ref.foreignTable).name,
      foreignColumns: ref.foreignColumns.map((c: any) => c.name),
    };
  });

  return {
    name: config.name,
    columns,
    foreignKeys,
  };
}

// ── Build compact schema string ─────────────────────────────

function buildSchemaString(tables: TableInfo[]): string {
  const lines: string[] = ["PostgreSQL database schema:", "", "Tables:"];

  for (const table of tables) {
    // Build column list: name type [FK->target]
    const colParts = table.columns.map((col) => {
      let part = `${col.name} ${col.type}`;
      // Find FK for this column
      const fk = table.foreignKeys.find((f) => f.columns.includes(col.name));
      if (fk) {
        part += ` FK->${fk.foreignTable}`;
      }
      return part;
    });

    lines.push(`- ${table.name}(${colParts.join(", ")})`);
  }

  // Extract key relationships
  lines.push("", "Key relationships:");
  for (const table of tables) {
    for (const fk of table.foreignKeys) {
      const colStr = fk.columns.join(", ");
      const refStr = `${fk.foreignTable}.${fk.foreignColumns.join(", ")}`;
      lines.push(`- ${table.name}.${colStr} -> ${refStr}`);
    }
  }

  lines.push(
    "",
    "SQL DIALECT: PostgreSQL. Use INTERVAL, ILIKE, STRING_AGG, EXTRACT, date_trunc, etc. NEVER MySQL syntax."
  );

  return lines.join("\n");
}

// ── Generate hash ───────────────────────────────────────────

function hashString(str: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(str);
  return hasher.digest("hex").slice(0, 16); // 16-char prefix is sufficient
}

// ── Main ────────────────────────────────────────────────────

// Collect all pgTable exports from schema
const tableExports: Array<{ key: string; table: any }> = [];
for (const [key, value] of Object.entries(schema)) {
  // pgTable objects have a Symbol-based structure; check for the
  // standard drizzle table shape
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    // Drizzle tables have a Symbol(drizzle:Name) property
    Object.getOwnPropertySymbols(value).length > 0
  ) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tbl = value as Parameters<typeof getTableConfig>[0];
      const config = getTableConfig(tbl);
      if (config && config.name && config.columns?.length > 0) {
        tableExports.push({ key, table: value });
      }
    } catch {
      // Not a table — skip (e.g. relations object)
    }
  }
}

// Sort tables in a logical order (core → dependent)
const tableOrder = [
  "categories",
  "products",
  "warehouses",
  "inventory",
  "inventoryTransactions",
  "customers",
  "orderStatuses",
  "orders",
  "orderItems",
  "invoices",
  "payments",
  "users",
  "auditLog",
  "notifications",
  "businessSettings",
  "taxRules",
  "customTools",
  "assetCategories",
  "assets",
  "serviceCategories",
  "services",
  "serviceBookings",
  "bookingAssets",
  "bookingStockAllocations",
  "chatSessions",
  "chatMessages",
  "agentConfigs",
];

const sorted = tableOrder
  .map((name) => tableExports.find((t) => t.key === name))
  .filter(Boolean) as Array<{ key: string; table: any }>;

// Add any tables not in the explicit order
for (const t of tableExports) {
  if (!sorted.find((s) => s.key === t.key)) {
    sorted.push(t);
  }
}

const tableInfos = sorted.map((t) => introspectTable(t.table));
const schemaString = buildSchemaString(tableInfos);
const schemaHash = hashString(schemaString);

// ── Write output file ───────────────────────────────────────

const output = `/**
 * Database Schema Reference — AUTO-GENERATED
 *
 * Generated from Drizzle schema definitions in src/db/schema.ts.
 * DO NOT EDIT MANUALLY — run: bun scripts/generate-db-schema.ts
 *
 * Schema hash: ${schemaHash}
 * Generated at: ${new Date().toISOString()}
 */

/**
 * Schema content hash — changes when the schema structure changes.
 * Use this for cache invalidation in agents and KV storage.
 */
export const DB_SCHEMA_HASH = "${schemaHash}" as const;

/**
 * Compact schema description for LLM prompt injection.
 * Includes table names, column names/types, foreign keys, and SQL dialect hints.
 */
export const DB_SCHEMA = \`${schemaString}\` as const;
`;

const outputPath = new URL("../src/lib/db-schema.ts", import.meta.url).pathname;
// On Windows, Bun.write handles the path; normalize for cross-platform
const normalizedPath = outputPath.startsWith("/") && process.platform === "win32"
  ? outputPath.slice(1) // Remove leading slash on Windows
  : outputPath;

await Bun.write(normalizedPath, output);

console.log(`✓ Generated src/lib/db-schema.ts`);
console.log(`  Tables: ${tableInfos.length}`);
console.log(`  Schema hash: ${schemaHash}`);
console.log(`  Total columns: ${tableInfos.reduce((s, t) => s + t.columns.length, 0)}`);
`;

