# REFACTOR_PLAN.md — Roadmap

> Version: 24.0 | Date: 2026-06-20 (iter 59 — P1-11 + P2-7 closed; P2-11 added)
> Source: Full codebase audit (iter 52) + verification (iter 53) + iter 54-59 fixes. See `STATUS.md` for detailed issue descriptions.

## Principles

1. **One issue per commit.** Reference `STATUS.md` issue ID (e.g. `fix(P0-1): SSE contract fix`).
2. **Document first, fix second.** Any new bug found → add to `STATUS.md` before fixing.
3. **No big-bang refactors.** Each iteration = 1-3 issues from one priority bucket.
4. **Test after every fix.** `pytest tests/ -v` + `npm run test` + `npx tsc --noEmit`.
5. **Update docs in same commit.** `STATUS.md`, `AGENT_NAVIGATION.md`, `worklog.md` if needed.

## Priority Buckets

### P0 — Critical (correctness, stability) — 0 remaining
All P0 issues resolved in iter 54-58.

### P1 — Serious (performance, maintainability) — 7 items
- See STATUS.md §P1 (P1-11 closed iter 59)

### P2 — Medium (clean code) — 9 items
- See STATUS.md §P2 (P2-7 closed iter 59; P2-11 ADDED iter 59 — orphan root files)

### P3 — Low priority (nice-to-have) — 6 items
- See STATUS.md §P3

## Recommended Fix Order (iter 60+)

Iter 59 (DONE):
7. **P1-11** (daily_stats invalidation) — DONE. 2-line `daily_stats_cache.invalidate()` added after `pipeline_cache.invalidate()` in create/delete/deactivate endpoints. 4 regression tests in `tests/test_routes_events_invalidation.py`.
8. **P2-7** (targeted invalidation by pair) — DONE. `invalidateCaches(pair)` drops over-eager `crossRates` invalidation, adds per-pair `benchmark` invalidation.

Iter 60+ (next, in recommended order):
9. **P2-11** (orphan root files cleanup) — **RECOMMENDED FIRST**. Quick `git rm` of 10 files. Restores "tsc: clean" + "jest: clean" baseline. Zero code changes. ~10 min.
10. **P1-7** (EventManager async) — `EventManager.create_event` already touched by P1-11 (same area). Batch with P1-11 follow-up if convenient.
11. **P1-4** through **P1-10** — see STATUS.md for dependencies.

## Estimation (rough, updated iter 59)

| Bucket | Issues remaining | Estimated iterations | Risk |
|--------|------------------|---------------------|------|
| P0 | 0 | 0 | — |
| P1 | 7 | 5-7 iterations | Medium — some touch core paths |
| P2 | 9 | 6-8 iterations | Low — mostly mechanical (P2-11 is 10-min git rm) |
| P3 | 6 | 3-4 iterations | Low — non-blocking |

**Total:** ~14 iterations remaining to clean state. Each iteration = 1 commit, 1 STATUS.md update.

## Definition of Done (per issue)

- [ ] Code changed
- [ ] `pytest tests/ -v` passes (add regression test if applicable)
- [ ] `npm run test` passes
- [ ] `npx tsc --noEmit` passes (NOTE: blocked by P2-11 until iter 60)
- [ ] `STATUS.md` — move issue to "Fixed" section with commit hash
- [ ] `worklog.md` — append entry with iteration number
- [ ] Commit message format: `<type>(P<n>-<id>): <short description>`
- [ ] If issue touches API contract — regenerate `openapi_schema.json` + `src/lib/api-types.ts`

## Fixed

### iter 59 — 2 issues closed in one commit
- **P1-11 + P2-7** (`fix(P1-11+P2-7): daily_stats invalidation + targeted SSE invalidation`) — P1-11: added `daily_stats_cache.invalidate()` after `pipeline_cache.invalidate()` in `routes_events.create_event`/`delete_event`/`deactivate_event`. 4 new regression tests in `tests/test_routes_events_invalidation.py`. P2-7: `usePriceStream.invalidateCaches(pair)` drops over-eager `crossRates` invalidation (derived from POE2 exchange pairs, not flipper prices), adds per-pair `benchmark` invalidation using the `pair` field from P0-1 SSE contract. Backend tests: 4 new pass (375 → 379 pass / 4 skip). Jest: 291 pass. tsc: 2 pre-existing errors (P2-11). **New Known Issue P2-11 discovered**: 10 orphan root-level files from iter 58 cause the 2 tsc errors + 1 jest failure — documented, deferred to iter 60.

### iter 58 — 6 issues closed in one commit (WS removal)
- **P0-2 + P1-1 + P1-2 + P2-10 + P3-1 + P3-6** — Deleted `backend/api/routes_ws.py` (722 lines, 5 WS endpoints), `src/hooks/use-websocket.ts` (548 lines), `src/app/api/flipper/ws/info/route.ts`. Removed WS router from `main.py`. Removed `wsStatus` prop + WS badge UI from 3 components. Removed WS env vars from `.env.example`, `start.sh`, `start.bat`. Real-time updates now handled exclusively by SSE (P0-1, iter 55) + REST polling.

### iter 57 — 1 P0 issue fixed
- **P0-5** (`refactor(P0-5): unified pricing helper + remove dead prices param`) — Created `backend/economy/pricing.py` with `compute_transitive_prices` (BFS) + `find_price_24h_ago`. P1-3 also closed as side effect. 15 new tests in `tests/test_pricing.py`.

### iter 56 — 1 P0 issue fixed
- **P0-6** (`fix(P0-6): remove chaos hardcode in triangular arbitrage`) — Removed chaos-normalization + hardcode block from `routes_arbitrage.py`. Single numeraire = `config.league.base_currency`.

### iter 55 — 1 P0 issue fixed
- **P0-1** (`fix(P0-1): SSE contract fix — remove dead monitor, add change_pct, align payload`) — Removed dead `_sse_monitor_loop`. Rewrote `_sse_event_generator` to emit per-currency events matching frontend `SSEPriceUpdate`. 4 tests in `tests/e2e/test_sse.py`.

### iter 54 — 2 P0 issues fixed
- **P0-3** (`fix(P0-3): use _find_price_24h_ago for analyst 24h change`) — timestamp-aware 24h-ago lookup. 4 tests in `tests/e2e/test_analyst.py`.
- **P0-4** (`fix(P0-4): PhaseDetector respects major_patch unconditionally`) — `patch_reset_date` without `max()`. Regression test in `tests/test_lifecycle.py`.
