# Worklog — PoE2 Market Dashboard

> Append-only shared multi-agent work log. Each section starts with `---`.
> Old task history is in `git log`. Trimmed to last 2 iterations.

---

Task ID: iter-144
Agent: main
Task: iter 144 — `docs/DATA_FLOW.md` §2 (POE2Scout API) + §5 (Field Transformation) deep cross-check. Per the iter-143 stop point: candidate (a) next logical docs batch. Chose this — lowest risk (doc-only, 0 source-code changes), natural continuation of the doc-audit chain (iter 141: DATA_FLOW cosmetic, iter 142: ARCHITECTURE/PLAYBOOK/CORS, iter 143: BACKEND_GUIDE/DATA_CONTRACTS). §2 + §5 were the only sections from the iter-141 audit that received only a cosmetic pass and deserved a deep cross-check against `backend/data/providers/poe2scout.py` + `src/lib/poe2api.ts`.

Work Log:
- Cloned repo. Read `STATUS.md` (iter 143 SHIPPED), `worklog.md` (iter 143 + iter 142), `AGENT_NAVIGATION.md` §1–§3.
- Re-verified canonical references against live code:
  - `backend/data/providers/poe2scout.py:417-418` — `get_historical_prices(currency: str, days)` calls `f"{self._league_path()}/Currencies/{currency}"`. The path parameter is an ApiId string (e.g. "divine"). DATA_FLOW.md §2 table row #16 said `/{Realm}/Leagues/{LeagueName}/Currencies/{ApiId}` — correct, no drift.
  - `backend/data/providers/poe2scout.py:707-720` — `get_pair_history(currency_one_item_id: int, currency_two_item_id: int)` calls `f".../Currencies/Pairs/{currency_one_item_id}/{currency_two_item_id}/History"`. Parameters are NUMERIC ItemIds. DATA_FLOW.md §2 table row #17 used generic `{C1}/{C2}` shorthand — INCONSISTENT with §2 path-params section (line 54) which explicitly names them `{CurrencyOneItemId}/{CurrencyTwoItemId}`. Aligned table to match path-params section.
  - `src/lib/poe2api.ts:618-630` — `RawCurrencyItem` interface has `ItemMetadata: Record<string, unknown> | null` (strict TS type). DATA_FLOW.md §5.1 said `ItemMetadata?: any` — legacy loose typing. Fixed.
  - `src/lib/poe2api.ts:639-652` — `RawUniqueItem` interface has NO `ApiId` field. Has `IsChanceable: boolean | null` and `ItemMetadata: Record<string, unknown> | null`. DATA_FLOW.md §5.1 listed `ApiId: string` as a field — WRONG. Code comment at `poe2api.ts:1025` explicitly notes: "BUG FIX: Unique items don't have an ApiId field in the POE2Scout API. CategoryApiId is shared by ALL items in the same category... Use ItemId as a stable, unique identifier instead." Removed phantom ApiId, added explanatory note, fixed IsChanceable/ItemMetadata types.
  - `src/lib/poe2api.ts:977` (mapCurrencyItem) — `id: String(item.ItemId || item.CurrencyItemId)` — ItemId takes PRIORITY. DATA_FLOW.md §5.1 mapping table said `id = String(CurrencyItemId || UniqueItemId || ItemId)` — priority REVERSED (and incorrectly mixed CurrencyItemId/UniqueItemId into a single rule).
  - `src/lib/poe2api.ts:1024` (mapUniqueItem) — `id: String(raw.ItemId || raw.UniqueItemId)` — ItemId takes PRIORITY.
  - `src/lib/poe2api.ts:978` (mapCurrencyItem) — `apiId: item.ApiId` — correct for currencies.
  - `src/lib/poe2api.ts:1029` (mapUniqueItem) — `apiId: String(raw.ItemId || raw.UniqueItemId)` — NOT ApiId (uniques have no ApiId field). DATA_FLOW.md §5.1 mapping table presented `apiId = ApiId` as a single unified rule — MISLEADING. Split into two rules: currencies use ApiId, uniques use String(ItemId || UniqueItemId).
  - `src/lib/poe2api.ts:960,1008` — `const relPrice = referencePrice && currentPrice ? currentPrice / referencePrice : currentPrice;`. DATA_FLOW.md §5.1 said `relativePrice = CurrentPrice / referencePrice` — didn't mention the fallback to `currentPrice` when `referencePrice` is missing. Added note.
  - `src/lib/poe2api.ts:1148-1180` (mapSnapshotPair) — returns 15 fields. DATA_FLOW.md §5.2 mapping table listed only 12 — MISSING 3: `currency1CategoryApiId` (line 1164), `currency2CategoryApiId` (line 1169), `currency2RelativePrice` (line 1172, comment: "price of currency2 in base currency — needed for cross-rate"). Added all 3.
  - `src/lib/poe2api.ts:1171` — `relativePrice: relPrice1` — direct assignment, can be null. DATA_FLOW.md §5.2 said `relativePrice = price ?? 0` — WRONG, code does NOT coalesce to 0. Fixed.
  - `src/lib/poe2api.ts:1174-1178` — `change`, `changePercent`, `sevenDayChange`, `sevenDayChangePercent`, `history` all initialized to `null`. DATA_FLOW.md §5.2 said these are "Enriched later via buildCurrencyChangeMap()" / "Fetched on demand" — didn't mention null initialization. Added "null (initialized)" prefix.
  - `src/lib/poe2api.ts:580-587` — `RawRealm` interface uses snake_case (`value`, `label`, `game_api_id`, `realm_api_id`, `trade_api_path`, `default_league_value`). DATA_FLOW.md §5.3 "/Realms stays snake_case" — correct, no drift.
  - `src/lib/case-transform.ts:22-24` — `toCamelCase` regex `/_([a-z0-9])/g`. Verified all 12 example transformations in §5.4 against this regex: `volume_24h → volume24h` ✓, `mid_price → midPrice` ✓, `quantized_analysis → quantizedAnalysis` ✓, `tier_distance → tierDistance` ✓, `alert_score → alertScore` ✓, `triggered_indicators → triggeredIndicators` ✓, `is_confirmed → isConfirmed` ✓, `current_price → currentPrice` ✓, `projected_price → projectedPrice` ✓, `risk_discount → riskDiscount` ✓, `adjusted_price → adjustedPrice` ✓, `net_value → netValue` ✓. All accurate.
  - `backend/models/currency.py:82-290` — verified all 12 source field names from §5.4 exist in backend models (`volume_24h`, `mid_price`, `quantized_analysis`, `tier_distance`, `alert_score`, `triggered_indicators`, `is_confirmed`, `current_price`, `projected_price`, `risk_discount`, `adjusted_price`, `net_value`). All present.
  - Grep confirmed: endpoints `/Realms/{Realm}/Filters`, `/Realms/{Realm}/LandingSplashInfo`, `/health/ready` are mentioned ONLY in DATA_FLOW.md — not consumed by any code (frontend or backend). Added a note in §2 marking them as available-but-not-consumed.
- No new bugs found in this iter (all drift is doc-only — no source-code defects).
- **`docs/DATA_FLOW.md` §2 audit (2 drift items fixed):**
  - **Header** — bumped version 1.2 → 1.3, date 2026-07-12 → 2026-07-13, updated summary.
  - **§2 table row #17** — `/{Realm}/Leagues/{LeagueName}/Currencies/Pairs/{C1}/{C2}/History` → `/{Realm}/Leagues/{LeagueName}/Currencies/Pairs/{CurrencyOneItemId}/{CurrencyTwoItemId}/History` (aligned with §2 path-params section line 54 which already used these exact names).
  - **§2 note added** — after table, before "Path parameters": clarifies that endpoints #2 (`/Realms/{Realm}/Filters`), #3 (`/Realms/{Realm}/LandingSplashInfo`), and #21 (`/health/ready`) exist in the POE2Scout API spec but are NOT consumed by the app; endpoint #20 (`/health/live`) IS consumed by `getHealth()` in `poe2api.ts:1187`.
- **`docs/DATA_FLOW.md` §5.1 audit (7 drift items fixed):**
  - **RawCurrencyItem interface** — `ItemMetadata?: any` → `ItemMetadata: Record<string, unknown> | null` (matches `poe2api.ts:626`).
  - **RawUniqueItem interface** — removed phantom `ApiId: string` field (RawUniqueItem has NO ApiId per `poe2api.ts:639-652`); added explanatory note referencing `poe2api.ts:1025` comment; `IsChanceable?: boolean` → `IsChanceable: boolean | null`; `ItemMetadata?: any` → `ItemMetadata: Record<string, unknown> | null`.
  - **Mapping table `id` field** — `String(CurrencyItemId || UniqueItemId || ItemId)` → split into two rules: `String(ItemId || CurrencyItemId)` [currencies] + `String(ItemId || UniqueItemId)` [uniques]. Added note: "⚠️ ItemId takes PRIORITY — verified iter 144 against poe2api.ts:977 (mapCurrencyItem) and :1024 (mapUniqueItem)."
  - **Mapping table `apiId` field** — `ApiId` (single rule) → split: `ApiId` [currencies] + `String(ItemId || UniqueItemId)` [uniques — NO ApiId field!].
  - **Mapping table `relativePrice` field** — `CurrentPrice / referencePrice` → `referencePrice && currentPrice ? currentPrice / referencePrice : currentPrice` with note "⚠️ falls back to currentPrice when referencePrice is missing".
  - **Mapping table `change` field** — added "— null if either is null" suffix (matches null-guard at `poe2api.ts:965-968`).
  - **Mapping table `volume` field** — `computeVolume24h(PriceLogs)` → `computeVolume24h(PriceLogs) ?? 0` (matches `poe2api.ts:988`).
  - **Mapping table `sevenDayPriceChange` field** — added "— null if either is null" suffix.
  - **Mapping table `lowConfidence` field** — `CurrentQuantity < 5` → `(CurrentQuantity ?? 0) < 5` (matches `poe2api.ts:993`).
  - **Mapping table `listingCount` field** — `CurrentQuantity` → `CurrentQuantity ?? 0` (matches `poe2api.ts:994`).
- **`docs/DATA_FLOW.md` §5.2 audit (4 drift items fixed):**
  - **Added 3 missing fields** — `currency1CategoryApiId = CurrencyOne.CategoryApiId || ""`, `currency2CategoryApiId = CurrencyTwo.CategoryApiId || ""`, `currency2RelativePrice = safeParseFloat(CurrencyTwoData.RelativePrice)` (with comment "needed for cross-rate").
  - **Fixed `relativePrice`** — `price ?? 0` → `safeParseFloat(CurrencyOneData.RelativePrice)` with note "⚠️ NOT `price ?? 0` — code at poe2api.ts:1171 assigns relPrice1 directly; can be null. Doc previously claimed `?? 0` fallback — wrong."
  - **Fixed `volume`** — `CurrencyOneData.VolumeTraded` → `CurrencyOneData.VolumeTraded ?? 0` (matches `poe2api.ts:1154`).
  - **Noted null-initialization** — `change`, `changePercent`, `sevenDayChange`, `sevenDayChangePercent`, `history` all prefixed with "null (initialized) →" to clarify they start as null before enrichment.
- **§5.3 (Case Transform Rules) — no drift found.** All 3 rules verified correct against code.
- **§5.4 (Flipper Proxy Transform) — no drift found.** All 12 example transformations verified against `case-transform.ts:22-24` regex and `backend/models/currency.py` field names.
- **Meta-docs updates:**
  - `STATUS.md` header bump (iter 143 → iter 144).
  - `worklog.md` — added this iter-144 entry, removed iter-142 entry (rule: only last 2 iterations).
  - `AGENT_NAVIGATION.md` header bump (iter 143 → iter 144).
- **Final verification:** 0 source-code changes this iter (doc-only). 1466 pytest green baseline preserved from iter 143 (no `.py`/`.ts`/`.tsx` touched).

Stage Summary:
- **iter 144 SHIPPED — 1 doc deep-audited (§2 + §5), 0 new bugs.** 1 doc file updated (`docs/DATA_FLOW.md` — 13 drift items across §2 + §5.1 + §5.2). 0 source-code changes. 1466 pytest green (0 regressions — confirmed since no `.py`/`.ts`/`.tsx` was touched).
- **Modified files (1 doc + 3 meta-docs):** `docs/DATA_FLOW.md`, `STATUS.md` (header bump), `worklog.md` (this entry), `AGENT_NAVIGATION.md` (header bump).
- **What was NOT done (intentionally deferred to iter 145+):**
  - **`instrumentation.ts:7` comment drift** — still mentions `/api/health` (legacy). Doc-only drift in a code comment. Not fixed in iter 144 (kept source-code changes at 0). Candidate for iter 145+ source cleanup. Minimal change (1 line).
  - **Per-tab UX/logic deep-audit** — still deferred since iter 139. iter 141+142+143+144 only verified doc-level references to tabs. Full per-tab audit (i18n coverage, error states, empty states, loading skeletons, accessibility) is candidate for iter 145+.
  - **9 items still untranslated** (F1) — poe2db has the pages but no Russian translation yet. Re-run pipeline after a patch / monthly.
  - **TD-3 runtime log verification** — still deferred since iter 136 (requires prod access).
  - **Other DATA_FLOW.md sections** (§3, §4, §6, §7, §8, §9, §10) — iter 141 already audited these; no further drift found in iter 144. §1 (Architecture Overview) is a 1-line pointer to ARCHITECTURE.md — no drift.
- **Stopping point:** iter 144 = 1 doc deep-audited (DATA_FLOW.md §2 + §5, 13 drift items). Next iter candidates: (a) source cleanup — fix `instrumentation.ts:7` comment drift (`/api/health` → `/api/v1/health/ping`) — minimal 1-line source-code change, safe; (b) per-tab UX/logic deep-audit (i18n, error/empty/loading states, accessibility) — larger scope, deferred since iter 139; (c) re-run F1 pipeline after a patch / monthly; (d) TD-3 runtime log verification (requires prod access); (e) any new bugs the user identifies.

---

Task ID: iter-143
Agent: main
Task: iter 143 — `docs/BACKEND_GUIDE.md` + `docs/DATA_CONTRACTS.md` re-audit. Per the iter-142 stop point: candidate (a) next logical docs batch. Chose this — lowest risk (doc-only, 0 source-code changes), well-decomposable, and these 2 docs had not been audited since iter 140.

Work Log:
- Cloned repo. Read `STATUS.md` (iter 142 SHIPPED), `worklog.md` (iter 142 + iter 141), `AGENT_NAVIGATION.md` §1–§3.
- Re-verified canonical references against live code:
  - `backend/data/providers/poe2scout.py:453,546,400,763,797,862` — actual methods are `get_exchange_rates(league)` → `dict[str, ExchangeRate]` (NOT `dict[str, SnapshotPair]`), `get_currency_metadata(league)` → `list[CurrencyInfo]`, `get_all_currencies_with_prices(league)` → `list[dict]`, `get_historical_prices(currency, days)` → `list[PricePoint]`, `get_bulk_price_histories(league)` → `dict[int, list[PricePoint]]`, `get_daily_stats(league, item_id, day_count, end_date)` → `dict | None`. BACKEND_GUIDE.md §1 listed 4 WRONG method names (`get_currencies`, `get_price_logs`, `get_unique_items` don't exist; `get_exchange_rates` return type was wrong).
  - `backend/data/providers/base.py:22-66` — abstract `BaseDataProvider` requires only `get_current_price`, `get_historical_prices`, `get_exchange_rates`, `get_currency_metadata`, `name()`, plus optional `get_daily_stats` (default returns None).
  - `backend/data/providers/poe2scout.py:253` — `max_retries = 2` (3 attempts total: initial + 2 retries). Doc §1 said "2 retries" — correct, no drift.
  - `backend/main.py:744,759` — actual health endpoints are `/api/v1/health/ping` and `/api/v1/health`. BACKEND_GUIDE.md §2 said `/api/health`.
  - `backend/data/unified_cache.py:501,556` — `PipelineCache` and `DailyStatsCache` classes are defined DIRECTLY in `unified_cache.py`. The standalone shim files `backend/data/pipeline_cache.py` and `backend/data/daily_stats_cache.py` were DELETED in iter 66 (P2-2 cleanup). BACKEND_GUIDE.md §5 still claimed they existed with backward-compat imports — false.
  - Grep confirmed: no `from backend.data.pipeline_cache` or `from backend.data.daily_stats_cache` imports anywhere in the codebase. All call sites use `from backend.data.unified_cache import get_pipeline_cache` / `get_daily_stats_cache`.
  - `backend/api/routes_arbitrage.py:874` + `backend/arbitrage/triangular.py:492` — route-facing default `cross_rate_threshold_pct=7.0`. Internal `_compute_cross_rate_divergence` has 5.0% default but is overridden. BACKEND_GUIDE.md §6.2 said "threshold: 10%, raised from 5% in v1.30" — wrong (actually 7%).
  - `tests/e2e/` directory listing — 6 files (`conftest.py`, `mock_provider.py`, `test_api_e2e.py`, `test_analyst.py`, `test_degraded_mode.py`, `test_sse.py`, plus `__init__.py`). BACKEND_GUIDE.md §7 E2E Tests listed only 4 (missing `test_analyst.py` + `test_sse.py`).
  - `backend/data/schemas.py:74-95` — `UniqueItem` (10 fields) + `UniqueItemExtended` (extends with `price_logs`, `current_price`, `current_quantity`). DATA_CONTRACTS.md §3 table had `UniqueItem` row but missing `UniqueItemExtended` row (which exists for `CurrencyItem`).
  - `backend/data/schemas.py:171-180` — `DailyStatsPoint` has 7 fields: `time`, `open`, `high`, `low`, `close`, `average`, `volume`. DATA_CONTRACTS.md §3 listed only 6 (missing `average`).
  - `src/lib/poe2api.ts:594-612` — `RawLeague.DefaultCurrency` has 4 fields: `ApiId`, `Text`, `IconUrl`, `RelativePrice`. DATA_CONTRACTS.md §6 /Leagues example showed only 3 (missing `IconUrl`).
- No new bugs found in this iter (all drift is doc-only — no source-code defects).
- **`docs/BACKEND_GUIDE.md` audit (9 drift items fixed, version 1.1 → 1.2):**
  - **Header** — bumped version 1.1 → 1.2, date 2026-07-12 → 2026-07-13, updated summary.
  - **§1 Poe2ScoutProvider Key methods** — rewrote completely. 4 wrong entries → 7 correct entries (`get_exchange_rates`, `get_currency_metadata`, `get_all_currencies_with_prices`, `get_historical_prices`, `get_bulk_price_histories`, `get_daily_stats`, auxiliary selectors). Fixed return type `dict[str, SnapshotPair]` → `dict[str, ExchangeRate]`. Added note clarifying that `BaseDataProvider` abstract interface requires only 5 methods; the rest are Poe2Scout-specific extensions.
  - **§2 SnapshotManager Health Info** — `/api/health` → `/api/v1/health` (and added `/api/v1/health/ping` for the bridge check). Also added the 2 missing fields `snapshot_ttl_seconds` + `fetched_at`.
  - **§5 PipelineCache Location** — `backend/data/pipeline_cache.py` → `unified_cache.py` (class defined directly in this file). Replaced false "Backward compatibility: All existing imports from `pipeline_cache.py` work without changes" claim with a Historical note explaining the shim was DELETED in iter 66 and all call sites now import from `unified_cache` directly.
  - **§5 DailyStatsCache Location** — same fix: file path → `unified_cache.py`, replaced false backward-compat claim with Historical note. Mentioned `_DailyStatsCacheProxy` for the `.clear()` test-compat property.
  - **§6.2 Triangular Arbitrage cross-rate threshold** — "threshold: 10%, raised from 5% in v1.30" → "route-facing default `cross_rate_threshold_pct=7.0` — verified iter 143 against `backend/api/routes_arbitrage.py:874` + `backend/arbitrage/triangular.py:492`. The internal `_compute_cross_rate_divergence` helper has a 5.0% default, but the route and the async `find_triangular_arbitrage` wrapper override it to 7.0%."
  - **§7 E2E Tests** — added 2 missing files: `test_analyst.py` (with description "/api/v1/analyst/summary integration tests") + `test_sse.py` (with description "/api/v1/prices/stream SSE contract tests").
- **`docs/DATA_CONTRACTS.md` audit (3 drift items fixed, version 1.1 → 1.2):**
  - **Header** — bumped version 1.1 → 1.2, date 2026-07-12 → 2026-07-13, updated summary.
  - **§3 Backend Pydantic Models table** — (1) added missing `UniqueItemExtended` row (`+ priceLogs, currentPrice, currentQuantity` — mirrors the existing `CurrencyItemExtended` pattern); (2) added `average` field to `DailyStatsPoint` row (was `time, open, high, low, close, volume` → now `time, open, high, low, close, average, volume`); (3) added `highestStock` field to `PairDataDetails` row (was missing). Added "verified iter 143 against `backend/data/schemas.py`" note.
  - **§6 /Leagues DefaultCurrency** — added missing `IconUrl` field to the JSON example (`{ ApiId, Text, RelativePrice }` → `{ ApiId, Text, IconUrl, RelativePrice }`). Added "Note (verified iter 143)" paragraph explaining the full `/Leagues` response also includes `DivinePrice`, `ChaosDivinePrice`, `BaseCurrencyIconUrl`, etc., with pointer to `src/lib/poe2api.ts:RawLeague` for the complete interface.
- **Meta-docs updates:**
  - `STATUS.md` header bump (iter 142 → iter 143).
  - `worklog.md` — added this iter-143 entry, removed iter-141 entry (rule: only last 2 iterations).
  - `AGENT_NAVIGATION.md` header bump (iter 142 → iter 143).
- **Final verification:** 0 source-code changes this iter (doc-only). 1466 pytest green baseline preserved from iter 142 (no `.py`/`.ts`/`.tsx` touched).

Stage Summary:
- **iter 143 SHIPPED — 2 docs re-audited, 0 new bugs.** 2 doc files updated (`docs/BACKEND_GUIDE.md` — 9 drift items, `docs/DATA_CONTRACTS.md` — 3 drift items). 12 individual drift items resolved across docs. 0 source-code changes. 1466 pytest green (0 regressions — confirmed since no `.py`/`.ts`/`.tsx` was touched).
- **Modified files (2 docs + 3 meta-docs):** `docs/BACKEND_GUIDE.md`, `docs/DATA_CONTRACTS.md`, `STATUS.md` (header bump), `worklog.md` (this entry), `AGENT_NAVIGATION.md` (header bump).
- **What was NOT done (intentionally deferred to iter 144+):**
  - **`docs/DATA_FLOW.md` §1, §2, §5, §6, §8, §10** — light-touch audit only (cosmetic, no major drift found). §2 POE2Scout API endpoints + §5 Field Transformation Reference would benefit from a deeper cross-check against `backend/data/providers/poe2scout.py` + `src/lib/poe2api.ts` respectively — candidate for iter 144.
  - **`instrumentation.ts:7` comment drift** — still mentions `/api/health` (legacy). Doc-only drift in a code comment. Not fixed in iter 143 (kept source-code changes at 0). Candidate for iter 144+ source cleanup.
  - **Per-tab UX/logic deep-audit** — still deferred since iter 139. iter 141+142+143 only verified doc-level references to tabs. Full per-tab audit (i18n coverage, error states, empty states, loading skeletons, accessibility) is candidate for iter 145+.
  - **9 items still untranslated** (F1) — poe2db has the pages but no Russian translation yet. Re-run pipeline after a patch / monthly.
  - **TD-3 runtime log verification** — still deferred since iter 136 (requires prod access).
- **Stopping point:** iter 143 = 2 docs re-audited (BACKEND_GUIDE.md + DATA_CONTRACTS.md, 12 drift items). Next iter candidates: (a) deep cross-check of `docs/DATA_FLOW.md` §2 (POE2Scout API) against `backend/data/providers/poe2scout.py` + §5 (Field Transformation) against `src/lib/poe2api.ts` — next logical docs batch; (b) source cleanup — fix `instrumentation.ts:7` comment drift (`/api/health` → `/api/v1/health/ping`); (c) per-tab UX/logic deep-audit; (d) re-run F1 pipeline after a patch / monthly; (e) TD-3 runtime log verification (requires prod access); (f) any new bugs the user identifies.
