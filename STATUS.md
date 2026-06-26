# STATUS.md — Known Issues & Product Features Backlog

> **Last updated:** 2026-06-26 (iter 89 — dead i18n key cleanup + KI-6 shortcuts dialog mismatch fix)
> Single source of truth for known bugs, refactoring priorities, and product-feature progress.
> Update BEFORE fixing any issue. Cross-reference issue IDs in commits.

---

## Known Issues — empty (KI-1 through KI-6 all closed)

All 5 user-feedback issues from iter 87 (KI-1 – KI-5) were closed in iter 88. KI-6 (found during iter 89 cleanup) was closed in iter 89. No new known issues.

| ID | Status | Notes |
|----|--------|-------|
| **KI-1** | ✅ Partial fix (iter 88) | Speculation tab now joins `/api/flipper/flips` for synthetic bid/ask + spread + fair rate + deviation. Expandable "Spread Details" panel per signal row (toggle button). NOT a full redesign — synthetic spread data comes from the same volume-based formula as before, but now it's surfaced alongside the z-score signal. Full GGG official trade API scraping (real order book) still deferred — requires OAuth2 + rate-limit handling. |
| **KI-2** | ✅ Closed (iter 88) | `sevenDayChangePercent` is computed frontend-side in `poe2api.ts:compute7dChangePercent()`. Returns `null` when <2 PriceLogs OR closest 7d-ago log drifts >16.8h OR 7d-ago price is 0. Common on new leagues. Tooltip added on column header + `—` cell. By design. |
| **KI-3** | ✅ Closed (iter 88) | Premium column header has Info icon + tooltip. The `—` cell also has a tooltip. |
| **KI-4** | ✅ Closed (iter 88) | Flips tab renamed to "Cross-rate Deviations" in all 4 locales. Disclaimer banner rewritten. |
| **KI-5** | ✅ Closed (iter 88) | 5 analyst fact templates moved to frontend. Backend sends `template_id` + `params`. Frontend formats via i18n keys. Backward compatible. |
| **KI-6** | ✅ Closed (iter 89) | Shortcuts dialog (`shortcuts-dialog.tsx`) was showing outdated tab mapping: "7 → Forecast, 8 → Portfolio, 0 → Watchlist". Actual `TAB_MAP` in `dashboard-page.tsx` was already updated to: 7→Optimizer, 8→Analyst, 9→Storage Value, 0→Speculation. Fixed dialog to match `TAB_MAP`. Pre-existing limitation: liquid-chain + watchlist are NOT reachable via keyboard shortcuts (TAB_MAP has 13 entries but shortcuts only cover indices 0–9). Not a regression — was always this way. |

---

## Technical-debt backlog — empty

All P0–P4 issues closed in iter 54–73. iter 88 added `formatLocaleDate` / `formatLocaleDateTime` / `localeToBcp47` helpers in `src/lib/utils.ts`. iter 89 removed 30 dead i18n keys × 4 locales (see iter 89 row below).

---

## Product Features (F1–F6) — see `PRODUCT_VISION.md`

| Feature | Status | Notes |
|---------|--------|-------|
| **F1** — Translate remaining ~276 items | ✅ **Done (iter 85 + iter 86)** | `scripts/sync_currency_names_from_poe2db.py` shipped + tested. Counts: ru=349, en=349. |
| **F2** — Storage Value UI tab | ✅ **Done (iter 74 + iter 75)** | Tab + historical chart shipped. |
| **F3** — `content_pulse` module | ✅ **Done (iter 75)** | `backend/economy/content_pulse.py` + route. 44 pytest tests. |
| **F4** — «Что фармить сегодня» widget | ✅ **Done (iter 76)** | `src/components/dashboard/content-pulse-widget.tsx`. 16 jest tests. |
| **F5** — Speculation tab with z-score signals | ✅ **Done (iter 77 + iter 79 backtest + iter 80 UI + iter 88 spread details)** | Live signals + backtest + expandable "Spread Details" panel per signal row (iter 88). |
| **F6** — Phase-aware hints | ✅ **Done (iter 78 + iter 87 i18n)** | Backend `?lang=ru` + i18n widget. 61 pytest + 26 jest tests. |
| **iter 87** — i18n leakage cleanup + dead code removal | ✅ **Done** | 7 components + 1 backend module. Currency Graph tab removed. Liquid Chain cleanup. Phase hints `?lang=ru`. |
| **iter 88** — KI-1 through KI-5 + date formatting cleanup | ✅ **Done** | All 5 KIs from iter 87 addressed. 8 chart components migrated to shared `formatLocaleDate`. Tests: 768 pytest + 412 jest pass. |
| **iter 89** — Dead i18n key cleanup + KI-6 fix | ✅ **Done** | **KI-6 (P3):** shortcuts-dialog.tsx was showing outdated tab mapping (7→Forecast, 8→Portfolio, 0→Watchlist) — fixed to match `TAB_MAP` (7→Optimizer, 8→Analyst, 9→Storage Value, 0→Speculation). **Dead i18n cleanup:** removed 30 dead keys × 4 locales = 120 lines: 24 `graphXxx` keys (from removed Currency Graph tab iter 87) + `tabGraph` + `tabForecast` + `tabPortfolio` + `fallbackForecasts` + `fallbackPortfolio` + `fallbackCurrencyGraph`. **Code health:** removed "graph" from `e2e/navigation.spec.ts` tabValues (dead iter 87 leftover). **Tests: 768 pytest (757 + 11 e2e/analyst) + 412 jest pass — same as iter 88 (no test count change because no new tests needed; all changes were deletions of dead code).** |

---

## Quick Reference — Frequent Problems

| Symptom | Cause | Where to fix |
|---------|-------|--------------|
| `test_scheduler.py` collection fails | `aiosqlite` not installed in env | `pip install aiosqlite` (or run inside `.venv` created by `start.sh`) |
| `/optimizer/path` returns empty path with `data_available: true` | Profitable arbitrage cycle detected — fall back to `direct_rate` (P1-8) | `backend/api/routes_optimizer.py:_bellman_ford` |
| SQLite `near "LIMIT": syntax error` | Use `rowid IN (SELECT ... LIMIT ?)` pattern, not `DELETE ... LIMIT ?` | `backend/data/historical.py:_prune_old_league_data` |
| LightGBM skips training for new currency | Below `lightgbm_min_data_points` (15) — adaptive fallback now trains from `floor` (5) with minimal features (P2-9) | `backend/predictors/time_series.py:train` |
| Need to inspect circuit breaker state | `GET /api/flipper/health/circuit-breakers` returns JSON snapshot (P2-6) | `src/app/api/flipper/health/circuit-breakers/route.ts` |
| Storage Value tab shows "no price history" | Backend reachable but `price_histories[currency]` is empty for the requested api_id. Try `divine` / `exalted` / `chaos` first. | `backend/api/routes_storage_value.py:get_storage_value` |
| Storage Value history chart shows "no history" | Either the currency has <2 price points in the last 30 days, OR all mirror/hinekora ratios are null. | `backend/economy/storage_value_history.py:compute_storage_value_history` |
| `/api/v1/content-pulse` returns `data_available: false` | Snapshot not yet loaded, or no items in any configured category. Wait for the scheduler to populate `price_histories` from ByCategory. | `backend/api/routes_content_pulse.py:get_content_pulse` |
| Content Pulse `delta_7d_pct` is `null` | No historical price_logs for any item in that category — only today's volume is known. Not a bug — rolling average needs ≥1 day of history. | `backend/economy/content_pulse.py:_rolling_mean` |
| Content Pulse widget shows "no signals today" | All categories have `signal="stable"` (|delta_7d_pct| < 10%). Correct behavior — widget only surfaces strong signals. | `backend/economy/content_pulse.py:_signal_from_delta` |
| `/api/v1/speculation` returns `data_available: false` | Snapshot not loaded yet, OR no item in the snapshot has ≥2 valid price points in the requested `days` window. Wait for the scheduler to collect more snapshots. | `backend/api/routes_speculation.py:get_speculation` |
| Speculation tab shows "no actionable signals" | All items have `|z_score| < 1.5` — prices are within ±1.5σ of their recent mean. Correct behavior. Try widening the days window (90 instead of 30). | `backend/economy/speculation.py:_signal_from_zscore` |
| Speculation z-score is null for an item | Item has <2 valid price points, OR all prices are identical (std=0). Both → `compute_zscore` returns None → item is excluded from the result list. | `backend/economy/pricing.py:compute_zscore` |
| Speculation "Spread Details" toggle is missing for an item | No matching `FlipOpportunity` exists for that item's `api_id` in `/api/flipper/flips`. The join is by from-currency (first part of `FlipOpportunity.currency`). | `src/components/dashboard/speculation-tab.tsx:flipsByApiId` |
| Speculation "Spread Details" shows "—" for some fields | Backend returned null for that field (e.g. `bid`, `ask`, `spread` are optional on `FlipOpportunity`). Common when backend has insufficient data for that pair. | `backend/api/routes_arbitrage.py` |
| `/api/v1/phase-hints` returns `data_available: false` | Only happens if PhaseDetector cannot be constructed (e.g. config.league.league_start_date is invalid). Otherwise always True — hint table is hardcoded. | `backend/api/routes_phase_hints.py:get_phase_hints_route` |
| Phase hints widget shows wrong phase | Phase is computed from `days_since_reference` since `league_start_datetime` (or last `major_patch` event). Check `config.yaml:league.league_start_date` matches the actual league start. | `backend/economy/lifecycle.py:PhaseDetector` |
| `/api/v1/speculation/backtest` returns `data_available: false` | Snapshot not loaded yet, OR no item has price_logs spanning both the eval timestamp (`now - eval_days_ago`) and exit timestamp (`entry + holding_days`). Try widening `eval_days_ago` (e.g. 30 instead of 14). | `backend/economy/speculation_backtest.py:backtest_speculation_signals` |
| Speculation backtest returns `evaluated_count=0` but `unevaluated_count>0` | Items have an actionable signal (BUY/SELL) at the entry timestamp, but no price log within 24h of the exit timestamp — the holding period extends past the last observed price. Either decrease `holding_days` or wait for the scheduler to collect more data. | `backend/economy/speculation_backtest.py:backtest_speculation_signals` |
| Exchanges tab "7d Change" column shows "—" | Frontend computes `sevenDayChangePercent` from `PriceLogs` in `poe2api.ts:compute7dChangePercent`. Returns null when <2 PriceLogs OR closest 7d-ago log drifts >16.8h OR 7d-ago price is 0. Common on new leagues. Not a bug — by design. Tooltip on the "—" cell explains this. | `src/lib/poe2api.ts:compute7dChangePercent` |
| Premium column shows large % (50%+) | By design — shows how much market rate deviates from cross-rate-derived fair rate. Large % is normal for low-liquidity pairs and signals an opportunity. Tooltip on the column header explains this. | `src/components/dashboard/exchange-table.tsx:CrossCurrencyPremiumCell` |
| Keyboard shortcut "0" goes to Speculation, not Watchlist | By design (iter 89 KI-6). TAB_MAP has 13 entries (overview, currencies, uniques, exchange, arbitrage, flips, optimizer, analyst, storage-value, speculation, liquid-chain, graph [dead], watchlist). Shortcuts 1–9 + 0 cover indices 0–9. liquid-chain (index 10) and watchlist (index 12) are NOT reachable via keyboard — pre-existing limitation, not a regression. Click them with the mouse. | `src/components/dashboard/dashboard-page.tsx:TAB_MAP`, `src/hooks/use-keyboard-shortcuts.ts` |
| Need to inspect dashboard-level backend status | `useFlipperBackend()` (iter 81) is the single source of truth for `flipperBackendOnline`, `flipperUpstreamReachable`, `flipperPhaseData`, `activeEventsCount`. Inline `useQuery` for these endpoints is forbidden — use the hook. | `src/hooks/use-flipper-backend.ts` |
| Need realm/league data or selection in a new component | `useRealmsAndLeagues()` (iter 82) is the single source of truth for `realm`, `league`, `effectiveLeague`, `realms`, `leagues`, and the `setRealm`/`setLeague` wrappers. | `src/hooks/use-realms-and-leagues.ts` |
| Need filtered exchange pairs (search + quick chip + extended filters) | `useFilteredExchangePairs({ exchangeData, search, exchangeUiState })` (iter 83). | `src/hooks/use-filtered-exchange-pairs.ts` |
| Need currency/unique category chip lists | `useItemCategoryLists({ uniqueCategories, t })` (iter 83). | `src/hooks/use-item-category-lists.ts` |
| Need optimal-payment data (pair map + cross-rate flips + anchor + display-name map) | `useOptimalPayment({ exchangeData, crossRates, flipperBackendOnline })` (iter 84). | `src/hooks/use-optimal-payment.ts` |
| Need to add new RU translations to `currency_names.json` | (iter 85+86) Run `scripts/sync_currency_names_from_poe2db.py` from a non-RU IP. 4 stages: `--fetch-ids` → `--fetch-ru` → `--diff` → review → `--apply --confirm`. After --apply, if counts changed, bump assertions in `tests/test_currency_names_ru.py` (lines 30-33) and run `pytest tests/test_currency_names_ru.py`. Script is IDEMPOTENT and NEVER overwrites existing translations. | `scripts/sync_currency_names_from_poe2db.py` |
| Need to localize a currency name / category slug in a frontend component | (iter 87) Use `getCurrencyDisplayName(apiId, locale)` / `getCategoryDisplayName(slug, locale)` from `src/lib/currency-names.ts`. Always provide a fallback (`?? apiId` or `\|\| upstreamText`) since the helper returns `null` when the api_id isn't in the mapping. Pull `locale` from `useI18n().locale`. | `src/lib/currency-names.ts`, `src/lib/i18n/index.tsx:useI18n` |
| Need locale-aware date formatting in a chart / dialog | (iter 88) Use `formatLocaleDate(value, locale, opts?)` or `formatLocaleDateTime(value, locale)` from `src/lib/utils.ts`. Maps `ru → ru-RU`, `zh → zh-CN`, `ko → ko-KR`, fallback `en-US`. Inline `toLocaleDateString("en-US", ...)` calls in chart components are FORBIDDEN. | `src/lib/utils.ts:formatLocaleDate` |
| Need to add a new fact-template to the analyst tab | (iter 88, KI-5) Backend: add a new entry to `_generate_facts` in `routes_analyst.py` with `template_id` + `params`. Frontend: add the `template_id` → `TranslationKeys` mapping in `analyst-tab.tsx:TEMPLATE_ID_TO_I18N_KEY`, add a case to `formatFactText`, add the new i18n key to all 4 locale files. Mirror in `analyst-fallback/route.ts`. | `backend/api/routes_analyst.py:_generate_facts`, `src/components/dashboard/analyst-tab.tsx:formatFactText` |
| Need to add a new tab to the dashboard | (iter 89 KI-6 update) Three places to update: (1) `dashboard-page.tsx:TAB_MAP` — add the tab ID at the desired shortcut index (NOTE: only indices 0–9 are reachable via keyboard shortcuts 1–9 + 0; if you put your new tab at index ≥10, it won't be keyboard-reachable); (2) `store.ts:validTabs` — add the tab ID for migration safety; (3) `shortcuts-dialog.tsx` — add a `<kbd>{N}</kbd> {t("tabXxx")}</span>` row. Also add the `tabXxx` i18n key to all 4 locale files. | `src/components/dashboard/dashboard-page.tsx:TAB_MAP`, `src/lib/store.ts:validTabs`, `src/components/dashboard/shortcuts-dialog.tsx` |
