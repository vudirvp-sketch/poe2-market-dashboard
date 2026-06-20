# REFACTOR_PLAN.md — Roadmap

> Version: 30.0 | Date: 2026-06-21 (iter 66 — closed P2-14, P2-5, P2-2, P1-5, P1-6, P1-9, P1-10, P3-2)
> Source: Full codebase audit (iter 52) + verification (iter 53) + iter 54-66 fixes. See `STATUS.md` for detailed issue descriptions.

## Principles

1. **One issue per commit.** Reference `STATUS.md` issue ID (e.g. `fix(P0-1): SSE contract fix`).
2. **Document first, fix second.** Any new bug found → add to `STATUS.md` before fixing.
3. **No big-bang refactors.** Each iteration = 1-3 issues from one priority bucket. (iter 66 closed 8 issues — possible because 4 were quick wins + tests-only.)
4. **Test after every fix.** `pytest tests/ -v` + `npm run test` + `npx tsc --noEmit`.
5. **Update docs in same commit.** `STATUS.md`, `AGENT_NAVIGATION.md`, `worklog.md` if needed.

## Priority Buckets

### P0 — Critical (correctness, stability) — 0 remaining
All P0 issues resolved in iter 54-58.

### P1 — Serious (performance, maintainability) — 0 remaining 🎉
All P1 issues resolved in iter 54-66. Last 4 closed in iter 66 (P1-5, P1-6, P1-9, P1-10).

### P2 — Medium (clean code) — 5 items
- See STATUS.md §P2 (P2-7 closed iter 59; P2-10 closed iter 58; P2-11 closed iter 60; P2-12 closed iter 62; P2-13 closed iter 65; P2-14 closed iter 66; P2-2 closed iter 66; P2-5 closed iter 66)

### P3 — Low priority (nice-to-have) — 3 items
- See STATUS.md §P3 (P3-1, P3-2, P3-6, P3-8 closed; P3-2 closed in iter 66)

## Recommended Fix Order (iter 67+)

Iter 66 (DONE): 8 issues closed in one iter — see worklog.md Task 66 for details. Demonstrated that "1-3 issues per iter" can be safely relaxed when the issues are independent and most are test-only or mechanical.

Iter 67+ (next, in recommended order):
1. **P2-9** (`lightgbm_min_data_points: 15` → adaptive fallback) — small, isolated.
2. **P2-4** (`routes_scanner.py` duplicates `/flips`) — extend `/flips` or delete scanner.
3. **P2-6** (double CB not synchronized → expose in `/health`) — small, mechanical.
4. **P2-8** (`proxyWithFallback` swallows ALL 5xx → 200) — touches frontend error UX.
5. **P2-3** (`currency_names_ru.py` 966-line hardcoded dict → JSON) — medium, mechanical.
6. **P2-1** (`dashboard-page.tsx` 1705-line god-component → split) — large, multi-iter.
7. P3-3, P3-4, P3-5, P3-7 — non-blocking cleanup.

## Estimation (rough, updated iter 66)

| Bucket | Issues remaining | Estimated iterations | Risk |
|--------|------------------|---------------------|------|
| P0 | 0 | 0 | — |
| P1 | 0 | 0 | — |
| P2 | 5 | 3-5 iterations | Low — mostly mechanical |
| P3 | 3 | 1-2 iterations | Low — non-blocking |

**Total:** ~4-7 iterations remaining to clean state. Each iteration = 1+ commit, 1 STATUS.md update. iter 66 showed that batching quick wins (4-5 issues per iter) is feasible when they're independent.

## Definition of Done (per issue)

- [ ] Code changed
- [ ] `pytest tests/ -v` passes (add regression test if applicable)
- [ ] `npm run test` passes
- [ ] `npx tsc --noEmit` passes
- [ ] `STATUS.md` — move issue to "Fixed" section with commit hash
- [ ] `worklog.md` — append entry with iteration number
- [ ] Commit message format: `<type>(P<n>-<id>): <short description>`
- [ ] If issue touches API contract — regenerate `openapi_schema.json` + `src/lib/api-types.ts`
