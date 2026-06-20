# Iter 65 — Merge Instructions

## Summary

Closes **P2-13** (process_pool test pollution). The FastAPI `lifespan` shutdown handler used to call `process_pool.shutdown(...)` on a module-level singleton, permanently breaking the global pool. Any later test in the same pytest session that called `loop.run_in_executor(process_pool, ...)` failed with `RuntimeError: cannot schedule new futures after shutdown`. This is why `test_triangular.py` was excluded from the full-suite baseline.

- **6** code files changed (`backend/main.py` + 5 call sites migrated to `get_process_pool()`)
- **4** documentation files updated (`STATUS.md`, `REFACTOR_PLAN.md`, `AGENT_NAVIGATION.md`, `worklog.md`, `MERGE_INSTRUCTIONS.md`)
- **1** new Known Issue documented: **P2-14** (test_compression.py imports `_check_brotli_available` / `_CompressionResponder` that no longer exist in `middleware_compression.py` — previously mis-diagnosed as a brotli env issue)
- **0** test files changed — the regression guard is the existing `test_triangular.py` running in full-suite mode (was excluded before, now passes)

## What's in this archive

```
iter65/
├── MERGE_INSTRUCTIONS.md                          ← this file
├── STATUS.md                                      ← updated (iter 65 — P2-13 closed; P2-14 added; Quick Reference refreshed)
├── REFACTOR_PLAN.md                               ← updated (v28 → v29)
├── AGENT_NAVIGATION.md                            ← updated (rule 20 added; P2-13 marked fixed; P2-14 row added)
├── worklog.md                                     ← updated (Task 65 entry; trimmed to ≤3 latest)
└── backend/
    ├── main.py                                    ← lazy/re-creatable pool: `_process_pool` + `get_process_pool()` + `_shutdown_process_pool()` + `__getattr__` shim
    ├── arbitrage/
    │   └── triangular.py                          ← `from backend.main import get_process_pool`
    └── api/
        ├── routes_arbitrage.py                    ← `from backend.main import get_process_pool`
        ├── routes_portfolio.py                    ← `from backend.main import get_process_pool`
        ├── routes_prices.py                       ← `from backend.main import get_process_pool`
        └── routes_anomalies.py                    ← `from backend.main import get_process_pool`
```

## How to apply

Run from the root of your local `poe2-market-dashboard` checkout (must be on `main` branch, up-to-date with `origin/main`). **NOTE:** if you have local iter 64 changes (P1-8) uncommitted, commit them first before applying iter 65.

```bash
# 1. Extract this archive into a temp location
#    Example (if iter65.zip is in ~/Downloads):
unzip ~/Downloads/iter65.zip -d /tmp/iter65

# 2. Copy the modified docs into the repo root
cp /tmp/iter65/iter65/STATUS.md             ./STATUS.md
cp /tmp/iter65/iter65/REFACTOR_PLAN.md      ./REFACTOR_PLAN.md
cp /tmp/iter65/iter65/AGENT_NAVIGATION.md   ./AGENT_NAVIGATION.md
cp /tmp/iter65/iter65/worklog.md            ./worklog.md
cp /tmp/iter65/iter65/MERGE_INSTRUCTIONS.md ./MERGE_INSTRUCTIONS.md

# 3. Copy the 6 modified backend files (preserving folder structure)
cp /tmp/iter65/iter65/backend/main.py                       ./backend/main.py
cp /tmp/iter65/iter65/backend/arbitrage/triangular.py       ./backend/arbitrage/triangular.py
cp /tmp/iter65/iter65/backend/api/routes_arbitrage.py       ./backend/api/routes_arbitrage.py
cp /tmp/iter65/iter65/backend/api/routes_portfolio.py       ./backend/api/routes_portfolio.py
cp /tmp/iter65/iter65/backend/api/routes_prices.py          ./backend/api/routes_prices.py
cp /tmp/iter65/iter65/backend/api/routes_anomalies.py       ./backend/api/routes_anomalies.py

# 4. Verify
npx tsc --noEmit                                                  # should print nothing (0 errors)
npx jest                                                          # should report 291 pass / 14 suites
pytest tests/test_routes_events_invalidation.py tests/test_triangular.py -q   # should be 11/11 pass (was 4/11 before fix)
pytest tests/ -q --ignore=tests/test_compression.py               # should be 405 pass (with aiosqlite: 418 pass)
git status                                                        # should show 5 modified docs + 6 modified backend files

# 5. Commit + push
git add -A
git commit -m "fix(P2-13): lazy/re-creatable process_pool to survive TestClient lifespan teardown"
git push origin main
```

## Verification (already done in agent environment)

| Check | Before iter 65 | After iter 65 |
|------|----------------|---------------|
| `pytest tests/test_routes_events_invalidation.py tests/test_triangular.py -q` | 4 pass / 7 fail (`RuntimeError: cannot schedule new futures after shutdown`) | **11 pass / 0 fail** ✓ |
| `pytest tests/ -q --ignore=tests/test_compression.py` (env: with aiosqlite) | 411 pass (test_triangular excluded by pollution) | **418 pass** (+7) ✓ |
| `pytest tests/ -q --ignore=tests/test_compression.py` (env: no aiosqlite) | 398 pass (baseline) | **405 pass** (+7) ✓ |
| `npx tsc --noEmit` | 0 errors | **0 errors** ✓ |
| `npx jest` | 291 pass / 14 suites | **291 pass / 14 suites** ✓ |

Pre-existing `test_compression.py` failures (11) are now correctly attributed to **P2-14** (test/code mismatch — not a brotli env issue as previously thought) — see STATUS.md §P2-14.

## Stop point — next iteration (iter 66)

Recommended candidates (per REFACTOR_PLAN.md v29):

1. **P2-14** (test_compression.py rewrite) — Quick win: test references `_check_brotli_available` / `_CompressionResponder` that no longer exist in `middleware_compression.py` (only 65 lines, single `CompressionMiddleware` class). Rewrite test against the current API. Same test-only scope as P2-13.
2. **P2-5** (delete dead `routes_auth.py` comment in `main.py:516-519`) — Trivial cleanup.
3. **P2-2** (delete `pipeline_cache.py` / `daily_stats_cache.py` shim modules) — Small but needs import audit.

Suggested commit for iter 66: `test(P2-14): rewrite test_compression.py against current CompressionMiddleware API`

**Issue counts after iter 65:** P1=4, P2=9 (closed P2-13, added P2-14), P3=5. ~9-13 iterations remaining.
