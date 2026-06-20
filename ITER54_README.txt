ITER 54 — P0-3 + P0-4 FIXES — MERGE INSTRUCTIONS
==================================================

This archive contains the iter-54 changes for poe2-market-dashboard.
Extract on top of your local repo root to merge (overwrite) the changed files.

CONTENTS (9 files, structure preserved):
  backend/api/routes_analyst.py     — P0-3 fix (use _find_price_24h_ago)
  backend/economy/lifecycle.py      — P0-4 fix (PhaseDetector respects major_patch)
  tests/test_lifecycle.py           — P0-4 regression test (replaced test_patch_date_before_league_start_ignored)
  tests/e2e/test_analyst.py         — NEW, P0-3 regression tests (4 tests)
  STATUS.md                         — P0-3, P0-4 moved to "Fixed" section
  REFACTOR_PLAN.md                  — v19, iter 54 marked DONE, iter 55 = P0-1
  AGENT_NAVIGATION.md               — BUGGY markers removed for analyst + lifecycle
  worklog.md                        — iter 54 entry (replaces iter 53)

MERGE STEPS:
  1. cd to your local repo root (contains backend/, tests/, src/, etc.)
  2. Extract this archive on top:
       tar -xzf iter54-fixes.tar.gz -C /path/to/poe2-market-dashboard
  3. Verify merge:
       git status              # should show 7 modified + 1 untracked
       git diff --stat
  4. Run tests:
       pytest tests/ -v        # backend (386 pass / 4 skip flaky)
       npm run test            # jest (291 pass)
       npx tsc --noEmit        # clean
  5. Commit in 2 separate commits (one issue per commit — REFACTOR_PLAN §1):
       git add backend/api/routes_analyst.py tests/e2e/test_analyst.py
       git add STATUS.md REFACTOR_PLAN.md AGENT_NAVIGATION.md worklog.md
       # NOTE: docs cover BOTH P0-3 and P0-4 in this iter; commit them with P0-3
       # (or split if you prefer — just keep STATUS.md/REFACTOR_PLAN.md/etc. consistent).
       git commit -m "fix(P0-3): use _find_price_24h_ago for analyst 24h change"

       git add backend/economy/lifecycle.py tests/test_lifecycle.py
       git commit -m "fix(P0-4): PhaseDetector respects major_patch unconditionally"

  6. Push:
       git push origin main
       (or whichever branch you're on — verify with `git branch --show-current`)

STOPPING POINT — iter 54 DONE. Next: iter 55 = P0-1 (SSE).
See REFACTOR_PLAN.md §"Recommended Fix Order (iter 54+)".
