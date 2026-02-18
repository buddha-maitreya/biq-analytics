import { createAgent } from "@agentuity/runtime";
import { generateText } from "ai";
import { z } from "zod";
import { config } from "@lib/config";
import { getModel } from "@lib/ai";

/**
 * Knowledge Base Agent — "The Librarian"
 *
 * Unique specialty: DOCUMENT RETRIEVAL & RAG.
 *
 * This agent manages the company's document knowledge base using vector
 * search. It retrieves relevant chunks from uploaded business documents
 * and uses an LLM to synthesize accurate, cited answers.
 *
 * Vs. other agents:
 *   - insights-analyzer (The Analyst): Computes statistics in sandbox
 *   - report-generator (The Writer): Narrates data into professional reports
 *   - knowledge-base (The Librarian): Retrieves from uploaded documents
 *
 * Use cases:
 *   - "What's our return policy?"
 *   - "How do we handle bulk orders?"
 *   - "Summarize our vendor agreement with Acme Corp"
 *   - "What are the safety data sheet requirements for chemical X?"
 */

interface DocMetadata {
  [key: string]: unknown;
  title: string;
  filename: string;
  category: string;
  uploadedAt: string;
  chunkIndex: number;
}

const VECTOR_NAMESPACE = "knowledge-base";

const inputSchema = z.object({
  action: z.enum(["query", "ingest", "delete", "list"]),
  /** For "query" — the user's question */
  question: z.string().optional(),
  /** For "ingest" — documents to index */
  documents: z
    .array(
      z.object({
        key: z.string(),
        content: z.string(),
        title: z.string(),
        filename: z.string(),
        category: z.string().default("general"),
        chunkIndex: z.number().int().default(0),
      })
    )
    .optional(),
  /** For "delete" — document keys to remove */
  keys: z.array(z.string()).optional(),
});

const outputSchema = z.object({
  answer: z.string().optional(),
  sources: z.array(z.string()).optional(),
  ingested: z.number().optional(),
  deleted: z.number().optional(),
  documents: z.array(z.unknown()).optional(),
  success: z.boolean(),
});

export default createAgent("knowledge-base", {
  schema: { input: inputSchema, output: outputSchema },
  handler: async (ctx, input) => {
    switch (input.action) {
      // ─── RAG Query ──────────────────────────────────────────
      case "query": {
        if (!input.question) {
          return { success: false, answer: "No question provided." };
        }

        const results = await ctx.vector.search<DocMetadata>(
          VECTOR_NAMESPACE,
          {
            query: input.question,
            limit: 5,
            similarity: 0.65,
          }
        );

        if (results.length === 0) {
          return {
            success: true,
            answer:
              "I couldn't find relevant information in the knowledge base. Try uploading related documents in the Admin Console.",
            sources: [],
          };
        }

        // Build context from retrieved chunks.
        // search() returns VectorSearchResult (no document field).
        // Use getMany() to fetch full documents with their content.
        const keys = results.map((r) => r.key);
        const fullDocs = await ctx.vector.getMany<DocMetadata>(
          VECTOR_NAMESPACE,
          ...keys,
        );

        const contextChunks = results.map((r, i) => {
          const fullDoc = fullDocs.get(r.key);
          const meta = r.metadata;
          const title = meta?.title ?? "Unknown";
          const filename = meta?.filename ?? "";
          const content = fullDoc?.document ?? "";
          return `[Source ${i + 1}: ${title} (${filename})]\n${content}`;
        });
        const context = contextChunks.join("\n\n---\n\n");

        const sources = results
          .map((r) => r.metadata?.title ?? r.key)
          .filter((v, i, a) => a.indexOf(v) === i); // dedupe

        const { text } = await generateText({
          model: await getModel(),
          system: `You are ${config.companyName}'s knowledge base assistant.
Answer the question using ONLY the provided context from uploaded documents.
If the context doesn't contain enough information, say so — never make things up.
Cite which source(s) you used in your answer.
Be concise and professional.`,
          prompt: `Question: ${input.question}

Context from knowledge base:
${context}`,
        });

        ctx.logger.info(
          `RAG query: "${input.question.slice(0, 60)}..." — ${results.length} chunks retrieved`
        );

        return { success: true, answer: text, sources };
      }

      // ─── Ingest Documents ───────────────────────────────────
      case "ingest": {
        if (!input.documents?.length) {
          return { success: false, answer: "No documents provided." };
        }

        const upsertParams = input.documents.map((doc) => ({
          key: doc.key,
          document: doc.content,
          metadata: {
            title: doc.title,
            filename: doc.filename,
            category: doc.category,
            uploadedAt: new Date().toISOString(),
            chunkIndex: doc.chunkIndex,
          } satisfies DocMetadata,
          ttl: null as unknown as number, // never expire
        }));

        await ctx.vector.upsert(VECTOR_NAMESPACE, ...upsertParams);

        ctx.logger.info(
          `Ingested ${input.documents.length} document chunks into knowledge base`
        );

        return { success: true, ingested: input.documents.length };
      }

      // ─── Delete Documents ───────────────────────────────────
      case "delete": {
        if (!input.keys?.length) {
          return { success: false, answer: "No keys provided." };
        }

        await ctx.vector.delete(VECTOR_NAMESPACE, ...input.keys);

        ctx.logger.info(
          `Deleted ${input.keys.length} documents from knowledge base`
        );

        return { success: true, deleted: input.keys.length };
      }

      // ─── List Documents (metadata only) ─────────────────────
      case "list": {
        // Search with a broad query to list recent documents
        const results = await ctx.vector.search<DocMetadata>(
          VECTOR_NAMESPACE,
          {
            query: "*",
            limit: 100,
          }
        );

        // Deduplicate by filename (chunks share the same filename)
        const seen = new Map<string, DocMetadata & { key: string }>();
        for (const r of results) {
          const filename = r.metadata?.filename ?? r.key;
          if (!seen.has(filename)) {
            seen.set(filename, {
              key: r.key,
              title: r.metadata?.title ?? "Unknown",
              filename,
              category: r.metadata?.category ?? "general",
              uploadedAt: r.metadata?.uploadedAt ?? "",
              chunkIndex: 0,
            });
          }
        }

        return {
          success: true,
          documents: Array.from(seen.values()),
        };
      }
    }
  },
});
