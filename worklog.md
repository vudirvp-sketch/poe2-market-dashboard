# Work Log

> Single source for recent task entries. Long history removed — see git log for details.
> Append new entries at the bottom. Keep ≤3 latest entries.

---

## Task 67 — 3 issues closed (P2-9, P2-6, P2-4)
**Agent:** Main Agent
**Date:** 2026-06-21

**Task:** Continue P2 cleanup after iter 66 (which emptied the P1 bucket). Goal: close 3 independent issues without breaking existing behavior.

**Work Log:**
- **P2-9** (adaptive LightGBM fallback): Added `lightgbm_min_data_points_floor: int = 5` to `ForecastingConfig` and `config.yaml`. In `time_series.py::train()`, when `floor <= len(log_prices) < min_points (15)`, training now proceeds with maximally simplified features (`price_lags=[1]`, no volume/rolling/calendar) and lowered post-dropna minimum (2 instead of 10). Below `floor`, training still skips. Supports brand-new currencies with 5-9 daily points. +4 unit tests (one updated from old `test_lightgbm_still_skips_below_15`).
- **P2-6** (expose CB state): New Next.js route `GET /api/flipper/health/circuit-breakers` returns `{total, open_count, circuit_breakers: {path: EndpointCircuitBreaker}, timestamp}`. Calls existing `getAllEndpointCircuitBreakers()` from `flipper-proxy.ts`. Read-only. Original "double CB" framing marked obsolete in STATUS.md (per-endpoint CB replaced the global one in P1-10/iter 66). +3 jest tests.
- **P2-4** (extend `/flips` + deprecate scanner): Added 7 optional query params to `GET /api/v1/arbitrage/flips`: `max_score`, `min_spread`, `max_spread`, `cluster` (exact match), `currency` (case-insensitive substring on either side of pair), `sort_by` (score/spread/volume_24h/momentum/volatility), `sort_dir` (asc/desc). All have safe defaults → backward compatible. `routes_scanner.py` now emits `Deprecation: true`, `Sunset: Sun, 21 Jun 2026 00:00:00 GMT`, `Link: </api/v1/arbitrage/flips>; rel="successor-version"` headers + warning log on every call. **Scanner scheduled for deletion in iter 68.** +21 pytest tests (4 backward-compat, 7 filters, 6 sort, 2 combined, 2 deprecation-header verification).
- Verified: pytest **461 pass** (was 437 → +24 new tests), jest **302 pass** (was 299 → +3), tsc **0 errors**.
- Updated `STATUS.md` (P2=3, P3=4; new Quick Reference rows for LightGBM adaptive, CB inspection endpoint, /flips extended params), `AGENT_NAVIGATION.md` (new route entry, new config field, 2 new invariants #21 LightGBM adaptive, #22 Scanner deprecation), `REFACTOR_PLAN.md` (v31.0 — P2 reduced to 3, estimation 3-5 iters remaining).

**Stage Summary:**
- 3 issues closed: P2-9, P2-6, P2-4.
- ~9 files changed: 3 backend (config.py, routes_arbitrage.py, routes_scanner.py, predictors/time_series.py, config.yaml), 2 frontend (new CB route, flipper-proxy test), 1 new test file (test_flips_filters.py), 1 updated test (test_daily_stats_history.py), 3 docs (STATUS.md, AGENT_NAVIGATION.md, REFACTOR_PLAN.md).
- P0=0, P1=0, P2=3, P3=4. ~3-5 iterations remaining.
- Baseline: pytest **461 pass**, jest **302 pass**, tsc 0 errors.

**Stopping point:**
- Iter 67 done. P2 reduced from 5 → 3.
- Next iter (iter 68) recommended order:
  1. **Delete `routes_scanner.py`** (P2-4 follow-up) + remove `/api/v1/scanner` from `routes_batch.py:ALLOWED_PREFIXES` + regenerate `openapi_schema.json`/`api-types.ts`.
  2. **P2-8** (`proxyWithFallback` 5xx handling) — touches frontend error UX, medium risk.
  3. **P2-3** (`currency_names_ru.py` 966-line dict → JSON) — mechanical but long.
  4. **P2-1** (`dashboard-page.tsx` split) — multi-iter.
- Optional: P3-5 (full /flips integration test — partially covered by `test_flips_filters.py` now).
- Suggested commit messages: `fix(P2-9): adaptive lightgbm_min_data_points fallback`; `fix(P2-6): expose per-endpoint CB state via /api/flipper/health/circuit-breakers`; `refactor(P2-4): extend /flips with filter/sort params, deprecate /scanner`.

---

## Task 66 — 8 issues closed (P2-14, P2-5, P2-2, P1-5, P1-6, P1-9, P1-10, P3-2)
**Agent:** Main Agent
**Date:** 2026-06-21

**Stage Summary:**
- 8 issues closed. P1 bucket emptied (0 remaining).
- See git commit `a9386d2` for details.

---

## Task 65 — P2-13 (lazy/re-creatable process_pool)
**Agent:** Main Agent
**Date:** 2026-06-21

**Stage Summary:**
- Pool is now lazy/re-creatable via `get_process_pool()`; lifespan teardown clears the cached reference so the next caller gets a fresh pool. 5 call sites migrated. `test_triangular.py` now runs in full-suite mode (+7 tests).
