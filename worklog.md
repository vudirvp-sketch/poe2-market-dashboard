# Worklog — PoE2 Market Dashboard

> Append-only shared multi-agent work log. Each section starts with `---`.
> Old task history is in `git log`.

Recent iterations kept (iter 92+). Older iter 89-91 records trimmed — those features are fully shipped and documented in STATUS.md / AGENT_NAVIGATION.md.

---
Task ID: iter-92
Agent: main
Task: iter 92 — Implement KI-7/8/9 fixes + TD-1 (5 hidden FlipsTable columns). User provided answers to 14 questions from iter 90.

Work Log:
- Cloned repo to `/home/z/my-project/poe2-market-dashboard`. Read STATUS.md, AGENT_NAVIGATION.md, worklog.md.
- Read key source files: dashboard-page.tsx (TAB_MAP), store.ts (validTabs + WatchlistEntry), flips-table.tsx, flips-helpers.ts, types.ts, watchlist-tab.tsx, use-cross-rates.ts, routes_arbitrage.py, triangular.py, shortcuts-dialog.tsx, exchange-table.tsx, exchange-pair-card.tsx, 4 locale files.
- **KI-7 (dead TAB_MAP slots):** Removed `"arbitrage"` (was idx 4, shortcut "5" silently did nothing) and `"graph"` (was idx 11, dead since iter 87) from TAB_MAP. TAB_MAP shrunk from 13 to 11 entries. All 10 keyboard shortcuts (1-9 + 0) now map to live tabs. Updated `store.ts:validTabs` — removed dead `"arbitrage", "forecast", "portfolio", "graph"`, added missing `"storage-value", "speculation", "liquid-chain"`. Updated `shortcuts-dialog.tsx` tab mapping display.
- **TD-1 (FlipsTable hidden columns):** Added 5 columns to FlipsTable: volume24h (with BarChart3 icon), bid ("Buy at"), ask ("Sell at"), deviationPct ("Deviation"), fairRate ("Fair rate"). All with intuitive i18n labels + tooltips in 4 locales (en/ru/zh/ko). Columns hidden on smaller screens (lg for most, xl for fairRate). Added SortField types for bid, ask, deviationPct, fairRate. Grid expanded from 12 to 17 columns.
- **KI-8 (Watchlist pnl/change duplicate):** Implemented entry price tracking. Added `entryPrice?: number | null` to `WatchlistEntry` interface. Store version v4 → v5. `toggleExchangeFavorite` now accepts optional `entryPrice` param. All 3 callers (exchange-table, exchange-pair-card, watchlist-tab) now pass `pair.relativePrice` as entry price. P&L column computes real `(currentPrice - entryPrice) / entryPrice * 100` when entry price is tracked; falls back to changePercent for legacy entries. Added `updateWatchlistEntryPrice` store action. P&L sort also uses real P&L.
- **KI-9 (cross-rate threshold + affectedCurrencies):** Unified threshold to 7% on all 3 locations: backend `routes_arbitrage.py:824` (was 10.0), `triangular.py:486` default (was 10.0), frontend `use-cross-rates.ts:126` (was 5). Truncated `affectedCurrencies` to top-5 + `"and N more"` string + added `affected_currencies_total` field. Updated docstrings in triangular.py.
- Updated documentation: STATUS.md (closed KI-7/8/9 + TD-1, added iter 92 row, updated Quick Reference), AGENT_NAVIGATION.md (pending), worklog.md (this entry).

Stage Summary:
- **iter 92 SHIPPED — 5 bug fixes + 1 feature exposure.**
- Files changed (17 total):
  - `dashboard-page.tsx` (TAB_MAP cleanup)
  - `store.ts` (validTabs + WatchlistEntry.entryPrice + v5 migration + toggleExchangeFavorite signature + updateWatchlistEntryPrice)
  - `shortcuts-dialog.tsx` (tab mapping)
  - `flips-table.tsx` (5 new columns + expanded grid)
  - `flips-helpers.ts` (4 new SortField types)
  - `watchlist-tab.tsx` (real P&L display + entry price tracking)
  - `exchange-table.tsx` (pass entryPrice)
  - `exchange-pair-card.tsx` (pass entryPrice)
  - `use-cross-rates.ts` (threshold 5→7)
  - `routes_arbitrage.py` (threshold 10→7 + affectedCurrencies truncation)
  - `triangular.py` (threshold 10.0→7.0 + docstrings)
  - 4 i18n locale files (en/ru/zh/ko — new keys for 5 columns)
  - 3 docs (STATUS.md, AGENT_NAVIGATION.md, worklog.md)

Next iteration (iter 93) — recommended priorities based on user's Q1-Q14 answers:
1. **iter 93 = Best Payment primary view** (Q1: "Пример А" — Exchange открывается с топ-10 "Pay in Divine, save 47%"). Q2: "для всего" (currencies + uniques + craft items). Q3: "скрывать" (<1% savings hidden).
2. **iter 94 = Spread Capture view** (Q4: "C" — colors/filter inside Flips table). Q5: sparkline. Q6: intuitive labels.
3. **iter 95 = Overheat Index** (Q13: indirect signals — streamer influence → volume spike → price drop).
