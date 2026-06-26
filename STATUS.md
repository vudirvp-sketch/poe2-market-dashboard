# STATUS.md — Known Issues & Product Features Backlog

> **Last updated:** 2026-06-26 (iter 92 — KI-7/8/9 fixes + TD-1 FlipsTable columns + entry price tracking)
> Single source of truth for known bugs, refactoring priorities, and product-feature progress.
> Update BEFORE fixing any issue. Cross-reference issue IDs in commits.

---

## Known Issues — open

All previously open KIs (KI-7 through KI-9) were **closed in iter 92**. No new open KIs.

---

## Known Issues — closed in iter 92

| ID | Status | Notes |
|----|--------|-------|
| **KI-7** | ✅ Closed (iter 92) | Removed dead `"arbitrage"` and `"graph"` from `TAB_MAP` in `dashboard-page.tsx:536`. Cleaned up `store.ts:validTabs` — removed `"arbitrage", "forecast", "portfolio", "graph"`, added `"storage-value", "speculation", "liquid-chain"`. Updated `shortcuts-dialog.tsx` — shortcut "5" now maps to Flips (was dead "arbitrage"), "0" maps to Liquid Chain. All 10 shortcuts now work. |
| **KI-8** | ✅ Closed (iter 92) | Watchlist `pnl` column now computes real P&L from entry price tracking. Added `entryPrice` field to `WatchlistEntry` interface. Store version bumped to v5. `toggleExchangeFavorite` now accepts optional `entryPrice` param. All 3 callers (exchange-table, exchange-pair-card, watchlist-tab) pass `pair.relativePrice`. For existing entries without entry price, falls back to `changePercent`. |
| **KI-9** | ✅ Closed (iter 92) | Cross-rate threshold unified to 7%: backend `routes_arbitrage.py` (was 10%), `triangular.py` default (was 10.0), frontend `use-cross-rates.ts` (was 5%). `affectedCurrencies` now truncated to top-5 + `"and N more"` + `affected_currencies_total` field. |

All earlier issues (KI-1 – KI-6) closed in iter 88–89. KI-7/8/9 closed in iter 92.

---

## Technical-debt backlog — open

| ID | Priority | Notes |
|----|----------|-------|
| **TD-1** | ~~P2~~ ✅ Closed (iter 92) | FlipsTable now shows all 5 backend fields: volume24h, bid, ask, deviationPct, fairRate. See iter 92 row in Product Features. |
| **TD-2** | P2 | `content_pulse._category_today_volume()` uses `current_quantity` (listings) — should use `volume_traded` for "Overheat Index". Fix in iter 95. |
| **TD-3** | P3 | Triangular arbitrage no persistence. Cannot backtest executable_estimate. iter 96. |
| **TD-4** | P3 | `market_spread` not persisted in HistoricalStore. iter 96. |
| **TD-5** | P3 | `DailyStatsHistory` POE2Scout endpoint (ready OHLCV) not used. |
| **TD-6** | P3 | `highest_stock` + `current_quantity` not used for Wall detection. |
| **TD-7** | P3 | `PriceMomentumTracker` momentum + volatility computed but not shown. |
| **TD-8** | P3 | Tier classification (T1-T5) not shown anywhere. |

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
| **iter 87–89** | ✅ Done | i18n cleanup + KI-6 fix + dead code removal |
| **iter 90** | ✅ Done (recon) | 14 clarifying questions (Q1-Q14) |
| **iter 91** | ✅ Done (recon) | POE2Scout API capability map + iter 90 critique + KI-7/8/9 + TD-1 through TD-8 |
| **iter 92** | ✅ **Done** | **KI-7:** Removed dead `arbitrage`+`graph` from TAB_MAP + cleaned validTabs + fixed shortcuts. **KI-8:** Watchlist entry price tracking — real P&L from `entryPrice`. **KI-9:** Cross-rate threshold unified to 7% (backend+frontend) + `affectedCurrencies` truncated to top-5 + `"and N more"`. **TD-1:** Added 5 columns to FlipsTable (volume24h, bid, ask, deviationPct, fairRate) with intuitive i18n labels in 4 locales. Store version v4→v5. |

---

## Quick Reference — Frequent Problems

| Symptom | Cause | Where to fix |
|---------|-------|--------------|
| `test_scheduler.py` collection fails | `aiosqlite` not installed in env | `pip install aiosqlite` |
| `/optimizer/path` returns empty path with `data_available: true` | Profitable arbitrage cycle detected — fall back to `direct_rate` | `backend/api/routes_optimizer.py:_bellman_ford` |
| SQLite `near "LIMIT": syntax error` | Use `rowid IN (SELECT ... LIMIT ?)` pattern | `backend/data/historical.py:_prune_old_league_data` |
| LightGBM skips training for new currency | Below `lightgbm_min_data_points` (15) | `backend/predictors/time_series.py:train` |
| Keyboard shortcut "5" goes to Flips, not Arbitrage | By design (iter 92 KI-7) — dead "arbitrage" tab removed from TAB_MAP. Shortcut "5" now correctly maps to Flips. | `dashboard-page.tsx:TAB_MAP`, `shortcuts-dialog.tsx` |
| Keyboard shortcut "0" goes to Liquid Chain, not Speculation | By design (iter 92 KI-7) — TAB_MAP shrunk from 13 to 11 entries. Speculation moved to shortcut "9". | `dashboard-page.tsx:TAB_MAP`, `shortcuts-dialog.tsx` |
| Watchlist P&L shows same value as Change | Pre-iter 92 behavior. After iter 92, new entries track entry price. Old entries still show changePercent as fallback. Remove + re-add the pair to start tracking entry price. | `watchlist-tab.tsx`, `store.ts:WatchlistEntry.entryPrice` |
| FlipsTable doesn't show volume24h/bid/ask/deviationPct/fairRate | Pre-iter 92 behavior. After iter 92, these columns appear on large screens (lg+). Hidden on mobile/tablet to avoid overflow. | `flips-table.tsx` |
| Cross-rate warning shows 7% threshold instead of 10% | By design (iter 92 KI-9) — threshold unified to 7% both sides. | `routes_arbitrage.py:824`, `use-cross-rates.ts:126` |
| `affectedCurrencies` list truncated | By design (iter 92 KI-9) — now shows top-5 + "and N more" + `affected_currencies_total`. | `routes_arbitrage.py:836-843` |
