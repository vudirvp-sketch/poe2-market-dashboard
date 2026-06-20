# REFACTOR_PLAN.md — Roadmap

> Version: 26.0 | Date: 2026-06-20 (iter 62 — P2-12 closed: orphan files + WS remnants actually removed)
> Source: Full codebase audit (iter 52) + verification (iter 53) + iter 54-62 fixes. See `STATUS.md` for detailed issue descriptions.

## Principles

1. **One issue per commit.** Reference `STATUS.md` issue ID (e.g. `fix(P0-1): SSE contract fix`).
2. **Document first, fix second.** Any new bug found → add to `STATUS.md` before fixing.
3. **No big-bang refactors.** Each iteration = 1-3 issues from one priority bucket.
4. **Test after every fix.** `pytest tests/ -v` + `npm run test` + `npx tsc --noEmit`.
5. **Update docs in same commit.** `STATUS.md`, `AGENT_NAVIGATION.md`, `worklog.md` if needed.

## Priority Buckets

### P0 — Critical (correctness, stability) — 0 remaining
All P0 issues resolved in iter 54-58.

### P1 — Serious (performance, maintainability) — 6 items
- See STATUS.md §P1 (P1-7 closed iter 61)

### P2 — Medium (clean code) — 8 items
- See STATUS.md §P2 (P2-7 closed iter 59; P2-10 closed iter 58; P2-11 closed iter 60; P2-12 closed iter 62)

### P3 — Low priority (nice-to-have) — 5 items
- See STATUS.md §P3 (P3-1, P3-6, P3-8 closed; P3-8 closed as side effect of P1-7 in iter 61)

## Recommended Fix Order (iter 63+)

Iter 62 (DONE):
- **P2-12** (orphan files actual cleanup) — DONE. 16 files removed via `git rm` (10 root orphans + 6 WS remnants). tsc 0 errors, jest 291/291 pass. Zero code changes.

Iter 63+ (next, in recommended order):
1. **P1-4** (clustering duplication between `routes_prices` and `routes_arbitrage`) — Single cache key `cluster_labels` + shared helper function. Touches 2 route files + tests.
2. **P1-8** (Bellman-Ford negative cycle detection in `routes_optimizer`) — Add cycle check after max_hops relaxations.
3. **P1-5** (`compute_quantized_analysis` O(lot_sizes × max_lot_search) → binary search).
4. **P1-6** (`HistoricalStore._prune_old_league_data` chunked delete).
5. **P1-9** (spread model magic numbers → `config.yaml`).
6. **P1-10** (per-endpoint circuit breaker in `flipper-proxy.ts`).
7. P2-1 through P2-9 — see STATUS.md for dependencies.
8. P3-2 through P3-7 — non-blocking cleanup.

## Estimation (rough, updated iter 62)

| Bucket | Issues remaining | Estimated iterations | Risk |
|--------|------------------|---------------------|------|
| P0 | 0 | 0 | — |
| P1 | 6 | 5-6 iterations | Medium — some touch core paths |
| P2 | 8 | 5-7 iterations | Low — mostly mechanical |
| P3 | 5 | 2-3 iterations | Low — non-blocking |

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

## Fixed (recent — older history in git log)

### iter 62 — 1 issue closed
- **P2-12** (`fix(P2-12): actually delete orphan root files + WS file remnants`) — iter 60 commit `9ee73ae` only updated docs but never executed `git rm`. This iter ran the actual deletions: 10 orphan root files + 3 WS originals (`routes_ws.py` 721 lines, `use-websocket.ts` 547 lines, `ws/info/route.ts` 31 lines) + 3 `.DELETED.txt` markers. True clean baseline finally restored: tsc 0 errors (was 2), jest 291/291 pass / 14 suites (was 13 + 1 failing).

### iter 61 — 2 issues closed
- **P1-7 + P3-8** (`refactor(P1-7): EventManager async — replace fire-and-forget with await`) — 4 sync methods in `backend/economy/events.py` → async. 3 endpoints in `routes_events.py` updated. 25+3+1 tests converted to async. P3-8 auto-closed (deprecated `asyncio.get_event_loop()` calls were part of the deleted fire-and-forget pattern).

### iter 59 — 2 issues closed in one commit
- **P1-11 + P2-7** (`fix(P1-11+P2-7): daily_stats invalidation + targeted SSE invalidation`) — P1-11: `daily_stats_cache.invalidate()` after `pipeline_cache.invalidate()` in 3 event endpoints. 4 regression tests. P2-7: `invalidateCaches(pair)` drops over-eager `crossRates` invalidation, adds per-pair `benchmark` invalidation.

### iter 58 — 6 issues closed in one commit (WS removal)
- **P0-2 + P1-1 + P1-2 + P2-10 + P3-1 + P3-6** — Removed `backend/api/routes_ws.py` (722 lines), `src/hooks/use-websocket.ts` (548 lines), `src/app/api/flipper/ws/info/route.ts`. Real-time updates handled by SSE (P0-1) + REST polling. (Orphan file remnants cleaned in iter 62.)

### Earlier P0 fixes (iter 54-57)
- **iter 57 — P0-5**: unified `compute_transitive_prices` + `find_price_24h_ago` in `backend/economy/pricing.py`. P1-3 closed as side effect.
- **iter 56 — P0-6**: removed `prices["chaos"] = 1.0` hardcode in triangular arbitrage.
- **iter 55 — P0-1**: SSE price stream contract — per-currency `{pair, change_pct, new_price, old_price, timestamp}`.
- **iter 54 — P0-3 + P0-4**: analyst 24h change uses `find_price_24h_ago`; PhaseDetector `_reference_date` returns `patch_reset_date` unconditionally.
