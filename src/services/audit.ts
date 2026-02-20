/**
 * Audit Trail Service — durable stream logging for agent actions.
 *
 * Phase 6.3: Logs all significant agent actions to durable streams
 * for compliance, debugging, and analytics. Uses the Agentuity
 * Durable Streams API (ctx.stream / c.var.stream) which provides
 * write-once, read-many append-only logs with TTL management.
 *
 * Each agent gets its own audit stream namespace. Entries include:
 *   - Agent name (+  handler or streaming context)
 *   - Action type (query, tool-call, llm-call, import, etc.)
 *   - Input/output summaries (not full payloads — those go to telemetry)
 *   - User/session context
 *   - Timestamps and duration
 *
 * Streams are created with a 90-day TTL (max) for compliance.
 * Use ctx.stream.list() to retrieve audit logs for a time range.
 *
 * Usage in agents:
 *   import { createAuditLogger } from "@services/audit";
 *   const audit = createAuditLogger(ctx.stream, "data-science");
 *   await audit.log("tool-call", { tool: "query_database", ... });
 *   await audit.close(); // Always close when done
 *
 * Usage in routes:
 *   import { createAuditLogger } from "@services/audit";
 *   const audit = createAuditLogger(c.var.stream, "chat-route");
 *   await audit.log("message-sent", { sessionId, userId });
 *   await audit.close();
 */

// ── Types ──────────────────────────────────────────────────

export interface AuditEntry {
  /** Unique entry ID */
  id: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Agent or route that generated this entry */
  source: string;
  /** Action category */
  action: string;
  /** Session ID (if applicable) */
  sessionId?: string;
  /** User ID (if applicable) */
  userId?: string;
  /** Action-specific data (keep small — summaries only) */
  data: Record<string, unknown>;
  /** Duration in milliseconds (if applicable) */
  durationMs?: number;
}

/** Stream storage interface (subset of ctx.stream / c.var.stream) */
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
  list(options?: {
    namespace?: string;
    metadata?: Record<string, unknown>;
    limit?: number;
    offset?: number;
  }): Promise<{
    streams: Array<{
      id: string;
      namespace: string;
      sizeBytes: number;
      metadata?: Record<string, unknown>;
      expiresAt?: string;
    }>;
  }>;
  download(streamId: string): Promise<string>;
  delete(streamId: string): Promise<void>;
}

// ── Constants ──────────────────────────────────────────────

/** Audit stream namespace prefix */
const AUDIT_NS = "audit";

/** Max TTL for audit streams: 90 days (compliance) */
const AUDIT_TTL_SECONDS = 90 * 24 * 60 * 60; // 7,776,000s

/** Max entries per stream before rotation */
const MAX_ENTRIES_PER_STREAM = 1000;

// ── Audit Logger ───────────────────────────────────────────

export interface AuditLogger {
  /** Log an audit entry */
  log(action: string, data: Record<string, unknown>, options?: {
    sessionId?: string;
    userId?: string;
    durationMs?: number;
  }): Promise<void>;

  /** Close the audit stream (must be called when done) */
  close(): Promise<void>;

  /** Get the stream URL for later retrieval */
  streamUrl: string | null;

  /** Get the stream ID */
  streamId: string | null;
}

/**
 * Create an audit logger that writes to a durable stream.
 *
 * @param streamStore - ctx.stream or c.var.stream
 * @param source - Agent or route name
 */
export function createAuditLogger(
  streamStore: StreamStore,
  source: string
): AuditLogger {
  let stream: Awaited<ReturnType<StreamStore["create"]>> | null = null;
  let initPromise: Promise<void> | null = null;
  let entryCount = 0;
  let _streamUrl: string | null = null;
  let _streamId: string | null = null;

  /** Lazy-initialize the stream on first write */
  async function ensureStream(): Promise<typeof stream> {
    if (stream) return stream;
    if (initPromise) {
      await initPromise;
      return stream;
    }

    initPromise = (async () => {
      stream = await streamStore.create(`${AUDIT_NS}:${source}`, {
        contentType: "application/x-ndjson",
        compress: true,
        metadata: {
          source,
          createdAt: new Date().toISOString(),
          type: "audit-trail",
        },
        ttl: AUDIT_TTL_SECONDS,
      });
      _streamUrl = stream.url;
      _streamId = stream.id;
    })();

    await initPromise;
    return stream;
  }

  return {
    async log(action, data, options) {
      const s = await ensureStream();
      if (!s) return;

      const entry: AuditEntry = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        source,
        action,
        sessionId: options?.sessionId,
        userId: options?.userId,
        data,
        durationMs: options?.durationMs,
      };

      // Write as NDJSON (newline-delimited JSON)
      await s.write(JSON.stringify(entry) + "\n");
      entryCount++;
    },

    async close() {
      if (stream) {
        await stream.close();
        stream = null;
      }
    },

    get streamUrl() {
      return _streamUrl;
    },

    get streamId() {
      return _streamId;
    },
  };
}

// ── Query functions ────────────────────────────────────────

/**
 * List audit streams for a given source/agent.
 */
export async function listAuditStreams(
  streamStore: StreamStore,
  source?: string,
  options?: { limit?: number; offset?: number }
): Promise<Array<{
  id: string;
  source: string;
  sizeBytes: number;
  createdAt?: string;
  expiresAt?: string;
}>> {
  const result = await streamStore.list({
    namespace: source ? `${AUDIT_NS}:${source}` : AUDIT_NS,
    limit: options?.limit ?? 50,
    offset: options?.offset ?? 0,
  });

  return result.streams.map((s) => ({
    id: s.id,
    source: (s.metadata?.source as string) ?? s.namespace,
    sizeBytes: s.sizeBytes,
    createdAt: s.metadata?.createdAt as string | undefined,
    expiresAt: s.expiresAt,
  }));
}

/**
 * Read audit entries from a specific stream.
 */
export async function readAuditStream(
  streamStore: StreamStore,
  streamId: string
): Promise<AuditEntry[]> {
  const content = await streamStore.download(streamId);
  const lines = content.trim().split("\n").filter(Boolean);

  return lines.map((line) => {
    try {
      return JSON.parse(line) as AuditEntry;
    } catch {
      return {
        id: "parse-error",
        timestamp: new Date().toISOString(),
        source: "unknown",
        action: "parse-error",
        data: { raw: line },
      };
    }
  });
}

/**
 * Delete an audit stream.
 */
export async function deleteAuditStream(
  streamStore: StreamStore,
  streamId: string
): Promise<void> {
  await streamStore.delete(streamId);
}
