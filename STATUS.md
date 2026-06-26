# STATUS.md — Known Issues & Product Features Backlog

> **Last updated:** 2026-06-26 (iter 94 — KI-10 fix + Spread Capture view)
> Single source of truth for known bugs, refactoring priorities, and product-feature progress.
> Update BEFORE fixing any issue. Cross-reference issue IDs in commits.

---

## Known Issues — open

_None._ All previously open KIs are closed.

---

## Known Issues — closed

All previously open KIs (KI-1 through KI-10) closed in iter 88-94. See git log for details.

---

## Technical-debt backlog — open

| ID | Priority | Notes |
|----|----------|-------|
| **TD-2** | P2 | `content_pulse._category_today_volume()` uses `current_quantity` (listings) — should use `volume_traded` for "Overheat Index". Fix in iter 95. |
| **TD-3** | P3 | Triangular arbitrage no persistence. Cannot backtest executable_estimate. iter 96. |
| **TD-4** | P3 | `market_spread` not persisted in HistoricalStore. iter 96. |
| **TD-5** | P3 | `DailyStatsHistory` POE2Scout endpoint (ready OHLCV) not used. |
| **TD-6** | P3 | `highest_stock` + `current_quantity` not used for Wall detection. |
| **TD-7** | P3 | `PriceMomentumTracker` momentum + volatility computed but not shown. |
| **TD-8** | P3 | Tier classification (T1-T5) not shown anywhere. |
| **TD-9** | P3 | **iter 94 added:** FlipsTable "Trend" sparkline column uses a derived `momentum × volatility` indicator (clearly labeled in tooltip as "NOT historical"). When backend adds `priceHistoryShort` to `FlipOpportunity` (per-pair recent price points), the column can switch to real data without UI changes — only `flips-helpers.ts:deriveTrendSparklineData` needs to be replaced with a passthrough. |

TD-1 closed in iter 92 (FlipsTable 5 new columns).

---

## Product Features (F1–F6) — see `PRODUCT_VISION.md`

| Feature | Status | Notes |
|---------|--------|-------|
| **F1** — Translate remaining items | ✅ Done (iter 85 + 86) | |
| **F2** — Storage Value UI tab | ✅ Done (iter 74 + 75) | |
| **F3** — `content_pulse` module | ✅ Done (iter 75) | |
| **F4** — «Что фармить сегодня» widget | ✅ Done (iter 76) | |
| **F5** — Speculation tab | ✅ Done (iter 77 + 79 + 80 + 88) | |
| **F6** — Phase-aware hints | ✅ Done (iter 78 + 87) | |
| **iter 90–91** | ✅ Done (recon) | 14 clarifying questions + POE2Scout API capability map |
| **iter 92** | ✅ Done | KI-7/8/9 fixes + TD-1 (5 FlipsTable columns) + entry price tracking |
| **iter 93** | ✅ Done | **Best Payment primary view** on Exchange — top-10 cards strip. 13 new i18n keys × 4 locales. |
| **iter 94** | ✅ **Done** | **KI-10 fix + Spread Capture view.** `tsc --noEmit` now green (0 errors). Q4 (Spread tier filter + color-coded Spread cell), Q5 (Trend sparkline column — derived from momentum × volatility, honestly labeled), Q6 (spread-capture-intent tooltips on Spread + Profit columns). 7 new i18n keys × 4 locales = 28 lines. 16 new jest tests (428/428 green). New TD-9 (real sparkline needs backend `priceHistoryShort`). |

---

## Quick Reference — Frequent Problems

| Symptom | Cause | Where to fix |
|---------|-------|--------------|
| `tsc --noEmit` fails with TS1117 on `flipsBid` / `flipsAsk` | **FIXED iter 94 (KI-10 closed)** — old "Bid"/"Ask" entries at lines 379-380 deleted from all 4 locale files. New "Buy at"/"Sell at" entries (with tooltips) preserved. | Historical: `src/lib/i18n/locales/{en,ru,zh,ko}.ts` |
| `test_scheduler.py` collection fails | `aiosqlite` not installed in env | `pip install aiosqlite` |
| `/optimizer/path` returns empty path with `data_available: true` | Profitable arbitrage cycle detected — fall back to `direct_rate` | `backend/api/routes_optimizer.py:_bellman_ford` |
| SQLite `near "LIMIT": syntax error` | Use `rowid IN (SELECT ... LIMIT ?)` pattern | `backend/data/historical.py:_prune_old_league_data` |
| LightGBM skips training for new currency | Below `lightgbm_min_data_points` (15) | `backend/predictors/time_series.py:train` |
| Keyboard shortcut "5" goes to Flips, not Arbitrage | By design (iter 92 KI-7) — dead "arbitrage" tab removed from TAB_MAP. | `dashboard-page.tsx:TAB_MAP`, `shortcuts-dialog.tsx` |
| Watchlist P&L shows same value as Change | Pre-iter 92 behavior. After iter 92, new entries track entry price. Old entries still show changePercent as fallback. | `watchlist-tab.tsx`, `store.ts:WatchlistEntry.entryPrice` |
| Exchange tab shows "Best Payment" strip at the top | By design (iter 93) — top-10 cards strip with savings ≥1%. Hidden when no opportunities exist. | `exchange-tab-content.tsx`, `best-payment-top-list.tsx` |
| Best Payment badge doesn't appear on a pair | By design (iter 93, Q3) — pairs with `savingsPct < 1` are hidden in both `BestPaymentBadge` and the top-list. | `best-payment-badge.tsx:40`, `use-optimal-payment.ts:BEST_PAYMENT_MIN_SAVINGS_PCT` |
| Craft items (Ritual Omens, Soul Cores) appear in Best Payment | By design (iter 93, Q2) — the hook groups by `currency1Id`, which covers all priced items including `ritual` / `ultimatum` / `idol` / `vaultkeys` / `delirium` categories. | `use-optimal-payment.ts:bestPaymentTopList`, `currency-optimal.ts:ITEM_CATEGORIES` |
| FlipsTable "Trend" sparkline looks synthetic | By design (iter 94, Q5) — derived from `momentum × volatility` (NOT historical price data). Tooltip explicitly states this. When backend adds `priceHistoryShort` (TD-9), the column will switch to real data without UI changes. | `flips-helpers.ts:deriveTrendSparklineData`, `flips-table.tsx:Trend column` |
| FlipsTable Spread cell color changes | By design (iter 94, Q4) — emerald ≥5% (wide), amber 2-5% (medium), muted <2% (tight). Same thresholds power the "Spread tier" filter dropdown in the filter row. | `flips-helpers.ts:classifySpreadTier`, `flips-tab.tsx:spreadTierFilter` |
