# REFACTOR_PLAN.md — Roadmap

> Version: 25.0 | Date: 2026-06-20 (iter 60 — P2-11 closed: orphan root files cleanup)
> Source: Full codebase audit (iter 52) + verification (iter 53) + iter 54-60 fixes. See `STATUS.md` for detailed issue descriptions.

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
- See STATUS.md §P1

### P2 — Medium (clean code) — 8 items
- See STATUS.md §P2 (P2-7 closed iter 59; P2-11 closed iter 60)

### P3 — Low priority (nice-to-have) — 6 items
- See STATUS.md §P3

## Recommended Fix Order (iter 61+)

Iter 60 (DONE):
9. **P2-11** (orphan root files cleanup) — DONE. `git rm` of 10 files. tsc 0 errors, jest 291/291 pass. Zero code changes.

Iter 61+ (next, in recommended order):
10. **P1-7** (EventManager async) — same area as P1-11 (closed iter 59). 5 sync methods (`create_event` / `delete_event` / `deactivate_event` / `_prune_expired_events` / `clear_all_events`) → async. Update all callers in `routes_events.py` (3 endpoints, add `await`) + tests (`test_events.py`, `test_lifecycle.py`, `test_routes_events_invalidation.py`). Naturally resolves P3-8 (deprecated `asyncio.get_event_loop()`).
11. **P1-4** through **P1-10** — see STATUS.md for dependencies.

## Estimation (rough, updated iter 60)

| Bucket | Issues remaining | Estimated iterations | Risk |
|--------|------------------|---------------------|------|
| P0 | 0 | 0 | — |
| P1 | 7 | 5-7 iterations | Medium — some touch core paths |
| P2 | 8 | 5-7 iterations | Low — mostly mechanical |
| P3 | 6 | 3-4 iterations | Low — non-blocking |

**Total:** ~13 iterations remaining to clean state. Each iteration = 1 commit, 1 STATUS.md update.

## Definition of Done (per issue)

- [ ] Code changed
- [ ] `pytest tests/ -v` passes (add regression test if applicable)
- [ ] `npm run test` passes
- [ ] `npx tsc --noEmit` passes
- [ ] `STATUS.md` — move issue to "Fixed" section with commit hash
- [ ] `worklog.md` — append entry with iteration number
- [ ] Commit message format: `<type>(P<n>-<id>): <short description>`
- [ ] If issue touches API contract — regenerate `openapi_schema.json` + `src/lib/api-types.ts`

## Fixed

### iter 60 — 1 issue closed
- **P2-11** (`fix(P2-11): remove 10 orphan root-level files from iter 58`) — `git rm` of 10 stale duplicate files committed to repo root by mistake in iter 58: `dashboard-page.tsx`, `events-sidebar.spec.ts`, `providers.tsx`, `route.ts`, `use-price-stream.ts`, `main.py`, `routes_sse.py`, `historical.py`, `test_lifecycle.py`, `test_optimal_currency.py`. All have canonical copies under `src/` / `backend/` / `tests/` / `e2e/`. Verified no source code imports the orphan root copies. Restored clean baseline: tsc 0 errors (was 2), jest 291 pass / 14 suites (was 13 + 1 failing). Backend pytest unchanged. Discovered pre-existing (not new) issue: `tests/test_triangular.py` fails 7 tests in full-suite mode but passes alone — test pollution, present at iter 59 baseline; documented in STATUS.md §Quick Reference, not blocking.

### iter 59 — 2 issues closed in one commit
- **P1-11 + P2-7** (`fix(P1-11+P2-7): daily_stats invalidation + targeted SSE invalidation`) — P1-11: `daily_stats_cache.invalidate()` after `pipeline_cache.invalidate()` in `routes_events.create_event`/`delete_event`/`deactivate_event`. 4 regression tests. P2-7: `invalidateCaches(pair)` drops over-eager `crossRates` invalidation, adds per-pair `benchmark` invalidation.

### iter 58 — 6 issues closed in one commit (WS removal)
- **P0-2 + P1-1 + P1-2 + P2-10 + P3-1 + P3-6** — Removed `backend/api/routes_ws.py` (722 lines), `src/hooks/use-websocket.ts` (548 lines), `src/app/api/flipper/ws/info/route.ts`. Real-time updates handled by SSE (P0-1) + REST polling.

### iter 57 — 1 P0 issue fixed
- **P0-5** (`refactor(P0-5): unified pricing helper + remove dead prices param`) — `backend/economy/pricing.py` with `compute_transitive_prices` + `find_price_24h_ago`. P1-3 closed as side effect.

### iter 56 — 1 P0 issue fixed
- **P0-6** (`fix(P0-6): remove chaos hardcode in triangular arbitrage`) — Single numeraire = `config.league.base_currency`.

### iter 55 — 1 P0 issue fixed
- **P0-1** (`fix(P0-1): SSE contract fix — remove dead monitor, add change_pct, align payload`) — Per-currency SSE events matching `SSEPriceUpdate`.

### iter 54 — 2 P0 issues fixed
- **P0-3 + P0-4** — `routes_analyst._compute_trends` 24h change + `PhaseDetector._reference_date` reset.
