# REFACTOR_PLAN.md — Roadmap

> Version: 19.0 | Date: 2026-06-20 (iter 54 — P0-3, P0-4 fixed)
> Source: Full codebase audit (iter 52) + verification (iter 53) + iter 54 fixes. See `STATUS.md` for detailed issue descriptions.

## Principles

1. **One issue per commit.** Reference `STATUS.md` issue ID (e.g. `fix(P0-3): analyst 24h change`).
2. **Document first, fix second.** Any new bug found → add to `STATUS.md` before fixing.
3. **No big-bang refactors.** Each iteration = 1-3 issues from one priority bucket.
4. **Test after every fix.** `pytest tests/ -v` + `npm run test` + `npx tsc --noEmit`.
5. **Update docs in same commit.** `STATUS.md`, `AGENT_NAVIGATION.md`, `worklog.md` if needed.

## Priority Buckets

### P0 — Critical (correctness, stability) — 4 remaining (P0-1, P0-2, P0-5, P0-6)
- P0-1. SSE — remove dead monitor, fix contract mismatch, implement real `change_pct` filtering
- P0-2. WebSocket — offload `_compute_anomalies` / `_compute_flips` to ProcessPoolExecutor
- P0-5. Transitive prices — extract BFS to shared helper, use in `data_snapshot.py` + `scheduler.py` + `routes_arbitrage.py`
- P0-6. Triangular — remove `prices["chaos"] = 1.0` and `Chaos Orb` hardcode, use `base` as numeraire

### P1 — Serious (performance, maintainability)
- P1-1. WS endpoints — extract computation to shared services OR delete WS endpoints entirely
- P1-2. `useFlipperWebSocket` — single connection or polling
- P1-3. `_compute_transitive_prices` — adjacency list (after P0-5 helper exists)
- P1-4. Clustering cache — single key + helper
- P1-5. `compute_quantized_analysis` — binary search
- P1-6. HistoricalStore — chunked delete
- P1-7. EventManager — make `create_event` async, `await write_event`
- P1-8. Bellman-Ford — proper negative cycle detection (extra relaxation pass)
- P1-9. Spread model — extract constants to `config.yaml:scoring.spread_model.*`
- P1-10. Flipper-proxy — per-endpoint circuit breaker
- P1-11. (NEW) `routes_events.create_event` — also invalidate `daily_stats` namespace

### P2 — Medium (clean code)
- P2-1. dashboard-page.tsx — split god-component (1705 lines)
- P2-2. Remove pipeline_cache.py / daily_stats_cache.py shims (23 lines each)
- P2-3. Move currency_names_ru (966 lines) to JSON
- P2-4. Consolidate /scanner into /flips
- P2-5. Clean up routes_auth.py comment in main.py:516
- P2-6. Sync frontend/backend circuit breaker state
- P2-7. usePriceStream — targeted invalidation (depends on P0-1)
- P2-8. proxyWithFallback — pass-through in dev, mark fallback in prod
- P2-9. Forecasting — adaptive fallback instead of `lightgbm_min_data_points: 15`
- P2-10. Unify WS path prefix to `/api/v1/ws/*`
- P2-11. (NEW) Add tests for SSE, WS, /analyst/summary, /optimizer/* endpoints

### P3 — Low priority (nice-to-have)
- See STATUS.md §P3 (8 items: P3-1 through P3-8)

## Recommended Fix Order (iter 54+)

Iter 54 (DONE — see "Fixed" section below):
1. **P0-3** (analyst 24h change) — DONE. Used `_find_price_24h_ago` from `routes_arbitrage.py`. Added `tests/e2e/test_analyst.py` (4 tests). Commit: `fix(P0-3): use _find_price_24h_ago for analyst 24h change`.
2. **P0-4** (PhaseDetector reset) — DONE. Replaced `max()` with unconditional `patch_reset_date`. Replaced `test_patch_date_before_league_start_ignored` with `test_major_patch_resets_even_if_before_league_start`. Commit: `fix(P0-4): PhaseDetector respects major_patch unconditionally`.

Iter 55 (next):
3. **P0-1** (SSE) — bigger scope (delete dead monitor, redesign generator, fix frontend contract). Split into 2 commits if needed: (a) backend `change_pct` + threshold filtering, (b) frontend contract alignment.

Iter 56:
4. **P0-6** (triangular hardcode) — small, isolated to `routes_arbitrage.py:769-770`.

Iter 57:
5. **P0-5** (transitive prices helper) — extract `compute_transitive_prices` to `backend/economy/pricing.py`, swap 3 call sites. After this, P1-3 is a 1-commit follow-up. **Also** extract `_find_price_24h_ago` to the same helper (P0-3 left a TODO).

Iter 58:
6. **P0-2** (WS executor offload) — depends on decision: keep WS (apply executor fix) or delete WS (depends on P1-1).

Iter 59+:
7. P1-11 (daily_stats invalidation) — 2-line fix, can be batched with P1-7 (EventManager async).
8. P1-1 through P1-10 — see STATUS.md for dependencies.

## Estimation (rough, updated iter 54)

| Bucket | Issues remaining | Estimated iterations | Risk |
|--------|------------------|---------------------|------|
| P0 | 4 (P0-1, P0-2, P0-5, P0-6) | 4-5 iterations | Low — small scope, well-defined |
| P1 | 11 | 9-11 iterations | Medium — some touch core paths |
| P2 | 11 | 7-9 iterations | Low — mostly mechanical |
| P3 | 8 | 3-5 iterations | Low — non-blocking |

**Total:** ~26 iterations remaining to clean state. Each iteration = 1 commit, 1 STATUS.md update.

## Definition of Done (per issue)

- [ ] Code changed
- [ ] `pytest tests/ -v` passes (add regression test if applicable — see P2-11)
- [ ] `npm run test` passes
- [ ] `npx tsc --noEmit` passes
- [ ] `STATUS.md` — move issue to "Fixed" section with commit hash
- [ ] `worklog.md` — append entry with iteration number
- [ ] Commit message format: `<type>(P<n>-<id>): <short description>`
- [ ] If issue touches API contract — regenerate `openapi_schema.json` + `src/lib/api-types.ts`

## Fixed

### iter 54 — 2 P0 issues fixed
- **P0-3** (`fix(P0-3): use _find_price_24h_ago for analyst 24h change`) — `routes_analyst._compute_trends` now uses timestamp-aware 24h-ago lookup. 4 tests in `tests/e2e/test_analyst.py`. Backend: 386 pass / 4 skip. Frontend: 291 pass. tsc: clean.
- **P0-4** (`fix(P0-4): PhaseDetector respects major_patch unconditionally`) — `lifecycle._reference_date` no longer uses `max()`. Regression test `test_major_patch_resets_even_if_before_league_start` replaces the buggy-behavior test. All 15 lifecycle tests pass.
