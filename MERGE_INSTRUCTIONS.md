# Iter 66 — Merge Instructions

## Summary

Closes **8 issues** in one iteration (user pushed back on "1-3 issues per iter" pace; this iter demonstrates that 8 independent issues can be safely closed when most are quick wins or test-only scope):

- **P2-14** — Rewrote `tests/test_compression.py` against current `CompressionMiddleware` API (10 tests).
- **P2-5** — Deleted 4-line dead `routes_auth.py` comment in `backend/main.py`.
- **P2-2** — Deleted `pipeline_cache.py` / `daily_stats_cache.py` shim modules; updated 8 backend + 4 test imports.
- **P1-5** — Bounded linear scan in `compute_quantized_analysis` (O(1/D) instead of O(10000)). 9 new regression tests.
- **P1-6 + P3-2** — Chunked delete in `HistoricalStore._prune_old_league_data` and `_prune_old_records`.
- **P1-9** — Moved 11 spread-model magic numbers from `routes_arbitrage.py` to `config.yaml:scoring.spread_model`.
- **P1-10** — Per-endpoint circuit breaker in `flipper-proxy.ts` (replaces global breaker). 8 new tests.

After iter 66, **P1 bucket is empty (0 remaining)**.

- **~17** code files changed (8 backend, 4 test, 1 frontend lib, 1 frontend test, 1 config, 2 docs)
- **4** doc files updated (`STATUS.md`, `REFACTOR_PLAN.md`, `AGENT_NAVIGATION.md`, `worklog.md`, `MERGE_INSTRUCTIONS.md`)
- **0** new Known Issues — all 8 candidates closed cleanly

## What's in this archive

```
iter66/
├── MERGE_INSTRUCTIONS.md                              ← this file
├── STATUS.md                                          ← updated (P1=0, P2=5, P3=3; Quick Reference refreshed)
├── REFACTOR_PLAN.md                                   ← updated (v29 → v30)
├── AGENT_NAVIGATION.md                                ← updated (P1-5/6/9/10, P2-2/5/14, P3-2 marked fixed; shim rows removed)
├── worklog.md                                         ← updated (Task 66 entry; trimmed to ≤3 latest)
├── config.yaml                                        ← new `scoring.spread_model` section (P1-9)
├── backend/
│   ├── main.py                                        ← P2-5: dead routes_auth comment deleted
│   ├── config.py                                      ← P1-9: new SpreadModelConfig Pydantic model
│   ├── arbitrage/
│   │   └── scorer.py                                  ← P1-5: bounded linear scan + docstring
│   ├── data/
│   │   └── historical.py                              ← P1-6 + P3-2: chunked delete (rowid IN ... LIMIT pattern)
│   └── api/
│       ├── routes_arbitrage.py                        ← P1-9: read spread_model from config; P2-2: import from unified_cache
│       ├── routes_analyst.py                          ← P2-2: import from unified_cache
│       ├── routes_anomalies.py                        ← P2-2: import from unified_cache
│       ├── routes_events.py                           ← P2-2: import from unified_cache
│       ├── routes_optimizer.py                        ← P2-2: import from unified_cache
│       ├── routes_portfolio.py                        ← P2-2: import from unified_cache
│       ├── routes_prices.py                           ← P2-2: import from unified_cache
│       └── routes_scanner.py                          ← P2-2: import from unified_cache
├── src/
│   ├── lib/
│   │   └── flipper-proxy.ts                           ← P1-10: per-endpoint circuit breaker (Map<path, EndpointCircuitBreaker>)
│   └── __tests__/
│       └── flipper-proxy.test.ts                      ← P1-10: 8 new tests for per-endpoint CB
└── tests/
    ├── test_compression.py                            ← P2-14: rewritten from scratch (10 tests, was 11 failing)
    ├── test_scorer.py                                 ← P1-5: 9 new TestQuantizedAnalysisP1_5 tests
    ├── test_pipeline_cache_degraded.py                ← P2-2: import from unified_cache; caplog logger name updated
    ├── test_daily_stats_history.py                    ← P2-2: import from unified_cache
    └── e2e/
        ├── conftest.py                                ← P2-2: import from unified_cache
        └── test_degraded_mode.py                      ← P2-2: import from unified_cache
```

**Files DELETED (not in archive — delete from local repo):**
- `backend/data/pipeline_cache.py` (23-line shim, P2-2)
- `backend/data/daily_stats_cache.py` (23-line shim, P2-2)

## How to apply

Run from the root of your local `poe2-market-dashboard` checkout (must be on `main` branch, up-to-date with `origin/main`). **NOTE:** if you have local iter 65 changes (P2-13) uncommitted, commit them first before applying iter 66.

```bash
# 1. Extract this archive into a temp location
#    Example (if iter66.zip is in ~/Downloads):
unzip ~/Downloads/iter66.zip -d /tmp/iter66

# 2. Copy the modified docs into the repo root
cp /tmp/iter66/iter66/STATUS.md             ./STATUS.md
cp /tmp/iter66/iter66/REFACTOR_PLAN.md      ./REFACTOR_PLAN.md
cp /tmp/iter66/iter66/AGENT_NAVIGATION.md   ./AGENT_NAVIGATION.md
cp /tmp/iter66/iter66/worklog.md            ./worklog.md
cp /tmp/iter66/iter66/MERGE_INSTRUCTIONS.md ./MERGE_INSTRUCTIONS.md
cp /tmp/iter66/iter66/config.yaml           ./config.yaml

# 3. Copy the modified backend files (preserving folder structure)
cp /tmp/iter66/iter66/backend/main.py                       ./backend/main.py
cp /tmp/iter66/iter66/backend/config.py                     ./backend/config.py
cp /tmp/iter66/iter66/backend/arbitrage/scorer.py           ./backend/arbitrage/scorer.py
cp /tmp/iter66/iter66/backend/data/historical.py            ./backend/data/historical.py
cp /tmp/iter66/iter66/backend/api/routes_arbitrage.py       ./backend/api/routes_arbitrage.py
cp /tmp/iter66/iter66/backend/api/routes_analyst.py         ./backend/api/routes_analyst.py
cp /tmp/iter66/iter66/backend/api/routes_anomalies.py       ./backend/api/routes_anomalies.py
cp /tmp/iter66/iter66/backend/api/routes_events.py          ./backend/api/routes_events.py
cp /tmp/iter66/iter66/backend/api/routes_optimizer.py       ./backend/api/routes_optimizer.py
cp /tmp/iter66/iter66/backend/api/routes_portfolio.py       ./backend/api/routes_portfolio.py
cp /tmp/iter66/iter66/backend/api/routes_prices.py          ./backend/api/routes_prices.py
cp /tmp/iter66/iter66/backend/api/routes_scanner.py         ./backend/api/routes_scanner.py

# 4. DELETE the two shim modules (P2-2)
rm ./backend/data/pipeline_cache.py
rm ./backend/data/daily_stats_cache.py

# 5. Copy the modified frontend files
cp /tmp/iter66/iter66/src/lib/flipper-proxy.ts              ./src/lib/flipper-proxy.ts
cp /tmp/iter66/iter66/src/__tests__/flipper-proxy.test.ts   ./src/__tests__/flipper-proxy.test.ts

# 6. Copy the modified test files
cp /tmp/iter66/iter66/tests/test_compression.py             ./tests/test_compression.py
cp /tmp/iter66/iter66/tests/test_scorer.py                  ./tests/test_scorer.py
cp /tmp/iter66/iter66/tests/test_pipeline_cache_degraded.py ./tests/test_pipeline_cache_degraded.py
cp /tmp/iter66/iter66/tests/test_daily_stats_history.py     ./tests/test_daily_stats_history.py
cp /tmp/iter66/iter66/tests/e2e/conftest.py                 ./tests/e2e/conftest.py
cp /tmp/iter66/iter66/tests/e2e/test_degraded_mode.py       ./tests/e2e/test_degraded_mode.py

# 7. Verify (with aiosqlite + brotli installed)
pip install aiosqlite brotli                                   # if not already installed
npx tsc --noEmit                                              # should print nothing (0 errors)
npx jest                                                      # should report 299 pass / 14 suites
pytest tests/ -q                                              # should report 437 pass
git status                                                    # should show ~17 modified + 2 deleted files

# 8. Commit + push (suggested: one commit per issue, or one squashed commit)
# Option A — single squashed commit (recommended for 8-issue iter):
git add -A
git commit -m "iter66: close P2-14, P2-5, P2-2, P1-5, P1-6, P1-9, P1-10, P3-2 (P1 bucket empty)"
git push origin main

# Option B — one commit per issue (preserves granular history):
# (See "Git commands" section at the bottom of this file)
```

## Verification (already done in agent environment)

| Check | Before iter 66 | After iter 66 |
|------|----------------|---------------|
| `pytest tests/test_compression.py -q` | 2 pass / 11 fail (ImportError + assertion) | **10 pass / 0 fail** ✓ |
| `pytest tests/test_scorer.py -q` | 13 pass | **22 pass** (+9 P1-5 regression tests) ✓ |
| `pytest tests/ -q` (env: with aiosqlite + brotli) | 418 pass (test_compression excluded) | **437 pass** (+19 new tests) ✓ |
| `npx tsc --noEmit` | 0 errors | **0 errors** ✓ |
| `npx jest` | 291 pass / 14 suites | **299 pass / 14 suites** (+8 P1-10 tests) ✓ |

## Stop point — next iteration (iter 67)

After iter 66: **P1=0** 🎉, P2=5, P3=3. ~4-7 iterations remaining.

Recommended candidates (per REFACTOR_PLAN.md v30):

1. **P2-9** (`lightgbm_min_data_points: 15` → adaptive fallback) — small, isolated.
2. **P2-4** (`routes_scanner.py` duplicates `/flips`) — extend `/flips` query params or delete scanner.
3. **P2-6** (double CB not synchronized → expose CB status in `/health`) — small, mechanical (now that P1-10 gives us per-endpoint CB state to expose).
4. **P2-8** (`proxyWithFallback` swallows ALL 5xx → 200) — touches frontend error UX.
5. **P2-3** (`currency_names_ru.py` 966-line hardcoded dict → JSON) — medium, mechanical.
6. **P2-1** (`dashboard-page.tsx` 1705-line god-component → split) — large, multi-iter.

Suggested commit for iter 67: `fix(P2-9): adaptive lightgbm_min_data_points fallback`

**Issue counts after iter 66:** P1=0 (empty!), P2=5, P3=3. ~4-7 iterations remaining.
