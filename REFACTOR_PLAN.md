# REFACTOR_PLAN.md — Roadmap

> Version: 36.0 | Date: 2026-06-25 (iter 72 — P2-1 steps 2+3 done)
> Source: Full codebase audit (iter 52) + verification (iter 53) + iter 54-72 fixes. See `STATUS.md` for detailed issue descriptions.

## Principles

1. **One issue per commit.** Reference `STATUS.md` issue ID (e.g. `fix(P0-1): SSE contract fix`).
2. **Document first, fix second.** Any new bug found → add to `STATUS.md` before fixing.
3. **No big-bang refactors.** Each iteration = 1-3 issues from one priority bucket.
4. **Test after every fix.** `pytest tests/ -v` + `npm run test` + `npx tsc --noEmit`.
5. **Update docs in same commit.** `STATUS.md`, `AGENT_NAVIGATION.md`, `worklog.md` if needed.
6. **File deletions go through `git add -A`, not manual `rm` instructions.** (Learned in iter 69.)
7. **Data files (`*.json`) live alongside their loader module.** Loaders stay thin. (iter 70 — `currency_names_ru.py` → 63 lines, reads `currency_names.json`.)
8. **Locks are never held across `await`.** (iter 71 — P3-3 EventManager.) In-memory state is mutated under a sync `threading.RLock`; the SQLite write is awaited OUTSIDE the lock so other readers aren't blocked.
9. **Atomic state swap for read-heavy singletons.** (iter 71 — P3-4 SnapshotManager.) When a manager holds (value, timestamp) that readers check together, wrap them in an immutable dataclass and replace the reference in one assignment.

## Priority Buckets

### P0 — Critical (correctness, stability) — 0 remaining
All P0 issues resolved in iter 54-58.

### P1 — Serious (performance, maintainability) — 0 remaining 🎉
All P1 issues resolved in iter 54-66.

### P2 — Medium (clean code) — 1 item (in progress)
- **P2-1** (`dashboard-page.tsx` god-component → split) — multi-iter.
  - **Iter 71 step 1 DONE**: `ExchangeTabContent` extracted (256 lines moved out, dashboard-page.tsx 1685 → 1466 lines).
  - **Iter 72 steps 2+3 DONE**: `CurrenciesTabContent` (~65 lines) + `UniquesTabContent` (~48 lines) + `OverviewTabContent` (~20 lines) extracted + 14 unused imports cleaned. dashboard-page.tsx 1466 → 1370 lines.
  - **Iter 73 step 4 NEXT**: extract `DashboardToolbar` (TabsList + buttons row, ~120 lines), `DashboardDialogs` (dialog wrappers, ~70 lines), `useDashboardData` hook (~250 lines). Target: dashboard-page.tsx ≤700 lines.

### P3 — Low priority (nice-to-have) — 1 item remaining
- **P3-7.** Delete `REFACTOR_PLAN.md` + `worklog.md` after all P2/P3 closed. (P3-3, P3-4, P3-5 closed in iter 71.)

### P4 — Documentation / minor cosmetic — 0 remaining
- (P4-1 closed iter 71 — `FlipsResponse.message` field.)

## Recommended Fix Order (iter 73+)

Iter 71 (DONE):
1. ✅ P3-3 — EventManager thread-safety (`threading.RLock`, +4 tests).
2. ✅ P3-4 — SnapshotManager atomic swap (`_SnapshotState` tuple, +8 tests).
3. ✅ P3-5 — Full `/flips` integration test (+18 tests). Found + fixed P4-1 along the way.
4. ✅ P2-1 step 1 — Extract `ExchangeTabContent` (dashboard-page.tsx 1685 → 1466 lines).

Iter 72 (DONE):
1. ✅ P2-1 step 2 — Extract `CurrenciesTabContent` (~65 lines, ~170-line new file). tsc 0, jest 324 pass.
2. ✅ P2-1 step 3 — Extract `UniquesTabContent` (~48 lines) + `OverviewTabContent` (~20 lines). 14 unused imports cleaned. dashboard-page.tsx 1466 → 1370 lines. tsc 0, jest 324 pass.

Iter 73 (next, recommended):
1. **P2-1 step 4** — Extract `DashboardToolbar` (TabsList + category-filter chips + comparison/alerts/keyboard-shortcuts button row, ~120 lines), `DashboardDialogs` (the 6 dialog wrappers, ~70 lines), and optionally `useDashboardData` custom hook (the ~250 lines of `useQuery`/memo wiring). Target: dashboard-page.tsx ≤700 lines → P2-1 closed.
2. **P3-7** — Once P2-1 fully closed, delete `REFACTOR_PLAN.md` + `worklog.md`. Update `AGENT_NAVIGATION.md` §6 documentation map.

After all P2/P3 closed → switch focus to product features (see `PRODUCT_VISION.md` F1-F6):
- F1 — Translate remaining ~276 items (parse `poe2db.tw/ru/`).
- F2 — UI tab «Storage Value» (backend endpoint already ready).
- F3 — `content_pulse` module (turnover by mechanic, 7d/30d rolling).
- F4 — «Что фармить сегодня» widget on the main dashboard.
- F5 — Speculation tab with z-score BUY/SELL/HOLD signals.
- F6 — Phase-aware hints (Temporalis mid/late league, etc.).

## Estimation (rough, updated iter 72)

| Bucket | Issues remaining | Estimated iterations | Risk |
|--------|------------------|---------------------|------|
| P0 | 0 | 0 | — |
| P1 | 0 | 0 | — |
| P2 | 1 (P2-1, multi-iter; steps 1-3 done, step 4 next) | 1 iteration | Low — extraction pattern proven in iter 71-72 |
| P3 | 1 (P3-7, deferred) | 0 iterations (folded into iter 73 after P2-1 closes) | — |

**Total:** ~1 iteration remaining to clean state. Each iteration = 1+ commit, 1 STATUS.md update.

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
- [ ] If issue adds thread-safety — regression test must run real threads and assert no `KeyError` / `dict changed size during iteration` / partial-state observation
- [ ] If issue adds an atomic-swap pattern — regression test must run real threads and assert readers never observe mixed (old value, new ts) state
