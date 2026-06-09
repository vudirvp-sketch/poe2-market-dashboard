# Worklog

---
Task ID: 17
Agent: main
Task: Iteration 17 — Fix triangular arbitrage NameError, missing ExchangeRate import, update docs

Work Log:
- Diagnosed critical bug: `pipeline_cache.get(cache_key)` in `routes_arbitrage.py:570` called without first calling `get_pipeline_cache()`. The `/api/arbitrage/triangular` endpoint crashed with `NameError: name 'pipeline_cache' is not defined` on every request (500 Internal Server Error). The `/flips` endpoint correctly called `get_pipeline_cache()`, but the triangular endpoint was missed during the v1.30 refactor that added pipeline caching.
- Fixed: Added `pipeline_cache = get_pipeline_cache()` before the cache lookup at line 570.
- Diagnosed secondary bug: `ExchangeRate` type used in type hints (`_detect_cross_rate_flips` line 741, `get_optimal_currency` line 856) but not imported. Fix: Added `ExchangeRate` to the import from `backend.models.currency`.
- Ran full pytest suite: 326/326 tests pass.
- Updated AGENT_NAVIGATION.md to v1.32: added COMPLETED section, updated TODO, added Frequent Bug #41 about pipeline_cache requiring get_pipeline_cache() call.

Stage Summary:
- `/api/arbitrage/triangular` no longer returns 500 — NameError fixed
- Missing ExchangeRate import added (was only in type hints, but good practice)
- All 326 backend tests pass
- Remaining for next iteration: Bridge real-world Windows testing (start.bat), E2E verification that all API endpoints return 200
