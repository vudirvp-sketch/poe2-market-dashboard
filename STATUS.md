# STATUS.md — Known Issues & Product Features Backlog

> **Last updated:** 2026-06-25 (iter 76 — F4 widget shipped)
> Single source of truth for known bugs, refactoring priorities, and product-feature progress.
> Update BEFORE fixing any issue. Cross-reference issue IDs in commits.

---

## Technical-debt backlog — empty (P0–P4 all closed)

All P0/P1/P2/P3/P4 issues closed in iter 54–73. See `git log` for older history.

The single remaining **optional** technical follow-up:

> **`useDashboardData` hook extraction** (deferred from P2-1). `dashboard-page.tsx` is 1217 lines (was 1685 in iter 70). ~250 lines of `useQuery`/memo wiring could move into a hook. Approach in stages: (1) flipperBackend queries, (2) realms/leagues queries, (3) derived memos. Verify tsc + jest after each stage. Not blocking — file is now legitimate parent wiring.

---

## Product Features (F1–F6) — see `PRODUCT_VISION.md`

| Feature | Status | Notes |
|---------|--------|-------|
| **F1** — Translate remaining ~276 items | **Blocked** | Cache-snapshot has 138 unique api_ids, all already translated. The "276 missing" claim comes from the iter 32 baseline of 625 total API items — but without live `poe2scout.com` API access (to enumerate the full 625) + `poe2db.tw/ru/` parsing (to fetch RU names), we cannot reliably extend the map. Risk of adding wrong RU names is high — deferred until live API access is available. |
| **F2** — Storage Value UI tab | ✅ **Done (iter 74 + iter 75)** | Tab at `src/components/dashboard/storage-value-tab.tsx`. Historical chart at `src/components/dashboard/storage-value-history-chart.tsx` (iter 75) — wraps new endpoint `/api/v1/storage-value/{currency}/history`. |
| **F3** — `content_pulse` module | ✅ **Done (iter 75)** | `backend/economy/content_pulse.py` (pure function) + `backend/api/routes_content_pulse.py`. Endpoint `GET /api/v1/content-pulse` returns per-category daily turnover + 7d/30d rolling + signal + top-3 rising/falling movers. 44 pytest tests. |
| **F4** — «Что фармить сегодня» widget | ✅ **Done (iter 76)** | `src/components/dashboard/content-pulse-widget.tsx` (~400 lines). Wired into `overview-tab-content.tsx` ABOVE MarketOverview so it shows on first dashboard load. Two-column card: top rising categories (with top_rising items as rationale) + top falling categories (with top_falling items). Next.js proxy at `/api/flipper/content-pulse/route.ts`. 16 jest tests. Graceful degradation: offline / loading / error / no-data / no-signals / mixed. |
| **F5** — Speculation tab with z-score signals | TODO | BUY/SELL/HOLD signals with z-score vs 30-day rolling. Extends existing flips-tab. |
| **F6** — Phase-aware hints | TODO | Temporalis mid/late league, skill gems 18-20 lvl, etc. Uses `PhaseDetector` from `backend/economy/lifecycle.py`. |

---

## Quick Reference — Frequent Problems

| Symptom | Cause | Where to fix |
|---------|-------|--------------|
| `test_scheduler.py` collection fails | `aiosqlite` not installed in env | `pip install aiosqlite` (or run inside `.venv` created by `start.sh`) |
| `/optimizer/path` returns empty path with `data_available: true` | Profitable arbitrage cycle detected — fall back to `direct_rate` (P1-8) | `backend/api/routes_optimizer.py:_bellman_ford` |
| SQLite `near "LIMIT": syntax error` | Use `rowid IN (SELECT ... LIMIT ?)` pattern, not `DELETE ... LIMIT ?` | `backend/data/historical.py:_prune_old_league_data` |
| LightGBM skips training for new currency | Below `lightgbm_min_data_points` (15) — adaptive fallback now trains from `floor` (5) with minimal features (P2-9) | `backend/predictors/time_series.py:train` |
| Need to inspect circuit breaker state | `GET /api/flipper/health/circuit-breakers` returns JSON snapshot (P2-6) | `src/app/api/flipper/health/circuit-breakers/route.ts` |
| Adding a new Russian translation | Edit `backend/data/currency_names.json` (NOT the `.py` loader). Run `pytest tests/test_currency_names_ru.py`. | `backend/data/currency_names.json` |
| Storage Value tab shows "no price history" | Backend reachable but `price_histories[currency]` is empty for the requested api_id. Try `divine` / `exalted` / `chaos` first — they have the most trade history. | `backend/api/routes_storage_value.py:get_storage_value` |
| Storage Value history chart shows "no history" | Either the currency has <2 price points in the last 30 days, OR all mirror/hinekora ratios are null (mirror/hinekora not traded in the same window). | `backend/economy/storage_value_history.py:compute_storage_value_history` |
| `/api/v1/content-pulse` returns `data_available: false` | Snapshot not yet loaded, or no items in any configured category. Wait for the scheduler to populate `price_histories` from ByCategory. | `backend/api/routes_content_pulse.py:get_content_pulse` |
| Content Pulse `delta_7d_pct` is `null` | No historical price_logs for any item in that category — only today's volume is known. Not a bug — the rolling average needs ≥1 day of history. | `backend/economy/content_pulse.py:_rolling_mean` |
| Content Pulse widget shows "no signals today" | All categories have `signal="stable"` (|delta_7d_pct| < 10%). This is correct behavior — the widget only surfaces strong signals. Wait for the market to move or adjust `SIGNAL_RISING_THRESHOLD_PCT` / `SIGNAL_FALLING_THRESHOLD_PCT` constants in `content_pulse.py` if you want more sensitivity. | `backend/economy/content_pulse.py:_signal_from_delta` |
| Content Pulse widget shows "no movers" for a category | The category has a signal (rising/falling) but its individual items don't have ≥2 price points yet, so per-item trend can't be computed. Not a bug — will populate as the scheduler collects more data. | `backend/economy/content_pulse.py:_top_movers` |
