# Worklog — PoE2 Market Dashboard

> Append-only shared multi-agent work log. Each section starts with `---`.
> Old task history is in `git log`.


Recent iterations kept (iter 86+). Older iter 77-85 records trimmed — those features are fully shipped and documented in PRODUCT_VISION.md / STATUS.md / AGENT_NAVIGATION.md.

---
Task ID: iter-86
Agent: main (Sonnet 4.5)
Task: iter 86 — F1 closure: maintainer ran the live sync pipeline; resolve the single `against-the-darkness` conflict inline; close F1.

Stage Summary:
- **F1 CLOSED.** Live-run: 639 poe2scout items → 186 poe2db RU pairs → 0 new translations (already covered) + 1 conflict (`against-the-darkness` EN-name drift — short EN field vs full RU). Fixed inline by aligning EN to canonical "Zarokh's Reliquary Key: Against the Darkness". Counts unchanged: ru=349, en=349. `pytest tests/test_currency_names_ru.py` 7/7 pass. Full detail in `git log` for commit 03fab72.

---
Task ID: iter-87
Agent: main (Sonnet 4.5)
Task: iter 87 — User feedback batch: fix i18n leakage across multiple tabs (heatmap/currencies/exchange/content-pulse/phase-hints/speculation in English), remove Currency Graph tab (low value), cleanup Liquid Chain ("Craft") tab (Concentrated liquids + Ritual Omens chains were fabricated — not real PoE2 reforge recipes), delete dead `recipe.py` code, add `getCategoryRuName()` helper + wire `getCurrencyRuName()` into 8 components, fix `take-profit-calculator.tsx` (14 hardcoded EN strings), fix `events-sidebar.tsx` English month array, add Russian parallel table + `?lang=` param to phase_hints backend.

Work Log:
- Reviewed user feedback + STATUS.md / AGENT_NAVIGATION.md / key source files (currency-names.ts, phase_hints.py, market-overview.tsx, liquid-chain-tab.tsx, config.yaml, take-profit-calculator.tsx, events-sidebar.tsx, analyst-tab.tsx, speculation-tab.tsx).
- Spawned 3 parallel Explore subagents to map (a) i18n leakage across all dashboard components, (b) Speculation tab structure + feasibility of "buy-low/sell-high with history" request, (c) Heatmap sorting + Craft tab problems. Used their reports to scope iter 87.
- **Frontend i18n leakage fixes (7 components + 1 helper):**
  - `src/lib/currency-names.ts` — added `CATEGORY_NAMES_RU` (17 entries), `CATEGORY_NAMES_EN`, `getCategoryRuName()`, `getCategoryEnName()`, `getCurrencyDisplayName(apiId, locale)`, `getCategoryDisplayName(slug, locale)`. `getCurrencyDisplayName` returns `null` when no mapping exists so callers can fall back to upstream `text` field via `||` (this keeps the helper composable — verified by content-pulse-widget tests).
  - `src/components/dashboard/market-overview.tsx` — heatmap: added `useMemo` `sortedHeatmap` (sort by `|change24h|` desc, cap 30 tiles). Heatmap labels now `getCurrencyDisplayName(item.currency, locale) ?? item.currency` + `title=` attr with both localized name + raw api_id. Top Gainers/Losers + top movers bar chart use `getCurrencyDisplayName(i.apiId || i.id, locale) || i.name`.
  - `src/components/dashboard/currency-card.tsx` — `getCurrencyDisplayName(item.apiId || item.id, locale) || item.name` for card title.
  - `src/components/dashboard/exchange-pair-card.tsx` — RU names for both `pair.currency1Id`/`pair.currency2Id`. Replaced hardcoded `"7d"` with `t("sevenDay")`. Comparison label uses localized names.
  - `src/components/dashboard/exchange-table.tsx` — RU names in pair-name cells, comparison-label, anchor-name (CrossCurrencyPremiumCell), sort comparator for "pair" column now uses localized names so RU sort order is alphabetical.
  - `src/components/dashboard/content-pulse-widget.tsx` — `CategoryBlock` now takes `locale` prop. Category slug → `getCategoryDisplayName()`. Mover name → `getCurrencyDisplayName(m.apiId, locale) || m.text`.
  - `src/components/dashboard/speculation-tab.tsx` — added `potentialProfitPct` (frontend-computed from `currentPrice` + `mean` — partial solution to user's buy-low/sell-high request). Localized signal enum (BUY/SELL/HOLD) via `t("speculationFilterBuy/Sell/Hold")`. Category slug + item name localized. Same localization applied to `TradeRow` (backtest panel). Added `speculationPotentialProfit` + `speculationPotentialProfitTitle` i18n keys (all 4 locales).
  - `src/components/dashboard/analyst-tab.tsx` — `getCurrencyDisplayName(trend.apiId, locale) || trend.apiId` + `getCurrencyDisplayName(anomaly.apiId, locale) || anomaly.apiId` (fallback apiId, since analyst response has no `text` field).
- **i18n key updates (4 locales — en/ru/zh/ko):**
  - Added `speculationPotentialProfit`, `speculationPotentialProfitTitle`.
  - Added `takeProfitTP1`/`TP2`/`TP3`/`SL1`/`SL2`/`SL3` (with `{0}` placeholder for tier name) + `fallbackOptimizer` + `fallbackAnalyst`.
  - Added `eventsDaysHours`, `eventsHoursMinutes`, `eventsMinutes` (with `{0}`/`{1}` placeholders for time components).
  - `ru.ts`: `speculationFilterBuy/Sell/Hold` translated to `ПОКУПАТЬ/ПРОДАВАТЬ/ДЕРЖАТЬ` (was English "BUY/SELL/HOLD"). `speculationStd` → `СКО {0}` (was "std"). Updated `liquidChainNoReforgeNotice` (old text mentioned "Древние" liquids that don't exist in the chain post-cleanup).
  - `en.ts`: updated `liquidChainNoReforgeNotice` to reflect the iter 87 chain cleanup.
- **Currency Graph tab — COMPLETELY REMOVED:**
  - Deleted `src/components/dashboard/currency-graph-tab.tsx` + `src/__tests__/currency-graph-tab.test.tsx`.
  - `dashboard-page.tsx`: removed `CurrencyGraphTab` dynamic import + `<TabsContent value="graph">` block + comment mentioning CurrencyGraph.
  - `dashboard-toolbar.tsx`: removed `<TabsTrigger value="graph">` + unused `Network` lucide import.
  - `shortcuts-dialog.tsx`: removed the `9 → tabGraph` row.
  - `skeletons.tsx`: removed `CurrencyGraphSkeleton` (was unused after removal).
  - `integration.test.tsx`: rewrote — was 8 tests using `<CurrencyGraphTab>`, now 3 pure-logic `FlipperApiError` classification tests (the only tests that didn't depend on the removed component).
  - `flipper-backend-status-card.tsx`: updated docstring comment ("Extracted from flips-tab and the now-removed currency-graph-tab").
- **Liquid Chain ("Craft") tab cleanup:**
  - `config.yaml` (353 → 226 lines): removed 3 `concentrated-liquid-*` steps from `delirium_liquids` chain (drop-only items, cannot be obtained via vendor reforge). `liquid-despair` ratio changed from `3` to `1` (last reforgeable tier). Removed the entire `ritual_omens` chain (28 entries — PoE2 has no omen reforge recipe at the vendor). YAML syntax verified with `python3 -c "import yaml; yaml.safe_load(open('config.yaml'))"`.
  - `ru.ts` / `en.ts`: updated `liquidChainNoReforgeNotice` text to reflect the cleanup. The `ritualOmensTitle` / `ritualOmensNoReforgeNotice` keys remain in i18n files (harmless — no longer referenced by any component since `chainDisplayName` falls back to raw chain name when no i18n key matches).
- **Dead code removal:**
  - Deleted `backend/arbitrage/recipe.py` (zero production callers — verified by grep). No `recipes:` key in `config.yaml`. Module was a generic vendor-recipe calculator that was never wired up.
  - Deleted `tests/test_recipe.py` (only test file that imported recipe.py — 6 tests removed).
  - `backend/models/currency.py`: removed the `RecipeOpportunity` dataclass (lines 261-274 — only used by recipe.py).
  - `docs/BACKEND_GUIDE.md`: replaced §6.9 "Recipe Arbitrage" with a "REMOVED in iter 87" note explaining what was deleted + why. Removed `test_recipe.py` from the test-file listing.
  - `docs/ARCHITECTURE.md`: removed the `RecipeArb | backend/arbitrage/recipe.py | Vendor recipe arbitrage` row from the module table.
- **Backend phase_hints i18n (parallel Russian table + ?lang= param):**
  - `backend/economy/phase_hints.py`: added `_PHASE_HINTS_RU` (12 hints × 3 fields — title/detail/action — covering EARLY/MID/LATE phases, mirroring the English `_PHASE_HINTS` table). Added `_PHASE_META_RU` (3 phase labels + summaries). Updated `get_phase_hints()` signature to accept `lang: str = "en"` keyword arg — when `lang == "ru"` returns the Russian table + Russian fallback metadata.
  - `backend/api/routes_phase_hints.py`: added `lang: str = Query("en", ...)` query param to `get_phase_hints_route()`. Forwards to `get_phase_hints(..., lang=lang)`. Error path also branches on `lang` to return Russian fallback strings when appropriate.
  - `src/app/api/flipper/phase-hints/route.ts`: reads `lang` from incoming request query string and forwards it to the FastAPI backend. Offline fallback also branches on `lang` for the `phaseLabel` field.
  - `src/components/dashboard/phase-hints-widget.tsx`: pulls `locale` from `useI18n()`, maps to `lang = locale === "ru" ? "ru" : "en"`, includes `lang` in `queryKey` (so language switch triggers refetch), passes `{ lang }` as query param to `fetchApi`.
- **take-profit-calculator.tsx i18n (14 hardcoded EN strings → t() calls):**
  - Added `confidenceLabel(c)` helper that maps `"High"/"Medium"/"Low"` → `t("confidenceHigh/Medium/Low")`.
  - Added `levelLabel(level)` helper that composes TP1/TP2/TP3/SL1/SL2/SL3 labels from `t("takeProfitTP1/TP2/TP3/SL1/SL2/SL3", { 0: tierName })` where `tierName` is the localized `t("takeProfitConservative/Optimistic/Aggressive/Pessimistic")`.
  - Replaced title/position-size/risk-reward/entry-price/position-value/take-profit-levels/stop-loss-levels labels with their `t()` equivalents (keys already existed in en.ts/ru.ts).
  - Replaced `{level.label}` with `{levelLabel(level)}` and `{level.confidence}` with `{confidenceLabel(level.confidence)}` in both TP and SL rendering.
- **events-sidebar.tsx i18n (English month array → locale-aware):**
  - Replaced hardcoded `["Jan", "Feb", ..., "Dec"]` array + manual date assembly with `d.toLocaleDateString(bcp47, { month: "short", day: "numeric" })` + `d.toLocaleTimeString(bcp47, { hour: "2-digit", minute: "2-digit" })`. Maps `ru → ru-RU`, `zh → zh-CN`, `ko → ko-KR`, fallback `en-US`.
  - Updated `formatExpiry` to use new i18n keys `eventsDaysHours`/`eventsHoursMinutes`/`eventsMinutes` with `{0}`/`{1}` interpolation (was hardcoded `${days}d ${hours}h` etc.).
  - Added `locale` to `useI18n()` destructure. Updated `formatCreatedAt` call site to pass `locale`.
- **dashboard-page.tsx:912,919 — ErrorBoundary fallback titles:**
  - Replaced `"Optimizer Error"` literal with `t("fallbackOptimizer")`.
  - Replaced `"Analyst Error"` literal with `t("fallbackAnalyst")`.
  - Added both keys to all 4 locale files.
- **Verification:**
  - `python3 -m pytest tests/ --ignore=tests/e2e --ignore=tests/test_scheduler.py` → **757 passed** (was 763 in iter 86 — 6 fewer because test_recipe.py was deleted).
  - Targeted: `pytest tests/test_phase_hints.py tests/test_currency_names_ru.py tests/test_liquid_chain.py` → 86 pass.
  - `npx jest` → **405 passed, 19 suites passed** (was 415 in iter 86 — 10 fewer because currency-graph-tab.test.tsx was deleted, integration.test.tsx was rewritten to 3 tests instead of 8).
  - Fixed 2 self-caught test bugs: (1) `getCurrencyDisplayName` initially returned api_id when no mapping existed — broke `||` fallback chains in tests; fixed to return `null` so callers' `|| text` fallback works. (2) `BacktestPanel` subcomponent was missing `locale` in its `useI18n()` destructure after adding `locale` prop to `TradeRow` — added `locale` to destructure. Also updated phase-hints-widget tests: hydration now triggers 2 initial fetches (default "ru" locale + stored "en" locale after hydration) instead of 1 — assertion counts bumped accordingly.
  - Updated tests for new `?lang=` param contract: phase-hints-widget tests now assert `expect.objectContaining({ lang: expect.stringMatching(/^(ru|en)$/) })` instead of bare URL.
- **Documentation:**
  - `STATUS.md`: bumped "Last updated" to iter 87. Added iter 87 row in Product Features section (i18n cleanup + Currency Graph removal + Liquid Chain cleanup + recipe.py deletion + phase_hints ?lang + potentialProfitPct + take-profit-calculator i18n + events-sidebar locale-aware dates). Added new "Known Issues — Deferred to iter 88" section with 5 entries (Speculation tab redesign, Exchanges 7d changes not loading, "Premium" column meaning unclear, Flips tab applicability to PoE2, analyst-tab fact.text still English from backend).
  - `AGENT_NAVIGATION.md`: bumped "Last updated" to iter 87. Added invariant #39 (i18n leakage fix pattern). Updated §1 module rows for `currency-names.ts` (added `getCategoryRuName` + `getCurrencyDisplayName` + `getCategoryDisplayName` exports), `phase_hints.py` (added `_PHASE_HINTS_RU` + `_PHASE_META_RU` + `lang` param), `routes_phase_hints.py` (added `?lang=` query param), `phase-hints/route.ts` (forwards `lang`), `phase-hints-widget.tsx` (forwards `lang` from `useI18n().locale`). Updated `recipe.py` row → "DELETED in iter 87". Updated `currency-graph-tab.tsx` row → "DELETED in iter 87". Removed `RecipeOpportunity` row.
  - `PRODUCT_VISION.md`: bumped "Last updated" to iter 87. Added iter 87 changelog entry. Documented the 5 Known Issues (deferred to iter 88).
  - `docs/BACKEND_GUIDE.md` + `docs/ARCHITECTURE.md`: removed recipe.py references.
  - `worklog.md`: trimmed iter 85 (removed — 2 iterations old, fully shipped, see git log). Trimmed iter 86 to Stage Summary only (1 iteration old). Added this iter 87 record (full detail).

Stage Summary:
- **iter 87 SHIPPED — i18n leakage fixed across 7 frontend components + 1 backend module + 2 i18n key additions.** All 4 locale files (en/ru/zh/ko) updated with new keys. Currency Graph tab completely removed. Liquid Chain tab cleaned up (removed fabricated Concentrated + Ritual Omens chains). Dead `recipe.py` code deleted. Backend `phase_hints.py` now serves a parallel Russian hint table via `?lang=ru`. Speculation tab got `potentialProfitPct` as partial fix for user's buy-low/sell-high request. Full take-profit-calculator + events-sidebar i18n cleanup.
- **Tests: 757 pytest + 405 jest pass** (was 763 + 415 in iter 86 — delta is 6 pytest from deleted test_recipe.py + 10 jest from deleted currency-graph-tab.test.tsx + rewritten integration.test.tsx).
- **Files changed (29 total):**
  - Backend (5): `backend/economy/phase_hints.py`, `backend/api/routes_phase_hints.py`, `backend/models/currency.py`, `backend/arbitrage/recipe.py` (DELETED), `tests/test_recipe.py` (DELETED).
  - Frontend components (10): `src/lib/currency-names.ts`, `src/components/dashboard/market-overview.tsx`, `src/components/dashboard/currency-card.tsx`, `src/components/dashboard/exchange-pair-card.tsx`, `src/components/dashboard/exchange-table.tsx`, `src/components/dashboard/content-pulse-widget.tsx`, `src/components/dashboard/speculation-tab.tsx`, `src/components/dashboard/analyst-tab.tsx`, `src/components/dashboard/take-profit-calculator.tsx`, `src/components/dashboard/events-sidebar.tsx`.
  - Frontend infrastructure (5): `src/components/dashboard/dashboard-page.tsx`, `src/components/dashboard/dashboard-toolbar.tsx`, `src/components/dashboard/shortcuts-dialog.tsx`, `src/components/dashboard/skeletons.tsx`, `src/components/dashboard/flipper-backend-status-card.tsx`, `src/components/dashboard/phase-hints-widget.tsx`.
  - Frontend deleted (2): `src/components/dashboard/currency-graph-tab.tsx`, `src/__tests__/currency-graph-tab.test.tsx`.
  - Frontend tests (2): `src/__tests__/integration.test.tsx` (rewritten), `src/__tests__/phase-hints-widget.test.tsx` (updated for ?lang= contract).
  - API route (1): `src/app/api/flipper/phase-hints/route.ts`.
  - i18n locales (4): `src/lib/i18n/locales/en.ts`, `src/lib/i18n/locales/ru.ts`, `src/lib/i18n/locales/zh.ts`, `src/lib/i18n/locales/ko.ts`.
  - Config (1): `config.yaml` (Liquid Chain cleanup).
  - Docs (6): `STATUS.md`, `AGENT_NAVIGATION.md`, `PRODUCT_VISION.md`, `docs/BACKEND_GUIDE.md`, `docs/ARCHITECTURE.md`, `worklog.md`.
- **5 Known Issues documented as deferred to iter 88:** (1) Speculation tab redesign — user wants buy/sell spread + history view + profit calc; partial fix (`potentialProfitPct`) shipped, full redesign needs either join with `/flips` endpoint for synthetic bid/ask, or GGG official trade API scraping (rate-limited, OAuth2). (2) Exchanges tab 7d changes not loading — backend investigation needed. (3) "Premium" column meaning unclear — needs tooltip or removal. (4) Flips tab applicability to PoE2 — synthetic spread model may not match user's mental model. (5) `analyst-tab.tsx` `fact.text` still renders English from backend — needs fact-template generation moved to frontend.

Next iteration (iter 88) — recommended priorities:
1. **Speculation tab redesign (P1)** — full buy-low/sell-high view with synthetic bid/ask from `/flips` + history sparkline + `potentialProfitPct`. See Known Issues §1.
2. **Exchanges 7d changes not loading** — backend scheduler/debugging. See Known Issues §2.
3. **analyst-tab fact.text i18n** — move 5 fact templates from `routes_analyst.py` / `analyst-fallback/route.ts` to frontend; backend sends structured data (apiId, changePct, count) + frontend formats via `t("analystFactBiggestGainer", {0, 1})` etc. See Known Issues §5.
4. **"Premium" column tooltip / removal** — clarify cross-currency premium meaning in exchange-table.tsx. See Known Issues §3.
5. **Flips tab relabelling** — consider hiding or relabelling if synthetic spread model doesn't match user expectations. See Known Issues §4.
6. **Visual verification** — manual test of the heatmap sort, RU names in Currencies/Exchange tabs, phase-hints widget Russian content (after running backend with `?lang=ru`), Liquid Chain tab (should show only delirium_liquids now).

NOT done in iter 87 (intentionally deferred):
- analyst-tab `fact.text` English content from backend (Known Issues §5).
- Speculation tab full redesign (Known Issues §1 — only `potentialProfitPct` shipped).
- Exchanges 7d changes backend investigation (Known Issues §2).
- "Premium" column tooltip clarification (Known Issues §3).
- Flips tab applicability review (Known Issues §4).
- Date formatting in 10+ chart components (`comparative-chart.tsx`, `comparison-dialog.tsx`, `pair-comparison-dialog.tsx`, `pair-detail-dialog.tsx`, `detail-dialog.tsx`, `storage-value-history-chart.tsx`, `watchlist-tab.tsx`) — still use `toLocaleDateString("en-US", ...)`. Pattern is established in events-sidebar.tsx (iter 87); apply same `locale` propagation pattern. Low priority — only visible when user opens detail dialogs.
- Optimizer-tab + analyst-tab `t("...") || "English fallback"` cleanup pattern (defensive code, harmless — `t()` always returns a value).
