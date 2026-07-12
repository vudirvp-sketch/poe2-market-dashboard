# Worklog — PoE2 Market Dashboard

> Append-only shared multi-agent work log. Each section starts with `---`.
> Old task history is in `git log`. Trimmed to last 2 iterations.

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

---

Task ID: iter-142
Agent: main
Task: iter 142 — `docs/ARCHITECTURE.md` + `docs/MARKET_PLAYBOOK.md` + `docs/CORS_PROXY_GUIDE.md` audit. Per the iter-141 stop point: candidate (a) next logical docs batch. Chose this — lowest risk (mostly doc-only), well-decomposable, and these 3 docs had not been audited since iter 110+.

Work Log:
- Cloned repo. Read `STATUS.md` (iter 141 SHIPPED), `worklog.md` (iter 141 + iter 140), `AGENT_NAVIGATION.md` §1–§6.
- Re-verified canonical references against live code:
  - `backend/api/data_snapshot.py:53-87` — `DataSnapshot` has 9 fields (`exchange_rates`, `currencies: dict[str, dict]`, `currency_metadata`, `price_histories`, `current_prices`, `prices_in_base`, `tiers`, `fetched_at`, `valid`). ARCHITECTURE.md §2.3 claimed 4 wrong fields (`rates`, `bfs_pricing`, `currencies: list`, `price_histories: PriceLogEntry[]`).
  - `backend/data/historical.py:44-145` — 5 SQLite tables (`price_snapshots`, `events`, `market_spreads`, `triangular_cycles`, `daily_stats`). ARCHITECTURE.md §2.3 + §5.2 claimed 3 (incl. non-existent `prices_history`).
  - `backend/scheduler.py:280-320` — 4 scheduler jobs (added `daily_stats_refresh` iter 131). ARCHITECTURE.md §6 claimed 3.
  - `src/components/dashboard/dashboard-page.tsx:211` — `TAB_MAP` has 16 entries. ARCHITECTURE.md §1 Layer Diagram + §9 tab table claimed 10 (incl. phantom `Arbitrage` [removed iter 92 KI-7] and `Graph` [removed iter 87]).
  - `src/lib/poe2api.ts:114,112,71,72` — `CIRCUIT_BREAKER_THRESHOLD=3`, `CIRCUIT_BREAKER_COOLDOWN=60_000` (60s, NOT 30s), `CACHE_TTL=60_000` (fresh), `CACHE_STALE_TTL=1_800_000` (30min stale). CORS_PROXY_GUIDE.md §2 claimed "Open duration: 30 seconds" + "TTL: 30 minutes" (conflated fresh + stale).
  - `src/lib/flipper-proxy.ts:36-38` — `FLIPPER_CB_THRESHOLD=5`, `FLIPPER_CB_INITIAL_COOLDOWN=15_000`, `FLIPPER_CB_MAX_COOLDOWN=300_000`. ARCHITECTURE.md §8 confused poe2api.ts breaker (3 failures / 60s) with flipper-proxy.ts breaker (5 failures / 15s→5min).
  - `src/lib/flipper-backend-bridge.ts:52` — `HEALTH_ENDPOINT = ${BACKEND_URL}/api/v1/health/ping`. ARCHITECTURE.md §10 said `/api/health` (missing `/v1` + `/ping`).
  - `src/app/api/flipper/flips/route.ts:21` — proxies to `/api/v1/arbitrage/flips`. ARCHITECTURE.md §2.2 said `/api/arbitrage/flips` (missing `/v1`).
  - P10 Gold Map ROI — `src/components/dashboard/gold-map-roi-tab.tsx` + `gold-map-roi-calculator.tsx` + `gold-map-roi-trend-chart.tsx` all exist. STATUS.md confirmed Phase 1 SHIPPED iter 127, Phase 2 SHIPPED iter 132. MARKET_PLAYBOOK.md §B + §C.8 still said "❌ Не реализовано / на roadmap".
  - `.env.example:7` — `POE2_API_BASE_URL=https://api.poe2scout.com/api`. STATUS.md KI-15 + `src/lib/poe2api.ts:5-9` confirm `api.` subdomain is DEAD (404 for every endpoint). **New bug found — KI-31.**
- **KI-31 documented + fixed FIRST (per user rule: "Если найден новый баг — сначала документируй в STATUS.md как Known Issue, потом фиксий"):**
  - Added KI-31 entry to STATUS.md Quick Reference table (between KI-30 and the After-updating-currency_names row).
  - Fixed `.env.example:4-8`: changed URL to `https://poe2scout.com/api` (bare domain), rewrote comment to reference KI-15/KI-31.
- **`docs/ARCHITECTURE.md` audit (12 drift items fixed, version 1.0 → 1.1):**
  - Header bumped; §1 Layer Diagram tabs 10→16 (removed phantom Arbitrage + Graph, added Storage Value, Speculation, Circuit, Intraday, Weekly, Mirror/Divine, Gold Map ROI, Liquid Chain); §2.2 fixed 2 backend URLsS (`/api/arbitrage/flips` → `/api/v1/arbitrage/flips`); §2.3 rewrote DataSnapshot fields (4 wrong → 9 correct) + HistoricalStore tables (3→5); §5.2 HistoricalStore 3→5 tables + DataScheduler 3→4 jobs; §6 added 4th scheduler job `daily_stats_refresh`; §7 split cache + circuit breaker rows; §8 poe2api.ts circuit breaker 3 failures / 60s + flipper-proxy.ts 5 failures / 15s→5min; §9 tab table 9→16 rows; §10 `/api/health` → `/api/v1/health/ping` (2 refs).
- **`docs/MARKET_PLAYBOOK.md` audit (heavy cleanup, 355 → 205 lines):**
  - P10 row marked SHIPPED (Phase 1 iter 127 + Phase 2 iter 132). Trimmed iter-by-iter detail records (C.1–C.7, ~165 lines of git-log material). Replaced with concise canonical status table for 7 implemented patterns.
- **`docs/CORS_PROXY_GUIDE.md` audit (2 drift items fixed, version 1.0 → 1.1):**
  - §2 Circuit Breaker "Open duration: 30 seconds" → "60 seconds" (matches `CIRCUIT_BREAKER_COOLDOWN=60_000`). §2 Stale-While-Revalidate "TTL: 30 minutes" → split into "Fresh TTL: 60 seconds" + "Stale TTL: 30 minutes" (matches `CACHE_TTL=60_000` + `CACHE_STALE_TTL=1_800_000`).
- **Meta-docs updates:** `STATUS.md` header bump + KI-31 entry; `worklog.md` added iter-142 entry; `AGENT_NAVIGATION.md` header bump.
- **Final verification:** `pytest tests/ --ignore=tests/e2e -q` → **1466 passed, 0 failed, 0 errors** (matches iter-141 baseline). 1 source-code change this iter (`.env.example` only — KI-31 fix).

Stage Summary:
- **iter 142 SHIPPED — 3 docs audited + 1 new bug found & fixed.** 3 doc files updated (`docs/ARCHITECTURE.md` — 12 drift items, `docs/MARKET_PLAYBOOK.md` — heavy cleanup 355→205 lines, `docs/CORS_PROXY_GUIDE.md` — 2 drift items). 1 source-code fix (`.env.example` — KI-31). 16 individual drift items resolved across docs + 1 new bug. 1466 pytest green (0 regressions — `.env.example` is not loaded by any Python test).
- **Modified files (3 docs + 1 source + 3 meta-docs):** `docs/ARCHITECTURE.md`, `docs/MARKET_PLAYBOOK.md`, `docs/CORS_PROXY_GUIDE.md`, `.env.example` (KI-31 fix), `STATUS.md`, `worklog.md`, `AGENT_NAVIGATION.md`.
- **What was NOT done (intentionally deferred to iter 143+):** `docs/BACKEND_GUIDE.md` + `docs/DATA_CONTRACTS.md` re-audit (DONE iter 143); `docs/DATA_FLOW.md` §2 + §5 deep cross-check; `instrumentation.ts:7` comment drift; per-tab UX/logic deep-audit; F1 re-run; TD-3 runtime log verification.
