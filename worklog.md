# Worklog

---
Task ID: 16
Agent: main
Task: Iteration 5 — Audit, critical bug fixes, garbage cleanup, documentation updates

Work Log:
- Added `clear_all_events()` method to `HistoricalStore` (BUG-1: EventManager.clear_all() called non-existent method → AttributeError)
- Added `acceleration=metrics.acceleration` to `_compute_storage_value()` in `routes_ws.py` (BUG-3: WS results diverged from REST)
- Deleted all `__pycache__/` directories from backend (contained .pyc for deleted modules: routes_forecast, routes_recipes, cache.py, gold_costs.py, gold_cost_table.py)
- Deleted `cloudflare-worker/.wrangler/` (local dev cache, should not be committed)
- Added `.wrangler/` to `.gitignore`
- Deleted `PROGRESS-NOTES.md` (7-line redirect, redundant)
- Changed AnomalyDetector from per-request instantiation to lazy singleton in `routes_anomalies.py`
- Changed `BaseDataProvider.close()` from sync to async to match Poe2ScoutProvider.close()
- Removed dead `except HTTPException` block from `main.py` (check_provider_health() no longer raises it)
- Removed unused `HTTPException` import from `main.py`
- Fixed Canonical Formulas: renamed duplicate §11 to §14 (sub-sections 14.1–14.9)
- Fixed Pitfall #3 in Appendix A: updated to reflect gold fees permanently excluded
- Fixed Pitfall #4: updated Bellman-Ford formula to remove fee terms
- Marked Pitfall #5 as DEPRECATED
- Updated AGENT_NAVIGATION.md to v1.20: added COMPLETED section, added Frequent Bugs #23–#24

Stage Summary:
- Critical BUG-1 fixed (clear_all_events AttributeError)
- Critical BUG-3 fixed (WS vs REST storage value divergence)
- Repository garbage cleaned (__pycache__, .wrangler, PROGRESS-NOTES.md)
- Documentation accuracy improved (Canonical Formulas, AGENT_NAVIGATION)
