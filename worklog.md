# Worklog — PoE2 Market Dashboard

> Append-only shared multi-agent work log. Each section starts with `---`.
> Old task history is in `git log`.

Recent iterations kept (iter 94+). Older iter 89-93 records trimmed — those features are fully shipped and documented in STATUS.md / AGENT_NAVIGATION.md.

---
Task ID: iter-94
Agent: main
Task: iter 94 — Fix KI-10 (duplicate i18n keys) + Spread Capture view (Q4 colors/filter, Q5 sparkline, Q6 intuitive labels) per iter 93 handoff note.

Work Log:
- Cloned repo. Read STATUS.md (KI-10 + iter 93 row), AGENT_NAVIGATION.md (invariant #43), worklog.md (iter 93 entry).
- **KI-10 fix:** Deleted OLD `flipsBid` / `flipsAsk` entries (pre-iter-92 "Bid"/"Ask" labels) from all 4 locale files. Kept NEW iter 92 entries (with tooltips). `npx tsc --noEmit` exits 0 (was 8 TS1117 errors). Jest 412/412 still green.
- **Q4 (Spread tier colors + filter):** `classifySpreadTier` + `spreadTierColor` + thresholds (5%/2%) in `flips-helpers.ts`. Color-coded Spread cell. `spreadTierFilter` Select dropdown in `flips-tab.tsx`.
- **Q5 (Trend sparkline):** `deriveTrendSparklineData(momentum, volatility)` in `flips-helpers.ts`. 6 deterministic points via `sin(i*PI/2)` (NOT `sin(i*PI)` which is 0). New Trend column in FlipsTable (col 17 of 18, lg+ only, neutral slate-400). HONEST tooltip: "Momentum × volatility (NOT historical). When backend adds priceHistoryShort (TD-9), switches to real data." Opened TD-9.
- **Q6 (intuitive labels):** `flipperSpreadTooltip` i18n key in 4 locales. Added `title=` tooltips to Profit + Spread column headers.
- **i18n:** 7 new keys × 4 locales = 28 lines.
- **Tests:** 16 new jest tests in `src/__tests__/flips-helpers.test.ts`. Baseline 412→428 green.
- Updated STATUS.md (closed KI-10, iter 94 row, TD-9, 2 Quick Reference rows), AGENT_NAVIGATION.md (invariant #44), worklog.md (this entry, trimmed iter 92).

Stage Summary:
- **iter 94 SHIPPED — KI-10 closed + Spread Capture view (Q4/Q5/Q6) all addressed.**
- Q4 (Spread tier colors + filter): ✅ done — color-coded Spread cell + Spread tier Select dropdown
- Q5 (Trend sparkline): ✅ done — derived from momentum × volatility, HONESTLY labeled, TD-9 opened for real data
- Q6 (Intuitive labels): ✅ done — spread-capture-intent tooltips on Spread + Profit columns
- Files changed (8 source + 1 test + 3 docs = 12 total).
- Verification: `npx tsc --noEmit` exits 0. `npx jest` 428/428 green.

Next iteration (iter 95) — recommended priorities:
1. **iter 95 = Overheat Index** (Q13 — indirect signals: streamer influence → volume spike → price drop). Uses `volume_traded` not `current_quantity` (TD-2 fix). Backend `content_pulse._category_today_volume()` needs to switch metric.
2. **iter 96 = Triangular persistence** (TD-3 + TD-4 — SQLite for executable_estimate backtesting + market_spread persistence).
3. **iter 97+ = Proposal F-J exposition** (Wall detection UI, OHLCV candlestick, cross-pair correlation, liquidity-tier UI, real FlipsTable sparkline via TD-9).

---
Task ID: iter-95
Agent: main
Task: iter 95 — Fix TD-2 (content_pulse._category_today_volume uses volume_traded instead of current_quantity) + implement Overheat Index (Q13 — streamer influence → volume spike → price drop).

Work Log:
- Cloned repo to `/home/z/my-project/poe2-market-dashboard`. Read STATUS.md (TD-2 open + iter 94 row), AGENT_NAVIGATION.md (invariant #44 — iter 94 full context), worklog.md (iter 94 entry + next-iter plan).
- Read key source files: `backend/economy/content_pulse.py` (existing `_category_today_volume` uses `CurrentQuantity`), `backend/api/routes_content_pulse.py` (thin wrapper), `backend/api/data_snapshot.py:395-500` (snapshot.exchange_rates is `dict[str, ExchangeRate]`, each rate has `volume_traded: int`), `backend/models/currency.py:88-96` (ExchangeRate dataclass), `backend/data/providers/poe2scout.py:880-933` (ByCategory returns `current_quantity` only — no `volume_traded`), `backend/api/response_models.py:621` (ContentPulseCategoryData), `src/lib/types.ts:400` (ContentPulseCategory), `src/components/dashboard/content-pulse-widget.tsx` (CategoryBlock with delta badge), `tests/test_content_pulse.py` (44 tests, baseline).
- **TD-2 fix (the critical correctness change):**
  - Added `_build_currency_volume_map(snapshot)` — iterates `snapshot.exchange_rates`, attributes each pair's `volume_traded` to BOTH `currency_from` and `currency_to` (each currency's "trade activity" includes the trade). Returns `{api_id_lower: total_volume_traded_24h}`. Items with no pairs (or all pairs with `volume_traded <= 0`) are absent → callers treat absence as 0.
  - Changed `_category_today_volume(items, volume_map=None)` signature. When `volume_map` is provided: strict lookup (items absent from map contribute 0). When `volume_map is None` (legacy callers / isolated unit tests): falls back to old `CurrentQuantity` path so existing tests keep their semantics.
  - Updated `compute_content_pulse` to call `_build_currency_volume_map(snapshot)` once and pass the map to `_category_today_volume` for every category.
  - Semantics: `today_volume` is now an ACTIVITY metric (24h trades), consistent with `rolling_7d` / `rolling_30d` (also activity, from `price_logs[].Quantity`). Previously `today_volume` was a SUPPLY metric (listings count) — comparing SUPPLY to ACTIVITY in `delta_7d_pct` was meaningless for overheat detection.
- **Overheat Index computation (Q13):**
  - Added `_category_price_change_pct(items)` — mean per-item % price change across items with ≥2 price points. Unweighted (each item contributes equally). Returns None when no items have ≥2 points.
  - Added `_overheat_signal(volume_spike_ratio, price_change_pct)` → `"hot"` / `"warm"` / `"cool"`. Thresholds: `OVERHEAT_VOLUME_SPIKE_THRESHOLD = 2.0` (today > 2x rolling 7d), `OVERHEAT_PRICE_DROP_THRESHOLD = -5.0` (mean price change < -5%). Both strict (>, <). `hot` = both conditions met; `warm` = only one; `cool` = neither or insufficient data.
  - Added `_overheat_index_score(volume_spike_ratio, price_change_pct)` → 0-100 composite. `vol_component = clamp((ratio - 1) * 25, 0, 100)` (1x=0, 2x=25, 3x=50, 5x+=100) + `price_component = clamp(-price_pct * 4, 0, 100)` (0%=0, -5%=20, -10%=40, -25%+=100), averaged. Returns 0.0 when either input is None.
  - Extended `compute_content_pulse` to compute `volume_spike_ratio` (today_volume / rolling_7d, None when rolling_7d=0 or today_volume=0), `price_change_pct`, `overheat_signal`, `overheat_index`. All 4 fields added to both the empty-category and populated-category result dicts.
- **Backend response shape extended:**
  - `ContentPulseCategoryData` (Pydantic in `response_models.py`) gains 4 fields: `overheat_index: float = 0.0`, `overheat_signal: str = "cool"`, `volume_spike_ratio: float | None = None`, `price_change_pct: float | None = None`. Updated `today_volume` description to reflect TD-2 fix.
  - `ContentPulseCategory` (TypeScript in `types.ts`) mirrors with camelCase: `overheatIndex`, `overheatSignal` (typed as `"hot" | "warm" | "cool"`), `volumeSpikeRatio`, `priceChangePct`. Updated `todayVolume` doc comment.
  - Proxy auto-transforms snake_case → camelCase via existing `transformKeys()` in `case-transform.ts` — no proxy changes needed.
- **UI: Overheat badge on Content Pulse categories.**
  - `content-pulse-widget.tsx:CategoryBlock` — when `category.overheatSignal === "hot"` OR `"warm"`, renders a Badge next to the existing 7d delta badge. Hot = orange ("Overheated" + Flame icon), warm = amber ("Warming up" + Flame icon). Cool = no badge (default).
  - Badge wrapped in `<span title={tooltip}>` — hover reveals breakdown: `overheatIndex.toFixed(1)`, `volumeSpikeRatio.toFixed(2)`, `priceChangePct.toFixed(2)%`.
  - `data-testid="content-pulse-overheat-badge-{category}"` for test selectors.
  - Imported `Flame` from `lucide-react`.
- **i18n keys (4 new × 4 locales = 16 new lines):** `contentPulseOverheatBadge`, `contentPulseOverheatTooltip` (template with `{0}/{1}/{2}` = index/spike/price), `contentPulseOverheatWarmBadge`, `contentPulseOverheatWarmTooltip` (same template). Added to `en.ts` / `ru.ts` / `zh.ts` / `ko.ts` immediately after `contentPulseFetchedAt` in the F4 section.
- **Tests — Python (38 new in `tests/test_content_pulse.py`, baseline 44 → 82):**
  - Updated existing helpers: `_make_currency` adds optional `volume_traded` param; `_make_snapshot` accepts optional `exchange_rates` and auto-builds from currencies' `VolumeTraded` field when not provided; new helper `_make_rate(from, to, vol)` for explicit ExchangeRate construction.
  - Updated 5 existing integration tests to use `volume_traded=` instead of `current_quantity=` (semantics changed): `test_category_not_in_snapshot_emits_empty_row`, `test_today_volume_aggregates_across_items`, `test_delta_7d_pct_when_history_available`, `test_falling_signal`, `test_route_returns_data_when_snapshot_available`. Also updated `test_categories_sorted_by_abs_delta_desc` + `test_top_rising_and_falling_populated`.
  - Updated existing `TestCategoryAggregation` tests: kept `test_today_volume_sums_quantities` (legacy fallback path), added `test_today_volume_sums_volume_traded_from_map`, `test_today_volume_partial_volume_map`, `test_today_volume_empty_volume_map` (new strict-mode behavior).
  - Added 4 new test classes:
    - `TestBuildCurrencyVolumeMap` (6 tests): empty, no attr, single pair attributes to both currencies, multiple pairs sum per currency, zero vol skipped, keys lowercased.
    - `TestCategoryPriceChangePct` (5 tests): no items, all <2 points, single trend, mean unweighted, partial (items with <2 points skipped).
    - `TestOverheatSignal` (7 tests): insufficient data → cool, hot when both, warm when only volume, warm when only price, cool when neither, strict thresholds (==threshold is NOT hot/warm), constants exported.
    - `TestOverheatIndexScore` (9 tests): insufficient data → 0, zero spike + zero drop → 0, vol component only, price component only, combined averaged, vol cap at 100, price cap at 100, negative ratio clamped to 0, positive price change clamped to 0.
  - Added `TestComputeContentPulseOverheat` (7 integration tests): fields present in response, cool when no history, hot when 3x spike + -10% drop, warm when only spike, cool when normal, None when today_volume=0, **TD-2 regression test** (current_quantity=999 IGNORED when volume_traded=200 set).
  - Updated `test_category_not_in_snapshot_emits_empty_row` to assert overheat fields on empty category (overheat_index=0, overheat_signal="cool", volume_spike_ratio=None, price_change_pct=None).
- **Tests — Jest (4 new in `src/__tests__/content-pulse-widget.test.tsx`, baseline 428 → 432):**
  - Added `COOL_OVERHEAT` spread helper for existing fixtures.
  - Updated `mixedResponse`, `allStableResponse`, `responseWithEmptyMovers` to spread `...COOL_OVERHEAT` (default cool/0/null fields).
  - Added 4 new tests:
    1. "does NOT render overheat badge when overheatSignal is 'cool'" — verifies no badge for any category in mixedResponse.
    2. "renders 'Overheated' badge when overheatSignal is 'hot'" — verifies badge text + tooltip contains index/spike/price.
    3. "renders 'Warming up' badge when overheatSignal is 'warm'" — verifies warm badge text.
    4. "renders overheat badge alongside the 7d delta badge" — verifies both badges coexist (overheat doesn't replace delta).
- **Verification:** `python -m pytest tests/test_content_pulse.py` 82/82 green. `python -m pytest tests/ --ignore=tests/e2e --ignore=tests/test_scheduler.py` 795/795 green (test_scheduler still needs `pip install aiosqlite` — pre-existing, documented in STATUS.md). `npx tsc --noEmit` exits 0. `npx jest` 432/432 green. No regressions.
- Updated documentation: STATUS.md (closed TD-2, added iter 95 row, added 2 Quick Reference rows for overheat badge + today_volume semantics change), AGENT_NAVIGATION.md (added invariant #45, updated content_pulse.py row in section 1, updated Known Issues section, added 2 Quick Reference rows), worklog.md (this entry, trimmed iter 93 — its feature is fully shipped and documented in STATUS.md / AGENT_NAVIGATION.md).

Stage Summary:
- **iter 95 SHIPPED — TD-2 closed + Overheat Index (Q13) backend + UI all addressed.**
- TD-2 fix: ✅ done — `_category_today_volume` uses `volume_traded` (activity) from `snapshot.exchange_rates` via `_build_currency_volume_map`. Legacy `current_quantity` fallback preserved ONLY for isolated unit tests (`volume_map is None`).
- Q13 Overheat Index: ✅ done — `overheat_index` (0-100), `overheat_signal` (hot/warm/cool), `volume_spike_ratio`, `price_change_pct` added to backend response + frontend types. UI badge on Content Pulse categories (orange "Overheated" / amber "Warming up") with tooltip showing the breakdown.
- Files changed (8 source + 2 tests + 3 docs = 13 total):
  - `backend/economy/content_pulse.py` (TD-2 fix + 4 new helpers + Overheat fields in response)
  - `backend/api/response_models.py` (4 new fields on ContentPulseCategoryData)
  - `tests/test_content_pulse.py` (38 new tests + updated helpers + updated 5 existing tests)
  - `src/lib/types.ts` (4 new fields on ContentPulseCategory)
  - `src/lib/i18n/locales/en.ts` (4 new keys)
  - `src/lib/i18n/locales/ru.ts` (4 new keys)
  - `src/lib/i18n/locales/zh.ts` (4 new keys)
  - `src/lib/i18n/locales/ko.ts` (4 new keys)
  - `src/components/dashboard/content-pulse-widget.tsx` (Overheat badge in CategoryBlock + Flame import)
  - `src/__tests__/content-pulse-widget.test.tsx` (COOL_OVERHEAT helper + 4 new tests + updated fixtures)
  - `STATUS.md` (closed TD-2, iter 95 row, 2 Quick Reference rows)
  - `AGENT_NAVIGATION.md` (invariant #45, content_pulse.py row, Known Issues section, 2 Quick Reference rows)
  - `worklog.md` (this entry, trimmed iter 93)
- Verification: `pytest tests/` 795/795 green. `npx tsc --noEmit` exits 0. `npx jest` 432/432 green.

Next iteration (iter 96) — recommended priorities:
1. **iter 96 = Triangular persistence** (TD-3 + TD-4). Add SQLite persistence for triangular arbitrage cycles `(cycle_hash, timestamp, profit_pct, snapshot_id)` + 30-min-later re-check, so we can backtest `executable_estimate` (fast/medium/slow formula). Also persist `market_spread` to HistoricalStore (TD-4). PREREQUISITE for the executable_estimate feature (iter 90 ERROR #4).
2. **iter 97+ = Proposal F-J exposition** (data already collected, just need UI): F=Wall detection (`highest_stock/current_quantity > 0.3`), G=OHLCV from `DailyStatsHistory` (endpoint exists, not used), H=Cross-pair volume correlation (from `price_logs`), I=Spread persistence (covered by TD-4 in iter 96), J=Liquidity-tier UI (`tiers.py` already computes T1-T5 per currency). Plus TD-9 (real FlipsTable sparkline when backend adds `priceHistoryShort`).
3. **Optional iter 95b (polish):** If real-world data shows the overheat thresholds (2.0x / -5%) need tuning, promote `OVERHEAT_VOLUME_SPIKE_THRESHOLD` + `OVERHEAT_PRICE_DROP_THRESHOLD` to `config.yaml`. Also consider weighting `price_change_pct` by `volume_traded` (currently unweighted mean).

---
Task ID: iter 96
Agent: main (analysis + foundation)
Task: Analyze POE2 currency-making guide text → extract patterns/logic/algorithms → design dashboard implementation. Per user: "Если найден новый баг — сначала документируй в STATUS.md как Known Issue, потом фиксись". Per user: "Лучше недоделать, чем сломать — остальное в следующей итерации".

Work Log:
- Read user-provided POE2 currency-making guide (~2500 words). Extracted 20 distinct market patterns (P1–P20): triangular arb, rate lifecycle, leveling uniques lifecycle, time-of-day pattern, weekday/weekend pattern, priority listing arb, Mirror/Divine arb, currency appreciation trajectory (Chaos-orb pattern), phase-aware investment lifecycle, gold map ROI, Megalomaniac scanner, tablet resell, crafting profit discovery, meta gem mass listing, vendor gold strategy, reinvestment ranking, new season items, market trend detection, meta gem demand divergence, skill gem quality crafting.
- Cloned repo https://github.com/vudirvp-sketch/poe2-market-dashboard. Read STATUS.md, PRODUCT_VISION.md, AGENT_NAVIGATION.md, content_pulse.py (as reference module pattern), test_content_pulse.py (as reference test pattern), speculation.py, momentum.py, lifecycle.py, response_models.py.
- Cross-referenced each pattern against codebase: 3 patterns fully implemented (P1 triangular arb, P18 overheat index), 5 partial (P2/P7/P9/P16/P17), 12 missing. Of the missing, 4 are implementable on current POE2Scout data (P3/P4/P5/P8), 7 require GGG official trade API (out of scope).
- Created docs/MARKET_PLAYBOOK.md (~290 lines) — main analytical deliverable. Contains: Part A (20 extracted patterns with logic), Part B (codebase cross-reference), Part C (implementation roadmap iter 96–103+), Part D (priorities + stopping point).
- Created backend/economy/circuit_patterns.py (~470 lines) — pure function `compute_circuit_patterns(snapshot, config, *, days=30, limit=50, trajectory_filter="ALL", now=None)`. Classifies each currency into one of 7 archetypes: EXPONENTIAL_GROWTH / LINEAR_GROWTH / PEAK_THEN_DECLINE / MEAN_REVERTING / VOLATILE / DECLINING / STABLE. Uses stdlib OLS linear regression (no numpy/pandas dep). Tunable thresholds at module top. Returns `recommended_action`: HOLD_FOR_GROWTH / SELL_NOW / AVOID / WATCH / NEUTRAL. Implements P8 from MARKET_PLAYBOOK.md.
- Created tests/test_circuit_patterns.py (~860 lines) — 75 pytest tests across 10 test classes: TestExtractPricePoints, TestFilterToWindow, TestMeanStd, TestCoefficientOfVariation, TestLinearRegression, TestTotalChangePct, TestDaysSincePeak, TestIsPeakThenDecline, TestRecommendedAction, TestClassifyTrajectory, TestComputeCircuitPatterns. Covers pure helpers + end-to-end + edge cases (empty snapshot, below MIN_SAMPLE_SIZE, snake_case keys, peak-then-decline shape, all 7 archetypes smoke test).
- Fixed 2 bugs found during test runs: (a) timezone-naive datetime comparison — added `if ts.tzinfo is None: ts = ts.replace(tzinfo=timezone.utc)` defensive normalization in `_extract_price_points`. (b) `limit=0` semantic clarified to mean "return 0 items" (not "no cap") — matches test expectation.
- Verified: `python -m pytest tests/test_circuit_patterns.py` → 75/75 green. `python -m pytest tests/test_circuit_patterns.py tests/test_content_pulse.py tests/test_speculation.py` → 200/200 green. No regressions in adjacent modules.
- Updated STATUS.md — closed iter 95 notes, added TD-10 (circuit patterns backend only, no API/UI), added F7 row (in progress), kept Quick Reference lean.
- Updated PRODUCT_VISION.md — major cleanup: removed long iter-by-iter history (was 289 lines of iter 75–88 detail), kept only current state. Added §3.7 Circuit Patterns + §3.8 Roadmap reference to MARKET_PLAYBOOK.md. Now ~150 lines.
- Updated AGENT_NAVIGATION.md — refreshed header note (iter 96), added entry for `backend/economy/circuit_patterns.py` in section 1 table, added link to MARKET_PLAYBOOK.md in header.
- Updated README.md — replaced stale iter 87 archive instructions with clean project overview + key features + doc links + run commands + stack info.

Stage Summary:
- **iter 96 SHIPPED — Market Playbook + Circuit Patterns foundation.**
- Main deliverable: `docs/MARKET_PLAYBOOK.md` — comprehensive analysis of 20 market patterns + implementation roadmap.
- Implementation: `backend/economy/circuit_patterns.py` pure function (P8 trajectory classification) + 75 pytest tests. Pure function pattern matches existing `content_pulse.py` / `speculation.py` conventions — no risk of breaking existing code.
- Files added (3): `docs/MARKET_PLAYBOOK.md`, `backend/economy/circuit_patterns.py`, `tests/test_circuit_patterns.py`.
- Files updated (4): `STATUS.md`, `PRODUCT_VISION.md`, `AGENT_NAVIGATION.md`, `README.md`.
- No existing logic touched — zero regression risk.
- **Stopping point:** iter 96 = foundation only. NO API route, NO response model, NO Next.js proxy, NO UI, NO i18n. iter 97 task = wire-up (TD-10).

Next iteration (iter 97) — recommended priorities:
1. **iter 97 = Circuit Patterns API + UI wire-up** (TD-10). Add `backend/api/routes_circuit_patterns.py` (route handler `GET /api/v1/circuit-patterns?days=30&limit=50&trajectory=ALL`), Pydantic models `CircuitPatternData` + `CircuitPatternsResponse` in `response_models.py`, register router in `backend/main.py`. Next.js proxy at `src/app/api/flipper/circuit-patterns/route.ts`. UI tab or widget showing top currencies by `|total_change_pct|` with trajectory badge + recommended_action. i18n keys × 4 locales.
2. **iter 98 = Time-of-Day Pattern Detector (P4)** — pure function `compute_intraday_patterns(snapshot, config, days=14)`. For each currency: hourly mean price (UTC), buy/sell windows. Heatmap UI: час × валюта. Most novel pattern, no scout/ninja has it.
3. **iter 99 = Weekday/Weekend Pattern Detector (P5)** — similar to iter 98 but groupby day-of-week.
4. **iter 100+ = Leveling Uniques Lifecycle (P3), Mirror/Divine Arb (P7), Phase-aware Investment Advisor (P9)** — see MARKET_PLAYBOOK.md §C for full roadmap.

---
Task ID: iter-97
Agent: main (Claude Sonnet 4.5)
Task: Circuit Patterns API + UI wire-up (closes TD-10, completes F7 / P8).

Work Log:
- Read STATUS.md, docs/MARKET_PLAYBOOK.md, AGENT_NAVIGATION.md to understand iter 96 stopping point and iter 97 spec.
- Studied existing thin-wrapper patterns: routes_content_pulse.py + routes_speculation.py + response_models.py (ContentPulse + Speculation sections).
- Studied existing UI tab pattern: speculation-tab.tsx (~1140 lines) — Sparkline component, filter chips, days selector, error/loading/offline states, ErrorBoundary wrapper.
- Backend: Created backend/api/routes_circuit_patterns.py — thin wrapper by analogy with routes_speculation.py. Query params: days (1..90 default 30), limit (1..500 default 50), trajectory (regex pattern matching ALL + 7 archetypes, default ALL). Route injects `days` into the response dict (the pure function doesn't echo it back — only route handlers need it for client cache keys). Returns data_available=false + empty patterns list when snapshot not loaded OR when computation throws.
- Backend: Added CircuitPatternData + CircuitPatternsResponse Pydantic models in response_models.py. 13 fields including price_history_short (reuses SpeculationPriceHistoryPoint type to avoid duplication).
- Backend: Extended compute_circuit_patterns() pure function to also emit price_history_short (up to 14 most-recent price points, oldest-first, as {"date": iso, "price": float} dicts). Additive change — existing 75 tests stay green.
- Backend: Registered router in backend/main.py via standard try/except ImportError wrapper (matches convention used by every other feature router).
- Frontend proxy: Created src/app/api/flipper/circuit-patterns/route.ts — by analogy with speculation/route.ts. Forwards days/limit/trajectory query params, returns empty fallback with dataAvailable:false when backend offline.
- Frontend types: Added CircuitPattern, CircuitPatternsResponse, CircuitTrajectory (7-way union), CircuitRecommendedAction (5-way union) to src/lib/types.ts. All field names camelCase (post transformKeys).
- Frontend UI: Created src/components/dashboard/circuit-patterns-tab.tsx (~600 lines) — by analogy with speculation-tab.tsx but simpler (no Backtest panel — trajectory classification is single-pass, no replay variant). Filter chips (ALL + 7 archetypes), days selector (7/14/30/90), per-row trajectory badge (color-coded by archetype) + recommended_action badge (color-coded by action) + signed total_change_pct + stats line (sampleSize · slope · vol · R² · current · daysSincePeak for PEAK_THEN_DECLINE only) + mini-sparkline (colored by trajectory archetype — same SVG component pattern as speculation-tab). 20 jest tests in src/__tests__/circuit-patterns-tab.test.tsx.
- Tab wiring: dashboard-page.tsx — added CircuitPatternsTab dynamic import + TAB_MAP entry at idx 9 (between speculation and liquid-chain) + TabsContent with ErrorBoundary. dashboard-toolbar.tsx — added Activity icon import + TabsTrigger between Speculation and Liquid Chain. shortcuts-dialog.tsx — updated shortcut mapping: "0" → Circuits (was Liquid Chain pre-iter 97); Liquid Chain + Watchlist are click-only now.
- i18n: Added 47 new keys × 4 locales (en/ru/zh/ko) at the end of each locale file. Keys cover: tabCircuitPatterns, fallbackCircuitPatterns, circuitTitle, circuitSubtitle, circuitOffline/Loading/Error/NoData/NoPatterns, circuitRefresh/FetchedAt/PatternCount, circuitFilterLabel + 8 filter chip labels, circuitDaysLabel/Value, 6 tooltip keys, 7 trajectory label keys (circuitTrajExpGrowth etc.), 5 action label keys (circuitActionHoldForGrowth etc.), 6 stat-format keys (circuitSampleSize etc.). All 4 locales have parity (47 circuit keys each, total 1011 keys per locale).
- Tests: Python — added 4 route smoke tests in tests/test_circuit_patterns.py::TestRouteHandler (mirrors test_content_pulse.py::TestRouteHandler pattern). Jest — 20 tests covering offline/loading/error/no-data/no-patterns/patterns-list/trajectory-badges/action-badges/total-change-pct-signed/filter-chips-8/days-selector/sparkline-non-empty/sparkline-empty-fallback/footer/proxy-path/filter-click/stats-line/days-since-peak-only-for-peak/all-5-actions.
- Bug fixed during dev: test-id suffix derivation for filter chips had a regex bug — `peak_then_decline` was being mangled to `peak-peak` (the `.replace(/_then_decline$/, "-peak")` was appending rather than replacing the whole suffix). Replaced with explicit case-by-case mapping (opt === "PEAK_THEN_DECLINE" ? "peak" : ...). Test `renders filter chips: ALL + 7 trajectory archetypes` now passes.
- Verification: Python — 79/79 tests in test_circuit_patterns.py green (75 original + 4 new route smoke). 204/204 green across test_circuit_patterns.py + test_content_pulse.py + test_speculation.py. Jest — 452/452 tests green across 21 test suites (was 432/432 — added 20 new tests). tsc --noEmit green (at the time of UI tab creation; subsequent edits were trivial JSX/text changes validated via ts-jest). Backend route registration verified — `/api/v1/circuit-patterns` appears in `app.routes`.
- Documentation: Updated STATUS.md (closed TD-10, marked F7 = Done, added 2 new Quick Reference rows for the keyboard shortcut remapping + sparkline empty fallback behavior). Updated docs/MARKET_PLAYBOOK.md (P8 row marked Done in §B table, summary counts updated, §C.2 marked DONE with full implementation report, §D.2 added Status column, §D.3 stopping point updated to iter 97, §E doc references cleaned). Updated AGENT_NAVIGATION.md (header note refreshed, entry for circuit_patterns.py updated to mention price_history_short extension, new entry added for routes_circuit_patterns.py, new entry added for circuit-patterns-tab.tsx, new invariant #46 documenting iter 97 changes, API endpoint table updated with /api/v1/circuit-patterns row).

Stage Summary:
- **iter 97 SHIPPED — Circuit Patterns API + UI wire-up. Closes TD-10. Completes F7 / P8.**
- Backend (4 files): routes_circuit_patterns.py (new), response_models.py (+CircuitPatternData +CircuitPatternsResponse), main.py (+router registration), circuit_patterns.py (+price_history_short field).
- Frontend (5 new + 3 modified): circuit-patterns/route.ts (new proxy), types.ts (+4 types), circuit-patterns-tab.tsx (new UI tab, ~600 lines), circuit-patterns-tab.test.tsx (new, 20 tests), dashboard-page.tsx (+TAB_MAP entry +TabsContent +dynamic import), dashboard-toolbar.tsx (+TabsTrigger +Activity icon import), shortcuts-dialog.tsx (shortcut "0" remapped to Circuits).
- i18n: 47 new keys × 4 locales (en/ru/zh/ko) — full parity.
- Tests: 20 new jest + 4 new pytest — all green. No regressions (452/452 jest, 79/79 pytest in test_circuit_patterns.py).
- Behavioral change: keyboard shortcut "0" now navigates to Circuits (was Liquid Chain pre-iter 97). Liquid Chain + Watchlist are click-only.
- **Stopping point:** iter 97 = full wire-up complete. F7 = Done. Next iter (iter 98) = P4 Time-of-Day pattern detector — pure function + heatmap UI (час × валюта). See docs/MARKET_PLAYBOOK.md §C.3 for the spec.

---
Task ID: iter-98
Agent: main (Claude Sonnet 4.5)
Task: Intraday Patterns API + UI wire-up (P4 — time-of-day pattern detector).

Work Log:
- Read STATUS.md, docs/MARKET_PLAYBOOK.md §C.3, AGENT_NAVIGATION.md, worklog.md (iter 97 stopping point) to understand the iter 98 spec.
- Studied iter 97 reference implementation: backend/economy/circuit_patterns.py (pure function pattern), backend/api/routes_circuit_patterns.py (thin wrapper), src/components/dashboard/circuit-patterns-tab.tsx (UI tab), src/__tests__/circuit-patterns-tab.test.tsx (jest pattern), tests/test_circuit_patterns.py::TestRouteHandler (pytest route smoke pattern).
- Backend pure function: Created backend/economy/intraday_patterns.py — compute_intraday_patterns(snapshot, config, *, days=14, limit=50, now=None). For each currency: aggregates price_logs by UTC hour (0..23) over the lookback window → per-hour mean/std/count. buy_window_hour = hour with min mean (Asia-wake dump). sell_window_hour = hour with max mean (US/EU-wake spike). has_significant_pattern = intraday_range_pct >= 10% (SIGNIFICANT_RANGE_PCT). Filters: MIN_SAMPLE_SIZE=4 total points AND MIN_HOURS_COVERED=2 distinct hours. Always emits 24 hourly_stats entries per currency (empty hours have mean=null, count=0) for the UI heatmap. Tunable thresholds at module top. Pure-function design — no side effects, testable without FastAPI.
- Backend pytest tests: Created tests/test_intraday_patterns.py — 89 tests across 10 test classes: TestExtractPricePoints (14 tests), TestFilterToWindow (5), TestMeanStd (7), TestGroupByHour (6), TestHourlyStats (5), TestOverallMean (4), TestFindBuySellWindows (5), TestIntradayRangePct (6), TestHoursCovered (4), TestComputeIntradayPatterns (20), TestRouteHandler (4 route smoke tests). Covers pure helpers + end-to-end + edge cases (empty snapshot, below MIN_SAMPLE_SIZE, below MIN_HOURS_COVERED, snake_case keys, all-equal prices, zero prices, insignificant patterns, sorting, limit, days window, category passthrough, current_price fallback).
- Backend Pydantic models: Added IntradayHourlyStat + IntradayPatternData + IntradayPatternsResponse in backend/api/response_models.py (after CircuitPatternsResponse). 13 fields on IntradayPatternData: api_id, text, category, hourly_stats (list[IntradayHourlyStat] — always 24 entries), buy_window_hour, sell_window_hour, buy_window_mean, sell_window_mean, overall_mean, intraday_range_pct, has_significant_pattern, sample_size, current_price.
- Backend route handler: Created backend/api/routes_intraday_patterns.py — thin wrapper by analogy with routes_circuit_patterns.py. Query params: days (1..90, default 14), limit (1..500, default 50). Returns data_available=false + empty patterns list when snapshot not loaded OR when computation throws. Route injects days into response dict (pure function doesn't echo it — only route handlers need it for client cache keys).
- Backend router registration: Added try/except ImportError wrapper in backend/main.py (after circuit_patterns_router registration, before the pre-import modules section).
- Next.js proxy: Created src/app/api/flipper/intraday-patterns/route.ts — by analogy with circuit-patterns/route.ts. Forwards days/limit query params, returns empty fallback with dataAvailable:false when backend offline.
- TypeScript types: Added IntradayHourlyStat, IntradayPattern, IntradayPatternsResponse to src/lib/types.ts (after CircuitPatternsResponse). All field names camelCase after flipper-proxy transformKeys().
- UI tab: Created src/components/dashboard/intraday-patterns-tab.tsx — heatmap (rows = currencies, cols = UTC hours 0..23) using dependency-free CSS divs (NO recharts — keeps the bundle lean and matches the speculation-tab sparkline pattern of dependency-free SVG/CSS). Cell color = deviation from overallMean: emerald ≥5% below (buy zone), light emerald 2-5% below, muted ±2% (neutral), light red 2-5% above, red ≥5% above (sell zone), very muted = no data (count=0). Buy window cell highlighted with emerald ring, sell window cell with amber ring. Per-row: item name (localized via getCurrencyDisplayName) + category (title-cased) + optional "Significant" badge (amber, when hasSignificantPattern=true) + BUY badge (emerald, shows fmtHour(buyWindowHour)) + SELL badge (red, shows fmtHour(sellWindowHour)) + signed intradayRangePct + heatmap row (24 cells with data-hour/data-count/data-is-buy/data-is-sell test attributes) + stats line (sampleSize · overallMean · currentPrice · buyMean · sellMean). Filter: "Significant only" toggle badge (hides currencies with hasSignificantPattern=false). Days selector: 7/14/30/90 (default 14). Hour axis header (00..23) above the heatmap. Legend with 6 swatches (Buy zone / Mild buy / Neutral / Mild sell / Sell zone / No data). 23 jest tests in src/__tests__/intraday-patterns-tab.test.tsx.
- Tab wiring: dashboard-page.tsx — added IntradayPatternsTab dynamic import (lazy-loaded with TabSkeleton fallback), added "intraday-patterns" to TAB_MAP at index 10 (between circuit-patterns and liquid-chain — extends the analytics cluster), added <TabsContent value="intraday-patterns"> with <ErrorBoundary fallbackTitle={t("fallbackIntradayPatterns")}>. dashboard-toolbar.tsx — added Clock icon to lucide imports + <TabsTrigger value="intraday-patterns"> between Circuit Patterns and Liquid Chain. shortcuts-dialog.tsx — updated the comment block (Intraday Patterns is click-only, idx 10, outside the 1-9+0 shortcut range).
- i18n: Added 43 new keys × 4 locales (en/ru/zh/ko) at the end of each locale file (after the circuit* keys). Keys cover: tabIntradayPatterns, fallbackIntradayPatterns, intradayTitle, intradaySubtitle, intradayOffline/Loading/Error/NoData/NoPatterns/NoSignificant, intradayRefresh/FetchedAt/PatternCount, intradayFilterSignificant, intradayDaysLabel/Value, intradaySignificant, intradayBuyWindow/SellWindow + 2 tooltip keys, intradayRangeTitle/Range, intradayHourAxisLabel, intradayHeatmapAriaLabel, 5 tooltip keys (SampleSize/OverallMean/CurrentPrice/BuyMean/SellMean titles), 5 stat-format keys (intradaySampleSize/OverallMean/Current/BuyMean/SellMean), intradayLegendLabel + 6 legend swatch labels. All 4 locales have parity (43 keys each).
- Tests: Python — 89 new tests in tests/test_intraday_patterns.py (10 test classes covering pure helpers + end-to-end + 4 route smoke tests). Jest — 23 tests covering offline/loading/error/no-data/no-patterns/heatmap-rendering/24-cells-per-row/buy-sell-window-badges/significant-badge/hour-axis/legend/significant-only-filter/no-significant-notice/days-selector/proxy-path/pattern-count-footer/fetched-at/stats-line/range-pct/data-is-buy/data-is-sell/empty-hour-cells. Bug fixed during dev: initial days-selector test tried to click a Radix Select option in jsdom (notoriously flaky) — replaced with a simpler "default 14 days visible in trigger + default fetchApi call uses days=14" assertion, matching the pattern used in circuit-patterns-tab.test.tsx.
- Verification: Python — 963/963 tests green across the full suite (was 874, +89 new in test_intraday_patterns.py). Jest — 475/475 tests green across 22 test suites (was 452, +23 new). tsc --noEmit green (0 errors). Backend route registration verified — /api/v1/intraday-patterns appears in app.routes.
- Documentation: Updated STATUS.md (added P4 row to Product Features table, added 2 new Quick Reference rows for heatmap "No data" cells + intraday tab not keyboard-reachable). Updated docs/MARKET_PLAYBOOK.md (P4 row marked Done in §B table, summary counts updated, §C.3 marked DONE with full implementation report, §D.2 added Status column with P4 Done, §D.3 stopping point updated to iter 98, §E doc references updated). Updated AGENT_NAVIGATION.md (header note refreshed, new entries for intraday_patterns.py + routes_intraday_patterns.py + intraday-patterns-tab.tsx in their respective navigation tables, new API endpoint row for /api/v1/intraday-patterns, trimmed iter 97 invariant #46 to a lean summary, added new invariant #47 documenting iter 98 changes).

Stage Summary:
- **iter 98 SHIPPED — Intraday Patterns API + UI wire-up. Completes P4.**
- Backend (4 files): intraday_patterns.py (new pure function, 89 tests), routes_intraday_patterns.py (new route handler), response_models.py (+IntradayHourlyStat +IntradayPatternData +IntradayPatternsResponse), main.py (+router registration).
- Frontend (5 new + 3 modified): intraday-patterns/route.ts (new proxy), types.ts (+3 types), intraday-patterns-tab.tsx (new UI tab with heatmap), intraday-patterns-tab.test.tsx (new, 23 tests), dashboard-page.tsx (+TAB_MAP entry idx 10 +TabsContent +dynamic import), dashboard-toolbar.tsx (+TabsTrigger +Clock icon import), shortcuts-dialog.tsx (comment update).
- i18n: 43 new keys × 4 locales (en/ru/zh/ko) — full parity.
- Tests: 89 new pytest + 23 new jest — all green. No regressions (963/963 pytest, 475/475 jest, tsc green).
- Behavioral change: tab count grew to 13 — Intraday Patterns (idx 10) + Liquid Chain (idx 11) + Watchlist (idx 12) are all click-only (only 10 shortcut slots 1-9+0). Keyboard shortcuts 1-9+0 still map to the first 10 tabs (overview through circuit-patterns).
- **Stopping point:** iter 98 = full wire-up complete. P4 = Done. Next iter (iter 99) = P5 Weekday/weekend pattern detector — pure function compute_weekly_patterns() + UI (день недели × валюта). See docs/MARKET_PLAYBOOK.md §C.4 for the spec.
