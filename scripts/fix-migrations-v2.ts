/**
 * Fix Drizzle migrations journal — v2.
 *
 * drizzle-kit's `migrate` hashes the SQL file CONTENT (sha256),
 * not the tag name. We must compute the real hashes and insert them.
 */
import { db, closeDb } from "../src/db/index";
import { sql } from "drizzle-orm";
import { createHash } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";

const migrationsDir = join(import.meta.dir, "..", "src", "db", "migrations");

// The prior migrations that are already in the DB (tables exist)
// and should NOT be re-run. These are journal entries idx 0-4.
const priorTags = [
  "0000_cuddly_amazoness",
  "0005_add_all_remaining_tables",
  "0006_add_approval_workflows",
  "0003_useful_mathemanic",
  "0004_melted_medusa",
];

// Step 1: Clean up old bad entries (tag names, not hashes)
console.log("Cleaning up old incorrect entries...");
await db.execute(sql`DELETE FROM "__drizzle_migrations"`);
console.log("Cleared __drizzle_migrations table.\n");

// Step 2: Compute real content hashes and insert
for (const tag of priorTags) {
  const filePath = join(migrationsDir, `${tag}.sql`);
  const content = readFileSync(filePath, "utf-8");
  const hash = createHash("sha256").update(content).digest("hex");

  await db.execute(
    sql`INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (${hash}, ${Date.now()})`
  );
  console.log(`INSERTED: ${tag}`);
  console.log(`  hash: ${hash.substring(0, 16)}...`);
}

// Step 3: Verify
const final = await db.execute(sql`SELECT id, hash, created_at FROM "__drizzle_migrations" ORDER BY id`);
const finalRows: any[] = (final as any).rows ?? final;
console.log(`\nFinal entries: ${finalRows.length}`);
for (const r of finalRows) {
  console.log(`  id=${r.id} hash=${String(r.hash).substring(0, 16)}... created_at=${r.created_at}`);
}

// Step 4: Show which migration file should be applied next
const newTag = "0005_flaky_ultragirl";
const newContent = readFileSync(join(migrationsDir, `${newTag}.sql`), "utf-8");
const newHash = createHash("sha256").update(newContent).digest("hex");
console.log(`\nNew migration that WILL be applied: ${newTag}`);
console.log(`  hash: ${newHash.substring(0, 16)}...`);

console.log("\nDone. Run: bunx drizzle-kit migrate");
await closeDb();
