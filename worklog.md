# Work Log

> Single source for recent task entries. Long history removed — see git log for details.
> Append new entries at the bottom. Keep ≤5 latest entries.

---

## Task 60 — P2-11 (orphan root files cleanup)
**Agent:** Main Agent
**Date:** 2026-06-20

**Task:** Per iter 59 stopping point + REFACTOR_PLAN.md v24 §"Recommended Fix Order": P2-11 — `git rm` 10 orphan root-level files accidentally committed in iter 58. Restores "tsc: clean" + "jest: clean" baseline. Zero code changes — only deletions. P1-7 (EventManager async) was considered for batching per user hint, but DEFERRED to iter 61 because it touches 5 sync methods + all callers in `routes_events.py` + tests — too broad for safe batch.

**Work Log:**
- Re-read STATUS.md (iter 59), REFACTOR_PLAN.md v24, worklog.md (iter 59 entry).
- Verified all 10 orphan files present at repo root: `dashboard-page.tsx`, `events-sidebar.spec.ts`, `providers.tsx`, `route.ts`, `use-price-stream.ts`, `main.py`, `routes_sse.py`, `historical.py`, `test_lifecycle.py`, `test_optimal_currency.py`.
- Diffed each orphan vs its canonical copy: 3 identical (`events-sidebar.spec.ts`, `providers.tsx`, `test_optimal_currency.py` — pure dead duplicates), 7 differ (orphan = older stale version, canonical under `src/`/`backend/`/`tests/`/`e2e/` is the live one).
- Statically verified no source code imports the orphan root files: searched for `from './dashboard-page'`, `from './providers'`, `from './route'`, `from './use-price-stream'`, `from main import`, `from routes_sse import`, `from historical import`, etc. — no matches.
- Verified `tsconfig.json` includes `**/*.ts(x)` → root `.ts`/`.tsx` files were being type-checked (cause of 2 tsc errors). Verified `jest.config.ts` doesn't exclude root → root `events-sidebar.spec.ts` was being collected (cause of 1 failing jest suite). Verified `pytest.ini` has `testpaths = tests` → root `.py` files were never collected by pytest (no impact).
- Executed `git rm` on all 10 files. Staged for commit.
- Installed minimal TypeScript + jest deps (`typescript@5`, `ts-jest@29`, `jest@29`, `jest-environment-jsdom@29`, `next@16`, `react@19`, `react-dom@19`, type packages) to verify.
- **`./node_modules/.bin/tsc --noEmit`** → exit 0, **0 errors** (was 2 before deletion per STATUS.md iter 59).
- **`./node_modules/.bin/jest`** → **291 pass / 14 suites, 0 failures** (was 291 pass / 13 + 1 failing suite).
- **`pytest tests/`** → 372 pass / 7 fail in `tests/test_triangular.py` + 11 fail in `tests/test_compression.py` (brotli import).
- **Baseline check via `git stash`:** Confirmed the 7 `test_triangular` failures + 11 `test_compression` failures are PRE-EXISTING at iter 59 commit `3914879` — present BEFORE my deletion. They are NOT caused by P2-11. `test_triangular.py` passes when run alone (`pytest tests/test_triangular.py -v` → 7/7 pass) — this is a test pollution issue in the repo's full-suite run, pre-existing, documented in STATUS.md §Quick Reference for future investigation during P1-4 or P1-8 pass.
- Evaluated P1-7 (EventManager async): source is `backend/economy/events.py` lines 160-301. Five sync methods use the `asyncio.get_event_loop()` + `ensure_future` / `run_until_complete` fire-and-forget pattern. Making them async requires updating all callers — `routes_events.py` (3 endpoints) + tests (`test_events.py`, `test_lifecycle.py`, `test_routes_events_invalidation.py`). Per REFACTOR_PLAN.md principle 3 ("No big-bang refactors"), deferred to iter 61 as a focused single-issue iteration.

**Stage Summary:**
- 1 issue closed in one commit: P2-11.
- `STATUS.md`: rewritten cleanly. P2 bucket 9 → 8 (P2-11 removed). P2-11 Detail section removed (issue closed). Fixed section: new iter 60 entry; iter 54 entry consolidated with P0-3+P0-4. Pre-existing `test_triangular` full-suite failures documented in §Quick Reference (not a new bug).
- `REFACTOR_PLAN.md`: v24 → v25. Iter 60 marked DONE. Estimation: 14 → 13 iterations remaining. Recommended Fix Order updated: P1-7 next (with note about 5-method scope + tests touched).
- `worklog.md`: this entry replaces iter 55 entry (≤5 rule). Iter 56-59 entries retained.
- Clean baseline restored: tsc 0 errors, jest 291/291 pass.

**Stopping point:**
- Iter 60 done. P2-11 closed. Clean test baseline restored.
- Ready for iter 61 = **P1-7** (EventManager async — 5 sync methods → async, update callers in `routes_events.py` + tests). Naturally resolves P3-8 (deprecated `asyncio.get_event_loop()`).
- Suggested commit message: `refactor(P1-7): EventManager async — replace fire-and-forget with await`
- Changed files for archive: `dashboard-page.tsx` (DELETED), `events-sidebar.spec.ts` (DELETED), `providers.tsx` (DELETED), `route.ts` (DELETED), `use-price-stream.ts` (DELETED), `main.py` (DELETED), `routes_sse.py` (DELETED), `historical.py` (DELETED), `test_lifecycle.py` (DELETED), `test_optimal_currency.py` (DELETED), `STATUS.md`, `REFACTOR_PLAN.md`, `worklog.md`.

---

## Task 59 — P1-11 (daily_stats invalidation) + P2-7 (targeted SSE invalidation by pair)
**Agent:** Main Agent
**Date:** 2026-06-20

**Task:** Per iter 58 stopping point: P1-11 (daily_stats invalidation — 2-line fix) and P2-7 (targeted invalidation by pair, unblocked by P0-1 SSE `pair` field) per REFACTOR_PLAN.md §"Recommended Fix Order".

**Work Log:**
- Verified P1-11 source: `backend/api/routes_events.py` — `create_event` / `delete_event` / `deactivate_event` all called `pipeline_cache.invalidate()` but never `daily_stats_cache.invalidate()`. After event mutation, stale daily-stats entries survived up to TTL (30 min) before reflecting new event context.
- Verified P2-7 source: `src/hooks/use-price-stream.ts:129-137` — `invalidateCaches()` invalidated `crossRates` (derived from `useExchangePairs` → POE2 official API, NOT from flipper prices = over-invalidation bug) and had no per-pair invalidation despite backend sending `pair` field (P0-1, iter 55).
- **P1-11 fix (backend):** Added `from backend.data.daily_stats_cache import get_daily_stats_cache` to `routes_events.py:29`. In `create_event` / `delete_event` / `deactivate_event`: after `pipeline_cache.invalidate()`, added `daily_stats_cache = get_daily_stats_cache()` + `daily_stats_cache.invalidate()` + log line. 8-line explanatory comment in each.
- **P1-11 regression tests** — `tests/test_routes_events_invalidation.py` (NEW, 4 tests): create/delete/deactivate (incl. major_patch path). Used `unittest.mock.patch` to inject MagicMock spies on `get_pipeline_cache` + `get_daily_stats_cache`. Stubbed `EventManager` (in-memory dict) + `to_dict()` returns all `EventData` fields.
- **P2-7 fix (frontend):** `src/hooks/use-price-stream.ts:148-178` — `invalidateCaches(pair: string)`. Drops `crossRates` invalidation (with comment). Adds `queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.benchmark, pair] })`. Keeps 5 bulk invalidations. Defensive empty-pair fallback. Updated both `es.onmessage` and `"update"` event listener to pass `data.pair ?? ""`.
- **NEW Known Issue discovered (P2-11):** While verifying tsc, found 2 pre-existing tsc errors and 1 pre-existing jest failure caused by 10 orphan root-level files accidentally committed in iter 58 commit `048304f`. Per "document first, fix second" rule, added P2-11 to STATUS.md with full table, deferred to iter 60.
- **Test runs:**
  - `pytest tests/test_routes_events_invalidation.py -v` → 4 pass / 0 fail.
  - `pytest tests/test_events.py tests/test_routes_events_invalidation.py tests/test_pipeline_cache_degraded.py -v` → 55 pass / 0 fail.
  - `pytest tests/e2e/test_api_e2e.py -v` → 10 pass / 0 fail.
  - `npx tsc --noEmit` → 2 pre-existing errors (P2-11). Verified identical via `git stash`.
  - `npx jest` → 291 pass / 1 suite fail (`./events-sidebar.spec.ts` — P2-11). Verified identical via `git stash`.

**Stage Summary:**
- 2 issues closed in one commit: P1-11 + P2-7.
- P1 bucket 8 → 7. P2 bucket 9 → 9 (P2-7 removed, P2-11 ADDED).
- No frontend regressions — Jest test counts match clean baseline (291 pass).

**Stopping point:**
- Iter 59 done. P1-11 + P2-7 closed. P2-11 (NEW) documented but deferred to iter 60.

---

## Task 58 — P0-2 + P1-1 + P1-2 + P2-10 + P3-1 + P3-6 closed by WS removal
**Agent:** Main Agent
**Date:** 2026-06-20

**Task:** Per iter 57 stopping point: completely remove WS endpoints (option b). Closes P0-2, P1-1, P1-2, P2-10, P3-1, P3-6 in one commit. Real-time updates handled by SSE (P0-1, iter 55) + REST polling.

**Work Log:**
- Verified P0-2 source: `routes_ws.py:_push_loop` calls `await compute_fn()` every 30s where `compute_fn` is `_compute_anomalies` (600+ currencies × STL+MACD+RSI) or `_compute_flips` — both run synchronously in the event loop.
- Verified P1-1, P1-2 sources; verified WS already opt-in (`NEXT_PUBLIC_FLIPPER_WS_ENABLED=false` by default).
- Established baseline: backend 375 pass / 4 skip, e2e 30 pass / 4 skip, Jest 291 pass, tsc clean (NOTE: this was incorrect — see P2-11 in iter 59/60).
- **Backend cleanup:** `git rm backend/api/routes_ws.py` (722 lines). `backend/main.py:478-483`: removed WS router registration; replaced with comment.
- **Frontend cleanup — deleted:** `src/hooks/use-websocket.ts` (548 lines), `src/app/api/flipper/ws/info/route.ts`.
- **Frontend cleanup — edited 5 components:** `dashboard-page.tsx`, `flips-tab.tsx`, `header.tsx`, `flipper-sticky-bar.tsx`, `flipper-backend-status-card.tsx` — removed `useFlipperWebSocket`/`wsStatus`/WS badge UI.
- **Config / build cleanup:** `.env.example`, `start.sh`, `start.bat` — removed WS env vars.
- i18n strings NOT touched (orphaned keys harmless, deferred to P3 pass).
- Test runs: backend 375 pass / 4 skip; e2e 30 pass / 4 skip; jest 291 pass.
- NOTE (added iter 59): iter 58 commit also accidentally bundled 10 orphan root-level files (P2-11) — closed in iter 60.

**Stage Summary:**
- 6 issues closed in one commit. ~1270 lines deleted (722 backend + 548 frontend), ~50 lines config simplified.

**Stopping point:**
- Iter 58 done. No P0 issues remain. Ready for iter 59 = P1-11 + P2-7.

---

## Task 57 — P0-5 transitive prices helper + dead `prices` param cleanup
**Agent:** Main Agent
**Date:** 2026-06-20

**Task:** Per REFACTOR_PLAN.md iter 57: extract `compute_transitive_prices` (BFS) to `backend/economy/pricing.py`, swap 2 call sites, extract `_find_price_24h_ago`, remove dead `prices` param from `find_triangular_arbitrage`.

**Work Log:**
- Created `backend/economy/pricing.py` with `compute_transitive_prices` + `find_price_24h_ago`.
- Swapped call sites in `data_snapshot.py`, `scheduler.py`, `routes_arbitrage.py`, `routes_analyst.py`.
- Removed dead `prices` param from `find_triangular_arbitrage` + 7 test calls.
- 15 new tests in `tests/test_pricing.py` (incl. 7-hop chain regression).
- Backend 375 pass / 4 skip; e2e 30 pass / 4 skip.

**Stage Summary:**
- P0-5 fixed: `refactor(P0-5): unified pricing helper + remove dead prices param`. P1-3 closed as side effect.

**Stopping point:**
- Iter 57 done. Ready for iter 58 = P0-2 (WS removal).

---

## Task 56 — P0-6 triangular hardcode fix
**Agent:** Main Agent
**Date:** 2026-06-20

**Task:** Per REFACTOR_PLAN.md iter 56: remove `prices["chaos"] = 1.0` hardcode + redundant chaos-normalization in `routes_arbitrage.py:753-770`. Single numeraire = `config.league.base_currency`.

**Work Log:**
- Replaced 16 lines with: `prices = dict(snapshot.prices_in_base)` + 9-line comment.
- Tests: `pytest tests/test_triangular.py -x` → 7/7 pass. `pytest tests/e2e/test_api_e2e.py::test_arbitrage_triangular` → 1/1 pass.

**Stage Summary:**
- P0-6 fixed: `fix(P0-6): remove chaos hardcode in triangular arbitrage`.

**Stopping point:**
- Iter 56 done. Ready for iter 57 = P0-5 (transitive prices helper).
