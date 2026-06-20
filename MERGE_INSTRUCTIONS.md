# Iter 62 — Merge Instructions

## Summary

Closes **P2-12** (orphan files actual cleanup — iter 60 follow-up). Iter 60 commit `9ee73ae` shipped `DELETIONS.sh` but never executed it; this iter finally runs `git rm` on all 16 orphan files and removes the script-never-run gap from the repo history.

- **0** code changes — only deletions
- **5** documentation files updated (`STATUS.md`, `REFACTOR_PLAN.md`, `AGENT_NAVIGATION.md`, `worklog.md`, `MERGE_INSTRUCTIONS.md`)
- **1** script updated (`DELETIONS.sh` — extended to also handle WS remnants)
- **16** orphan files removed via `git rm` (10 root-level + 6 WS remnants)

## What's in this archive

```
iter62/
├── MERGE_INSTRUCTIONS.md    ← this file
├── DELETIONS.sh             ← updated script: removes all 16 orphan files (10 root + 6 WS)
├── STATUS.md                ← updated (iter 62 — P2-12 closed; P1-7 + P3-8 marked fixed from iter 61)
├── REFACTOR_PLAN.md         ← updated (v25 → v26)
├── AGENT_NAVIGATION.md      ← updated (P1-7 / P1-11 marked fixed; routes_events.py + events.py no longer BUGGY)
└── worklog.md               ← updated (iter 62 entry replaces iter 60 entry; iter 61 entry added)
```

## How to apply

Run from the root of your local `poe2-market-dashboard` checkout (must be on `main` branch, up-to-date with `origin/main`). **NOTE:** if you have local iter 61 changes (P1-7 + P3-8) uncommitted, commit them first with `git commit -m "refactor(P1-7): EventManager async — replace fire-and-forget with await"` before applying iter 62.

```bash
# 1. Extract this archive into a temp location
#    Example (if iter62.zip is in ~/Downloads):
unzip ~/Downloads/iter62.zip -d /tmp/iter62

# 2. Copy the 5 modified docs + 1 updated script into the repo root
cp /tmp/iter62/iter62/STATUS.md             ./STATUS.md
cp /tmp/iter62/iter62/REFACTOR_PLAN.md      ./REFACTOR_PLAN.md
cp /tmp/iter62/iter62/AGENT_NAVIGATION.md   ./AGENT_NAVIGATION.md
cp /tmp/iter62/iter62/worklog.md            ./worklog.md
cp /tmp/iter62/iter62/MERGE_INSTRUCTIONS.md ./MERGE_INSTRUCTIONS.md
cp /tmp/iter62/iter62/DELETIONS.sh          ./DELETIONS.sh

# 3. Run the deletion script to git rm the 16 orphan files
bash ./DELETIONS.sh

# 4. Verify
npx tsc --noEmit        # should print nothing (0 errors)
npx jest                # should report 291 pass / 14 suites
git status              # should show 5 modified docs + 1 modified script + 16 deleted files

# 5. Commit + push
git add -A
git commit -m "fix(P2-12): actually delete orphan root files + WS file remnants"
git push origin main
```

## Verification (already done in agent environment)

| Check | Before iter 62 | After iter 62 |
|------|----------------|---------------|
| `tsc --noEmit` | 2 errors (`dashboard-page.tsx(1037,89)` wsStatus prop; `events-sidebar.spec.ts(16,33)` cannot find `./fixtures`) — iter 60 false-claimed 0 errors | **0 errors** ✓ |
| `jest` | 291 pass / 13 + 1 failing suite (`events-sidebar.spec.ts`) — iter 60 false-claimed 14 suites | **291 pass / 14 suites / 0 failures** ✓ |
| `pytest tests/test_events.py tests/test_routes_events_invalidation.py tests/test_lifecycle.py -q` | 56 pass / 0 fail (iter 61 baseline) | 56 pass / 0 fail ✓ |
| `git status` (staged deletions) | — | 16 deleted files (10 root + 6 WS) |

Pre-existing `test_triangular` failures in full-suite mode (passes alone) and `test_compression` failures (missing `brotli` / function `_check_brotli_available` not exported) are documented in STATUS.md §Quick Reference — they are NOT caused by iter 62 (or iter 60 / iter 61).

## Stop point — next iteration (iter 63)

**P1-4** (clustering duplication between `routes_prices` and `routes_arbitrage`) — recommended next per REFACTOR_PLAN.md v26 §"Recommended Fix Order":
- Single cache key `cluster_labels` shared between `routes_prices.py` (clustering for `/prices` heatmap) and `routes_arbitrage.py` (clustering for `/flips` profitability grouping).
- Extract shared helper function (e.g. `backend/predictors/clustering.py::compute_cluster_labels`) and call from both routes.
- Add regression tests verifying both routes return identical cluster assignments for the same input snapshot.

Suggested commit message: `refactor(P1-4): deduplicate clustering between routes_prices and routes_arbitrage`

**Issue counts after iter 62:** P1=6, P2=8, P3=5. ~12 iterations remaining.
