# STATUS.md — Known Issues & Product Features Backlog

> **Last updated:** 2026-06-25 (iter 74 — F2 Storage Value UI tab shipped)
> Single source of truth for known bugs, refactoring priorities, and product-feature progress.
> Update BEFORE fixing any issue. Cross-reference issue IDs in commits.

---

## Technical-debt backlog — empty (P0–P4 all closed)

All P0/P1/P2/P3/P4 issues closed in iter 54–73. See `git log` for older history.

The single remaining **optional** technical follow-up:

> **`useDashboardData` hook extraction** (deferred from P2-1). `dashboard-page.tsx` is 1216 lines (was 1685 in iter 70). ~250 lines of `useQuery`/memo wiring could move into a hook. Approach in stages: (1) flipperBackend queries, (2) realms/leagues queries, (3) derived memos. Verify tsc + jest after each stage. Not blocking — file is now legitimate parent wiring.

---

## Product Features (F1–F6) — see `PRODUCT_VISION.md`

| Feature | Status | Notes |
|---------|--------|-------|
| **F1** — Translate remaining ~276 items | **Blocked** | Cache-snapshot has 138 unique api_ids, all already translated. The "276 missing" claim comes from the iter 32 baseline of 625 total API items — but without live `poe2scout.com` API access (to enumerate the full 625) + `poe2db.tw/ru/` parsing (to fetch RU names), we cannot reliably extend the map. Risk of adding wrong RU names is high — deferred until live API access is available. |
| **F2** — Storage Value UI tab | ✅ **Done (iter 74)** | New tab at `src/components/dashboard/storage-value-tab.tsx`. Wraps the existing `/api/v1/storage-value/{currency}` endpoint. Lazy-loaded, ErrorBoundary-wrapped, full i18n (en/ru/zh/ko), 12 jest tests. Tab trigger added in `dashboard-toolbar.tsx` (Gem icon, after Analyst). |
| **F3** — `content_pulse` module | TODO | Turnover by mechanic, 7d/30d rolling. New `backend/economy/content_pulse.py` + `/api/v1/content-pulse` route. |
| **F4** — «Что фармить сегодня» widget | TODO | Card on the main dashboard: 1-2 rising + 1-2 falling mechanics with rationale. |
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
| Concurrent EventManager access raises `KeyError` / `dict changed size during iteration` | (Fixed iter 71 — was P3-3) All in-memory access now guarded by `threading.RLock` | `backend/economy/events.py` |
| `SnapshotManager.get_snapshot` fast-path returns stale snapshot paired with fresh ts | (Fixed iter 71 — was P3-4) `(snapshot, ts)` now wrapped in immutable `_SnapshotState` swapped atomically | `backend/api/data_snapshot.py` |
| `dashboard-page.tsx` still 1216 lines after iter 74 | Optional follow-up: extract `useDashboardData` hook. Not blocking. | `src/components/dashboard/dashboard-page.tsx` |
| Storage Value tab shows "no price history" | Backend reachable but `price_histories[currency]` is empty for the requested api_id. Try `divine` / `exalted` / `chaos` first — they have the most trade history. | `backend/api/routes_storage_value.py:get_storage_value` |
