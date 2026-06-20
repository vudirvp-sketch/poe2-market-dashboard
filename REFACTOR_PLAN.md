# REFACTOR_PLAN.md — Roadmap

> Version: 22.0 | Date: 2026-06-20 (iter 57 — P0-5 fixed)
> Source: Full codebase audit (iter 52) + verification (iter 53) + iter 54-57 fixes. See `STATUS.md` for detailed issue descriptions.

## Principles

1. **One issue per commit.** Reference `STATUS.md` issue ID (e.g. `fix(P0-1): SSE contract fix`).
2. **Document first, fix second.** Any new bug found → add to `STATUS.md` before fixing.
3. **No big-bang refactors.** Each iteration = 1-3 issues from one priority bucket.
4. **Test after every fix.** `pytest tests/ -v` + `npm run test` + `npx tsc --noEmit`.
5. **Update docs in same commit.** `STATUS.md`, `AGENT_NAVIGATION.md`, `worklog.md` if needed.

## Priority Buckets

### P0 — Critical (correctness, stability) — 1 remaining (P0-2)
- P0-2. WebSocket — offload `_compute_anomalies` / `_compute_flips` to ProcessPoolExecutor

### P1 — Serious (performance, maintainability) — 10 items (P1-3 closed by P0-5)
- See STATUS.md §P1

### P2 — Medium (clean code) — 11 items
- See STATUS.md §P2 (P2-7 now unblocked — P0-1 fixed, backend sends `pair`)

### P3 — Low priority (nice-to-have) — 8 items
- See STATUS.md §P3

## Recommended Fix Order (iter 55+)

Iter 54 (DONE): P0-3 + P0-4 fixed.

Iter 55 (DONE):
3. **P0-1** (SSE) — DONE. Removed dead monitor, added `change_pct` + threshold filtering, aligned frontend contract. 4 tests in `tests/e2e/test_sse.py`. Commit: `fix(P0-1): SSE contract fix — remove dead monitor, add change_pct, align payload`.

Iter 56 (DONE):
4. **P0-6** (triangular hardcode) — DONE. Removed `prices["chaos"] = 1.0` hardcode + redundant chaos-normalization block. Single numeraire = `config.league.base_currency`. `tests/test_triangular.py` 7/7 pass. Commit: `fix(P0-6): remove chaos hardcode in triangular arbitrage`.

Iter 57 (DONE):
5. **P0-5** (transitive prices helper) — DONE. Created `backend/economy/pricing.py` with `compute_transitive_prices` (BFS) + `find_price_24h_ago`. Swapped call sites in `data_snapshot.py`, `scheduler.py`, `routes_arbitrage.py`, `routes_analyst.py`. Removed dead `prices` param from `find_triangular_arbitrage` + `_find_triangular_arbitrage_sync`. 15 tests in `tests/test_pricing.py` (incl. 7-hop chain regression). P1-3 also closed (BFS already O(V+E)). Backend: 375 pass / 4 skip. e2e: 30 pass / 4 skip. Commit: `refactor(P0-5): unified pricing helper + remove dead prices param`.

Iter 58 (next):
6. **P0-2** (WS executor offload) — depends on decision: keep WS (apply executor fix) or delete WS (depends on P1-1).

Iter 59+:
7. P1-11 (daily_stats invalidation) — 2-line fix, can be batched with P1-7 (EventManager async).
8. P2-7 (targeted invalidation) — now unblocked by P0-1 fix (backend sends `pair` field).
9. P1-1 through P1-10 — see STATUS.md for dependencies.

## Estimation (rough, updated iter 57)

| Bucket | Issues remaining | Estimated iterations | Risk |
|--------|------------------|---------------------|------|
| P0 | 1 (P0-2) | 1-2 iterations | Low — well-defined |
| P1 | 10 (P1-3 closed) | 8-10 iterations | Medium — some touch core paths |
| P2 | 11 | 7-9 iterations | Low — mostly mechanical |
| P3 | 8 | 3-5 iterations | Low — non-blocking |

**Total:** ~20 iterations remaining to clean state. Each iteration = 1 commit, 1 STATUS.md update.

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

### iter 57 — 1 P0 issue fixed
- **P0-5** (`refactor(P0-5): unified pricing helper + remove dead prices param`) — Created `backend/economy/pricing.py` with `compute_transitive_prices` (BFS) + `find_price_24h_ago` (extracted from `routes_arbitrage.py`). `data_snapshot.py` and `scheduler.py` now share the same BFS helper — the 5-iter relaxation that silently missed >5-hop chains is gone. Dead `prices` parameter removed from `find_triangular_arbitrage` + `_find_triangular_arbitrage_sync`. P1-3 also closed (BFS already O(V+E)). 15 new tests in `tests/test_pricing.py`. Backend: 375 pass / 4 skip. e2e: 30 pass / 4 skip.

### iter 56 — 1 P0 issue fixed
- **P0-6** (`fix(P0-6): remove chaos hardcode in triangular arbitrage`) — Removed 16-line chaos-normalization + hardcode block from `routes_arbitrage.py:753-770`. Now uses single numeraire = `config.league.base_currency`. `prices` parameter still passed to `find_triangular_arbitrage` (dead — cleanup deferred to P0-5). Tests: `tests/test_triangular.py` 7/7 pass, e2e `test_arbitrage_triangular` pass.

### iter 55 — 1 P0 issue fixed
- **P0-1** (`fix(P0-1): SSE contract fix — remove dead monitor, add change_pct, align payload`) — Removed dead `_sse_monitor_loop` / `start_sse_monitor` / `stop_sse_monitor`. Rewrote `_sse_event_generator` to store previous snapshot, compute `change_pct`, filter by `threshold_pct`, emit per-currency events matching frontend `SSEPriceUpdate`. Updated frontend interface to required fields. 4 tests in `tests/e2e/test_sse.py`. Backend: 377 pass / 4 skip. Frontend: 291 pass. tsc: clean.

### iter 54 — 2 P0 issues fixed
- **P0-3** (`fix(P0-3): use _find_price_24h_ago for analyst 24h change`) — timestamp-aware 24h-ago lookup. 4 tests in `tests/e2e/test_analyst.py`.
- **P0-4** (`fix(P0-4): PhaseDetector respects major_patch unconditionally`) — `patch_reset_date` without `max()`. Regression test in `tests/test_lifecycle.py`.
