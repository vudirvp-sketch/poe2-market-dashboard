# Work Log

> Single source for recent task entries. Long history removed — see git log for details.
> Append new entries at the bottom. Keep ≤3 latest entries.

---

## Task 69 — P2-8 closed + iter 68 scanner residual cleaned
**Agent:** Main Agent
**Date:** 2026-06-21

**Task:** Two goals for this iteration: (1) close P2-8 — make `proxyWithFallback` mode-aware so non-503 5xx responses pass through in dev (developers see real errors) and become marked fallback responses in prod (via `X-Flipper-Fallback` header). (2) Clean up an iter 68 residual: `backend/api/routes_scanner.py` was supposed to be deleted in iter 68 but the actual file was left in the repo because the iter 68 merge instructions required a manual `rm` step that the user skipped.

**Work Log:**
- Documented the iter 68 scanner residual as a bug in STATUS.md (per "document first, fix second" rule). The file was already an orphan — `backend/main.py` no longer imports it, `response_models.py` no longer defines `ScannerResponse`, `routes_batch.py` no longer allows `/api/v1/scanner` — so it had zero runtime impact (pytest baseline was 459 pass with or without it). Iter 69 deletes the file for real and changes the merge instructions so this can't recur (file deletions are now handled via `git add -A` after the user copies the archive; no manual `rm` step).
- Implemented P2-8 in `src/lib/flipper-proxy.ts`:
  - Added `FLIPPER_FALLBACK_HEADER` constant (`"X-Flipper-Fallback"`), `isFlipperFallbackResponse()`, and `getFlipperFallbackOriginalStatus()` exports for frontend use.
  - Added `isDevMode()` helper (`process.env.NODE_ENV === "development"`).
  - Added `jsonFallbackResponse(data, originalStatus)` helper that returns `Response.json(data, { status: 200, headers: { "X-Flipper-Fallback": String(originalStatus) } })`.
  - Refactored `proxyWithFallback`: 503 branch unchanged (still returns 200 + offlineFallback/insufficientDataFallback, now with header). New non-503 5xx branch: in dev, passes the response through unchanged; in prod, returns 200 + fallback + `X-Flipper-Fallback: <status>` header. The final `catch` block (unexpected errors) also uses `jsonFallbackResponse` with status 503.
  - Updated JSDoc with the new mode-aware behavior.
- Added `AbortSignal.timeout` + minimal `Response`/`fetch`/`Headers`/`Request` polyfills to `jest.setup.ts`. jsdom doesn't expose these natively; undici is loaded first (full-featured) with a minimal hand-rolled fallback if undici fails to load (e.g. due to missing `TextDecoder`).
- Added 22 new jest tests in `src/__tests__/flipper-proxy.test.ts` covering: pure helpers (`FLIPPER_FALLBACK_HEADER`, `isFlipperFallbackResponse`, `getFlipperFallbackOriginalStatus`), 200 OK pass-through (both modes), 422 pass-through (both modes), 503 backend_offline (both modes), 503 backend_insufficient_data (with and without `insufficientDataFallback`), 500/502/504 in dev (pass-through), 500/502/504 in prod (200 + header), 500 in prod without `insufficientDataFallback`, and unexpected thrown error (→ 200 + 503 header + offlineFallback).
- Verified baselines: pytest **459 pass** (unchanged), jest **324 pass** (was 302 → +22 new P2-8 tests), tsc **0 errors** (unchanged), e2e **30 pass** (unchanged).
- Updated docs: `STATUS.md` (P2-8 → Fixed; iter 68 entry annotated with the scanner-residual note; iter 69 entry added; Quick Reference row for "500 → no data silently" updated to point to the new header); `AGENT_NAVIGATION.md` (invariant #23 added for P2-8; §1 row for `flipper-proxy.ts` updated; §4 Quick Reference updated); `REFACTOR_PLAN.md` (v32 → v33; iter 69 marked DONE; estimation reduced 2-4 → 1-3 iterations remaining); `worklog.md` (Task 69 entry; trimmed to ≤3 latest — Task 66 dropped, see git log).

**Stage Summary:**
- P2-8 closed. Frontend can now detect fallback responses via `isFlipperFallbackResponse(res)` and optionally surface a non-blocking notice. Devs see real 5xx errors in dev mode.
- Iter 68 scanner residual bug closed. `backend/api/routes_scanner.py` deleted for real; `git add -A` will track the deletion.
- P0=0, P1=0, P2=2, P3=4. ~1-3 iterations remaining.
- Baseline: pytest **459 pass**, jest **324 pass** (+22), tsc 0 errors, e2e 30 pass.

**Stopping point:**
- Iter 69 done. P2-8 closed + iter 68 scanner residual closed.
- Next iter (iter 70) recommended order:
  1. **P2-3** (`currency_names_ru.py` 966-line dict → JSON) — mechanical but long.
  2. **P2-1** (`dashboard-page.tsx` 1705-line god-component → split) — multi-iter.
  3. P3-3 / P3-4 / P3-5 (full /flips integration test) / P3-7 (delete REFACTOR_PLAN.md + worklog.md after all closed).
- Suggested commit message: `fix(P2-8): proxyWithFallback 5xx pass-through in dev + marked fallback in prod`.

---

## Task 68 — P2-4 follow-up (scanner deleted)
**Agent:** Main Agent
**Date:** 2026-06-21

**Stage Summary:**
- P2-4 follow-up closed at the code level (main.py / response_models.py / routes_batch.py / tests / openapi / api-types all updated).
- The actual `routes_scanner.py` file deletion was missed — see iter 69 entry above.
- See git commit `cca86d7` for details.

---

## Task 67 — 3 issues closed (P2-9, P2-6, P2-4)
**Agent:** Main Agent
**Date:** 2026-06-21

**Stage Summary:**
- 3 issues closed. P2 reduced from 5 → 3.
- P2-9: adaptive `lightgbm_min_data_points` fallback (floor=5, minimal features).
- P2-6: new route `GET /api/flipper/health/circuit-breakers` (JSON snapshot of per-endpoint CB state).
- P2-4: `/flips` extended with 7 optional filter/sort params; scanner marked deprecated (deleted in iter 68).
- See git commit `e88830c` for details.
