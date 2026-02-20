/**
 * Knowledge Base Agent -- "The Librarian"
 *
 * Document retrieval and RAG (Retrieval-Augmented Generation).
 * Manages the company's uploaded document knowledge base using vector
 * search, synthesizing accurate, cited answers from business documents.
 *
 * Capabilities:
 *   - query:  Semantic search + LLM synthesis with rich source citations
 *             Supports optional metadata filters (category, filename)
 *   - ingest: Accepts full documents (auto-chunked) or pre-chunked content.
 *             Maintains a KV document index for reliable listing.
 *   - delete: Remove documents by key + cleanup KV index
 *   - list:   List stored documents from KV index (not vector search)
 *
 * All runtime parameters (model, topK, threshold, temperature) are read
 * from the agent_configs DB table -- tunable per-deployment via Admin Console.
 */

import { createAgent } from "@agentuity/runtime";
import { generateText } from "ai";
import { config } from "@lib/config";
import { getModel } from "@lib/ai";
import { chunkDocument } from "@lib/chunker";
import { maskPII } from "@lib/pii";
import { validateTextOutput } from "@lib/output-validation";
import { createTokenTracker, DEFAULT_TOKEN_BUDGETS } from "@lib/tokens";
import { SpanCollector, traced } from "@lib/tracing";
import { getAgentConfigWithDefaults } from "@services/agent-configs";
import {
  DocMetadata,
  DocIndexEntry,
  SourceCitation,
  KnowledgeBaseConfig,
  VECTOR_NAMESPACE,
  DOC_INDEX_NS,
  inputSchema,
  outputSchema,
} from "./types";

// ────────────────────────────────────────────────────────────
// Agent definition
// ────────────────────────────────────────────────────────────

const agent = createAgent("knowledge-base", {
  description:
    "Document retrieval specialist -- searches uploaded business documents via vector similarity and synthesizes cited answers.",

  schema: { input: inputSchema, output: outputSchema },

  setup: async (): Promise<KnowledgeBaseConfig> => {
    const agentConfig = await getAgentConfigWithDefaults("knowledge-base");
    const cfg = (agentConfig.config ?? {}) as Record<string, unknown>;

    return {
      agentConfig,
      topK: (cfg.topK as number) ?? 5,
      similarityThreshold: (cfg.similarityThreshold as number) ?? 0.7,
      temperature: agentConfig.temperature
        ? parseFloat(agentConfig.temperature)
        : undefined,
    };
  },

  handler: async (ctx, input) => {
    // Phase 1.9: Use request-scoped state for timing metadata
    ctx.state.set("startedAt", Date.now());

    // Phase 1.10: Telemetry collector
    const collector = new SpanCollector("knowledge-base");

    const { agentConfig, topK, similarityThreshold, temperature } = ctx.config;

    switch (input.action) {
      // ─── RAG Query ────────────────────────────────────────
      case "query": {
        if (!input.question) {
          return { success: false, answer: "No question provided." };
        }

        // Build search options — include metadata filters if provided
        const searchOpts: Record<string, unknown> = {
          query: input.question,
          limit: topK,
          similarity: similarityThreshold,
        };

        // Phase 5.5: Metadata-only search via vector SDK metadata filter
        if (input.filters) {
          const metadataFilter: Record<string, unknown> = {};
          if (input.filters.category) {
            metadataFilter.category = input.filters.category;
          }
          if (input.filters.filename) {
            metadataFilter.filename = input.filters.filename;
          }
          if (Object.keys(metadataFilter).length > 0) {
            searchOpts.metadata = metadataFilter;
          }
        }

        const results = await ctx.vector.search<DocMetadata>(
          VECTOR_NAMESPACE,
          searchOpts as any
        );

        if (results.length === 0) {
          ctx.logger.info("RAG query: no results", {
            question: input.question.slice(0, 80),
            filters: input.filters,
          });
          return {
            success: true,
            answer:
              "I couldn't find relevant information in the knowledge base. Try uploading related documents in the Admin Console.",
            sources: [],
          };
        }

        // Fetch full document content for retrieved chunks
        const keys = results.map((r) => r.key);
        const fullDocs = await ctx.vector.getMany<DocMetadata>(
          VECTOR_NAMESPACE,
          ...keys
        );

        // Phase 5.5: Rich source citations with similarity scores
        const sources: SourceCitation[] = [];
        const contextChunks = results.map((r, i) => {
          const fullDoc = fullDocs.get(r.key);
          const meta = r.metadata;
          const title = meta?.title ?? "Unknown";
          const filename = meta?.filename ?? "";
          const category = meta?.category ?? "general";
          const similarity = (r as any).similarity ?? 0;
          const chunkIndex = meta?.chunkIndex ?? 0;
          const content = fullDoc?.document ?? "";

          sources.push({ title, filename, category, similarity, chunkIndex });

          return `[Source ${i + 1}: ${title} (${filename}, chunk ${chunkIndex}, similarity: ${(similarity * 100).toFixed(1)}%)]\n${content}`;
        });
        const context = contextChunks.join("\n\n---\n\n");

        // Build custom instructions from agent config
        const customSuffix = agentConfig.customInstructions?.trim()
          ? `\n\n${agentConfig.customInstructions.trim()}`
          : "";

        const { text } = await traced(
          ctx.tracer,
          collector,
          "generateText:rag-query",
          "llm",
          async () => generateText({
          model: await getModel(agentConfig.modelOverride ?? undefined),
          ...(temperature !== undefined ? { temperature } : {}),
          system: `You are ${config.companyName}'s knowledge base assistant.
Answer the question using ONLY the provided context from uploaded documents.
If the context doesn't contain enough information, say so -- never make things up.

Terminology: "${config.labels.product}" for products, "${config.labels.order}" for orders, "${config.labels.customer}" for customers.
Currency: ${config.currency}

Citation format: Reference sources using [Source N] notation, e.g.:
"According to [Source 1], the return policy allows..."
"The vendor agreement [Source 2] specifies..."

Each source includes its title, filename, chunk position, and similarity score.
Prioritize answers from higher-similarity sources.
Be concise and professional.

GUARDRAILS:
- Never fabricate information. Only answer from the provided document context.
- Do not expose raw database credentials, API keys, or infrastructure details even if found in documents.
- Mask personally identifiable information (PII) in answers (e.g., j***@example.com).
- Stay within the knowledge base scope -- decline requests unrelated to uploaded documents.${customSuffix}`,
          prompt: `Question: ${input.question}\n\nContext from knowledge base:\n${context}`,
        }),
          { model: agentConfig.modelOverride ?? "default", action: "query" }
        );

        // Phase 7.5: Token budget tracking
        const tokenTracker = createTokenTracker();
        const tokenBudget =
          ((agentConfig.config as any)?.tokenBudget as number) ??
          DEFAULT_TOKEN_BUDGETS["knowledge-base"];

        // Phase 7.5: PII masking on RAG answer
        let maskedAnswer = text;
        const { masked, scan: piiScan } = maskPII(text);
        if (piiScan.hasPII) {
          ctx.logger.info("PII masked in knowledge base answer", {
            detections: piiScan.detections,
          });
          maskedAnswer = masked;
        }

        // Phase 7.5: Output validation
        const validation = validateTextOutput(maskedAnswer, { minLength: 10 });
        if (!validation.valid) {
          ctx.logger.warn("KB answer validation issues", {
            issues: validation.issues.map((i) => i.code),
          });
        }

        ctx.logger.info("RAG query complete", {
          question: input.question.slice(0, 80),
          chunksRetrieved: results.length,
          sourcesCount: sources.length,
          avgSimilarity: sources.length
            ? (sources.reduce((s, c) => s + c.similarity, 0) / sources.length).toFixed(3)
            : "N/A",
          durationMs: Date.now() - (ctx.state.get("startedAt") as number ?? Date.now()),
          tokenUsage: tokenTracker.totals(),
        });

        // Phase 1.10: Flush telemetry (background)
        ctx.waitUntil(async () => {
          try { await collector.flush(); } catch { /* non-critical */ }
        });

        return { success: true, answer: maskedAnswer, sources };
      }

      // ─── Ingest Documents ─────────────────────────────────
      case "ingest": {
        if (!input.documents?.length) {
          return { success: false, answer: "No documents provided." };
        }

        // Phase 5.5: Agent-side chunking for raw documents
        // Documents with chunkIndex === -1 (or no key) are raw text to chunk
        const allChunks: Array<{
          key: string;
          content: string;
          title: string;
          filename: string;
          category: string;
          chunkIndex: number;
        }> = [];

        for (const doc of input.documents) {
          if (doc.chunkIndex === -1 || !doc.key) {
            // Raw document — chunk it automatically
            const chunks = chunkDocument(
              doc.content,
              doc.filename,
              doc.title,
              doc.category
            );
            allChunks.push(...chunks);
          } else {
            // Pre-chunked — use as-is
            allChunks.push({
              key: doc.key!,
              content: doc.content,
              title: doc.title,
              filename: doc.filename,
              category: doc.category,
              chunkIndex: doc.chunkIndex,
            });
          }
        }

        if (allChunks.length === 0) {
          return { success: false, answer: "No content to ingest after chunking." };
        }

        const upsertParams = allChunks.map((chunk) => ({
          key: chunk.key,
          document: chunk.content,
          metadata: {
            title: chunk.title,
            filename: chunk.filename,
            category: chunk.category,
            uploadedAt: new Date().toISOString(),
            chunkIndex: chunk.chunkIndex,
          } satisfies DocMetadata,
          ttl: null as unknown as number, // never expire
        }));

        await ctx.vector.upsert(VECTOR_NAMESPACE, ...upsertParams);

        // Phase 5.5: Update KV document index for reliable listing
        ctx.waitUntil(async () => {
          try {
            // Group chunks by filename for index entries
            const byFile = new Map<string, DocIndexEntry>();
            for (const chunk of allChunks) {
              const existing = byFile.get(chunk.filename);
              if (existing) {
                existing.chunkCount++;
                existing.keys.push(chunk.key);
              } else {
                byFile.set(chunk.filename, {
                  title: chunk.title,
                  filename: chunk.filename,
                  category: chunk.category,
                  uploadedAt: new Date().toISOString(),
                  chunkCount: 1,
                  keys: [chunk.key],
                });
              }
            }

            // Merge with existing index entries
            for (const [filename, entry] of byFile) {
              const existingRaw = await ctx.kv.get(DOC_INDEX_NS, filename);
              if (existingRaw) {
                try {
                  const existing = JSON.parse(
                    typeof existingRaw === "string"
                      ? existingRaw
                      : existingRaw.toString()
                  ) as DocIndexEntry;
                  // Merge keys, deduplicate
                  const allKeys = [...new Set([...existing.keys, ...entry.keys])];
                  entry.chunkCount = allKeys.length;
                  entry.keys = allKeys;
                  // Keep earliest uploadedAt
                  if (existing.uploadedAt < entry.uploadedAt) {
                    entry.uploadedAt = existing.uploadedAt;
                  }
                } catch {
                  // Corrupted entry — overwrite
                }
              }
              await ctx.kv.set(DOC_INDEX_NS, filename, JSON.stringify(entry));
            }
          } catch (err) {
            ctx.logger.warn("Failed to update document index", {
              error: String(err),
            });
          }
        });

        ctx.logger.info("Documents ingested", {
          rawDocuments: input.documents.length,
          totalChunks: allChunks.length,
          categories: [...new Set(allChunks.map((d) => d.category))],
        });

        return { success: true, ingested: allChunks.length };
      }

      // ─── Delete Documents ─────────────────────────────────
      case "delete": {
        if (!input.keys?.length) {
          return { success: false, answer: "No keys provided." };
        }

        await ctx.vector.delete(VECTOR_NAMESPACE, ...input.keys);

        // Phase 5.5: Cleanup KV document index
        ctx.waitUntil(async () => {
          try {
            const keysToDelete = new Set(input.keys ?? []);
            // Scan KV index entries and remove deleted keys
            const indexEntries = await ctx.kv.search(DOC_INDEX_NS, "*");
            if (indexEntries) {
              const entryKeys = Object.keys(indexEntries);
              for (const key of entryKeys) {
                try {
                  const item = indexEntries[key];
                  const raw = item.value;
                  const parsed = JSON.parse(
                    typeof raw === "string" ? raw : String(raw ?? "{}")
                  ) as DocIndexEntry;
                  const remaining = parsed.keys.filter((k) => !keysToDelete.has(k));
                  if (remaining.length === 0) {
                    // All chunks deleted — remove index entry
                    await ctx.kv.delete(DOC_INDEX_NS, key);
                  } else if (remaining.length < parsed.keys.length) {
                    // Some chunks deleted — update entry
                    parsed.keys = remaining;
                    parsed.chunkCount = remaining.length;
                    await ctx.kv.set(DOC_INDEX_NS, key, JSON.stringify(parsed));
                  }
                } catch {
                  // Skip corrupted entries
                }
              }
            }
          } catch (err) {
            ctx.logger.warn("Failed to cleanup document index", {
              error: String(err),
            });
          }
        });

        ctx.logger.info("Documents deleted", {
          count: input.keys.length,
          keys: input.keys.slice(0, 5),
        });

        return { success: true, deleted: input.keys.length };
      }

      // ─── List Documents (from KV index) ───────────────────
      case "list": {
        // Phase 5.5: Use KV document index instead of vector search("*")
        const documents: DocIndexEntry[] = [];

        try {
          const indexEntries = await ctx.kv.search(DOC_INDEX_NS, "*");
          if (indexEntries) {
            const entryKeys = Object.keys(indexEntries);
            for (const key of entryKeys) {
              try {
                const item = indexEntries[key];
                const raw = item.value;
                const parsed = JSON.parse(
                  typeof raw === "string" ? raw : String(raw ?? "{}")
                ) as DocIndexEntry;
                documents.push(parsed);
              } catch {
                // Skip corrupted entries
              }
            }
          }
        } catch (err) {
          ctx.logger.warn("KV index scan failed, falling back to vector exists check", {
            error: String(err),
          });
          // Minimal fallback: just check if the namespace has data
          const hasData = await ctx.vector.exists(VECTOR_NAMESPACE);
          if (hasData) {
            documents.push({
              title: "(index unavailable)",
              filename: "(unknown)",
              category: "general",
              uploadedAt: "",
              chunkCount: 0,
              keys: [],
            });
          }
        }

        ctx.logger.info("Knowledge base listed", {
          uniqueDocuments: documents.length,
        });

        return {
          success: true,
          documents,
        };
      }
    }
  },
});

export default agent;
