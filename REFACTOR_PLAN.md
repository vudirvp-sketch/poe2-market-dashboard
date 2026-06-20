# REFACTOR_PLAN.md — Roadmap

> Version: 28.0 | Date: 2026-06-21 (iter 64 — P1-8 closed: Bellman-Ford negative cycle detection)
> Source: Full codebase audit (iter 52) + verification (iter 53) + iter 54-64 fixes. See `STATUS.md` for detailed issue descriptions.

## Principles

1. **One issue per commit.** Reference `STATUS.md` issue ID (e.g. `fix(P0-1): SSE contract fix`).
2. **Document first, fix second.** Any new bug found → add to `STATUS.md` before fixing.
3. **No big-bang refactors.** Each iteration = 1-3 issues from one priority bucket.
4. **Test after every fix.** `pytest tests/ -v` + `npm run test` + `npx tsc --noEmit`.
5. **Update docs in same commit.** `STATUS.md`, `AGENT_NAVIGATION.md`, `worklog.md` if needed.

## Priority Buckets

### P0 — Critical (correctness, stability) — 0 remaining
All P0 issues resolved in iter 54-58.

### P1 — Serious (performance, maintainability) — 4 items
- See STATUS.md §P1 (P1-4 closed iter 63; P1-7 closed iter 61; P1-8 closed iter 64)

### P2 — Medium (clean code) — 9 items
- See STATUS.md §P2 (P2-7 closed iter 59; P2-10 closed iter 58; P2-11 closed iter 60; P2-12 closed iter 62; P2-13 added iter 64 — process_pool test pollution)

### P3 — Low priority (nice-to-have) — 5 items
- See STATUS.md §P3 (P3-1, P3-6, P3-8 closed)

## Recommended Fix Order (iter 65+)

Iter 64 (DONE):
- **P1-8** (Bellman-Ford negative cycle detection) — DONE. New `_detect_negative_cycle_nodes()` helper in `routes_optimizer.py`. Detects profitable arbitrage cycles; logs warning and returns `None` when target is on the cycle so the endpoint falls back to the direct edge. 23 new tests in `tests/test_routes_optimizer.py`.

Iter 65+ (next, in recommended order):
1. **P2-13** (process_pool test pollution) — Quick win: identified root cause in iter 64. Lazy/re-creatable pool OR fall back to ThreadPoolExecutor when broken. Unblocks `test_triangular.py` in full-suite runs.
2. **P1-5** (`compute_quantized_analysis` O(lot_sizes × max_lot_search) → binary search).
3. **P1-6** (`HistoricalStore._prune_old_league_data` chunked delete).
4. **P1-9** (spread model magic numbers → `config.yaml`).
5. **P1-10** (per-endpoint circuit breaker in `flipper-proxy.ts`).
6. P2-1 through P2-9 — see STATUS.md for dependencies.
7. P3-2 through P3-7 — non-blocking cleanup.

## Estimation (rough, updated iter 64)

| Bucket | Issues remaining | Estimated iterations | Risk |
|--------|------------------|---------------------|------|
| P0 | 0 | 0 | — |
| P1 | 4 | 3-4 iterations | Medium — some touch core paths |
| P2 | 9 | 5-7 iterations | Low — mostly mechanical |
| P3 | 5 | 2-3 iterations | Low — non-blocking |

**Total:** ~10-14 iterations remaining to clean state. Each iteration = 1 commit, 1 STATUS.md update.

## Definition of Done (per issue)

- [ ] Code changed
- [ ] `pytest tests/ -v` passes (add regression test if applicable)
- [ ] `npm run test` passes
- [ ] `npx tsc --noEmit` passes
- [ ] `STATUS.md` — move issue to "Fixed" section with commit hash
- [ ] `worklog.md` — append entry with iteration number
- [ ] Commit message format: `<type>(P<n>-<id>): <short description>`
- [ ] If issue touches API contract — regenerate `openapi_schema.json` + `src/lib/api-types.ts`
