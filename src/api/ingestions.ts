/**
 * Document Ingestion API routes.
 *
 * Exposes the document_ingestions staging pipeline to the UI:
 *   GET  /api/ingestions          — List ingestions (filter by status, mode)
 *   GET  /api/ingestions/:id      — Get single ingestion with line items
 *   POST /api/ingestions/:id/commit  — Commit (approve) a staged ingestion
 *   POST /api/ingestions/:id/reject  — Reject a staged ingestion
 */

import { createRouter } from "@agentuity/runtime";
import { errorMiddleware } from "@lib/errors";
import { sessionMiddleware, type AppUser as AuthUser } from "@lib/auth";
import {
  listIngestions,
  getIngestion,
  commitIngestion,
  rejectIngestion,
} from "@services/document-ingestion";

const router = createRouter();
router.use(errorMiddleware());
router.use(sessionMiddleware());

/** List ingestions with optional filters */
router.get("/ingestions", async (c) => {
  const status = c.req.query("status") || undefined;
  const mode = c.req.query("mode") || undefined;
  const limit = c.req.query("limit") ? parseInt(c.req.query("limit")!) : undefined;
  const result = await listIngestions({ status, mode, limit });
  return c.json({ data: result });
});

/** Get a single ingestion with all line items */
router.get("/ingestions/:id", async (c) => {
  const ingestion = await getIngestion(c.req.param("id"));
  return c.json({ data: ingestion });
});

/** Commit (approve) a staged ingestion — writes to target tables */
router.post("/ingestions/:id/commit", async (c) => {
  const auth = c.get("appUser" as any) as AuthUser;
  const body = await c.req.json().catch(() => ({}));
  const result = await commitIngestion(
    c.req.param("id"),
    auth.id,
    body.reviewNotes
  );
  return c.json({ data: result });
});

/** Reject a staged ingestion */
router.post("/ingestions/:id/reject", async (c) => {
  const auth = c.get("appUser" as any) as AuthUser;
  const body = await c.req.json().catch(() => ({}));
  const result = await rejectIngestion(
    c.req.param("id"),
    auth.id,
    body.reviewNotes
  );
  return c.json({ data: result });
});

export default router;
