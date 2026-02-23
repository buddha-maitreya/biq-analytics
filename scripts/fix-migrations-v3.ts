/**
 * Fix Drizzle migrations — v3 (CORRECT approach).
 *
 * Findings from reading drizzle-orm source code:
 *
 * 1. The migrations table is `drizzle.__drizzle_migrations` (schema = "drizzle"),
 *    NOT `public.__drizzle_migrations`.
 *
 * 2. The migrate() function gets ONLY the last row by `created_at DESC LIMIT 1`.
 *    It then runs every migration whose `folderMillis` (= journal `when` field)
 *    is GREATER than that last `created_at`.
 *
 * 3. Hash = SHA-256 of the .sql file content (stored for reference, not used
 *    for matching).
 *
 * Fix: Insert one row with `created_at` = the `when` of the last previously-applied
 * migration (idx 4 = 0004_melted_medusa, when = 1771787075433). This makes the
 * migrator skip all entries with `when` <= that value and only run 0005_flaky_ultragirl
 * (when = 1771836809987).
 */
import { db, closeDb } from "../src/db/index";
import { sql } from "drizzle-orm";

// Step 1: Clean up the wrong table we created in public schema
console.log("Dropping public.__drizzle_migrations (created by mistake)...");
await db.execute(sql`DROP TABLE IF EXISTS public."__drizzle_migrations"`);
console.log("Done.\n");

// Step 2: Create drizzle schema + migrations table (same as drizzle-kit does)
console.log("Creating drizzle schema and migrations table...");
await db.execute(sql`CREATE SCHEMA IF NOT EXISTS drizzle`);
await db.execute(sql`
  CREATE TABLE IF NOT EXISTS drizzle."__drizzle_migrations" (
    id SERIAL PRIMARY KEY,
    hash text NOT NULL,
    created_at bigint
  )
`);
console.log("Done.\n");

// Step 3: Check existing entries
const existing = await db.execute(
  sql`SELECT id, hash, created_at FROM drizzle."__drizzle_migrations" ORDER BY created_at DESC`
);
const existingRows: any[] = (existing as any).rows ?? existing;
console.log(`Existing entries: ${existingRows.length}`);
for (const r of existingRows) {
  console.log(`  id=${r.id} hash=${String(r.hash).substring(0, 16)}... created_at=${r.created_at}`);
}

if (existingRows.length > 0) {
  const lastCreatedAt = Number(existingRows[0].created_at);
  console.log(`\nLast created_at = ${lastCreatedAt}`);
  if (lastCreatedAt >= 1771787075433) {
    console.log("Already has an entry at or after the last old migration. Checking if fix is needed...");
    if (lastCreatedAt >= 1771836809987) {
      console.log("WARNING: Last entry is >= the new migration timestamp. The new migration may be skipped too.");
    } else {
      console.log("Looks correct — new migration (0005_flaky_ultragirl) should apply.");
      await closeDb();
      process.exit(0);
    }
  }
}

// Step 4: We need entries for each of the 5 old migrations.
// The migrate() function only checks the LAST one, but let's be thorough
// and insert all 5 with their actual `when` values.
const oldMigrations = [
  { when: 1771444449203, tag: "0000_cuddly_amazoness" },
  { when: 1771444449300, tag: "0005_add_all_remaining_tables" },
  { when: 1771444449400, tag: "0006_add_approval_workflows" },
  { when: 1771654050963, tag: "0003_useful_mathemanic" },
  { when: 1771787075433, tag: "0004_melted_medusa" },
];

// Compute hashes the same way drizzle does (SHA-256 of file content)
const { createHash } = await import("crypto");
const { readFileSync } = await import("fs");
const { join } = await import("path");
const migrationsDir = join(import.meta.dir, "..", "src", "db", "migrations");

console.log("\nInserting migration records into drizzle.__drizzle_migrations...");
for (const m of oldMigrations) {
  const content = readFileSync(join(migrationsDir, `${m.tag}.sql`), "utf-8");
  const hash = createHash("sha256").update(content).digest("hex");
  await db.execute(
    sql`INSERT INTO drizzle."__drizzle_migrations" (hash, created_at) VALUES (${hash}, ${m.when})`
  );
  console.log(`  INSERTED: ${m.tag} (created_at=${m.when}, hash=${hash.substring(0, 16)}...)`);
}

// Step 5: Verify
const final = await db.execute(
  sql`SELECT id, hash, created_at FROM drizzle."__drizzle_migrations" ORDER BY created_at`
);
const finalRows: any[] = (final as any).rows ?? final;
console.log(`\nFinal entries: ${finalRows.length}`);
for (const r of finalRows) {
  console.log(`  id=${r.id} created_at=${r.created_at} hash=${String(r.hash).substring(0, 16)}...`);
}

// Step 6: Explain what will happen next
console.log("\n--- What happens on next `bunx drizzle-kit migrate` ---");
console.log(`Last created_at in DB: 1771787075433 (0004_melted_medusa)`);
console.log(`New migration when:    1771836809987 (0005_flaky_ultragirl)`);
console.log(`Since 1771836809987 > 1771787075433, drizzle WILL apply it.`);
console.log(`All older migrations will be SKIPPED (their when <= last created_at).`);
console.log("\nRun: bunx drizzle-kit migrate");

await closeDb();
