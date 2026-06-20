# REFACTOR_PLAN.md — Roadmap

> Version: 26.0 | Date: 2026-06-20 (iter 61 — P1-7 closed: EventManager async; P3-8 closed as side effect)
> Source: Full codebase audit (iter 52) + verification (iter 53) + iter 54-61 fixes. See `STATUS.md` for detailed issue descriptions.

## Principles

1. **One issue per commit.** Reference `STATUS.md` issue ID (e.g. `fix(P0-1): SSE contract fix`).
2. **Document first, fix second.** Any new bug found → add to `STATUS.md` before fixing.
3. **No big-bang refactors.** Each iteration = 1-3 issues from one priority bucket.
4. **Test after every fix.** `pytest tests/ -v` + `npm run test` + `npx tsc --noEmit`.
5. **Update docs in same commit.** `STATUS.md`, `AGENT_NAVIGATION.md`, `worklog.md` if needed.

## Priority Buckets

### P0 — Critical (correctness, stability) — 0 remaining
All P0 issues resolved in iter 54-58 (claimed; P2-12 tracks doc/code mismatch).

### P1 — Serious (performance, maintainability) — 6 items
- See STATUS.md §P1 (P1-7 closed iter 61)

### P2 — Medium (clean code) — 9 items
- See STATUS.md §P2 (P2-7 closed iter 59; P2-11 claimed closed iter 60 but actually incomplete — tracked as P2-12)

### P3 — Low priority (nice-to-have) — 5 items
- See STATUS.md §P3 (P3-8 closed as side effect of P1-7 in iter 61)

## Recommended Fix Order (iter 62+)

Iter 61 (DONE):
10. **P1-7** (EventManager async) — DONE. 4 sync methods → async, `_prune_expired` left sync (intentional — see STATUS.md §Fixed/P1-7 for design decision). P3-8 closed as side effect. 25 tests converted to async (pytest-asyncio `auto` mode). Backend 374 pass, e2e 30/4 skip, tsc 0, jest 291.
11. **P2-12** (NEW) — discovered during iter 61 verification: iter 60's `git rm` of 10 orphan root files was never actually executed (commit `9ee73ae` only updated docs). Same for iter 58's WS file deletion (`.DELETED.txt` markers were added but original files kept). High-priority cleanup — should be iter 62 to restore the "tsc 0 / jest clean" baseline that iter 60 falsely claimed.

Iter 62+ (next, in recommended order):
12. **P2-12** — run `DELETIONS.sh` for real, `git rm` orphan `.DELETED.txt` markers + `routes_ws.py` original. Verify tsc 0 errors + jest clean.
13. **P1-4** through **P1-10** — see STATUS.md for dependencies.

## Estimation (rough, updated iter 61)

| Bucket | Issues remaining | Estimated iterations | Risk |
|--------|------------------|---------------------|------|
| P0 | 0 | 0 | — |
| P1 | 6 | 4-6 iterations | Medium — some touch core paths |
| P2 | 9 | 5-7 iterations | Low — mostly mechanical |
| P3 | 5 | 3-4 iterations | Low — non-blocking |

**Total:** ~12 iterations remaining to clean state. Each iteration = 1 commit, 1 STATUS.md update.

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

### iter 61 — 2 issues closed in one commit (P1-7 + P3-8)
- **P1-7** (`refactor(P1-7): EventManager async — replace fire-and-forget with await`) — 4 sync methods in `backend/economy/events.py` (`create_event`, `delete_event`, `deactivate_event`, `clear_all`) converted to `async def`. Fire-and-forget `asyncio.ensure_future(self._store.<op>(...))` pattern replaced with `await self._store.<op>(...)`. 3 callers in `routes_events.py` updated. 25 tests in `tests/test_events.py` converted to async. `_StubManager` in `tests/test_routes_events_invalidation.py` converted to async. 1 test in `tests/test_scheduler.py` updated. `_prune_expired` left sync intentionally — it's called from sync read-only paths; SQLite prune already done by scheduler + on startup.
- **P3-8** (closed as side effect) — no more deprecated `asyncio.get_event_loop()` calls in `events.py`.
- **NEW issue discovered:** P2-12 — iter 58-60 doc/code mismatch. iter 60's `git rm` of 10 orphan root files (P2-11) was never actually executed (commit `9ee73ae` only updated docs). Same for iter 58's WS file deletion. Tracked in STATUS.md §P2-12, deferred to iter 62.

### iter 60 — 1 issue claimed closed (P2-11 — actually incomplete, see P2-12)
- **P2-11** (`fix(P2-11): remove 10 orphan root-level files from iter 58`) — commit `9ee73ae` only updated docs (`STATUS.md`, `REFACTOR_PLAN.md`, `worklog.md`, `MERGE_INSTRUCTIONS.md`, `DELETIONS.sh`). The `git rm` itself was never executed. All 10 orphan files are still present in the repo root. Tracked as P2-12.

### iter 59 — 2 issues closed in one commit
- **P1-11 + P2-7** (`fix(P1-11+P2-7): daily_stats invalidation + targeted SSE invalidation`) — P1-11: `daily_stats_cache.invalidate()` after `pipeline_cache.invalidate()` in `routes_events.create_event`/`delete_event`/`deactivate_event`. 4 regression tests. P2-7: `invalidateCaches(pair)` drops over-eager `crossRates` invalidation, adds per-pair `benchmark` invalidation.

### iter 58 — 6 issues claimed closed (actually incomplete, see P2-12)
- **P0-2 + P1-1 + P1-2 + P2-10 + P3-1 + P3-6** — WS router correctly removed from `backend/main.py`. But `backend/api/routes_ws.py` (721 lines), `src/hooks/use-websocket.ts` (548 lines), `src/app/api/flipper/ws/info/route.ts` were renamed to `.DELETED.txt` markers AND the originals kept — actual deletion never happened.

### iter 57 — 1 P0 issue fixed
- **P0-5** (`refactor(P0-5): unified pricing helper + remove dead prices param`) — `backend/economy/pricing.py` with `compute_transitive_prices` + `find_price_24h_ago`. P1-3 closed as side effect.

### iter 56 — 1 P0 issue fixed
- **P0-6** (`fix(P0-6): remove chaos hardcode in triangular arbitrage`) — Single numeraire = `config.league.base_currency`.

### iter 55 — 1 P0 issue fixed
- **P0-1** (`fix(P0-1): SSE contract fix — remove dead monitor, add change_pct, align payload`) — Per-currency SSE events matching `SSEPriceUpdate`.

### iter 54 — 2 P0 issues fixed
- **P0-3 + P0-4** — `routes_analyst._compute_trends` 24h change + `PhaseDetector._reference_date` reset.
