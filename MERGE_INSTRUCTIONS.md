# Iter 68 — Merge Instructions

## Summary

Closes **1 follow-up** in one iteration (clean P2-4 follow-up — delete the deprecated scanner):

- **P2-4 follow-up** — Deleted `backend/api/routes_scanner.py`. The scanner was deprecated in iter 67 (emitted `Deprecation`/`Sunset`/`Link` headers + warning log); iter 68 removes it entirely along with all supporting types, batch-allowed prefix, tests, and regenerated API contract files.

After iter 68, **P2 remains at 3** (P2-1, P2-3, P2-8). P2-4 is fully closed (extended `/flips` in iter 67, deleted scanner in iter 68).

- **1** file deleted (`routes_scanner.py`)
- **~9** files modified (3 backend, 1 test, 2 regenerated API contract files, 5 docs)
- **0** new Known Issues — clean deletion, all tests pass

## What's in this archive

```
iter68/
├── MERGE_INSTRUCTIONS.md                                          ← this file
├── STATUS.md                                                      ← updated (iter 68 entry in Fixed; Quick Reference refreshed)
├── REFACTOR_PLAN.md                                               ← updated (v31 → v32, iter 68 marked DONE)
├── AGENT_NAVIGATION.md                                            ← updated (scanner row removed from §1/§5; invariant #22 updated)
├── worklog.md                                                     ← updated (Task 68 entry; trimmed to ≤3 latest)
├── openapi_schema.json                                            ← regenerated (118KB → 108KB; scanner path + schemas removed)
├── backend/
│   ├── main.py                                                    ← removed scanner router try/except import block
│   └── api/
│       ├── routes_arbitrage.py                                    ← cleaned up 3 inline comments (scanner now deleted, not just deprecated)
│       ├── routes_batch.py                                        ← removed /api/v1/scanner from ALLOWED_PREFIXES
│       └── response_models.py                                     ← removed ScannerOpportunityData/ScannerParams/ScannerResponse
├── src/
│   └── lib/
│       └── api-types.ts                                           ← regenerated (scanner path + schemas removed)
└── tests/
    └── test_flips_filters.py                                      ← removed TestScannerDeprecation class (2 tests)
```

**Files DELETED (not present in archive — delete from your local checkout):**
- `backend/api/routes_scanner.py`

## How to apply

Run from the root of your local `poe2-market-dashboard` checkout (must be on `main` branch, up-to-date with `origin/main` after iter 67 was merged). **NOTE:** if you have local iter 67 changes uncommitted, commit them first before applying iter 68.

```bash
# 1. Extract this archive into a temp location
#    Example (if iter68.zip is in ~/Downloads):
unzip ~/Downloads/iter68.zip -d /tmp/iter68

# 2. DELETE the deprecated scanner file (no longer in archive)
rm ./backend/api/routes_scanner.py

# 3. Copy the modified docs into the repo root
cp /tmp/iter68/iter68/STATUS.md             ./STATUS.md
cp /tmp/iter68/iter68/REFACTOR_PLAN.md      ./REFACTOR_PLAN.md
cp /tmp/iter68/iter68/AGENT_NAVIGATION.md   ./AGENT_NAVIGATION.md
cp /tmp/iter68/iter68/worklog.md            ./worklog.md
cp /tmp/iter68/iter68/MERGE_INSTRUCTIONS.md ./MERGE_INSTRUCTIONS.md

# 4. Copy the regenerated API contract files
cp /tmp/iter68/iter68/openapi_schema.json   ./openapi_schema.json

# 5. Copy the modified backend files (preserving folder structure)
cp /tmp/iter68/iter68/backend/main.py                              ./backend/main.py
cp /tmp/iter68/iter68/backend/api/routes_arbitrage.py              ./backend/api/routes_arbitrage.py
cp /tmp/iter68/iter68/backend/api/routes_batch.py                  ./backend/api/routes_batch.py
cp /tmp/iter68/iter68/backend/api/response_models.py               ./backend/api/response_models.py

# 6. Copy the regenerated TypeScript types
cp /tmp/iter68/iter68/src/lib/api-types.ts                         ./src/lib/api-types.ts

# 7. Copy the modified test file
cp /tmp/iter68/iter68/tests/test_flips_filters.py                  ./tests/test_flips_filters.py

# 8. Verify (with aiosqlite + lightgbm installed)
pip install aiosqlite lightgbm                                          # if not already installed
npx tsc --noEmit                                                       # should print nothing (0 errors)
npx jest                                                               # should report 302 pass / 14 suites
pytest tests/ -q --ignore=tests/e2e                                    # should report 459 pass
pytest tests/e2e/ -q -m "not flaky"                                    # should report 30 pass
git status                                                             # should show ~9 modified + 1 deleted file

# 9. Commit + push
git add -A
git commit -m "refactor(P2-4): delete deprecated routes_scanner.py"
git push origin main
```

## Verification (already done in agent environment)

| Check | Before iter 68 | After iter 68 |
|------|----------------|---------------|
| `pytest tests/test_flips_filters.py -q` | 21 pass | **19 pass** (−2: `TestScannerDeprecation` removed) ✓ |
| `pytest tests/ -q --ignore=tests/e2e` | 461 pass | **459 pass** (−2 scanner tests) ✓ |
| `pytest tests/e2e/ -q -m "not flaky"` | 30 pass | **30 pass** (no regressions) ✓ |
| `npx tsc --noEmit` | 0 errors | **0 errors** ✓ |
| `npx jest` | 302 pass / 14 suites | **302 pass / 14 suites** (unchanged) ✓ |
| `openapi_schema.json` size | 118532 bytes | **108328 bytes** (−10KB scanner schemas) ✓ |
| `grep -c ScannerResponse openapi_schema.json` | 7 hits | **0 hits** ✓ |
| `grep -c ScannerResponse src/lib/api-types.ts` | 5 hits | **0 hits** ✓ |

## Stop point — next iteration (iter 69)

After iter 68: **P0=0, P1=0, P2=3, P3=4.** ~2-4 iterations remaining.

Recommended candidates (per REFACTOR_PLAN.md v32):

1. **P2-8** (`proxyWithFallback` swallows ALL 5xx → 200) — touches frontend error UX.
2. **P2-3** (`currency_names_ru.py` 966-line hardcoded dict → JSON) — medium, mechanical.
3. **P2-1** (`dashboard-page.tsx` 1705-line god-component → split) — large, multi-iter.

Suggested commit for iter 69: `fix(P2-8): proxyWithFallback 5xx pass-through in dev`

**Issue counts after iter 68:** P0=0, P1=0, P2=3, P3=4. ~2-4 iterations remaining.

## Git commands (single commit)

```bash
# After deleting routes_scanner.py and copying all files from the archive (steps 2-7 above):

git add -A
git commit -m "refactor(P2-4): delete deprecated routes_scanner.py

The /api/v1/scanner/scan endpoint was deprecated in iter 67 (emitted
Deprecation/Sunset/Link headers + warning log). Iter 68 removes it entirely:
- deleted backend/api/routes_scanner.py
- removed scanner router try/except import block from backend/main.py
- removed ScannerOpportunityData/ScannerParams/ScannerResponse from
  backend/api/response_models.py
- removed /api/v1/scanner from routes_batch.py:ALLOWED_PREFIXES
- removed TestScannerDeprecation class (2 tests) from tests/test_flips_filters.py
- regenerated openapi_schema.json (118KB -> 108KB) and src/lib/api-types.ts
- updated docs (STATUS, AGENT_NAVIGATION, REFACTOR_PLAN, worklog, BACKEND_GUIDE,
  DATA_CONTRACTS, DATA_FLOW)

All its filter/sort params have lived on /api/v1/arbitrage/flips since iter 67.

Baseline: pytest 459 pass (was 461, -2 scanner tests), jest 302 pass,
tsc 0 errors, e2e 30 pass."

git push origin main
```
