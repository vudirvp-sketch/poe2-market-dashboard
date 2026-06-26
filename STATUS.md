# STATUS.md — Known Issues & Product Features Backlog

> **Last updated:** 2026-06-26 (iter 95 — TD-2 fix + Overheat Index Q13)
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
| **TD-3** | P3 | Triangular arbitrage no persistence. Cannot backtest executable_estimate. iter 96. |
| **TD-4** | P3 | `market_spread` not persisted in HistoricalStore. iter 96. |
| **TD-5** | P3 | `DailyStatsHistory` POE2Scout endpoint (ready OHLCV) not used. |
| **TD-6** | P3 | `highest_stock` + `current_quantity` not used for Wall detection. |
| **TD-7** | P3 | `PriceMomentumTracker` momentum + volatility computed but not shown. |
| **TD-8** | P3 | Tier classification (T1-T5) not shown anywhere. |
| **TD-9** | P3 | FlipsTable "Trend" sparkline uses a derived `momentum × volatility` indicator. When backend adds `priceHistoryShort` to `FlipOpportunity`, switch to real data — only `flips-helpers.ts:deriveTrendSparklineData` needs replacing with a passthrough. |

TD-1 closed in iter 92 (FlipsTable 5 new columns). TD-2 closed in iter 95 (Overheat Index — see below).

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
| **iter 94** | ✅ Done | **KI-10 fix + Spread Capture view.** `tsc --noEmit` green. Q4/Q5/Q6 + new TD-9. |
| **iter 95** | ✅ **Done** | **TD-2 fix + Overheat Index (Q13).** `content_pulse._category_today_volume()` now uses `volume_traded` (activity) instead of `current_quantity` (supply) — semantically consistent with `rolling_7d`/`rolling_30d`. New backend fields: `overheat_index` (0-100), `overheat_signal` (`hot`/`warm`/`cool`), `volume_spike_ratio`, `price_change_pct`. New UI: orange "Overheated" / amber "Warming up" badge on Content Pulse categories (only when signal ≠ cool), with tooltip showing the volume_spike_ratio + price_change_pct breakdown. 4 new i18n keys × 4 locales = 16 lines. 38 new Python tests (44→82) + 4 new jest tests (428→432). |

---

## Quick Reference — Frequent Problems

| Symptom | Cause | Where to fix |
|---------|-------|--------------|
| `test_scheduler.py` collection fails | `aiosqlite` not installed in env | `pip install aiosqlite` |
| `/optimizer/path` returns empty path with `data_available: true` | Profitable arbitrage cycle detected — fall back to `direct_rate` | `backend/api/routes_optimizer.py:_bellman_ford` |
| SQLite `near "LIMIT": syntax error` | Use `rowid IN (SELECT ... LIMIT ?)` pattern | `backend/data/historical.py:_prune_old_league_data` |
| LightGBM skips training for new currency | Below `lightgbm_min_data_points` (15) | `backend/predictors/time_series.py:train` |
| Keyboard shortcut "5" goes to Flips, not Arbitrage | By design (iter 92 KI-7) — dead "arbitrage" tab removed from TAB_MAP. | `dashboard-page.tsx:TAB_MAP`, `shortcuts-dialog.tsx` |
| Watchlist P&L shows same value as Change | Pre-iter 92 behavior. After iter 92, new entries track entry price. Old entries still show changePercent as fallback. | `watchlist-tab.tsx`, `store.ts:WatchlistEntry.entryPrice` |
| Exchange tab shows "Best Payment" strip at the top | By design (iter 93) — top-10 cards strip with savings ≥1%. Hidden when no opportunities exist. | `exchange-tab-content.tsx`, `best-payment-top-list.tsx` |
| Best Payment badge doesn't appear on a pair | By design (iter 93, Q3) — pairs with `savingsPct < 1` are hidden in both `BestPaymentBadge` and the top-list. | `best-payment-badge.tsx:40`, `use-optimal-payment.ts:BEST_PAYMENT_MIN_SAVINGS_PCT` |
| Craft items (Ritual Omens, Soul Cores) appear in Best Payment | By design (iter 93, Q2) — the hook groups by `currency1Id`, which covers all priced items including `ritual` / `ultimatum` / `idol` / `vaultkeys` / `delirium` categories. | `use-optimal-payment.ts:bestPaymentTopList`, `currency-optimal.ts:ITEM_CATEGORIES` |
| FlipsTable "Trend" sparkline looks synthetic | By design (iter 94, Q5) — derived from `momentum × volatility` (NOT historical price data). Tooltip explicitly states this. Switches to real data when backend adds `priceHistoryShort` (TD-9). | `flips-helpers.ts:deriveTrendSparklineData`, `flips-table.tsx:Trend column` |
| FlipsTable Spread cell color changes | By design (iter 94, Q4) — emerald ≥5% (wide), amber 2-5% (medium), muted <2% (tight). Same thresholds power the "Spread tier" filter dropdown. | `flips-helpers.ts:classifySpreadTier`, `flips-tab.tsx:spreadTierFilter` |
| Content Pulse shows orange "Overheated" / amber "Warming up" badge | By design (iter 95, Q13) — Overheat Index = volume spike (today > 2x rolling 7d) AND price drop (< -5%) → "hot"; only one condition → "warm"; neither → "cool" (no badge). Tooltip shows the breakdown. | `backend/economy/content_pulse.py:_overheat_signal`, `content-pulse-widget.tsx:Overheat badge` |
| Content Pulse `today_volume` differs from before iter 95 | By design (iter 95, TD-2 fix) — was `current_quantity` (supply metric), now `volume_traded` (activity metric, summed across all `snapshot.exchange_rates` pairs containing the currency). Semantically consistent with `rolling_7d`/`rolling_30d` (also activity metrics). | `backend/economy/content_pulse.py:_category_today_volume` |
