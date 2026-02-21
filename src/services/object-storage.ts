/**
 * Object Storage Service — Generic S3 abstraction layer
 *
 * Provides a clean, testable interface over Bun's native S3 APIs.
 * Credentials (S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET,
 * S3_ENDPOINT) are auto-injected by the Agentuity runtime.
 *
 * All callers should use this module instead of importing `s3` from "bun"
 * directly. This enables:
 *   - Consistent error handling and availability checking
 *   - Easy mocking in tests
 *   - Centralized S3 configuration
 *   - Namespace-based key isolation
 */

// ── Types ──────────────────────────────────────────────────

/** Metadata attached to a stored object (JSON sidecar) */
export interface ObjectMeta {
  key: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  [k: string]: unknown;
}

/** Options for writing an object */
export interface PutOptions {
  contentType?: string;
  /** Optional metadata stored as a sidecar JSON file alongside the object */
  meta?: Record<string, unknown>;
}

/** Options for generating presigned URLs */
export interface PresignOptions {
  /** Expiration in seconds (default: 3600 — 1 hour) */
  expiresIn?: number;
  /** HTTP method: GET for download, PUT for upload (default: GET) */
  method?: "GET" | "PUT";
}

/** Result of a stat call */
export interface ObjectStat {
  etag?: string;
  lastModified?: Date;
  size: number;
  type?: string;
}

// ── Availability ───────────────────────────────────────────

/**
 * Check if S3 storage credentials are available.
 * Returns false during local dev if S3 is not configured.
 */
export function isAvailable(): boolean {
  return !!(
    process.env.S3_ACCESS_KEY_ID ||
    process.env.S3_BUCKET ||
    process.env.S3_ENDPOINT
  );
}

// ── Internal helpers ───────────────────────────────────────

function metaKey(key: string): string {
  return `${key}.__meta__.json`;
}

async function getS3() {
  const { s3 } = await import("bun");
  return s3;
}

// ── Core API ───────────────────────────────────────────────

/**
 * Write content to S3 at the given key.
 * Optionally stores metadata as a sidecar JSON file.
 */
export async function put(
  key: string,
  content: string | Buffer | Uint8Array,
  options: PutOptions = {}
): Promise<{ key: string; sizeBytes: number }> {
  const s3 = await getS3();
  const contentType = options.contentType ?? "application/octet-stream";

  const file = s3.file(key);
  await file.write(content, { type: contentType });

  const sizeBytes =
    typeof content === "string"
      ? new TextEncoder().encode(content).length
      : content.length;

  // Write metadata sidecar if provided
  if (options.meta) {
    const meta: ObjectMeta = {
      key,
      contentType,
      sizeBytes,
      createdAt: new Date().toISOString(),
      ...options.meta,
    };
    const mf = s3.file(metaKey(key));
    await mf.write(JSON.stringify(meta), { type: "application/json" });
  }

  return { key, sizeBytes };
}

/**
 * Read content from S3 as a string.
 * Returns null if the object does not exist.
 */
export async function get(key: string): Promise<string | null> {
  const s3 = await getS3();
  const file = s3.file(key);
  try {
    if (!(await file.exists())) return null;
    return await file.text();
  } catch {
    return null;
  }
}

/**
 * Read content from S3 as a Buffer.
 * Returns null if the object does not exist.
 */
export async function getBuffer(key: string): Promise<Buffer | null> {
  const s3 = await getS3();
  const file = s3.file(key);
  try {
    if (!(await file.exists())) return null;
    const ab = await file.arrayBuffer();
    return Buffer.from(ab);
  } catch {
    return null;
  }
}

/**
 * Read the metadata sidecar for an object.
 * Returns null if no metadata exists.
 */
export async function getMeta(key: string): Promise<ObjectMeta | null> {
  const s3 = await getS3();
  try {
    const mf = s3.file(metaKey(key));
    if (!(await mf.exists())) return null;
    return (await mf.json()) as ObjectMeta;
  } catch {
    return null;
  }
}

/**
 * Check if an object exists.
 */
export async function exists(key: string): Promise<boolean> {
  const s3 = await getS3();
  try {
    return await s3.file(key).exists();
  } catch {
    return false;
  }
}

/**
 * Get object stats (size, etag, lastModified, type).
 * Returns null if the object does not exist.
 */
export async function stat(key: string): Promise<ObjectStat | null> {
  const s3 = await getS3();
  try {
    const file = s3.file(key);
    if (!(await file.exists())) return null;
    return (await file.stat()) as ObjectStat;
  } catch {
    return null;
  }
}

/**
 * Delete an object (and its metadata sidecar, if any).
 */
export async function del(key: string): Promise<boolean> {
  const s3 = await getS3();
  try {
    const file = s3.file(key);
    if (await file.exists()) await file.delete();

    // Also clean up metadata sidecar
    try {
      const mf = s3.file(metaKey(key));
      if (await mf.exists()) await mf.delete();
    } catch {
      // Non-critical
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Generate a presigned URL for downloading or uploading.
 */
export function presign(key: string, options: PresignOptions = {}): string {
  // s3.presign is synchronous in Bun
  const { s3 } = require("bun");
  return s3.presign(key, {
    expiresIn: options.expiresIn ?? 3600,
    method: options.method ?? "GET",
  });
}

/**
 * List objects under a prefix.
 * Returns metadata sidecars parsed as ObjectMeta[].
 * Falls back to raw keys if listObjects is not available.
 */
export async function list(prefix: string): Promise<ObjectMeta[]> {
  const s3 = await getS3();
  try {
    const objects = await (s3 as any).listObjects?.({ prefix }) as
      | Array<{ key: string }>
      | undefined;

    if (!objects) return [];

    const results: ObjectMeta[] = [];
    for (const obj of objects) {
      if (obj.key.endsWith(".__meta__.json")) {
        try {
          const file = s3.file(obj.key);
          const meta = (await file.json()) as ObjectMeta;
          results.push(meta);
        } catch {
          // Skip corrupted metadata
        }
      }
    }
    return results;
  } catch {
    return [];
  }
}

/**
 * Create a namespaced helper — all keys are prefixed automatically.
 * Useful for isolating different storage concerns (kb-documents, imports, etc.).
 */
export function namespace(prefix: string) {
  const ns = prefix.endsWith("/") ? prefix : `${prefix}/`;

  return {
    put: (key: string, content: string | Buffer | Uint8Array, opts?: PutOptions) =>
      put(`${ns}${key}`, content, opts),
    get: (key: string) => get(`${ns}${key}`),
    getBuffer: (key: string) => getBuffer(`${ns}${key}`),
    getMeta: (key: string) => getMeta(`${ns}${key}`),
    exists: (key: string) => exists(`${ns}${key}`),
    stat: (key: string) => stat(`${ns}${key}`),
    del: (key: string) => del(`${ns}${key}`),
    presign: (key: string, opts?: PresignOptions) => presign(`${ns}${key}`, opts),
    list: () => list(ns),
    /** The raw prefix string */
    prefix: ns,
  };
}
