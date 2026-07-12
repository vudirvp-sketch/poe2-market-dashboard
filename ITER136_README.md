# iter 136 — KI-28 fix + P10 Phase 2 / TD-3 code-path audit

## What this archive contains

Modified files for iter 136. Extract this archive at the root of your
local clone of `https://github.com/vudirvp-sketch/poe2-market-dashboard`
to overwrite the existing files with the iter 136 versions.

## Files modified (4)

- `STATUS.md` — iter 136 header + KI-28 closed entry + KI-28 Quick
  Reference row + TD-3 backlog row updated (code-path audit COMPLETE)
- `worklog.md` — iter 136 entry prepended, trimmed to last 2 iters
  (iter 135 + iter 136)
- `AGENT_NAVIGATION.md` — header updated from iter 135 to iter 136
- `tests/test_daily_stats_persistence.py` — added `_run(coro)` helper
  (`asyncio.run(coro)`) + replaced 12 `asyncio.get_event_loop()
  .run_until_complete(...)` call sites (Python 3.14 compatibility —
  `asyncio.get_event_loop()` was removed in 3.14)

## Files deleted (2)

See `DELETIONS.txt` for the list. Run `git rm <file>` for each, OR
just `git add -A` after extracting — git auto-stages deletions when
the files are gone from the working tree.

## What was done

1. **KI-28 fix** — Python 3.14 removed the implicit event-loop creation
   in `asyncio.get_event_loop()`. The 12 call sites in
   `tests/test_daily_stats_persistence.py::TestDailyStatsRoute` raised
   `RuntimeError: There is no current event loop in thread 'MainThread'`
   on Python 3.14 (6 test failures). Fix: extracted a `_run(coro)`
   module-level helper that calls `asyncio.run(coro)`. Each call creates
   a fresh loop — safe for HistoricalStore because aiosqlite connections
   support cross-loop usage. Test-only change — no production code touched.

2. **P10 Phase 2 + TD-3 production verification (code-path audit)** —
   all 4 sub-items from iter 135 stopping-point brief verified via
   existing tests + code review:
   - `/api/flipper/triangular/history` returns non-empty `points` when
     `triangular_cycles` ≥ 2 rows (E2E test
     `test_triangular_cycles_route.py::TestTriangularCyclesRouteWithRows`)
   - Gold Map ROI trend chart SVG line renders with ≥ 2 deduped points
     (`gold-map-roi-trend-chart.tsx:170-171` geometry guard + jest)
   - Days selector refetches via `queryKey: ["gold-map-roi-trend", days]`
     + `days` query param
   - `_refresh()` pre-populates `pipeline_cache` via
     `compute_triangular_cycles(pipeline_cache=...)` with debug log
     `"TD-3 cache: populated pipeline_cache key=%s"` (line 332).
     Runtime log verification deferred to next prod deploy.

## Verification (run after extracting)

```bash
npx tsc --noEmit                                # clean
npx jest --no-coverage --maxWorkers=2           # 690/690 pass
pytest -q                                       # 1455/1455 pass (UTC)
TZ=Asia/Yekaterinburg pytest -q                 # 1455/1455 pass (UTC+5)
```

On Python 3.14: the 6 previously-failing tests in
`test_daily_stats_persistence.py::TestDailyStatsRoute` now pass (the
`_run` helper uses `asyncio.run()` which is the canonical Python 3.7+
API and works on all Python versions ≥ 3.7).

## Stopping point

iter 136 = KI-28 fix SHIPPED + P10 Phase 2 / TD-3 code-path audit
COMPLETE. All baselines preserved (690 jest green, 1455 pytest green
in both UTC and UTC+5, 0 regressions, `tsc --noEmit` clean). The
Python 3.14 regression that iter 135 missed is now fixed. Next iter
(iter 137+) candidates: (a) TD-3 runtime log verification (requires
prod access — confirm the debug log line + first-request latency);
(b) P10 Phase 3 (optional, defer until adoption); (c) any new bugs
the user identifies.
