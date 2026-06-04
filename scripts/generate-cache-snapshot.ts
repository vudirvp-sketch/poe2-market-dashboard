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
//   POE2_SNAPSHOT_LEAGUE — League to snapshot (default: "runes")
// ============================================================================

import * as fs from "fs";
import * as path from "path";

// ---------- Configuration ----------

const BASE_URL = process.env.POE2_API_BASE_URL || "https://api.poe2scout.com/api";
const SNAPSHOT_REALM = process.env.POE2_SNAPSHOT_REALM || "poe2";
const SNAPSHOT_LEAGUE = process.env.POE2_SNAPSHOT_LEAGUE || "runes";
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
    // NOTE: Reduced from PerPage=250 to PerPage=50 to keep snapshot under 500 KB.
    // 50 items is enough for the initial dashboard display; the rest will be
    // fetched on-demand once the user navigates to the Currencies tab.
    { path: `/${realm}/Leagues/${league}/Currencies/ByCategory?Category=currency&Page=1&PerPage=50`, label: "Currencies ByCategory (currency)" },

    // ── Items ──
    // NOTE: The /Items endpoint returns ALL items in a flat array (ignores
    // pagination params).  With 1200+ items it takes ~437 KB which exceeds
    // our 500 KB budget.  We include it as a non-critical endpoint and
    // post-process it below to keep only the first 25 items in the snapshot.
    // The full dataset will be fetched on-demand once the API is reachable.
    { path: `/${realm}/Leagues/${league}/Items?Page=1&PerPage=25`, label: "Items (truncated)" },
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

  // ── Post-process: fix known /Realms bugs and truncate large arrays ──

  for (const [url, entry] of Object.entries(entries)) {
    // Fix: POE2Scout /Realms returns stale default_league_value (e.g. "Fate of the Vaal"
    // or "vaal" instead of "runes" for poe2). Override in the snapshot so the
    // dashboard has the correct value even when /Realms data is stale.
    //
    // IMPORTANT: Use the ShortName format ("runes") not the displayName ("Runes of Aldur").
    // The getLeagues() function matches defaultLeagueValue against BOTH l.Value
    // and l.ShortName, but getRealms() passes defaultLeague directly to the store.
    // Using ShortName format ensures consistency with FALLBACK_REALMS and
    // DEFAULT_LEAGUE_OVERRIDES in poe2api.ts, which all use ShortName format.
    if (url.includes("/Realms") && Array.isArray(entry.data)) {
      const realms = entry.data as Array<Record<string, unknown>>;
      // Known stale/incorrect default_league_value formats returned by POE2Scout /Realms:
      // - "Fate of the Vaal" (stale displayName from previous league)
      // - "vaal" (stale ShortName from previous league)
      // - "Runes of Aldur" (current displayName — correct league but wrong format;
      //   should be ShortName "runes" for consistency with FALLBACK_REALMS,
      //   DEFAULT_LEAGUE_OVERRIDES, and getLeagues() matching logic)
      const STALE_VALUES = new Set(["Fate of the Vaal", "vaal", "Runes of Aldur"]);
      for (const realm of realms) {
        if (realm.realm_api_id === "poe2" &&
            typeof realm.default_league_value === "string" &&
            STALE_VALUES.has(realm.default_league_value)) {
          console.log(`  Fixed default_league_value "${realm.default_league_value}" → "runes" for poe2 realm`);
          realm.default_league_value = "runes";
        }
      }
    }

    // The /Items endpoint returns ALL items (ignores pagination).
    // Truncate to 25 items to stay under the size budget.
    if (url.includes("/Items?") && Array.isArray(entry.data)) {
      const original = (entry.data as unknown[]).length;
      if (original > 25) {
        (entry as { data: unknown[] }).data = (entry.data as unknown[]).slice(0, 25);
        console.log(`  Truncated /Items from ${original} to 25 entries`);
      }
    }

    // The /SnapshotPairs endpoint can return hundreds of pairs (each with
    // nested fields). Truncate to 30 pairs — enough for the initial
    // exchange view; the rest will be fetched on-demand.
    if (url.includes("/SnapshotPairs") && Array.isArray(entry.data)) {
      const original = (entry.data as unknown[]).length;
      if (original > 30) {
        (entry as { data: unknown[] }).data = (entry.data as unknown[]).slice(0, 30);
        console.log(`  Truncated /SnapshotPairs from ${original} to 30 entries`);
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
