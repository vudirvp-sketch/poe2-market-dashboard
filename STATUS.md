# STATUS.md — Known Issues & Refactoring Backlog

> **Last updated:** 2026-06-21 (iter 65 — P2-13 closed: lazy/re-creatable process_pool)
> Single source of truth for known bugs and refactoring priorities.
> Update BEFORE fixing any issue. Cross-reference issue IDs in commits.

---

## P0 — Critical (correctness, stability) — 0 active

All P0 issues resolved in iter 54-58.

---

## P1 — Serious (performance, maintainability) — 4 items

### P1-5. `compute_quantized_analysis` — O(lot_sizes × max_lot_search) per pair
- **Solution:** Binary search instead of linear scan.

### P1-6. `HistoricalStore._prune_old_league_data` — DELETE without limits
- **Solution:** Chunked delete with `await db.commit()` between iterations.

### P1-9. Spread model — magic numbers without theoretical basis
- **Solution:** Move to `config.yaml:scoring.spread_model.*`.

### P1-10. `flipper-proxy.ts` circuit breaker — global, not per-endpoint
- **Solution:** Per-endpoint CB (`Map<path, CircuitBreaker>`).

---

## P2 — Medium (clean code, dev experience) — 9 items

- **P2-1.** `dashboard-page.tsx` — 1705 lines, god-component. Split into tab-specific subcomponents.
- **P2-2.** `pipeline_cache.py` / `daily_stats_cache.py` — shim modules (23 lines each). Delete, update imports.
- **P2-3.** `currency_names_ru.py` — 966-line hardcoded dict. Move to JSON.
- **P2-4.** `routes_scanner.py` — duplicates `/flips`. Extend `/flips` query params or delete.
- **P2-5.** `routes_auth.py` comment in `main.py:516-519`. Delete.
- **P2-6.** Double circuit breaker not synchronized. Expose CB status in `/health`.
- **P2-8.** `proxyWithFallback` swallows ALL 5xx → 200. Pass-through in dev, mark fallback in prod.
- **P2-9.** `lightgbm_min_data_points: 15` — adaptive fallback instead of hardcode.
- **P2-14.** `test_compression.py` references private symbols (`_check_brotli_available`, `_CompressionResponder`) that don't exist in `backend/api/middleware_compression.py` (only 65 lines, single `CompressionMiddleware` class). All 11 tests fail — 3 with `ImportError`, 8 with assertion mismatches. Previously mis-diagnosed as "brotli env issue". Real cause: test was written against an earlier middleware refactor that has since been deleted/squashed. **Solution:** rewrite `test_compression.py` against the current `CompressionMiddleware` API, or restore the missing helpers.

---

## P3 — Low priority (nice-to-have) — 5 items

- **P3-2.** `_prune_old_records` — also chunked delete.
- **P3-3.** `EventManager` not thread-safe for multi-worker uvicorn.
- **P3-4.** `SnapshotManager._snapshot` swap non-atomic for iterators.
- **P3-5.** No integration test for full `/flips` flow.
- **P3-7.** `REFACTOR_PLAN.md` and `worklog.md` — delete after closing all issues.

---

## Fixed (recent — older history in git log)

### P2-13 (fixed in iter 65) — process_pool test pollution
- **Was:** `process_pool` was a module-level singleton in `backend/main.py` created at import time. The FastAPI `lifespan` shutdown handler called `process_pool.shutdown(wait=False, cancel_futures=True)`, permanently breaking the global pool. Any later test in the same pytest session that called `loop.run_in_executor(process_pool, ...)` (e.g. every test in `test_triangular.py`, plus routes that offload to the pool) failed with `RuntimeError: cannot schedule new futures after shutdown`. This is why `test_triangular.py` was excluded from the full-suite baseline.
- **Now:** Pool is stored in private `_process_pool` and accessed only through `get_process_pool()`, which lazily creates a fresh pool if the cached one is `None` or has `_shutdown=True`. Thread-safe via `_process_pool_lock`. `lifespan` shutdown calls `_shutdown_process_pool()` which closes the pool AND clears the cached reference, so the next caller gets a brand-new pool. Backward-compat: module `__getattr__` still exposes `process_pool` for old imports but routes through `get_process_pool()` with `DeprecationWarning`.
- **Files changed:** `backend/main.py` (lazy pool + helpers + `__getattr__` shim), `backend/arbitrage/triangular.py`, `backend/api/routes_arbitrage.py`, `backend/api/routes_portfolio.py`, `backend/api/routes_prices.py`, `backend/api/routes_anomalies.py` (all 5 call sites switched from `from backend.main import process_pool` to `get_process_pool()`).
- **Tests:** tsc 0 errors, jest 291/291, pytest **405 pass** (was 398 — `test_triangular.py` 7 tests now run in full-suite mode). With `aiosqlite` installed, pytest **418 pass** (`test_scheduler.py` 13 also works).

### P1-8 (fixed in iter 64) — Bellman-Ford negative cycle detection in routes_optimizer
- **Was:** `_bellman_ford` ran `max_hops` relaxation passes and then reconstructed the predecessor chain without checking for negative cycles. In `-log(rate)` space a negative cycle = profitable arbitrage. When such a cycle was reachable from `source`, the algorithm silently returned a stale path or hit the defensive `visited` cycle guard and returned `None` for the wrong reason — losing the arbitrage signal entirely.
- **Now:** New helper `_detect_negative_cycle_nodes(graph, dist, predecessor)` runs one extra relaxation pass and walks predecessor chains to identify the actual cycle members. `_bellman_ford` logs a warning and returns `None` only when the `target` is on the cycle (optimal path is unbounded); other targets still get their shortest path. Endpoint `/api/v1/optimizer/path` falls back to the direct edge if available. 23 new tests in `tests/test_routes_optimizer.py`.

### Earlier fixes
P0-1..P0-6, P1-1/2/4/7/8/11, P2-7/10/11/12, P3-8 (iter 54-63). See git log for details.

---

## Quick Reference — Frequent Problems

| Symptom | Cause | Where to fix |
|---------|-------|--------------|
| 500 from backend becomes "no data" | `proxyWithFallback` swallows 5xx (P2-8) | `flipper-proxy.ts:480-485` |
| `test_compression.py` fails (ImportError / assertion) | Test references symbols removed from middleware (P2-14) | `tests/test_compression.py` + `backend/api/middleware_compression.py` |
| `test_scheduler.py` collection fails | `aiosqlite` not installed in env | `pip install aiosqlite` |
| `/optimizer/path` returns empty path with `data_available: true` | Profitable arbitrage cycle detected — optimal path unbounded, fall back to `direct_rate` (P1-8, iter 64) | `backend/api/routes_optimizer.py:_bellman_ford` |
| `RuntimeError: cannot schedule new futures after shutdown` | Used to happen after `TestClient` lifespan teardown killed the global pool (P2-13, **fixed in iter 65**) | `backend/main.py:get_process_pool()` |
