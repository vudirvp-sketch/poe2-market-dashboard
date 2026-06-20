# Work Log

> Single source for recent task entries. Long history removed — see git log for details.
> Append new entries at the bottom. Keep ≤5 latest entries.

---

## Task 64 — P1-8 (Bellman-Ford negative cycle detection in routes_optimizer)
**Agent:** Main Agent
**Date:** 2026-06-21

**Task:** Per iter 63 stopping point: add negative cycle detection to `_bellman_ford` in `backend/api/routes_optimizer.py`. The algorithm previously ran `max_hops` relaxation passes and reconstructed the predecessor chain without checking for negative cycles — losing the arbitrage signal entirely when a profitable cycle (product of rates > 1) was reachable from source.

**Work Log:**
- Read `routes_optimizer.py` (402 lines). Identified that the existing defensive `visited` cycle guard in path reconstruction would return `None` for the wrong reason — it masked arbitrage instead of signalling it.
- Read `STATUS.md` P1-8 spec: "After max_hops relaxations — check for negative cycle."
- Read `tests/test_optimal_currency.py` to mirror its testing patterns (uses `ExchangeRate` model from `backend.models.currency`).
- Designed the fix as a separate helper for testability:
  - `_detect_negative_cycle_nodes(graph, dist, predecessor)` — runs one extra relaxation pass; nodes whose distance can still decrease are "affected"; walking predecessor chains from affected nodes identifies the actual cycle members.
- Modified `_bellman_ford`:
  - After the existing `max_hops` relaxation loop, calls the new helper.
  - If cycle nodes are detected, logs a warning naming them.
  - Returns `None` ONLY when `target` is on the cycle (optimal path is unbounded). Other targets still get their shortest path.
  - The endpoint `/api/v1/optimizer/path` already had a `result is None` branch that returns an empty `path` with `direct_rate` populated — so callers transparently fall back to the direct edge.
- Updated module + endpoint docstrings to document the new behaviour.
- Created `tests/test_routes_optimizer.py` with 23 regression tests across 5 classes:
  - `TestBuildGraph` (3): forward edge weight, reverse edge weight, non-positive rate filtering.
  - `TestBellmanFordBasic` (7): direct edge, two-hop chain, three-node chain with shortcut (proves inconsistency ⇒ arbitrage), unreachable target, missing source, source==target, max_hops limit, negative weights on reverse edges.
  - `TestDetectNegativeCycle` (4): no-cycle returns empty set, profitable cycle detected, cycle isolated from source not flagged, empty graph.
  - `TestBellmanFordNegativeCycle` (4): target on cycle returns None, target off cycle still returns path, no-cycle path returned normally, three-node profitable cycle.
  - `TestCollectCurrencies` (4): sorted unique, empty, single pair, duplicates.
- Discovered an important property during testing: when both a direct edge `a→c` AND a two-hop path `a→b→c` exist, ANY inconsistency (direct better OR worse than two-hop) creates a profitable arbitrage cycle via the reverse edges. Tests adjusted to use chain graphs (no shortcut) for the no-arbitrage case.
- Investigated pre-existing `test_triangular.py` full-suite failure (STATUS.md said "investigate during P1-8"). Root cause found: `RuntimeError: cannot schedule new futures after shutdown` — `backend/main.py:279` `process_pool.shutdown()` runs in `TestClient` lifespan teardown, breaking subsequent tests that call `loop.run_in_executor(process_pool, ...)`. Per task rules ("Если найден новый баг — сначала документируй в STATUS.md как Known Issue, потом фиксись"), documented as **P2-13** in STATUS.md. Did NOT fix in this iter — left for iter 65+.
- Ran tests:
  - `pytest tests/test_routes_optimizer.py -v` → 23/23 pass.
  - `pytest tests/ --ignore=test_scheduler.py --ignore=test_compression.py --ignore=test_triangular.py` → 398 pass (baseline without new tests: 375 pass). +23 new tests, no regressions.
  - Verified pre-existing pollution with `git stash -u` baseline run: 375 pass, 7 fail (test_triangular full-suite pollution — same as before my changes).
- Updated `STATUS.md`: P1-8 → Fixed; P1 count 5→4; added P2-13; P2 count 8→9; updated Quick Reference table to point test_triangular pollution at P2-13 and to explain the new `/optimizer/path` empty-path-with-direct-rate behaviour.
- Updated `REFACTOR_PLAN.md`: v27→v28, iter 64 marked DONE, recommended next iter = P2-13 (quick win, root cause already identified), estimation table refreshed.
- Updated `AGENT_NAVIGATION.md`: removed "BUGGY" tag from `routes_optimizer.py` row, added `backend/main.py` row for process_pool pollution visibility, added rule 19 (optimizer negative cycle invariant), updated Known Issues summary.

**Stage Summary:**
- 1 issue closed: P1-8 (Bellman-Ford negative cycle detection).
- 1 new issue documented: P2-13 (process_pool test pollution, root cause identified).
- 1 file changed: `backend/api/routes_optimizer.py` (helper + cycle check + docstring updates).
- 1 new test file: `tests/test_routes_optimizer.py` (23 tests).
- 4 doc files updated: `STATUS.md`, `REFACTOR_PLAN.md`, `AGENT_NAVIGATION.md`, `worklog.md`.
- P1=4, P2=9, P3=5. ~10-14 iterations remaining.
- Baseline: pytest 398 pass (excl. 3 pre-existing broken files), tsc 0 errors, jest 291/291 (unchanged from iter 63).

**Stopping point:**
- Iter 64 done. P1-8 closed.
- Ready for iter 65 = **P2-13** (process_pool test pollution) — quick win, root cause already identified in `backend/main.py:279`. Recommended next per `REFACTOR_PLAN.md` v28.
- Suggested commit: `fix(P1-8): add negative cycle detection after Bellman-Ford relaxation`

---

## Task 63 — P1-4 (clustering deduplication between routes_prices and routes_arbitrage)
**Agent:** Main Agent
**Date:** 2026-06-21

**Stage Summary:**
- Shared `backend/economy/clustering_helpers.py` with `prepare_clustering_data()` + `run_clustering_sync()`. Single cache key `"cluster_labels"`. Fixed `prices[0]` bug. 16 new tests.

---

## Task 62 — P2-12 (orphan files actual cleanup)
**Agent:** Main Agent
**Date:** 2026-06-20

**Stage Summary:**
- 16 orphan/remnant files removed via `git rm`. Zero code changes. True clean baseline restored.

---

## Task 61 — P1-7 + P3-8 (EventManager async refactor)
**Agent:** Main Agent
**Date:** 2026-06-20

**Stage Summary:**
- 4 sync methods in events.py → async. P3-8 auto-closed. 25+3+1 tests converted to async.

---

## Task 59 — P1-11 + P2-7 (cache invalidation cleanup)
**Agent:** Main Agent
**Date:** 2026-06-20

**Stage Summary:**
- P1-11: daily_stats_cache invalidation after pipeline_cache. P2-7: targeted SSE invalidation.
