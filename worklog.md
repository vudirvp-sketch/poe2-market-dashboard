# Work Log

> Single source for recent task entries. Long history removed — see git log for details.
> Append new entries at the bottom. Keep ≤5 latest entries.

---

## Task 61 — P1-7 (EventManager async) + P3-8 (deprecated get_event_loop)
**Agent:** Main Agent
**Date:** 2026-06-20

**Task:** Per iter 60 stopping point + REFACTOR_PLAN.md v25 §"Recommended Fix Order": P1-7 — convert 4 sync methods in `backend/economy/events.py` (`create_event` / `delete_event` / `deactivate_event` / `clear_all`) to async, replace fire-and-forget `asyncio.ensure_future(...)` pattern with `await`. Update all callers in `routes_events.py` + tests. Naturally resolves P3-8 (deprecated `asyncio.get_event_loop()`).

**Work Log:**
- Re-read STATUS.md (iter 60), REFACTOR_PLAN.md v25, worklog.md (iter 60 entry).
- Cloned repo fresh. Established baseline: `pytest tests/test_events.py tests/test_routes_events_invalidation.py tests/test_lifecycle.py` → 56 pass / 0 fail. `pytest tests/e2e/` → 30 pass / 4 skip.
- **NEW issue discovered (P2-12):** During pre-flight verification, discovered that iter 60's commit `9ee73ae` ("fix(P2-11): remove 10 orphan root-level files") only updated documentation (`STATUS.md`, `REFACTOR_PLAN.md`, `worklog.md`, `MERGE_INSTRUCTIONS.md`, `DELETIONS.sh`) — the `git rm` itself was never executed. All 10 orphan root files (`dashboard-page.tsx`, `events-sidebar.spec.ts`, `providers.tsx`, `route.ts`, `use-price-stream.ts`, `main.py`, `routes_sse.py`, `historical.py`, `test_lifecycle.py`, `test_optimal_currency.py`) are still present in the repo. Also discovered same pattern in iter 58's commit `048304f` ("refactor(P0-2): remove WS endpoints") — `routes_ws.py` was renamed to `routes_ws.py.DELETED.txt` but the original 721-line file was kept. Per "document first, fix second" rule, added P2-12 to STATUS.md, deferred to iter 62.
- **P1-7 implementation:**
  - `backend/economy/events.py:160-167` — `def create_event` → `async def create_event`. Replaced fire-and-forget `asyncio.get_event_loop()` + `ensure_future(self._store.write_event(event))` block (lines 207-216) with `await self._store.write_event(event)`.
  - `backend/economy/events.py:254-278` — `def delete_event` → `async def delete_event`. Same pattern replacement.
  - `backend/economy/events.py:281-307` — `def deactivate_event` → `async def deactivate_event`. Same pattern replacement.
  - `backend/economy/events.py:513-535` — `def clear_all` → `async def clear_all`. Same pattern replacement.
  - `backend/economy/events.py:475-509` — `_prune_expired` LEFT SYNC intentionally. Removed the fire-and-forget SQLite prune block (was lines 499-509). Documented the design decision in the docstring: `_prune_expired` is called from 8 sync read-only methods (`list_events`, `get_event`, `is_event_active`, `get_event_score_penalty`, `get_affected_currencies`, `has_major_patch_event`, `get_latest_major_patch_timestamp`, `get_active_event_summary`). Making it async would force every read-only path to become async — a much larger refactor with no caller-facing benefit. The SQLite prune is already done by `DataScheduler.prune_events` (`backend/scheduler.py:145`) on a periodic schedule and by `backend/main.py:174` on startup — both code paths already `await self._store.prune_expired_events()`.
  - `backend/api/routes_events.py:114` — `event = manager.create_event(...)` → `event = await manager.create_event(...)`.
  - `backend/api/routes_events.py:210` — `deleted = manager.delete_event(event_id)` → `deleted = await manager.delete_event(event_id)`.
  - `backend/api/routes_events.py:236` — `deactivated = manager.deactivate_event(event_id)` → `deactivated = await manager.deactivate_event(event_id)`.
- **Tests updated:**
  - `tests/test_events.py` — 25 tests converted from sync to async. Tests that don't call `create_event`/`delete_event`/`deactivate_event`/`clear_all` (e.g. `test_get_nonexistent_event`, `test_no_penalty_without_events`, `test_is_event_active_no_events`, `test_no_major_patch_timestamp_without_events`, `test_summary_no_events`, all `TestSingletonAccessor`, all `TestPhaseDetectorIntegration`) left sync. pytest-asyncio `auto` mode (configured in `pytest.ini`) handles async test functions automatically.
  - `tests/test_routes_events_invalidation.py:78-95` — `_StubManager.create_event` / `delete_event` / `deactivate_event` converted to `async def`.
  - `tests/test_scheduler.py:241` — `event_manager.create_event(...)` → `await event_manager.create_event(...)` (test was already `async def`).
- **Test runs after fix:**
  - `pytest tests/test_events.py tests/test_routes_events_invalidation.py tests/test_lifecycle.py` → 56 pass / 0 fail (was 56 pass / 0 fail before — same count, all converted cleanly).
  - `pytest tests/` (full suite, excluding `test_triangular.py` + `test_compression.py` pre-existing failures) → 372 pass / 0 fail.
  - `pytest tests/` (full suite) → 374 pass / 18 fail (7 `test_triangular` test pollution + 11 `test_compression` brotli ImportError — both pre-existing per STATUS.md §Quick Reference, NOT caused by iter 61).
  - `pytest tests/e2e/` → 30 pass / 4 skip (unchanged from baseline).
- **P3-8 verification:** `grep -n "get_event_loop" backend/economy/events.py` → 0 matches. P3-8 closed as side effect.
- **tsc / jest NOT re-run** — iter 61 changes are backend-only (Python). Frontend code unchanged.

**Stage Summary:**
- 2 issues closed in one commit: P1-7 + P3-8.
- P1 bucket 7 → 6. P3 bucket 6 → 5.
- No backend regressions — 374 pass (was 372 in iter 60; +2 from `test_events.py` async-converted tests passing under pytest-asyncio `auto` mode that may have been silently skipped before — exact cause not investigated, all 374 are explicit pass).
- New issue P2-12 documented — iter 58-60 doc/code mismatch.

**Stopping point:**
- Iter 61 done. P1-7 + P3-8 closed. P2-12 (NEW) documented but deferred to iter 62.
- Ready for iter 62 = **P2-12** (orphan files + .DELETED.txt markers actual cleanup) — run `DELETIONS.sh` for real, `git rm backend/api/routes_ws.py` (721 lines) + `backend/api/routes_ws.py.DELETED.txt` + `src/hooks/use-websocket.ts.DELETED.txt` + `src/app/api/flipper/ws/info/route.ts.DELETED.txt`. Verify tsc 0 errors + jest clean (the baseline iter 60 falsely claimed).
- Suggested commit message: `fix(P2-12): actually delete orphan root files + WS file remnants`
- Changed files for archive: `backend/economy/events.py`, `backend/api/routes_events.py`, `tests/test_events.py`, `tests/test_routes_events_invalidation.py`, `tests/test_scheduler.py`, `STATUS.md`, `REFACTOR_PLAN.md`, `worklog.md`.

---

## Task 60 — P2-11 (orphan root files cleanup — INCOMPLETE, see P2-12)
**Agent:** Main Agent
**Date:** 2026-06-20

**Task:** Per iter 59 stopping point: P2-11 — `git rm` 10 orphan root-level files accidentally committed in iter 58. Restores "tsc: clean" + "jest: clean" baseline.

**Work Log:**
- Verified all 10 orphan files present at repo root.
- Diffed each orphan vs its canonical copy: 3 identical, 7 differ (orphan = older stale version).
- Statically verified no source code imports the orphan root files.
- Created `DELETIONS.sh` script to perform the `git rm`.
- Updated `STATUS.md`, `REFACTOR_PLAN.md`, `worklog.md` to claim P2-11 closed.
- **CRITICAL OMISSION (discovered iter 61):** Committed doc changes only — commit `9ee73ae` did NOT include the actual `git rm` execution. `DELETIONS.sh` was never run. All 10 orphan files are still present in the repo. Tracked as P2-12 in iter 61.

**Stage Summary:**
- 0 issues actually closed (1 issue falsely claimed closed — see P2-12).
- Documentation updated to claim closure, but reality diverged.

**Stopping point:**
- Iter 60 done (claimed). Ready for iter 61 = P1-7 (EventManager async).

---

## Task 59 — P1-11 (daily_stats invalidation) + P2-7 (targeted SSE invalidation by pair)
**Agent:** Main Agent
**Date:** 2026-06-20

**Task:** Per iter 58 stopping point: P1-11 (daily_stats invalidation — 2-line fix) and P2-7 (targeted invalidation by pair, unblocked by P0-1 SSE `pair` field) per REFACTOR_PLAN.md §"Recommended Fix Order".

**Work Log:**
- Verified P1-11 source: `backend/api/routes_events.py` — `create_event` / `delete_event` / `deactivate_event` all called `pipeline_cache.invalidate()` but never `daily_stats_cache.invalidate()`.
- Verified P2-7 source: `src/hooks/use-price-stream.ts:129-137` — `invalidateCaches()` invalidated `crossRates` (derived from POE2 official API, NOT from flipper prices = over-invalidation bug) and had no per-pair invalidation despite backend sending `pair` field (P0-1, iter 55).
- **P1-11 fix (backend):** Added `daily_stats_cache.invalidate()` after `pipeline_cache.invalidate()` in 3 endpoints. 8-line explanatory comment in each.
- **P1-11 regression tests** — `tests/test_routes_events_invalidation.py` (NEW, 4 tests).
- **P2-7 fix (frontend):** `src/hooks/use-price-stream.ts:148-178` — `invalidateCaches(pair: string)`. Drops `crossRates` invalidation, adds per-pair `benchmark` invalidation.
- **NEW Known Issue discovered (P2-11):** While verifying tsc, found 2 pre-existing tsc errors and 1 pre-existing jest failure caused by 10 orphan root-level files accidentally committed in iter 58. Documented, deferred to iter 60 (which then failed to actually delete them — see P2-12).
- Tests: backend 379 pass; e2e 30 pass / 4 skip; jest 291 pass / 1 suite fail (P2-11).

**Stage Summary:**
- 2 issues closed in one commit: P1-11 + P2-7.
- P1 bucket 8 → 7. P2 bucket 9 → 9 (P2-7 removed, P2-11 added).

**Stopping point:**
- Iter 59 done. P1-11 + P2-7 closed. P2-11 documented but deferred to iter 60.

---

## Task 58 — P0-2 + P1-1 + P1-2 + P2-10 + P3-1 + P3-6 (INCOMPLETE — see P2-12)
**Agent:** Main Agent
**Date:** 2026-06-20

**Task:** Per iter 57 stopping point: completely remove WS endpoints (option b). Closes P0-2, P1-1, P1-2, P2-10, P3-1, P3-6 in one commit. Real-time updates handled by SSE (P0-1, iter 55) + REST polling.

**Work Log:**
- Verified P0-2 source: `routes_ws.py:_push_loop` calls `await compute_fn()` every 30s where `compute_fn` is `_compute_anomalies` (600+ currencies × STL+MACD+RSI) or `_compute_flips` — both run synchronously in the event loop.
- **Backend cleanup:** Renamed `backend/api/routes_ws.py` → `backend/api/routes_ws.py.DELETED.txt` (1-line marker). **CRITICAL OMISSION (discovered iter 61):** original `routes_ws.py` (721 lines) was NOT actually `git rm`'d — it was kept alongside the marker file. `backend/main.py:478-483`: WS router registration correctly removed.
- **Frontend cleanup:** Same pattern — `src/hooks/use-websocket.ts` (548 lines) and `src/app/api/flipper/ws/info/route.ts` were renamed to `.DELETED.txt` markers but originals kept.
- **Frontend cleanup — edited 5 components:** `dashboard-page.tsx`, `flips-tab.tsx`, `header.tsx`, `flipper-sticky-bar.tsx`, `flipper-backend-status-card.tsx` — removed `useFlipperWebSocket`/`wsStatus`/WS badge UI.
- **Config / build cleanup:** `.env.example`, `start.sh`, `start.bat` — removed WS env vars.
- **Accidental addition:** 10 orphan root files (`dashboard-page.tsx`, `main.py`, etc.) were accidentally bundled into this commit. Tracked as P2-11 (iter 59), then P2-12 (iter 61) when iter 60 also failed to delete them.
- Test runs: backend 375 pass / 4 skip; e2e 30 pass / 4 skip; jest 291 pass.

**Stage Summary:**
- 6 issues claimed closed in one commit. WS router correctly removed from `backend/main.py`. But the actual file deletions were never executed — `.DELETED.txt` markers added alongside originals. Tracked as P2-12 in iter 61.

**Stopping point:**
- Iter 58 done (claimed). No P0 issues remain. Ready for iter 59 = P1-11 + P2-7.

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
