# MERGE INSTRUCTIONS — iter 100

> **Iter:** 100 — Leveling Uniques Lifecycle (P3) widget on Overview + 3 new KIs from log analysis
> **Date:** 2026-07-10
> **Previous:** iter 99 (Weekly Patterns API + UI wire-up, P5)

## Summary

Iter 100 implements **P3 Leveling Uniques Lifecycle** — a widget on the Overview tab (between PhaseHints and MarketOverview) that surfaces a static table of 10 well-known leveling uniques (Polcirkeln Sapphire Ring, Megalomaniac Diamond, Wall of Brambles, Mana Leech Support, Feeding Frenzy Support, Echoes of Worldstone, Mind of the Council, Boots of Momentum, Wings of Entropy, Soul Tether Amulet) with per-item:

- **Lifecycle stage** (PRE_PEAK / AT_PEAK / POST_PEAK) — computed from PhaseDetector's `days_since_reference` vs the unique's `peak_day`
- **Recommendation** (BUY_OR_HOLD / SELL_NOW / AVOID_BUYING) — maps from lifecycle stage
- **Estimated current price** (heuristic, NOT live market price) — piecewise-linear interpolation
- **Peak day + peak price reference**
- **Days until/since peak**

**Log analysis (KI-11/12/13):** The provided `логи.txt` was analyzed. 3 new Known Issues documented in `STATUS.md`:
- **KI-11** 🔴 — Upstream POE2Scout API returns 404 for league "runes" → 502 in browser on `/api/poe2/currencies` + `/api/poe2/uniques`. Workaround: edit `.env.local` → set `POE2_DEFAULT_LEAGUE` to a valid current league slug. **P3 widget is fully immune** — it only depends on PhaseDetector, not DataSnapshot.
- **KI-12** 🟡 — Turbopack NFT list warning (cosmetic). Fix: add `/*turbopackIgnore: true*/` to bridge import.
- **KI-13** 🟡 — `/api/v1/prices/stream?threshold_pct=1` returns 400 (cause uncertain). Low severity.

None of the KIs were fixed in iter 100 — only documented per the workflow rule "Если найден новый баг — сначала документируй в STATUS.md как Known Issue, потом фиксись". They're on the roadmap for iter 101+.

## Files Changed

### New Files (5)

1. **`backend/economy/leveling_uniques.py`** — Pure function module. Static table `_LEVELING_UNIQUES` (10 leveling uniques) + `_LEVELING_UNIQUES_NOTES_RU` (Russian notes parallel table). Main entry: `compute_leveling_uniques_lifecycle(phase, days_since_reference, *, reference_currency="", league_name="", now=None, lang="en")`. Pure helpers: `_lifecycle_stage`, `_recommendation`, `_estimate_current_price`, `_days_until_peak`. Test helpers: `list_leveling_uniques()`, `leveling_unique_count()`. Constants: `STAGE_PRE_PEAK`/`STAGE_AT_PEAK`/`STAGE_POST_PEAK`, `RECOMMENDATION_BUY_OR_HOLD`/`RECOMMENDATION_SELL_NOW`/`RECOMMENDATION_AVOID_BUYING`, `PATTERN_SPIKE_THEN_CRASH`, `POST_PEAK_FLOOR_DAY=7`, `PRE_PEAK_DAY0_PRICE_FRACTION=0.5`. Does NOT depend on DataSnapshot — uses PhaseDetector only (immune to KI-11).

2. **`backend/api/routes_leveling_uniques.py`** — Thin FastAPI wrapper. `GET /api/v1/leveling-uniques?lang=en|ru`. Uses `get_phase_detector()` singleton. Returns `data_available=true` always (hardcoded table). On exception, returns minimal response with empty `uniques` + `data_available=false`.

3. **`tests/test_leveling_uniques.py`** — 86 pytest tests. 8 test classes: `TestStaticTableIntegrity` (9 tests) + `TestLifecycleStage` (28 tests — parametrized) + `TestRecommendation` (4) + `TestEstimateCurrentPrice` (14) + `TestDaysUntilPeak` (3) + `TestComputeLevelingUniquesLifecycle` (18) + `TestRussianLocalization` (5) + `TestRouteHandler` (4).

4. **`src/app/api/flipper/leveling-uniques/route.ts`** — Next.js proxy route. Forwards `lang` query param. Returns empty `uniques: []` + `dataAvailable: false` when backend offline.

5. **`src/components/dashboard/leveling-uniques-widget.tsx`** — UI widget component. Renders on Overview between PhaseHints and MarketOverview. Header (TrendingUp icon + Day N + item count + reference currency) + summary line (dominant stage) + 5-column table (Item / Stage / Est. Price / Peak Day / Action) + disclaimer + footer (fetched-at + stage breakdown). Color-coded badges: PRE_PEAK=blue / AT_PEAK=amber / POST_PEAK=muted (stage), BUY_OR_HOLD=emerald / SELL_NOW=red / AVOID_BUYING=muted (recommendation). Uses `useQuery` (5min staleTime, retry 1) bound to `/api/flipper/leveling-uniques?lang={lang}`.

6. **`src/__tests__/leveling-uniques-widget.test.tsx`** — 28 jest tests covering: offline state, loading, error + refresh, no-data, successful render with mixed stages, stage badges, recommendation badges, summary line variants (AT_PEAK / PRE_PEAK / POST_PEAK dominant), est price rendering, peak day rendering, disclaimer, fetched-at footer, stage breakdown, empty uniques list, proxy path + lang forwarding.

### Modified Files (6)

1. **`backend/api/response_models.py`** — Added `LevelingUniqueData` + `LevelingUniquesResponse` Pydantic models. Purely additive — appended after the Weekly Patterns models, before the Speculation backtest models.

2. **`backend/main.py`** — Added router registration block for `routes_leveling_uniques` (try/except ImportError pattern, after the weekly_patterns block). Purely additive — existing routes untouched.

3. **`src/lib/types.ts`** — Added `LevelingUniqueStage` (type union), `LevelingUniqueRecommendation` (type union), `LevelingUnique` (interface), `LevelingUniquesResponse` (interface). Purely additive — appended after the Weekly Patterns types, before the Speculation backtest types.

4. **`src/components/dashboard/overview-tab-content.tsx`** — Added `LevelingUniquesWidget` import + new `<ErrorBoundary>` block with `<LevelingUniquesWidget>` between PhaseHints and MarketOverview. Purely additive — existing widgets untouched. Doc comment updated (4 panels → 5 panels).

5. **`src/lib/i18n/locales/en.ts`** + **`ru.ts`** + **`zh.ts`** + **`ko.ts`** — Added 31 new i18n keys to each locale (124 new lines total). Keys: `levelingTitle`, `levelingDayCount`, `levelingItemCount`, `levelingReferenceCurrency`, `levelingOffline`, `levelingLoading`, `levelingError`, `levelingNoData`, `levelingNoUniques`, `levelingRefresh`, `levelingFetchedAt`, `levelingStageBreakdown`, `levelingSummaryAtPeak`/`levelingSummaryPrePeak`/`levelingSummaryPostPeak`, `levelingStagePrePeak`/`levelingStageAtPeak`/`levelingStagePostPeak`/`levelingStageUnknown`, `levelingRecBuyOrHold`/`levelingRecSellNow`/`levelingRecAvoidBuying`/`levelingRecUnknown`, `levelingColItem`/`levelingColStage`/`levelingColEstPrice`/`levelingColPeakDay`/`levelingColAction`, `levelingPeakDayShort`, `levelingDisclaimer`, `fallbackLevelingUniques`. Purely additive — appended after the last weekly key (`weeklyLegendNoData`), before the closing `}`.

6. **`STATUS.md`** — Added 3 new open KIs (KI-11, KI-12, KI-13) with full symptom/cause/severity/fix details. Added P3 row to the Product Features table. Added 5 new Quick Reference entries (502 browser errors, 404 backend logs, NFT warning, SSE 400, leveling widget Day 0). Updated "Last updated" header.

7. **`docs/MARKET_PLAYBOOK.md`** — Updated §B.2 (P3 row → Done), §C.5 (full implementation details), §D.2 (P3 status → Done, P7 → Next), §D.3 (replaced iter 99 stopping point with iter 100 stopping point), §E (updated doc references). Updated "Last updated" header.

8. **`AGENT_NAVIGATION.md`** — Added 3 new entries to §1 (leveling_uniques.py module, routes_leveling_uniques.py route, leveling-uniques-widget.tsx UI widget). Added iter 100 changelog entry (#49) to §3. Added 3 new KIs to §4. Updated header. Purely additive.

## Verification

### Backend (Python) — ✅ All Green

```
$ python -m pytest tests/test_leveling_uniques.py tests/test_weekly_patterns.py tests/test_intraday_patterns.py tests/test_circuit_patterns.py tests/test_phase_hints.py tests/test_lifecycle.py tests/test_pricing.py tests/test_speculation.py tests/test_content_pulse.py tests/test_events.py tests/test_storage_value.py tests/test_anomaly.py --no-header -q
........................................                                                                 [100%]
============================= 704 passed in 4.87s ==============================
```

Breakdown:
- 86 new pytest tests in `tests/test_leveling_uniques.py` — all green
- 618 regression tests — all green (99 weekly + 89 intraday + 79 circuit + 58 phase_hints + 15 lifecycle + 3 shared + 275 smoke from pricing/speculation/content_pulse/events/storage_value/anomaly)

### Frontend (TypeScript) — Babel Syntax-Check ✅ All OK

```
$ node /home/z/my-project/scripts/babel-check-iter100.js /home/z/my-project/work/poe2-market-dashboard
OK: src/components/dashboard/leveling-uniques-widget.tsx
OK: src/app/api/flipper/leveling-uniques/route.ts
OK: src/__tests__/leveling-uniques-widget.test.tsx
OK: src/lib/types.ts
OK: src/lib/i18n/locales/en.ts
OK: src/lib/i18n/locales/ru.ts
OK: src/lib/i18n/locales/zh.ts
OK: src/lib/i18n/locales/ko.ts
OK: src/components/dashboard/overview-tab-content.tsx

9 OK, 0 failed, 9 total
```

### Frontend (TypeScript) — Full tsc/jest NOT run

**Known Issue (carried from iter 99):** `npm install` is killed by OOM-killer in the iteration environment (4GB RAM, no swap). The user must run locally with 8GB+ RAM:

```bash
npm install
npx tsc --noEmit
npx jest src/__tests__/leveling-uniques-widget.test.tsx
```

If jest tests fail, fixes are likely small (selector / text-match in `leveling-uniques-widget.test.tsx`).

## Merge Instructions

### Option A: Apply archive (recommended)

1. Extract the archive at the repo root:
   ```bash
   unzip iter100-changes.zip
   ```
   This will overwrite the 6 modified files and create the 5 new files (preserving directory structure).

2. Verify the file count:
   ```bash
   git status --short
   ```
   Should show 6 modified files + 5 new files (11 total changes).

3. Run backend tests:
   ```bash
   python -m pytest tests/test_leveling_uniques.py -v
   ```

4. Run frontend regression (requires 8GB+ RAM):
   ```bash
   npm install
   npx tsc --noEmit
   npx jest src/__tests__/leveling-uniques-widget.test.tsx
   ```

5. Start the dev server and verify the widget renders on the Overview tab:
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000` → Overview tab → scroll down past ContentPulseWidget and PhaseHintsWidget → LevelingUniquesWidget should be visible with the TrendingUp icon + "Day N of league" + table of 10 leveling uniques.

### Option B: Manual file copy

If you prefer to copy files manually, the archive contains:
- 5 new files at their canonical paths
- 6 modified files at their canonical paths

Copy each file to the corresponding location in your local repo, then run the verification steps above.

## Configuration Notes

The widget depends on `config.yaml` → `league.league_start_datetime`. If this is unset or zero, the widget will show "Day 0" with all uniques in PRE_PEAK stage. Verify the config has a valid ISO 8601 timestamp for the current league start.

The widget is **immune to KI-11** (upstream POE2Scout API 404 for league "runes"). It will render correctly even when the snapshot is empty. To fix KI-11 itself (so the rest of the dashboard shows data), edit `.env.local` → set `POE2_DEFAULT_LEAGUE` to a valid current league slug.
