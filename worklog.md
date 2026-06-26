# Worklog — PoE2 Market Dashboard

> Append-only shared multi-agent work log. Each section starts with `---`.
> Old task history is in `git log`.

Recent iterations kept (iter 93+). Older iter 89-92 records trimmed — those features are fully shipped and documented in STATUS.md / AGENT_NAVIGATION.md.

---
Task ID: iter-93
Agent: main
Task: iter 93 — Best Payment primary view on Exchange. User answers: Q1="Пример А" (top-10 cards strip), Q2="для всего" (currencies + craft items), Q3="скрывать" (savings <1% not shown).

Work Log:
- New component `best-payment-top-list.tsx`: horizontal-scroll cards strip at the TOP of Exchange tab. Empty state returns `null`.
- Extended `use-optimal-payment.ts` with 5th `useMemo` computing `bestPaymentTopList` (groups by `currency1Id`, filters <1%, sorts by savingsPct desc then volume desc, top 10).
- Wired into `ExchangeTabContent` + `dashboard-page.tsx` (2 one-line changes).
- i18n: 13 new keys × 4 locales = 52 lines.
- Found pre-existing KI-10 (duplicate `flipsBid`/`flipsAsk` keys from iter 92 TD-1 relabel). Documented in STATUS.md — fix in iter 94.

Stage Summary:
- **iter 93 SHIPPED.** Q1/Q2/Q3 addressed. 8 source + 3 docs changed. Jest 412/412 green. tsc had 8 pre-existing KI-10 errors.

---
Task ID: iter-94
Agent: main
Task: iter 94 — Fix KI-10 (duplicate i18n keys) + Spread Capture view (Q4 colors/filter, Q5 sparkline, Q6 intuitive labels) per iter 93 handoff note.

Work Log:
- Cloned repo to `/home/z/my-project/work/poe2-market-dashboard`. Read STATUS.md (KI-10 + iter 93 row), AGENT_NAVIGATION.md (invariant #43), worklog.md (iter 93 entry).
- Read key source files: `flips-table.tsx` (17-column grid, iter 92 TD-1 expansion), `flips-tab.tsx` (filter state + useMemo), `flips-helpers.ts` (SortField types + cluster helpers), `sparkline.tsx` (existing component), `speculation-tab.tsx:195-260` (Sparkline usage pattern), `types.ts:160-200` (FlipOpportunity — has momentum + volatility but no priceHistoryShort), 4 locale files (found old "Bid"/"Ask" duplicates at lines ~379-380 + new "Buy at"/"Sell at" with tooltips at lines ~631-634).
- **KI-10 fix:** Deleted OLD `flipsBid` / `flipsAsk` entries (the pre-iter-92 "Bid"/"Ask" / "Покупка"/"Продажа" / "买价"/"卖价" / "매수"/"도" lines) from all 4 locale files. Kept the NEW iter 92 entries (with tooltips). Verified: `npx tsc --noEmit` now exits 0 (was 8 TS1117 errors). Jest 412/412 still green.
- **Q4 (Spread tier colors + filter):**
  - Added `classifySpreadTier(spread)` + `spreadTierColor(tier)` to `flips-helpers.ts`. Thresholds: wide ≥5%, medium 2-5%, tight <2%.
  - Exported constants `SPREAD_TIER_WIDE_THRESHOLD = 0.05` + `SPREAD_TIER_MEDIUM_THRESHOLD = 0.02`.
  - FlipsTable Spread cell now color-coded: emerald (wide), amber (medium), muted (tight).
  - Added `spreadTierFilter` state to `flips-tab.tsx` + a new "Spread tier" Select dropdown in the filters row (between Cluster and Min Spread). Selects: All / Wide ≥5% / Medium 2-5% / Tight <2%.
  - Filter logic added to `filteredOpportunities` useMemo + included in dep array.
- **Q5 (Trend sparkline):**
  - Added `deriveTrendSparklineData(momentum, volatility)` to `flips-helpers.ts`. Generates 6 deterministic synthetic points: linear slope from momentum + decaying wave from volatility. Uses `sin(i * PI/2)` (NOT `sin(i * PI)` which is always 0 — caught by unit test). Formula: `trend = m * t`, `wave = v * sin(i*PI/2) * (1-t) * 0.5`, `point = trend + wave`.
  - Exported `FLIPS_TREND_SPARKLINE_POINTS = 6` constant.
  - Added Trend column to FlipsTable (col 17 of 18, before detail arrow). Hidden on smaller screens (lg+). Uses existing `Sparkline` component (`./sparkline`). Width=60, height=20, color=#94a3b8 (slate-400, neutral).
  - Expanded GRID_COLS from 18 to 19 tracks (added 70px between 60px and 30px detail arrow).
  - Tooltip `flipsTrendTooltip` HONESTLY labels this as "Momentum × volatility indicator (derived from current snapshot — NOT historical price data). When backend adds priceHistoryShort (TD-9), this will switch to real recent price points."
  - Documented as TD-9 (new tech debt) — backend needs to add `priceHistoryShort?: { timestamp: string; price: number }[]` to `FlipOpportunity` for real sparkline data.
- **Q6 (intuitive labels):**
  - Added `flipperSpreadTooltip` — explains "Gross spread (ask − bid) / mid price. This is the profit margin per round-trip trade before fees. Wide ≥5% = strong spread-capture opportunity; Medium 2-5% = marginal; Tight <2% = skip." (4 locales)
  - Added `title={t("profitExaTooltip")}` to the Profit column header (was missing).
  - Added `title={t("flipperSpreadTooltip")}` to the Spread column header (was missing).
- **i18n keys (7 new × 4 locales = 28 lines):** `flipperSpreadTooltip`, `flipsSpreadTierFilter`, `flipsSpreadTierWide`, `flipsSpreadTierMedium`, `flipsSpreadTierTight`, `flipsTrend`, `flipsTrendTooltip`. Added to all 4 locale files in a new "iter 94: Spread Capture view" section after the iter 92 TD-1 section.
- **Unit tests (16 new):** Created `src/__tests__/flips-helpers.test.ts` covering `classifySpreadTier` (5 tests: thresholds, defensive null), `spreadTierColor` (3 tests: tier-to-color mapping), `deriveTrendSparklineData` (8 tests: point count, determinism, zero inputs, positive/negative momentum slope, volatility wave, null inputs, intermediate deviation). All 16 pass.
- **Verification:** `npx tsc --noEmit` exits 0 (was 8 errors). `npx jest` 428/428 green (was 412/412). No new TypeScript errors. No regressions in existing tests.
- Updated documentation: STATUS.md (closed KI-10, added iter 94 row, added TD-9, added 2 new Quick Reference rows for Trend sparkline + Spread cell colors), AGENT_NAVIGATION.md (added invariant #44), worklog.md (this entry, trimmed iter 92 to summary).

Stage Summary:
- **iter 94 SHIPPED — KI-10 closed + Spread Capture view (Q4/Q5/Q6) all addressed.**
- Q4 (Spread tier colors + filter): ✅ done — color-coded Spread cell + Spread tier Select dropdown
- Q5 (Trend sparkline): ✅ done — derived from momentum × volatility, HONESTLY labeled, TD-9 opened for real data
- Q6 (Intuitive labels): ✅ done — spread-capture-intent tooltips on Spread + Profit columns
- Files changed (8 source + 1 test + 3 docs = 12 total):
  - `src/lib/i18n/locales/en.ts` (deleted 2 old keys, added 7 new)
  - `src/lib/i18n/locales/ru.ts` (deleted 2 old keys, added 7 new)
  - `src/lib/i18n/locales/zh.ts` (deleted 2 old keys, added 7 new)
  - `src/lib/i18n/locales/ko.ts` (deleted 2 old keys, added 7 new)
  - `src/components/dashboard/flips-helpers.ts` (SpreadTier type + classifySpreadTier + spreadTierColor + deriveTrendSparklineData + 3 exported constants)
  - `src/components/dashboard/flips-table.tsx` (GRID_COLS expanded to 19 tracks, Spread cell color, Trend column with Sparkline, tooltips on Spread + Profit headers)
  - `src/components/dashboard/flips-tab.tsx` (spreadTierFilter state + Select UI + filter logic + dep array)
  - NEW `src/__tests__/flips-helpers.test.ts` (16 unit tests)
  - `STATUS.md` (KI-10 closed, iter 94 row, TD-9, 2 Quick Reference rows)
  - `AGENT_NAVIGATION.md` (invariant #44)
  - `worklog.md` (this entry, trimmed iter 92 to summary)

Next iteration (iter 95) — recommended priorities:
1. **iter 95 = Overheat Index** (Q13 — indirect signals: streamer influence → volume spike → price drop). Uses `volume_traded` not `current_quantity` (TD-2 fix). Backend `content_pulse._category_today_volume()` needs to switch metric.
2. **iter 96 = Triangular persistence** (TD-3 + TD-4 — SQLite for executable_estimate backtesting + market_spread persistence).
3. **iter 97+ = Proposal F-J exposition** (Wall detection UI, OHLCV candlestick, cross-pair correlation, liquidity-tier UI, real FlipsTable sparkline via TD-9).
