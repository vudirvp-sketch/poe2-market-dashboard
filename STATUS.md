# STATUS.md — Known Issues & Refactoring Backlog

> **Last updated:** 2026-06-21 (iter 69 — closed P2-8 + cleaned up iter 68 scanner residual)
> Single source of truth for known bugs and refactoring priorities.
> Update BEFORE fixing any issue. Cross-reference issue IDs in commits.

---

## P0 — Critical (correctness, stability) — 0 active

All P0 issues resolved in iter 54-58.

---

## P1 — Serious (performance, maintainability) — 0 active

All P1 issues resolved in iter 54-66.

---

## P2 — Medium (clean code, dev experience) — 2 items

- **P2-1.** `dashboard-page.tsx` — 1705 lines, god-component. Split into tab-specific subcomponents.
- **P2-3.** `currency_names_ru.py` — 966-line hardcoded dict. Move to JSON.

> **P2-8 (iter 69):** `proxyWithFallback` is now mode-aware. In dev, non-503 5xx pass through unchanged so devs see real errors. In prod, all 5xx (including 503) still return 200 with fallback data, but the response now carries an `X-Flipper-Fallback: <original-status>` header so the frontend can detect it. Use `isFlipperFallbackResponse(res)` / `getFlipperFallbackOriginalStatus(res)` from `flipper-proxy.ts` to inspect.

---

## P3 — Low priority (nice-to-have) — 4 items

- **P3-3.** `EventManager` not thread-safe for multi-worker uvicorn.
- **P3-4.** `SnapshotManager._snapshot` swap non-atomic for iterators.
- **P3-5.** No integration test for full `/flips` flow (now partially covered by `test_flips_filters.py`).
- **P3-7.** `REFACTOR_PLAN.md` and `worklog.md` — delete after closing all issues.

---

## Fixed (recent — older history in git log)

### iter 69 — P2-8 closed + iter 68 scanner residual cleaned

- **P2-8 — `proxyWithFallback` 5xx mode-aware.** Non-503 5xx (500/502/504) now pass through unchanged in dev (`NODE_ENV === "development"`) so developers see the real backend error in the browser console. In prod, the same errors still become 200 + fallback (no console spam, no React Query retry storms), but the response now carries the `X-Flipper-Fallback: <original-status>` header. 503 fallback behavior (offline/insufficient_data) is unchanged in both modes — otherwise dev would be unusable whenever the backend isn't running. New exports: `FLIPPER_FALLBACK_HEADER`, `isFlipperFallbackResponse()`, `getFlipperFallbackOriginalStatus()`. +22 jest tests; jest.setup.ts gained `Response`/`fetch`/`Headers`/`AbortSignal.timeout` polyfills (undici + minimal fallback) so the new tests can mock fetch in jsdom.
- **Iter 68 scanner residual (bug).** `backend/api/routes_scanner.py` was supposed to be deleted in iter 68 (commit `cca86d7` message says "deleted backend/api/routes_scanner.py"), but the actual file was left in the repo. Root cause: the iter 68 archive asked the user to run `rm ./backend/api/routes_scanner.py` manually before `git add -A`, and that manual step was skipped. The file was already an orphan — `backend/main.py` no longer imports it, `response_models.py` no longer defines `ScannerResponse`, `routes_batch.py` no longer allows `/api/v1/scanner` — so it had zero runtime impact (pytest baseline was 459 pass with or without it). Iter 69 deletes the file for real and changes the merge instructions so this can't happen again (file deletions are now handled via `git add -A` after the user copies the archive; no manual `rm` step).

### iter 68 — P2-4 follow-up (scanner deletion)

- **P2-4 follow-up** — Removed scanner router import/include from `backend/main.py`. Removed `ScannerOpportunityData` / `ScannerParams` / `ScannerResponse` from `backend/api/response_models.py`. Removed `/api/v1/scanner` from `routes_batch.py:ALLOWED_PREFIXES`. Removed `TestScannerDeprecation` class (2 tests) from `tests/test_flips_filters.py`. Regenerated `openapi_schema.json` (118KB → 108KB) and `src/lib/api-types.ts`. Updated inline comments in `routes_arbitrage.py`. Docs cleaned up. (Note: the actual `routes_scanner.py` file deletion was missed at this point — see iter 69 entry above.) Baseline: pytest **459 pass**, jest **302 pass**, tsc **0 errors**, e2e **30 pass**.

### iter 67 — 3 issues closed (P2-9, P2-6, P2-4)

- **P2-9** — Adaptive fallback for `lightgbm_min_data_points`. New config field `lightgbm_min_data_points_floor: int = 5`. When `floor <= len(log_prices) < min_points` (default 15), training proceeds with maximally simplified features. +3 unit tests, +1 updated existing test.
- **P2-6** — New Next.js route `GET /api/flipper/health/circuit-breakers` exposes the per-endpoint breaker Map as JSON. Read-only. +3 jest tests.
- **P2-4** — Extended `GET /api/v1/arbitrage/flips` with optional filter/sort params: `max_score`, `min_spread`, `max_spread`, `cluster`, `currency`, `sort_by`, `sort_dir`. +19 pytest tests (4 backward-compat, 7 filters, 6 sort, 2 combined — 2 deprecation-header tests removed in iter 68).

### Earlier fixes

P0-1..P0-6, P1-1/2/4/7/8/11, P2-7/10/11/12/13/14, P2-2/5, P3-8 (iter 54-67). See git log for details.

---

## Quick Reference — Frequent Problems

| Symptom | Cause | Where to fix |
|---------|-------|--------------|
| 500 from backend becomes "no data" silently | (Fixed iter 69 — was P2-8) — in prod check `X-Flipper-Fallback` header; in dev the real 5xx now passes through | `flipper-proxy.ts:proxyWithFallback` |
| `test_scheduler.py` collection fails | `aiosqlite` not installed in env | `pip install aiosqlite` |
| `/optimizer/path` returns empty path with `data_available: true` | Profitable arbitrage cycle detected — fall back to `direct_rate` (P1-8, iter 64) | `backend/api/routes_optimizer.py:_bellman_ford` |
| `RuntimeError: cannot schedule new futures after shutdown` | (Fixed iter 65 — was P2-13) | — |
| One endpoint's 5xx blocks all other endpoints | (Fixed iter 66 — was P1-10) | — |
| SQLite `near "LIMIT": syntax error` | Use `rowid IN (SELECT ... LIMIT ?)` pattern, not `DELETE ... LIMIT ?` | `backend/data/historical.py:_prune_old_league_data` |
| LightGBM skips training for new currency | Below `lightgbm_min_data_points` (15) — adaptive fallback now trains from `floor` (5) with minimal features (P2-9, iter 67) | `backend/predictors/time_series.py:train` |
| Need to inspect circuit breaker state | `GET /api/flipper/health/circuit-breakers` returns JSON snapshot (P2-6, iter 67) | `src/app/api/flipper/health/circuit-breakers/route.ts` |
| Want advanced `/flips` filters | All scanner params (`max_score`, `min_spread`, `max_spread`, `cluster`, `currency`, `sort_by`, `sort_dir`) are on `/api/v1/arbitrage/flips` (P2-4, iter 67) | `backend/api/routes_arbitrage.py:get_flip_opportunities` |
