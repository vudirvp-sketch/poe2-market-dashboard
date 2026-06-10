# Worklog

---
Task ID: 24
Agent: main
Task: Iteration 24 — Fix Liquid Chain crash, ProcessPoolExecutor pickle bug, offload clustering, Windows compat

Work Log:
- Diagnosed Liquid Chain ErrorBoundary crash: `routes_liquid_chain.py` used PascalCase keys (Steps, CumulativePaths, ChainName). flipper-proxy `transformKeys()` only converts snake_case → camelCase, so PascalCase passed through → `chain.steps` undefined → `.filter()` TypeError
- Fixed all serializers in `routes_liquid_chain.py` to use snake_case (api_id, name_en, steps, cumulative_paths, etc.)
- Added defensive `?? []` null-checks in `liquid-chain-tab.tsx` for `chain.steps` and `paths`
- Fixed ProcessPoolExecutor pickle bug: `_build_flip_opportunities_sync()` received `event_manager` and `pipeline_cache` as args, which hold sqlite3.Connection → can't pickle. Refactored to pre-extract `event_penalties` dict and `cached_cluster_labels` dict in async wrapper
- Offloaded `CurrencyClusterer.fit()` in `routes_prices.py` to ProcessPoolExecutor via `run_in_executor()` with new `_run_clustering_sync()` function
- Set explicit `mp_context="spawn"` on ProcessPoolExecutor for Windows/Linux cross-platform consistency
- Updated AGENT_NAVIGATION.md: v1.38 → v1.39, added new frequent bugs #30-#32
- All modified Python files pass `py_compile` syntax validation

Stage Summary:
- Frontend crash fixed (snake_case serializer + null-checks)
- Backend pickle bug fixed (pre-extract picklable data before executor)
- Clustering no longer blocks event loop (run_in_executor + ProcessPoolExecutor)
- ProcessPoolExecutor uses explicit spawn context for Windows compat
- Stopping point: Code changes complete. Pending: real E2E against live backend, Windows start.bat verification
