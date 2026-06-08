#!/usr/bin/env node
/**
 * bump-sw-cache.js — Auto-bust Service Worker cache version.
 *
 * Reads public/sw.js, replaces the CACHE_NAME value with a new
 * timestamp-based version, and writes the file back. Run as a
 * postbuild step so every deploy gets a fresh cache.
 *
 * Usage:  node scripts/bump-sw-cache.js
 */
const fs = require("fs");
const path = require("path");

const SW_PATH = path.join(__dirname, "..", "public", "sw.js");

if (!fs.existsSync(SW_PATH)) {
  console.error("[bump-sw-cache] public/sw.js not found — skipping");
  process.exit(0);
}

const sw = fs.readFileSync(SW_PATH, "utf8");
const version = `v${Date.now()}`;
const updated = sw.replace(
  /const CACHE_NAME = 'poe2-market-[^']+';/,
  `const CACHE_NAME = 'poe2-market-${version}';`
);

if (updated === sw) {
  console.warn("[bump-sw-cache] CACHE_NAME pattern not found — no change made");
  process.exit(0);
}

fs.writeFileSync(SW_PATH, updated, "utf8");
console.log(`[bump-sw-cache] Cache version bumped to: poe2-market-${version}`);
