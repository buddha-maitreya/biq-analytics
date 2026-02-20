/**
 * KV Index Pattern — `__index__` key for entity listing in KV namespaces.
 *
 * Phase 1.9: Implements the index key pattern for enumerating entities
 * stored in KV namespaces. Since KV storage is key-based (no scan/list
 * across all keys), we maintain a separate `__index__` key that holds
 * an array of all entity keys in the namespace.
 *
 * Pattern:
 *   namespace: "widgets"
 *   index key: "__index__" → ["widget:1", "widget:2", "widget:3"]
 *   entity keys: "widget:1" → { ... }, "widget:2" → { ... }
 *
 * The index is updated on every set/delete. It enables:
 *   - Listing all entities in a namespace
 *   - Counting entities
 *   - Batch retrieval of all entities
 *   - Pagination over KV-stored collections
 *
 * Usage:
 *   const indexed = createIndexedKV(ctx.kv);  // or c.var.kv
 *   await indexed.set("widgets", "widget:1", data, { ttl: 3600 });
 *   const all = await indexed.list("widgets");           // all keys
 *   const items = await indexed.getAll("widgets");       // all values
 *   await indexed.delete("widgets", "widget:1");         // auto-removes from index
 */

import type { KVStore } from "@lib/cache";

/** Reserved key name for the index entry */
const INDEX_KEY = "__index__";

/** Index entry stored in KV — tracks all entity keys in a namespace */
interface KVIndex {
  keys: string[];
  updatedAt: string;
}

export interface IndexedKVOptions {
  /** TTL for entity values (seconds). Index uses null (never expires). */
  ttl?: number | null;
}

/**
 * Create an indexed KV wrapper that maintains an `__index__` key
 * for each namespace, enabling entity enumeration.
 */
export function createIndexedKV(kv: KVStore) {
  /**
   * Read the current index for a namespace.
   */
  async function getIndex(namespace: string): Promise<string[]> {
    try {
      const result = await kv.get<KVIndex>(namespace, INDEX_KEY);
      if (result.exists && result.data) {
        return result.data.keys;
      }
    } catch {
      // Index doesn't exist yet
    }
    return [];
  }

  /**
   * Write the index back to KV.
   * Index never expires (ttl: null) — it must persist as long as the namespace exists.
   */
  async function saveIndex(namespace: string, keys: string[]): Promise<void> {
    const index: KVIndex = {
      keys,
      updatedAt: new Date().toISOString(),
    };
    await kv.set(namespace, INDEX_KEY, index, { ttl: null });
  }

  return {
    /**
     * Store an entity and add its key to the namespace index.
     */
    async set<T>(
      namespace: string,
      key: string,
      data: T,
      options?: IndexedKVOptions
    ): Promise<void> {
      // Write the entity
      await kv.set(namespace, key, data, {
        ttl: options?.ttl ?? null,
      });

      // Update the index (add key if not already present)
      const keys = await getIndex(namespace);
      if (!keys.includes(key)) {
        keys.push(key);
        await saveIndex(namespace, keys);
      }
    },

    /**
     * Retrieve a single entity by key.
     */
    async get<T>(namespace: string, key: string): Promise<T | undefined> {
      try {
        const result = await kv.get<T>(namespace, key);
        return result.exists ? result.data : undefined;
      } catch {
        return undefined;
      }
    },

    /**
     * Delete an entity and remove its key from the namespace index.
     */
    async delete(namespace: string, key: string): Promise<void> {
      await kv.delete(namespace, key);

      // Update the index (remove key)
      const keys = await getIndex(namespace);
      const filtered = keys.filter((k) => k !== key);
      if (filtered.length !== keys.length) {
        await saveIndex(namespace, filtered);
      }
    },

    /**
     * List all entity keys in a namespace.
     */
    async list(namespace: string): Promise<string[]> {
      return getIndex(namespace);
    },

    /**
     * Count entities in a namespace.
     */
    async count(namespace: string): Promise<number> {
      const keys = await getIndex(namespace);
      return keys.length;
    },

    /**
     * Retrieve all entities in a namespace.
     * Returns an array of { key, data } pairs.
     */
    async getAll<T>(
      namespace: string
    ): Promise<Array<{ key: string; data: T }>> {
      const keys = await getIndex(namespace);
      const results: Array<{ key: string; data: T }> = [];

      for (const key of keys) {
        try {
          const result = await kv.get<T>(namespace, key);
          if (result.exists && result.data !== undefined) {
            results.push({ key, data: result.data });
          }
        } catch {
          // Entity may have expired — skip
        }
      }

      return results;
    },

    /**
     * Paginate over entities in a namespace.
     */
    async paginate<T>(
      namespace: string,
      page: number = 1,
      pageSize: number = 20
    ): Promise<{
      items: Array<{ key: string; data: T }>;
      total: number;
      page: number;
      pageSize: number;
      totalPages: number;
    }> {
      const allKeys = await getIndex(namespace);
      const total = allKeys.length;
      const totalPages = Math.ceil(total / pageSize);
      const offset = (page - 1) * pageSize;
      const pageKeys = allKeys.slice(offset, offset + pageSize);

      const items: Array<{ key: string; data: T }> = [];
      for (const key of pageKeys) {
        try {
          const result = await kv.get<T>(namespace, key);
          if (result.exists && result.data !== undefined) {
            items.push({ key, data: result.data });
          }
        } catch {
          // Entity may have expired
        }
      }

      return { items, total, page, pageSize, totalPages };
    },

    /**
     * Rebuild the index by scanning for existing keys.
     * Useful for recovery if the index gets out of sync.
     */
    async rebuild(namespace: string): Promise<number> {
      try {
        const matches = await kv.search(namespace, "");
        const keys = matches
          .map((m) => m.key)
          .filter((k) => k !== INDEX_KEY);
        await saveIndex(namespace, keys);
        return keys.length;
      } catch {
        return 0;
      }
    },

    /**
     * Check if a key exists in the index (without fetching the entity).
     */
    async has(namespace: string, key: string): Promise<boolean> {
      const keys = await getIndex(namespace);
      return keys.includes(key);
    },

    /**
     * Bulk set — store multiple entities and update the index once.
     */
    async setMany<T>(
      namespace: string,
      entries: Array<{ key: string; data: T }>,
      options?: IndexedKVOptions
    ): Promise<void> {
      // Write all entities
      await Promise.all(
        entries.map((entry) =>
          kv.set(namespace, entry.key, entry.data, {
            ttl: options?.ttl ?? null,
          })
        )
      );

      // Update the index
      const existingKeys = await getIndex(namespace);
      const keySet = new Set(existingKeys);
      for (const entry of entries) {
        keySet.add(entry.key);
      }
      await saveIndex(namespace, Array.from(keySet));
    },
  };
}

/** Type for the indexed KV wrapper */
export type IndexedKV = ReturnType<typeof createIndexedKV>;
