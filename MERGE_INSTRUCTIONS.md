# Iter 60 — Merge Instructions

## Summary

Closes **P2-11** (orphan root-level files cleanup). Restores clean `tsc` + `jest` baseline broken in iter 58.

- **0** code changes — only deletions
- **3** documentation files updated (`STATUS.md`, `REFACTOR_PLAN.md`, `worklog.md`)
- **10** orphan root-level files removed via `git rm`

## What's in this archive

```
iter60/
├── MERGE_INSTRUCTIONS.md   ← this file
├── DELETIONS.sh            ← script to git rm the 10 orphan files
├── STATUS.md               ← updated (iter 60 — P2-11 closed)
├── REFACTOR_PLAN.md        ← updated (v24 → v25)
└── worklog.md              ← updated (iter 60 entry added; iter 55 entry removed)
```

## How to apply

Run from the root of your local `poe2-market-dashboard` checkout (must be on `main` branch, up-to-date with `origin/main`):

```bash
# 1. Extract this archive into a temp location (or directly over the repo)
#    Example (if iter60.zip is in ~/Downloads):
unzip ~/Downloads/iter60.zip -d /tmp/iter60

# 2. Copy the 3 modified docs into the repo root
cp /tmp/iter60/iter60/STATUS.md         ./STATUS.md
cp /tmp/iter60/iter60/REFACTOR_PLAN.md  ./REFACTOR_PLAN.md
cp /tmp/iter60/iter60/worklog.md        ./worklog.md

# 3. Run the deletion script to git rm the 10 orphan files
bash /tmp/iter60/iter60/DELETIONS.sh

# 4. Verify
npx tsc --noEmit        # should print nothing (0 errors)
npx jest                # should report 291 pass / 14 suites
git status              # should show 3 modified + 10 deleted files

# 5. Commit + push
git add -A
git commit -m "fix(P2-11): remove 10 orphan root-level files from iter 58"
git push origin main
```

## Verification (already done in agent environment)

| Check | Before iter 60 | After iter 60 |
|------|----------------|---------------|
| `tsc --noEmit` | 2 errors (P2-11) | **0 errors** ✓ |
| `jest` | 291 pass / 13 + 1 failing suite | **291 pass / 14 suites** ✓ |
| `pytest tests/test_triangular.py` | 7/7 pass | 7/7 pass ✓ |
| `pytest tests/` (full suite) | 7 fail (test_triangular) + 11 fail (test_compression/brotli) — pre-existing | same baseline (P2-11 didn't touch Python files; `pytest.ini: testpaths = tests` never collected root Python files) |

Pre-existing `test_triangular` failures in full-suite mode (passes alone) and `test_compression` failures (missing `brotli` / function `_check_brotli_available` not exported) are documented in STATUS.md §Quick Reference — they were present BEFORE this iteration and are NOT caused by P2-11.

## Stop point — next iteration (iter 61)

**P1-7** (EventManager async) — recommended next per REFACTOR_PLAN.md v25 §"Recommended Fix Order":
- Make 5 sync methods in `backend/economy/events.py` async: `create_event`, `delete_event`, `deactivate_event`, `_prune_expired_events` (or `prune_expired_events`), `clear_all_events`.
- Replace `asyncio.get_event_loop()` + `ensure_future` / `run_until_complete` fire-and-forget pattern with direct `await self._store.write_event(event)` etc.
- Update callers in `backend/api/routes_events.py` (3 endpoints — add `await`).
- Update tests: `tests/test_events.py`, `tests/test_lifecycle.py`, `tests/test_routes_events_invalidation.py`.
- Naturally closes **P3-8** (deprecated `asyncio.get_event_loop()` in `events.py:210`).

Suggested commit message: `refactor(P1-7): EventManager async — replace fire-and-forget with await`
