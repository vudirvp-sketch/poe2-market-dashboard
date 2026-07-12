# iter 124 — Merge Instructions

## Summary

iter 124 closes two low-risk high-value items from the iter 123 stopping point:

- **TD-10** (closed): 3 pre-existing lint warnings in `src/components/dashboard/dashboard-page.tsx`:
  - Unused `ReferenceCurrency` type import (line 163) — removed.
  - Unused `sseStatus` destructuring (line 312) — `usePriceStream` now called without destructuring.
  - `keyboardActions` useMemo exhaustive-deps (line 732) — fixed by moving `TAB_MAP` to module level (stable identity) + wrapping `setTab` in `useCallback` + adding `openDetail` to deps.
- **TD-11** (closed): Repo cleanup — 26 obsolete iter-100–118 files removed.

Lint: 114 → 111 warnings, 0 errors. `tsc` green. 622 jest green.

## Files in this archive (MODIFIED — overwrite local copies)

```
src/components/dashboard/dashboard-page.tsx
STATUS.md
worklog.md
AGENT_NAVIGATION.md
```

## Files to DELETE from your local repo (NOT in this archive — git rm)

Run these `git rm` commands from the repo root:

```bash
git rm MERGE_INSTRUCTIONS_iter101.md
git rm MERGE_INSTRUCTIONS_iter102.md
git rm MERGE_INSTRUCTIONS_iter103.md
git rm MERGE_INSTRUCTIONS_iter105.md
git rm MERGE_INSTRUCTIONS_iter106.md
git rm MERGE_INSTRUCTIONS_iter107.md
git rm MERGE_INSTRUCTIONS_iter108.md
git rm MERGE_INSTRUCTIONS_iter109.md
git rm git_commands_iter101.txt
git rm git_commands_iter102.txt
git rm git_commands_iter103.txt
git rm git_commands_iter105.txt
git rm git_commands_iter106.txt
git rm git_commands_iter107.txt
git rm git_commands_iter108.txt
git rm git_commands_iter109.txt
git rm git_commands_iter110.txt
git rm git_commands_iter111.txt
git rm git_commands_iter117.txt
git rm git_commands_iter118.txt
git rm DELETIONS.sh
git rm DELETIONS.txt
git rm DELETE_obsolete_files.sh
git rm README.txt
git rm scripts_flipper-backend-bridge.ts.DELETED
git rm scripts/DELETE_flipper-backend-bridge.ts
git rm flipper-bridge.log
```

## Verification (run after merge + git rm)

```bash
npx tsc --noEmit                              # expect: 0 errors
npx eslint .                                  # expect: 0 errors, 111 warnings
npx jest --maxWorkers=2                       # expect: 622 passed, 28 suites
```

## What was NOT done (deferred — see stopping point in worklog.md)

- TD-3/4/5/9 persistence gaps (need persistence-layer design — separate iter).
- P10 Gold Map ROI (§C.8) — feature work, depends on P1 3-way flips (already done).
- Deep `AGENT_NAVIGATION.md` historical-section trim (lines 187–268 — verbose iter-by-iter KI closure log). Conservative scope for this iter.
