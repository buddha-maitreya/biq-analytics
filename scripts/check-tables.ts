import { db, closeDb } from "../src/db/index";
import { sql } from "drizzle-orm";

const r = await db.execute(
  sql`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('attachments','document_ingestions','document_ingestion_items') ORDER BY tablename`
);
const rows: any[] = (r as any).rows ?? r;
console.log("Tables found:", rows.map((r: any) => r.tablename));

if (rows.length < 3) {
  console.log("⚠️  Missing tables! Expected 3, found", rows.length);
  console.log("Run: bunx drizzle-kit migrate");
} else {
  console.log("✅ All 3 tables exist");
}

await closeDb();
