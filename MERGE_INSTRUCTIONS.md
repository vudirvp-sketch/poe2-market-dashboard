# Iter 67 — Merge Instructions

## Summary

Closes **3 issues** in one iteration (P2 cleanup after iter 66 emptied P1 bucket):

- **P2-9** — Adaptive fallback for `lightgbm_min_data_points`. New config field `lightgbm_min_data_points_floor: int = 5`. When `floor <= len(log_prices) < min_points (15)`, training proceeds with minimal features (`price_lags=[1]`). +4 unit tests.
- **P2-6** — New Next.js route `GET /api/flipper/health/circuit-breakers` exposes the per-endpoint breaker Map as JSON. +3 jest tests.
- **P2-4** — Extended `GET /api/v1/arbitrage/flips` with 7 optional filter/sort params (`max_score`, `min_spread`, `max_spread`, `cluster`, `currency`, `sort_by`, `sort_dir`). All backward compatible. `routes_scanner.py` marked deprecated (emits `Deprecation`/`Sunset`/`Link` headers + warning log). Scheduled for deletion in iter 68. +21 pytest tests.

After iter 67, **P2 reduced from 5 → 3**.

- **~9** files changed/added (4 backend, 1 config.yaml, 1 new frontend route, 1 frontend test update, 1 new test file, 1 updated test file, 3 docs)
- **0** new Known Issues — all 3 candidates closed cleanly

## What's in this archive

```
iter67/
├── MERGE_INSTRUCTIONS.md                                          ← this file
├── STATUS.md                                                      ← updated (P2=3, P3=4; Quick Reference refreshed)
├── REFACTOR_PLAN.md                                               ← updated (v30 → v31)
├── AGENT_NAVIGATION.md                                            ← updated (P2-9/6/4 marked done; new CB route entry; 2 new invariants)
├── worklog.md                                                     ← updated (Task 67 entry; trimmed to ≤3 latest)
├── config.yaml                                                    ← new `forecasting.lightgbm_min_data_points_floor` field (P2-9)
├── backend/
│   ├── config.py                                                  ← P2-9: new `lightgbm_min_data_points_floor` Pydantic field
│   ├── api/
│   │   ├── routes_arbitrage.py                                    ← P2-4: extended /flips with 7 optional filter/sort params
│   │   └── routes_scanner.py                                      ← P2-4: marked deprecated (Deprecation/Sunset/Link headers + warning log)
│   └── predictors/
│       └── time_series.py                                         ← P2-9: adaptive LightGBM fallback (very_sparse_mode with price_lags=[1])
├── src/
│   ├── app/api/flipper/health/circuit-breakers/
│   │   └── route.ts                                               ← P2-6: NEW route — JSON snapshot of per-endpoint CB state
│   └── __tests__/
│       └── flipper-proxy.test.ts                                  ← P2-6: +3 tests for CB health snapshot serialization
└── tests/
    ├── test_flips_filters.py                                      ← P2-4: NEW test file — 21 tests (backward-compat, filters, sort, combined, deprecation headers)
    └── test_daily_stats_history.py                                ← P2-9: updated existing test + 3 new adaptive fallback tests
```

**Files DELETED:** none in this iter. (`routes_scanner.py` is **deprecated but not deleted** — scheduled for deletion in iter 68.)

## How to apply

Run from the root of your local `poe2-market-dashboard` checkout (must be on `main` branch, up-to-date with `origin/main` after iter 66 was merged). **NOTE:** if you have local iter 66 changes uncommitted, commit them first before applying iter 67.

```bash
# 1. Extract this archive into a temp location
#    Example (if iter67.zip is in ~/Downloads):
unzip ~/Downloads/iter67.zip -d /tmp/iter67

# 2. Copy the modified docs into the repo root
cp /tmp/iter67/iter67/STATUS.md             ./STATUS.md
cp /tmp/iter67/iter67/REFACTOR_PLAN.md      ./REFACTOR_PLAN.md
cp /tmp/iter67/iter67/AGENT_NAVIGATION.md   ./AGENT_NAVIGATION.md
cp /tmp/iter67/iter67/worklog.md            ./worklog.md
cp /tmp/iter67/iter67/MERGE_INSTRUCTIONS.md ./MERGE_INSTRUCTIONS.md
cp /tmp/iter67/iter67/config.yaml           ./config.yaml

# 3. Copy the modified backend files (preserving folder structure)
cp /tmp/iter67/iter67/backend/config.py                                ./backend/config.py
cp /tmp/iter67/iter67/backend/api/routes_arbitrage.py                  ./backend/api/routes_arbitrage.py
cp /tmp/iter67/iter67/backend/api/routes_scanner.py                    ./backend/api/routes_scanner.py
cp /tmp/iter67/iter67/backend/predictors/time_series.py                ./backend/predictors/time_series.py

# 4. Copy the NEW frontend route (creates a new directory)
mkdir -p ./src/app/api/flipper/health/circuit-breakers
cp /tmp/iter67/iter67/src/app/api/flipper/health/circuit-breakers/route.ts \
   ./src/app/api/flipper/health/circuit-breakers/route.ts

# 5. Copy the modified frontend test
cp /tmp/iter67/iter67/src/__tests__/flipper-proxy.test.ts              ./src/__tests__/flipper-proxy.test.ts

# 6. Copy the modified/new test files
cp /tmp/iter67/iter67/tests/test_flips_filters.py                      ./tests/test_flips_filters.py
cp /tmp/iter67/iter67/tests/test_daily_stats_history.py                ./tests/test_daily_stats_history.py

# 7. Verify (with aiosqlite + lightgbm installed)
pip install aiosqlite lightgbm                                          # if not already installed
npx tsc --noEmit                                                       # should print nothing (0 errors)
npx jest                                                               # should report 302 pass / 14 suites
pytest tests/ -q --ignore=tests/e2e                                    # should report 461 pass
pytest tests/e2e/ -q -m "not flaky"                                    # should report 30 pass
git status                                                             # should show ~9 modified + 2 new files

# 8. Commit + push (suggested: one commit per issue for granular history)
# Option A — single squashed commit:
git add -A
git commit -m "iter67: close P2-9, P2-6, P2-4 (LightGBM adaptive fallback, CB state endpoint, /flips extended + scanner deprecated)"
git push origin main

# Option B — one commit per issue (preserves granular history — see "Git commands" section)
```

## Verification (already done in agent environment)

| Check | Before iter 67 | After iter 67 |
|------|----------------|---------------|
| `pytest tests/test_daily_stats_history.py::TestLightGBMReducedData -q` | 4 pass (one test was `test_lightgbm_still_skips_below_15`) | **7 pass** (+3 P2-9 adaptive tests, 1 renamed) ✓ |
| `pytest tests/test_flips_filters.py -q` | (file did not exist) | **21 pass** (NEW — P2-4) ✓ |
| `npx jest src/__tests__/flipper-proxy.test.ts` | 36 pass | **39 pass** (+3 P2-6) ✓ |
| `pytest tests/ -q --ignore=tests/e2e` | 437 pass | **461 pass** (+24: 21 P2-4 + 3 P2-9) ✓ |
| `pytest tests/e2e/ -q -m "not flaky"` | 30 pass | **30 pass** (no regressions) ✓ |
| `npx tsc --noEmit` | 0 errors | **0 errors** ✓ |
| `npx jest` | 299 pass / 14 suites | **302 pass / 14 suites** (+3 P2-6) ✓ |

## Stop point — next iteration (iter 68)

After iter 67: **P0=0, P1=0, P2=3, P3=4.** ~3-5 iterations remaining.

Recommended candidates (per REFACTOR_PLAN.md v31):

1. **Delete `routes_scanner.py`** (P2-4 follow-up) — remove `/api/v1/scanner` from `routes_batch.py:ALLOWED_PREFIXES`, remove `ScannerResponse` from `response_models.py`, regenerate `openapi_schema.json` + `api-types.ts`.
2. **P2-8** (`proxyWithFallback` swallows ALL 5xx → 200) — touches frontend error UX.
3. **P2-3** (`currency_names_ru.py` 966-line hardcoded dict → JSON) — medium, mechanical.
4. **P2-1** (`dashboard-page.tsx` 1705-line god-component → split) — large, multi-iter.

Suggested commit for iter 68: `refactor(P2-4): delete deprecated routes_scanner.py`

**Issue counts after iter 67:** P0=0, P1=0, P2=3, P3=4. ~3-5 iterations remaining.

## Git commands (one commit per issue, optional granular history)

```bash
# After copying all files from the archive (steps 2-6 above), commit each issue separately:

# P2-9: adaptive LightGBM fallback
git add backend/config.py backend/predictors/time_series.py config.yaml tests/test_daily_stats_history.py
git commit -m "fix(P2-9): adaptive lightgbm_min_data_points fallback

When floor (5) <= len(log_prices) < min_points (15), training proceeds
with minimal features (price_lags=[1] only) and lowered post-dropna
minimum (2 instead of 10). Below floor, training is skipped (unchanged).

New config field: ForecastingConfig.lightgbm_min_data_points_floor (default 5).
+4 unit tests (1 renamed from test_lightgbm_still_skips_below_15)."

# P2-6: expose per-endpoint CB state
git add src/app/api/flipper/health/circuit-breakers/route.ts src/__tests__/flipper-proxy.test.ts
git commit -m "fix(P2-6): expose per-endpoint CB state via /api/flipper/health/circuit-breakers

New Next.js route returns JSON snapshot: {total, open_count, circuit_breakers, timestamp}.
Calls existing getAllEndpointCircuitBreakers() from flipper-proxy.ts (read-only).
Original 'double CB' framing obsolete since P1-10 (iter 66) unified the frontend
breaker to be per-endpoint. +3 jest tests."

# P2-4: extend /flips + deprecate scanner
git add backend/api/routes_arbitrage.py backend/api/routes_scanner.py tests/test_flips_filters.py
git commit -m "refactor(P2-4): extend /flips with filter/sort params, deprecate /scanner

GET /api/v1/arbitrage/flips now accepts 7 new optional params:
  max_score, min_spread, max_spread, cluster, currency, sort_by, sort_dir
All have safe defaults → backward compatible.

routes_scanner.py is now DEPRECATED: emits Deprecation/Sunset/Link headers
+ warning log on every call. Scheduled for deletion in iter 68.

+21 pytest tests: 4 backward-compat, 7 filters, 6 sort, 2 combined,
2 deprecation-header verification."

# Docs (separate commit, or fold into the issue commits above)
git add STATUS.md REFACTOR_PLAN.md AGENT_NAVIGATION.md worklog.md MERGE_INSTRUCTIONS.md
git commit -m "docs(iter67): update STATUS/REFACTOR_PLAN/AGENT_NAVIGATION/worklog/MERGE_INSTRUCTIONS

P2 reduced 5 → 3. P3 unchanged at 4.
- STATUS.md: Quick Reference refreshed (LightGBM adaptive, CB inspection, /flips params)
- REFACTOR_PLAN.md: v30 → v31, estimation 3-5 iters remaining
- AGENT_NAVIGATION.md: 2 new invariants (#21 LightGBM adaptive, #22 Scanner deprecation)
- worklog.md: Task 67 entry, trimmed to ≤3 latest"

# Push all commits
git push origin main
```
