/**
 * Knowledge Base Agent -- Types, schemas, and constants
 */

import { z } from "zod";
import type { AgentConfigRow } from "@services/agent-configs";

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

export interface DocMetadata {
  [key: string]: unknown;
  title: string;
  filename: string;
  category: string;
  uploadedAt: string;
  chunkIndex: number;
}

/** Summary metadata stored in the KV document index. */
export interface DocIndexEntry {
  title: string;
  filename: string;
  category: string;
  uploadedAt: string;
  chunkCount: number;
  keys: string[];
}

export interface KnowledgeBaseConfig {
  agentConfig: AgentConfigRow;
  topK: number;
  similarityThreshold: number;
  temperature: number | undefined;
}

/** Rich source citation returned in query results. */
export interface SourceCitation {
  title: string;
  filename: string;
  category: string;
  similarity: number;
  chunkIndex: number;
}

// ────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────

export const VECTOR_NAMESPACE = "knowledge-base";

/** KV namespace for the document metadata index. */
export const DOC_INDEX_NS = "kb-doc-index";

// ────────────────────────────────────────────────────────────
// Schemas -- Zod with .describe() for LLM-facing clarity
// ────────────────────────────────────────────────────────────

export const inputSchema = z.object({
  action: z
    .enum(["query", "ingest", "delete", "list"])
    .describe("Operation to perform on the knowledge base"),
  question: z
    .string()
    .optional()
    .describe("For 'query' -- the user's natural language question"),
  documents: z
    .array(
      z.object({
        key: z
          .string()
          .optional()
          .describe("Optional unique identifier for pre-chunked content. Auto-generated when providing raw text."),
        content: z.string().describe("The text content to index (can be full document or pre-chunked)"),
        title: z.string().describe("Human-readable document title"),
        filename: z.string().describe("Original filename"),
        category: z.string().default("general").describe("Document category"),
        chunkIndex: z
          .number()
          .int()
          .default(-1)
          .describe("Chunk position (-1 = raw document, agent will chunk automatically)"),
      })
    )
    .optional()
    .describe("For 'ingest' -- array of documents or chunks to index"),
  keys: z
    .array(z.string())
    .optional()
    .describe("For 'delete' -- document keys to remove"),
  /** Metadata-only search filters (for 'query' action). */
  filters: z
    .object({
      category: z.string().optional().describe("Filter by document category"),
      filename: z.string().optional().describe("Filter by filename (exact or partial match)"),
    })
    .optional()
    .describe("For 'query' -- optional metadata filters to narrow search"),
});

export const outputSchema = z.object({
  success: z.boolean().describe("Whether the operation completed successfully"),
  answer: z.string().optional().describe("RAG-synthesized answer for queries"),
  sources: z
    .array(
      z.object({
        title: z.string().describe("Source document title"),
        filename: z.string().describe("Source filename"),
        category: z.string().describe("Source category"),
        similarity: z.number().describe("Similarity score (0-1)"),
        chunkIndex: z.number().describe("Chunk position within the document"),
      })
    )
    .optional()
    .describe("Rich source citations with similarity scores"),
  ingested: z.number().optional().describe("Number of chunks ingested"),
  deleted: z.number().optional().describe("Number of documents deleted"),
  documents: z.array(z.unknown()).optional().describe("Document metadata for list action"),
});
