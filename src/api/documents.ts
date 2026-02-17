import { createRouter } from "@agentuity/runtime";
import { errorMiddleware, ValidationError } from "@lib/errors";
import { chunkDocument } from "@lib/chunker";
import knowledgeBase from "@agent/knowledge-base";

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

/** Upload and ingest a document into the knowledge base */
router.post("/admin/documents", async (c) => {
  const body = await c.req.json();

  const {
    content,
    title,
    filename,
    category = "general",
    chunkSize = 1000,
    overlap = 200,
  } = body;

  if (!content || !title || !filename) {
    throw new ValidationError("content, title, and filename are required");
  }

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

  (c.var as any).logger?.info(`Document deleted: ${filename}`);
  return c.json({ deleted: true, filename, chunksRemoved: keys.length });
});

/** Query the knowledge base (proxies to RAG agent) */
router.post("/admin/documents/query", async (c) => {
  const { question } = await c.req.json();

  if (!question) {
    throw new ValidationError("question is required");
  }

  const result = await knowledgeBase.run({ action: "query", question });
  return c.json({ data: result });
});

export default router;
