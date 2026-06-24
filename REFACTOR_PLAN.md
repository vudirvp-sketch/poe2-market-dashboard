# REFACTOR_PLAN.md — Roadmap

> Version: 34.0 | Date: 2026-06-25 (iter 70 — closed P2-3, currency_names_ru → JSON)
> Source: Full codebase audit (iter 52) + verification (iter 53) + iter 54-70 fixes. See `STATUS.md` for detailed issue descriptions.

## Principles

1. **One issue per commit.** Reference `STATUS.md` issue ID (e.g. `fix(P0-1): SSE contract fix`).
2. **Document first, fix second.** Any new bug found → add to `STATUS.md` before fixing.
3. **No big-bang refactors.** Each iteration = 1-3 issues from one priority bucket.
4. **Test after every fix.** `pytest tests/ -v` + `npm run test` + `npx tsc --noEmit`.
5. **Update docs in same commit.** `STATUS.md`, `AGENT_NAVIGATION.md`, `worklog.md` if needed.
6. **File deletions go through `git add -A`, not manual `rm` instructions.** (Learned in iter 69.)
7. **Data files (`*.json`) live alongside their loader module.** Loaders stay thin. (iter 70 — `currency_names_ru.py` → 63 lines, reads `currency_names.json`.)

## Priority Buckets

### P0 — Critical (correctness, stability) — 0 remaining
All P0 issues resolved in iter 54-58.

### P1 — Serious (performance, maintainability) — 0 remaining 🎉
All P1 issues resolved in iter 54-66.

### P2 — Medium (clean code) — 1 item
- See STATUS.md §P2. P2-3 closed in iter 70 (currency_names_ru → JSON + 7 regression tests). P2-9 / P2-6 / P2-4 closed in iter 67; P2-8 closed in iter 69. **Remaining: P2-1 (god-component split, `dashboard-page.tsx` 1705 lines → tab-specific subcomponents — multi-iter).**

### P3 — Low priority (nice-to-have) — 4 items
- See STATUS.md §P3 (P3-1, P3-2, P3-6, P3-8 closed; P3-5 partially addressed by `test_flips_filters.py` in iter 67).

## Recommended Fix Order (iter 71+)

Iter 70 (DONE): P2-3 closed — `currency_names_ru.py` shrunk 966 → 63 lines, data moved to `currency_names.json`. +7 pytest regression tests. Baseline: pytest 466 pass (+7), jest 324 pass (unchanged), tsc 0 errors (unchanged), e2e 30 pass (unchanged). New file `PRODUCT_VISION.md` added at repo root — captures the user's product direction (analytics helper, not a poe2scout/poe2ninja clone) and lists product features F1-F6 (separate from this technical-debt roadmap).

Iter 71+ (next, in recommended order):
1. **P2-1** (`dashboard-page.tsx` 1705-line god-component → split) — large, multi-iter. Likely 2-3 commits: extract tab-specific subcomponents one at a time, keep tests green at each step.
2. P3-3 (EventManager thread-safety), P3-4 (SnapshotManager atomic swap), P3-5 (full /flips integration test), P3-7 (delete REFACTOR_PLAN.md + worklog.md after all closed).

After all P2/P3 closed → switch focus to product features (see `PRODUCT_VISION.md` F1-F6).

## Estimation (rough, updated iter 70)

| Bucket | Issues remaining | Estimated iterations | Risk |
|--------|------------------|---------------------|------|
| P0 | 0 | 0 | — |
| P1 | 0 | 0 | — |
| P2 | 1 | 2-3 iterations | Medium (P2-1 is multi-iter; safe extract order required) |
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
- [ ] If issue deletes a file — ensure `git add -A` picks up the deletion (no manual `rm` instructions in MERGE_INSTRUCTIONS.md)
- [ ] If issue moves data to a file (e.g. JSON) — keep loader thin and add a regression test that locks down the data shape
