# Iter 69 — Merge Instructions

## Summary

Closes **1 P2 issue + 1 bug** in one iteration:

- **P2-8 — `proxyWithFallback` 5xx mode-aware handling.** Non-503 5xx (500/502/504) now passes through unchanged in dev (`NODE_ENV === "development"`) so developers see the real backend error in the browser console. In prod, the same errors still become 200 + fallback data (no console spam, no React Query retry storms), but the response now carries an `X-Flipper-Fallback: <original-status>` header so the frontend can detect it. 503 (backend_offline / backend_insufficient_data) fallback behavior is unchanged in both modes — otherwise dev would be unusable whenever the backend isn't running. New exports: `FLIPPER_FALLBACK_HEADER`, `isFlipperFallbackResponse()`, `getFlipperFallbackOriginalStatus()`. +22 jest tests; `jest.setup.ts` gained `Response` / `fetch` / `Headers` / `AbortSignal.timeout` polyfills.
- **Iter 68 scanner residual (bug).** `backend/api/routes_scanner.py` was supposed to be deleted in iter 68 (commit `cca86d7` message says "deleted backend/api/routes_scanner.py"), but the actual file was left in the repo because the iter 68 merge instructions asked the user to run `rm ./backend/api/routes_scanner.py` manually before `git add -A`, and that manual step was skipped. The file was already an orphan (zero runtime impact — pytest baseline was 459 pass with or without it). Iter 69 deletes the file for real. Going forward, file deletions are handled via `git add -A` after the user copies the archive; no manual `rm` step.

After iter 69, **P2 drops to 2** (P2-1, P2-3). P0=0, P1=0, P2=2, P3=4.

- **1** file deleted (`routes_scanner.py` — handled via `git add -A` after copying the archive; no manual `rm` needed)
- **4** files modified (1 src/lib, 1 src/__tests__, 1 jest.setup, 4 docs)
- **0** new Known Issues — all tests pass

## What's in this archive

```
iter69/
├── MERGE_INSTRUCTIONS.md                                          ← this file
├── STATUS.md                                                      ← updated (P2-8 → Fixed; iter 68 annotated with scanner-residual note; iter 69 entry added; Quick Reference refreshed)
├── REFACTOR_PLAN.md                                               ← updated (v32 → v33, iter 69 marked DONE, principle #6 added about file deletions via git add -A)
├── AGENT_NAVIGATION.md                                            ← updated (invariant #23 added for P2-8; §1 row for flipper-proxy.ts updated; §4 Quick Reference updated; §4 P2 count 3 → 2)
├── worklog.md                                                     ← updated (Task 69 entry; trimmed to ≤3 latest — Task 66 dropped)
├── package.json                                                   ← added undici ^8.5.0 to devDependencies (used by jest.setup.ts polyfill; minimal fallback exists if missing)
├── package-lock.json                                              ← lockfile updated for undici
├── jest.setup.ts                                                  ← added Response/fetch/Headers/Request + AbortSignal.timeout polyfills for jsdom
└── src/
    ├── lib/
    │   └── flipper-proxy.ts                                       ← P2-8: mode-aware 5xx handling + X-Flipper-Fallback header + helper exports
    └── __tests__/
        └── flipper-proxy.test.ts                                  ← +22 jest tests for P2-8 (helpers, dev/prod 5xx, 503, 422, 200 OK)
```

**Files DELETED (not present in archive — `git add -A` will track the deletion automatically):**
- `backend/api/routes_scanner.py` ← iter 68 residual; if you still have this file in your local checkout, just leave it — `git add -A` after copying the archive will mark it as deleted. No manual `rm` needed.

## How to apply

Run from the root of your local `poe2-market-dashboard` checkout (must be on `main` branch, up-to-date with `origin/main` after iter 68 was merged).

```bash
# 1. Extract this archive into a temp location
#    Example (if iter69.zip is in ~/Downloads):
unzip ~/Downloads/iter69.zip -d /tmp/iter69

# 2. Copy the modified docs into the repo root
cp /tmp/iter69/iter69/STATUS.md             ./STATUS.md
cp /tmp/iter69/iter69/REFACTOR_PLAN.md      ./REFACTOR_PLAN.md
cp /tmp/iter69/iter69/AGENT_NAVIGATION.md   ./AGENT_NAVIGATION.md
cp /tmp/iter69/iter69/worklog.md            ./worklog.md
cp /tmp/iter69/iter69/MERGE_INSTRUCTIONS.md ./MERGE_INSTRUCTIONS.md

# 3. Copy the modified package files (added undici devDep for jest polyfill)
cp /tmp/iter69/iter69/package.json          ./package.json
cp /tmp/iter69/iter69/package-lock.json     ./package-lock.json

# 4. Copy the modified jest setup
cp /tmp/iter69/iter69/jest.setup.ts         ./jest.setup.ts

# 5. Copy the modified src files (preserving folder structure)
cp /tmp/iter69/iter69/src/lib/flipper-proxy.ts          ./src/lib/flipper-proxy.ts
cp /tmp/iter69/iter69/src/__tests__/flipper-proxy.test.ts  ./src/__tests__/flipper-proxy.test.ts

# 6. Delete the iter 68 residual file (if you still have it — `git add -A` will track the deletion)
#    NOTE: NO manual `rm` required if you don't have the file — `git add -A` is enough.
#    If you DO have the file, you can either delete it manually OR let `git add -A` handle it
#    after you run `rm -f ./backend/api/routes_scanner.py`.
rm -f ./backend/api/routes_scanner.py  # safe — -f means "don't fail if missing"

# 7. Verify (with aiosqlite + lightgbm installed)
pip install aiosqlite lightgbm                                          # if not already installed
npm install                                                             # picks up undici devDep (optional — polyfill falls back to minimal stubs if undici missing)
npx tsc --noEmit                                                        # should print nothing (0 errors)
npx jest                                                                # should report 324 pass / 14 suites
pytest tests/ -q --ignore=tests/e2e                                     # should report 459 pass
pytest tests/e2e/ -q -m "not flaky"                                     # should report 30 pass
git status                                                              # should show ~8 modified + 1 deleted file

# 8. Commit + push (single commit)
git add -A
git commit -m "fix(P2-8): proxyWithFallback 5xx pass-through in dev + marked fallback in prod"
git push origin main
```

## Verification (already done in agent environment)

| Check | Before iter 69 | After iter 69 |
|------|----------------|---------------|
| `pytest tests/ -q --ignore=tests/e2e` | 459 pass | **459 pass** (unchanged) ✓ |
| `pytest tests/e2e/ -q -m "not flaky"` | 30 pass | **30 pass** (unchanged) ✓ |
| `npx tsc --noEmit` | 0 errors | **0 errors** ✓ |
| `npx jest` | 302 pass / 14 suites | **324 pass / 14 suites** (+22 P2-8 tests) ✓ |
| `ls backend/api/routes_scanner.py` | file present (iter 68 residual) | **file deleted** ✓ |
| `grep -c X-Flipper-Fallback src/lib/flipper-proxy.ts` | 0 hits | **5+ hits** (constant + helper + usage) ✓ |
| `grep -c isFlipperFallbackResponse src/__tests__/flipper-proxy.test.ts` | 0 hits | **3 hits** (1 import + 2 tests) ✓ |

## Stop point — next iteration (iter 70)

After iter 69: **P0=0, P1=0, P2=2, P3=4.** ~1-3 iterations remaining.

Recommended candidates (per REFACTOR_PLAN.md v33):

1. **P2-3** (`currency_names_ru.py` 966-line hardcoded dict → JSON) — mechanical but long.
2. **P2-1** (`dashboard-page.tsx` 1705-line god-component → split) — large, multi-iter.
3. P3-3, P3-4, P3-5 (full /flips integration test), P3-7 (delete REFACTOR_PLAN.md + worklog.md after all closed).

Suggested commit for iter 70: `refactor(P2-3): move currency_names_ru.py to JSON`

**Issue counts after iter 69:** P0=0, P1=0, P2=2, P3=4. ~1-3 iterations remaining.

## Git commands (single commit)

```bash
# After copying all files from the archive (steps 2-5 above):

git add -A
git commit -m "fix(P2-8): proxyWithFallback 5xx pass-through in dev + marked fallback in prod

P2-8: proxyWithFallback is now mode-aware for non-503 5xx responses.
- Dev (NODE_ENV=development): 500/502/504 pass through unchanged so
  developers see the real backend error in the browser console.
- Prod: same errors still become 200 + fallback data (no console spam,
  no React Query retry storms), but the response now carries the
  X-Flipper-Fallback: <original-status> header so the frontend can
  detect it via isFlipperFallbackResponse(res) / getFlipperFallbackOriginalStatus(res).
- 503 (backend_offline / backend_insufficient_data) fallback behavior
  is unchanged in both modes — otherwise dev would be unusable whenever
  the backend isn't running.

New exports: FLIPPER_FALLBACK_HEADER, isFlipperFallbackResponse,
getFlipperFallbackOriginalStatus. +22 jest tests covering helpers,
dev/prod 5xx, 503 offline/insufficient_data, 422, 200 OK.

jest.setup.ts gained Response/fetch/Headers/AbortSignal.timeout polyfills
(undici first, minimal hand-rolled fallback) so the new tests can mock
fetch in jsdom.

Also closes the iter 68 scanner residual: backend/api/routes_scanner.py
was supposed to be deleted in iter 68 but the manual `rm` step in the
iter 68 MERGE_INSTRUCTIONS was skipped. The file was already an orphan
(zero runtime impact). Iter 69 deletes it for real. Going forward, file
deletions are handled via `git add -A` — no manual `rm` instructions.

Baseline: pytest 459 pass (unchanged), jest 324 pass (+22 P2-8 tests),
tsc 0 errors, e2e 30 pass."

git push origin main
```
