# Work Log

> Single source for recent task entries. Long history removed — see git log for details.
> Append new entries at the bottom. Keep ≤5 latest entries.

---

## Task 59 — P1-11 (daily_stats invalidation) + P2-7 (targeted SSE invalidation by pair)
**Agent:** Main Agent
**Date:** 2026-06-20

**Task:** Per iter 58 stopping point: P1-11 (daily_stats invalidation — 2-line fix) and P2-7 (targeted invalidation by pair, unblocked by P0-1 SSE `pair` field) per REFACTOR_PLAN.md §"Recommended Fix Order".

**Work Log:**
- Re-read STATUS.md (iter 58), REFACTOR_PLAN.md v23, worklog.md (iter 58 entry).
- Verified P1-11 source: `backend/api/routes_events.py` confirmed — `create_event` (line 135), `delete_event` (line 205), `deactivate_event` (line 226) all call `pipeline_cache.invalidate()` but never `daily_stats_cache.invalidate()`. The `daily_stats` namespace stores stale-fallback daily benchmarks / storage-value aggregates with default TTL 30 min. After an event mutation, stale entries survived up to TTL before reflecting the new event context — UI kept showing outdated benchmarks/storage-value estimates after a `major_patch` flag.
- Verified P2-7 source: `src/hooks/use-price-stream.ts:129-137` — `invalidateCaches()` (no args) called `queryClient.invalidateQueries` on 6 query keys: `flipperPrices`, `flipperFlips`, `heatmap`, `flipperTriangular`, `crossRates`, `flipperLiquidChain`. Investigation revealed `crossRates` derives from `useExchangePairs` (POE2 official API), NOT from flipper prices — invalidating it on a flipper SSE event was an over-invalidation bug. Also no per-pair invalidation despite backend sending `pair` field (P0-1, iter 55).
- **P1-11 fix (backend):**
  - Added `from backend.data.daily_stats_cache import get_daily_stats_cache` to `routes_events.py:29`.
  - In `create_event`: after `pipeline_cache.invalidate()`, added `daily_stats_cache = get_daily_stats_cache()` + `daily_stats_cache.invalidate()` + log line. With 8-line explanatory comment.
  - In `delete_event`: same 3 lines added after `pipeline_cache.invalidate()`.
  - In `deactivate_event`: same 3 lines added after `pipeline_cache.invalidate()`.
- **P1-11 regression tests — `tests/test_routes_events_invalidation.py` (NEW, 4 tests):**
  - `test_create_event_invalidates_daily_stats` — POST `/api/v1/events` with `minor_patch`, assert both `pipeline_cache.invalidate()` and `daily_stats_cache.invalidate()` called.
  - `test_create_major_patch_event_invalidates_daily_stats` — same but with `major_patch` event type (also exercises the PhaseDetector reset path).
  - `test_delete_event_invalidates_daily_stats` — create event, reset mocks, DELETE it, assert both invalidations called.
  - `test_deactivate_event_invalidates_daily_stats` — create event, reset mocks, POST deactivate, assert both invalidations called.
  - Used `unittest.mock.patch` on `routes_events.get_pipeline_cache` + `routes_events.get_daily_stats_cache` to inject MagicMock spies. Stubbed `EventManager` (in-memory dict) so routes succeed without SQLite. Stubbed event `to_dict()` returns all required `EventData` fields (timestamp, expires_at, created_at).
- **P2-7 fix (frontend):**
  - `src/hooks/use-price-stream.ts:148-178`: rewrote `invalidateCaches` to take `pair: string` parameter.
  - Defensive empty-pair fallback: if backend sends no `pair`, falls back to bulk-only invalidation (still correct, just less targeted).
  - Drops `crossRates` invalidation entirely (with comment explaining: derived from `useExchangePairs` → POE2 official API, not flipper prices).
  - Adds `queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.benchmark, pair] })` — per-pair benchmark invalidation. Only the card mounted for that pair refetches.
  - Keeps 5 bulk invalidations (`flipperPrices`, `flipperFlips`, `heatmap`, `flipperTriangular`, `flipperLiquidChain`) because they aggregate ALL currencies.
  - Comment notes `itemHistory` / `itemDaily` / `itemOhlcv` deliberately omitted — keyed by `itemId` (different from `apiId`/`pair`) and can't be safely targeted without an apiId→itemId lookup.
  - Updated both `es.onmessage` and `"update"` event listener to pass `data.pair ?? ""` to `invalidateCaches`.
- **NEW Known Issue discovered (P2-11):** While verifying tsc, found 2 pre-existing tsc errors and 1 pre-existing jest failure caused by 10 orphan root-level files (`dashboard-page.tsx`, `events-sidebar.spec.ts`, `providers.tsx`, `route.ts`, `use-price-stream.ts`, `main.py`, `routes_sse.py`, `historical.py`, `test_lifecycle.py`, `test_optimal_currency.py`) accidentally committed in iter 58 commit `048304f`. All have canonical copies under `src/`, `backend/`, `tests/`, `e2e/` — root versions are stale duplicates not imported by anything. Per the rule "document first, fix second", added P2-11 to STATUS.md with full detail table and recommended `git rm` cleanup as iter 60 first step.
- **Test runs:**
  - `pytest tests/test_routes_events_invalidation.py -v` → 4 pass / 0 fail.
  - `pytest tests/test_events.py tests/test_routes_events_invalidation.py tests/test_pipeline_cache_degraded.py -v` → 55 pass / 0 fail (no regressions in events/cache area).
  - `pytest tests/e2e/test_api_e2e.py -v` → 10 pass / 0 fail (incl. `test_create_and_list_events`).
  - `npx tsc --noEmit` → 2 pre-existing errors (P2-11, not caused by iter 59). Verified identical on clean repo via `git stash`.
  - `npx jest` → 291 pass / 1 suite fail (`./events-sidebar.spec.ts` — P2-11, pre-existing). Verified identical on clean repo via `git stash`.

**Stage Summary:**
- 2 issues closed in one commit: P1-11 + P2-7.
- `STATUS.md`: rewritten cleanly. P1 bucket 8 → 7 (P1-11 removed). P2 bucket 9 → 9 (P2-7 removed, P2-11 ADDED). New §"P2-11 Detail" section with full table of orphan files. Fixed section: new iter 59 entry; iter 55 entry removed (≤5 rule).
- `REFACTOR_PLAN.md`: v23 → v24. Iter 59 marked DONE. Estimation: 15 → 14 iterations remaining. Recommended Fix Order updated: P2-11 listed as iter 60 first step (quick `git rm`, restores tsc+jest clean baseline).
- `worklog.md`: this entry replaces iter 55 entry (≤5 rule). Iter 56-58 entries retained.
- No frontend code compiled incorrectly — Jest test counts match clean baseline (291 pass).

**Stopping point:**
- Iter 59 done. P1-11 + P2-7 closed. P2-11 (NEW) documented but deferred to iter 60.
- Ready for iter 60 = **P2-11 first** (10-min `git rm` cleanup of orphan root files, restores "tsc: clean" + "jest: clean") OR P1-7 (EventManager async — same area as P1-11) per REFACTOR_PLAN.md §"Recommended Fix Order".
- Suggested commit message: `fix(P1-11+P2-7): daily_stats invalidation + targeted SSE invalidation`
- Changed files for archive: `backend/api/routes_events.py`, `src/hooks/use-price-stream.ts`, `tests/test_routes_events_invalidation.py` (NEW), `STATUS.md`, `REFACTOR_PLAN.md`, `worklog.md`.

---

## Task 58 — P0-2 + P1-1 + P1-2 + P2-10 + P3-1 + P3-6 closed by WS removal
**Agent:** Main Agent
**Date:** 2026-06-20

**Task:** Per iter 57 stopping point: completely remove WS endpoints (option b). Closes P0-2, P1-1, P1-2, P2-10, P3-1, P3-6 in one commit. Real-time updates handled by SSE (P0-1, iter 55) + REST polling.

**Work Log:**
- Re-read STATUS.md, REFACTOR_PLAN.md v22, AGENT_NAVIGATION.md, worklog.md (iter 57 entry).
- Verified P0-2 source: `routes_ws.py:_push_loop` calls `await compute_fn()` every 30s where `compute_fn` is `_compute_anomalies` (600+ currencies × STL+MACD+RSI) or `_compute_flips` — both run synchronously in the event loop.
- Verified P1-1, P1-2 sources; verified WS already opt-in (`NEXT_PUBLIC_FLIPPER_WS_ENABLED=false` by default).
- Established baseline: backend 375 pass / 4 skip, e2e 30 pass / 4 skip, Jest 291 pass, tsc clean (NOTE: this was incorrect — see P2-11 in iter 59).
- **Backend cleanup:** `git rm backend/api/routes_ws.py` (722 lines). `backend/main.py:478-483`: removed WS router registration; replaced with comment.
- **Frontend cleanup — deleted:** `src/hooks/use-websocket.ts` (548 lines), `src/app/api/flipper/ws/info/route.ts`.
- **Frontend cleanup — edited 5 components:** `dashboard-page.tsx`, `flips-tab.tsx`, `header.tsx`, `flipper-sticky-bar.tsx`, `flipper-backend-status-card.tsx` — removed `useFlipperWebSocket`/`wsStatus`/WS badge UI.
- **Config / build cleanup:** `.env.example`, `start.sh`, `start.bat` — removed WS env vars.
- i18n strings NOT touched (orphaned keys harmless, deferred to P3 pass).
- Test runs: backend 375 pass / 4 skip; e2e 30 pass / 4 skip; tsc claimed clean; jest 291 pass.

**Stage Summary:**
- 6 issues closed in one commit. ~1270 lines deleted (722 backend + 548 frontend), ~50 lines config simplified.
- NOTE (added iter 59): iter 58 commit also accidentally bundled 10 orphan root-level files (P2-11) — see iter 59 entry.

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

---

## Task 55 — P0-1 SSE fix (remove dead monitor, add change_pct, align contract)
**Agent:** Main Agent
**Date:** 2026-06-20

**Task:** Per REFACTOR_PLAN.md iter 55: fix P0-1 (SSE — dead monitor, no threshold filtering, contract mismatch), add regression tests, run full test suite, update docs.

**Work Log:**
- Verified P0-1 source: `routes_sse.py` confirmed 3 bugs: dead `_sse_monitor_loop`, ignored `threshold_pct`, contract mismatch (backend sent bulk payload, frontend expected per-currency).
- Full rewrite of `routes_sse.py`. Updated `main.py` + `src/hooks/use-price-stream.ts` interface.
- 4 new tests in `tests/e2e/test_sse.py`.
- All tests pass: backend 375 / e2e 30 / Jest 291 / tsc clean.

**Stage Summary:**
- P0-1 fixed: `fix(P0-1): SSE contract fix — remove dead monitor, add change_pct, align payload`.
- P2-7 unblocked — backend now sends `pair` field.

**Stopping point:**
- Iter 55 done. Ready for iter 56 = P0-6 (triangular hardcode).
