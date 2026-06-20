# STATUS.md — Known Issues & Refactoring Backlog

> **Last updated:** 2026-06-21 (iter 68 — closed P2-4 follow-up: scanner deleted)
> Single source of truth for known bugs and refactoring priorities.
> Update BEFORE fixing any issue. Cross-reference issue IDs in commits.

---

## P0 — Critical (correctness, stability) — 0 active

All P0 issues resolved in iter 54-58.

---

## P1 — Serious (performance, maintainability) — 0 active

All P1 issues resolved in iter 54-66.

---

## P2 — Medium (clean code, dev experience) — 3 items

- **P2-1.** `dashboard-page.tsx` — 1705 lines, god-component. Split into tab-specific subcomponents.
- **P2-3.** `currency_names_ru.py` — 966-line hardcoded dict. Move to JSON.
- **P2-8.** `proxyWithFallback` swallows ALL 5xx → 200. Pass-through in dev, mark fallback in prod.

> **P2-4 (iter 67 → iter 68):** `/flips` extended with all scanner filter/sort params in iter 67. `routes_scanner.py` was deprecated in iter 67 and **deleted in iter 68** — `/api/v1/scanner` removed from `routes_batch.py:ALLOWED_PREFIXES`, `ScannerResponse`/`ScannerOpportunityData`/`ScannerParams` removed from `response_models.py`, `openapi_schema.json` + `api-types.ts` regenerated.

---

## P3 — Low priority (nice-to-have) — 4 items

- **P3-3.** `EventManager` not thread-safe for multi-worker uvicorn.
- **P3-4.** `SnapshotManager._snapshot` swap non-atomic for iterators.
- **P3-5.** No integration test for full `/flips` flow (now partially covered by `test_flips_filters.py`).
- **P3-7.** `REFACTOR_PLAN.md` and `worklog.md` — delete after closing all issues.

---

## Fixed (recent — older history in git log)

### iter 68 — P2-4 follow-up (scanner deletion)

- **P2-4 follow-up** — Deleted `backend/api/routes_scanner.py`. Removed scanner router import/include from `backend/main.py`. Removed `ScannerOpportunityData` / `ScannerParams` / `ScannerResponse` from `backend/api/response_models.py`. Removed `/api/v1/scanner` from `routes_batch.py:ALLOWED_PREFIXES`. Removed `TestScannerDeprecation` class (2 tests) from `tests/test_flips_filters.py`. Regenerated `openapi_schema.json` (118KB → 108KB) and `src/lib/api-types.ts` — scanner path and schemas fully gone. Updated inline comments in `routes_arbitrage.py` to reflect that scanner is now deleted (not just deprecated). Docs (`AGENT_NAVIGATION.md`, `docs/BACKEND_GUIDE.md`, `docs/DATA_CONTRACTS.md`, `docs/DATA_FLOW.md`) cleaned up. Baseline: pytest **459 pass** (was 461 → −2 removed scanner tests), jest **302 pass**, tsc **0 errors**, e2e **30 pass**.

### iter 67 — 3 issues closed (P2-9, P2-6, P2-4)

- **P2-9** — Adaptive fallback for `lightgbm_min_data_points`. New config field `lightgbm_min_data_points_floor: int = 5`. When `floor <= len(log_prices) < min_points` (default 15), training proceeds with maximally simplified features (`price_lags=[1]`, no volume/rolling/calendar). Post-dropna minimum is lowered to 2 rows in "very sparse" mode. Below `floor`, training is skipped (preserves old behavior). +3 unit tests, +1 updated existing test.
- **P2-6** — New Next.js route `GET /api/flipper/health/circuit-breakers` exposes the per-endpoint breaker Map as JSON (`total`, `open_count`, `circuit_breakers: {path: EndpointCircuitBreaker}`, `timestamp`). Read-only. +3 jest tests.
- **P2-4** — Extended `GET /api/v1/arbitrage/flips` with optional filter/sort params: `max_score`, `min_spread`, `max_spread`, `cluster`, `currency`, `sort_by`, `sort_dir`. All have safe defaults → backward compatible. `routes_scanner.py` was deprecated in iter 67 with deprecation headers, then **deleted in iter 68**. +19 pytest tests (4 backward-compat, 7 filters, 6 sort, 2 combined — 2 deprecation-header tests removed in iter 68).

### Earlier fixes

P0-1..P0-6, P1-1/2/4/7/8/11, P2-7/10/11/12/13/14, P2-2/5, P3-8 (iter 54-67). See git log for details.

---

## Quick Reference — Frequent Problems

| Symptom | Cause | Where to fix |
|---------|-------|--------------|
| 500 from backend becomes "no data" | `proxyWithFallback` swallows 5xx (P2-8) | `flipper-proxy.ts:proxyWithFallback` |
| `test_scheduler.py` collection fails | `aiosqlite` not installed in env | `pip install aiosqlite` |
| `/optimizer/path` returns empty path with `data_available: true` | Profitable arbitrage cycle detected — fall back to `direct_rate` (P1-8, iter 64) | `backend/api/routes_optimizer.py:_bellman_ford` |
| `RuntimeError: cannot schedule new futures after shutdown` | (Fixed iter 65 — was P2-13) | — |
| One endpoint's 5xx blocks all other endpoints | (Fixed iter 66 — was P1-10) | — |
| SQLite `near "LIMIT": syntax error` | Use `rowid IN (SELECT ... LIMIT ?)` pattern, not `DELETE ... LIMIT ?` | `backend/data/historical.py:_prune_old_league_data` |
| LightGBM skips training for new currency | Below `lightgbm_min_data_points` (15) — adaptive fallback now trains from `floor` (5) with minimal features (P2-9, iter 67) | `backend/predictors/time_series.py:train` |
| Need to inspect circuit breaker state | `GET /api/flipper/health/circuit-breakers` returns JSON snapshot (P2-6, iter 67) | `src/app/api/flipper/health/circuit-breakers/route.ts` |
| Want advanced `/flips` filters | All scanner params (`max_score`, `min_spread`, `max_spread`, `cluster`, `currency`, `sort_by`, `sort_dir`) are on `/api/v1/arbitrage/flips` (P2-4, iter 67) | `backend/api/routes_arbitrage.py:get_flip_opportunities` |
