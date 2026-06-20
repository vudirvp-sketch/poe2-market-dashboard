# STATUS.md — Known Issues & Refactoring Backlog

> **Last updated:** 2026-06-21 (iter 66 — closed P2-14, P2-5, P2-2, P1-5, P1-6, P1-9, P1-10, P3-2)
> Single source of truth for known bugs and refactoring priorities.
> Update BEFORE fixing any issue. Cross-reference issue IDs in commits.

---

## P0 — Critical (correctness, stability) — 0 active

All P0 issues resolved in iter 54-58.

---

## P1 — Serious (performance, maintainability) — 0 active 🎉

All P1 issues resolved in iter 54-66.

---

## P2 — Medium (clean code, dev experience) — 5 items

- **P2-1.** `dashboard-page.tsx` — 1705 lines, god-component. Split into tab-specific subcomponents.
- **P2-3.** `currency_names_ru.py` — 966-line hardcoded dict. Move to JSON.
- **P2-4.** `routes_scanner.py` — duplicates `/flips`. Extend `/flips` query params or delete.
- **P2-6.** Double circuit breaker not synchronized. Expose CB status in `/health`.
- **P2-8.** `proxyWithFallback` swallows ALL 5xx → 200. Pass-through in dev, mark fallback in prod.
- **P2-9.** `lightgbm_min_data_points: 15` — adaptive fallback instead of hardcode.

---

## P3 — Low priority (nice-to-have) — 3 items

- **P3-3.** `EventManager` not thread-safe for multi-worker uvicorn.
- **P3-4.** `SnapshotManager._snapshot` swap non-atomic for iterators.
- **P3-5.** No integration test for full `/flips` flow.
- **P3-7.** `REFACTOR_PLAN.md` and `worklog.md` — delete after closing all issues.

---

## Fixed (recent — older history in git log)

### iter 66 — 8 issues closed (P2-14, P2-5, P2-2, P1-5, P1-6, P1-9, P1-10, P3-2)

- **P2-14** — `test_compression.py` rewritten against current `CompressionMiddleware` API. Old test imported `_check_brotli_available` / `_CompressionResponder` that were removed in an earlier squash. New test (10 cases) verifies the actual contract: Vary header added on JSON, skipped on errors/SSE/non-JSON, no private symbols re-added.
- **P2-5** — Deleted 4-line dead `routes_auth.py` comment block from `backend/main.py`.
- **P2-2** — Deleted `backend/data/pipeline_cache.py` and `backend/data/daily_stats_cache.py` shim modules (re-exports of `unified_cache`). Updated 8 backend files + 4 test files to import directly from `backend.data.unified_cache`.
- **P1-5** — `compute_quantized_analysis` bounded linear scan. Derived theoretical upper bound `N_upper = ceil(2/D) + 1` from `f(N) = floor(N*R_sell) - ceil(N*R_buy) ≥ N*D - 2`. Replaces O(max_lot_search)=10000 scan with O(1/D) — 50-250× faster for typical spreads. 9 new regression tests (including a property test against naive scan over 50 random spreads).
- **P1-6 + P3-2** — Chunked delete in `HistoricalStore._prune_old_league_data` and `_prune_old_records`. Uses `DELETE ... WHERE rowid IN (SELECT rowid ... LIMIT 1000)` pattern (avoids `LIMIT` in DELETE which requires `SQLITE_ENABLE_UPDATE_DELETE_LIMIT` compile-time option). Commits between batches so concurrent reads stay responsive.
- **P1-9** — Moved 11 spread-model magic numbers from `routes_arbitrage.py` to `config.yaml:scoring.spread_model.*`. New `SpreadModelConfig` Pydantic model. Values are pre-extracted as a plain dict and passed to the executor (picklable). Zero behavior change — same defaults.
- **P1-10** — Per-endpoint circuit breaker in `flipper-proxy.ts`. Replaced 4 module-level globals (`flipperCircuitBreakerOpen`, etc.) with `Map<path, EndpointCircuitBreaker>`. Path normalization groups by major endpoint and strips ID-like trailing slugs (so `/api/v1/storage_value/divine-orb` and `/api/v1/storage_value/chaos-orb` share a breaker). Exported `getEndpointCircuitBreakerState`, `getAllEndpointCircuitBreakers`, `_resetAllCircuitBreakers` for testing/debugging. 8 new tests.

### iter 65 — P2-13 (process_pool test pollution)
Pool is now lazy/re-creatable via `get_process_pool()`; lifespan teardown clears the cached reference so the next caller gets a fresh pool. 5 call sites migrated. `test_triangular.py` now runs in full-suite mode.

### iter 64 — P1-8 (Bellman-Ford negative cycle detection)
New helper `_detect_negative_cycle_nodes()` runs one extra relaxation pass. 23 new tests.

### Earlier fixes
P0-1..P0-6, P1-1/2/4/7/8/11, P2-7/10/11/12/13, P3-8 (iter 54-65). See git log for details.

---

## Quick Reference — Frequent Problems

| Symptom | Cause | Where to fix |
|---------|-------|--------------|
| 500 from backend becomes "no data" | `proxyWithFallback` swallows 5xx (P2-8) | `flipper-proxy.ts:proxyWithFallback` |
| `test_scheduler.py` collection fails | `aiosqlite` not installed in env | `pip install aiosqlite` |
| `/optimizer/path` returns empty path with `data_available: true` | Profitable arbitrage cycle detected — optimal path unbounded, fall back to `direct_rate` (P1-8, iter 64) | `backend/api/routes_optimizer.py:_bellman_ford` |
| `RuntimeError: cannot schedule new futures after shutdown` | Used to happen after `TestClient` lifespan teardown killed the global pool (P2-13, **fixed in iter 65**) | `backend/main.py:get_process_pool()` |
| One endpoint's 5xx blocks all other endpoints | Used to happen with global circuit breaker (P1-10, **fixed in iter 66**) | `src/lib/flipper-proxy.ts:_doProxyWithRetry` (now per-endpoint) |
| SQLite `near "LIMIT": syntax error` | Use the `rowid IN (SELECT ... LIMIT ?)` pattern instead of `DELETE ... LIMIT ?` — the latter requires `SQLITE_ENABLE_UPDATE_DELETE_LIMIT` compile option | `backend/data/historical.py:_prune_old_league_data` |
