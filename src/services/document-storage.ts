/**
 * Document Storage Service — S3-backed original document persistence
 *
 * Phase 6.4: Stores original uploaded documents in S3 object storage
 * alongside the vector embeddings in the knowledge base. This allows:
 *   - Re-chunking with different strategies without re-uploading
 *   - Original document download from the Admin Console
 *   - Backup/recovery of knowledge base content
 *   - Presigned URL generation for secure document sharing
 *
 * Uses Bun's native S3 API. Credentials (S3_ACCESS_KEY_ID,
 * S3_SECRET_ACCESS_KEY, S3_BUCKET, S3_ENDPOINT) are auto-injected
 * by the Agentuity runtime.
 */

/** Namespace prefix for knowledge base documents in S3 */
const KB_PREFIX = "kb-documents";

/** Metadata stored alongside each document in S3 */
export interface StoredDocMeta {
  title: string;
  filename: string;
  category: string;
  uploadedAt: string;
  sizeBytes: number;
  contentType: string;
}

/**
 * Check if S3 storage is available (credentials auto-injected by Agentuity).
 * Returns false during local dev if S3 is not configured.
 */
export function isObjectStorageAvailable(): boolean {
  try {
    // Bun's s3 module is always importable but returns errors if unconfigured
    return !!(
      process.env.S3_ACCESS_KEY_ID ||
      process.env.S3_BUCKET ||
      process.env.S3_ENDPOINT
    );
  } catch {
    return false;
  }
}

/**
 * Store a document's original content in S3.
 * Key format: kb-documents/{category}/{filename}
 */
export async function storeDocument(
  content: string,
  filename: string,
  title: string,
  category: string
): Promise<{ key: string; sizeBytes: number } | null> {
  if (!isObjectStorageAvailable()) return null;

  try {
    const { s3 } = await import("bun");
    const key = `${KB_PREFIX}/${category}/${filename}`;
    const file = s3.file(key);

    await file.write(content, { type: "text/plain" });

    // Store metadata as a sidecar JSON file
    const meta: StoredDocMeta = {
      title,
      filename,
      category,
      uploadedAt: new Date().toISOString(),
      sizeBytes: new TextEncoder().encode(content).length,
      contentType: "text/plain",
    };
    const metaFile = s3.file(`${key}.meta.json`);
    await metaFile.write(JSON.stringify(meta), { type: "application/json" });

    return { key, sizeBytes: meta.sizeBytes };
  } catch {
    return null;
  }
}

/**
 * Retrieve a document's original content from S3.
 */
export async function getDocument(
  filename: string,
  category: string
): Promise<{ content: string; meta: StoredDocMeta } | null> {
  if (!isObjectStorageAvailable()) return null;

  try {
    const { s3 } = await import("bun");
    const key = `${KB_PREFIX}/${category}/${filename}`;

    const file = s3.file(key);
    if (!(await file.exists())) return null;

    const content = await file.text();

    let meta: StoredDocMeta = {
      title: filename,
      filename,
      category,
      uploadedAt: "",
      sizeBytes: new TextEncoder().encode(content).length,
      contentType: "text/plain",
    };

    try {
      const metaFile = s3.file(`${key}.meta.json`);
      if (await metaFile.exists()) {
        meta = (await metaFile.json()) as StoredDocMeta;
      }
    } catch {
      // Metadata sidecar missing — use defaults
    }

    return { content, meta };
  } catch {
    return null;
  }
}

/**
 * Delete a document and its metadata from S3.
 */
export async function deleteDocument(
  filename: string,
  category: string
): Promise<boolean> {
  if (!isObjectStorageAvailable()) return false;

  try {
    const { s3 } = await import("bun");
    const key = `${KB_PREFIX}/${category}/${filename}`;

    const file = s3.file(key);
    if (await file.exists()) await file.delete();

    const metaFile = s3.file(`${key}.meta.json`);
    if (await metaFile.exists()) await metaFile.delete();

    return true;
  } catch {
    return false;
  }
}

/**
 * Generate a presigned download URL for a document.
 * The URL expires after the specified duration (default: 1 hour).
 */
export async function getDocumentDownloadUrl(
  filename: string,
  category: string,
  expiresInSecs = 3600
): Promise<string | null> {
  if (!isObjectStorageAvailable()) return null;

  try {
    const { s3 } = await import("bun");
    const key = `${KB_PREFIX}/${category}/${filename}`;
    return s3.presign(key, { expiresIn: expiresInSecs });
  } catch {
    return null;
  }
}

/**
 * List all documents stored in S3 under a category (or all categories).
 */
export async function listStoredDocuments(
  category?: string
): Promise<StoredDocMeta[]> {
  if (!isObjectStorageAvailable()) return [];

  try {
    const { s3 } = await import("bun");
    const prefix = category
      ? `${KB_PREFIX}/${category}/`
      : `${KB_PREFIX}/`;

    // List meta.json sidecar files to discover documents
    const objects = await (s3 as any).listObjects?.({ prefix }) as
      | Array<{ key: string }>
      | undefined;

    if (!objects) return [];

    const docs: StoredDocMeta[] = [];
    for (const obj of objects) {
      if (obj.key.endsWith(".meta.json")) {
        try {
          const file = s3.file(obj.key);
          const meta = (await file.json()) as StoredDocMeta;
          docs.push(meta);
        } catch {
          // Skip corrupted metadata
        }
      }
    }
    return docs;
  } catch {
    return [];
  }
}
