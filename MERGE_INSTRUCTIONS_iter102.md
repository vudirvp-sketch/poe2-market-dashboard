# MERGE INSTRUCTIONS — iter 102

> **Iter:** 102 — Fix KI-11 (502 Bad Gateway on `/api/poe2/uniques` & `/api/poe2/currencies` when upstream returns 404 for league slug) + KI-12 (Turbopack NFT warning)
> **Date:** 2026-07-10
> **Previous:** iter 101 (KI-14 closed: 2 jest test bugs in leveling-uniques-widget)

## Summary

Iter 102 closes the two highest-priority Known Issues left open after iter 101:

- **KI-11** — `/api/poe2/uniques?league=runes` & `/api/poe2/currencies?league=runes` returned 502 Bad Gateway to the browser when the upstream POE2Scout API returned 404 for the configured league slug.
- **KI-12** — `next build` emitted a "Encountered unexpected file in NFT list" Turbopack warning.

### KI-11 — Root cause (corrected)

The iter 101 stopping-point note suggested fixing `backend/data/providers/poe2scout.py:_fetch_json` — but:

1. There is **no `_fetch_json` method** in `poe2scout.py`. The Python provider's `_do_request` is the actual HTTP layer.
2. The 502 doesn't go through the Python backend at all. The Next.js route handlers (`src/app/api/poe2/{uniques,currencies,items}/route.ts`) hit upstream directly via `cachedFetch` in `src/lib/poe2api.ts`.
3. The Python side is already correct — `_do_request` returns `None` on 4xx, and all callers already convert `None` → empty list/dict.

The actual flow that produces the 502:

```
Browser → /api/poe2/uniques?league=runes
        → Next.js route handler (src/app/api/poe2/uniques/route.ts)
        → getUniquesByCategory("poe2", "runes", "all", ...)  [src/lib/poe2api.ts]
        → getUniquesAllCategories(...)
        → cachedFetch<RawCategoriesResponse>(
            "https://api.poe2scout.com/api/poe2/Leagues/runes/Items/Categories"
          )
        → doFetch(...)
        → upstream returns 404
        → throw new Error("API 404: Not Found — ...")
        → cachedFetch propagates (no stale cache to fall back to)
        → getUniquesAllCategories propagates (no try/catch)
        → getUniquesByCategory propagates
        → route handler catch block returns 502 with { items: [], error: "API 404: ..." }
```

The fix catches the upstream 4xx at the lib-function level so the route handler returns 200 with `{ items: [] }` instead of 502. The frontend's existing empty-state UI then renders normally.

### KI-11 — Fix

Added two exported helpers to `src/lib/poe2api.ts`:

```ts
export function isUpstream4xxError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /^API 4\d\d[ :]/.test(err.message);
}

export function emptyPaginatedResponse<T>(
  page: number = 1,
  perPage: number = 50,
): PaginatedResponse<T> {
  return { items: [] as T[], page, perPage, totalItems: 0, totalPages: 0 };
}
```

Wrapped the league-scoped `cachedFetch` calls in 4 functions:

- `getUniquesByCategory` (single-category branch)
- `getUniquesAllCategories` (the initial `Items/Categories` call — per-category fan-out already has `.catch(() => null)`)
- `getCurrenciesByCategory` (single-category branch)
- `getCurrenciesAllCategories` (the initial `Items/Categories` call)

Pattern in each:

```ts
try {
  const raw = await cachedFetch<...>(`${BASE_URL}/...`);
  return { items: ..., page, perPage, totalItems, totalPages };
} catch (err) {
  if (isUpstream4xxError(err)) {
    console.warn(`[poe2api] <fn>: upstream 4xx for ... — returning empty page.`, err.message);
    return emptyPaginatedResponse(page, perPage);
  }
  throw err;  // non-4xx errors still propagate → route handler returns 502
}
```

**Why `isUpstream4xxError` returns false for 5xx and network errors:** those may be transient (server temporarily down, network blip) — propagating them lets the route handler return 502 (genuine upstream failure), which the frontend treats as a retryable error. 4xx is "league not found" or similar — returning empty data is the correct semantic.

### KI-12 — Fix

The original KI-12 description said the fix belonged in `next.config.ts`, but the actual import of `scripts/flipper-backend-bridge.ts` is in `instrumentation.ts` (line 25 of the iter 101 version). Added the `/* turbopackIgnore: true */` magic comment inside the dynamic `await import(...)` call:

```ts
const { startBackendBridge } = await import(
  /* turbopackIgnore: true */ "./scripts/flipper-backend-bridge"
);
```

This tells Turbopack's Node File Trace to exclude the bridge from the serverless bundle. `next dev` and `next start` still load the file from disk normally (the file lives at `scripts/flipper-backend-bridge.ts` and is resolved at runtime). The bridge is only needed when the Next.js process manages the Python backend — serverless/edge deployments would run the backend as a separate service.

## Files Changed

### Modified Files (5)

1. **`src/lib/poe2api.ts`** — Added `isUpstream4xxError` + `emptyPaginatedResponse` exports (immediately before the `// --- Uniques (paginated) ---` section). Wrapped the league-scoped `cachedFetch` call in 4 functions: `getUniquesByCategory` (single-category branch), `getUniquesAllCategories` (initial `Items/Categories` call), `getCurrenciesByCategory` (single-category branch), `getCurrenciesAllCategories` (initial `Items/Categories` call). On `isUpstream4xxError(err)` returns `emptyPaginatedResponse(page, perPage)`; re-throws non-4xx errors. Each catch logs a `[poe2api] <fn>: upstream 4xx for ... — returning empty page.` warning so the user can see why data is empty in production.

2. **`instrumentation.ts`** — Added `/* turbopackIgnore: true */` magic comment inside the `await import("./scripts/flipper-backend-bridge")` call. Added a 7-line explanatory comment block above the import.

3. **`STATUS.md`** — KI-11 + KI-12 moved from "Known Issues — open" to "Known Issues — closed" with full root-cause analysis + verification numbers. Header "Last updated" refreshed. Quick Reference table updated: the KI-11 row now describes the new "200 with empty items" behavior (was "502 Bad Gateway"), the KI-12 row removed (cosmetic, closed), the KI-13 row kept (still open).

4. **`AGENT_NAVIGATION.md`** — Header refreshed with iter 102 summary. Section 4 "Known Issues" updated: KI-11 + KI-12 marked closed with corrected root cause (KI-11) and correct file location (KI-12).

5. **`worklog.md`** — Appended iter 102 entry (Task ID, Agent, Task, Work Log, Stage Summary, Stopping Point).

### New Files (3)

6. **`src/__tests__/poe2api-ki11-graceful-4xx.test.ts`** — 37 jest tests covering: `isUpstream4xxError` predicate (13 tests), `emptyPaginatedResponse` shape (5 tests), `getUniquesByCategory` single-category (5 tests: 404→empty, 400→empty, 403→empty, 500→propagates, 200→populated), `getCurrenciesByCategory` single-category (4 tests), `getUniquesByCategory(category="all")` (4 tests: Items/Categories 404→empty + only 1 fetch, 400→empty, 500→propagates, fan-out NOT called), `getCurrenciesByCategory(category="all")` (4 tests), sanity checks (2 tests). Mocks global `fetch` to control response status; silences `console.warn/info/error` via `jest.spyOn` since the production code intentionally logs a warning when upstream 4xx is converted to empty data.

7. **`MERGE_INSTRUCTIONS_iter102.md`** — This file.

8. **`git_commands_iter102.txt`** — Git commands for staging, committing, and pushing the iter 102 changes.

### Deleted Files (2) — old iter archives cleanup

Per the "keep docs light" rule (only the latest two iter archives kept):

- `MERGE_INSTRUCTIONS_iter100.md` (replaced by iter 101 + iter 102)
- `git_commands_iter100.txt` (replaced by iter 101 + iter 102)

**Kept:** `MERGE_INSTRUCTIONS_iter101.md` + `git_commands_iter101.txt` (previous iter, for traceability) + the new iter 102 files.

## Verification

### Frontend (TypeScript) — ✅ All Green

```
$ npx tsc --noEmit
(no output = clean)

$ npx jest src/__tests__/poe2api-ki11-graceful-4xx.test.ts
Test Suites: 1 passed, 1 total
Tests:       37 passed, 37 total

$ npx jest
Test Suites: 25 passed, 25 total
Tests:       569 passed, 569 total
Snapshots:   0 total
Time:        25.084 s
```

(569 = 532 baseline + 37 new. No regressions.)

### Backend (Python) — unchanged in iter 102

No backend files modified. The Python `_do_request` already returns `None` on 4xx and all callers already convert `None` → empty list/dict, so no backend change was needed. Full 704-test pytest regression was verified green in iter 100.

## Merge Instructions

### Option A: Apply archive (recommended)

1. Extract the archive at the repo root:
   ```bash
   unzip iter102-changes.zip
   ```
   This will overwrite 4 modified files, add 3 new files, and delete 2 obsolete files.

2. Apply the deletions (2 obsolete iter 100 archives):
   ```bash
   git rm MERGE_INSTRUCTIONS_iter100.md git_commands_iter100.txt
   ```

3. Verify the file count:
   ```bash
   git status --short
   ```
   Should show 5 modified + 3 new (untracked) + 2 deleted = 10 changes.

4. Run frontend regression:
   ```bash
   npm install   # if not already installed
   npx tsc --noEmit
   npx jest
   ```
   Expected: 25 suites / 569 tests green.

### Option B: Manual file copy

If you prefer to copy files manually, the archive contains:
- 5 modified files at their canonical paths
- 3 new files (1 test file under `src/__tests__/`, 2 docs at the repo root)

Copy each file to the corresponding location in your local repo, then apply the deletions and run the verification steps above.

## Stop Point — iter 102

**Done in iter 102:**
- KI-11 documented in `STATUS.md` with corrected root cause (Next.js layer, NOT Python backend) — moved to "Known Issues — closed" section.
- KI-12 documented in `STATUS.md` with corrected file location (`instrumentation.ts`, not `next.config.ts`) — moved to "Known Issues — closed" section.
- Added `isUpstream4xxError` + `emptyPaginatedResponse` exports to `src/lib/poe2api.ts`.
- Wrapped league-scoped `cachedFetch` calls in 4 functions (`getUniquesByCategory`, `getUniquesAllCategories`, `getCurrenciesByCategory`, `getCurrenciesAllCategories`) to catch upstream 4xx and return empty `PaginatedResponse`.
- Added `/* turbopackIgnore: true */` to `instrumentation.ts` bridge import.
- Added 37 jest tests in `src/__tests__/poe2api-ki11-graceful-4xx.test.ts`.
- Verified locally: `tsc --noEmit` clean, `npx jest` 25 suites / 569 tests green (532 baseline + 37 new, no regressions).
- Cleaned up obsolete iter 100 archives.

**Not done in iter 102 (deferred to iter 103+):**
- **KI-13** — `/api/v1/prices/stream?threshold_pct=1` returns 400 Bad Request. Cause uncertain. Next-iter investigation plan: (a) add explicit logging at the top of `_sse_event_generator` to capture the actual exception, (b) check `middleware_compression.py` to ensure it skips `text/event-stream` responses, (c) verify the frontend EventSource uses the proxy path `/api/flipper/prices/stream` not the direct backend path.
- **P7 — Mirror/Divine Arb Detector** (§C.6 of `docs/MARKET_PLAYBOOK.md`). Extend `backend/predictors/storage_value.py` for items ≥ 1 Mirror with arbitrage opportunity between Mirror and Divine payment methods.

**Next iter 103 candidate:** Fix KI-13 (lowest remaining KI, low user-facing impact but clutters backend log on every page load). Then start P7.
