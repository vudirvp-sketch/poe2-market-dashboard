#!/usr/bin/env tsx
// ============================================================================
// Cache Snapshot Generator
//
// Fetches key API endpoints from the POE2Scout API and saves the results
// into src/data/cache-snapshot.json. This snapshot is loaded at startup
// to pre-populate the in-memory cache, so the dashboard works even when
// the upstream API is unreachable (e.g., blocked in Russia).
//
// Usage:
//   npx tsx scripts/generate-cache-snapshot.ts
//
// Environment variables:
//   POE2_API_BASE_URL — Override the API base URL
//   POE2_SNAPSHOT_REALM — Realm to snapshot (default: "poe2")
//   POE2_SNAPSHOT_LEAGUE — League to snapshot (default: "vaal")
// ============================================================================

import * as fs from "fs";
import * as path from "path";

// ---------- Configuration ----------

const BASE_URL = process.env.POE2_API_BASE_URL || "https://api.poe2scout.com/api";
const SNAPSHOT_REALM = process.env.POE2_SNAPSHOT_REALM || "poe2";
const SNAPSHOT_LEAGUE = process.env.POE2_SNAPSHOT_LEAGUE || "vaal";
const OUTPUT_PATH = path.resolve(__dirname, "../src/data/cache-snapshot.json");
const FETCH_TIMEOUT = 30_000; // 30 seconds

// ---------- Types ----------

interface CacheSnapshotEntry {
  data: unknown;
  ts: number;
}

interface CacheSnapshot {
  version: 1;
  timestamp: string;
  entries: Record<string, CacheSnapshotEntry>;
}

// ---------- Fetch helper ----------

async function fetchJSON<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  try {
    console.log(`  Fetching: ${url}`);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "PoE2-Market-Dashboard-SnapshotGen/1.0",
        "Accept": "application/json",
      },
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} — ${url}`);
    }

    return (await res.json()) as T;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ---------- Endpoints to snapshot ----------

interface EndpointConfig {
  /** URL path relative to BASE_URL (must start with /) */
  path: string;
  /** Human-readable label for logging */
  label: string;
  /** Whether this endpoint is critical (abort on failure) */
  critical?: boolean;
}

function getEndpoints(realm: string, league: string): EndpointConfig[] {
  return [
    // ── Core data (critical — realm/league selectors depend on these) ──
    { path: "/Realms", label: "Realms", critical: true },
    { path: `/${realm}/Leagues`, label: "Leagues", critical: true },

    // ── Exchange data ──
    { path: `/${realm}/Leagues/${league}/ExchangeSnapshot`, label: "ExchangeSnapshot" },
    { path: `/${realm}/Leagues/${league}/SnapshotPairs`, label: "SnapshotPairs" },
    { path: `/${realm}/Leagues/${league}/SnapshotHistory?Limit=24`, label: "SnapshotHistory" },
    { path: `/${realm}/Leagues/${league}/ReferenceCurrencies`, label: "ReferenceCurrencies" },

    // ── Categories ──
    { path: `/${realm}/Leagues/${league}/Items/Categories`, label: "Categories" },

    // ── Currency first page (has PriceLogs for change computation) ──
    { path: `/${realm}/Leagues/${league}/Currencies/ByCategory?Category=currency&Page=1&PerPage=250`, label: "Currencies ByCategory (currency)" },

    // ── Items first page ──
    { path: `/${realm}/Leagues/${league}/Items?Page=1&PerPage=50`, label: "Items (page 1)" },
  ];
}

// ---------- Main ----------

async function main(): Promise<void> {
  console.log("=== POE2 Market Dashboard — Cache Snapshot Generator ===");
  console.log(`  Base URL:  ${BASE_URL}`);
  console.log(`  Realm:     ${SNAPSHOT_REALM}`);
  console.log(`  League:    ${SNAPSHOT_LEAGUE}`);
  console.log(`  Output:    ${OUTPUT_PATH}`);
  console.log();

  const endpoints = getEndpoints(SNAPSHOT_REALM, SNAPSHOT_LEAGUE);
  const entries: Record<string, CacheSnapshotEntry> = {};
  const now = Date.now();
  let successCount = 0;
  let failCount = 0;

  for (const endpoint of endpoints) {
    const url = `${BASE_URL}${endpoint.path}`;
    try {
      const data = await fetchJSON<unknown>(url);
      entries[url] = { data, ts: now };
      successCount++;
      console.log(`  ✓ ${endpoint.label}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ ${endpoint.label}: ${msg}`);
      failCount++;

      if (endpoint.critical) {
        console.error(`\n  CRITICAL endpoint "${endpoint.label}" failed. Aborting.`);
        process.exit(1);
      }
    }
  }

  // ── Build snapshot ──

  const snapshot: CacheSnapshot = {
    version: 1,
    timestamp: new Date().toISOString(),
    entries,
  };

  // ── Check size ──

  const json = JSON.stringify(snapshot, null, 2);
  const sizeBytes = Buffer.byteLength(json, "utf-8");
  const sizeKB = (sizeBytes / 1024).toFixed(1);

  console.log();
  console.log(`  Results: ${successCount} succeeded, ${failCount} failed`);
  console.log(`  Snapshot size: ${sizeKB} KB`);

  if (sizeBytes > 500 * 1024) {
    console.warn(
      `\n  WARNING: Snapshot size (${sizeKB} KB) exceeds 500 KB limit. ` +
      `Consider reducing the data included.`
    );
  }

  // ── Write file ──

  const dir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(OUTPUT_PATH, json, "utf-8");
  console.log(`  ✓ Snapshot saved to ${OUTPUT_PATH}`);
  console.log();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
