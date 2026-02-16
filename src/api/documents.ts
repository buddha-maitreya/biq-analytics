import { createRouter } from "@agentuity/runtime";
import { toAppError } from "@lib/errors";
import { chunkDocument } from "@lib/chunker";
import knowledgeBase from "@agent/knowledge-base";

/**
 * Document management routes for the Admin Console.
 *
 * Handles file upload, chunking, and ingestion into the
 * knowledge-base vector store via the RAG agent.
 */

const router = createRouter();

/** Upload and ingest a document into the knowledge base */
router.post("/admin/documents", async (c) => {
  try {
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
      return c.json(
        { error: "content, title, and filename are required", code: "VALIDATION_ERROR" },
        400
      );
    }

    // Chunk the document
    const chunks = chunkDocument(content, filename, title, category, chunkSize, overlap);

    if (chunks.length === 0) {
      return c.json(
        { error: "Document is empty after processing", code: "VALIDATION_ERROR" },
        400
      );
    }

    // Send to knowledge-base agent for vector ingestion
    const result = await knowledgeBase.run({
      action: "ingest",
      documents: chunks,
    });

    c.var.logger.info(
      `Document uploaded: "${title}" (${filename}) — ${chunks.length} chunks`
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
      201
    );
  } catch (err) {
    const e = toAppError(err);
    return c.json({ error: e.message, code: e.code }, e.statusCode as any);
  }
});

/** List documents in the knowledge base */
router.get("/admin/documents", async (c) => {
  try {
    const result = await knowledgeBase.run({ action: "list" });
    return c.json({ data: result.documents ?? [] });
  } catch (err) {
    const e = toAppError(err);
    return c.json({ error: e.message, code: e.code }, e.statusCode as any);
  }
});

/** Delete a document (and all its chunks) from the knowledge base */
router.delete("/admin/documents/:filename", async (c) => {
  try {
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

    c.var.logger.info(`Document deleted: ${filename}`);
    return c.json({ deleted: true, filename, chunksRemoved: keys.length });
  } catch (err) {
    const e = toAppError(err);
    return c.json({ error: e.message, code: e.code }, e.statusCode as any);
  }
});

/** Query the knowledge base (proxies to RAG agent) */
router.post("/admin/documents/query", async (c) => {
  try {
    const { question } = await c.req.json();

    if (!question) {
      return c.json(
        { error: "question is required", code: "VALIDATION_ERROR" },
        400
      );
    }

    const result = await knowledgeBase.run({ action: "query", question });
    return c.json({ data: result });
  } catch (err) {
    const e = toAppError(err);
    return c.json({ error: e.message, code: e.code }, e.statusCode as any);
  }
});

export default router;
