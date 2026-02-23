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
import * as objectStorage from "@services/object-storage";

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

// ── In-memory attachment cache (fallback when S3 is unavailable) ──
// When S3 is not configured (common in Agentuity deployments), files
// are stored in memory with a 2-hour TTL. This allows the scanner
// agent to access uploaded files via a local download endpoint.

interface TempAttachment {
  buffer: Uint8Array;
  contentType: string;
  filename: string;
  expiresAt: number;
}

/** In-memory attachment cache — maps attachmentId → file data */
export const tempAttachmentCache = new Map<string, TempAttachment>();

/** Clean expired entries from the temp cache */
function cleanTempAttachmentCache() {
  const now = Date.now();
  for (const [key, val] of tempAttachmentCache) {
    if (val.expiresAt < now) tempAttachmentCache.delete(key);
  }
}

/** TTL for temp attachments: 2 hours */
const TEMP_ATTACHMENT_TTL = 2 * 60 * 60 * 1000;

// ── Routes ─────────────────────────────────────────────────

/**
 * POST /chat/sessions/:sessionId/attachments — Upload a file.
 *
 * Expects multipart/form-data with a "file" field.
 * Returns the attachment metadata with a presigned download URL.
 */
attachments.post("/chat/sessions/:sessionId/attachments", async (c) => {
  const sessionId = c.req.param("sessionId");
  const log = c.var.logger;
  log?.info("[UPLOAD:1] Attachment upload started", { sessionId });

  // sessionMiddleware sets c.var.appUser (AppUser object), not c.var.userId.
  // Extract .id from the appUser object for the DB insert.
  const appUser = (c as any).get("appUser");
  if (!appUser?.id) {
    log?.warn("[UPLOAD:1] No appUser — auth missing");
    return c.json({ error: "Authentication required" }, 401);
  }
  const userId = appUser.id as string;
  log?.info("[UPLOAD:2] Auth OK", { userId });

  // Parse multipart form data
  let body: Record<string, any>;
  try {
    body = await c.req.parseBody();
  } catch (parseErr: any) {
    log?.error("[UPLOAD:2] parseBody() threw", { error: parseErr?.message?.slice(0, 300) });
    return c.json({ error: `Failed to parse upload: ${parseErr?.message?.slice(0, 100)}` }, 400);
  }
  const file = body["file"];

  if (!file || typeof file === "string") {
    log?.warn("[UPLOAD:3] No file in body", { bodyKeys: Object.keys(body) });
    return c.json({ error: "No file uploaded. Send a 'file' field in multipart/form-data." }, 400);
  }

  // Validate file type
  const contentType = file.type || "application/octet-stream";
  log?.info("[UPLOAD:3] File received", { name: file.name, contentType, size: file.size });
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
  const fileData = new Uint8Array(buffer);

  // Upload to S3 with fallback to temp cache
  let downloadUrl: string;
  let storageUsed: "s3" | "temp" = "s3";
  log?.info("[UPLOAD:4] S3 available?", { s3Available: objectStorage.isAvailable() });

  if (objectStorage.isAvailable()) {
    try {
      await s3.file(s3Key).write(fileData, { type: contentType });
      downloadUrl = s3.presign(s3Key, { expiresIn: 3600 });
      log?.info("[UPLOAD:4] S3 write OK", { s3Key });
    } catch (s3Err: any) {
      log?.warn("[UPLOAD:4] S3 write failed — falling back to temp cache", { error: s3Err?.message?.slice(0, 200) });
      // S3 configured but write failed — fall back to temp cache
      storageUsed = "temp";
      tempAttachmentCache.set(attachmentId, {
        buffer: fileData,
        contentType,
        filename,
        expiresAt: Date.now() + TEMP_ATTACHMENT_TTL,
      });
      cleanTempAttachmentCache();
      downloadUrl = `/api/chat/attachments/${attachmentId}/download`;
    }
  } else {
    // S3 not configured — use temp cache
    storageUsed = "temp";
    tempAttachmentCache.set(attachmentId, {
      buffer: fileData,
      contentType,
      filename,
      expiresAt: Date.now() + TEMP_ATTACHMENT_TTL,
    });
    cleanTempAttachmentCache();
    downloadUrl = `/api/chat/attachments/${attachmentId}/download`;
  }

  // Persist metadata to DB (non-fatal — if DB table doesn't exist yet,
  // the file is still accessible via temp cache or S3)
  let saved: Record<string, any> | null = null;
  log?.info("[UPLOAD:5] Persisting to DB", { attachmentId });
  try {
    const [row] = await db
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
    saved = row;
    log?.info("[UPLOAD:5] DB insert OK", { attachmentId });
  } catch (dbErr: any) {
    // DB insert failed — file is still in S3 or temp cache
    log?.warn("[UPLOAD:5] DB insert FAILED — using temp metadata", {
      attachmentId,
      error: dbErr?.message?.slice(0, 300),
      stack: dbErr?.stack?.slice(0, 500),
    });
  }

  c.var.logger?.info("Chat attachment uploaded", {
    attachmentId,
    sessionId,
    filename,
    contentType,
    sizeBytes,
    storageUsed,
    dbPersisted: !!saved,
  });

  return c.json({
    data: {
      id: saved?.id ?? attachmentId,
      filename: saved?.filename ?? filename,
      contentType: saved?.contentType ?? contentType,
      sizeBytes: saved?.sizeBytes ?? sizeBytes,
      s3Key: saved?.s3Key ?? s3Key,
      sessionId: saved?.sessionId ?? sessionId,
      userId: saved?.userId ?? userId,
      uploadedAt: saved?.createdAt ? saved.createdAt.toISOString() : new Date().toISOString(),
      downloadUrl,
      downloadUrlExpiresIn: "1 hour",
    },
  });
});

/**
 * GET /chat/attachments/:attachmentId/download — Serve attachment from temp cache.
 * Used when S3 is unavailable — the scanner agent and frontend access files via this endpoint.
 */
attachments.get("/chat/attachments/:attachmentId/download", async (c) => {
  const attachmentId = c.req.param("attachmentId");
  const cached = tempAttachmentCache.get(attachmentId);
  if (cached && cached.expiresAt > Date.now()) {
    c.header("Content-Type", cached.contentType);
    c.header("Content-Disposition", `inline; filename="${cached.filename}"`);
    c.header("Cache-Control", "private, max-age=3600");
    c.header("Content-Length", String(cached.buffer.byteLength));
    return c.body(new Uint8Array(cached.buffer) as any);
  }
  return c.json({ error: "Attachment not found or expired" }, 404);
});

/**
 * GET /chat/attachments/:attachmentId — Get a presigned download URL.
 * Query params: expiresIn? (seconds, default 3600)
 */
attachments.get("/chat/attachments/:attachmentId", async (c) => {
  const attachmentId = c.req.param("attachmentId");

  // Check temp cache first
  const cached = tempAttachmentCache.get(attachmentId);
  if (cached && cached.expiresAt > Date.now()) {
    return c.json({
      data: {
        id: attachmentId,
        filename: cached.filename,
        contentType: cached.contentType,
        sizeBytes: cached.buffer.byteLength,
        downloadUrl: `/api/chat/attachments/${attachmentId}/download`,
        downloadUrlExpiresIn: `${Math.round((cached.expiresAt - Date.now()) / 1000)} seconds`,
      },
    });
  }

  // Fall back to DB + S3
  const [row] = await db
    .select()
    .from(attachmentsTable)
    .where(eq(attachmentsTable.id, attachmentId))
    .limit(1);

  if (!row) {
    return c.json({ error: "Attachment not found" }, 404);
  }

  const expiresIn = Number(c.req.query("expiresIn")) || 3600;

  // Try S3
  if (objectStorage.isAvailable()) {
    try {
      const exists = await s3.file(row.s3Key).exists();
      if (exists) {
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
      }
    } catch {
      // S3 failed — fall through
    }
  }

  return c.json({ error: "Attachment file not found in storage" }, 404);
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

  // Delete from temp cache if present
  tempAttachmentCache.delete(attachmentId);

  // Delete from S3
  if (objectStorage.isAvailable()) {
    try {
      await s3.file(row.s3Key).delete();
    } catch {
      // Ignore — may already be deleted or S3 unavailable
    }
  }

  // Delete from DB
  await db
    .delete(attachmentsTable)
    .where(eq(attachmentsTable.id, attachmentId));

  return c.json({ data: { success: true } });
});

export default attachments;
