# MERGE INSTRUCTIONS — iter 101

> **Iter:** 101 — Fix 2 failing jest tests in `leveling-uniques-widget.test.tsx` (KI-14 closed) + repo cleanup
> **Date:** 2026-07-10
> **Previous:** iter 100 (Leveling Uniques Lifecycle widget, P3)

## Summary

Iter 101 fixes the 2 jest test failures that surfaced when the user ran the iter 100 delivery locally (see `STATUS.md` → KI-14). Both bugs were in the **test file only** — the widget component itself was correct.

### Bug A — `renders item count with uniques.length` (text matcher)

**Symptom.** Test used exact-match `getByText("3 items")`, but the widget renders the count inside a span together with a leading `·` separator:

```tsx
<span className="text-xs text-muted-foreground/80 font-mono">
  · {t("levelingItemCount", { 0: uniques.length })}
</span>
```

Resulting textContent = `"· 3 items"`. `getByText` with a string argument uses exact matching by default, so it failed with "Unable to find an element with the text: 3 items".

**Fix.** Switched to a regex matcher: `getByText(/3 items/)`. Same approach already used by sibling tests (`/ref: exalted/i`, `/Day 2/`).

### Bug B — `calls fetchApi again when refresh button clicked after error` (call count)

**Symptom.** Test expected `mockFetchApi` to be called 2 times after click, but it was called 3 times.

**Root cause** (two compounding factors):

1. **Per-query `retry: 1`** in the widget (`leveling-uniques-widget.tsx:181`) overrides the test client's `retry: false`. So an initial failure triggers 1 automatic retry.

2. **I18nProvider hydration** — `I18nProvider` always starts with `DEFAULT_LOCALE = "ru"` and then, after mount, reads `localStorage.getItem("poe2-locale")` and calls `setLocaleState("en")` if the stored value differs. This causes a re-render with a new `locale`, which changes the `queryKey` from `["levelingUniques","ru"]` to `["levelingUniques","en"]`. React Query then starts a fresh query for the new key (and abandons the in-flight retry of the old key).

Net result: 3 fetches before the error UI is shown (`ru`-initial + `en`-initial + `en`-retry), then 1 more on refresh click → total 4. The exact split depends on timing of the locale hydration vs the retry delay (default ~1s backoff in React Query v5), so asserting a fixed number is fragile.

**Fix.** Snapshot the call count after the error UI appears (`callsBeforeRefresh = mockFetchApi.mock.calls.length`), assert `≥ 2` (initial + at least 1 retry), then after refresh click assert `toHaveBeenCalledTimes(callsBeforeRefresh + 1)` and verify the error UI is gone. This makes the test resilient to the locale-hydration timing without weakening the assertion that refresh triggers exactly one new fetch.

## Files Changed

### Modified Files (2)

1. **`src/__tests__/leveling-uniques-widget.test.tsx`** — 2 test bodies rewritten with explanatory comments. No production code changed.

2. **`STATUS.md`** — Added KI-14 entry to "Known Issues — closed" section with full root-cause analysis and verification numbers. Updated "Last updated" header.

### New Files (2)

3. **`MERGE_INSTRUCTIONS_iter101.md`** — This file.

4. **`git_commands_iter101.txt`** — Git commands for staging, committing, and pushing the iter 101 changes (including cleanup of obsolete legacy files).

### Deleted Files (18) — repo cleanup

The following files were obsolete leftovers from previous iter archives and have been removed from the repo:

- `flipper-bridge.log` (409 KB runtime log, should never have been committed)
- `README.txt` (iter 86 leftover)
- `DELETIONS.sh`, `DELETIONS.txt` (iter 87 leftover)
- `MERGE_INSTRUCTIONS.md` (generic, undated)
- `MERGE_INSTRUCTIONS_iter81.md`, `_iter88.md`, `_iter89.md`, `_iter91.md`, `_iter94.md`, `_iter95.md`, `_iter97.md`, `_iter98.md`, `_iter99.md` (9 old iter archives — only the latest two are kept)
- `git_commands.txt` (generic, undated)
- `git_commands_iter94.txt`, `_iter98.txt`, `_iter99.txt` (3 old git command files)

**Kept:** `MERGE_INSTRUCTIONS_iter100.md` + `git_commands_iter100.txt` (for traceability of the previous iter) + the new iter 101 files.

## Verification

### Frontend (TypeScript) — ✅ All Green

```
$ npx tsc --noEmit
(no output = clean)

$ npx jest
Test Suites: 24 passed, 24 total
Tests:       532 passed, 532 total
Snapshots:   0 total
Time:        20.426 s
```

The previously failing test suite:

```
$ npx jest src/__tests__/leveling-uniques-widget.test.tsx
PASS src/__tests__/leveling-uniques-widget.test.tsx
Tests:       32 passed, 32 total
```

### Backend (Python) — ✅ All Green

```
$ python -m pytest tests/test_leveling_uniques.py --no-header -q
.............................................                            [100%]
============================== 86 passed in 2.51s ==============================
```

(Backend unchanged in iter 101 — only the test file + docs were touched. Full 704-test regression was verified green in iter 100.)

## Merge Instructions

### Option A: Apply archive (recommended)

1. Extract the archive at the repo root:
   ```bash
   unzip iter101-changes.zip
   ```
   This will overwrite 2 modified files and add 2 new files.

2. Apply the deletions (18 obsolete files):
   ```bash
   git rm flipper-bridge.log README.txt DELETIONS.sh DELETIONS.txt \
     MERGE_INSTRUCTIONS.md MERGE_INSTRUCTIONS_iter81.md MERGE_INSTRUCTIONS_iter88.md \
     MERGE_INSTRUCTIONS_iter89.md MERGE_INSTRUCTIONS_iter91.md MERGE_INSTRUCTIONS_iter94.md \
     MERGE_INSTRUCTIONS_iter95.md MERGE_INSTRUCTIONS_iter97.md MERGE_INSTRUCTIONS_iter98.md \
     MERGE_INSTRUCTIONS_iter99.md git_commands.txt git_commands_iter94.txt \
     git_commands_iter98.txt git_commands_iter99.txt
   ```

3. Verify the file count:
   ```bash
   git status --short
   ```
   Should show 2 modified + 2 new (untracked) + 18 deleted = 22 changes.

4. Run frontend regression:
   ```bash
   npm install   # if not already installed
   npx tsc --noEmit
   npx jest src/__tests__/leveling-uniques-widget.test.tsx
   ```
   Expected: 32 passed, 0 failed.

5. Run backend regression (sanity):
   ```bash
   python -m pytest tests/test_leveling_uniques.py -q
   ```
   Expected: 86 passed.

### Option B: Manual file copy

If you prefer to copy files manually, the archive contains:
- 2 modified files at their canonical paths
- 2 new files at the repo root

Copy each file to the corresponding location in your local repo, then apply the deletions and run the verification steps above.

## Stop Point — iter 101

**Done in iter 101:**
- KI-14 documented in `STATUS.md` (Known Issues — closed section) with full root-cause analysis
- Fixed `renders item count with uniques.length` — switched to regex matcher `/3 items/`
- Fixed `calls fetchApi again when refresh button clicked after error` — snapshot + 1 call approach, robust to I18nProvider hydration timing
- Verified locally: `tsc --noEmit` clean, `npx jest` 24 suites / 532 tests green, `pytest tests/test_leveling_uniques.py` 86 tests green
- Cleaned up 18 obsolete legacy files (old iter archives + log files)

**Not done in iter 101 (deferred to iter 102+):**
- **KI-11** — Upstream POE2Scout API 404 for league "runes". Code-side fix: `backend/data/providers/poe2scout.py:_fetch_json` should return `[]` on 404 instead of raising, so the proxy at `src/app/api/poe2/currencies/route.ts` returns 200 with empty data instead of 502.
- **KI-12** — Turbopack NFT warning (cosmetic). Fix: add `/*turbopackIgnore: true*/` to the bridge import in `next.config.ts`.
- **KI-13** — SSE 400 on `/api/v1/prices/stream?threshold_pct=1`. Needs investigation — likely middleware rejecting SSE or exception in `_sse_event_generator` when snapshot is empty.
- **P7 — Mirror/Divine Arb Detector** (§C.6 of `docs/MARKET_PLAYBOOK.md`). Extend `backend/predictors/storage_value.py` for items ≥ 1 Mirror with arbitrage opportunity between Mirror and Divine payment methods.

**Next iter 102 candidate:** Fix KI-11 (highest user-facing impact — unblocks the rest of the dashboard when an invalid league slug is configured). Then start P7.
