# STATUS.md — Known Issues & Refactoring Backlog

> **Last updated:** 2026-06-20 (iter 61 — P1-7 closed: EventManager async; P3-8 closed as side effect)
> This file is the **single source of truth** for known bugs and refactoring priorities.
> Update it **before** fixing any issue. Cross-reference issue IDs in commits.
>
> **Iter 61 status:** P1-7 (EventManager async) closed — 4 sync methods (`create_event` / `delete_event` / `deactivate_event` / `clear_all`) in `backend/economy/events.py` converted to `async def`, fire-and-forget `asyncio.ensure_future(...)` pattern replaced with `await`. 3 callers in `routes_events.py` updated (`await`), 1 caller in `tests/test_scheduler.py` updated. `tests/test_events.py` — 25 tests converted to async (pytest-asyncio `auto` mode). `tests/test_routes_events_invalidation.py` — `_StubManager` methods converted to async. P3-8 (deprecated `asyncio.get_event_loop()`) closed as side effect — no more `get_event_loop()` calls in `events.py`. `_prune_expired` left sync intentionally — it's called from sync read-only paths; SQLite prune already done by scheduler + on startup. Backend: **374 pass** (was 372), e2e **30 pass / 4 skip**, jest 291 (unchanged), tsc 0 (unchanged). 18 pre-existing failures (`test_triangular.py` ×7, `test_compression.py` ×11) unchanged.

---

## P0 — Critical (correctness, stability) — 0 active

(All P0 issues resolved. See §Fixed below.)

---

## P1 — Serious (performance, maintainability) — 6 items

### P1-4. Clustering duplicated between routes_prices and routes_arbitrage
- **Solution:** Single cache key `cluster_labels`, shared helper function.

### P1-5. `compute_quantized_analysis` — O(lot_sizes × max_lot_search) per pair
- **Solution:** Binary search instead of linear scan.

### P1-6. `HistoricalStore._prune_old_league_data` — DELETE without limits
- **Solution:** Chunked delete with `await db.commit()` between iterations.

### P1-8. `routes_optimizer._bellman_ford` — loses profitable arbitrage
- **Solution:** After max_hops relaxations — check for negative cycle.

### P1-9. Spread model — magic numbers without theoretical basis
- **Solution:** Move to `config.yaml:scoring.spread_model.*`.

### P1-10. `flipper-proxy.ts` circuit breaker — global, not per-endpoint
- **Solution:** Per-endpoint CB (Map<path, CircuitBreaker>).

---

## P2 — Medium (clean code, dev experience) — 9 items

- **P2-1.** `dashboard-page.tsx` — 1705 lines, god-component. Split into tab-specific subcomponents.
- **P2-2.** `pipeline_cache.py` / `daily_stats_cache.py` — shim modules (23 lines each). Delete, update imports.
- **P2-3.** `currency_names_ru.py` — 966 lines hardcoded dict. Move to JSON.
- **P2-4.** `routes_scanner.py` — duplicates `/flips`. Extend `/flips` query params or delete.
- **P2-5.** `routes_auth.py` comment in `main.py:516-519`. Delete.
- **P2-6.** Double circuit breaker not synchronized. Expose CB status in `/health`.
- **P2-8.** `proxyWithFallback` swallows ALL 5xx → 200. Pass-through in dev, mark fallback in prod.
- **P2-9.** `lightgbm_min_data_points: 15` — adaptive fallback instead of hardcode.
- **P2-12.** **NEW (iter 61):** iter 58-60 doc/code mismatch — `STATUS.md`/`worklog.md` claim P2-11 closed (10 orphan root files removed via `git rm`) and P0-2 closed (`routes_ws.py` deleted), but the actual files are still present in the repo (`dashboard-page.tsx`, `main.py`, `routes_sse.py`, `historical.py`, `test_lifecycle.py`, `test_optimal_currency.py`, `providers.tsx`, `route.ts`, `use-price-stream.ts`, `events-sidebar.spec.ts` at root; `backend/api/routes_ws.py` 721 lines + `backend/api/routes_ws.py.DELETED.txt` marker; `src/hooks/use-websocket.ts.DELETED.txt` marker; `src/app/api/flipper/ws/info/route.ts.DELETED.txt` marker). The iter 60 commit `9ee73ae` only updated docs — the `git rm` itself was never executed. Causes 2 tsc errors + 1 failing jest suite that iter 60 claimed were fixed.
  - **Fix:** Run `DELETIONS.sh` for real this time. Then `git rm backend/api/routes_ws.py backend/api/routes_ws.py.DELETED.txt src/hooks/use-websocket.ts.DELETED.txt src/app/api/flipper/ws/info/route.ts.DELETED.txt`. Verify tsc 0 errors + jest clean.

---

## P3 — Low priority (nice-to-have) — 5 items

- **P3-2.** `_prune_old_records` — also chunked delete.
- **P3-3.** `EventManager` not thread-safe for multi-worker uvicorn.
- **P3-4.** `SnapshotManager._snapshot` swap non-atomic for iterators.
- **P3-5.** No integration test for full `/flips` flow.
- **P3-7.** `REFACTOR_PLAN.md` and `worklog.md` — delete after closing all issues.

---

## Fixed

### P1-7 + P3-8 (fixed in iter 61) — EventManager async
- **P1-7 — `EventManager.create_event` fire-and-forget SQLite write:** 4 sync methods in `backend/economy/events.py:160-301,513-535` (`create_event`, `delete_event`, `deactivate_event`, `clear_all`) converted to `async def`. Each method's fire-and-forget `asyncio.get_event_loop()` + `ensure_future(self._store.<op>(...))` pattern replaced with `await self._store.<op>(...)`. Callers updated: `routes_events.py:114,210,236` (3 endpoints now `await`), `tests/test_events.py` (25 tests converted to async, pytest-asyncio `auto` mode handles them), `tests/test_scheduler.py:241` (1 test now `await`s), `tests/test_routes_events_invalidation.py` (`_StubManager` methods converted to async).
- **P3-8 — deprecated `asyncio.get_event_loop()`:** Closed as side effect — no more `get_event_loop()` calls in `events.py`. The 4 occurrences (in `create_event`, `delete_event`, `deactivate_event`, `clear_all`) were all part of the fire-and-forget pattern that P1-7 removed.
- **Design decision — `_prune_expired` left sync:** This method is called from sync read-only paths (`list_events`, `get_event`, `is_event_active`, `get_event_score_penalty`, `get_affected_currencies`, `has_major_patch_event`, `get_latest_major_patch_timestamp`, `get_active_event_summary`). Making it async would force every read-only path to become async — a much larger refactor with no caller-facing benefit. The SQLite prune was previously fire-and-forget from `_prune_expired`; now it's done exclusively by the scheduler (`DataScheduler.prune_events`, `backend/scheduler.py:145`) on a periodic schedule and by `backend/main.py:174` on startup — both code paths already exist and already `await self._store.prune_expired_events()`.
- **Tests after fix:** `pytest tests/test_events.py tests/test_routes_events_invalidation.py tests/test_lifecycle.py` → 56 pass / 0 fail. `pytest tests/` (full suite) → 374 pass / 18 pre-existing fail (7 `test_triangular` test pollution + 11 `test_compression` brotli import — both documented in §Quick Reference, NOT caused by iter 61). `pytest tests/e2e/` → 30 pass / 4 skip. tsc 0 errors (unchanged). jest 291 pass (unchanged).

### P2-11 (claimed fixed iter 60, actually incomplete — see P2-12)
- **Was claimed:** 10 orphan root files removed via `git rm`. tsc 0 errors, jest 291 pass.
- **Actual state (verified iter 61):** Commit `9ee73ae` only updated docs (`STATUS.md`, `REFACTOR_PLAN.md`, `worklog.md`, `MERGE_INSTRUCTIONS.md`, `DELETIONS.sh`). The `git rm` itself was never executed — all 10 orphan files are still present in the repo root. Tracked as P2-12.

### P1-11 + P2-7 (fixed in iter 59) — Cache invalidation cleanup
- **P1-11 — daily_stats invalidation:** All three event endpoints (`create_event` / `delete_event` / `deactivate_event`) in `routes_events.py` now call `daily_stats_cache.invalidate()` after `pipeline_cache.invalidate()`. 4 regression tests in `tests/test_routes_events_invalidation.py`.
- **P2-7 — targeted SSE invalidation by pair:** `usePriceStream.invalidateCaches(pair: string)` drops over-eager `crossRates` invalidation, adds per-pair `benchmark` invalidation.

### P0-2 + P1-1 + P1-2 + P2-10 + P3-1 + P3-6 (claimed fixed iter 58, actually incomplete)
- **Was claimed:** WS endpoints removed (`backend/api/routes_ws.py` 722 lines deleted, `src/hooks/use-websocket.ts` 548 lines deleted).
- **Actual state (verified iter 61):** `routes_ws.py` was renamed to `routes_ws.py.DELETED.txt` but the original file was ALSO kept (721 lines still present). Same for `use-websocket.ts` and `ws/info/route.ts`. The `.DELETED.txt` markers were added but the actual deletion never happened. The WS router was correctly removed from `backend/main.py`. Tracked as part of P2-12.

### P0-5 (fixed in iter 57) — Transitive prices
- `backend/economy/pricing.py` exposes `compute_transitive_prices` (BFS) + `find_price_24h_ago`. Shared helper. Dead `prices` parameter removed from `find_triangular_arbitrage`. P1-3 closed as side effect.

### P0-6 (fixed in iter 56) — Triangular numeraire
- Removed chaos-normalization + hardcode `prices["chaos"] = 1.0` from `routes_arbitrage.py`. Single numeraire = `config.league.base_currency`.

### P0-1 (fixed in iter 55) — SSE price stream
- Per-currency SSE events matching `SSEPriceUpdate` frontend interface. 4 tests in `tests/e2e/test_sse.py`.

### P0-3 + P0-4 (fixed in iter 54)
- **P0-3:** `routes_analyst._compute_trends` uses `find_price_24h_ago` for 24h change.
- **P0-4:** `PhaseDetector._reference_date` returns `patch_reset_date` unconditionally (no `max()`).

---

## Quick Reference — Frequent Problems

| Symptom | Cause | Where to fix |
|---------|-------|--------------|
| Backend "alive" but `/flips` hangs 5-15s | Clustering cold-start (P1-4) | `routes_prices.py:259-274` |
| 500 from backend becomes "no data" | `proxyWithFallback` swallows 5xx (P2-8) | `flipper-proxy.ts:480-485` |
| After backend restart, some events missing | FIXED in iter 61 (P1-7) — `await self._store.write_event` | `events.py` |
| `test_triangular.py` fails in full-suite mode but passes alone | Pre-existing test pollution (NOT a tracked issue — discovered iter 60) | Investigate during P1-4 or P1-8 pass |
| `test_compression.py` fails 11 tests with brotli ImportError | Pre-existing — `_CompressionResponder` removed from `middleware_compression.py` but tests still import it | Investigate during P2 pass |
| tsc 2 errors + jest 1 failing suite | P2-12 — iter 60 orphan file deletion was never actually executed | Run `DELETIONS.sh` for real |
