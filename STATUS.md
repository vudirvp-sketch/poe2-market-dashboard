# STATUS.md — Known Issues & Refactoring Backlog

> **Last updated:** 2026-06-21 (iter 64 — P1-8 closed: Bellman-Ford negative cycle detection)
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
- **P2-13.** `backend.main.process_pool` test pollution — `lifespan` shutdown closes the global pool, so any later test calling `find_triangular_arbitrage` (or any route using `loop.run_in_executor(process_pool, ...)`) fails with `RuntimeError: cannot schedule new futures after shutdown`. Root cause: `backend/main.py:279` `process_pool.shutdown(wait=False, cancel_futures=True)` runs in `TestClient` lifespan teardown. **Solution:** lazy/re-creatable pool, or fall back to `ThreadPoolExecutor` when the process pool is broken.

---

## P3 — Low priority (nice-to-have) — 5 items

- **P3-2.** `_prune_old_records` — also chunked delete.
- **P3-3.** `EventManager` not thread-safe for multi-worker uvicorn.
- **P3-4.** `SnapshotManager._snapshot` swap non-atomic for iterators.
- **P3-5.** No integration test for full `/flips` flow.
- **P3-7.** `REFACTOR_PLAN.md` and `worklog.md` — delete after closing all issues.

---

## Fixed (recent — older history in git log)

### P1-8 (fixed in iter 64) — Bellman-Ford negative cycle detection in routes_optimizer
- **Was:** `_bellman_ford` ran `max_hops` relaxation passes and then reconstructed the predecessor chain without checking for negative cycles. In `-log(rate)` space a negative cycle = profitable arbitrage (product of rates around cycle > 1). When such a cycle was reachable from `source`, the algorithm silently returned a stale path or hit the defensive `visited` cycle guard and returned `None` for the wrong reason — losing the arbitrage signal entirely.
- **Now:** New helper `_detect_negative_cycle_nodes(graph, dist, predecessor)` runs one extra relaxation pass and walks predecessor chains to identify the actual cycle members. `_bellman_ford` logs a warning and returns `None` only when the `target` is on the cycle (optimal path is unbounded); other targets still get their shortest path. Endpoint `/api/v1/optimizer/path` falls back to the direct edge if available.
- **Files changed:** `backend/api/routes_optimizer.py` (added helper + cycle check + docstring updates), `tests/test_routes_optimizer.py` (new — 23 tests covering graph build, basic Bellman-Ford, cycle detection, and end-to-end arbitrage handling).
- **Tests:** tsc 0 errors, jest 291/291, pytest 398 pass (incl. 23 new). test_triangular full-suite pollution is now P2-13 (separate, pre-existing).

### P1-4 (fixed in iter 63) — Clustering deduplicated
- **Was:** ~80 lines of near-identical clustering data-preparation code in both `routes_prices.py` and `routes_arbitrage.py`. Two separate cache keys (`price_cluster_labels`, `arbitrage_cluster_labels`) with a cross-cache bug: arbitrage read a key nobody wrote to. Bug in `routes_prices.py`: used `prices[0]` (oldest price) instead of `find_price_24h_ago()` for 24h-ago lookup.
- **Now:** Shared module `backend/economy/clustering_helpers.py` with `prepare_clustering_data()` and `run_clustering_sync()`. Single cache key `"cluster_labels"` used by both routes. Both code paths now use `find_price_24h_ago()` for correct timestamp-aware 24h-ago price lookup. 16 regression tests in `tests/test_clustering_helpers.py`.

### P2-12 (fixed in iter 62) — Orphan files actual cleanup
- All 16 orphan/remnant files removed via `git rm`. Zero code changes.

### P1-7 + P3-8 (fixed in iter 61) — EventManager async refactor
- 4 sync methods in `events.py` → async. 3 endpoints updated. 25+3+1 tests converted.

### Earlier P0/P1/P2/P3 fixes (iter 54-60)
- P0-1/2/3/4/5/6 (iter 54-58), P1-1/2/11 (iter 58-59), P2-7/10/11 (iter 58-60).

---

## Quick Reference — Frequent Problems

| Symptom | Cause | Where to fix |
|---------|-------|--------------|
| 500 from backend becomes "no data" | `proxyWithFallback` swallows 5xx (P2-8) | `flipper-proxy.ts:480-485` |
| `test_triangular.py` fails in full-suite mode | `process_pool` shut down by earlier `TestClient` lifespan teardown (P2-13) | `backend/main.py:279` |
| `test_compression.py` fails | Pre-existing — `brotli` not installed in env | `pip install brotli` or skip |
| `/optimizer/path` returns empty path with `data_available: true` | Profitable arbitrage cycle detected — optimal path unbounded, fall back to `direct_rate` (P1-8, iter 64) | `backend/api/routes_optimizer.py:_bellman_ford` |
