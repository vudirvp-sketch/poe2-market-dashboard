# Work Log

> Single source for recent task entries. Long history removed — see git log for details.
> Append new entries at the bottom. Keep ≤5 latest entries.

---

## Task 62 — P2-12 (orphan files actual cleanup — iter 60 follow-up)
**Agent:** Main Agent
**Date:** 2026-06-20

**Task:** Per iter 61 stopping point: actually delete the 16 orphan files that iter 60 commit `9ee73ae` falsely claimed to have removed. Closes P2-12. Restores the **true** clean `tsc` + `jest` baseline that iter 60 only documented (never executed).

**Work Log:**
- Re-read STATUS.md (iter 60 version), REFACTOR_PLAN.md v25, worklog.md iter 60 entry, DELETIONS.sh, MERGE_INSTRUCTIONS.md.
- Verified iter 60 commit `9ee73ae` only changed 5 files (DELETIONS.sh + 4 docs) — `git rm` was never executed.
- Verified all 10 orphan root files still present at repo root (4,824 lines total of stale duplicates): `dashboard-page.tsx`, `events-sidebar.spec.ts`, `providers.tsx`, `route.ts`, `use-price-stream.ts`, `main.py`, `routes_sse.py`, `historical.py`, `test_lifecycle.py`, `test_optimal_currency.py`.
- Verified all 3 WS remnant pairs still present (1,302 lines total): `backend/api/routes_ws.py` (721) + `.DELETED.txt`, `src/hooks/use-websocket.ts` (547) + `.DELETED.txt`, `src/app/api/flipper/ws/info/route.ts` (31) + `.DELETED.txt`.
- Verified all canonical copies still present and intact (4,744 lines total under `src/`, `backend/`, `tests/`, `e2e/`).
- Established pre-fix baseline by installing npm deps and running:
  - `npx tsc --noEmit` → **2 errors** (`dashboard-page.tsx(1037,89)` wsStatus prop, `events-sidebar.spec.ts(16,33)` cannot find `./fixtures`).
  - `npx jest` → **291 pass / 1 failing suite / 14 passed suites** (failing: `events-sidebar.spec.ts` — orphan root file).
  - This confirmed iter 60's claim of "tsc 0 errors / jest 14 suites" was false.
- Executed `bash DELETIONS.sh` → 10 orphan root files `git rm`'d. Canonical copies verified intact.
- Executed `git rm` on 6 WS remnant files (3 originals + 3 `.DELETED.txt` markers).
- Verified 16 staged deletions via `git status`.
- Post-fix verification:
  - `npx tsc --noEmit` → exit 0, **0 errors** (was 2). ✓
  - `npx jest` → **291 pass / 14 suites / 0 failures** (was 13 + 1 failing). ✓
  - `pytest tests/test_events.py tests/test_routes_events_invalidation.py tests/test_lifecycle.py -q` → **56 pass / 0 fail**. ✓
- Updated DELETIONS.sh to also handle the 6 WS remnant files (so the script is reproducible / re-runnable safely).
- Updated STATUS.md: P2-12 closed (moved to Fixed section). P2 bucket 9 → 8. Removed iter 60 false-claim note (iter 62 supersedes). Quick Reference — `test_triangular` + `test_compression` pre-existing rows preserved.
- Updated REFACTOR_PLAN.md: v25 → v26. Iter 62 marked DONE. Estimation: 13 → 12 iterations remaining.
- Updated AGENT_NAVIGATION.md: P1-7 marked as fixed; routes_events.py + events.py BUGGY tags removed.
- Updated worklog.md: this entry replaces iter 60 entry (false claim). Iter 61 entry added based on user-provided summary.
- Updated MERGE_INSTRUCTIONS.md: iter 60 → iter 62 version.

**Stage Summary:**
- 1 issue closed in one commit: P2-12.
- 16 files removed via `git rm` (zero code changes — only deletions).
- 5 doc files updated: STATUS.md, REFACTOR_PLAN.md, AGENT_NAVIGATION.md, worklog.md, MERGE_INSTRUCTIONS.md, DELETIONS.sh.
- True clean baseline finally restored: `tsc` 0 errors, `jest` 291/291 pass, 56/56 key pytest pass.
- P1=6, P2=8, P3=5. ~12 iterations remaining.

**Stopping point:**
- Iter 62 done. P2-12 closed. True clean test baseline restored.
- Ready for iter 63 = **P1-4** (clustering duplication between `routes_prices` and `routes_arbitrage`) — recommended next per REFACTOR_PLAN.md v26 §"Recommended Fix Order". Single cache key `cluster_labels` + shared helper function.
- Suggested commit message: `fix(P2-12): actually delete orphan root files + WS file remnants`
- Changed files for archive: `STATUS.md`, `REFACTOR_PLAN.md`, `AGENT_NAVIGATION.md`, `worklog.md`, `MERGE_INSTRUCTIONS.md`, `DELETIONS.sh` (updated to also handle WS remnants).

---

## Task 61 — P1-7 + P3-8 (EventManager async refactor)
**Agent:** Main Agent
**Date:** 2026-06-20

**Task:** Per iter 60 stopping point: make 4 sync methods in `backend/economy/events.py` async, replace fire-and-forget SQLite writes with `await`, update callers + tests. Naturally closes P3-8 (deprecated `asyncio.get_event_loop()`).

**Work Log:**
- Converted 4 sync methods to `async def`: `create_event`, `delete_event`, `deactivate_event`, `clear_all` in `backend/economy/events.py`.
- Replaced `asyncio.ensure_future(self._store.<op>(...))` fire-and-forget pattern with direct `await self._store.<op>(...)`.
- Updated 3 endpoints in `routes_events.py` to `await` the now-async EventManager methods.
- Converted 25 tests in `tests/test_events.py` to `async def` (pytest-asyncio auto mode).
- Converted 3 stub methods in `tests/test_routes_events_invalidation.py` to async.
- Converted 1 test in `tests/test_scheduler.py` to async.
- **Design decision:** `_prune_expired` left sync intentionally — called from 8 sync read-only methods. SQLite prune already done by scheduler (`backend/scheduler.py:145`) + on startup (`backend/main.py:174`).
- **Side effect:** all 4 `asyncio.get_event_loop()` calls in `events.py` were part of the fire-and-forget pattern that P1-7 deleted → P3-8 auto-closed.
- Discovered NEW issue P2-12 during pre-flight: iter 60 commit `9ee73ae` updated only documentation, but `git rm` of 10 orphan files was never executed. Documented in STATUS.md §P2-12, deferred to iter 62.

**Test runs:**
- `pytest tests/test_events.py tests/test_routes_events_invalidation.py tests/test_lifecycle.py` → 56 pass / 0 fail.
- `pytest tests/` (full suite) → 374 pass / 18 pre-existing fail (7 `test_triangular` test pollution + 11 `test_compression` brotli ImportError — both pre-existing, not from iter 61).
- `pytest tests/e2e/` → 30 pass / 4 skip (unchanged).
- `tsc` / `jest` — not touched (changes only in backend Python).

**Stage Summary:**
- 2 issues closed in one commit: P1-7 + P3-8.
- P1 bucket 7 → 6. P3 bucket 6 → 5. P2 +1 (P2-12 NEW).
- No backend regressions — all 56 key tests pass.

**Stopping point:**
- Iter 61 done. P1-7 + P3-8 closed. P2-12 (NEW) documented but deferred to iter 62.

---

## Task 59 — P1-11 (daily_stats invalidation) + P2-7 (targeted SSE invalidation by pair)
**Agent:** Main Agent
**Date:** 2026-06-20

**Task:** Per iter 58 stopping point: P1-11 (daily_stats invalidation — 2-line fix) and P2-7 (targeted invalidation by pair, unblocked by P0-1 SSE `pair` field) per REFACTOR_PLAN.md §"Recommended Fix Order".

**Work Log:**
- Verified P1-11 source: `backend/api/routes_events.py` — `create_event` / `delete_event` / `deactivate_event` all called `pipeline_cache.invalidate()` but never `daily_stats_cache.invalidate()`. After event mutation, stale daily-stats entries survived up to TTL (30 min) before reflecting new event context.
- Verified P2-7 source: `src/hooks/use-price-stream.ts:129-137` — `invalidateCaches()` invalidated `crossRates` (derived from `useExchangePairs` → POE2 official API, NOT from flipper prices = over-invalidation bug) and had no per-pair invalidation despite backend sending `pair` field (P0-1, iter 55).
- **P1-11 fix (backend):** Added `from backend.data.daily_stats_cache import get_daily_stats_cache` to `routes_events.py:29`. In `create_event` / `delete_event` / `deactivate_event`: after `pipeline_cache.invalidate()`, added `daily_stats_cache = get_daily_stats_cache()` + `daily_stats_cache.invalidate()` + log line.
- **P1-11 regression tests** — `tests/test_routes_events_invalidation.py` (4 tests): create/delete/deactivate (incl. major_patch path). Used `unittest.mock.patch` to inject MagicMock spies on `get_pipeline_cache` + `get_daily_stats_cache`.
- **P2-7 fix (frontend):** `src/hooks/use-price-stream.ts:148-178` — `invalidateCaches(pair: string)`. Drops `crossRates` invalidation. Adds `queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.benchmark, pair] })`. Keeps 5 bulk invalidations. Defensive empty-pair fallback.
- **NEW Known Issue discovered (P2-11):** While verifying tsc, found 2 pre-existing tsc errors + 1 pre-existing jest failure caused by 10 orphan root-level files committed in iter 58 commit `048304f`. Documented in STATUS.md, deferred to iter 60.

**Stage Summary:**
- 2 issues closed in one commit: P1-11 + P2-7.
- P1 bucket 8 → 7. P2 bucket 9 → 9 (P2-7 removed, P2-11 ADDED).
- No frontend regressions — Jest 291 pass.

**Stopping point:**
- Iter 59 done. P1-11 + P2-7 closed. P2-11 (NEW) documented but deferred to iter 60.

---

## Task 58 — P0-2 + P1-1 + P1-2 + P2-10 + P3-1 + P3-6 closed by WS removal
**Agent:** Main Agent
**Date:** 2026-06-20

**Task:** Per iter 57 stopping point: completely remove WS endpoints (option b). Closes P0-2, P1-1, P1-2, P2-10, P3-1, P3-6 in one commit. Real-time updates handled by SSE (P0-1, iter 55) + REST polling.

**Work Log:**
- Verified P0-2 source: `routes_ws.py:_push_loop` called `await compute_fn()` every 30s where `compute_fn` is `_compute_anomalies` (600+ currencies × STL+MACD+RSI) or `_compute_flips` — both run synchronously in the event loop.
- **Backend cleanup:** `git rm backend/api/routes_ws.py` (722 lines). `backend/main.py:478-483`: removed WS router registration.
- **Frontend cleanup — deleted:** `src/hooks/use-websocket.ts` (548 lines), `src/app/api/flipper/ws/info/route.ts`.
- **Frontend cleanup — edited 5 components:** `dashboard-page.tsx`, `flips-tab.tsx`, `header.tsx`, `flipper-sticky-bar.tsx`, `flipper-backend-status-card.tsx` — removed `useFlipperWebSocket`/`wsStatus`/WS badge UI.
- **Config / build cleanup:** `.env.example`, `start.sh`, `start.bat` — removed WS env vars.
- i18n strings NOT touched (orphaned keys harmless, deferred to P3 pass).
- **Follow-up:** iter 58 commit also accidentally bundled 10 orphan root-level files (P2-11/P2-12) + left WS file remnants — both closed in iter 62.

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
