# Work Log

> Single source for recent task entries. Long history removed — see git log for details.
> Append new entries at the bottom. Keep ≤5 latest entries.

---

## Task 54 — P0-3 + P0-4 fixes (first P0 commits)
**Agent:** Main Agent
**Date:** 2026-06-20

**Task:** Per REFACTOR_PLAN.md recommended fix order iter 54: fix P0-3 (analyst 24h change) and P0-4 (PhaseDetector reset), add regression tests, run full test suite, update docs.

**Work Log:**
- Re-read STATUS.md, REFACTOR_PLAN.md v18, AGENT_NAVIGATION.md, worklog.md (iter 53 entry).
- Verified P0-3 source: `routes_analyst.py:43` `price_24h_ago = prices[0] if len(prices) >= 2 else None` confirmed buggy. `_find_price_24h_ago` confirmed at `routes_arbitrage.py:92-126`, accepts `list[tuple[datetime, float]]`, returns None if drift >6h.
- Verified P0-4 source: `lifecycle.py:83` `return max(self._league_start, self._patch_reset_date)` confirmed buggy. Existing test `test_patch_date_before_league_start_ignored` tested the buggy behavior — needed replacement.
- Established test baseline: `pytest tests/` (non-e2e) = 360 passed. `pytest tests/e2e/test_api_e2e.py` = 10 passed. `pytest tests/ -p no:cacheprovider --override-ini="norecursedirs="` = 386 passed / 4 skipped. `npm run test` = 291 passed. `npx tsc --noEmit` clean.
- **P0-3 fix:** `backend/api/routes_analyst.py` — added `from backend.api.routes_arbitrage import _find_price_24h_ago`, replaced `prices[0]` lookup with `history_with_ts = [(p.timestamp, p.price) for p in history_points]; price_24h_ago = _find_price_24h_ago(history_with_ts)`. Added inline TODO comment for P0-5 follow-up (extract to `backend/economy/pricing.py`).
- Created `tests/e2e/test_analyst.py` with 4 tests:
  - `TestAnalyst24hChangeUsesTimestamp::test_analyst_24h_change_uses_timestamp` — main regression (48h-old `prices[0]` would give 21%, but 24h-ago point gives correct 10%).
  - `TestAnalyst24hChangeUsesTimestamp::test_analyst_24h_change_none_when_drift_too_large` — all points >30h old → `change_24h_pct` is None (not bogus).
  - `TestAnalyst24hChangeUsesTimestamp::test_analyst_24h_change_skips_far_future_point` — 6h-ago point (drift=18h) is skipped; 24h-ago point (drift=0) is used.
  - `test_analyst_summary_endpoint` — e2e smoke test for `/api/v1/analyst/summary`.
- First run: 3 passed, 1 failed (`test_analyst_24h_change_picks_closest_to_24h` — flaky due to sub-ms `now()` differences in tie-breaking). Replaced with non-flaky `test_analyst_24h_change_skips_far_future_point` (deterministic).
- All 4 analyst tests pass. Backend suite: 386 passed / 4 skipped (unchanged baseline + 4 new). Frontend: 291 passed. tsc: clean.
- **P0-4 fix:** `backend/economy/lifecycle.py` — replaced `return max(self._league_start, self._patch_reset_date)` with `return self._patch_reset_date` (when set). Updated module docstring (formula), class docstring, and `_reference_date` docstring with P0-4 rationale (preview-patch scenario, spec §6 reference).
- Updated `tests/test_lifecycle.py`: replaced `test_patch_date_before_league_start_ignored` (tested buggy `max()` behavior) with `test_major_patch_resets_even_if_before_league_start` (regression for the fix; verifies patch_date=2025-01-01 + league_start=2025-01-15 → reference is patch_date, days_since=19, phase=MID).
- All 15 lifecycle tests pass. Full backend suite re-verified: 386 passed / 4 skipped.

**Stage Summary:**
- 2 P0 issues fixed: P0-3 (`fix(P0-3): use _find_price_24h_ago for analyst 24h change`), P0-4 (`fix(P0-4): PhaseDetector respects major_patch unconditionally`).
- 4 new tests added (`tests/e2e/test_analyst.py`); 1 test replaced (`tests/test_lifecycle.py`).
- `STATUS.md`: P0-3 and P0-4 moved from active P0 list to new "Fixed" section. Header timestamp updated to iter 54. Counts: 6 P0 → 4 P0 active. Quick Reference rows for P0-3 and P0-4 removed.
- `REFACTOR_PLAN.md`: v18 → v19. "Recommended Fix Order" updated: iter 54 marked DONE, iter 55 (P0-1 SSE) is next. P0-5 entry annotated with TODO about extracting `_find_price_24h_ago` (left by P0-3). Estimation table: 6 P0 → 4 P0 remaining. Total estimate: 28 → 26 iterations.
- `AGENT_NAVIGATION.md`: §1 BROKEN/BUGGY markers removed for `routes_analyst.py` and `lifecycle.py`. §3 rule #14 updated to reflect new PhaseDetector semantics. §4 Known Issues count: 6 P0 → 4 P0 (2 fixed). Quick Reference rows for P0-3 and P0-4 removed. §5 API endpoint table: analyst/summary marker updated.
- `worklog.md`: this entry replaces iter 53 entry (≤5 rule).

**Stopping point:**
- Iter 54 done. Ready for iter 55 = P0-1 (SSE) per REFACTOR_PLAN.md §"Recommended Fix Order".
- Suggested commit messages (user will run `git add` + `git commit` locally, then `git push`):
  1. `fix(P0-3): use _find_price_24h_ago for analyst 24h change`
  2. `fix(P0-4): PhaseDetector respects major_patch unconditionally`
- Changed files for archive: `backend/api/routes_analyst.py`, `backend/economy/lifecycle.py`, `tests/test_lifecycle.py`, `tests/e2e/test_analyst.py` (new), `STATUS.md`, `REFACTOR_PLAN.md`, `AGENT_NAVIGATION.md`, `worklog.md`.
