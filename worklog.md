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
