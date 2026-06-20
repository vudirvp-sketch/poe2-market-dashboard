# Work Log

> Single source for recent task entries. Long history removed — see git log for details.
> Append new entries at the bottom. Keep ≤5 latest entries.

---

## Task 55 — P0-1 SSE fix (remove dead monitor, add change_pct, align contract)
**Agent:** Main Agent
**Date:** 2026-06-20

**Task:** Per REFACTOR_PLAN.md recommended fix order iter 55: fix P0-1 (SSE — dead monitor, no threshold filtering, contract mismatch), add regression tests, run full test suite, update docs.

**Work Log:**
- Re-read STATUS.md, REFACTOR_PLAN.md v19, AGENT_NAVIGATION.md, worklog.md (iter 54 entry).
- Verified P0-1 source: `routes_sse.py` confirmed 3 bugs: (1) `_sse_monitor_loop` = empty `asyncio.sleep(60)`, (2) `threshold_pct` passed but not used in `_sse_event_generator`, (3) backend sends `{type, changes_count, changes: [{api_id, price}], timestamp}` but frontend expects `{pair, change_pct, new_price, old_price, timestamp}`.
- Verified frontend: `use-price-stream.ts` checks `data.change_pct` (line 192) which was never in payload → invalidation never fires.
- Verified `main.py`: `start_sse_monitor()` called at line 244-248 (startup), `stop_sse_monitor()` at 303-308 (shutdown).
- Established test baseline: backend 347 passed / 4 skipped (ignoring pre-existing broken test_scheduler.py), e2e 26 passed / 4 skipped, frontend 291 passed, tsc clean.
- **P0-1 fix (backend):** Full rewrite of `backend/api/routes_sse.py`:
  - Removed `_sse_monitor_loop`, `start_sse_monitor`, `stop_sse_monitor` and all module-level state variables (`_sse_monitor_running`, `_sse_monitor_task`, `_last_snapshot_hash`, `_last_broadcast_time`, `_snapshot_fingerprint`).
  - Rewrote `_sse_event_generator`: stores `previous_prices` dict, computes `change_pct = ((new - old) / old) * 100` per currency, filters by `threshold_pct`, emits one SSE message per qualifying currency in format `{pair, change_pct, new_price, old_price, timestamp}`.
  - First snapshot = baseline (no events emitted).
- **P0-1 fix (main.py):** Removed `start_sse_monitor()` call (lines 244-248) and `stop_sse_monitor()` call (lines 303-308). Replaced with comments noting the fix.
- **P0-1 fix (frontend):** Updated `src/hooks/use-price-stream.ts`:
  - Changed `SSEPriceUpdate` interface from optional fields to required: `pair: string`, `change_pct: number`, `new_price: number`, `old_price: number`, `timestamp: number`.
  - Added comment explaining P0-1 fix (previously backend sent bulk payload without `change_pct`).
- **Tests added:** `tests/e2e/test_sse.py` (4 tests) using `SequencingSnapshotManager` helper:
  - `test_sse_event_format_matches_frontend_contract` — verifies `{pair, change_pct, new_price, old_price, timestamp}` shape + values.
  - `test_sse_threshold_filters_below_threshold` — 0.18% change filtered, 5% passes.
  - `test_sse_no_event_on_first_snapshot` — baseline recorded, no spurious events.
  - `test_sse_multiple_currencies_change` — each qualifying currency gets its own event.
- All tests pass: backend 347 + e2e 30 (26+4 SSE) = 377 passed / 4 skipped. Frontend 291 passed. tsc clean.

**Stage Summary:**
- P0-1 fixed: `fix(P0-1): SSE contract fix — remove dead monitor, add change_pct, align payload`.
- 4 new tests added (`tests/e2e/test_sse.py`).
- `STATUS.md`: P0-1 moved from active P0 list to Fixed section. Header updated to iter 55. P0 count: 4 → 3 active. SSE row removed from Quick Reference. P2-7 updated (unblocked).
- `REFACTOR_PLAN.md`: v19 → v20. Iter 55 marked DONE. P0-1 removed from active P0 bucket. Estimation: 4 P0 → 3 P0. Total: 26 → 24 iterations.
- `AGENT_NAVIGATION.md`: §1 routes_sse.py and use-price-stream.ts markers updated from BROKEN to fixed. §3 rule #17 updated. §4 SSE symptom marked fixed. §5 API endpoint table updated.
- `worklog.md`: this entry replaces iter 54 entry (≤5 rule).

**Stopping point:**
- Iter 55 done. Ready for iter 56 = P0-6 (triangular hardcode) per REFACTOR_PLAN.md §"Recommended Fix Order".
- Suggested commit message: `fix(P0-1): SSE contract fix — remove dead monitor, add change_pct, align payload`
- Changed files for archive: `backend/api/routes_sse.py`, `backend/main.py`, `src/hooks/use-price-stream.ts`, `tests/e2e/test_sse.py` (new), `STATUS.md`, `REFACTOR_PLAN.md`, `AGENT_NAVIGATION.md`, `worklog.md`.
