# iter 134 — Merge Instructions

## What this iter ships

**TD-3 pipeline_cache optimization** — eliminates the doubled `find_triangular_arbitrage`
compute cost where the function previously ran BOTH in `SnapshotManager._refresh()` (via
`compute_triangular_cycles` for SQLite persistence) AND in the live
`/api/v1/arbitrage/triangular` route on first-request cache miss.

The live route now gets a cache HIT on the first request after each refresh — was a
30-60s cache MISS pre-optimization.

Backend-only. No frontend changes. No UI impact.

## Files modified (7)

### Backend (3)
- `backend/economy/triangular_cycles.py`
  - Added `build_cross_rate_warning(suspicious_triples) -> dict | None` pure helper
    (extracted verbatim from `routes_arbitrage.py:878-898` — DRY parity guarantee).
  - Added optional `pipeline_cache: PipelineCache | None = None` parameter to
    `compute_triangular_cycles`. When provided, populates the live `/triangular`
    route's cache with `(opportunities, cross_rate_warning)` under key
    `f"triangular_arbitrage_{min_profit_pct}"` (matches `routes_arbitrage.py:860/901`).
    Best-effort: wrapped in `try/except` that logs a warning and continues.
  - Added `TYPE_CHECKING` import for `PipelineCache` (no runtime circular dep).

- `backend/api/data_snapshot.py`
  - In `SnapshotManager._refresh()` TD-3 block: pass `pipeline_cache=get_pipeline_cache()`
    to `compute_triangular_cycles`. Added lazy import for `get_pipeline_cache`.
  - Added 6-line block comment explaining the optimization.

- `backend/api/routes_arbitrage.py`
  - Added module-level import `from backend.economy.triangular_cycles import build_cross_rate_warning`.
  - Replaced 21-line inline `cross_rate_warning` construction with a single call to
    `build_cross_rate_warning(suspicious_triples)` — DRY parity guarantee.
  - Added 8-line block comment explaining the parity guarantee.

### Tests (1)
- `tests/test_triangular_cycles.py`
  - New class `TestBuildCrossRateWarning` (9 tests) — parity tests for the extracted helper.
  - New class `TestComputeTriangularCyclesPipelineCache` (10 tests) — covers the
    optimization behavior (cache key, value shape, back-compat, best-effort, identity).

### Docs (3)
- `STATUS.md` — iter 134 header; `TD-3 pipeline_cache` closed entry; TD-3 backlog row
  updated (optimization SHIPPED, performance note removed); verbose KI-27/P10/TD-5/KI-26
  closed entries compressed.
- `worklog.md` — iter 134 entry prepended; iter 132 trimmed (kept iter 133 + iter 134).
- `AGENT_NAVIGATION.md` — header iter 133 → iter 134; updated `triangular_cycles.py`
  row (added pipeline_cache parameter + build_cross_rate_warning export); updated
  `data_snapshot.py:_refresh` row (removed stale "Performance note — DOUBLES compute cost").

## Files deleted (2)
- `README_iter124.md` — stale merge instructions from iter 124. iter 133 worklog claimed
  it was DELETED but the file was still tracked in git (worklog inaccuracy).
- `MERGE_INSTRUCTIONS_iter133.md` — stale merge instructions from iter 133.

## How to merge

Copy the contents of this archive over your local clone, preserving directory structure:

```bash
# From the repo root, after extracting this archive:
cp -r path/to/archive/* ./
git add -A
git status  # verify 7 modified + 2 deleted
```

## Verification

- pytest: **1455 passed** in both UTC and UTC+5 (1436 baseline + 19 new), 0 regressions.
- 9.5s total runtime.
- No frontend files touched — jest/tsc/lint unchanged from iter 133.

## What was NOT done (deferred to iter 135+)

- **TD-9 fallback removal** — `deriveTrendSparklineData` should be deleted iter 135+
  if production logs confirm no fallback path is hit for 2 iters.
- **Production verification P10 Phase 2 + TD-3** — verify end-to-end on a real backend:
  - `/api/flipper/triangular/history` returns non-empty `points` once `triangular_cycles`
    table has ≥ 2 rows;
  - trend chart renders SVG line on real backend;
  - Days selector refetches with the new `days` query param;
  - `/triangular` route's first request after a refresh returns in <100ms (was 30-60s
    pre-optimization) — check for the `TD-3 cache: populated pipeline_cache` debug log line.
- **P10 Phase 3 (gold rate SQLite promotion)** — optional, defer until adoption.

## Stopping point for iter 135

iter 134 = TD-3 pipeline_cache optimization SHIPPED. All baselines preserved (1455 pytest
green in both UTC and UTC+5, 0 regressions). Next iter (iter 135+) candidates in priority
order:
1. **TD-9 fallback removal** (delete `deriveTrendSparklineData` once production logs
   confirm no fallback hits for 2 iters).
2. **Production verification P10 Phase 2 + TD-3** (verify end-to-end on a real backend).
3. **P10 Phase 3** (optional, defer until adoption).
