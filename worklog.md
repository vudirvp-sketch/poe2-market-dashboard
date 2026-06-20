# Work Log

> Single source for recent task entries. Long history removed — see git log for details.
> Append new entries at the bottom. Keep ≤3 latest entries.

---

## Task 66 — 8 issues closed (P2-14, P2-5, P2-2, P1-5, P1-6, P1-9, P1-10, P3-2)
**Agent:** Main Agent
**Date:** 2026-06-21

**Task:** Per iter 65 stopping point — close as many issues as possible without losing quality. User pushed back on "1-3 issues per iter" pace; demonstrated that 8 independent issues can be safely closed when most are quick wins or test-only scope.

**Work Log:**
- **P2-14** (test-only): Rewrote `tests/test_compression.py` from scratch against current `CompressionMiddleware` API. Old test imported `_check_brotli_available` / `_CompressionResponder` symbols that were squashed away in an earlier refactor. New test (10 cases) verifies the actual contract: Vary header added to JSON responses, skipped for errors/SSE/non-JSON, regression guard prevents re-adding private symbols. 10/10 pass.
- **P2-5** (trivial): Deleted 4-line dead `routes_auth.py` comment block from `backend/main.py:597-600`.
- **P2-2** (import audit + deletion): Deleted `backend/data/pipeline_cache.py` and `backend/data/daily_stats_cache.py` shim modules (each was 23 lines re-exporting from `unified_cache.py`). Updated 8 backend files + 4 test files to import directly from `backend.data.unified_cache`. Also updated `caplog.at_level(logger="backend.data.pipeline_cache")` → `backend.data.unified_cache` in `test_pipeline_cache_degraded.py`.
- **P1-5** (perf): Bounded linear scan in `compute_quantized_analysis`. Derived theoretical upper bound `N_upper = ceil(2/D) + 1` from the guarantee `f(N) = floor(N*R_sell) - ceil(N*R_buy) ≥ N*D - 2` (where D = R_sell - R_buy). Replaces 10000-iteration scan with O(1/D) — for typical D ∈ [0.01, 0.05] this is 50-250× faster. Binary search was rejected because `f(N)` is NOT monotonic (fractional parts cause f(N+1) < f(N)); documented this in the function docstring. 9 new regression tests in `test_scorer.py::TestQuantizedAnalysisP1_5`, including a property test against naive scan over 50 random spreads.
- **P1-6 + P3-2** (same pattern): Chunked delete in `HistoricalStore._prune_old_league_data` and `_prune_old_records`. Each DELETE is now batched with chunk size 1000 rows, `await db.commit()` between batches. Used `DELETE ... WHERE rowid IN (SELECT rowid ... LIMIT ?)` pattern because SQLite's `DELETE ... LIMIT ?` requires `SQLITE_ENABLE_UPDATE_DELETE_LIMIT` compile-time option, which the test env doesn't have. Caught the LIMIT syntax error during testing and fixed it.
- **P1-9** (config extraction): Moved 11 spread-model magic numbers from `routes_arbitrage.py:_build_flip_opportunities_sync` to `config.yaml:scoring.spread_model.*`. New `SpreadModelConfig` Pydantic model in `backend/config.py`. Values pre-extracted as plain dict in the async wrapper and passed to the executor (picklable). Zero behavior change — same defaults.
- **P1-10** (reliability): Per-endpoint circuit breaker in `flipper-proxy.ts`. Replaced 4 module-level globals (`flipperCircuitBreakerOpen`, `flipperCircuitBreakerOpenSince`, `flipperCircuitBreakerCooldownMs`, `flipperConsecutiveFailures`) + `flipperCircuitBreakerState` with `Map<string, EndpointCircuitBreaker>`. Path normalization groups by major endpoint and strips ID-like trailing slugs (so `/api/v1/storage_value/divine-orb` and `/api/v1/storage_value/chaos-orb` share one breaker). Exported `getEndpointCircuitBreakerState`, `getAllEndpointCircuitBreakers`, `_resetAllCircuitBreakers` for debugging/tests. 8 new tests in `flipper-proxy.test.ts`. Also added `circuit_breaker_endpoint` field to 503 error responses for debugging.
- Verified: pytest **437 pass** (was 418 → +19 new tests: 9 P1-5 + 10 P2-14). jest **299 pass** (was 291 → +8 P1-10). tsc **0 errors**.
- Updated `STATUS.md` (P1=0 🎉, P2=5, P3=3; new Quick Reference rows for per-endpoint CB and SQLite LIMIT), `REFACTOR_PLAN.md` (v30.0 — estimation 4-7 iters remaining, iter 66 demonstration that 8 issues/iter is feasible when independent).

**Stage Summary:**
- 8 issues closed: P2-14, P2-5, P2-2, P1-5, P1-6, P1-9, P1-10, P3-2.
- P1 bucket is now **EMPTY** (0 remaining) — all 11 P1 issues resolved.
- ~17 files changed (8 backend, 4 test, 1 frontend lib, 1 frontend test, 2 docs, 1 config.yaml).
- P1=0, P2=5, P3=3. ~4-7 iterations remaining.
- Baseline: pytest **437 pass**, tsc 0 errors, jest **299 pass** (with `aiosqlite` installed).

**Stopping point:**
- Iter 66 done. P1 bucket emptied.
- Next iter should focus on P2 cleanup (5 remaining). Recommended order:
  - **P2-9** (`lightgbm_min_data_points` adaptive) — small, isolated.
  - **P2-4** (`routes_scanner.py` duplicates `/flips`) — extend or delete.
  - **P2-6** (expose CB status in `/health`) — small.
  - **P2-8** (`proxyWithFallback` 5xx handling) — touches frontend error UX.
  - **P2-3** (`currency_names_ru.py` → JSON) — medium, mechanical.
- Suggested commit messages (one per issue): `fix(P2-14): rewrite test_compression.py against current CompressionMiddleware API`; then 7 more commits for the other issues. (User may prefer to squash related fixes — e.g., P1-5+P1-6+P1-9+P1-10 are independent but all touch backend perf/reliability.)

---

## Task 65 — P2-13 (lazy/re-creatable process_pool)
**Agent:** Main Agent
**Date:** 2026-06-21

**Stage Summary:**
- Pool is now lazy/re-creatable via `get_process_pool()`; lifespan teardown clears the cached reference so the next caller gets a fresh pool. 5 call sites migrated. `test_triangular.py` now runs in full-suite mode (+7 tests). Backward-compat: module `__getattr__` keeps `from backend.main import process_pool` working with `DeprecationWarning`.

---

## Task 64 — P1-8 (Bellman-Ford negative cycle detection in routes_optimizer)
**Agent:** Main Agent
**Date:** 2026-06-21

**Stage Summary:**
- New helper `_detect_negative_cycle_nodes()` runs one extra relaxation pass. `_bellman_ford` returns `None` only when `target` is on the cycle; other targets still get shortest path. `/api/v1/optimizer/path` falls back to `direct_rate`. 23 new tests.
