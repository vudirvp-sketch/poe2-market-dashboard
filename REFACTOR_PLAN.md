# REFACTOR_PLAN.md — Roadmap

> Version: 32.0 | Date: 2026-06-21 (iter 68 — closed P2-4 follow-up: scanner deleted)
> Source: Full codebase audit (iter 52) + verification (iter 53) + iter 54-68 fixes. See `STATUS.md` for detailed issue descriptions.

## Principles

1. **One issue per commit.** Reference `STATUS.md` issue ID (e.g. `fix(P0-1): SSE contract fix`).
2. **Document first, fix second.** Any new bug found → add to `STATUS.md` before fixing.
3. **No big-bang refactors.** Each iteration = 1-3 issues from one priority bucket. (iter 67 closed 3 issues with full test coverage; iter 68 closed the P2-4 follow-up as a clean deletion.)
4. **Test after every fix.** `pytest tests/ -v` + `npm run test` + `npx tsc --noEmit`.
5. **Update docs in same commit.** `STATUS.md`, `AGENT_NAVIGATION.md`, `worklog.md` if needed.

## Priority Buckets

### P0 — Critical (correctness, stability) — 0 remaining
All P0 issues resolved in iter 54-58.

### P1 — Serious (performance, maintainability) — 0 remaining 🎉
All P1 issues resolved in iter 54-66.

### P2 — Medium (clean code) — 3 items
- See STATUS.md §P2. P2-9 / P2-6 closed in iter 67; P2-4 closed in iter 67 + follow-up deletion in iter 68. Remaining: P2-1 (god-component split), P2-3 (currency_names_ru → JSON), P2-8 (proxyWithFallback 5xx handling).

### P3 — Low priority (nice-to-have) — 4 items
- See STATUS.md §P3 (P3-1, P3-2, P3-6, P3-8 closed; P3-2 closed in iter 66; P3-5 partially addressed by `test_flips_filters.py` in iter 67).

## Recommended Fix Order (iter 69+)

Iter 68 (DONE): P2-4 follow-up — `routes_scanner.py` deleted; `/api/v1/scanner` removed from `routes_batch.py:ALLOWED_PREFIXES`; `ScannerResponse`/`ScannerOpportunityData`/`ScannerParams` removed from `response_models.py`; `openapi_schema.json` + `api-types.ts` regenerated; `TestScannerDeprecation` class (2 tests) removed from `tests/test_flips_filters.py`. Baseline: pytest 459 pass, jest 302 pass, tsc 0 errors, e2e 30 pass.

Iter 69+ (next, in recommended order):
1. **P2-8** (`proxyWithFallback` swallows ALL 5xx → 200) — touches frontend error UX, medium risk.
2. **P2-3** (`currency_names_ru.py` 966-line hardcoded dict → JSON) — mechanical but long.
3. **P2-1** (`dashboard-page.tsx` 1705-line god-component → split) — large, multi-iter.
4. P3-3, P3-4, P3-5 (full /flips integration test), P3-7 (delete REFACTOR_PLAN.md + worklog.md after all closed).

## Estimation (rough, updated iter 68)

| Bucket | Issues remaining | Estimated iterations | Risk |
|--------|------------------|---------------------|------|
| P0 | 0 | 0 | — |
| P1 | 0 | 0 | — |
| P2 | 3 | 2-4 iterations | Low-Medium (P2-1 is multi-iter) |
| P3 | 4 | 1-2 iterations | Low — non-blocking |

**Total:** ~2-4 iterations remaining to clean state. Each iteration = 1+ commit, 1 STATUS.md update.

## Definition of Done (per issue)

- [ ] Code changed
- [ ] `pytest tests/ -v` passes (add regression test if applicable)
- [ ] `npm run test` passes
- [ ] `npx tsc --noEmit` passes
- [ ] `STATUS.md` — move issue to "Fixed" section with commit hash
- [ ] `worklog.md` — append entry with iteration number
- [ ] Commit message format: `<type>(P<n>-<id>): <short description>`
- [ ] If issue touches API contract — regenerate `openapi_schema.json` + `src/lib/api-types.ts`
