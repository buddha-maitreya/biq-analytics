import { createPostgresDrizzle } from "@agentuity/drizzle";
import * as schema from "./schema";

/**
 * Drizzle ORM database instance.
 *
 * `createPostgresDrizzle({ schema })` returns `{ db, client, close }`.
 * We destructure and export `db` directly so all service/agent code
 * uses the standard Drizzle API: `db.select()`, `db.insert()`, `db.query`, etc.
 *
 * DATABASE_URL is auto-injected by Agentuity via `agentuity cloud db create`.
 */
const postgres = createPostgresDrizzle({ schema });

export const db = postgres.db;
export const closeDb = postgres.close;

export type Database = typeof db;
export * from "./schema";
