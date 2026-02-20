/**
 * Data Pipeline Stream Utility — large payload handoff between agents.
 *
 * Phase 6.3: When agent-to-agent payloads exceed the direct return
 * limit (~1MB), use durable streams as an intermediary:
 *
 *   Agent A  →  writes data to stream  →  returns stream URL/ID
 *   Agent B  →  receives stream URL/ID →  downloads data from stream
 *
 * This module provides a clean API for this pattern:
 *
 *   // Producer side (Agent A)
 *   import { createPipelineWriter } from "@lib/pipeline-stream";
 *   const writer = await createPipelineWriter(ctx.stream, "export-results");
 *   for (const batch of results) await writer.writeBatch(batch);
 *   const ref = await writer.finalize();
 *   return { pipelineRef: ref }; // { streamId, url, totalRecords, ... }
 *
 *   // Consumer side (Agent B)
 *   import { readPipeline, readPipelineBatches } from "@lib/pipeline-stream";
 *   const allData = await readPipeline(ctx.stream, ref.streamId);
 *   // Or iterate in batches:
 *   for await (const batch of readPipelineBatches(ctx.stream, ref.streamId)) {
 *     process(batch);
 *   }
 *
 * Streams are created with a 24-hour TTL by default (ephemeral handoff).
 */

// ── Types ──────────────────────────────────────────────────

export interface PipelineRef {
  /** Durable stream ID */
  streamId: string;
  /** Direct download URL */
  url: string;
  /** Human-readable pipeline label */
  label: string;
  /** Total records written */
  totalRecords: number;
  /** Total bytes written */
  totalBytes: number;
  /** Number of batches written */
  batchCount: number;
  /** ISO timestamp of creation */
  createdAt: string;
  /** ISO timestamp when stream expires */
  expiresAt: string;
  /** Content type of each record */
  contentType: string;
}

export interface PipelineWriterOptions {
  /** TTL in seconds (default: 86400 = 24h) */
  ttl?: number;
  /** Content type (default: "application/x-ndjson") */
  contentType?: string;
  /** Enable compression (default: true) */
  compress?: boolean;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/** Stream store interface (ctx.stream / c.var.stream) */
export interface StreamStore {
  create(
    namespace: string,
    options?: {
      contentType?: string;
      compress?: boolean;
      metadata?: Record<string, unknown>;
      ttl?: number | null;
    }
  ): Promise<{
    id: string;
    url: string;
    bytesWritten: number;
    write(data: string | Uint8Array): Promise<void>;
    close(): Promise<void>;
  }>;
  download(streamId: string): Promise<string>;
  delete(streamId: string): Promise<void>;
}

// ── Constants ──────────────────────────────────────────────

const DEFAULT_TTL = 24 * 60 * 60; // 24 hours
const PIPELINE_NS = "pipeline";

// ── Writer ─────────────────────────────────────────────────

export interface PipelineWriter {
  /** Write a single record */
  writeRecord(record: unknown): Promise<void>;
  /** Write a batch of records */
  writeBatch(records: unknown[]): Promise<void>;
  /** Finalize and close the stream, returns a PipelineRef */
  finalize(): Promise<PipelineRef>;
}

/**
 * Create a pipeline writer for large payload handoff.
 *
 * @param streamStore - ctx.stream or c.var.stream
 * @param label - Human-readable pipeline label (e.g. "product-export")
 */
export async function createPipelineWriter(
  streamStore: StreamStore,
  label: string,
  options?: PipelineWriterOptions
): Promise<PipelineWriter> {
  const ttl = options?.ttl ?? DEFAULT_TTL;
  const contentType = options?.contentType ?? "application/x-ndjson";
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();

  const stream = await streamStore.create(`${PIPELINE_NS}:${label}`, {
    contentType,
    compress: options?.compress ?? true,
    metadata: {
      label,
      type: "data-pipeline",
      createdAt,
      ...(options?.metadata ?? {}),
    },
    ttl,
  });

  let totalRecords = 0;
  let batchCount = 0;

  return {
    async writeRecord(record) {
      await stream.write(JSON.stringify(record) + "\n");
      totalRecords++;
    },

    async writeBatch(records) {
      if (records.length === 0) return;
      const chunk = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
      await stream.write(chunk);
      totalRecords += records.length;
      batchCount++;
    },

    async finalize(): Promise<PipelineRef> {
      await stream.close();
      return {
        streamId: stream.id,
        url: stream.url,
        label,
        totalRecords,
        totalBytes: stream.bytesWritten,
        batchCount,
        createdAt,
        expiresAt,
        contentType,
      };
    },
  };
}

// ── Reader ─────────────────────────────────────────────────

/**
 * Read all records from a pipeline stream.
 *
 * @param streamStore - ctx.stream or c.var.stream
 * @param streamId - The stream ID from PipelineRef
 * @returns Parsed records array
 */
export async function readPipeline<T = unknown>(
  streamStore: StreamStore,
  streamId: string
): Promise<T[]> {
  const content = await streamStore.download(streamId);
  const lines = content.trim().split("\n").filter(Boolean);
  return lines.map((line) => JSON.parse(line) as T);
}

/**
 * Read pipeline records in batches (async generator).
 *
 * @param streamStore - ctx.stream or c.var.stream
 * @param streamId - The stream ID from PipelineRef
 * @param batchSize - Records per batch (default: 100)
 */
export async function* readPipelineBatches<T = unknown>(
  streamStore: StreamStore,
  streamId: string,
  batchSize = 100
): AsyncGenerator<T[]> {
  const content = await streamStore.download(streamId);
  const lines = content.trim().split("\n").filter(Boolean);

  for (let i = 0; i < lines.length; i += batchSize) {
    const batch = lines.slice(i, i + batchSize);
    yield batch.map((line) => JSON.parse(line) as T);
  }
}

/**
 * Delete a pipeline stream after consumption.
 */
export async function deletePipeline(
  streamStore: StreamStore,
  streamId: string
): Promise<void> {
  await streamStore.delete(streamId);
}
