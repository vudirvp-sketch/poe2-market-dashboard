# STATUS.md — Known Issues & Refactoring Backlog

> **Last updated:** 2026-06-25 (iter 72 — P2-1 steps 2+3 done)
> Single source of truth for known bugs and refactoring priorities.
> Update BEFORE fixing any issue. Cross-reference issue IDs in commits.

---

## P0 — Critical (correctness, stability) — 0 active

All P0 issues resolved in iter 54-58.

---

## P1 — Serious (performance, maintainability) — 0 active

All P1 issues resolved in iter 54-66.

---

## P2 — Medium (clean code, dev experience) — 1 item (in progress)

- **P2-1.** `dashboard-page.tsx` — god-component. Split into tab-specific subcomponents.
  - **Iter 71 step 1 DONE** — extracted `ExchangeTabContent` (256 lines moved out; dashboard-page.tsx 1685 → 1466).
  - **Iter 72 steps 2+3 DONE** — extracted `CurrenciesTabContent` (~65 lines), `UniquesTabContent` (~48 lines), `OverviewTabContent` (~20 lines). Cleaned up 14 unused imports. dashboard-page.tsx 1466 → 1370 lines.
  - **Remaining** — file is still 1370 lines (target was ≤700). The remainder is legitimate parent wiring: state declarations (~50 lines), data hooks (~250 lines), derived/computed values (~150 lines), keyboard-shortcut/handlers (~120 lines), Header JSX (~70 lines), TabsList + buttons row (~120 lines), TabsContent wrappers for already-extracted tabs + lazy-loaded tabs (~140 lines), dialogs (~70 lines). To reach ≤700 in iter 73+ as P2-1 step 4, extract the next-largest inline JSX blocks: (a) the TabsList + category-filter + comparison/alerts button row → `DashboardToolbar`, (b) the dialog wrappers → `DashboardDialogs`, (c) optionally pull the 14 `useQuery`/derived-data hooks into a `useDashboardData` custom hook.

> **P2-3 (closed iter 70):** `currency_names_ru.py` was a 966-line hardcoded Python dict. Now a 63-line thin loader reading from `currency_names.json`.

> **P2-8 (closed iter 69):** `proxyWithFallback` is mode-aware — non-503 5xx pass through unchanged in dev, return 200+`X-Flipper-Fallback` header in prod.

---

## P3 — Low priority (nice-to-have) — 1 item remaining

- **P3-7.** `REFACTOR_PLAN.md` and `worklog.md` — delete after closing all P2/P3 issues. (Still deferred — P2-1 step 4 may stretch into iter 73.)

> **P3-3 (closed iter 71):** `EventManager` now uses `threading.RLock` for all in-memory `_events` access. The lock is never held across an `await` — SQLite writes happen outside the lock. +4 regression tests in `tests/test_events.py::TestThreadSafety`.

> **P3-4 (closed iter 71):** `SnapshotManager` now stores `(snapshot, ts)` in an immutable `_SnapshotState` dataclass swapped atomically via single attribute assignment. +8 regression tests in `tests/test_snapshot_atomic_swap.py`.

> **P3-5 (closed iter 71):** Full `/flips` integration test added: `tests/test_flips_integration.py` (+18 tests).

---

## P4 — Documentation / minor cosmetic — 0 remaining

> **P4-1 (closed iter 71):** `FlipsResponse.message` field added so the route's `data_available=false` message is no longer stripped by Pydantic.

---

## Fixed (recent — older history in git log)

### iter 72 — P2-1 steps 2+3 done

- **P2-1 step 2** — Extracted `CurrenciesTabContent` from `dashboard-page.tsx` (~65 lines of inline JSX → new `src/components/dashboard/currencies-tab-content.tsx`, ~170 lines incl. typed `CurrenciesTabContentProps` interface). Pure presentational — all state (data, pagination, loading, search, virtualization flag, highlight, dense mode, i18n) passed in as props. Replaced inline JSX with `<CurrenciesTabContent {...props} />`. Verified: `npx tsc --noEmit` 0 errors, `npm test` 324 pass.
- **P2-1 step 3** — Extracted `UniquesTabContent` (~48 lines → `uniques-tab-content.tsx`, ~135 lines) and `OverviewTabContent` (~20 lines → `overview-tab-content.tsx`, ~75 lines). Both follow the same props-passing pattern as `ExchangeTabContent`/`CurrenciesTabContent`.
- **Import cleanup.** Removed 14 unused imports from `dashboard-page.tsx` left behind by the iter 71 + iter 72 extractions: `CurrencyCard`, `VirtualCurrencyGrid`, `UniqueTable`, `ExchangePairCard`, `ExchangeTable`, `MarketOverview`, `Pagination`, `VolumeLiquidityIndicators`, `ComparativeChart`, `ApiErrorFallback`, `EmptyState`, `DataFreshnessBadge`, `CurrencyGridSkeleton`, `UniqueTableSkeleton`, `ExchangeGridSkeleton`, `ExchangeTableSkeleton`, plus the `Filter`, `List`, `LayoutGrid` lucide icons and `Input` UI component (all only used inside the extracted tab components now).
- **Final state:** dashboard-page.tsx 1466 → 1370 lines (-96). Still above the ≤700 target — remainder is legitimate parent wiring (state, hooks, handlers, Header, dialogs, TabsList row). Further extraction (toolbar + dialogs + `useDashboardData` hook) deferred to iter 73 as P2-1 step 4.
- Baseline: jest **324 pass** (unchanged — pure presentational refactor), tsc **0 errors** (unchanged), pytest + e2e not re-run (frontend-only changes).

### iter 71 — closed P3-3, P3-4, P3-5, P4-1 + P2-1 step 1

- **P3-3** — `EventManager` thread-safety: `threading.RLock` guards all in-memory `_events` dict access. +4 regression tests in `tests/test_events.py::TestThreadSafety`.
- **P3-4** — `SnapshotManager` atomic swap: `(snapshot, ts)` wrapped in immutable `_SnapshotState`. +8 regression tests in `tests/test_snapshot_atomic_swap.py`.
- **P3-5** — Full `/flips` integration tests added in `tests/test_flips_integration.py` (+18 tests).
- **P4-1** — `FlipsResponse.message` field added; regenerated `openapi_schema.json` + `src/lib/api-types.ts`.
- **P2-1 step 1** — Extracted `ExchangeTabContent` (256 lines of inline JSX → new `src/components/dashboard/exchange-tab-content.tsx`). dashboard-page.tsx: 1685 → 1466 lines.
- Baseline: pytest **496 pass** (+30), jest **324 pass**, tsc **0 errors**, e2e 30 pass.

### iter 70 — P2-3 closed (currency_names_ru → JSON)

- **P2-3.** `currency_names_ru.py` shrank **966 → 63 lines**. Data lives in `currency_names.json`. +7 regression tests.
- New `PRODUCT_VISION.md` at repo root.

### Earlier fixes

P2-8 (iter 69), P2-9/P2-6/P2-4 (iter 67), P0-1..P0-6, P1-1/2/4/7/8/11, P2-7/10/11/12/13/14, P2-2/5, P3-8 (iter 54-69). See git log.

---

## Quick Reference — Frequent Problems

| Symptom | Cause | Where to fix |
|---------|-------|--------------|
| `test_scheduler.py` collection fails | `aiosqlite` not installed in env | `pip install aiosqlite` (or run inside `.venv` created by `start.sh`) |
| `/optimizer/path` returns empty path with `data_available: true` | Profitable arbitrage cycle detected — fall back to `direct_rate` (P1-8) | `backend/api/routes_optimizer.py:_bellman_ford` |
| SQLite `near "LIMIT": syntax error` | Use `rowid IN (SELECT ... LIMIT ?)` pattern, not `DELETE ... LIMIT ?` | `backend/data/historical.py:_prune_old_league_data` |
| LightGBM skips training for new currency | Below `lightgbm_min_data_points` (15) — adaptive fallback now trains from `floor` (5) with minimal features (P2-9) | `backend/predictors/time_series.py:train` |
| Need to inspect circuit breaker state | `GET /api/flipper/health/circuit-breakers` returns JSON snapshot (P2-6) | `src/app/api/flipper/health/circuit-breakers/route.ts` |
| Want advanced `/flips` filters | All scanner params are on `/api/v1/arbitrage/flips` (P2-4). The `message` field is now exposed on `FlipsResponse` (P4-1). | `backend/api/routes_arbitrage.py:get_flip_opportunities` |
| Adding a new Russian translation | Edit `backend/data/currency_names.json` (NOT the `.py` loader). Run `pytest tests/test_currency_names_ru.py`. | `backend/data/currency_names.json` |
| Concurrent EventManager access raises `KeyError` / `dict changed size during iteration` | (Fixed iter 71 — was P3-3) All in-memory access now guarded by `threading.RLock` | `backend/economy/events.py` |
| `SnapshotManager.get_snapshot` fast-path returns stale snapshot paired with fresh ts | (Fixed iter 71 — was P3-4) `(snapshot, ts)` now wrapped in immutable `_SnapshotState` swapped atomically | `backend/api/data_snapshot.py` |
