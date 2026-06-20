# Work Log

> Single source for recent task entries. Long history removed — see git log for details.
> Append new entries at the bottom. Keep ≤5 latest entries.

---

## Task 57 — P0-5 transitive prices helper + dead `prices` param cleanup
**Agent:** Main Agent
**Date:** 2026-06-20

**Task:** Per REFACTOR_PLAN.md iter 57: extract `compute_transitive_prices` (BFS) to `backend/economy/pricing.py`, swap 2 remaining call sites (`data_snapshot.py`, `scheduler.py`), extract `_find_price_24h_ago` to the same helper, remove dead `prices` param from `find_triangular_arbitrage`.

**Work Log:**
- Re-read STATUS.md, REFACTOR_PLAN.md v21, AGENT_NAVIGATION.md, worklog.md (iter 56 entry).
- Verified P0-5 source: 3 different transitive-price implementations.
  1. `data_snapshot.py:171-210` `_compute_transitive_prices` — BFS, correct.
  2. `scheduler.py:91-110` — 5-iter relaxation, **buggy** (silently misses >5-hop chains).
  3. `routes_arbitrage.py:get_triangular_arbitrage` — passed `prices` to `find_triangular_arbitrage` but the Bellman-Ford path never read it (dead parameter).
- Verified `_find_price_24h_ago` location: defined in `routes_arbitrage.py:92-127`, imported by `routes_analyst.py:29` with a `TODO(P0-5)` comment. Per REFACTOR_PLAN.md, this should also be extracted to the new helper module.
- Verified call sites of `find_triangular_arbitrage`: 1 in `routes_arbitrage.py:779`, 7 in `tests/test_triangular.py`. All pass `prices` positionally.
- Verified `_find_price_24h_ago` call sites: 1 in `routes_arbitrage.py:223` (inside `_build_flip_opportunities` — runs in ProcessPoolExecutor), 1 in `routes_analyst.py:53`.
- **P0-5 fix step 1 — created `backend/economy/pricing.py`:**
  - `compute_transitive_prices(prices_in_base, rates, base)` — BFS, byte-for-byte match of the previously-correct `data_snapshot.py` version. Mutates `prices_in_base` in place.
  - `find_price_24h_ago(history_with_timestamps, max_drift_hours=6.0)` — moved from `routes_arbitrage.py`. Public name (no leading underscore).
  - Detailed docstring explaining the 5-iter relaxation bug.
- **P0-5 fix step 2 — swapped `data_snapshot.py`:**
  - Deleted the 40-line local `_compute_transitive_prices` definition.
  - Added `from backend.economy.pricing import compute_transitive_prices as _compute_transitive_prices`. The call site at line 378 is unchanged (still calls `_compute_transitive_prices(...)`).
- **P0-5 fix step 3 — swapped `scheduler.py`:**
  - Deleted the 19-line 5-iter relaxation block (lines 91-110).
  - Added `from backend.economy.pricing import compute_transitive_prices` at top.
  - Replaced relaxation with `compute_transitive_prices(prices_in_base, rates, base)` + a 9-line comment explaining the bug fix.
- **P0-5 fix step 4 — swapped `routes_arbitrage.py`:**
  - Deleted the 36-line local `_find_price_24h_ago` definition (lines 92-127).
  - Added `from backend.economy.pricing import find_price_24h_ago as _find_price_24h_ago`. Internal call site at line 223 unchanged.
- **P0-5 fix step 5 — swapped `routes_analyst.py`:**
  - Changed import from `from backend.api.routes_arbitrage import _find_price_24h_ago` to `from backend.economy.pricing import find_price_24h_ago as _find_price_24h_ago`.
  - Removed the `TODO(P0-5)` comment.
  - Call site at line 53 unchanged.
- **P0-5 fix step 6 — removed dead `prices` param from `triangular.py`:**
  - Dropped `prices: dict[str, float]` from `_find_triangular_arbitrage_sync` signature.
  - Dropped `prices: dict[str, float]` from `find_triangular_arbitrage` signature + docstring (added `Note:` explaining why and where to get prices-in-base if needed).
  - Updated `loop.run_in_executor(...)` call to drop `prices` from the args tuple.
- **P0-5 fix step 7 — updated `routes_arbitrage.py` call site:**
  - Removed the `prices = dict(snapshot.prices_in_base)` line.
  - Removed `prices=prices,` from the `find_triangular_arbitrage(...)` call.
  - Updated the explanatory comment to reference both P0-6 (iter 56) and P0-5 (iter 57).
- **P0-5 fix step 8 — updated `tests/test_triangular.py`:**
  - Dropped `prices` from all 7 test calls. Kept the `prices = {...}` local in 2 tests as `# noqa: F841 — kept for clarity` documentation of conceptual numeraire prices.
  - Updated the module docstring noting the `prices` parameter removal.
- **Tests added — `tests/test_pricing.py` (15 tests):**
  - `TestComputeTransitivePricesBFS` (7 tests): direct rates unchanged, 1-hop transitive, **7-hop chain regression** (the bug that the old 5-iter relaxation would have missed), reverse-direction edges, negative rate skipped, disconnected currency never priced, existing prices not overwritten.
  - `TestFindPrice24hAgo` (8 tests): empty history, exact 24h match, picks closest to 24h, drift within tolerance (29h to avoid boundary flakiness), drift outside tolerance, custom max_drift_hours, naive timestamps treated as UTC, picks closest even when all within drift.
- AST syntax check on all 8 edited/created files: OK.
- Import sanity check: `python -c "from backend.economy.pricing import ..."` + `inspect.signature(find_triangular_arbitrage)` confirms `prices` removed.
- Test runs:
  - `pytest tests/test_pricing.py -v` → 15/15 pass (0.07s).
  - `pytest tests/test_triangular.py -v` → 7/7 pass (4.63s).
  - `pytest tests/test_scheduler.py -v` → 13/13 pass (0.87s).
  - `pytest tests/e2e/test_analyst.py -v` → 4/4 pass (3.75s).
  - `pytest tests/e2e/test_api_e2e.py::test_arbitrage_triangular -v` → 1/1 pass (3.72s).
  - `pytest tests/test_pickle_safety.py tests/test_optimal_currency.py -v` → 51/51 pass (3.97s) — confirms ProcessPool pickle safety preserved.
  - `pytest tests/e2e/test_sse.py -v` → 4/4 pass (0.97s).
  - Full backend: `pytest tests/ -q` → 375 pass / 4 skip / 0 fail.
  - Full e2e: `pytest tests/e2e/ -q` → 30 pass / 4 skip / 0 fail.

**Stage Summary:**
- P0-5 fixed: `refactor(P0-5): unified pricing helper + remove dead prices param`.
- P1-3 also closed as a side effect (BFS in `compute_transitive_prices` is already O(V+E)).
- New module `backend/economy/pricing.py` is the single source of truth for transitive pricing + 24h-ago lookup.
- `STATUS.md`: P0-5 moved from active P0 to Fixed section. Header updated to iter 57. P0 count: 2 → 1 active. P1-3 marked as resolved by P0-5.
- `REFACTOR_PLAN.md`: v21 → v22. Iter 57 marked DONE. P0 bucket 2 → 1. P1 bucket 11 → 10. Total iterations: 23 → 20.
- `AGENT_NAVIGATION.md`: §1 added row for `backend/economy/pricing.py`; updated rows for `routes_analyst.py`, `routes_arbitrage.py`, `backend/arbitrage/triangular.py`. §4 known issues count 2 → 1 P0; 11 → 10 P1; 4 → 5 P0 fixed. §5 API endpoint table updated (triangular now shows iter 57 too).
- `worklog.md`: this entry replaces iter 55 entry (≤5 rule).

**Stopping point:**
- Iter 57 done. Ready for iter 58 = P0-2 (WS executor offload) per REFACTOR_PLAN.md §"Recommended Fix Order".
- Suggested commit message: `refactor(P0-5): unified pricing helper + remove dead prices param`
- Changed files for archive: `backend/economy/pricing.py` (NEW), `backend/api/data_snapshot.py`, `backend/scheduler.py`, `backend/api/routes_arbitrage.py`, `backend/api/routes_analyst.py`, `backend/arbitrage/triangular.py`, `tests/test_triangular.py`, `tests/test_pricing.py` (NEW), `STATUS.md`, `REFACTOR_PLAN.md`, `AGENT_NAVIGATION.md`, `worklog.md`.

---

## Task 56 — P0-6 triangular hardcode fix
**Agent:** Main Agent
**Date:** 2026-06-20

**Task:** Per REFACTOR_PLAN.md iter 56: remove `prices["chaos"] = 1.0; prices["Chaos Orb"] = 1.0` hardcode + redundant chaos-normalization block in `routes_arbitrage.py:753-770`. Use single numeraire = `config.league.base_currency`.

**Work Log:**
- Re-read STATUS.md, REFACTOR_PLAN.md v20, AGENT_NAVIGATION.md, worklog.md (iter 55 entry).
- Verified P0-6 source: `backend/api/routes_arbitrage.py:753-770` confirmed two redundant blocks: (1) chaos-normalization conditional conversion (lines 755-766), (2) unconditional hardcode `prices["chaos"] = 1.0; prices["Chaos Orb"] = 1.0` (lines 769-770).
- Verified downstream: `_find_triangular_arbitrage_sync` in `backend/arbitrage/triangular.py` accepts `prices` parameter but **never reads it** — Bellman-Ford path uses `rates` only. `prices` is a dead parameter. So the hardcode was misleading dead code, but the fix is still warranted (per STATUS.md solution: single numeraire = base_currency).
- Verified test coverage: `tests/test_triangular.py` (7 tests) + `tests/e2e/test_api_e2e.py::test_arbitrage_triangular` (status code only).
- **P0-6 fix:** Replaced lines 753-770 (16 lines of chaos normalization + hardcode) with:
  - `prices = dict(snapshot.prices_in_base)` (unchanged — already in base currency).
  - 9-line comment explaining: `prices_in_base` is already in `config.league.base_currency`, no chaos normalization needed, dead `prices` param cleanup deferred to P0-5.
- Syntax check: `python -c "import ast; ast.parse(open('backend/api/routes_arbitrage.py').read())"` — OK.
- Tests: `pytest tests/test_triangular.py -x` — 7/7 pass (5.71s). `pytest tests/e2e/test_api_e2e.py::test_arbitrage_triangular` — 1/1 pass (3.85s). No regressions.
- No new tests added: deleted code was dead (no observable behavior to assert). Adding tests for the dead `prices` param would be premature — that cleanup belongs to P0-5.

**Stage Summary:**
- P0-6 fixed: `fix(P0-6): remove chaos hardcode in triangular arbitrage`.
- `STATUS.md`: P0-6 moved from active P0 to Fixed section. Header updated to iter 56. P0 count: 3 → 2 active. P0-5 description updated (notes dead `prices` param cleanup is now bundled with P0-5).
- `REFACTOR_PLAN.md`: v20 → v21. Iter 56 marked DONE. P0 bucket 3 → 2. Total iterations: 24 → 23.
- `AGENT_NAVIGATION.md`: §1 routes_arbitrage.py marker updated (P0-6 fixed). §4 known issues count 3 → 2 P0. §5 API endpoint table updated (triangular no longer BROKEN).
- `worklog.md`: this entry replaces iter 54 entry (≤5 rule).

**Stopping point:**
- Iter 56 done. Ready for iter 57 = P0-5 (transitive prices helper) per REFACTOR_PLAN.md §"Recommended Fix Order".
- Suggested commit message: `fix(P0-6): remove chaos hardcode in triangular arbitrage`
- Changed files for archive: `backend/api/routes_arbitrage.py`, `STATUS.md`, `REFACTOR_PLAN.md`, `AGENT_NAVIGATION.md`, `worklog.md`.

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
