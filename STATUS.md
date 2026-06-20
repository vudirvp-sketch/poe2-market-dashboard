# STATUS.md — Known Issues & Refactoring Backlog

> **Last updated:** 2026-06-21 (iter 63 — P1-4 closed: clustering deduplicated)
> Single source of truth for known bugs and refactoring priorities.
> Update BEFORE fixing any issue. Cross-reference issue IDs in commits.

---

## P0 — Critical (correctness, stability) — 0 active

All P0 issues resolved in iter 54-58.

---

## P1 — Serious (performance, maintainability) — 5 items

### P1-5. `compute_quantized_analysis` — O(lot_sizes × max_lot_search) per pair
- **Solution:** Binary search instead of linear scan.

### P1-6. `HistoricalStore._prune_old_league_data` — DELETE without limits
- **Solution:** Chunked delete with `await db.commit()` between iterations.

### P1-8. `routes_optimizer._bellman_ford` — loses profitable arbitrage
- **Solution:** After max_hops relaxations — check for negative cycle.

### P1-9. Spread model — magic numbers without theoretical basis
- **Solution:** Move to `config.yaml:scoring.spread_model.*`.

### P1-10. `flipper-proxy.ts` circuit breaker — global, not per-endpoint
- **Solution:** Per-endpoint CB (`Map<path, CircuitBreaker>`).

---

## P2 — Medium (clean code, dev experience) — 8 items

- **P2-1.** `dashboard-page.tsx` — 1705 lines, god-component. Split into tab-specific subcomponents.
- **P2-2.** `pipeline_cache.py` / `daily_stats_cache.py` — shim modules (23 lines each). Delete, update imports.
- **P2-3.** `currency_names_ru.py` — 966-line hardcoded dict. Move to JSON.
- **P2-4.** `routes_scanner.py` — duplicates `/flips`. Extend `/flips` query params or delete.
- **P2-5.** `routes_auth.py` comment in `main.py:516-519`. Delete.
- **P2-6.** Double circuit breaker not synchronized. Expose CB status in `/health`.
- **P2-8.** `proxyWithFallback` swallows ALL 5xx → 200. Pass-through in dev, mark fallback in prod.
- **P2-9.** `lightgbm_min_data_points: 15` — adaptive fallback instead of hardcode.

---

## P3 — Low priority (nice-to-have) — 5 items

- **P3-2.** `_prune_old_records` — also chunked delete.
- **P3-3.** `EventManager` not thread-safe for multi-worker uvicorn.
- **P3-4.** `SnapshotManager._snapshot` swap non-atomic for iterators.
- **P3-5.** No integration test for full `/flips` flow.
- **P3-7.** `REFACTOR_PLAN.md` and `worklog.md` — delete after closing all issues.

---

## Fixed (recent — older history in git log)

### P1-4 (fixed in iter 63) — Clustering deduplicated
- **Was:** ~80 lines of near-identical clustering data-preparation code in both `routes_prices.py` and `routes_arbitrage.py`. Two separate cache keys (`price_cluster_labels`, `arbitrage_cluster_labels`) with a cross-cache bug: arbitrage read a key nobody wrote to. Bug in `routes_prices.py`: used `prices[0]` (oldest price) instead of `find_price_24h_ago()` for 24h-ago lookup.
- **Now:** Shared module `backend/economy/clustering_helpers.py` with `prepare_clustering_data()` and `run_clustering_sync()`. Single cache key `"cluster_labels"` used by both routes. Both code paths now use `find_price_24h_ago()` for correct timestamp-aware 24h-ago price lookup. 16 regression tests in `tests/test_clustering_helpers.py`.
- **Files changed:** `backend/economy/clustering_helpers.py` (new), `backend/api/routes_prices.py`, `backend/api/routes_arbitrage.py`, `tests/test_clustering_helpers.py` (new).
- **Tests:** tsc 0 errors, jest 291/291, pytest 136 pass (incl. 16 new tests).

### P2-12 (fixed in iter 62) — Orphan files actual cleanup
- All 16 orphan/remnant files removed via `git rm`. Zero code changes.

### P1-7 + P3-8 (fixed in iter 61) — EventManager async refactor
- 4 sync methods in `events.py` → async. 3 endpoints updated. 25+3+1 tests converted.

### P1-11 + P2-7 (fixed in iter 59) — Cache invalidation cleanup
- P1-11: `daily_stats_cache.invalidate()` after `pipeline_cache.invalidate()` in 3 event endpoints. P2-7: targeted SSE invalidation.

### P0-2 + P1-1 + P1-2 + P2-10 + P3-1 + P3-6 (fixed in iter 58) — WebSocket removal
- Removed WS endpoints. Real-time updates = SSE + REST polling only.

### Earlier P0 fixes (iter 54-57)
- **P0-1** (iter 55): SSE contract. **P0-3+P0-4** (iter 54): analyst 24h change + PhaseDetector. **P0-5** (iter 57): unified pricing.py. **P0-6** (iter 56): single numeraire.

---

## Quick Reference — Frequent Problems

| Symptom | Cause | Where to fix |
|---------|-------|--------------|
| 500 from backend becomes "no data" | `proxyWithFallback` swallows 5xx (P2-8) | `flipper-proxy.ts:480-485` |
| `test_triangular.py` fails in full-suite mode | Pre-existing test pollution — investigate during P1-8 | `tests/test_triangular.py` |
| `test_compression.py` fails | Pre-existing — `brotli` not installed in env | `pip install brotli` or skip |
