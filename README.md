iter 87 — i18n leakage cleanup + dead code removal
==================================================

This archive contains all files MODIFIED in iter 87. To apply:

1. Extract this archive into the root of your local `poe2-market-dashboard` repo,
   preserving directory structure (overwrite existing files):

       tar -xzf iter87-files.tar.gz -C /path/to/poe2-market-dashboard/

2. Delete the files listed in `DELETIONS.txt`:

       cd /path/to/poe2-market-dashboard
       git rm backend/arbitrage/recipe.py
       git rm tests/test_recipe.py
       git rm src/components/dashboard/currency-graph-tab.tsx
       git rm src/__tests__/currency-graph-tab.test.tsx

3. Run the test suite to verify:

       pytest tests/ --ignore=tests/e2e --ignore=tests/test_scheduler.py
       # Expected: 757 passed

       npx jest
       # Expected: 405 passed (19 suites)

4. Commit + push (see git commands below).

What was done in iter 87
------------------------

**Frontend i18n leakage fixes (7 components + 1 helper):**
- `src/lib/currency-names.ts` — added CATEGORY_NAMES_RU/EN, getCategoryRuName(),
  getCategoryEnName(), getCurrencyDisplayName(apiId, locale),
  getCategoryDisplayName(slug, locale). getCurrencyDisplayName returns null
  when no mapping exists (so callers' `|| text` fallback works).
- `src/components/dashboard/market-overview.tsx` — heatmap sort (|change24h|
  desc, cap 30) + RU currency names.
- `src/components/dashboard/currency-card.tsx` — RU name in card title.
- `src/components/dashboard/exchange-pair-card.tsx` — RU names for both
  currencies + 7d → t("sevenDay") + RU comparison label.
- `src/components/dashboard/exchange-table.tsx` — RU names in pair cells,
  comparison label, anchor name, sort comparator.
- `src/components/dashboard/content-pulse-widget.tsx` — RU category slug +
  RU mover names (CategoryBlock takes `locale` prop).
- `src/components/dashboard/speculation-tab.tsx` — RU names + RU categories +
  localized BUY/SELL/HOLD + **new potentialProfitPct field** (mean-reversion
  based — partial fix for user's buy-low/sell-high request).
- `src/components/dashboard/analyst-tab.tsx` — RU names for trend + anomaly
  apiId display.

**i18n keys (4 locales — en/ru/zh/ko):**
- Added: speculationPotentialProfit, speculationPotentialProfitTitle,
  takeProfitTP1/TP2/TP3/SL1/SL2/SL3, fallbackOptimizer, fallbackAnalyst,
  eventsDaysHours, eventsHoursMinutes, eventsMinutes.
- ru.ts: speculationFilterBuy/Sell/Hold → ПОКУПАТЬ/ПРОДАВАТЬ/ДЕРЖАТЬ;
  speculationStd → "СКО {0}"; updated liquidChainNoReforgeNotice.
- en.ts: updated liquidChainNoReforgeNotice.

**Currency Graph tab — COMPLETELY REMOVED:**
- Deleted component + tests.
- Updated dashboard-page.tsx (removed dynamic import + tab content).
- Updated dashboard-toolbar.tsx (removed TabsTrigger + Network icon import).
- Updated shortcuts-dialog.tsx (removed 9 → tabGraph row).
- Updated skeletons.tsx (removed CurrencyGraphSkeleton).
- Rewrote integration.test.tsx (was 8 tests using CurrencyGraphTab,
  now 3 pure-logic FlipperApiError tests).

**Liquid Chain ("Craft") tab cleanup:**
- config.yaml (353 → 226 lines): removed 3 concentrated-liquid-* steps
  (drop-only items, cannot be obtained via vendor reforge). liquid-despair
  ratio 3 → 1 (last reforgeable tier). Removed entire ritual_omens chain
  (28 entries — no omen reforge in PoE2).

**Dead code removal:**
- Deleted backend/arbitrage/recipe.py + tests/test_recipe.py.
- Removed RecipeOpportunity dataclass from backend/models/currency.py.
- Updated docs/BACKEND_GUIDE.md + docs/ARCHITECTURE.md.

**Backend phase_hints i18n:**
- backend/economy/phase_hints.py: added _PHASE_HINTS_RU + _PHASE_META_RU
  parallel tables. get_phase_hints() now accepts lang="en" kwarg.
- backend/api/routes_phase_hints.py: added lang Query param.
- src/app/api/flipper/phase-hints/route.ts: forwards lang from request.
- src/components/dashboard/phase-hints-widget.tsx: forwards lang from
  useI18n().locale (in queryKey + as query param).

**take-profit-calculator.tsx:**
- 14 hardcoded EN strings → t() calls. Added confidenceLabel() + levelLabel()
  helpers. Imports TranslationKeys type.

**events-sidebar.tsx:**
- English month array → locale-aware toLocaleDateString() + toLocaleTimeString().
- formatExpiry uses new eventsDaysHours/eventsHoursMinutes/eventsMinutes keys.

**dashboard-page.tsx:**
- Lines 907, 914: "Optimizer Error" / "Analyst Error" literals →
  t("fallbackOptimizer") / t("fallbackAnalyst").

Tests
-----

- pytest: 757 passed (was 763 in iter 86 — delta is 6 deleted test_recipe.py tests).
- jest: 405 passed across 19 suites (was 415 in iter 86 — delta is 10
  deleted currency-graph-tab.test.tsx tests + 5 net reduction in
  rewritten integration.test.tsx).

Git commands to commit + push
-----------------------------

    cd /path/to/poe2-market-dashboard
    git add -A
    git status  # verify 32 modified + 4 deleted
    git commit -m "iter 87: i18n leakage cleanup + Currency Graph tab removed + Liquid Chain cleanup + phase_hints ?lang=ru + Speculation potentialProfitPct

Frontend i18n leakage fixes (7 components + 1 helper):
- src/lib/currency-names.ts: added CATEGORY_NAMES_RU/EN, getCategoryRuName(),
  getCategoryEnName(), getCurrencyDisplayName(apiId, locale) -> string | null,
  getCategoryDisplayName(slug, locale) -> string.
- market-overview.tsx: heatmap sort (|change24h| desc, cap 30) + RU names.
- currency-card.tsx, exchange-pair-card.tsx, exchange-table.tsx,
  content-pulse-widget.tsx, speculation-tab.tsx, analyst-tab.tsx:
  wired getCurrencyDisplayName() + getCategoryDisplayName() with || fallback.
- speculation-tab.tsx: added potentialProfitPct (mean-reversion based —
  partial fix for user's buy-low/sell-high request, see KI-1).
- take-profit-calculator.tsx: 14 hardcoded EN strings -> t() calls.
- events-sidebar.tsx: English month array -> locale-aware toLocaleDateString().

i18n keys (4 locales — en/ru/zh/ko):
- Added: speculationPotentialProfit, speculationPotentialProfitTitle,
  takeProfitTP1/TP2/TP3/SL1/SL2/SL3, fallbackOptimizer, fallbackAnalyst,
  eventsDaysHours, eventsHoursMinutes, eventsMinutes.
- ru.ts: speculationFilterBuy/Sell/Hold -> ПОКУПАТЬ/ПРОДАВАТЬ/ДЕРЖАТЬ;
  speculationStd -> 'СКО {0}'; updated liquidChainNoReforgeNotice.

Currency Graph tab — COMPLETELY REMOVED:
- Deleted src/components/dashboard/currency-graph-tab.tsx +
  src/__tests__/currency-graph-tab.test.tsx.
- Updated dashboard-page.tsx (removed dynamic import + tab content).
- Updated dashboard-toolbar.tsx (removed TabsTrigger + Network icon import).
- Updated shortcuts-dialog.tsx (removed 9 -> tabGraph row).
- Updated skeletons.tsx (removed CurrencyGraphSkeleton).
- Rewrote integration.test.tsx (8 CurrencyGraphTab tests -> 3 FlipperApiError
  classification tests).

Liquid Chain ('Craft') tab cleanup:
- config.yaml (353 -> 226 lines): removed 3 concentrated-liquid-* steps
  (drop-only, cannot be obtained via vendor reforge). liquid-despair ratio
  3 -> 1 (last reforgeable tier). Removed entire ritual_omens chain
  (28 entries — no omen reforge in PoE2).

Dead code removal:
- Deleted backend/arbitrage/recipe.py + tests/test_recipe.py.
- Removed RecipeOpportunity dataclass from backend/models/currency.py.
- Updated docs/BACKEND_GUIDE.md + docs/ARCHITECTURE.md.

Backend phase_hints i18n:
- backend/economy/phase_hints.py: added _PHASE_HINTS_RU + _PHASE_META_RU
  parallel tables. get_phase_hints() accepts lang='en' kwarg.
- backend/api/routes_phase_hints.py: added lang Query param.
- src/app/api/flipper/phase-hints/route.ts: forwards lang from request.
- src/components/dashboard/phase-hints-widget.tsx: forwards lang from
  useI18n().locale (in queryKey + as query param).

dashboard-page.tsx:907,914: 'Optimizer Error'/'Analyst Error' literals ->
t('fallbackOptimizer')/t('fallbackAnalyst').

Tests: 757 pytest + 405 jest pass (was 763 + 415 in iter 86 — delta is
deleted test_recipe.py + currency-graph-tab.test.tsx + rewritten
integration.test.tsx).

5 Known Issues deferred to iter 88 — see STATUS.md §'Known Issues —
Deferred to iter 88': (KI-1) Speculation tab full redesign,
(KI-2) Exchanges 7d changes not loading, (KI-3) 'Premium' column meaning
unclear, (KI-4) Flips tab applicability to PoE2, (KI-5) analyst-tab
fact.text English from backend."

    git push origin main

Stop point for iter 88
----------------------

See the end of worklog.md for the full iter 87 record + the recommended
iter 88 priorities. Summary:

- iter 87 SHIPPED. All 5 user-feedback complaints partially or fully
  addressed.
- 5 Known Issues deferred to iter 88 (see STATUS.md KI-1 through KI-5).
- Highest priority for iter 88: KI-1 (Speculation tab full redesign with
  synthetic bid/ask from /flips + history view + profit calc) + KI-5
  (move analyst fact.text generation to frontend).
