/**
 * Fix Drizzle migrations journal in the database.
 *
 * Problem: Tables were originally created via `drizzle-kit push`, not `migrate`.
 * The DB's __drizzle_migrations table is empty/missing entries, so `migrate`
 * tries to re-run old migrations (which fail because tables already exist).
 *
 * Solution: Insert records for all prior migrations (idx 0-4) so that only
 * the new migration (0005_flaky_ultragirl) gets applied on next `migrate`.
 */
import { db, closeDb } from "../src/db/index";
import { sql } from "drizzle-orm";

// Step 1: Check if __drizzle_migrations table exists
const checkTable = await db.execute(sql`
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = '__drizzle_migrations'
  ) as exists
`);
const tableRows: any[] = (checkTable as any).rows ?? checkTable;
const tableExists = tableRows[0]?.exists;
console.log(`__drizzle_migrations table exists: ${tableExists}`);

if (!tableExists) {
  console.log("Creating __drizzle_migrations table...");
  await db.execute(sql`
    CREATE TABLE "__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);
  console.log("Created.");
}

// Step 2: Show current entries
const current = await db.execute(sql`SELECT id, hash, created_at FROM "__drizzle_migrations" ORDER BY id`);
const currentRows: any[] = (current as any).rows ?? current;
console.log(`\nCurrent migration entries: ${currentRows.length}`);
for (const r of currentRows) {
  console.log(`  id=${r.id} hash=${r.hash} created_at=${r.created_at}`);
}

// Step 3: Define the migrations that should be marked as already applied
// These match the journal entries (idx 0-4) from _journal.json
const priorMigrations = [
  { hash: "0000_cuddly_amazoness", created_at: 1771444449203 },
  { hash: "0005_add_all_remaining_tables", created_at: 1771444449300 },
  { hash: "0006_add_approval_workflows", created_at: 1771444449400 },
  { hash: "0003_useful_mathemanic", created_at: 1771654050963 },
  { hash: "0004_melted_medusa", created_at: 1771787075433 },
];

// Step 4: Insert missing entries
let inserted = 0;
for (const m of priorMigrations) {
  // Check if already exists
  const exists = await db.execute(
    sql`SELECT 1 FROM "__drizzle_migrations" WHERE hash = ${m.hash}`
  );
  const existsRows: any[] = (exists as any).rows ?? exists;
  if (existsRows.length > 0) {
    console.log(`  SKIP (already exists): ${m.hash}`);
    continue;
  }
  await db.execute(
    sql`INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (${m.hash}, ${m.created_at})`
  );
  console.log(`  INSERTED: ${m.hash}`);
  inserted++;
}

console.log(`\nInserted ${inserted} migration records.`);

// Step 5: Verify final state
const final = await db.execute(sql`SELECT id, hash, created_at FROM "__drizzle_migrations" ORDER BY id`);
const finalRows: any[] = (final as any).rows ?? final;
console.log(`\nFinal migration entries: ${finalRows.length}`);
for (const r of finalRows) {
  console.log(`  id=${r.id} hash=${r.hash} created_at=${r.created_at}`);
}

console.log("\nDone. You can now run: bunx drizzle-kit migrate");
await closeDb();
