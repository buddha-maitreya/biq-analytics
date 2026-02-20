import { createRouter, validator } from "@agentuity/runtime";
import { errorMiddleware, ValidationError } from "@lib/errors";
import { authMiddleware } from "@services/auth";
import { uploadDocumentSchema, queryDocumentSchema } from "@lib/validation";
import { chunkDocument } from "@lib/chunker";
import knowledgeBase from "@agent/knowledge-base";
import {
  storeDocument,
  deleteDocument,
  getDocumentDownloadUrl,
} from "@services/document-storage";

/**
 * Document management routes for the Admin Console.
 *
 * Handles file upload, chunking, and ingestion into the
 * knowledge-base vector store via the RAG agent.
 *
 * Uses errorMiddleware() — thrown errors are automatically
 * caught and returned as structured JSON.
 */

const router = createRouter();
router.use(errorMiddleware());
router.use(authMiddleware());

/** Upload and ingest a document into the knowledge base */
router.post("/admin/documents", validator({ input: uploadDocumentSchema }), async (c) => {
  const body = c.req.valid("json");

  const {
    content,
    title,
    filename,
    category = "general",
    chunkSize = 1000,
    overlap = 200,
  } = body;

  // Chunk the document
  const chunks = chunkDocument(content, filename, title, category, chunkSize, overlap);

  if (chunks.length === 0) {
    throw new ValidationError("Document is empty after processing");
  }

  // Send to knowledge-base agent for vector ingestion
  const result = await knowledgeBase.run({
    action: "ingest",
    documents: chunks,
  });

  // Phase 6.4: Store original document in S3 (background, non-blocking)
  const waitUntil = (c as any).waitUntil ?? ((fn: () => Promise<void>) => fn().catch(() => {}));
  waitUntil(async () => {
    try {
      await storeDocument(content, filename, title, category);
    } catch {
      // S3 storage is optional — vector ingestion is the primary path
    }
  });

  (c.var as any).logger?.info(
    `Document uploaded: "${title}" (${filename}) — ${chunks.length} chunks`,
  );

  return c.json(
    {
      data: {
        filename,
        title,
        category,
        chunks: chunks.length,
        ingested: result.ingested,
      },
    },
    201,
  );
});

/** List documents in the knowledge base */
router.get("/admin/documents", async (c) => {
  const result = await knowledgeBase.run({ action: "list" });
  return c.json({ data: result.documents ?? [] });
});

/** Delete a document (and all its chunks) from the knowledge base */
router.delete("/admin/documents/:filename", async (c) => {
  const filename = c.req.param("filename");

  // First list to find all chunk keys for this file
  const listResult = await knowledgeBase.run({ action: "list" });
  const docs = (listResult.documents ?? []) as Array<{ key: string; filename: string }>;

  // Find keys that match this filename pattern
  const keys = docs
    .filter((d) => d.filename === filename)
    .map((d) => d.key);

  // Also generate potential chunk keys (files are keyed as filename-0, filename-1, etc.)
  if (keys.length === 0) {
    for (let i = 0; i < 100; i++) {
      keys.push(`${filename}-${i}`);
    }
  }

  if (keys.length > 0) {
    await knowledgeBase.run({ action: "delete", keys });
  }

  // Phase 6.4: Delete original from S3 (best-effort)
  await deleteDocument(filename, "general").catch(() => {});

  (c.var as any).logger?.info(`Document deleted: ${filename}`);
  return c.json({ deleted: true, filename, chunksRemoved: keys.length });
});

/**
 * GET /admin/documents/:filename/download — Get a presigned download URL.
 * Phase 6.4: Returns a temporary S3 URL for downloading the original document.
 * Query params: category? (default "general")
 */
router.get("/admin/documents/:filename/download", async (c) => {
  const filename = c.req.param("filename");
  const category = c.req.query("category") ?? "general";

  const url = await getDocumentDownloadUrl(filename, category);
  if (!url) {
    return c.json(
      { error: "Document not found in storage or S3 not configured" },
      404
    );
  }

  return c.json({ data: { url, filename, expiresIn: "1 hour" } });
});

/** Query the knowledge base (proxies to RAG agent) */
router.post("/admin/documents/query", validator({ input: queryDocumentSchema }), async (c) => {
  const { question } = c.req.valid("json");

  const result = await knowledgeBase.run({ action: "query", question });
  return c.json({ data: result });
});

export default router;
