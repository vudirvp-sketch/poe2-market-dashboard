// ============================================================================
// Cache Pre-populator — reads a JSON snapshot and pre-populates the
// poe2api.ts in-memory cache so the dashboard has data even when the
// upstream POE2Scout API is unreachable (e.g., blocked in Russia).
//
// This module is SERVER-SIDE ONLY. It uses fs.readFileSync and must never
// be imported from client-side code.
//
// Usage:
//   import { prepopulateCache, saveCacheSnapshot } from "@/lib/cache-prepopulator";
//   prepopulateCache();  // Load snapshot into cache
//   saveCacheSnapshot(); // Save current cache to disk
// ============================================================================

import { cache, CACHE_STALE_TTL, prepopulateCacheEntry, BASE_URL } from "./poe2api";

// ---------- Snapshot format ----------

export interface CacheSnapshot {
  /** Snapshot format version — must be 1 */
  version: 1;
  /** ISO timestamp when the snapshot was created */
  timestamp: string;
  /** Map of URL → { data, ts } matching the cache entry format */
  entries: Record<string, { data: unknown; ts: number }>;
}

// ---------- Server-side only guard ----------

function ensureServerSide(): void {
  if (typeof window !== "undefined") {
    throw new Error(
      "[cache-prepopulator] This module must only be used on the server side. " +
      "It relies on Node.js fs module which is not available in the browser."
    );
  }
}

// ---------- Pre-populate ----------

/**
 * Read the cache snapshot from `src/data/cache-snapshot.json` (if it exists)
 * and pre-populate the poe2api.ts in-memory cache with the data.
 *
 * Entries from the snapshot are inserted with their original `ts` value.
 * If `ts` is missing or 0, it is set to `Date.now() - CACHE_STALE_TTL + 60_000`
 * so the entry is considered "stale but usable" — cachedFetch will serve it
 * immediately while triggering background revalidation.
 *
 * This function is idempotent — calling it multiple times is safe; existing
 * fresher cache entries will not be overwritten.
 *
 * @returns The number of entries loaded from the snapshot, or 0 if none.
 */
export function prepopulateCache(): number {
  ensureServerSide();

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("fs") as typeof import("fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("path") as typeof import("path");

    const snapshotPath = path.resolve(__dirname, "../data/cache-snapshot.json");

    if (!fs.existsSync(snapshotPath)) {
      console.info("[cache-prepopulator] No snapshot file found at", snapshotPath);
      return 0;
    }

    const raw = fs.readFileSync(snapshotPath, "utf-8");
    const snapshot: CacheSnapshot = JSON.parse(raw);

    if (snapshot.version !== 1) {
      console.warn(
        `[cache-prepopulator] Snapshot version ${snapshot.version} is not supported (expected 1). Skipping.`
      );
      return 0;
    }

    if (!snapshot.entries || typeof snapshot.entries !== "object") {
      console.warn("[cache-prepopulator] Snapshot has no valid entries. Skipping.");
      return 0;
    }

    const staleTs = Date.now() - CACHE_STALE_TTL + 60_000;
    let count = 0;

    for (const [url, entry] of Object.entries(snapshot.entries)) {
      if (!entry || typeof entry !== "object") continue;
      const ts = entry.ts ?? staleTs;
      prepopulateCacheEntry(url, entry.data, ts);
      count++;
    }

    if (count > 0) {
      console.info(
        `[cache-prepopulator] Loaded ${count} entries from snapshot ` +
        `(timestamp: ${snapshot.timestamp})`
      );
    }

    return count;
  } catch (err) {
    console.warn(
      "[cache-prepopulator] Failed to pre-populate cache from snapshot:",
      err instanceof Error ? err.message : err
    );
    return 0;
  }
}

// ---------- Save snapshot ----------

/**
 * Save the current in-memory cache to `src/data/cache-snapshot.json`.
 *
 * This is intended to be called by the build/snapshot script
 * (`scripts/generate-cache-snapshot.ts`) after fetching fresh data from
 * the API, or manually from an API route for debugging.
 *
 * The output file format matches CacheSnapshot with version=1.
 *
 * @param outputPath Override the output file path (default: src/data/cache-snapshot.json)
 * @returns The number of entries written to the snapshot file.
 */
export function saveCacheSnapshot(outputPath?: string): number {
  ensureServerSide();

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("fs") as typeof import("fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("path") as typeof import("path");

    const snapshotPath = outputPath || path.resolve(__dirname, "../data/cache-snapshot.json");
    const dir = path.dirname(snapshotPath);

    // Ensure the directory exists
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const entries: Record<string, { data: unknown; ts: number }> = {};

    for (const [url, entry] of cache.entries()) {
      entries[url] = { data: entry.data, ts: entry.ts };
    }

    const snapshot: CacheSnapshot = {
      version: 1,
      timestamp: new Date().toISOString(),
      entries,
    };

    const json = JSON.stringify(snapshot, null, 2);
    fs.writeFileSync(snapshotPath, json, "utf-8");

    console.info(
      `[cache-prepopulator] Saved ${cache.size} entries to snapshot at ${snapshotPath}`
    );

    return cache.size;
  } catch (err) {
    console.error(
      "[cache-prepopulator] Failed to save cache snapshot:",
      err instanceof Error ? err.message : err
    );
    return 0;
  }
}

// ---------- Utility: build API URL ----------

/**
 * Build a full API URL using the same BASE_URL as poe2api.ts.
 * Useful for snapshot generation scripts.
 */
export function buildApiUrl(path: string): string {
  return `${BASE_URL}${path.startsWith("/") ? path : "/" + path}`;
}
