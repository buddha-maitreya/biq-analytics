/**
 * Seed Auth — Set hashed passwords for demo users
 *
 * Creates one user per role with bcrypt-hashed passwords.
 * Updates existing users if they exist (by email), inserts if missing.
 *
 * Demo credentials (all passwords: "demo2025"):
 *   super_admin  →  superadmin@safaribiq.co.ke
 *   admin        →  admin@safaribiq.co.ke
 *   manager      →  ops@safaribiq.co.ke
 *   staff        →  bookings@safaribiq.co.ke
 *   viewer       →  viewer@safaribiq.co.ke
 *
 * Usage:
 *   DATABASE_URL=<your-url> bun scripts/seed-auth.ts
 */

import { createPostgresDrizzle } from "@agentuity/drizzle";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { users } from "../src/db/schema";

const { db } = createPostgresDrizzle({ schema });

const DEMO_PASSWORD = "demo2025";

/** All permission modules */
const ALL_PERMISSIONS = [
  "dashboard",
  "products",
  "orders",
  "customers",
  "inventory",
  "invoices",
  "reports",
  "pos",
  "assistant",
  "admin",
  "settings",
];

interface DemoUser {
  email: string;
  name: string;
  role: string;
  permissions: string[];
  metadata: Record<string, unknown>;
}

const demoUsers: DemoUser[] = [
  {
    email: "superadmin@safaribiq.co.ke",
    name: "System Administrator",
    role: "super_admin",
    permissions: ALL_PERMISSIONS,
    metadata: { department: "IT", isDemo: true },
  },
  {
    email: "admin@safaribiq.co.ke",
    name: "Philip Maina",
    role: "admin",
    permissions: ALL_PERMISSIONS,
    metadata: { department: "management", isDemo: true },
  },
  {
    email: "ops@safaribiq.co.ke",
    name: "Grace Wanjiru",
    role: "manager",
    permissions: [
      "dashboard",
      "products",
      "orders",
      "customers",
      "inventory",
      "invoices",
      "reports",
      "pos",
    ],
    metadata: { department: "operations", isDemo: true },
  },
  {
    email: "bookings@safaribiq.co.ke",
    name: "James Ochieng",
    role: "staff",
    permissions: [
      "dashboard",
      "products",
      "orders",
      "customers",
      "invoices",
      "pos",
    ],
    metadata: { department: "reservations", isDemo: true },
  },
  {
    email: "viewer@safaribiq.co.ke",
    name: "Demo Viewer",
    role: "viewer",
    permissions: ["dashboard", "products", "orders", "customers", "reports"],
    metadata: { department: "stakeholders", isDemo: true },
  },
];

async function main() {
  console.log("🔐 Seeding demo user credentials...\n");
  console.log(`   Password for all demo accounts: "${DEMO_PASSWORD}"\n`);

  // Hash the shared demo password once
  const hashedPassword = await Bun.password.hash(DEMO_PASSWORD, { algorithm: "bcrypt", cost: 12 });
  console.log(`   ✓ Password hashed (Bun.password, bcrypt cost 12)\n`);

  let created = 0;
  let updated = 0;

  for (const u of demoUsers) {
    // Check if user exists
    const [existing] = await db
      .select()
      .from(users)
      .where(eq(users.email, u.email))
      .limit(1);

    if (existing) {
      // Update with hashed password + role + permissions
      await db
        .update(users)
        .set({
          hashedPassword,
          role: u.role,
          permissions: u.permissions,
          isActive: true,
          name: u.name,
        })
        .where(eq(users.id, existing.id));
      updated++;
      console.log(`   ↻ Updated: ${u.email} (${u.role})`);
    } else {
      // Insert new user
      await db.insert(users).values({
        email: u.email,
        name: u.name,
        role: u.role,
        hashedPassword,
        permissions: u.permissions,
        isActive: true,
        metadata: u.metadata,
      } as any);
      created++;
      console.log(`   + Created: ${u.email} (${u.role})`);
    }
  }

  console.log(`\n   ✓ Done — ${created} created, ${updated} updated\n`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Demo Login Credentials");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  for (const u of demoUsers) {
    console.log(`  ${u.role.padEnd(14)} ${u.email}`);
  }
  console.log(`  Password:      ${DEMO_PASSWORD}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
