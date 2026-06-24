# STATUS.md — Known Issues & Refactoring Backlog

> **Last updated:** 2026-06-25 (iter 73 — P2-1 + P3-7 closed; backlog empty)
> Single source of truth for known bugs and refactoring priorities.
> Update BEFORE fixing any issue. Cross-reference issue IDs in commits.

---

## P0 — Critical (correctness, stability) — 0 active

All P0 issues resolved in iter 54-58.

---

## P1 — Serious (performance, maintainability) — 0 active

All P1 issues resolved in iter 54-66.

---

## P2 — Medium (clean code, dev experience) — 0 active

All P2 issues resolved. Most recent: **P2-1 closed iter 73** (see Fixed section below).

> **P2-1 (closed iter 73):** `dashboard-page.tsx` god-component split into 6 presentational subcomponents over iter 71-73. Final size 1201 lines (was 1685 in iter 70). Optional follow-up: `useDashboardData` hook extraction (~250 lines of `useQuery`/memo wiring) — deferred to iter 74+ due to interdependency risk.

> **P2-3 (closed iter 70):** `currency_names_ru.py` was a 966-line hardcoded Python dict. Now a 63-line thin loader reading from `currency_names.json`.

> **P2-8 (closed iter 69):** `proxyWithFallback` is mode-aware — non-503 5xx pass through unchanged in dev, return 200+`X-Flipper-Fallback` header in prod.

---

## P3 — Low priority (nice-to-have) — 0 active

All P3 issues resolved. Most recent: **P3-7 closed iter 73** — deleted `REFACTOR_PLAN.md` and `worklog.md` after all P2/P3 issues were closed.

> **P3-3 (closed iter 71):** `EventManager` now uses `threading.RLock` for all in-memory `_events` access. The lock is never held across an `await` — SQLite writes happen outside the lock. +4 regression tests in `tests/test_events.py::TestThreadSafety`.

> **P3-4 (closed iter 71):** `SnapshotManager` now stores `(snapshot, ts)` in an immutable `_SnapshotState` dataclass swapped atomically via single attribute assignment. +8 regression tests in `tests/test_snapshot_atomic_swap.py`.

> **P3-5 (closed iter 71):** Full `/flips` integration test added: `tests/test_flips_integration.py` (+18 tests).

> **P3-7 (closed iter 73):** `REFACTOR_PLAN.md` and `worklog.md` deleted — scratch-pad docs no longer needed with an empty backlog. For old task history see `git log`.

---

## P4 — Documentation / minor cosmetic — 0 active

> **P4-1 (closed iter 71):** `FlipsResponse.message` field added so the route's `data_available=false` message is no longer stripped by Pydantic.

---

## Fixed (recent — older history in git log)

### iter 73 — P2-1 step 4 + P3-7 closed (backlog empty)

- **P2-1 step 4a** — Extracted `DashboardToolbar` (227 lines). Owns the TabsList (10 tab triggers), the 4 action buttons (keyboard-shortcuts help / price alerts / item comparison / pair comparison), and the category-filter chip strip (visible only on currencies/uniques tabs). Pure presentational — all state and callbacks passed in as props. dashboard-page.tsx 1370 → 1247 (-123).
- **P2-1 step 4b** — Extracted `DashboardDialogs` (168 lines). Bundles the 8 dialog/sheet/banner primitives at the bottom of the Dashboard render tree: DetailDialog, PairDetailDialog, ComparisonDialog, PairComparisonDialog, PriceAlertDialog, EventsSidebar, OfflineBanner, ShortcutsDialog. Each open/close flag is a prop. dashboard-page.tsx 1247 → 1201 (-46).
- **P2-1 step 4c — DEFERRED.** The `useDashboardData` hook extraction (~250 lines of `useQuery`/memo wiring) was deferred to iter 74+. Rationale: the queries and memos have deep interdependencies with store state (exchangePairs memo filters by `uiState.exchange.activeFilter`/`favorites`/`extendedFilters`; `clientOptimalResult` memo depends on `crossRates` + `exchangeData`; `optimalPaymentByPair` merges backend + client results). Pulling them into a hook in a single iter would require a ~15-input / ~25-output API surface and risk subtle breakage. Per the user's "Лучше недоделать, чем сломать" rule, deferred.
- **Import cleanup** — removed 14 unused imports from `dashboard-page.tsx`: 13 lucide icons (Coins / Shield / ArrowLeftRight / Star / BarChart3 / GitCompare / Bell / TrendingUp / Route / Network / Keyboard / LineChart / Droplets — moved into `dashboard-toolbar.tsx`); `TabsList` + `TabsTrigger` (only used inside `DashboardToolbar` now); `Badge` (only used in category chips); `Button` (only used in toolbar action buttons); `DetailDialog` / `PairDetailDialog` / `ComparisonDialog` / `PairComparisonDialog` / `PriceAlertDialog` / `ShortcutsDialog` / `EventsSidebar` / `OfflineBanner` (all moved into `dashboard-dialogs.tsx`).
- **P3-7 closed** — `REFACTOR_PLAN.md` and `worklog.md` deleted via `git rm`. References cleaned up in `README.md` (doc table), `PRODUCT_VISION.md` (related-docs section), `AGENT_NAVIGATION.md` §6 (doc map).
- **P2-1 closed.** Cumulative iter 71-73: dashboard-page.tsx 1685 → 1201 lines (-484). 6 presentational subcomponents extracted: `ExchangeTabContent`, `CurrenciesTabContent`, `UniquesTabContent`, `OverviewTabContent`, `DashboardToolbar`, `DashboardDialogs`. The remainder is legitimate parent wiring: state declarations, `useQuery` hooks, derived memos, keyboard handlers, Header JSX, TabsContent wrappers, the `<DashboardToolbar />` + `<DashboardDialogs />` calls. Further size reduction would require the deferred `useDashboardData` hook.
- Baseline: jest **324 pass** (unchanged — pure presentational refactor + doc cleanup), tsc **0 errors** (unchanged), pytest + e2e not re-run (frontend-only changes).

### iter 72 — P2-1 steps 2+3 done

- **P2-1 step 2** — Extracted `CurrenciesTabContent` from `dashboard-page.tsx` (~65 lines of inline JSX → new `src/components/dashboard/currencies-tab-content.tsx`, ~170 lines incl. typed `CurrenciesTabContentProps` interface). Pure presentational — all state (data, pagination, loading, search, virtualization flag, highlight, dense mode, i18n) passed in as props. Replaced inline JSX with `<CurrenciesTabContent {...props} />`. Verified: `npx tsc --noEmit` 0 errors, `npm test` 324 pass.
- **P2-1 step 3** — Extracted `UniquesTabContent` (~48 lines → `uniques-tab-content.tsx`, ~135 lines) and `OverviewTabContent` (~20 lines → `overview-tab-content.tsx`, ~75 lines). Both follow the same props-passing pattern as `ExchangeTabContent`/`CurrenciesTabContent`.
- **Import cleanup.** Removed 14 unused imports from `dashboard-page.tsx` left behind by the iter 71 + iter 72 extractions.
- **Final state:** dashboard-page.tsx 1466 → 1370 lines (-96).
- Baseline: jest **324 pass**, tsc **0 errors**, pytest + e2e not re-run.

### iter 71 — closed P3-3, P3-4, P3-5, P4-1 + P2-1 step 1

- **P3-3** — `EventManager` thread-safety: `threading.RLock` guards all in-memory `_events` dict access. +4 regression tests.
- **P3-4** — `SnapshotManager` atomic swap: `(snapshot, ts)` wrapped in immutable `_SnapshotState`. +8 regression tests.
- **P3-5** — Full `/flips` integration tests added (+18 tests).
- **P4-1** — `FlipsResponse.message` field added; regenerated `openapi_schema.json` + `src/lib/api-types.ts`.
- **P2-1 step 1** — Extracted `ExchangeTabContent` (256 lines of inline JSX → new `src/components/dashboard/exchange-tab-content.tsx`). dashboard-page.tsx: 1685 → 1466 lines.
- Baseline: pytest **496 pass** (+30), jest **324 pass**, tsc **0 errors**, e2e 30 pass.

### Earlier fixes

P2-3 (iter 70), P2-8 (iter 69), P2-9/P2-6/P2-4 (iter 67), P0-1..P0-6, P1-1/2/4/7/8/11, P2-7/10/11/12/13/14, P2-2/5, P3-8 (iter 54-69). See git log.

---

## Next Steps (iter 74+) — Product Features

Technical-debt backlog is fully closed. Switch focus to `PRODUCT_VISION.md` F1-F6:

1. **F1** — Translate remaining ~276 items (parse `poe2db.tw/ru/`). Edit `backend/data/currency_names.json`.
2. **F2** — Storage Value UI tab. Backend endpoint `/api/v1/storage-value/{currency}` is already ready — needs a UI tab.
3. **F3** — `content_pulse` module (turnover by mechanic, 7d/30d rolling).
4. **F4** — «Что фармить сегодня» widget on the main dashboard.
5. **F5** — Speculation tab with z-score BUY/SELL/HOLD signals.
6. **F6** — Phase-aware hints (Temporalis mid/late league, etc.).

Optional technical follow-up (not blocking):
- **`useDashboardData` hook** — pull ~250 lines of `useQuery`/memo wiring out of `dashboard-page.tsx`. Approach in stages: (1) flipperBackend queries, (2) realms/leagues queries, (3) derived memos. Verify build+tests after each stage.

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
| `dashboard-page.tsx` still 1201 lines after iter 73 | (P2-1 closed iter 73) Optional follow-up: extract `useDashboardData` hook. Not blocking. | `src/components/dashboard/dashboard-page.tsx` |
