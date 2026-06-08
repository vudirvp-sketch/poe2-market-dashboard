#!/usr/bin/env tsx
// ============================================================================
// Live Data Dump Utility
//
// Fetches live data from the POE2Scout API and saves it as JSON fixtures
// that can be used for testing and development without VPN/API access.
//
// This script is designed to be run with VPN when the POE2Scout API is
// accessible. It dumps:
//   1. SnapshotPairs (full, not truncated) — for item-aware grouping tests
//   2. Exchange rates with category metadata — for backend integration tests
//   3. Category list — to verify which categories POE2Scout supports
//
// Usage (with VPN):
//   npx tsx scripts/dump-live-data.ts
//
// Environment variables:
//   POE2_API_BASE_URL — Override the API base URL
//   POE2_SNAPSHOT_REALM — Realm (default: "poe2")
//   POE2_SNAPSHOT_LEAGUE — League (default: "runes")
//   POE2_DUMP_DIR — Output directory (default: "tests/fixtures")
// ============================================================================

import * as fs from "fs";
import * as path from "path";

// ---------- Configuration ----------

const BASE_URL = process.env.POE2_API_BASE_URL || "https://api.poe2scout.com/api";
const SNAPSHOT_REALM = process.env.POE2_SNAPSHOT_REALM || "poe2";
const SNAPSHOT_LEAGUE = process.env.POE2_SNAPSHOT_LEAGUE || "runes";
const DUMP_DIR = process.env.POE2_DUMP_DIR || path.resolve(__dirname, "../tests/fixtures");
const FETCH_TIMEOUT = 30_000;

// ---------- Fetch helper ----------

async function fetchJSON<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  try {
    console.log(`  Fetching: ${url}`);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "PoE2-Market-Dashboard-DumpUtil/1.0",
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

// ---------- Helper: write JSON file ----------

function writeJSON(filename: string, data: unknown): void {
  const dir = path.dirname(filename);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filename, JSON.stringify(data, null, 2), "utf-8");
  const sizeKB = (Buffer.byteLength(JSON.stringify(data), "utf-8") / 1024).toFixed(1);
  console.log(`  ✓ Saved: ${filename} (${sizeKB} KB)`);
}

// ---------- Main ----------

async function main(): Promise<void> {
  console.log("=== POE2 Market Dashboard — Live Data Dump Utility ===");
  console.log(`  Base URL:  ${BASE_URL}`);
  console.log(`  Realm:     ${SNAPSHOT_REALM}`);
  console.log(`  League:    ${SNAPSHOT_LEAGUE}`);
  console.log(`  Output:    ${DUMP_DIR}`);
  console.log();

  const leaguePath = `${SNAPSHOT_REALM}/Leagues/${SNAPSHOT_LEAGUE}`;

  // 1. Dump categories (to verify which item categories exist)
  console.log("\n--- Categories ---");
  try {
    const categories = await fetchJSON<unknown>(`${BASE_URL}/${leaguePath}/Items/Categories`);
    writeJSON(path.join(DUMP_DIR, "categories.json"), categories);
  } catch (err) {
    console.error(`  ✗ Categories: ${err instanceof Error ? err.message : err}`);
  }

  // 2. Dump full SnapshotPairs (not truncated — for item-aware grouping tests)
  console.log("\n--- SnapshotPairs (full) ---");
  try {
    const pairs = await fetchJSON<unknown>(`${BASE_URL}/${leaguePath}/SnapshotPairs`);
    const pairsArray = Array.isArray(pairs) ? pairs : [];
    
    // Categorize pairs by CurrencyOne.CategoryApiId
    const itemCategoryPairs: Record<string, unknown[]> = {};
    const currencyPairs: unknown[] = [];
    
    for (const pair of pairsArray) {
      const p = pair as Record<string, unknown>;
      const c1 = p.CurrencyOne as Record<string, unknown> | undefined;
      const catId = (c1?.CategoryApiId as string) || "unknown";
      
      if (["ritual", "ultimatum", "idol", "vaultkeys", "delirium"].includes(catId)) {
        if (!itemCategoryPairs[catId]) itemCategoryPairs[catId] = [];
        itemCategoryPairs[catId].push(pair);
      } else {
        currencyPairs.push(pair);
      }
    }
    
    console.log(`  Total pairs: ${pairsArray.length}`);
    console.log(`  Currency pairs: ${currencyPairs.length}`);
    for (const [cat, items] of Object.entries(itemCategoryPairs)) {
      console.log(`  ${cat} pairs: ${items.length}`);
    }
    
    // Save full dump
    writeJSON(path.join(DUMP_DIR, "snapshot-pairs-full.json"), pairs);
    
    // Save item-category pairs separately (smaller, focused)
    if (Object.keys(itemCategoryPairs).length > 0) {
      writeJSON(path.join(DUMP_DIR, "item-category-pairs.json"), itemCategoryPairs);
    }
    
    // Save first 30 currency pairs (for regular tests)
    writeJSON(path.join(DUMP_DIR, "currency-pairs-sample.json"), currencyPairs.slice(0, 30));
  } catch (err) {
    console.error(`  ✗ SnapshotPairs: ${err instanceof Error ? err.message : err}`);
  }

  // 3. Dump item-category ByCategory data (all 5 item categories)
  // Must stay in sync with config.yaml → league.item_categories and
  // currency-optimal.ts → ITEM_CATEGORIES.
  console.log("\n--- Item Category Data ---");
  for (const category of ["ritual", "ultimatum", "idol", "vaultkeys", "delirium"]) {
    try {
      const data = await fetchJSON<unknown>(
        `${BASE_URL}/${leaguePath}/Currencies/ByCategory?Category=${category}&Page=1&PerPage=50`
      );
      writeJSON(path.join(DUMP_DIR, `bycategory-${category}.json`), data);
    } catch (err) {
      console.error(`  ✗ ByCategory(${category}): ${err instanceof Error ? err.message : err}`);
    }
  }

  // 4. Dump reference currencies
  console.log("\n--- Reference Currencies ---");
  try {
    const refCurrencies = await fetchJSON<unknown>(`${BASE_URL}/${leaguePath}/ReferenceCurrencies`);
    writeJSON(path.join(DUMP_DIR, "reference-currencies.json"), refCurrencies);
  } catch (err) {
    console.error(`  ✗ ReferenceCurrencies: ${err instanceof Error ? err.message : err}`);
  }

  console.log("\n=== Dump complete ===");
  console.log(`  Files saved to: ${DUMP_DIR}`);
  console.log("\n  IMPORTANT: These fixtures contain live market data.");
  console.log("  Do NOT commit them to the public repo if they contain");
  console.log("  sensitive data. Add tests/fixtures/ to .gitignore if needed.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
