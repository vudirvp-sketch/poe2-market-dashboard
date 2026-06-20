# REFACTOR_PLAN.md — Roadmap

> Version: 27.0 | Date: 2026-06-21 (iter 63 — P1-4 closed: clustering deduplicated)
> Source: Full codebase audit (iter 52) + verification (iter 53) + iter 54-63 fixes. See `STATUS.md` for detailed issue descriptions.

## Principles

1. **One issue per commit.** Reference `STATUS.md` issue ID (e.g. `fix(P0-1): SSE contract fix`).
2. **Document first, fix second.** Any new bug found → add to `STATUS.md` before fixing.
3. **No big-bang refactors.** Each iteration = 1-3 issues from one priority bucket.
4. **Test after every fix.** `pytest tests/ -v` + `npm run test` + `npx tsc --noEmit`.
5. **Update docs in same commit.** `STATUS.md`, `AGENT_NAVIGATION.md`, `worklog.md` if needed.

## Priority Buckets

### P0 — Critical (correctness, stability) — 0 remaining
All P0 issues resolved in iter 54-58.

### P1 — Serious (performance, maintainability) — 5 items
- See STATUS.md §P1 (P1-4 closed iter 63, P1-7 closed iter 61)

### P2 — Medium (clean code) — 8 items
- See STATUS.md §P2 (P2-7 closed iter 59; P2-10 closed iter 58; P2-11 closed iter 60; P2-12 closed iter 62)

### P3 — Low priority (nice-to-have) — 5 items
- See STATUS.md §P3 (P3-1, P3-6, P3-8 closed)

## Recommended Fix Order (iter 64+)

Iter 63 (DONE):
- **P1-4** (clustering duplication) — DONE. New `backend/economy/clustering_helpers.py` with shared `prepare_clustering_data()` + `run_clustering_sync()`. Single cache key `"cluster_labels"`. Fixed `prices[0]` bug. 16 new tests.

Iter 64+ (next, in recommended order):
1. **P1-8** (Bellman-Ford negative cycle detection in `routes_optimizer`) — Add cycle check after max_hops relaxations.
2. **P1-5** (`compute_quantized_analysis` O(lot_sizes × max_lot_search) → binary search).
3. **P1-6** (`HistoricalStore._prune_old_league_data` chunked delete).
4. **P1-9** (spread model magic numbers → `config.yaml`).
5. **P1-10** (per-endpoint circuit breaker in `flipper-proxy.ts`).
6. P2-1 through P2-9 — see STATUS.md for dependencies.
7. P3-2 through P3-7 — non-blocking cleanup.

## Estimation (rough, updated iter 63)

| Bucket | Issues remaining | Estimated iterations | Risk |
|--------|------------------|---------------------|------|
| P0 | 0 | 0 | — |
| P1 | 5 | 4-5 iterations | Medium — some touch core paths |
| P2 | 8 | 5-7 iterations | Low — mostly mechanical |
| P3 | 5 | 2-3 iterations | Low — non-blocking |

**Total:** ~11 iterations remaining to clean state. Each iteration = 1 commit, 1 STATUS.md update.

## Definition of Done (per issue)

- [ ] Code changed
- [ ] `pytest tests/ -v` passes (add regression test if applicable)
- [ ] `npm run test` passes
- [ ] `npx tsc --noEmit` passes
- [ ] `STATUS.md` — move issue to "Fixed" section with commit hash
- [ ] `worklog.md` — append entry with iteration number
- [ ] Commit message format: `<type>(P<n>-<id>): <short description>`
- [ ] If issue touches API contract — regenerate `openapi_schema.json` + `src/lib/api-types.ts`
