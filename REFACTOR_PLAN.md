# REFACTOR_PLAN.md — Roadmap

> Version: 31.0 | Date: 2026-06-21 (iter 67 — closed P2-9, P2-6, P2-4)
> Source: Full codebase audit (iter 52) + verification (iter 53) + iter 54-67 fixes. See `STATUS.md` for detailed issue descriptions.

## Principles

1. **One issue per commit.** Reference `STATUS.md` issue ID (e.g. `fix(P0-1): SSE contract fix`).
2. **Document first, fix second.** Any new bug found → add to `STATUS.md` before fixing.
3. **No big-bang refactors.** Each iteration = 1-3 issues from one priority bucket. (iter 66 closed 8 issues — possible because 4 were quick wins + tests-only; iter 67 closed 3 with full test coverage.)
4. **Test after every fix.** `pytest tests/ -v` + `npm run test` + `npx tsc --noEmit`.
5. **Update docs in same commit.** `STATUS.md`, `AGENT_NAVIGATION.md`, `worklog.md` if needed.

## Priority Buckets

### P0 — Critical (correctness, stability) — 0 remaining
All P0 issues resolved in iter 54-58.

### P1 — Serious (performance, maintainability) — 0 remaining 🎉
All P1 issues resolved in iter 54-66.

### P2 — Medium (clean code) — 3 items
- See STATUS.md §P2. P2-9 / P2-6 / P2-4 closed in iter 67. Remaining: P2-1 (god-component split), P2-3 (currency_names_ru → JSON), P2-8 (proxyWithFallback 5xx handling).
- **P2-4 follow-up:** `routes_scanner.py` is deprecated (iter 67) — scheduled for deletion in iter 68.

### P3 — Low priority (nice-to-have) — 4 items
- See STATUS.md §P3 (P3-1, P3-2, P3-6, P3-8 closed; P3-2 closed in iter 66; P3-5 partially addressed by `test_flips_filters.py` in iter 67).

## Recommended Fix Order (iter 68+)

Iter 67 (DONE): 3 issues closed — P2-9 (LightGBM adaptive fallback), P2-6 (CB state endpoint), P2-4 (extend /flips + deprecate scanner). See worklog.md Task 67.

Iter 68+ (next, in recommended order):
1. **Delete `routes_scanner.py`** (P2-4 follow-up) — remove `/api/v1/scanner` from `routes_batch.py:ALLOWED_PREFIXES`, remove `ScannerResponse` from `response_models.py`, regenerate `openapi_schema.json` + `api-types.ts`.
2. **P2-8** (`proxyWithFallback` swallows ALL 5xx → 200) — touches frontend error UX, medium risk.
3. **P2-3** (`currency_names_ru.py` 966-line hardcoded dict → JSON) — mechanical but long.
4. **P2-1** (`dashboard-page.tsx` 1705-line god-component → split) — large, multi-iter.
5. P3-3, P3-4, P3-5 (full /flips integration test), P3-7 (delete REFACTOR_PLAN.md + worklog.md after all closed).

## Estimation (rough, updated iter 67)

| Bucket | Issues remaining | Estimated iterations | Risk |
|--------|------------------|---------------------|------|
| P0 | 0 | 0 | — |
| P1 | 0 | 0 | — |
| P2 | 3 (+1 deletion follow-up) | 3-5 iterations | Low-Medium (P2-1 is multi-iter) |
| P3 | 4 | 1-2 iterations | Low — non-blocking |

**Total:** ~3-5 iterations remaining to clean state. Each iteration = 1+ commit, 1 STATUS.md update.

## Definition of Done (per issue)

- [ ] Code changed
- [ ] `pytest tests/ -v` passes (add regression test if applicable)
- [ ] `npm run test` passes
- [ ] `npx tsc --noEmit` passes
- [ ] `STATUS.md` — move issue to "Fixed" section with commit hash
- [ ] `worklog.md` — append entry with iteration number
- [ ] Commit message format: `<type>(P<n>-<id>): <short description>`
- [ ] If issue touches API contract — regenerate `openapi_schema.json` + `src/lib/api-types.ts`
