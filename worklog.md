# Work Log

> Single source for recent task entries. Long history removed — see git log for details.
> Append new entries at the bottom. Keep ≤3 latest entries.

---

## Task 65 — P2-13 (lazy/re-creatable process_pool)
**Agent:** Main Agent
**Date:** 2026-06-21

**Task:** Per iter 64 stopping point: fix `process_pool` test pollution so `test_triangular.py` runs in full-suite mode. Root cause already identified — `backend/main.py:279` `process_pool.shutdown(wait=False, cancel_futures=True)` runs in `TestClient` lifespan teardown, breaking any later `loop.run_in_executor(process_pool, ...)` call.

**Work Log:**
- Reproduced pollution: `pytest tests/test_routes_events_invalidation.py tests/test_triangular.py` → 7 fail with `RuntimeError: cannot schedule new futures after shutdown`.
- Designed fix: replace module-level singleton with lazy getter `get_process_pool()` that recreates the pool when `_process_pool` is `None` or has `_shutdown=True`. Thread-safe via `_process_pool_lock`. `lifespan` shutdown calls new `_shutdown_process_pool()` which closes the pool AND clears the cached reference.
- Updated `backend/main.py`: added `threading`/`warnings` imports, replaced `process_pool = ProcessPoolExecutor(...)` with `_process_pool` + `_process_pool_lock` + 3 helpers (`_is_pool_broken`, `get_process_pool`, `_shutdown_process_pool`). Lifespan warmup now uses `get_process_pool()`. Lifespan shutdown delegates to `_shutdown_process_pool()`.
- Added PEP 562 module `__getattr__` for backward compat: `from backend.main import process_pool` still works but emits `DeprecationWarning` and routes through `get_process_pool()`.
- Updated 5 call sites (all `from backend.main import process_pool` → `from backend.main import get_process_pool` + `executor = get_process_pool()`): `backend/arbitrage/triangular.py`, `backend/api/routes_arbitrage.py`, `backend/api/routes_portfolio.py`, `backend/api/routes_prices.py`, `backend/api/routes_anomalies.py`.
- Verified pollution fix: `pytest tests/test_routes_events_invalidation.py tests/test_triangular.py` → 11/11 pass.
- Ran full pytest suite (excluding `test_compression.py`): **418 pass** with `aiosqlite` installed (was 398 + 13 from `test_scheduler.py` + 7 from `test_triangular.py`). In user's baseline env (no aiosqlite): **405 pass** (+7 vs iter 64 baseline of 398).
- Verified tsc 0 errors, jest 291/291 (no JS/TS touched).
- Discovered new bug while running `test_compression.py`: previously thought to be a `brotli` env issue, but with `brotli` installed all 11 tests STILL fail. Real cause: test imports `_check_brotli_available` and `_CompressionResponder` from `backend/api/middleware_compression.py`, but that module is only 65 lines with a single `CompressionMiddleware` class — the helpers were removed in an earlier refactor. Documented as **P2-14** in STATUS.md per task rules ("Если найден новый баг — сначала документируй, потом фиксий"). Did NOT fix in this iter.
- Updated `STATUS.md`: P2-13 → Fixed; P2 count 9→9 (closed P2-13, added P2-14); updated Quick Reference (test_triangular pollution row → marked fixed; test_compression row → updated to reflect P2-14 not env issue; new row for `RuntimeError: cannot schedule new futures after shutdown` marked fixed in iter 65).
- Trimmed STATUS.md `Fixed` section to only iter 64 + iter 65 entries; older entries collapsed into one-line "Earlier fixes" pointer to git log.

**Stage Summary:**
- 1 issue closed: P2-13 (process_pool test pollution).
- 1 new issue documented: P2-14 (test_compression.py test/code mismatch).
- 6 files changed: `backend/main.py`, `backend/arbitrage/triangular.py`, `backend/api/routes_arbitrage.py`, `backend/api/routes_portfolio.py`, `backend/api/routes_prices.py`, `backend/api/routes_anomalies.py`.
- 2 doc files updated: `STATUS.md`, `worklog.md`.
- P1=4, P2=9, P3=5. ~9-13 iterations remaining.
- Baseline: pytest **405 pass** (excl. test_compression.py — see P2-14; test_scheduler.py needs `aiosqlite`), tsc 0 errors, jest 291/291.

**Stopping point:**
- Iter 65 done. P2-13 closed.
- `test_triangular.py` now runs in full-suite mode (+7 tests unlocked).
- Ready for iter 66. Suggested candidates (per REFACTOR_PLAN.md / STATUS.md):
  - **P2-14** (test_compression.py rewrite) — quick win, similar test-only scope.
  - **P2-5** (delete dead `routes_auth.py` comment in `main.py:516-519`) — trivial cleanup.
  - **P2-2** (delete `pipeline_cache.py` / `daily_stats_cache.py` shim modules) — small but needs import audit.
- Suggested commit: `fix(P2-13): lazy/re-creatable process_pool to survive TestClient lifespan teardown`

---

## Task 64 — P1-8 (Bellman-Ford negative cycle detection in routes_optimizer)
**Agent:** Main Agent
**Date:** 2026-06-21

**Stage Summary:**
- New helper `_detect_negative_cycle_nodes()` runs one extra relaxation pass. `_bellman_ford` returns `None` only when `target` is on the cycle; other targets still get shortest path. `/api/v1/optimizer/path` falls back to `direct_rate`.
- 1 file changed: `backend/api/routes_optimizer.py`. 1 new test file: `tests/test_routes_optimizer.py` (23 tests).
- Discovered P2-13 root cause during testing — documented, left for iter 65.

---

## Task 63 — P1-4 (clustering deduplication)
**Agent:** Main Agent
**Date:** 2026-06-21

**Stage Summary:**
- Shared `backend/economy/clustering_helpers.py` with `prepare_clustering_data()` + `run_clustering_sync()`. Single cache key `"cluster_labels"`. Fixed `prices[0]` bug. 16 new tests.
