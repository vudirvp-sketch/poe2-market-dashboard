# MERGE INSTRUCTIONS — iter 97

> **Archive:** `iter97-changes.tar.gz`
> **Source:** https://github.com/vudirvp-sketch/poe2-market-dashboard
> **Created:** 2026-07-10 (iter 97 — Circuit Patterns API + UI wire-up; closes TD-10, completes F7 / P8)
> **Files in archive:** 14 (8 source/test + 1 new test + 5 docs)

## What this iter does

1. **Closes TD-10** — Circuit Patterns (P8 trajectory classification) was backend-only in iter 96 (pure function + 75 tests). iter 97 wires up the full stack: API route + response models + Next.js proxy + TypeScript types + UI tab + i18n × 4 locales + tests.

2. **Completes F7** — Market Playbook + Circuit Patterns feature is now end-to-end usable from the dashboard. The new "Circuits" tab (between Speculation and Liquid Chain) shows every currency's trajectory archetype (EXPONENTIAL_GROWTH / LINEAR_GROWTH / PEAK_THEN_DECLINE / MEAN_REVERTING / VOLATILE / DECLINING / STABLE) with a recommended_action badge (HOLD_FOR_GROWTH / SELL_NOW / AVOID / WATCH / NEUTRAL) + signed total_change_pct + mini-sparkline.

3. **Behavioral change — keyboard shortcut "0"** now navigates to Circuits (was Liquid Chain pre-iter 97). Liquid Chain + Watchlist are click-only (was already the case for Watchlist pre-iter 97). Documented in `shortcuts-dialog.tsx` + STATUS.md Quick Reference.

4. **Pure function extended (additive)** — `compute_circuit_patterns()` in `backend/economy/circuit_patterns.py` now also emits `price_history_short` (up to 14 most-recent price points, oldest-first) per currency — needed for the UI mini-sparkline. Existing 75 tests stay green (they assert specific fields, not exact shape).

## How to merge

The archive preserves the directory structure of the repo. Extract over your local copy:

```bash
# From the root of your local poe2-market-dashboard clone:
tar -xzf /path/to/iter97-changes.tar.gz
```

This will create 3 new files and overwrite 11 existing files. No deletions required.

## Files changed (14 total)

### Backend (3 source + 1 test — 1 new file, 3 modified)
- `backend/api/routes_circuit_patterns.py` — **NEW**. Thin wrapper by analogy with `routes_speculation.py`. Query params: `days` (1..90 default 30), `limit` (1..500 default 50), `trajectory` (regex `^(ALL|EXPONENTIAL_GROWTH|LINEAR_GROWTH|PEAK_THEN_DECLINE|MEAN_REVERTING|VOLATILE|DECLINING|STABLE)$`, default `ALL`). Returns `data_available=false` + empty `patterns` list when snapshot not loaded OR when computation throws. Route injects `days` field into response dict (pure function doesn't echo it back — only route handlers need it for client cache keys).
- `backend/api/response_models.py` — **MODIFIED**. Added `CircuitPatternData` (13 fields incl. `price_history_short: list[SpeculationPriceHistoryPoint]` — reuses existing type from Speculation to avoid duplication) + `CircuitPatternsResponse`. Inserted between the Speculation section and the Speculation backtest section.
- `backend/economy/circuit_patterns.py` — **MODIFIED**. Extended `compute_circuit_patterns()` to emit `price_history_short` (up to 14 most-recent window_points as `[{"date": iso, "price": float}, ...]`, oldest-first). Updated docstring's "Returns" section to document the new field. No other changes — additive only.
- `backend/main.py` — **MODIFIED**. Added router registration for `circuit_patterns_router` via the standard `try/except ImportError` wrapper (matches the convention used by every other feature router). Placed after the phase_hints router registration.
- `tests/test_circuit_patterns.py` — **MODIFIED**. Added `from unittest.mock import patch` import. Added `TestRouteHandler` class at end of file (4 new tests: `test_route_returns_empty_when_no_snapshot`, `test_route_returns_data_when_snapshot_available`, `test_route_returns_empty_on_exception`, `test_route_echoes_days_param`).

### Frontend (5 new + 3 modified)
- `src/app/api/flipper/circuit-patterns/route.ts` — **NEW**. Next.js proxy by analogy with `speculation/route.ts`. Forwards `days`/`limit`/`trajectory` query params, returns empty fallback with `dataAvailable: false` + `days` echoed back when backend offline (no 503).
- `src/lib/types.ts` — **MODIFIED**. Added `CircuitTrajectory` (7-way string union), `CircuitRecommendedAction` (5-way string union), `CircuitPattern` (interface with 13 fields incl. `priceHistoryShort: SpeculationPriceHistoryPoint[]`), `CircuitPatternsResponse`. Inserted between `SpeculationResponse` and the Speculation backtest section.
- `src/components/dashboard/circuit-patterns-tab.tsx` — **NEW** (~600 lines). UI tab by analogy with `speculation-tab.tsx` but simpler (no Backtest panel). Filter chips (ALL + 7 archetypes), days selector (7/14/30/90), per-row trajectory badge (color-coded by archetype — emerald for growth, amber for peak, red for declining, fuchsia for volatile, slate for stable/mean-reverting) + recommended_action badge (same color scheme) + signed total_change_pct + stats line (sampleSize · slope%/d · vol · R² · current · daysSincePeak for PEAK_THEN_DECLINE only) + mini-sparkline (colored by trajectory archetype — same SVG component pattern as speculation-tab). All graceful degradation states (offline / loading / error / no-data / no-patterns) + refresh button.
- `src/__tests__/circuit-patterns-tab.test.tsx` — **NEW** (20 jest tests). Covers: offline / loading / error / no-data / no-patterns / patterns-list-rendering / trajectory-badges / action-badges / total-change-pct-signed / filter-chips-8 / days-selector / sparkline-non-empty / sparkline-empty-fallback / pattern-count-footer / fetched-at / proxy-path / filter-click / stats-line / days-since-peak-only-for-peak / all-5-actions-rendered.
- `src/components/dashboard/dashboard-page.tsx` — **MODIFIED**. Added `CircuitPatternsTab` dynamic import (lazy-loaded with `TabSkeleton` fallback) after `SpeculationTab`. Added `"circuit-patterns"` to `TAB_MAP` at index 9 (between `speculation` and `liquid-chain` — extends the analytics cluster). Updated the comment block above TAB_MAP to document the new layout. Added `<TabsContent value="circuit-patterns">` with `<ErrorBoundary fallbackTitle={t("fallbackCircuitPatterns")}>` between Speculation and Liquid Chain.
- `src/components/dashboard/dashboard-toolbar.tsx` — **MODIFIED**. Added `Activity` icon to the lucide-react imports. Added `<TabsTrigger value="circuit-patterns">` (Activity icon + `tabCircuitPatterns` label) between Speculation and Liquid Chain.
- `src/components/dashboard/shortcuts-dialog.tsx` — **MODIFIED**. Updated the shortcut mapping comment block + the `<kbd>0</kbd>` row from `tabLiquidChain` to `tabCircuitPatterns`. Liquid Chain + Watchlist are now click-only.

### i18n (4 modified)
- `src/lib/i18n/locales/en.ts` — **MODIFIED**. Added 47 new keys at the end of the file (after `phaseHintsHintCount`): `tabCircuitPatterns`, `fallbackCircuitPatterns`, `circuitTitle`, `circuitSubtitle`, `circuitOffline`/`OfflineHint`/`Loading`/`Error`/`NoData`/`NoPatterns`/`Refresh`/`FetchedAt`/`PatternCount`, `circuitFilterLabel` + `circuitFilterAll` + 7 archetype filter labels (`circuitFilterExpGrowth` etc.), `circuitDaysLabel`/`DaysValue`, 6 tooltip keys (`circuitTotalChangeTitle` etc.), 7 trajectory label keys (`circuitTrajExpGrowth` etc.), 5 action label keys (`circuitActionHoldForGrowth` etc.), 6 stat-format keys (`circuitSampleSize` etc.).
- `src/lib/i18n/locales/ru.ts` — **MODIFIED**. Same 47 keys, Russian translations.
- `src/lib/i18n/locales/zh.ts` — **MODIFIED**. Same 47 keys, Chinese translations.
- `src/lib/i18n/locales/ko.ts` — **MODIFIED**. Same 47 keys, Korean translations.

### Docs (4 modified)
- `STATUS.md` — **MODIFIED**. Removed TD-10 from open tech-debt backlog. Updated F7 row from "In progress (iter 96)" to "Done (iter 96 + 97)". Added 2 new Quick Reference rows: shortcut "0" remapping + circuit-patterns sparkline empty fallback behavior.
- `docs/MARKET_PLAYBOOK.md` — **MODIFIED**. Updated header timestamp to iter 97. Updated P8 row in §B to "✅ Готово" with full implementation summary. Updated summary counts (4 fully done / 5 partial / 11 missing). Marked §C.2 as "✅ DONE" with detailed implementation report. Added "Status" column to §D.2 priority table. Replaced §D.3 stopping point (iter 96 → iter 97). Cleaned §E references.
- `AGENT_NAVIGATION.md` — **MODIFIED**. Refreshed header note to iter 97. Updated `circuit_patterns.py` row to mention `price_history_short` extension + total test count (79). Added new row for `routes_circuit_patterns.py`. Added new row for `circuit-patterns-tab.tsx`. Added invariant #46 (iter 97 detailed changelog). Added `/api/v1/circuit-patterns` row to API endpoints table in §5.
- `worklog.md` — **MODIFIED**. Appended iter 97 entry (Task ID `iter-97`, full work log + stage summary).

## Verification (run after merge)

```bash
# Backend tests (circuit patterns specifically + adjacent modules)
python -m pytest tests/test_circuit_patterns.py -q          # 79/79 expected (75 original + 4 new)
python -m pytest tests/test_circuit_patterns.py tests/test_content_pulse.py tests/test_speculation.py -q
# Expected: 204 passed

# Full pytest (excluding test_scheduler.py — pre-existing aiosqlite env issue, see STATUS.md)
python -m pytest tests/ --ignore=tests/test_scheduler.py -q
# Expected: ~795+ passed (plus the 4 new circuit-patterns route tests)

# Frontend
npx tsc --noEmit                                             # 0 errors expected
npx jest --no-coverage                                       # 452/452 expected (432 existing + 20 new)
```

## Git commands

```bash
git add AGENT_NAVIGATION.md STATUS.md worklog.md docs/MARKET_PLAYBOOK.md \
        backend/api/routes_circuit_patterns.py \
        backend/api/response_models.py \
        backend/economy/circuit_patterns.py \
        backend/main.py \
        tests/test_circuit_patterns.py \
        src/app/api/flipper/circuit-patterns/route.ts \
        src/components/dashboard/circuit-patterns-tab.tsx \
        src/components/dashboard/dashboard-page.tsx \
        src/components/dashboard/dashboard-toolbar.tsx \
        src/components/dashboard/shortcuts-dialog.tsx \
        src/__tests__/circuit-patterns-tab.test.tsx \
        src/lib/i18n/locales/en.ts \
        src/lib/i18n/locales/ko.ts \
        src/lib/i18n/locales/ru.ts \
        src/lib/i18n/locales/zh.ts \
        src/lib/types.ts

git commit -m "iter 97: Circuit Patterns API + UI wire-up (F7 / P8, closes TD-10)

Closes TD-10 (the only open tech-debt item from iter 96). Completes F7:
Circuit Patterns is now end-to-end usable from the dashboard.

Backend (3 source + 1 test):
- backend/api/routes_circuit_patterns.py — NEW thin wrapper by analogy
  with routes_speculation.py. Query: days (1-90 default 30), limit
  (1-500 default 50), trajectory (ALL|EXPONENTIAL_GROWTH|LINEAR_GROWTH|
  PEAK_THEN_DECLINE|MEAN_REVERTING|VOLATILE|DECLINING|STABLE, default
  ALL). Route injects days field into response dict (pure function
  doesn't echo it back — only route handlers need it for client cache
  keys). Returns data_available=false + empty patterns list on
  snapshot-not-loaded or computation exception.
- backend/api/response_models.py — added CircuitPatternData (13 fields
  incl. price_history_short: list[SpeculationPriceHistoryPoint] —
  reuses existing type from Speculation to avoid duplication) +
  CircuitPatternsResponse.
- backend/economy/circuit_patterns.py — extended compute_circuit_patterns()
  to also emit price_history_short per currency (up to 14 most-recent
  points, oldest-first, as {date, price} dicts). Additive change —
  existing 75 tests stay green. Needed for UI mini-sparkline.
- backend/main.py — registered circuit_patterns_router via standard
  try/except ImportError wrapper.
- tests/test_circuit_patterns.py — added TestRouteHandler class with
  4 route smoke tests (mirrors test_content_pulse.py pattern).

Frontend (5 new + 3 modified):
- src/app/api/flipper/circuit-patterns/route.ts — NEW Next.js proxy
  by analogy with speculation/route.ts.
- src/lib/types.ts — added CircuitPattern, CircuitPatternsResponse,
  CircuitTrajectory (7-way union), CircuitRecommendedAction (5-way
  union). Field names camelCase after transformKeys.
- src/components/dashboard/circuit-patterns-tab.tsx — NEW UI tab
  (~600 lines) by analogy with speculation-tab.tsx but simpler (no
  Backtest panel — trajectory classification is single-pass). Filter
  chips (ALL + 7 archetypes), days selector (7/14/30/90), per-row
  trajectory badge (color-coded by archetype) + recommended_action
  badge + signed total_change_pct + stats line + mini-sparkline
  (colored by trajectory archetype). All graceful degradation states.
- src/components/dashboard/dashboard-page.tsx — added CircuitPatternsTab
  dynamic import + TAB_MAP entry at idx 9 (between speculation and
  liquid-chain — extends the analytics cluster) + TabsContent with
  ErrorBoundary.
- src/components/dashboard/dashboard-toolbar.tsx — added Activity icon
  import + TabsTrigger between Speculation and Liquid Chain.
- src/components/dashboard/shortcuts-dialog.tsx — updated shortcut
  mapping: '0' → Circuits (was Liquid Chain pre-iter 97). Liquid Chain
  + Watchlist are now click-only.
- src/__tests__/circuit-patterns-tab.test.tsx — NEW (20 jest tests).
  Covers offline/loading/error/no-data/no-patterns/patterns-list/
  trajectory-badges/action-badges/total-change-pct-signed/filter-chips-8/
  days-selector/sparkline-non-empty/sparkline-empty-fallback/footer/
  proxy-path/filter-click/stats-line/days-since-peak-only-for-peak/
  all-5-actions-rendered.

i18n: 47 new keys × 4 locales (en/ru/zh/ko) = 188 new lines. Full
parity across all 4 locale files (1011 keys each after merge).

Behavioral change: keyboard shortcut '0' now navigates to Circuits
(was Liquid Chain pre-iter 97). Documented in shortcuts-dialog.tsx
+ STATUS.md Quick Reference.

Verification:
- pytest tests/test_circuit_patterns.py: 79/79 green (75 original +
  4 new route smoke).
- pytest tests/test_circuit_patterns.py + test_content_pulse.py +
  test_speculation.py: 204/204 green.
- npx tsc --noEmit: 0 errors.
- npx jest: 452/452 green (432 existing + 20 new).

Docs:
- STATUS.md: closed TD-10, marked F7 = Done, 2 new Quick Reference
  rows (shortcut remapping + sparkline empty fallback).
- docs/MARKET_PLAYBOOK.md: P8 row marked Done, summary counts updated,
  §C.2 marked DONE with implementation report, §D.2 added Status
  column, §D.3 stopping point updated to iter 97.
- AGENT_NAVIGATION.md: header refreshed, circuit_patterns.py row
  updated, new rows for routes_circuit_patterns.py + circuit-patterns-
  tab.tsx, new invariant #46, /api/v1/circuit-patterns in API table.
- worklog.md: iter 97 entry (Task ID iter-97)."

git push origin main
```

## Stopping point for next iter (iter 98)

**iter 97 SHIPPED — Circuit Patterns full wire-up complete. F7 = Done. TD-10 = closed.**

**Next iteration (iter 98) — Time-of-Day Pattern Detector (P4):**
1. Pure function `compute_intraday_patterns(snapshot, config, days=14) -> dict` in `backend/economy/intraday_patterns.py`. For each currency: hourly mean price (UTC), buy/sell windows. Aggregate price_logs by hour-of-day over the last N days. "Buy window" = hour with min mean price. "Sell window" = hour with max mean price. Signal when `|max - min| / overall_mean > 10%`.
2. Same wire-up pattern as iter 97: API route `routes_intraday_patterns.py`, Pydantic response models, Next.js proxy, TS types, UI tab/widget (heatmap: час × валюта), i18n × 4 locales, jest + pytest tests.
3. See `docs/MARKET_PLAYBOOK.md` §C.3 for the full spec.

**iter 99 — Weekday/Weekend Pattern Detector (P5)** — similar to iter 98 but groupby day-of-week instead of hour-of-day.

**iter 100+ — Leveling Uniques Lifecycle (P3), Mirror/Divine Arb (P7), Phase-aware Investment Advisor (P9), Gold Map ROI (P10)** — see `docs/MARKET_PLAYBOOK.md` §C.4-C.8 for the full roadmap.
