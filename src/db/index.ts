import { createPostgresDrizzle } from "@agentuity/drizzle";
import * as schema from "./schema";

/**
 * Drizzle ORM database instance.
 * Uses @agentuity/drizzle which wraps @agentuity/postgres.
 * DATABASE_URL is auto-injected by Agentuity.
 */
export const db = createPostgresDrizzle({ schema });

export type Database = typeof db;
export * from "./schema";
