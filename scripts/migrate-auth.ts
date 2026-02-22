/**
 * Auth Data Migration Script
 *
 * Migrates legacy `users` table data into BetterAuth tables:
 *   - `user`         — core identity
 *   - `account`      — credential (email+password)
 *   - `organization` — single org per deployment
 *   - `member`       — org membership with role mapping
 *
 * Run AFTER BetterAuth schema tables are created via Drizzle migrations:
 *   bunx drizzle-kit generate
 *   bunx drizzle-kit migrate
 *   bun scripts/migrate-auth.ts
 *
 * Safe to re-run — skips users already migrated (by email match).
 *
 * Role mapping:
 *   super_admin → owner
 *   admin       → admin
 *   manager     → member  (with permissions preserved in legacy table)
 *   staff       → member
 *   viewer      → member
 */

import { sql } from "drizzle-orm";

// ── Database Setup ──────────────────────────────────────────
// Use raw SQL via the Drizzle db instance since BetterAuth tables
// use text PKs (not uuid), and our Drizzle schema re-exports them
// with different names (authUser, authAccount, etc.).

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error("❌  DATABASE_URL is required. Set it in .env or environment.");
  process.exit(1);
}

// Import db from the project's database module
const { db, closeDb } = await import("../src/db/index");

// ── Config ──────────────────────────────────────────────────
const ORG_NAME = process.env.COMPANY_NAME || "Business IQ Enterprise";
const ORG_SLUG = ORG_NAME.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const DRY_RUN = process.argv.includes("--dry-run");

/** Map legacy role to BetterAuth organization role */
function mapRole(legacyRole: string): "owner" | "admin" | "member" {
  switch (legacyRole) {
    case "super_admin":
      return "owner";
    case "admin":
      return "admin";
    default:
      return "member";
  }
}

/** Generate a random text ID (BetterAuth convention: nanoid-style) */
function generateId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  const bytes = crypto.getRandomValues(new Uint8Array(21));
  for (const b of bytes) {
    id += chars[b % chars.length];
  }
  return id;
}

// ── Main ────────────────────────────────────────────────────
async function migrate() {
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║  Auth Data Migration: Legacy → BetterAuth    ║");
  console.log("╚══════════════════════════════════════════════╝");
  console.log(); 

  if (DRY_RUN) {
    console.log("🔍  DRY RUN — no database changes will be made.\n");
  }

  // 1. Fetch all active legacy users
  const legacyUsers = await db.execute<{
    id: string;
    email: string;
    name: string;
    role: string;
    hashed_password: string | null;
    is_active: boolean;
    permissions: string[] | null;
    assigned_warehouses: string[] | null;
    created_by: string | null;
    reports_to: string | null;
    created_at: Date;
    updated_at: Date;
  }>(sql`SELECT * FROM users WHERE is_active = true ORDER BY created_at ASC`);

  const users = legacyUsers.rows ?? legacyUsers;
  console.log(`📋  Found ${users.length} active legacy user(s).\n`);

  if (users.length === 0) {
    console.log("✅  Nothing to migrate.");
    return;
  }

  // 2. Check for existing BetterAuth users (skip already-migrated)
  const existingEmails = new Set<string>();
  try {
    const existing = await db.execute<{ email: string }>(
      sql`SELECT email FROM "user"`
    );
    const rows = existing.rows ?? existing;
    for (const row of rows) {
      existingEmails.add(row.email.toLowerCase());
    }
    console.log(`ℹ️  ${existingEmails.size} user(s) already in BetterAuth.\n`);
  } catch {
    // Table might not exist yet — that's fine, we'll create everything
    console.log("ℹ️  BetterAuth 'user' table is empty or not yet created.\n");
  }

  // 3. Ensure organization exists
  let orgId: string;
  try {
    const orgResult = await db.execute<{ id: string }>(
      sql`SELECT id FROM "organization" LIMIT 1`
    );
    const orgRows = orgResult.rows ?? orgResult;
    if (orgRows.length > 0) {
      orgId = orgRows[0].id;
      console.log(`🏢  Existing organization: ${orgId}`);
    } else {
      orgId = generateId();
      if (!DRY_RUN) {
        await db.execute(sql`
          INSERT INTO "organization" (id, name, slug, "createdAt")
          VALUES (${orgId}, ${ORG_NAME}, ${ORG_SLUG}, NOW())
        `);
      }
      console.log(`🏢  Created organization: ${ORG_NAME} (${orgId})`);
    }
  } catch {
    orgId = generateId();
    if (!DRY_RUN) {
      await db.execute(sql`
        INSERT INTO "organization" (id, name, slug, "createdAt")
        VALUES (${orgId}, ${ORG_NAME}, ${ORG_SLUG}, NOW())
      `);
    }
    console.log(`🏢  Created organization: ${ORG_NAME} (${orgId})`);
  }
  console.log();

  // 4. Migrate each user
  let migrated = 0;
  let skipped = 0;

  for (const legacyUser of users) {
    const email = legacyUser.email.toLowerCase();

    if (existingEmails.has(email)) {
      console.log(`  ⏭  ${email} — already migrated, skipping`);
      skipped++;
      continue;
    }

    const userId = generateId();
    const accountId = generateId();
    const memberId = generateId();
    const orgRole = mapRole(legacyUser.role);
    const now = new Date().toISOString();

    console.log(`  👤  ${email} (${legacyUser.role} → ${orgRole})`);

    if (!DRY_RUN) {
      // 4a. Create BetterAuth user
      await db.execute(sql`
        INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
        VALUES (
          ${userId},
          ${legacyUser.name},
          ${email},
          true,
          ${legacyUser.created_at.toISOString()},
          ${now}
        )
      `);

      // 4b. Create credential account (with existing bcrypt hash)
      // Note: BetterAuth's default hashing is scrypt, but bcrypt hashes
      // stored here will work if BetterAuth is configured with a custom
      // hash verifier, or users can reset passwords via BetterAuth flows.
      await db.execute(sql`
        INSERT INTO "account" (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
        VALUES (
          ${accountId},
          ${email},
          'credential',
          ${userId},
          ${legacyUser.hashed_password},
          ${legacyUser.created_at.toISOString()},
          ${now}
        )
      `);

      // 4c. Create org membership
      await db.execute(sql`
        INSERT INTO "member" (id, "organizationId", "userId", role, "createdAt")
        VALUES (
          ${memberId},
          ${orgId},
          ${userId},
          ${orgRole},
          ${now}
        )
      `);
    }

    migrated++;
  }

  console.log();
  console.log("═══════════════════════════════════════════════");
  console.log(`✅  Migration complete!`);
  console.log(`    Migrated: ${migrated}`);
  console.log(`    Skipped:  ${skipped}`);
  console.log(`    Total:    ${users.length}`);
  console.log();

  if (DRY_RUN) {
    console.log("🔍  This was a DRY RUN. Re-run without --dry-run to apply.\n");
  }

  console.log("📝  Notes:");
  console.log("    • Existing bcrypt password hashes were copied to BetterAuth accounts.");
  console.log("    • Legacy 'users' table is UNCHANGED — the compatibility middleware");
  console.log("      continues to read role/permissions from it until full cutover.");
  console.log("    • Role/permissions remain in the legacy table. BetterAuth org roles");
  console.log("      (owner/admin/member) provide coarse access control.");
  console.log("    • Fine-grained permissions are still read from legacy 'users' table.");
}

try {
  await migrate();
} catch (err) {
  console.error("❌  Migration failed:", err);
  process.exit(1);
} finally {
  try {
    await closeDb();
  } catch {
    // ignore close errors
  }
}
