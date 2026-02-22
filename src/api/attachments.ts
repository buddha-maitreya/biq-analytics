/**
 * Chat Attachments — file upload, S3 storage, and linking to chat messages.
 *
 * Phase 6.4: Users can attach files (images, PDFs, CSVs, etc.) to chat
 * sessions. Files are uploaded to S3 object storage with presigned
 * download URLs. Attachment metadata is stored in the chat_messages
 * metadata JSONB column.
 *
 * Routes:
 *   POST /chat/sessions/:id/attachments — Upload a file (multipart)
 *   GET  /chat/attachments/:attachmentId — Get presigned download URL
 *   GET  /chat/sessions/:id/attachments  — List attachments for a session
 *
 * S3 key structure:
 *   chat-attachments/{sessionId}/{attachmentId}-{sanitizedFilename}
 */

import { createRouter } from "@agentuity/runtime";
import { s3 } from "bun";
import { errorMiddleware } from "@lib/errors";
import { db, attachments as attachmentsTable } from "@db/index";
import { eq, and } from "drizzle-orm";

const attachments = createRouter();
attachments.use(errorMiddleware());
// NOTE: sessionMiddleware is already applied by chat.ts (which mounts this
// router) via chat.use("/chat/*", sessionMiddleware()). Adding it again here
// would double-execute auth checks. We rely on the parent middleware.

// ── Types ──────────────────────────────────────────────────

export interface AttachmentMeta {
  /** Unique attachment ID */
  id: string;
  /** Original filename */
  filename: string;
  /** MIME content type */
  contentType: string;
  /** File size in bytes */
  sizeBytes: number;
  /** S3 object key */
  s3Key: string;
  /** Session it belongs to */
  sessionId: string;
  /** Uploader user ID */
  userId: string;
  /** ISO timestamp */
  uploadedAt: string;
}

// ── Constants ──────────────────────────────────────────────

const S3_PREFIX = "chat-attachments";

/** Max file size: 10 MB */
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/** Allowed MIME types */
const ALLOWED_TYPES = new Set([
  // Images
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  // Documents
  "application/pdf",
  "text/csv",
  "text/plain",
  "application/json",
  "text/markdown",
  // Spreadsheets
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
]);

// ── Helpers ────────────────────────────────────────────────

/** Sanitize filename for S3 key */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_{2,}/g, "_")
    .slice(0, 100);
}

/** Build S3 key for an attachment */
function attachmentS3Key(
  sessionId: string,
  attachmentId: string,
  filename: string
): string {
  return `${S3_PREFIX}/${sessionId}/${attachmentId}-${sanitizeFilename(filename)}`;
}

// ── In-memory attachment index ─────────────────────────────
// Attachment metadata is persisted to the `attachments` DB table.
// Files are stored in S3 — DB holds the metadata for lookup and listing.

// ── Routes ─────────────────────────────────────────────────

/**
 * POST /chat/sessions/:sessionId/attachments — Upload a file.
 *
 * Expects multipart/form-data with a "file" field.
 * Returns the attachment metadata with a presigned download URL.
 */
attachments.post("/chat/sessions/:sessionId/attachments", async (c) => {
  const sessionId = c.req.param("sessionId");
  // sessionMiddleware sets c.var.appUser (AppUser object), not c.var.userId.
  // Extract .id from the appUser object for the DB insert.
  const appUser = (c as any).get("appUser");
  if (!appUser?.id) {
    return c.json({ error: "Authentication required" }, 401);
  }
  const userId = appUser.id as string;

  // Parse multipart form data
  const body = await c.req.parseBody();
  const file = body["file"];

  if (!file || typeof file === "string") {
    return c.json({ error: "No file uploaded. Send a 'file' field in multipart/form-data." }, 400);
  }

  // Validate file type
  const contentType = file.type || "application/octet-stream";
  if (!ALLOWED_TYPES.has(contentType)) {
    return c.json(
      {
        error: `File type "${contentType}" not allowed. Allowed: ${[...ALLOWED_TYPES].join(", ")}`,
      },
      400
    );
  }

  // Read file content
  const buffer = await file.arrayBuffer();
  const sizeBytes = buffer.byteLength;

  // Validate file size
  if (sizeBytes > MAX_FILE_SIZE) {
    return c.json(
      {
        error: `File too large (${(sizeBytes / 1024 / 1024).toFixed(1)} MB). Max: ${MAX_FILE_SIZE / 1024 / 1024} MB.`,
      },
      400
    );
  }

  const attachmentId = crypto.randomUUID();
  const filename = file.name || "attachment";
  const s3Key = attachmentS3Key(sessionId, attachmentId, filename);

  // Upload to S3
  await s3.file(s3Key).write(new Uint8Array(buffer), { type: contentType });

  // Generate presigned download URL (1h)
  const downloadUrl = s3.presign(s3Key, { expiresIn: 3600 });

  // Persist metadata to DB
  const [saved] = await db
    .insert(attachmentsTable)
    .values({
      id: attachmentId,
      sessionId,
      userId,
      filename,
      contentType,
      sizeBytes,
      s3Key,
    })
    .returning();

  c.var.logger?.info("Chat attachment uploaded", {
    attachmentId,
    sessionId,
    filename,
    contentType,
    sizeBytes,
  });

  return c.json({
    data: {
      id: saved.id,
      filename: saved.filename,
      contentType: saved.contentType,
      sizeBytes: saved.sizeBytes,
      s3Key: saved.s3Key,
      sessionId: saved.sessionId,
      userId: saved.userId,
      uploadedAt: saved.createdAt.toISOString(),
      downloadUrl,
      downloadUrlExpiresIn: "1 hour",
    },
  });
});

/**
 * GET /chat/attachments/:attachmentId — Get a presigned download URL.
 * Query params: expiresIn? (seconds, default 3600)
 */
attachments.get("/chat/attachments/:attachmentId", async (c) => {
  const attachmentId = c.req.param("attachmentId");

  const [row] = await db
    .select()
    .from(attachmentsTable)
    .where(eq(attachmentsTable.id, attachmentId))
    .limit(1);

  if (!row) {
    return c.json({ error: "Attachment not found" }, 404);
  }

  const expiresIn = Number(c.req.query("expiresIn")) || 3600;
  const exists = await s3.file(row.s3Key).exists();
  if (!exists) {
    return c.json({ error: "Attachment file not found in storage" }, 404);
  }

  const downloadUrl = s3.presign(row.s3Key, { expiresIn });

  return c.json({
    data: {
      id: row.id,
      filename: row.filename,
      contentType: row.contentType,
      sizeBytes: row.sizeBytes,
      sessionId: row.sessionId,
      downloadUrl,
      downloadUrlExpiresIn: `${expiresIn} seconds`,
    },
  });
});

/**
 * GET /chat/sessions/:sessionId/attachments — List attachments for a session.
 */
attachments.get("/chat/sessions/:sessionId/attachments", async (c) => {
  const sessionId = c.req.param("sessionId");

  const rows = await db
    .select()
    .from(attachmentsTable)
    .where(eq(attachmentsTable.sessionId, sessionId));

  return c.json({ data: rows });
});

/**
 * DELETE /chat/attachments/:attachmentId — Delete an attachment.
 */
attachments.delete("/chat/attachments/:attachmentId", async (c) => {
  const attachmentId = c.req.param("attachmentId");

  const [row] = await db
    .select()
    .from(attachmentsTable)
    .where(eq(attachmentsTable.id, attachmentId))
    .limit(1);

  if (!row) {
    return c.json({ error: "Attachment not found" }, 404);
  }

  // Delete from S3
  try {
    await s3.file(row.s3Key).delete();
  } catch {
    // Ignore — may already be deleted
  }

  // Delete from DB
  await db
    .delete(attachmentsTable)
    .where(eq(attachmentsTable.id, attachmentId));

  return c.json({ data: { success: true } });
});

export default attachments;
