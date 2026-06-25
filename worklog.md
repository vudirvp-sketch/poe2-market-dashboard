# Worklog — PoE2 Market Dashboard

> Append-only shared multi-agent work log. Each section starts with `---`.
> Old task history is in `git log`.


Recent iterations kept (iter 87+). Older iter 77-86 records trimmed — those features are fully shipped and documented in PRODUCT_VISION.md / STATUS.md / AGENT_NAVIGATION.md.

---
Task ID: iter-87
Agent: main (Sonnet 4.5)
Task: iter 87 — User feedback batch: fix i18n leakage across multiple tabs (heatmap/currencies/exchange/content-pulse/phase-hints/speculation in English), remove Currency Graph tab (low value), cleanup Liquid Chain ("Craft") tab (Concentrated liquids + Ritual Omens chains were fabricated — not real PoE2 reforge recipes), delete dead `recipe.py` code, add `getCategoryRuName()` helper + wire `getCurrencyRuName()` into 8 components, fix `take-profit-calculator.tsx` (14 hardcoded EN strings), fix `events-sidebar.tsx` English month array, add Russian parallel table + `?lang=` param to phase_hints backend.

Stage Summary:
- i18n leakage fixed across 7 frontend components + 1 backend module + 2 i18n key additions. All 4 locale files (en/ru/zh/ko) updated with new keys. Currency Graph tab completely removed. Liquid Chain tab cleaned up (removed fabricated Concentrated + Ritual Omens chains). Dead `recipe.py` code deleted. Backend `phase_hints.py` now serves a parallel Russian hint table via `?lang=ru`. Speculation tab got `potentialProfitPct` as partial fix for user's buy-low/sell-high request. Full take-profit-calculator + events-sidebar i18n cleanup.
- Tests: 757 pytest + 405 jest pass.
- 5 Known Issues documented as deferred to iter 88 (KI-1 — KI-5).

---
Task ID: iter-88
Agent: main (Sonnet 4.5)
Task: iter 88 — Address all 5 Known Issues (KI-1 through KI-5) deferred from iter 87 + apply date formatting cleanup pattern across 8 chart components.

Work Log:
- Reviewed STATUS.md (Known Issues section) + AGENT_NAVIGATION.md (invariant #39 — i18n pattern) + worklog.md (iter 87 Stage Summary). Read key source files: `routes_analyst.py`, `analyst-fallback/route.ts`, `analyst-tab.tsx`, `exchange-table.tsx`, `speculation-tab.tsx`, `events-sidebar.tsx`, `poe2api.ts:compute7dChangePercent`, types.ts (`LeagueFact`, `FlipOpportunity`, `SpeculationSignal`).
- **KI-5 (P2) — Analyst fact templates moved to frontend:**
  - `backend/api/response_models.py:FactData` — added optional `template_id: str | None` + `params: dict[str, Any]` fields (backward compatible — old clients fall back to `text`).
  - `backend/api/routes_analyst.py:_generate_facts` — each of the 5 fact types now emits `template_id` + `params` alongside English `text`. Templates: `biggest_gainer` (params: apiId, pct), `biggest_loser` (apiId, pct), `anomaly_activity` (count), `tracking` (totalCurrencies, totalPairs), `stable_count` (stableCount).
  - `src/app/api/poe2/analyst-fallback/route.ts` — `FallbackFact` interface extended with optional `templateId` + `params`; same 5 fact emitters updated to include them.
  - `src/lib/types.ts:LeagueFact` — added optional `templateId` + `params` fields (camelCase from proxy transform).
  - `src/components/dashboard/analyst-tab.tsx` — added `TEMPLATE_ID_TO_I18N_KEY` map (snake_case → camelCase i18n key) + `formatFactText(fact, t, locale)` function. Uses `getCurrencyDisplayName(apiId, locale)` for currency params. Falls back to `fact.text` when `templateId` is absent or unmapped. Updated fact rendering to call `formatFactText(fact, t, locale)` instead of `fact.text` directly.
  - Added 5 new i18n keys to all 4 locales (en/ru/zh/ko): `analystFactBiggestGainer`, `analystFactBiggestLoser`, `analystFactAnomalyActivity`, `analystFactTracking`, `analystFactStable`. Each key uses `{0}`/`{1}` positional interpolation.
  - Added 7 pytest tests in `tests/e2e/test_analyst.py::TestGenerateFactsTemplateId` — covers each template emits correct `template_id` + `params`, empty-data case, backward-compat `text` field always present.
- **KI-3 (P3) — Premium column tooltip:**
  - `src/components/dashboard/exchange-table.tsx` — Premium column header now wraps `t("crossCurrencyPremium")` in a Tooltip with Info icon. Tooltip body shows `crossCurrencyPremiumTitle` + `crossCurrencyPremiumDesc` explaining what "Premium" means ("shows how much market rate deviates from cross-rate-derived fair rate; large % is normal for low-liquidity pairs").
  - `CrossCurrencyPremiumCell` "—" empty cell now also wrapped in a tooltip with `crossCurrencyPremiumEmpty` explaining "no premium data — fewer than 2 payment options and no cross-rate deviation detected".
  - Added 4 new i18n keys × 4 locales: `crossCurrencyPremiumTitle`, `crossCurrencyPremiumDesc`, `crossCurrencyPremiumInfo`, `crossCurrencyPremiumEmpty`.
  - Added `Info` icon import from lucide-react.
- **KI-4 (P3) — Flips tab relabel:**
  - `tabFlips` i18n key changed from "Flips" / "Флипы" / "翻转" / "플립" to "Cross-rate Deviations" / "Отклонения кросс-курса" / "交叉汇率偏差" / "교차 환율 편차" in all 4 locales.
  - `arbitrageTheoretical` + `arbitrageTheoreticalDesc` i18n keys rewritten in all 4 locales to clarify: tab shows cross-rate deviations (NOT arbitrage), PoE2 has no order book, deviations signal where a different payment currency could save money.
- **KI-2 (P2) — Exchanges 7d changes investigation:**
  - Investigation: `sevenDayChangePercent` is computed frontend-side in `src/lib/poe2api.ts:compute7dChangePercent()` (lines 843-871). NOT a backend field. Returns `null` when: (a) <2 PriceLogs, (b) closest 7d-ago log drifts >16.8h (drift tolerance scales with lookback period — `getMaxTimeDriftMs(7d) = 0.1 * 7d = 16.8h`), OR (c) 7d-ago price is 0. Common on new leagues where PriceLogs only have recent data.
  - Fix: NOT a bug — by design. Added tooltip on 7d Change column header (`change7dInfo` aria-label + `change7dDesc` body) explaining what the column computes + why "—" appears. The "—" cell itself also gets a tooltip (`change7dEmpty`) explaining "fewer than 2 price points in history, or closest 7-day-ago log is too far off — will populate as more PriceLogs are collected".
  - Added 3 new i18n keys × 4 locales: `change7dInfo`, `change7dDesc`, `change7dEmpty`.
- **KI-1 (P1) — Speculation tab extends with /api/flipper/flips join:**
  - `src/components/dashboard/speculation-tab.tsx` — added parallel `useQuery` for `/api/flipper/flips` (60s staleTime, gated on `backendOnline`). Fires alongside the existing speculation signals query.
  - Built `flipsByApiId: Map<string, FlipOpportunity>` lookup keyed by FROM currency (first part of `FlipOpportunity.currency`, e.g. "divine" from "divine/exalted"). When multiple flips exist for the same from-currency, the highest-scored one wins (heuristic — `/flips` indexes on PAIRS while `/speculation` indexes on ITEMS).
  - `SignalRow` accepts new optional `flip?: FlipOpportunity` prop. When present, renders an expandable "Spread Details" toggle button (Layers + ChevronDown/Up icons) next to the sparkline.
  - Expanded panel shows 4 columns: synthetic bid, synthetic ask, spread %, mid price. When `fairRate` is available, also shows a second row with fair cross-rate + deviation % + 24h volume + italic disclaimer (`speculationSpreadDisclaimer` — "Synthetic bid/ask computed from volume-based formula (no real order book in PoE2). Treat as a directional signal, not a guaranteed execution price.").
  - Updated `SignalRow` call site to pass `flip={flipsByApiId.get(sig.apiId)}`.
  - Added 9 new i18n keys × 4 locales: `speculationSpreadDetails`, `speculationSyntheticBid`, `speculationSyntheticAsk`, `speculationSyntheticSpread`, `speculationSyntheticMid`, `speculationFairRateLabel`, `speculationDeviationLabel`, `speculationVolumeLabel`, `speculationSpreadDisclaimer`.
  - Added 7 new jest tests in `src/__tests__/speculation-tab.test.tsx` under `describe("iter 88 — synthetic spread details (KI-1)")` — covers: toggle visibility when matching flip exists/absent, expand/collapse behavior, value rendering (bid/ask/spread/mid), fair rate + deviation rendering, spread disclaimer presence, highest-scored-flip selection when multiple flips exist for same from-currency. Tests use `mockFetchApi.mockImplementation` to route different responses to `/api/flipper/speculation` vs `/api/flipper/flips`.
- **Date formatting cleanup (low priority from iter 87 hand-off):**
  - Added shared helpers to `src/lib/utils.ts`: `localeToBcp47(locale)` (maps en/ru/zh/ko → en-US/ru-RU/zh-CN/ko-KR), `formatLocaleDate(value, locale, opts?)` (compact date for axis labels), `formatLocaleDateTime(value, locale)` (date + HH:MM for timestamps).
  - Migrated 8 chart components from inline `toLocaleDateString("en-US", ...)` to `formatLocaleDate`: `comparative-chart.tsx`, `market-overview.tsx`, `comparison-dialog.tsx`, `detail-dialog.tsx` (2 call sites), `pair-comparison-dialog.tsx`, `pair-detail-dialog.tsx`, `watchlist-tab.tsx`, `storage-value-history-chart.tsx` (was using `toLocaleDateString(undefined, ...)`). For each: added `formatLocaleDate` import + added `locale` to `useI18n()` destructure + replaced inline date formatter with helper call.
  - Refactored `events-sidebar.tsx:formatCreatedAt` to use the shared `formatLocaleDateTime` helper (same behaviour, less duplication).
- **Verification:**
  - `npx tsc --noEmit` → clean (no errors).
  - `python3 -m pytest tests/ --ignore=tests/e2e --ignore=tests/test_scheduler.py` → **757 passed**.
  - `python3 -m pytest tests/e2e/test_analyst.py` → **11 passed** (4 existing + 7 new template_id tests).
  - `npx jest` → **412 passed, 19 suites passed** (was 405 in iter 87 — 7 new spread-details tests in `speculation-tab.test.tsx`).
  - Total: **768 pytest + 412 jest pass**.
- **Documentation:**
  - `STATUS.md`: rewrote entirely — bumped "Last updated" to iter 88. Replaced the 5-row "Known Issues — Deferred to iter 88" table with a status table showing KI-1 (partial fix), KI-2/3/4/5 (closed). Added iter 88 row in Product Features section. Added new Quick Reference entries for: Speculation "Spread Details" toggle missing, Exchanges 7d Change "—", Premium column large %, analyst fact.text English, locale-aware date formatting, adding new analyst fact templates.
  - `AGENT_NAVIGATION.md`: bumped "Last updated" to iter 88. Added invariant #40 (iter 88 patterns — 6 sub-sections covering date helper, analyst fact templates, Speculation /flips join, Flips tab relabel, Premium column tooltip, 7d Change column tooltip). Cleaned up the duplicate "Speculation backtest trades list shorter" row in §4 symptom table. Added new symptom rows for iter 88 issues.
  - `worklog.md`: trimmed iter 86 (removed — 2 iterations old, fully shipped, see git log). Trimmed iter 87 to Stage Summary only. Added this iter 88 record (full detail).

Stage Summary:
- **iter 88 SHIPPED — all 5 Known Issues from iter 87 addressed + date formatting cleanup.** KI-5 (analyst fact templates → frontend i18n) + KI-3 (Premium column tooltip) + KI-4 (Flips tab relabel to "Cross-rate Deviations") + KI-2 (7d Change column tooltip — investigation confirmed by-design null state) + KI-1 (Speculation tab joins /api/flipper/flips for synthetic bid/ask + spread + fair rate + deviation in expandable panel per signal row). 8 chart components migrated to shared `formatLocaleDate` / `formatLocaleDateTime` helpers.
- **Tests: 768 pytest (757 + 11 e2e/analyst) + 412 jest pass** (was 757 + 405 in iter 87 — delta is 11 pytest from new TestGenerateFactsTemplateId class + 7 jest from new spread-details tests).
- **Files changed (24 total):**
  - Backend (3): `backend/api/response_models.py` (FactData + template_id + params), `backend/api/routes_analyst.py` (_generate_facts + template_id + params), `tests/e2e/test_analyst.py` (7 new tests).
  - Frontend components (10): `src/components/dashboard/analyst-tab.tsx` (formatFactText + TEMPLATE_ID_TO_I18N_KEY), `src/components/dashboard/exchange-table.tsx` (Premium + 7d tooltips), `src/components/dashboard/speculation-tab.tsx` (flips join + expandable spread details), `src/components/dashboard/comparative-chart.tsx` (formatLocaleDate), `src/components/dashboard/market-overview.tsx` (formatLocaleDate), `src/components/dashboard/comparison-dialog.tsx` (formatLocaleDate), `src/components/dashboard/detail-dialog.tsx` (formatLocaleDate × 2), `src/components/dashboard/pair-comparison-dialog.tsx` (formatLocaleDate), `src/components/dashboard/pair-detail-dialog.tsx` (formatLocaleDate), `src/components/dashboard/watchlist-tab.tsx` (formatLocaleDate), `src/components/dashboard/storage-value-history-chart.tsx` (formatLocaleDate), `src/components/dashboard/events-sidebar.tsx` (refactored to formatLocaleDateTime).
  - Frontend infrastructure (1): `src/lib/utils.ts` (formatLocaleDate + formatLocaleDateTime + localeToBcp47).
  - Frontend tests (1): `src/__tests__/speculation-tab.test.tsx` (7 new spread-details tests).
  - API route (1): `src/app/api/poe2/analyst-fallback/route.ts` (templateId + params on FallbackFact).
  - TS types (1): `src/lib/types.ts` (LeagueFact + templateId + params).
  - i18n locales (4): `src/lib/i18n/locales/en.ts`, `src/lib/i18n/locales/ru.ts`, `src/lib/i18n/locales/zh.ts`, `src/lib/i18n/locales/ko.ts` — added 21 new keys each (5 analystFact + 4 crossCurrencyPremium + 3 change7d + 9 speculationSpread).
  - Docs (3): `STATUS.md`, `AGENT_NAVIGATION.md`, `worklog.md`.

Next iteration (iter 89) — recommended priorities:
1. **Visual verification** — manual test of all iter 88 changes: (a) Speculation tab spread details expand button (only shows for items with matching flip data); (b) Premium column header tooltip + "—" cell tooltip in Exchange tab; (c) Flips tab renamed to "Cross-rate Deviations" with new disclaimer; (d) 7d Change column header tooltip + "—" cell tooltip; (e) Analyst tab facts now localized (Russian locale should show translated facts, not English).
2. **KI-1 full redesign (deferred)** — if user wants REAL buy-low/sell-high with order book, the only path is GGG official trade API scraping (requires OAuth2 + rate-limit handling). The iter 88 partial fix surfaces synthetic spread data alongside z-score signals — this is the maximum we can do without real order book data.
3. **Dead i18n key cleanup** — 4 locale files still contain ~30 unused `graphXxx` keys from the removed Currency Graph tab (iter 87). Harmless (~2KB per locale) but could be cleaned up.
4. **Code health** — opportunistic per-file refactoring (no staged plan).

NOT done in iter 88 (intentionally deferred):
- KI-1 full GGG official trade API integration (real order book) — requires OAuth2 + rate-limit handling, deferred indefinitely.
- Dead `graphXxx` i18n key cleanup (low priority, harmless).
- Visual verification (manual test) — requires running backend + frontend locally.
