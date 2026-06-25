# Worklog — PoE2 Market Dashboard

> Append-only shared multi-agent work log. Each section starts with `---`.
> Old task history is in `git log`.

---
Task ID: iter-74
Agent: main (Sonnet 4.5)
Task: iter 74 — Implement F2 (Storage Value UI tab) and attempt F1 (additional RU translations).

Work Log:
- Cloned repo, read STATUS.md / PRODUCT_VISION.md / AGENT_NAVIGATION.md to understand current state.
- Confirmed backlog is empty (P0-P4 all closed). Next focus = product features F1-F6.
- F1 research: analyzed cache-snapshot.json — all 138 unique api_ids already translated. The "276 missing" baseline comes from iter 32 (625 total API items). Without live poe2scout.com + poe2db.tw/ru/ access, cannot reliably extend translations. Deferred to iter 75+ with documented rationale.
- F2 implementation (primary deliverable):
  - Added 41 new i18n keys per locale (en/ru/zh/ko) for Storage Value tab: `tabStorageValue`, `fallbackStorageValue`, `storageValueTitle`, `storageValueSubtitle`, `storageValueCurrencyLabel`, `storageValueHorizonLabel`, `storageValueQuantityLabel`, `storageValueCompute`, `storageValueRefresh`, `storageValueDecisionTitle`, `storageValueDecisionBuyHold/SellConvert/Neutral`, `storageValueDecisionBuyHoldHint/SellConvertHint/NeutralHint`, `storageValueMetricsTitle`, `storageValueCurrentPrice`, `storageValueProjectedPrice`, `storageValueRiskDiscount`, `storageValueAdjustedPrice`, `storageValueNetValue`, `storageValueRatio`, `storageValueTotalsTitle`, `storageValueInputsTitle`, `storageValueMomentum`, `storageValueVolatility`, `storageValueAcceleration`, `storageValueLiquidity`, `storageValueSignificance`, `storageValueOfflineTitle`, `storageValueOfflineDesc`, `storageValueNoData`, `storageValueError`, `storageValueLoading`, `storageValueMirrorCompare`, `storageValueHinekoraCompare`.
  - Discovered and reused existing locale keys: `storageValueTotalCurrent` / `storageValueTotalProjected` / `storageValueTotalNet` (already defined in all 4 locales from the old forecast tab — kept the existing short labels and removed my duplicate declarations).
  - Extended `StorageValueResponse` type in `src/lib/types.ts` with optional `totalCurrentValue` / `totalProjectedValue` / `totalNetValue` fields — these are returned by the backend (see `routes_storage_value.py` lines 134-137) but were missing from the TS type.
  - Created `src/components/dashboard/storage-value-tab.tsx` (~470 lines): lazy-loadable, ErrorBoundary-compatible. UI: currency picker (Select + free-text Input fallback) + horizon picker (1/6/24/48/168h presets) + quantity Input + Compute/Refresh buttons. Result section: decision card (BUY_HOLD/SELL_CONVERT/NEUTRAL with colored badge + icon + hint), projection breakdown (MetricRow subcomponent with optional delta %), holdings totals (TotalCell grid, ×quantity), inputs panel (InputCell grid: momentum/volatility/acceleration/liquidity/horizon/α). Graceful degradation: backendOffline → offline card; data_available=false → "no price history" notice; other errors → error card.
  - Wired tab into `dashboard-page.tsx`: added `StorageValueTab` lazy-load via `next/dynamic` (line 81-86); added `<TabsContent value="storage-value">` after Analyst tab (line 1151-1156); added `"storage-value"` to `TAB_MAP` at index 9 for keyboard shortcut navigation (line 767).
  - Added tab trigger in `dashboard-toolbar.tsx`: imported `Gem` icon from lucide-react; added `<TabsTrigger value="storage-value">` between Analyst and Liquid Chain triggers.
  - Created `src/__tests__/storage-value-tab.test.tsx` (~280 lines, 12 tests). Coverage: backend offline (renders offline notice + doesn't call fetchApi), loading state, BUY_HOLD/SELL_CONVERT/NEUTRAL decision badges, projection breakdown (current + projected price), holdings totals (Total Current/Projected/Net), inputs panel (Momentum/Volatility/Acceleration labels), no-data state, fetchApi path + query params verification.
- Verification:
  - `npx tsc --noEmit` → 0 errors.
  - `npx jest` → 336 pass (324 baseline + 12 new Storage Value tests). 0 fail.
- Documentation updates:
  - `STATUS.md`: rewrote with cleaner structure — separate "Technical-debt backlog (empty)" section, "Product Features (F1-F6)" status table, refreshed Quick Reference (removed obsolete P-IDs, added Storage Value tab entry).
  - `PRODUCT_VISION.md`: bumped "Last updated" to iter 74. Reordered F2 before F1 in roadmap and marked F2 as ✅ DONE. Updated F1 with "BLOCKED" status + iter 74 rationale. Updated §4 architecture table (Storage Value UI row marked ✅). Updated §6 Product DoD — F2 partially checked (decision card done, historical chart TODO).
  - `AGENT_NAVIGATION.md`: bumped "Last updated" to iter 74. Added storage-value-tab.tsx row to §1 "Where Things Are". Updated dashboard-page.tsx row (line count 1201 → 1216). Added invariant #27 (Storage Value tab wiring). Cleaned up §4 Quick Reference (removed obsolete P-ID references, added Storage Value "no price history" entry).
- Created `worklog.md` (was deleted in iter 73 per P3-7) — this file.

Stage Summary:
- **F2 (Storage Value UI tab) — DONE.** New tab fully wired, tested, documented. All 4 locales have full translations. 12 jest tests pass. tsc 0 errors.
- **F1 (additional RU translations) — DEFERRED to iter 75+.** Blocked on live poe2scout.com + poe2db.tw/ru/ access. Documented in STATUS.md and PRODUCT_VISION.md.
- **Baseline:** jest 336 pass (+12), tsc 0 errors, pytest + e2e not re-run (frontend-only changes).
- **Files changed/created (8 total):**
  - `src/components/dashboard/storage-value-tab.tsx` (NEW, ~470 lines)
  - `src/__tests__/storage-value-tab.test.tsx` (NEW, ~280 lines)
  - `src/components/dashboard/dashboard-page.tsx` (modified: +14 lines — lazy-load, TabsContent, TAB_MAP)
  - `src/components/dashboard/dashboard-toolbar.tsx` (modified: +6 lines — Gem icon + tab trigger)
  - `src/lib/types.ts` (modified: +4 lines — 3 optional total* fields on StorageValueResponse)
  - `src/lib/i18n/locales/en.ts` (modified: +38 lines — 41 new keys, removed 3 duplicates)
  - `src/lib/i18n/locales/ru.ts` (modified: +38 lines — 41 new keys, removed 3 duplicates)
  - `src/lib/i18n/locales/zh.ts` (modified: +38 lines — 41 new keys, removed 3 duplicates)
  - `src/lib/i18n/locales/ko.ts` (modified: +38 lines — 41 new keys, removed 3 duplicates)
  - `STATUS.md` (rewritten — cleaner structure)
  - `PRODUCT_VISION.md` (updated — F2 marked DONE, F1 marked BLOCKED)
  - `AGENT_NAVIGATION.md` (updated — iter 74 wiring + invariant #27)
  - `worklog.md` (NEW — this file)

Next iteration (iter 75) — recommended priorities:
1. **F1** — When live API access is available, run a one-shot script to enumerate all 625 POE2Scout api_ids + fetch RU names from poe2db.tw/ru/ for the ~276 missing. Update `currency_names.json` + bump the assertion counts in `tests/test_currency_names_ru.py`.
2. **F2 follow-up** — Add historical chart of `currency/mirror` and `currency/hinekora` ratios over time (requires a new backend endpoint `/api/v1/storage-value/{currency}/history` that returns the time-series of `price(currency)/price(mirror)` computed from the SQLite price history).
3. **F3** — `backend/economy/content_pulse.py` module: daily turnover snapshot per category, 7d/30d rolling averages + delta. New route `/api/v1/content-pulse`.
4. **Optional tech debt** — `useDashboardData` hook extraction (~250 lines of useQuery/memo wiring from `dashboard-page.tsx`). Staged approach: (1) flipperBackend queries, (2) realms/leagues queries, (3) derived memos. Verify tsc + jest after each stage.

---
Task ID: iter-75
Agent: main (Sonnet 4.5)
Task: iter 75 — Implement F2 follow-up (historical chart) + F3 (content_pulse module + endpoint).

Work Log:
- Read STATUS.md / PRODUCT_VISION.md / AGENT_NAVIGATION.md / worklog.md (iter 74 record) to understand state.
- Confirmed F1 still BLOCKED on live API access — skipped per the iter 74 recommendation.
- Verified baseline: pytest 496 pass (pre-iter-75), jest 336 pass, tsc 0 errors.
- Installed missing `aiosqlite` in the venv (was the only blocker for backend tests).

- **F3 (content_pulse)** — implemented first because it's backend-only (no frontend coupling):
  - Created `backend/economy/content_pulse.py` (~340 lines) — pure function `compute_content_pulse(snapshot, config, now=None)` returning per-category turnover + 7d/30d rolling + delta_pct + signal + top_rising/falling movers. Helper functions: `_bucketize_price_logs`, `_rolling_mean`, `_price_trend_pct`, `_signal_from_delta`, `_category_today_volume`, `_category_daily_volumes`, `_top_movers`. Tunable constants at module top: `SIGNAL_RISING_THRESHOLD_PCT=10.0`, `SIGNAL_FALLING_THRESHOLD_PCT=-10.0`, `TOP_N_PER_CATEGORY=3`.
  - Added Pydantic response models in `backend/api/response_models.py`: `ContentPulseMoverData`, `ContentPulseCategoryData`, `ContentPulseResponse`.
  - Created `backend/api/routes_content_pulse.py` — thin route handler `GET /api/v1/content-pulse`. Returns `data_available=false` + empty list when snapshot not loaded.
  - Registered router in `backend/main.py` (after the SSE router, inside try/except for graceful degradation).
  - Created `tests/test_content_pulse.py` — 44 tests across 8 classes: `TestBucketizePriceLogs` (6), `TestRollingMean` (4), `TestPriceTrendPct` (7), `TestSignalFromDelta` (6), `TestCategoryAggregation` (4), `TestTopMovers` (4), `TestComputeContentPulse` (10), `TestRouteHandler` (3 async smoke tests).
  - Fixed two test failures during dev: (1) sort key was double-negated (used `-abs(d)` + `reverse=True` instead of `abs(d)` + `reverse=True`); (2) route handler test used fixed 2026-06-08 dates that fell outside the rolling-7d window when run on the actual test date — switched to `datetime.now(timezone.utc)`.

- **F2 follow-up (storage-value history)** — backend + frontend:
  - Created `backend/economy/storage_value_history.py` (~170 lines) — pure function `compute_storage_value_history(snapshot, currency, mirror_api_id="mirror", hinekora_api_id="hinekoras-lock", days=30, now=None)`. For each point in the currency's price history, finds the nearest mirror/hinekora price point within a 24h tolerance via `_find_nearest_price()`. Returns points with `mirror_price=None` / `ratio_mirror=None` when no match within tolerance (keeps the chart x-axis continuous).
  - Added Pydantic response models in `backend/api/response_models.py`: `StorageValueHistoryPoint`, `StorageValueHistoryResponse`.
  - Extended `backend/api/routes_storage_value.py` with a new route handler `GET /api/v1/storage-value/{currency}/history?days=30` (max 90 to match `historical_retention_days`). Returns empty points + `data_available=false` when snapshot not loaded or computation fails.
  - Created `tests/test_storage_value_history.py` — 24 tests across 4 classes: `TestFindNearestPrice` (5), `TestComputeHistoryBasic` (5), `TestComputeHistoryEdgeCases` (10), `TestHistoryRouteHandler` (4 async tests).
  - Created Next.js proxy route `src/app/api/flipper/storage-value/[currency]/history/route.ts` — uses `proxyWithFallback` with an empty `points: []` + `dataAvailable: false` offline/insufficient fallback.
  - Added TypeScript types in `src/lib/types.ts`: `StorageValueHistoryPoint`, `StorageValueHistoryResponse`.
  - Created `src/components/dashboard/storage-value-history-chart.tsx` (~290 lines) — dependency-free SVG line chart with two paths (mirror blue, hinekora emerald). Uses `<path d="M...L...">` with `M` commands for gaps (null ratios). Graceful degradation: loading → spinner text; <2 points → "no history" notice; all-null ratios → "no reference data" notice. Legend + point count rendered below the chart. `data-testid="storage-value-history-chart-svg"` for test scoping (lucide icons also render `<svg><path/></svg>` which would inflate naive selectors).
  - Wired chart into `storage-value-tab.tsx` — added a second `useQuery` bound to `["storageValueHistory", currencyInput]` (60s staleTime, longer than the main query's 30s). Chart renders below the existing "storage-value reference reminder" card, only when `dataAvailable` is true on the main query (so the chart doesn't show "no history" when the whole tab is in the offline / no-data branch).
  - Created `src/__tests__/storage-value-history-chart.test.tsx` — 11 tests covering loading, empty, single-point, all-null-ratios, both-ratios, mirror-only, hinekora-only, SVG path count (scoped via data-testid), title, subtitle, point count.
  - Added 8 new i18n keys per locale (en/ru/zh/ko): `storageValueHistoryTitle`, `storageValueHistorySubtitle`, `storageValueHistoryEmpty`, `storageValueHistoryNoRatios`, `storageValueHistoryLoading`, `storageValueHistoryMirrorLine`, `storageValueHistoryHinekoraLine`, `storageValueHistoryPointCount`. Verified parity across all 4 locales with a Python script.
  - Fixed one test failure during dev: existing `storage-value-tab.test.tsx` tests still passed because the new history query gracefully degrades when `mockFetchApi` returns the existing `buyHoldResponse` (which has no `points` field) — `historyData?.points ?? []` resolves to `[]`, chart renders the "no history" notice, doesn't break the existing decision-card assertions.

- Verification:
  - `npx tsc --noEmit` → 0 errors.
  - `npx jest` → 347 pass (336 baseline + 11 new chart tests). 0 fail.
  - `pytest tests/ --ignore=tests/e2e` → 564 pass (496 baseline + 44 content_pulse + 24 storage_value_history). 0 fail.
  - Confirmed both new routes registered: `GET /api/v1/storage-value/{currency}/history` + `GET /api/v1/content-pulse`.

- Documentation updates:
  - `STATUS.md`: rewrote F2/F3 rows to ✅ Done, added 3 new Quick Reference entries (history chart, content-pulse, delta_7d_pct null).
  - `PRODUCT_VISION.md`: bumped "Last updated" to iter 75. Updated §4 architecture table (added storage_value_history.py + content_pulse.py + storage-value/{currency}/history route + content-pulse route; Storage Value UI row marked ✅ with chart). Rewrote F2 + F3 sections with iter 75 implementation details. Updated §6 Product DoD — F2 fully checked, F3 backend noted as ready for F4 widget consumption.
  - `AGENT_NAVIGATION.md`: bumped "Last updated" to iter 75. Added 4 new rows to §1 (content_pulse.py, storage_value_history.py, routes_content_pulse.py, routes_storage_value.py update). Added storage-value-history-chart.tsx row. Added invariants #28 (Storage Value History endpoint) + #29 (Content Pulse endpoint). Added 3 new Quick Reference entries. Added 2 new endpoints to §5 API table.
  - `worklog.md`: appended this iter 75 record.

Stage Summary:
- **F2 follow-up (Storage Value historical chart) — DONE.** New endpoint `/api/v1/storage-value/{currency}/history?days=30` + SVG line chart in the Storage Value tab. 24 pytest + 11 jest tests.
- **F3 (content_pulse module + endpoint) — DONE.** New `backend/economy/content_pulse.py` pure function + `GET /api/v1/content-pulse` route. 44 pytest tests. Categories sorted by |delta_7d_pct|, each with signal (rising/falling/stable) + top-3 movers.
- **F1 (additional RU translations) — STILL BLOCKED.** No change from iter 74 — needs live poe2scout.com + poe2db.tw/ru/ access.
- **Baseline:** pytest 564 pass (+68), jest 347 pass (+11), tsc 0 errors.
- **Files changed/created (14 total):**
  - `backend/economy/content_pulse.py` (NEW, ~340 lines)
  - `backend/economy/storage_value_history.py` (NEW, ~170 lines)
  - `backend/api/routes_content_pulse.py` (NEW, ~55 lines)
  - `backend/api/routes_storage_value.py` (modified: +60 lines — history route)
  - `backend/api/response_models.py` (modified: +40 lines — ContentPulse* + StorageValueHistory* models)
  - `backend/main.py` (modified: +6 lines — register content_pulse router)
  - `tests/test_content_pulse.py` (NEW, ~580 lines, 44 tests)
  - `tests/test_storage_value_history.py` (NEW, ~410 lines, 24 tests)
  - `src/app/api/flipper/storage-value/[currency]/history/route.ts` (NEW, ~45 lines)
  - `src/components/dashboard/storage-value-history-chart.tsx` (NEW, ~290 lines)
  - `src/components/dashboard/storage-value-tab.tsx` (modified: +25 lines — history query + chart render)
  - `src/lib/types.ts` (modified: +25 lines — StorageValueHistoryPoint + StorageValueHistoryResponse)
  - `src/lib/i18n/locales/{en,ru,zh,ko}.ts` (modified: +8 keys × 4 locales = +32 lines)
  - `src/__tests__/storage-value-history-chart.test.tsx` (NEW, ~175 lines, 11 tests)
  - `STATUS.md` (rewritten — F2/F3 marked Done)
  - `PRODUCT_VISION.md` (updated — F2 + F3 marked Done)
  - `AGENT_NAVIGATION.md` (updated — iter 75 wiring + invariants #28, #29)
  - `worklog.md` (this record)

Next iteration (iter 76) — recommended priorities:
1. **F4** — Main dashboard widget «Что фармить сегодня». The F3 backend is now ready — build a card on the main dashboard that consumes `/api/v1/content-pulse` and shows 1-2 rising + 1-2 falling mechanics with rationale (top_rising / top_falling items per category).
2. **F1** — Still blocked on live API access. When available: write `scripts/sync_currency_names_from_poe2db.py` to enumerate all 625 POE2Scout api_ids + fetch RU names from poe2db.tw/ru/ for the ~276 missing. Update `currency_names.json` + bump assertion counts in `tests/test_currency_names_ru.py`.
3. **F5** — Speculation tab with z-score signals (BUY/SELL/HOLD). Extends existing flips-tab.
4. **F6** — Phase-aware hints (Temporalis mid/late league, skill gems 18-20 lvl). Uses PhaseDetector.
5. **Optional tech debt** — `useDashboardData` hook extraction (~250 lines of useQuery/memo wiring from `dashboard-page.tsx`). Staged approach: (1) flipperBackend queries, (2) realms/leagues queries, (3) derived memos. Verify tsc + jest after each stage. Not blocking — file is now legitimate parent wiring.

NOT done in iter 75 (intentionally deferred):
- F1 (blocked on live API access)
- F4 widget (next logical step — needs F3 endpoint which is now ready)
- F5 / F6 (further out in roadmap)
- e2e tests not run (frontend changes are unit-tested via jest; e2e would require a running backend + browser)
- useDashboardData hook extraction (optional, deferred)

---
Task ID: iter-76
Agent: main (Sonnet 4.5)
Task: iter 76 — Implement F4 (Main dashboard widget «Что фармить сегодня») consuming the iter-75 `/api/v1/content-pulse` endpoint.

Work Log:
- Read STATUS.md / PRODUCT_VISION.md / AGENT_NAVIGATION.md / worklog.md (iter 74 + iter 75 records) to understand state.
- Confirmed F3 backend ready (44 pytest tests pass, endpoint `/api/v1/content-pulse` registered). F4 widget is the next logical step — surfaces F3 data on the dashboard's main landing view.
- Verified baseline before changes: tsc 0 errors, jest 347 pass (336 baseline from iter 73 + 11 from iter 75 chart).
- Skipped F1 (still BLOCKED on live poe2scout.com + poe2db.tw/ru/ access — no change from iter 75).

- **F4 (Content Pulse widget)** — implementation:
  - **Next.js proxy route** — `src/app/api/flipper/content-pulse/route.ts` (~30 lines). Uses `proxyWithFallback` with an empty `categories: []` + `dataAvailable: false` offline/insufficient-data fallback — same pattern as the storage-value-history proxy from iter 75. No query params (the backend takes none).
  - **TypeScript types** — added `ContentPulseMover`, `ContentPulseCategory`, `ContentPulseResponse` interfaces to `src/lib/types.ts`. Mirror the Pydantic `ContentPulseMoverData` / `ContentPulseCategoryData` / `ContentPulseResponse` models from iter 75. Backend snake_case → frontend camelCase transform happens in `flipper-proxy.ts:transformKeys` (existing invariant #1).
  - **Widget component** — `src/components/dashboard/content-pulse-widget.tsx` (~400 lines):
    - Two-column card layout: RISING (emerald, top_rising categories) + FALLING (red, top_falling categories). Each category block shows `delta_7d_pct` badge + per-item `trend_pct` for top-3 movers + volume/item-count meta footer.
    - `useQuery` bound to `["contentPulse"]`, 60s staleTime (rolling 7d average changes slowly), retry: 1 for transient blips.
    - `maxPerSide` prop (default 2) caps categories per column — keeps the 1-glance UX per PRODUCT_VISION §3.6 ("killer feature" must be one-glance).
    - Stable categories (|delta_7d_pct| < 10%) filtered out as noise.
    - Graceful degradation (5 branches): backendOffline → compact amber notice (no full-card takeover); loading → spinner text; error → error card + refresh; data_available=false → "no data yet"; all-stable → "no signals today"; empty top_rising/top_falling → "no movers" per category.
    - Footer with `fetched_at` timestamp + refresh button.
  - **Wiring** — modified `src/components/dashboard/overview-tab-content.tsx` to mount `<ContentPulseWidget>` FIRST (above `<MarketOverview>`), wrapped in its own `<ErrorBoundary fallbackTitle={t("fallbackContentPulse")}>` so a render failure doesn't blank out the rest of the Overview tab. Overview tab is the default landing view per dashboard-page.tsx TAB_MAP — widget is visible on first dashboard load.
  - **i18n** — 17 new keys × 4 locales (en/ru/zh/ko): `contentPulseTitle`, `contentPulseSubtitle`, `contentPulseRising`, `contentPulseFalling`, `contentPulseNoRising`, `contentPulseNoFalling`, `contentPulseNoMovers`, `contentPulse7d`, `contentPulseVolumeToday`, `contentPulseItems`, `contentPulseNoData`, `contentPulseNoSignals`, `contentPulseLoading`, `contentPulseError`, `contentPulseOffline`, `contentPulseRefresh`, `contentPulseFetchedAt` + `fallbackContentPulse` (ErrorBoundary fallback). Verified parity via ripgrep (17/17/17/17).
  - **Tests** — `src/__tests__/content-pulse-widget.test.tsx` (~425 lines, 16 tests): offline / loading / error / no-data / no-signals / mixed (rising+falling+stable categories) / maxPerSide cap / refresh button visibility / refresh triggers refetch / empty-movers notice / fetched-at footer / proxy path / title / item-count meta. Test data covers all 5 graceful-degradation branches + the happy path with mixed signals.
    - One test failure during dev: error-state test timed out because the widget's `retry: 1` overrides the QueryClient's `retry: false` default. Fixed by adding `ERROR_WAIT_OPTS = { timeout: 5000 }` to the error-state `waitFor` call — react-query v5 single-retry settles in ~1s.

- Verification:
  - `npx tsc --noEmit` → 0 errors.
  - `npx jest` → 363 pass (347 baseline + 16 new content-pulse-widget tests). 0 fail.
  - F3 backend untouched (no pytest rerun needed — F4 is frontend-only).
  - Confirmed new proxy route registered: `GET /api/flipper/content-pulse`.

- Documentation updates:
  - `STATUS.md`: rewrote F4 row to ✅ Done with iter 76 implementation details. Added 2 new Quick Reference entries (widget "no signals today" + widget "no movers" per category). Bumped "Last updated" to iter 76.
  - `PRODUCT_VISION.md`: bumped "Last updated" to iter 76. Updated §4 architecture table (Content Pulse widget row marked ✅, added full-tab TODO row). Rewrote F4 section with iter 76 implementation details. Updated §6 Product DoD — point 3 (card on main dashboard) marked ✅.
  - `AGENT_NAVIGATION.md`: bumped "Last updated" to iter 76. Added content-pulse-widget.tsx row to §1. Updated overview-tab-content.tsx row (now 3 panels, widget mounted FIRST). Added invariant #30 (Content Pulse widget wiring). Added 2 new Quick Reference entries. Added `/api/flipper/content-pulse` row to Frontend-only routes table.
  - `worklog.md`: appended this iter 76 record.

Stage Summary:
- **F4 (Content Pulse widget) — DONE.** Two-column "Что фармить сегодня" card mounted on the Overview tab, visible on first dashboard load. 16 jest tests pass. tsc 0 errors.
- **F1 (additional RU translations) — STILL BLOCKED.** No change from iter 75 — needs live poe2scout.com + poe2db.tw/ru/ access.
- **Baseline:** jest 363 pass (+16), tsc 0 errors. pytest + e2e not re-run (frontend-only changes).
- **Files changed/created (10 total):**
  - `src/app/api/flipper/content-pulse/route.ts` (NEW, ~30 lines)
  - `src/components/dashboard/content-pulse-widget.tsx` (NEW, ~400 lines)
  - `src/components/dashboard/overview-tab-content.tsx` (modified: +9 lines — ContentPulseWidget import + ErrorBoundary-wrapped mount above MarketOverview)
  - `src/lib/types.ts` (modified: +55 lines — ContentPulseMover + ContentPulseCategory + ContentPulseResponse)
  - `src/lib/i18n/locales/en.ts` (modified: +17 lines — 17 new content-pulse keys + fallbackContentPulse)
  - `src/lib/i18n/locales/ru.ts` (modified: +17 lines)
  - `src/lib/i18n/locales/zh.ts` (modified: +17 lines)
  - `src/lib/i18n/locales/ko.ts` (modified: +17 lines)
  - `src/__tests__/content-pulse-widget.test.tsx` (NEW, ~425 lines, 16 tests)
  - `STATUS.md` (rewritten — F4 marked Done)
  - `PRODUCT_VISION.md` (updated — F4 marked Done)
  - `AGENT_NAVIGATION.md` (updated — iter 76 wiring + invariant #30)
  - `worklog.md` (this record)

Next iteration (iter 77) — recommended priorities:
1. **F5** — Speculation tab with z-score signals (BUY/SELL/HOLD). Extends existing flips-tab. Backend needs `z-score` computation in `backend/economy/pricing.py` (per PRODUCT_VISION §3.2 + §4 architecture table "Z-score / percentile TODO").
2. **F1** — Still blocked on live API access. When available: write `scripts/sync_currency_names_from_poe2db.py` to enumerate all 625 POE2Scout api_ids + fetch RU names from poe2db.tw/ru/ for the ~276 missing. Update `currency_names.json` + bump assertion counts in `tests/test_currency_names_ru.py`.
3. **F6** — Phase-aware hints (Temporalis mid/late league, skill gems 18-20 lvl). Uses PhaseDetector from `backend/economy/lifecycle.py`. Could be a small widget below the Content Pulse widget on the Overview tab, or a banner in the Speculation tab.
4. **Full Content Pulse tab** — The F4 widget is the 1-glance MVP per §3.6. A full tab (all categories, sortable, filterable, with per-category drill-down) could be added later if the widget proves useful.
5. **Optional tech debt** — `useDashboardData` hook extraction (~250 lines of useQuery/memo wiring from `dashboard-page.tsx`). Staged approach: (1) flipperBackend queries, (2) realms/leagues queries, (3) derived memos. Verify tsc + jest after each stage. Not blocking — file is now legitimate parent wiring.

NOT done in iter 76 (intentionally deferred):
- F1 (blocked on live API access)
- F5 / F6 (further out in roadmap)
- Full Content Pulse tab (the F4 widget is the MVP; full tab deferred until product feedback)
- e2e tests not run (frontend changes are unit-tested via jest; e2e would require a running backend + browser)
- useDashboardData hook extraction (optional, deferred)
- Visual verification with real backend data (jest tests use mocked data; visual polish — colors, spacing, responsive layout on narrow screens — needs manual review against real /api/v1/content-pulse response)

---
Task ID: iter-77
Agent: main (Sonnet 4.5)
Task: iter 77 — Implement F5 (Speculation tab with z-score BUY/SELL/HOLD signals) per PRODUCT_VISION §3.2 + §4 architecture table "Z-score / percentile TODO".

Work Log:
- Read STATUS.md / PRODUCT_VISION.md / AGENT_NAVIGATION.md / worklog.md (iter 74/75/76 records) to understand state.
- Confirmed F1 still BLOCKED on live API access — skipped per the iter 76 recommendation.
- F5 was the recommended priority for iter 77 — implemented end-to-end (backend pure function + route handler + Pydantic models + tests + Next.js proxy + UI tab + i18n + jest tests).
- Verified baseline before changes: pytest 564 pass (after installing missing aiosqlite into the venv), jest 363 pass, tsc 0 errors.

- **Backend — `backend/economy/pricing.py`** (extended, F5 foundation):
  - Added two new pure helpers at the bottom of the module:
    - `compute_zscore(prices, current)` — population std (ddof=0) z-score. Skips None/NaN/non-finite entries. Returns None when <2 valid points OR std=0 (all prices identical) OR current is non-finite. Minimum 2 valid points for non-None result.
    - `compute_percentile(prices, current)` — linear-interpolation percentile (numpy default). Returns float in [0, 100]. Handles single-point distribution, duplicate prices, unsorted input.
  - Updated module docstring to document the new helpers.
  - Added `import math` and `Sequence` from typing.

- **Backend — `backend/economy/speculation.py`** (NEW, ~280 lines):
  - Pure function `compute_speculation_signals(snapshot, config, *, days=30, limit=50, signal_filter="ALL", now=None)`.
  - Module-level tunable constants (NOT in config.yaml — same convention as content_pulse.py):
    - `Z_BUY_THRESHOLD = -1.5`, `Z_SELL_THRESHOLD = 1.5`
    - `MAX_HISTORY_POINTS = 14` (mini-sparkline slice)
    - `MIN_SAMPLE_SIZE = 2`, `DEFAULT_DAYS = 30`, `DEFAULT_LIMIT = 50`
  - Internal helpers: `_extract_prices(price_logs, now, days)` (filters by time window, parses ISO strings + datetime objects, accepts both PascalCase and snake_case keys), `_signal_from_zscore(z)`, `_horizon_hint(z)` (short/medium/long/unknown based on |z|), `_build_signal_entry(...)` (assembles per-item signal dict).
  - Returns dict shape: `{league, signals: [...], data_available, fetched_at, days}`. Signals sorted by |z_score| desc. Items with std=0 or <2 valid points are excluded (no actionable signal).

- **Backend — `backend/api/routes_speculation.py`** (NEW, ~95 lines):
  - Route handler `GET /api/v1/speculation?days=30&limit=50&signal=ALL`.
  - FastAPI Query validation: `days: int = Query(30, ge=1, le=90)`, `limit: int = Query(50, ge=1, le=500)`, `signal: str = Query("ALL", pattern="^(ALL|BUY|SELL|HOLD)$")`.
  - Returns `data_available=false` + empty signals list when snapshot not loaded (same pattern as content_pulse route).
  - Try/except wraps `compute_speculation_signals` — on exception logs error + returns empty response (no 500).

- **Backend — `backend/api/response_models.py`** (extended):
  - Added 3 new Pydantic models: `SpeculationPriceHistoryPoint`, `SpeculationSignalData`, `SpeculationResponse`. All fields documented with `Field(description=...)` for OpenAPI generation.

- **Backend — `backend/main.py`** (extended):
  - Registered `routes_speculation.router` after `routes_content_pulse.router` (inside try/except for graceful degradation).

- **Backend — `tests/test_pricing.py`** (extended):
  - Added 22 new tests in 2 classes: `TestComputeZscore` (10 tests) + `TestComputePercentile` (12 tests). Coverage: empty input, single point, identical prices (std=0), current at mean/above/below, None/NaN filtering, non-finite current, two-point minimum, extreme z, percentile at min/max/median/interpolated, single-point distribution, unsorted input, duplicate prices.

- **Backend — `tests/test_speculation.py`** (NEW, ~580 lines, 43 tests):
  - 6 test classes: `TestExtractPrices` (6), `TestSignalFromZscore` (5), `TestHorizonHint` (4), `TestBuildSignalEntry` (8), `TestComputeSpeculationSignals` (16), `TestRouteHandler` (4 async smoke tests).
  - Tests use the same `SimpleNamespace`-based mock pattern as `tests/test_content_pulse.py` — no real DataSnapshot needed.
  - Coverage: empty snapshot, single currency BUY/SELL/HOLD, multi-currency sort by |z|, days window filtering, limit cap, signal filter (BUY/SELL/ALL/invalid), std=0 exclusion, insufficient history exclusion, snake_case key fallback, days/limit clamping, route handler smoke (no snapshot / with snapshot / query param forwarding / exception).
  - One test fix during dev: route handler tests needed explicit `days=30, limit=50, signal="ALL"` args because FastAPI `Query()` default values are Query objects (not the wrapped values) when the handler is called directly without going through FastAPI's dependency injection.

- **Frontend — `src/lib/types.ts`** (extended):
  - Added 5 new types: `SpeculationPriceHistoryPoint`, `SpeculationSignalType` (union "BUY"|"SELL"|"HOLD"), `SpeculationHorizonHint` (union "short"|"medium"|"long"|"unknown"), `SpeculationSignal`, `SpeculationResponse`. Mirror the Pydantic models after snake_case → camelCase transform by `flipper-proxy.ts:transformKeys`.

- **Frontend — `src/app/api/flipper/speculation/route.ts`** (NEW, ~45 lines):
  - Next.js proxy with `proxyWithFallback`. Forwards all query params (`days`, `limit`, `signal`) to `/api/v1/speculation`. Empty `signals: []` + `dataAvailable: false` + `days: <requested>` offline/insufficient-data fallback.

- **Frontend — `src/components/dashboard/speculation-tab.tsx`** (NEW, ~490 lines):
  - UI tab with:
    - Filter chips (ALL / BUY / SELL / HOLD) — click to re-fetch with new `signal` param.
    - Days selector (Select with 7 / 14 / 30 / 90 presets).
    - Refresh button.
    - Signal list — each row shows: signal badge (BUY/SELL/HOLD with icon + color), item text + category (title-cased), z-score (signed, colored by signal), percentile, sample size + mean ± std + current price + horizon hint, mini-sparkline (dependency-free SVG, last 14 price points, color-coded by signal).
    - Footer with `fetchedAt` timestamp + signal count.
  - `useQuery` bound to `["speculation", days, signalFilter]`, 30s staleTime, retry: 1.
  - Lazy-loaded via `next/dynamic` in `dashboard-page.tsx`.
  - Wrapped in `<ErrorBoundary fallbackTitle={t("fallbackSpeculation")}>` so a render error doesn't crash the whole dashboard.
  - Graceful degradation (5 branches): backendOffline → offline card + start-backend hint; loading → spinner text; error → error card + refresh; data_available=false → "no data yet" notice; empty signals → "no actionable signals" notice.
  - `Sparkline` is a dependency-free internal subcomponent — renders SVG `<path>` from price points. Empty-sparkline fallback (dashed horizontal line) when <2 points.

- **Frontend — `src/components/dashboard/dashboard-page.tsx`** (modified):
  - Added `SpeculationTab` lazy-load via `next/dynamic` (line 88-93, after `StorageValueTab`).
  - Added `<TabsContent value="speculation">` after the storage-value tab (line 1168-1173), wrapped in `<ErrorBoundary>`.
  - Added `"speculation"` to `TAB_MAP` at index 9 (between `storage-value` and `liquid-chain`) — keeps the analytics cluster together (storage-value → speculation).

- **Frontend — `src/components/dashboard/dashboard-toolbar.tsx`** (modified):
  - Imported `Sparkles` from lucide-react.
  - Added `<TabsTrigger value="speculation">` between the Storage Value and Liquid Chain triggers.

- **Frontend — i18n** (4 locales updated, +29 keys each):
  - Added `fallbackSpeculation` to the ErrorBoundary fallback titles block.
  - Added 28 new keys for the speculation tab: `tabSpeculation`, `speculationTitle`, `speculationSubtitle`, `speculationOffline`, `speculationOfflineHint`, `speculationLoading`, `speculationError`, `speculationNoData`, `speculationNoSignals`, `speculationRefresh`, `speculationFetchedAt`, `speculationSignalCount`, `speculationFilterLabel`, `speculationFilterAll`, `speculationFilterBuy`, `speculationFilterSell`, `speculationFilterHold`, `speculationDaysLabel`, `speculationDaysValue`, `speculationZScoreTitle`, `speculationPercentileTitle`, `speculationSampleSize`, `speculationMean`, `speculationStd`, `speculationCurrent`, `speculationHorizonShort`, `speculationHorizonMedium`, `speculationHorizonLong`, `speculationHorizonUnknown`.
  - Verified parity via ripgrep: 28/28/28/28 speculation keys per locale + 1 fallbackSpeculation = 29 in each of en/ru/zh/ko.

- **Frontend — `src/__tests__/speculation-tab.test.tsx`** (NEW, ~340 lines, 18 tests):
  - Coverage: backend offline / loading / error + refresh / no-data / mixed (BUY+SELL+HOLD) signals / BUY/SELL/HOLD badges / z-score + percentile values / filter chips / days selector / sparkline SVG / empty-sparkline fallback / signal count + fetched-at footer / proxy path / no-signals notice / BUY filter click → fetchApi with signal=BUY / category title-case / sample-size + mean + std + current stats / horizon hint localized.
  - Used `getAllByText` instead of `getByText` for tests where multiple signals share the same value (e.g. all three signals in `mixedResponse` have `category: "ritual"`, `sampleSize: 14`, etc.) — initial 5 test failures during dev were all of this kind.

- Verification:
  - `node node_modules/typescript/bin/tsc --noEmit` → 0 errors.
  - `node node_modules/jest/bin/jest.js` → 381 pass (363 baseline + 18 new speculation-tab tests). 0 fail.
  - `PYTHONPATH=. python -m pytest tests/ --ignore=tests/e2e` → 629 pass (564 baseline + 22 new pricing tests + 43 new speculation tests). 0 fail.
  - Confirmed new route registered: `GET /api/v1/speculation`.

- Documentation updates:
  - `STATUS.md`: bumped "Last updated" to iter 77. F5 row marked ✅ Done with iter 77 implementation details. Added 3 new Quick Reference entries (speculation endpoint "data_available=false", "no actionable signals", "z-score is null").
  - `PRODUCT_VISION.md`: bumped "Last updated" to iter 77. Updated §4 architecture table (Z-score / percentile row marked ✅ with `compute_zscore` + `compute_percentile` helpers; added `/api/v1/speculation` row; Speculation UI tab row marked ✅). Rewrote F5 section with iter 77 implementation details. Updated §6 Product DoD — point 4 (Speculation tab) marked ✅.
  - `AGENT_NAVIGATION.md`: bumped "Last updated" to iter 77. Updated `pricing.py` row (added `compute_zscore` + `compute_percentile`). Added 2 new rows to §1 (speculation.py + routes_speculation.py). Added speculation-tab.tsx row. Added invariant #31 (Speculation tab wiring). Added 3 new Quick Reference entries. Added `/api/v1/speculation` row to API table. Added `/api/flipper/speculation` row to frontend-only routes table.
  - `worklog.md`: appended this iter 77 record.

Stage Summary:
- **F5 (Speculation tab with z-score BUY/SELL/HOLD signals) — DONE.** Full backend + frontend implementation. New endpoint `GET /api/v1/speculation?days=30&limit=50&signal=ALL`. New UI tab at `src/components/dashboard/speculation-tab.tsx`. 43 pytest + 22 pricing + 18 jest tests. tsc 0 errors.
- **F1 (additional RU translations) — STILL BLOCKED.** No change from iter 76 — needs live poe2scout.com + poe2db.tw/ru/ access.
- **Baseline:** pytest 629 pass (+65), jest 381 pass (+18), tsc 0 errors.
- **Files changed/created (16 total):**
  - `backend/economy/pricing.py` (modified: +130 lines — `compute_zscore` + `compute_percentile` + docstring + `import math, Sequence`)
  - `backend/economy/speculation.py` (NEW, ~280 lines)
  - `backend/api/routes_speculation.py` (NEW, ~95 lines)
  - `backend/api/response_models.py` (modified: +40 lines — 3 Speculation models)
  - `backend/main.py` (modified: +6 lines — register speculation router)
  - `tests/test_pricing.py` (modified: +120 lines — 22 new tests in 2 classes)
  - `tests/test_speculation.py` (NEW, ~580 lines, 43 tests)
  - `src/app/api/flipper/speculation/route.ts` (NEW, ~45 lines)
  - `src/components/dashboard/speculation-tab.tsx` (NEW, ~490 lines)
  - `src/components/dashboard/dashboard-page.tsx` (modified: +12 lines — lazy-load + TabsContent + TAB_MAP)
  - `src/components/dashboard/dashboard-toolbar.tsx` (modified: +6 lines — Sparkles icon + tab trigger)
  - `src/lib/types.ts` (modified: +60 lines — 5 new Speculation types)
  - `src/lib/i18n/locales/en.ts` (modified: +30 lines — 28 speculation keys + fallbackSpeculation)
  - `src/lib/i18n/locales/ru.ts` (modified: +30 lines)
  - `src/lib/i18n/locales/zh.ts` (modified: +30 lines)
  - `src/lib/i18n/locales/ko.ts` (modified: +30 lines)
  - `src/__tests__/speculation-tab.test.tsx` (NEW, ~340 lines, 18 tests)
  - `next-env.d.ts` (NEW — Next.js auto-generated TypeScript reference file, normally created by `next dev`/`next build`; created manually here because the dev environment didn't have one yet. NOT a code change — this file is in `.gitignore` for many Next.js projects but is checked-in here per the existing repo state.)
  - `STATUS.md` (updated — F5 marked Done + 3 Quick Reference entries)
  - `PRODUCT_VISION.md` (updated — F5 marked Done + §4 architecture table + §6 DoD point 4)
  - `AGENT_NAVIGATION.md` (updated — iter 77 wiring + invariant #31 + 3 Quick Reference entries + 2 API rows)
  - `worklog.md` (this record)

Next iteration (iter 78) — recommended priorities:
1. **F6** — Phase-aware hints (Temporalis mid/late league, skill gems 18-20 lvl). Uses `PhaseDetector` from `backend/economy/lifecycle.py`. Could be a small widget below the Content Pulse widget on the Overview tab, or a banner inside the Speculation tab that highlights phase-relevant items (e.g. when phase=LATE, surface Temporalis-like items in the BUY list). Smallest viable scope: a static info banner that shows current phase + a bulleted list of phase-aware farming hints from a hardcoded table in `backend/economy/lifecycle.py` or a new `backend/economy/phase_hints.py` module.
2. **F1** — Still blocked on live API access. When available: write `scripts/sync_currency_names_from_poe2db.py` to enumerate all 625 POE2Scout api_ids + fetch RU names from poe2db.tw/ru/ for the ~276 missing. Update `currency_names.json` + bump assertion counts in `tests/test_currency_names_ru.py`.
3. **F5 backtest** — PRODUCT_VISION §3.2 mentions backtesting z-score signals on previous-league data to measure profitability. Could be a separate `/api/v1/speculation/backtest` endpoint or a CLI script. Not blocking — F5 ship is already useful without it.
4. **Full Content Pulse tab** — The F4 widget is the 1-glance MVP per §3.6. A full tab (all categories, sortable, filterable, with per-category drill-down) could be added if the widget proves useful.
5. **Optional tech debt** — `useDashboardData` hook extraction (~250 lines of useQuery/memo wiring from `dashboard-page.tsx`). Staged approach: (1) flipperBackend queries, (2) realms/leagues queries, (3) derived memos. Verify tsc + jest after each stage. Not blocking — file is now legitimate parent wiring.

NOT done in iter 77 (intentionally deferred):
- F1 (blocked on live API access)
- F6 (next logical step — uses PhaseDetector)
- F5 backtest (optional, deferred)
- Full Content Pulse tab (the F4 widget is the MVP; full tab deferred until product feedback)
- e2e tests not run (frontend changes are unit-tested via jest; e2e would require a running backend + browser)
- useDashboardData hook extraction (optional, deferred)
- Visual verification with real backend data (jest tests use mocked data; visual polish — colors, spacing, responsive layout on narrow screens — needs manual review against real /api/v1/speculation response)
