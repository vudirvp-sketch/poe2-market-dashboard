# REFACTOR_PLAN.md — Roadmap

> Version: 33.0 | Date: 2026-06-21 (iter 69 — closed P2-8 + cleaned up iter 68 scanner residual)
> Source: Full codebase audit (iter 52) + verification (iter 53) + iter 54-69 fixes. See `STATUS.md` for detailed issue descriptions.

## Principles

1. **One issue per commit.** Reference `STATUS.md` issue ID (e.g. `fix(P0-1): SSE contract fix`).
2. **Document first, fix second.** Any new bug found → add to `STATUS.md` before fixing.
3. **No big-bang refactors.** Each iteration = 1-3 issues from one priority bucket. (iter 67 closed 3 issues with full test coverage; iter 68 closed the P2-4 follow-up as a clean code-level deletion; iter 69 closed P2-8 + cleaned up the iter 68 scanner-residual bug.)
4. **Test after every fix.** `pytest tests/ -v` + `npm run test` + `npx tsc --noEmit`.
5. **Update docs in same commit.** `STATUS.md`, `AGENT_NAVIGATION.md`, `worklog.md` if needed.
6. **File deletions go through `git add -A`, not manual `rm` instructions.** (Learned in iter 69: iter 68 asked the user to `rm ./backend/api/routes_scanner.py` before `git add -A`; the user skipped the manual step and the file stayed in the repo. Iter 69 had to clean it up. Going forward, the archive does not contain deleted files, the merge instructions tell the user to `git add -A` after copying, and git tracks the deletion automatically — no `rm` step in MERGE_INSTRUCTIONS.md.)

## Priority Buckets

### P0 — Critical (correctness, stability) — 0 remaining
All P0 issues resolved in iter 54-58.

### P1 — Serious (performance, maintainability) — 0 remaining 🎉
All P1 issues resolved in iter 54-66.

### P2 — Medium (clean code) — 2 items
- See STATUS.md §P2. P2-9 / P2-6 closed in iter 67; P2-4 closed in iter 67 + follow-up deletion in iter 68 + scanner-residual cleanup in iter 69; P2-8 closed in iter 69. Remaining: P2-1 (god-component split), P2-3 (currency_names_ru → JSON).

### P3 — Low priority (nice-to-have) — 4 items
- See STATUS.md §P3 (P3-1, P3-2, P3-6, P3-8 closed; P3-2 closed in iter 66; P3-5 partially addressed by `test_flips_filters.py` in iter 67).

## Recommended Fix Order (iter 70+)

Iter 69 (DONE): P2-8 closed — `proxyWithFallback` is now mode-aware (dev: non-503 5xx pass-through; prod: 200 + `X-Flipper-Fallback` header). Iter 68 scanner residual cleaned — `backend/api/routes_scanner.py` deleted for real. `jest.setup.ts` gained `Response`/`fetch`/`Headers`/`AbortSignal.timeout` polyfills. Baseline: pytest 459 pass, jest 324 pass (+22 P2-8 tests), tsc 0 errors, e2e 30 pass.

Iter 70+ (next, in recommended order):
1. **P2-3** (`currency_names_ru.py` 966-line hardcoded dict → JSON) — mechanical but long.
2. **P2-1** (`dashboard-page.tsx` 1705-line god-component → split) — large, multi-iter.
3. P3-3, P3-4, P3-5 (full /flips integration test), P3-7 (delete REFACTOR_PLAN.md + worklog.md after all closed).

## Estimation (rough, updated iter 69)

| Bucket | Issues remaining | Estimated iterations | Risk |
|--------|------------------|---------------------|------|
| P0 | 0 | 0 | — |
| P1 | 0 | 0 | — |
| P2 | 2 | 1-3 iterations | Low-Medium (P2-1 is multi-iter) |
| P3 | 4 | 1-2 iterations | Low — non-blocking |

**Total:** ~1-3 iterations remaining to clean state. Each iteration = 1+ commit, 1 STATUS.md update.

## Definition of Done (per issue)

- [ ] Code changed
- [ ] `pytest tests/ -v` passes (add regression test if applicable)
- [ ] `npm run test` passes
- [ ] `npx tsc --noEmit` passes
- [ ] `STATUS.md` — move issue to "Fixed" section with commit hash
- [ ] `worklog.md` — append entry with iteration number
- [ ] Commit message format: `<type>(P<n>-<id>): <short description>`
- [ ] If issue touches API contract — regenerate `openapi_schema.json` + `src/lib/api-types.ts`
- [ ] If issue deletes a file — ensure `git add -A` picks up the deletion (no manual `rm` instructions in MERGE_INSTRUCTIONS.md)
