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
