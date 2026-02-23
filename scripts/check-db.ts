import { db, closeDb } from "../src/db/index";
import { sql } from "drizzle-orm";

// 0. Show all tables in the database
const tables = await db.execute(sql`
  SELECT table_name,
         (SELECT count(*)::int FROM information_schema.columns c
          WHERE c.table_name = t.table_name AND c.table_schema = 'public') as columns
  FROM information_schema.tables t
  WHERE t.table_schema = 'public'
  ORDER BY table_name
`);
const tableRows: any[] = (tables as any).rows ?? tables;
console.log("=== All tables in database ===");
console.log(`Total: ${tableRows.length} tables\n`);
console.table(tableRows);

// 1. Check legacy users
const legacy = await db.execute(sql`SELECT id, email, name, role, is_active FROM users ORDER BY role`);
const legacyRows: any[] = (legacy as any).rows ?? legacy;
console.log("=== Legacy users table ===");
console.log("Count:", legacyRows.length);
for (const u of legacyRows) {
  console.log(`  ${u.role} - ${u.email} - ${u.name}${u.is_active ? "" : " (INACTIVE)"}`);
}

// 2. Check BetterAuth user table
const ba = await db.execute(sql`SELECT id, email, name FROM "user" ORDER BY email`);
const baRows: any[] = (ba as any).rows ?? ba;
console.log("\n=== BetterAuth user table ===");
console.log("Count:", baRows.length);
for (const u of baRows) {
  console.log(`  ${u.email} - ${u.name}`);
}

// 3. Check BetterAuth organization
const orgs = await db.execute(sql`SELECT id, name, slug FROM "organization"`);
const orgRows: any[] = (orgs as any).rows ?? orgs;
console.log("\n=== BetterAuth organization table ===");
console.log("Count:", orgRows.length);
for (const o of orgRows) {
  console.log(`  ${o.name} (${o.slug}) - ${o.id}`);
}

// 4. Check BetterAuth members
const members = await db.execute(sql`SELECT m.id, m.role, u.email FROM "member" m JOIN "user" u ON m."userId" = u.id`);
const memberRows: any[] = (members as any).rows ?? members;
console.log("\n=== BetterAuth member table ===");
console.log("Count:", memberRows.length);
for (const m of memberRows) {
  console.log(`  ${m.email} - role: ${m.role}`);
}

await closeDb();
