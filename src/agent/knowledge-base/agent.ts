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
    // Static defaults only — no DB calls, cannot fail or timeout.
    // Live config is loaded per-request in the handler via
    // getAgentConfigWithDefaults() (60s memory cache, infallible
    // fallback to AGENT_DEFAULTS if DB is unreachable).
    return {
      agentConfig: {
        id: "",
        agentName: "knowledge-base",
        displayName: "The Librarian",
        description: "Document retrieval specialist",
        isActive: true,
        modelOverride: null,
        temperature: null,
        maxSteps: 3,
        timeoutMs: 15000,
        customInstructions: null,
        executionPriority: 3,
        config: { topK: 5, similarityThreshold: 0.7 },
        metadata: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      topK: 5,
      similarityThreshold: 0.7,
      temperature: undefined,
    };
  },

  shutdown: async (_app, _config) => {
    // Graceful shutdown — reserved for vector index cleanup if needed.
  },

  handler: async (ctx, input) => {
    // Phase 1.9: Use request-scoped state for timing metadata
    ctx.state.set("startedAt", Date.now());

    // Phase 1.10: Telemetry collector
    const collector = new SpanCollector("knowledge-base");

    // ── Load live agent config (infallible — 60s cache, AGENT_DEFAULTS fallback) ──
    const agentConfig = await getAgentConfigWithDefaults("knowledge-base");
    const cfgJson = (agentConfig.config ?? {}) as Record<string, unknown>;
    const topK = (cfgJson.topK as number) ?? 5;
    const similarityThreshold = (cfgJson.similarityThreshold as number) ?? 0.7;
    const temperature = agentConfig.temperature
      ? parseFloat(agentConfig.temperature)
      : undefined;

    switch (input.action) {
      // ─── RAG Query ────────────────────────────────────────
      case "query": {
        if (!input.question) {
          return { success: false, answer: "No question provided.", error: "Missing 'question' field in input.", errorStage: "validation" };
        }

        // ── Step 1: Vector search ──
        let results: Awaited<ReturnType<typeof ctx.vector.search<DocMetadata>>>;
        try {
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

          ctx.logger.info("RAG query: searching vector store", {
            namespace: VECTOR_NAMESPACE,
            similarity: similarityThreshold,
            topK,
            question: input.question.slice(0, 80),
          });

          results = await ctx.vector.search<DocMetadata>(
            VECTOR_NAMESPACE,
            searchOpts as any
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          ctx.logger.error("RAG query: vector search failed", {
            error: msg,
            stack: err instanceof Error ? err.stack : undefined,
            namespace: VECTOR_NAMESPACE,
          });
          return {
            success: false,
            answer: "Knowledge base search failed. See error details.",
            error: `Vector search failed: ${msg}`,
            errorStage: "vector-search",
          };
        }

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

        // ── Step 2: Fetch full document content ──
        let fullDocs: Awaited<ReturnType<typeof ctx.vector.getMany<DocMetadata>>>;
        try {
          const keys = results.map((r) => r.key);
          fullDocs = await ctx.vector.getMany<DocMetadata>(
            VECTOR_NAMESPACE,
            ...keys
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          ctx.logger.error("RAG query: getMany failed", { error: msg });
          return {
            success: false,
            answer: "Failed to retrieve document content.",
            error: `Vector getMany failed: ${msg}`,
            errorStage: "vector-getmany",
          };
        }

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

        // Build custom instructions from agent config (fully guarded)
        const rawInstructions = agentConfig?.customInstructions ?? "";
        const customSuffix = rawInstructions.trim()
          ? `\n\n${rawInstructions.trim()}`
          : "";

        // ── Step 3: Load LLM model ──
        let model: Awaited<ReturnType<typeof getModel>>;
        try {
          model = await getModel(agentConfig.modelOverride ?? undefined);
          ctx.logger.info("RAG query: model loaded", {
            modelOverride: agentConfig.modelOverride ?? "(default)",
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          ctx.logger.error("RAG query: model loading failed", {
            error: msg,
            modelOverride: agentConfig.modelOverride,
          });
          return {
            success: false,
            answer: "Failed to load AI model. Check model configuration in Settings.",
            error: `Model load failed (model: ${agentConfig.modelOverride ?? "default"}): ${msg}`,
            errorStage: "model-load",
          };
        }

        // ── Step 4: LLM generation ──
        let text: string;
        try {
          const genResult = await traced(
            ctx.tracer,
            collector,
            "generateText:rag-query",
            "llm",
            async () => generateText({
            model,
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
          text = genResult.text;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          ctx.logger.error("RAG query: LLM generation failed", {
            error: msg,
            stack: err instanceof Error ? err.stack : undefined,
            model: agentConfig.modelOverride ?? "default",
          });
          // Detect common failure modes
          let hint = "";
          if (msg.includes("401") || msg.includes("Unauthorized") || msg.includes("API key")) {
            hint = " Hint: Check that your AI API key is configured in Settings > AI Model.";
          } else if (msg.includes("429") || msg.includes("rate limit")) {
            hint = " Hint: Rate limited by the AI provider — try again in a moment.";
          } else if (msg.includes("model") || msg.includes("not found") || msg.includes("does not exist")) {
            hint = ` Hint: Model "${agentConfig.modelOverride ?? "default"}" may not be available. Check Settings > AI Model.`;
          }
          return {
            success: false,
            answer: `AI generation failed.${hint}`,
            error: `LLM generateText failed: ${msg}`,
            errorStage: "llm-generate",
            sources, // still return sources so the user can see retrieval worked
          };
        }

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
          return { success: false, answer: "No documents provided.", error: "Missing 'documents' array in input.", errorStage: "validation" };
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
          return { success: false, answer: "No content to ingest after chunking.", error: "Chunking produced 0 chunks — document may be empty.", errorStage: "chunking" };
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

        // -- Step 1: Vector upsert --
        try {
          await ctx.vector.upsert(VECTOR_NAMESPACE, ...upsertParams);
          ctx.logger.info("Vector upsert complete", { chunks: allChunks.length, namespace: VECTOR_NAMESPACE });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          ctx.logger.error("Vector upsert failed during ingest", {
            error: msg,
            stack: err instanceof Error ? err.stack : undefined,
            namespace: VECTOR_NAMESPACE,
            chunkCount: allChunks.length,
          });
          return {
            success: false,
            answer: "Failed to store documents in vector database.",
            error: `Vector upsert failed: ${msg}`,
            errorStage: "vector-upsert",
          };
        }

        // Update KV document index synchronously — must complete before returning
        // so the UI list reflects the upload immediately. Previously in waitUntil
        // which caused silent failures leaving vector store and KV index out of sync.
        try {
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

          for (const [filename, entry] of byFile) {
            const existingRaw = await ctx.kv.get(DOC_INDEX_NS, filename);
            if (existingRaw) {
              try {
                const existing = JSON.parse(
                  typeof existingRaw === "string"
                    ? existingRaw
                    : existingRaw.toString()
                ) as DocIndexEntry;
                const allKeys = [...new Set([...existing.keys, ...entry.keys])];
                entry.chunkCount = allKeys.length;
                entry.keys = allKeys;
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
          ctx.logger.warn("Failed to update document index", { error: String(err) });
        }

        // Update filename registry — append new filenames for reindex reliability
        try {
          const newFilenames = [...new Set(allChunks.map((c) => c.filename))];
          let existingFilenames: string[] = [];
          try {
            const raw = await ctx.kv.get(DOC_INDEX_NS, "__filenames__");
            if (raw) {
              existingFilenames = JSON.parse(
                typeof raw === "string" ? raw : raw.toString()
              );
            }
          } catch { /* fresh registry */ }
          const merged = [...new Set([...existingFilenames, ...newFilenames])];
          await ctx.kv.set(DOC_INDEX_NS, "__filenames__", JSON.stringify(merged));
        } catch (err) {
          ctx.logger.warn("Failed to update filename registry", { error: String(err) });
        }

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
        let listError: string | undefined;

        try {
          const indexEntries = await ctx.kv.search(DOC_INDEX_NS, "*");
          ctx.logger.info("KV index search result", {
            namespace: DOC_INDEX_NS,
            hasEntries: !!indexEntries,
            entryCount: indexEntries ? Object.keys(indexEntries).length : 0,
          });
          if (indexEntries) {
            const entryKeys = Object.keys(indexEntries);
            for (const key of entryKeys) {
              if (key === "__filenames__") continue; // skip registry key
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
          const msg = err instanceof Error ? err.message : String(err);
          ctx.logger.warn("KV index scan failed, falling back to vector exists check", {
            error: msg,
          });
          listError = `KV index scan failed: ${msg}`;
          // Minimal fallback: just check if the namespace has data
          try {
            const hasData = await ctx.vector.exists(VECTOR_NAMESPACE);
            if (hasData) {
              documents.push({
                title: "(index unavailable — run Re-index)",
                filename: "(unknown)",
                category: "general",
                uploadedAt: "",
                chunkCount: 0,
                keys: [],
              });
            }
          } catch (existsErr) {
            listError += ` | Vector exists check also failed: ${existsErr instanceof Error ? existsErr.message : String(existsErr)}`;
          }
        }

        ctx.logger.info("Knowledge base listed", {
          uniqueDocuments: documents.length,
          error: listError,
        });

        return {
          success: true,
          documents,
          ...(listError ? { error: listError, errorStage: "kv-list" } : {}),
        };
      }

      // ─── Reindex (rebuild KV index from vector store) ─────
      case "reindex": {
        // Discover chunks by running broad searches across the vector namespace,
        // then rebuild the KV document index from the discovered metadata.
        // This recovers documents uploaded outside the Admin UI (e.g., via chat
        // or seed scripts) that have vector entries but no KV index record.
        const discovered = new Map<string, DocIndexEntry>();

        // Strategy 1: Check filename registry first (populated by ingest)
        try {
          const registryRaw = await ctx.kv.get(DOC_INDEX_NS, "__filenames__");
          if (registryRaw) {
            const filenames: string[] = JSON.parse(
              typeof registryRaw === "string" ? registryRaw : registryRaw.toString()
            );
            ctx.logger.info("Reindex: found filename registry", { count: filenames.length });
            // For each known filename, probe chunk keys (filename-0, filename-1, ...)
            for (const filename of filenames) {
              const probeKeys: string[] = [];
              for (let i = 0; i < 500; i++) {
                probeKeys.push(`${filename}-${i}`);
              }
              try {
                const found = await ctx.vector.getMany<DocMetadata>(VECTOR_NAMESPACE, ...probeKeys);
                for (const [key, entry] of found) {
                  if (!entry) continue;
                  const meta = entry.metadata;
                  const existing = discovered.get(filename);
                  if (existing) {
                    if (!existing.keys.includes(key)) {
                      existing.keys.push(key);
                      existing.chunkCount = existing.keys.length;
                    }
                  } else {
                    discovered.set(filename, {
                      title: meta?.title ?? filename,
                      filename,
                      category: meta?.category ?? "general",
                      uploadedAt: meta?.uploadedAt ?? new Date().toISOString(),
                      chunkCount: 1,
                      keys: [key],
                    });
                  }
                }
              } catch { /* skip failed probe */ }
            }
          }
        } catch {
          ctx.logger.info("Reindex: no filename registry found, using search fallback");
        }

        // Strategy 2: Broad vector search with universal queries and zero
        // similarity threshold to catch documents not in the registry.
        // Use very common English words — they have non-zero similarity
        // with virtually any English text embedding.
        const universalQueries = [
          "the", "is", "and", "to", "of", "a", "in", "for",
          "information", "document", "data", "report",
          "policy", "procedure", "guide", "service",
          "product", "customer", "order", "inventory",
          "schedule", "operations", "management", "system",
        ];

        for (const q of universalQueries) {
          try {
            const results = await ctx.vector.search<DocMetadata>(
              VECTOR_NAMESPACE,
              { query: q, limit: 500, similarity: 0 } as any
            );
            for (const r of results) {
              const meta = r.metadata;
              if (!meta?.filename) continue;
              const existing = discovered.get(meta.filename);
              if (existing) {
                if (!existing.keys.includes(r.key)) {
                  existing.keys.push(r.key);
                  existing.chunkCount = existing.keys.length;
                }
              } else {
                discovered.set(meta.filename, {
                  title: meta.title ?? meta.filename,
                  filename: meta.filename,
                  category: meta.category ?? "general",
                  uploadedAt: meta.uploadedAt ?? new Date().toISOString(),
                  chunkCount: 1,
                  keys: [r.key],
                });
              }
            }
          } catch (err) {
            ctx.logger.debug("Reindex search query failed", { query: q, error: String(err) });
          }
        }

        // Write all discovered entries to the KV index
        let rebuilt = 0;
        for (const [filename, entry] of discovered) {
          await ctx.kv.set(DOC_INDEX_NS, filename, JSON.stringify(entry));
          rebuilt++;
        }

        // Also update the filename registry
        if (discovered.size > 0) {
          const allFilenames = [...discovered.keys()];
          await ctx.kv.set(DOC_INDEX_NS, "__filenames__", JSON.stringify(allFilenames));
        }

        ctx.logger.info("KV document index rebuilt via reindex", {
          uniqueFiles: rebuilt,
          totalChunks: [...discovered.values()].reduce((sum, e) => sum + e.chunkCount, 0),
        });

        return { success: true, ingested: rebuilt };
      }

      default: {
        return {
          success: false,
          answer: `Unknown action: "${(input as any).action}"`,
          error: `Unrecognized action "${(input as any).action}". Valid actions: query, ingest, delete, list, reindex.`,
          errorStage: "validation",
        };
      }
    }
  },
});

// ── Agent-level event listeners (per-agent telemetry) ──────
agent.addEventListener("started", (_event, _agentInfo, ctx) => {
  ctx.logger.info("[knowledge-base] agent invocation started");
});

agent.addEventListener("completed", (_event, _agentInfo, ctx) => {
  ctx.logger.info("[knowledge-base] agent invocation completed");
});

agent.addEventListener("errored", (_event, _agentInfo, ctx, error) => {
  ctx.logger.error("[knowledge-base] agent invocation errored", {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
});

export default agent;
