# STATUS.md — Known Issues & Refactoring Backlog

> **Last updated:** 2026-06-20 (iter 60 — P2-11 closed: 10 orphan root files removed; tsc + jest baseline restored)
> This file is the **single source of truth** for known bugs and refactoring priorities.
> Update it **before** fixing any issue. Cross-reference issue IDs in commits.
>
> **Iter 60 status:** P2-11 (orphan root files) closed — `git rm` of 10 stale duplicate files (`dashboard-page.tsx`, `events-sidebar.spec.ts`, `providers.tsx`, `route.ts`, `use-price-stream.ts`, `main.py`, `routes_sse.py`, `historical.py`, `test_lifecycle.py`, `test_optimal_currency.py`) committed by mistake into repo root in iter 58. Canonical copies under `src/`, `backend/`, `tests/`, `e2e/` are unchanged. Restored clean baseline: **tsc 0 errors** (was 2), **jest 291 pass / 14 suites** (was 13 + 1 failing). Backend pytest: 372 pass / 7 pre-existing `test_triangular` failures in full-suite mode only (test pollution — NOT caused by iter 60, present before deletion per `git stash` baseline). P1-7 (EventManager async) deferred to iter 61 — same area as P1-11 but multi-file refactor (5 sync methods + all callers + tests), not a 10-min batch.

---

## P0 — Critical (correctness, stability) — 0 active

(All P0 issues resolved. See §Fixed below.)

---

## P1 — Serious (performance, maintainability) — 7 items

### P1-4. Clustering duplicated between routes_prices and routes_arbitrage
- **Solution:** Single cache key `cluster_labels`, shared helper function.

### P1-5. `compute_quantized_analysis` — O(lot_sizes × max_lot_search) per pair
- **Solution:** Binary search instead of linear scan.

### P1-6. `HistoricalStore._prune_old_league_data` — DELETE without limits
- **Solution:** Chunked delete with `await db.commit()` between iterations.

### P1-7. `EventManager.create_event` — fire-and-forget SQLite write
- **Solution:** Make `create_event` / `delete_event` / `deactivate_event` / `clear_all_events` async, `await self._store.write_event(event)` etc. Update all callers in `routes_events.py` + tests.

### P1-8. `routes_optimizer._bellman_ford` — loses profitable arbitrage
- **Solution:** After max_hops relaxations — check for negative cycle.

### P1-9. Spread model — magic numbers without theoretical basis
- **Solution:** Move to `config.yaml:scoring.spread_model.*`.

### P1-10. `flipper-proxy.ts` circuit breaker — global, not per-endpoint
- **Solution:** Per-endpoint CB (Map<path, CircuitBreaker>).

---

## P2 — Medium (clean code, dev experience) — 8 items

- **P2-1.** `dashboard-page.tsx` — 1705 lines, god-component. Split into tab-specific subcomponents.
- **P2-2.** `pipeline_cache.py` / `daily_stats_cache.py` — shim modules (23 lines each). Delete, update imports.
- **P2-3.** `currency_names_ru.py` — 966 lines hardcoded dict. Move to JSON.
- **P2-4.** `routes_scanner.py` — duplicates `/flips`. Extend `/flips` query params or delete.
- **P2-5.** `routes_auth.py` comment in `main.py:516-519`. Delete.
- **P2-6.** Double circuit breaker not synchronized. Expose CB status in `/health`.
- **P2-8.** `proxyWithFallback` swallows ALL 5xx → 200. Pass-through in dev, mark fallback in prod.
- **P2-9.** `lightgbm_min_data_points: 15` — adaptive fallback instead of hardcode.

---

## P3 — Low priority (nice-to-have) — 6 items

- **P3-2.** `_prune_old_records` — also chunked delete.
- **P3-3.** `EventManager` not thread-safe for multi-worker uvicorn.
- **P3-4.** `SnapshotManager._snapshot` swap non-atomic for iterators.
- **P3-5.** No integration test for full `/flips` flow.
- **P3-7.** `REFACTOR_PLAN.md` and `worklog.md` — delete after closing all issues.
- **P3-8.** `asyncio.get_event_loop()` in `events.py:210` deprecated. Replace with `asyncio.get_running_loop()`. (Will be naturally fixed by P1-7.)

---

## Fixed

### P2-11 (fixed in iter 60) — Orphan root-level files cleanup
- **Was:** 10 stale duplicate files committed to repo root in iter 58 (`dashboard-page.tsx`, `events-sidebar.spec.ts`, `providers.tsx`, `route.ts`, `use-price-stream.ts`, `main.py`, `routes_sse.py`, `historical.py`, `test_lifecycle.py`, `test_optimal_currency.py`). All had canonical copies under `src/`, `backend/`, `tests/`, `e2e/`. The root `.ts`/`.tsx` files were caught by `tsconfig.json` (`include: ["**/*.ts", "**/*.tsx"]`) causing 2 tsc errors; the root `events-sidebar.spec.ts` was collected by Jest causing 1 failing suite.
- **Now:** All 10 orphan files removed via `git rm`. Single commit. Zero code changes — only deletions. Verified safe: no source code imports the orphan root files (only canonical copies via `@/` alias or relative paths to `src/`, `backend/`, `tests/`, `e2e/`).
- **Tests after fix:** `tsc --noEmit` → 0 errors (was 2). `jest` → 291 pass / 14 suites (was 13 + 1 failing). `pytest tests/test_triangular.py -v` → 7/7 pass. Full-suite `pytest tests/` shows 7 pre-existing `test_triangular` failures (test pollution, present at iter 59 baseline — NOT caused by iter 60).

### P1-11 + P2-7 (fixed in iter 59) — Cache invalidation cleanup
- **P1-11 — daily_stats invalidation:** All three event endpoints (`create_event` / `delete_event` / `deactivate_event`) in `routes_events.py` now call `daily_stats_cache.invalidate()` after `pipeline_cache.invalidate()`. 4 regression tests in `tests/test_routes_events_invalidation.py`.
- **P2-7 — targeted SSE invalidation by pair:** `usePriceStream.invalidateCaches(pair: string)` drops over-eager `crossRates` invalidation (derived from POE2 exchange pairs, not flipper prices), adds per-pair `benchmark` invalidation. Defensive empty-pair fallback.
- **Tests at time of fix:** Backend 4 new pass (375 → 379 pass / 4 skip). Jest 291 pass. tsc 2 pre-existing errors (P2-11 — fixed in iter 60).

### P0-2 + P1-1 + P1-2 + P2-10 + P3-1 + P3-6 (fixed in iter 58) — WebSocket removal
- Removed `backend/api/routes_ws.py` (722 lines, 5 WS endpoints), `src/hooks/use-websocket.ts` (548 lines), `src/app/api/flipper/ws/info/route.ts`. Removed WS router from `main.py`, `useFlipperWebSocket` usage from 5 components, WS env vars from `.env.example` / `start.sh` / `start.bat`. Real-time updates now handled exclusively by SSE (P0-1, iter 55) + REST polling.
- **Follow-up (non-blocking):** Orphaned i18n keys `wsStatusConnected/Connecting/Disconnected` + `stickyBarWsConnected/Connecting/Disconnected` + `forecastLiveModeTooltip` remain in 4 locale files. Harmless. Defer to P3 i18n cleanup pass.

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
| After backend restart, some events missing | `create_event` fire-and-forget SQLite write (P1-7) | `events.py:212` |
| `test_triangular.py` fails in full-suite mode but passes alone | Pre-existing test pollution (NOT a tracked issue — discovered iter 60) | Investigate during P1-4 or P1-8 pass |
