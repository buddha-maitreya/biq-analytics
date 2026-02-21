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
 * Built on the generic ObjectStorage abstraction (object-storage.ts).
 */

import * as objectStorage from "./object-storage";

/** Namespaced storage for knowledge base documents */
const kbStorage = objectStorage.namespace("kb-documents");

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
  return objectStorage.isAvailable();
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
  if (!objectStorage.isAvailable()) return null;

  try {
    const docKey = `${category}/${filename}`;
    const result = await kbStorage.put(docKey, content, {
      contentType: "text/plain",
      meta: {
        title,
        filename,
        category,
        uploadedAt: new Date().toISOString(),
        contentType: "text/plain",
      } satisfies Omit<StoredDocMeta, "sizeBytes">,
    });
    return result;
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
  if (!objectStorage.isAvailable()) return null;

  try {
    const docKey = `${category}/${filename}`;
    const content = await kbStorage.get(docKey);
    if (content === null) return null;

    // Try to read metadata sidecar
    const rawMeta = await kbStorage.getMeta(docKey);
    const meta: StoredDocMeta = rawMeta
      ? {
          title: (rawMeta.title as string) ?? filename,
          filename: (rawMeta.filename as string) ?? filename,
          category: (rawMeta.category as string) ?? category,
          uploadedAt: (rawMeta.uploadedAt as string) ?? rawMeta.createdAt ?? "",
          sizeBytes: rawMeta.sizeBytes,
          contentType: (rawMeta.contentType as string) ?? "text/plain",
        }
      : {
          title: filename,
          filename,
          category,
          uploadedAt: "",
          sizeBytes: new TextEncoder().encode(content).length,
          contentType: "text/plain",
        };

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
  if (!objectStorage.isAvailable()) return false;

  try {
    return await kbStorage.del(`${category}/${filename}`);
  } catch {
    return false;
  }
}

/**
 * Generate a presigned download URL for a document.
 * The URL expires after the specified duration (default: 1 hour).
 */
export function getDocumentDownloadUrl(
  filename: string,
  category: string,
  expiresInSecs = 3600
): string | null {
  if (!objectStorage.isAvailable()) return null;

  try {
    return kbStorage.presign(`${category}/${filename}`, {
      expiresIn: expiresInSecs,
    });
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
  if (!objectStorage.isAvailable()) return [];

  try {
    // Use the namespace list if no category filter, or create sub-namespace
    const storage = category
      ? objectStorage.namespace(`kb-documents/${category}`)
      : kbStorage;

    const metas = await storage.list();
    return metas.map((m) => ({
      title: (m.title as string) ?? (m.key as string),
      filename: (m.filename as string) ?? "",
      category: (m.category as string) ?? category ?? "",
      uploadedAt: (m.uploadedAt as string) ?? m.createdAt ?? "",
      sizeBytes: m.sizeBytes,
      contentType: (m.contentType as string) ?? "text/plain",
    }));
  } catch {
    return [];
  }
}
