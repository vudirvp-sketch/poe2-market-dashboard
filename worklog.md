# Worklog — PoE2 Market Dashboard

> Append-only shared multi-agent work log. Each section starts with `---`.
> Old task history is in `git log`. Trimmed to last 2 iterations.

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
  - **Header** — bumped version 1.0 → 1.1, date 2026-06-08 → 2026-07-13, updated summary.
  - **§1 Layer Diagram** — fixed tabs list (10 → 16, removed phantom `Arbitrage` + `Graph`, added `Storage Value`, `Speculation`, `Circuit`, `Intraday`, `Weekly`, `Mirror/Divine`, `Gold Map ROI`, `Liquid Chain`).
  - **§2.2 Flipper Analytics Path** — fixed 2 backend URLs: `proxyWithFallback("/api/arbitrage/flips")` → `"/api/v1/arbitrage/flips"`, `fetch("http://localhost:8000/api/arbitrage/flips")` → `".../api/v1/arbitrage/flips"`. Also clarified circuit breaker "5 failures → open for 15s, exponential to 5min".
  - **§2.3 Backend Internal Data Flow** — rewrote DataSnapshot fields (4 wrong → 9 correct: `exchange_rates`, `currencies: dict[str, dict]`, `currency_metadata`, `price_histories`, `current_prices`, `prices_in_base`, `tiers`, `fetched_at`, `valid`). Added note about `league`/`snapshot_age_seconds`. Rewrote HistoricalStore tables (3 → 5: added `market_spreads` [TD-4], `triangular_cycles` [TD-3], `daily_stats` [TD-5]; removed non-existent `prices_history`).
  - **§5.2 Backend Key Modules** — `HistoricalStore` description: 3 tables → 5 tables. `DataScheduler` description: "3 jobs" → "4 jobs — price_snapshot (30min), event_pruning (15min), model_persistence (30min), daily_stats_refresh (1h, TD-5 iter 131)".
  - **§6 Scheduler Jobs table** — added 4th row `daily_stats_refresh | 1 hour | TD-5 (iter 131) — fetch daily OHLCV for top-N items, persist to daily_stats table`.
  - **§7 Cache Architecture table** — split `poe2api.ts cache` row into `60s fresh / 30min stale` (was misleading "30 min"). Split `Circuit breaker` row into two: `poe2api.ts` (60s open, 3 failures) + `flipper-proxy.ts` (15s→5min, 5 failures).
  - **§8 Frontend (poe2api.ts)** — fixed circuit breaker: "5 consecutive failures → open for 15s" → "3 consecutive failures → open for 60s (`CIRCUIT_BREAKER_THRESHOLD=3`, `CIRCUIT_BREAKER_COOLDOWN=60_000`)". Fixed stale-while-revalidate: "30 min old" → "fresh TTL = 60s (`CACHE_TTL`); stale data served up to 30 min old (`CACHE_STALE_TTL`)".
  - **§8 Frontend (flipper-proxy.ts)** — added constant names (`FLIPPER_CB_THRESHOLD=5`, `FLIPPER_CB_INITIAL_COOLDOWN=15_000`, `FLIPPER_CB_MAX_COOLDOWN=300_000`).
  - **§9 Frontend Tab Architecture** — rewrote table (9 rows → 16 rows). Removed phantom `Graph` row. Added 7 missing rows (`Storage Value`, `Speculation`, `Circuit Patterns`, `Intraday Patterns`, `Weekly Patterns`, `Mirror/Divine Arb`, `Gold Map ROI`, `Liquid Chain`). Added "Removed tabs" note documenting phantom `Arbitrage` + `Graph` removals.
  - **§10 Backend Bridge** — fixed 2 `/api/health` → `/api/v1/health/ping` references (in `How It Works` flow diagram + Key Benefits list). Added "ultra-lightweight plain-text 'ok' — avoids GIL contention false-positives" explanation.
  - **§10 footer** — added "Historical note" explaining `instrumentation.ts:7` comment still mentions `/api/health` (doc-only drift in a code comment — not fixed in iter 142 to keep source-code changes minimal).
- **`docs/MARKET_PLAYBOOK.md` audit (heavy cleanup, 355 → 205 lines):**
  - **Header** — bumped iter 110 → iter 142, updated summary to "doc cleanup: P10 marked SHIPPED, sections C.1–C.7 trimmed, §D.3 outdated stop-point removed".
  - **§B Pattern Status table** — P10 row: `Нет | ❌ Нужен калькулятор` → `✅ Готово (end-to-end). Phase 1 (MVP) SHIPPED iter 127, Phase 2 (trend chart) SHIPPED iter 132`.
  - **§B Резюме** — updated counts: "9 полностью готовы" → "10 полностью готовы" (added P10), "8 не реализованы" → "7 не реализованы".
  - **§C План реализации** — TRIMMED heavily. Removed iter-by-iter detail records (C.1 foundation + C.2 iter 97 + C.3 iter 98 + C.4 iter 99 + C.5 iter 100 + C.6 iter 108/109 + C.7 iter 110 + C.8 iter 103+ + C.9 backlog = ~165 lines of git-log material). Replaced with: (1) pointer to `git log` for historical records; (2) concise canonical status table for 7 implemented patterns (P3/P4/P5/P7/P8/P9/P10) with backend pure function + route + UI; (3) "Не реализованы" list for 7 GGG-API-blocked patterns.
  - **§D Приоритеты и точки остановки** — rewrote §D.2 from "Топ-5 паттернов для следующих итераций" to "Реализованные паттерны (canonical status)" — 7 rows, all ✅ Done. Replaced outdated §D.3 "Точка остановки iter 110" with "Что осталось" — concise list of remaining work (TD runtime verification, P2/P16/P17 partial, GGG-API-blocked patterns, F1).
  - **§E Связанные документы** — added 2 new entries: `docs/design/P10-gold-map-roi-design.md` + `docs/design/TD-3-4-5-9-persistence-gaps-design.md`.
- **`docs/CORS_PROXY_GUIDE.md` audit (2 drift items fixed, version 1.0 → 1.1):**
  - **Header** — bumped version 1.0 → 1.1, date 2026-06-08 → 2026-07-13.
  - **§2 Circuit Breaker** — "Open duration: 30 seconds" → "60 seconds" (matches `CIRCUIT_BREAKER_COOLDOWN=60_000`). Added constant names + file:line refs. Added NOTE distinguishing poe2api.ts breaker (3 failures / 60s) from flipper-proxy.ts breaker (5 failures / 15s→5min).
  - **§2 Stale-While-Revalidate Cache** — "TTL: 30 minutes" → split into "Fresh TTL: 60 seconds" + "Stale TTL: 30 minutes" (matches `CACHE_TTL=60_000` + `CACHE_STALE_TTL=1_800_000`). Added eviction note (entries older than `CACHE_STALE_TTL * 2` = 60min are evicted).
- **Meta-docs updates:**
  - `STATUS.md` header bump (iter 141 → iter 142) + KI-31 entry added to Quick Reference table.
  - `worklog.md` — added this iter-142 entry, removed iter-139 entry (rule: only last 2 iterations).
  - `AGENT_NAVIGATION.md` header bump (iter 141 → iter 142).
- **Final verification:** `pytest tests/ --ignore=tests/e2e -q` → **1466 passed, 0 failed, 0 errors** (matches iter-141 baseline). 1 source-code change this iter (`.env.example` only — KI-31 fix; no `.py`/`.ts`/`.tsx` touched).

Stage Summary:
- **iter 142 SHIPPED — 3 docs audited + 1 new bug found & fixed.** 3 doc files updated (`docs/ARCHITECTURE.md` — 12 drift items, `docs/MARKET_PLAYBOOK.md` — heavy cleanup 355→205 lines, `docs/CORS_PROXY_GUIDE.md` — 2 drift items). 1 source-code fix (`.env.example` — KI-31). 16 individual drift items resolved across docs + 1 new bug. 1466 pytest green (0 regressions — `.env.example` is not loaded by any Python test).
- **Modified files (3 docs + 1 source + 3 meta-docs):** `docs/ARCHITECTURE.md`, `docs/MARKET_PLAYBOOK.md`, `docs/CORS_PROXY_GUIDE.md`, `.env.example` (KI-31 fix), `STATUS.md` (header bump + KI-31 entry), `worklog.md` (this entry), `AGENT_NAVIGATION.md` (header bump).
- **What was NOT done (intentionally deferred to iter 143+):**
  - **`docs/BACKEND_GUIDE.md` + `docs/DATA_CONTRACTS.md`** — last audited iter 140, may have residual drift. Candidate for iter 143.
  - **`docs/DATA_FLOW.md` §1, §2, §5, §6, §8, §10** — light-touch audit only (cosmetic, no major drift found). §2 POE2Scout API endpoints + §5 Field Transformation Reference would benefit from a deeper cross-check against `backend/api/provider.py` and `src/lib/poe2api.ts` respectively — candidate for iter 144.
  - **`instrumentation.ts:7` comment drift** — still mentions `/api/health` (legacy). Doc-only drift in a code comment. Not fixed in iter 142 to keep source-code changes minimal (only KI-31 fix). Candidate for iter 143+ source cleanup.
  - **Per-tab UX/logic deep-audit** — still deferred since iter 139. Iter 141+142 only verified the component filename + primary data source per tab. Full per-tab audit (i18n coverage, error states, empty states, loading skeletons, accessibility) is candidate for iter 145+.
  - **9 items still untranslated** (F1) — poe2db has the pages but no Russian translation yet. Re-run pipeline after a patch / monthly.
  - **TD-3 runtime log verification** — still deferred since iter 136 (requires prod access).
- **Stopping point:** iter 142 = 3 docs audited + KI-31 fixed. Next iter candidates: (a) `docs/BACKEND_GUIDE.md` + `docs/DATA_CONTRACTS.md` re-audit (next logical docs batch — last done iter 140); (b) deep cross-check of `docs/DATA_FLOW.md` §2 (POE2Scout API) against `backend/api/provider.py` + §5 (Field Transformation) against `src/lib/poe2api.ts`; (c) source cleanup — fix `instrumentation.ts:7` comment drift; (d) per-tab UX/logic deep-audit; (e) re-run F1 pipeline after a patch / monthly; (f) TD-3 runtime log verification (requires prod access); (g) any new bugs the user identifies.

---

Task ID: iter-141
Agent: main
Task: iter 141 — `docs/DATA_FLOW.md` full audit. Per the iter-140 stop point: candidate (a) `docs/DATA_FLOW.md` §1–§6, §8–§10 audit (especially §9 tab list drift). Chose this — lowest risk (no source-code changes), well-decomposable, and §9 was a confirmed drift since iter 139.

Work Log:
- Cloned repo. Read `STATUS.md` (iter 140 SHIPPED), `worklog.md` (iter 140 + iter 139), `AGENT_NAVIGATION.md` §1–§3.
- Re-verified the canonical references against live code:
  - `backend/api/data_snapshot.py:53-87` — `DataSnapshot` has 9 fields (`exchange_rates`, `currencies: dict[str, dict]`, `currency_metadata`, `price_histories`, `current_prices`, `prices_in_base`, `tiers`, `fetched_at`, `valid`). Doc claimed 6 wrong fields (`league`, `rates`, `currencies: list`, `bfs_pricing`, `snapshot_age_seconds`).
  - `backend/data/historical.py` — 5 SQLite tables (`price_snapshots`, `events`, `market_spreads` [TD-4], `triangular_cycles` [TD-3], `daily_stats` [TD-5]). Doc claimed 3 (incl. non-existent `prices_history`).
  - `backend/scheduler.py:280-315` — 4 scheduler jobs (`price_snapshot`, `event_pruning`, `model_persistence`, `daily_stats_refresh` [TD-5]). Doc claimed 3.
  - `src/components/dashboard/dashboard-page.tsx:211` — `TAB_MAP` has 16 entries. Doc §9 claimed 10 (incl. phantom `Arbitrage` [removed iter 92 KI-7] and `Graph` [removed iter 87]).
  - `src/app/api/flipper/**/route.ts` — 34 actual files. §7.1 had 38 entries (4 phantom + 1 duplicate added by iter 140).
  - `RecipeArb` — grep confirmed code is gone (doc §4.3 listed it as analytics module).
- **`docs/DATA_FLOW.md` audit (8 sections, 1 header):**
  - **§3.2 Flipper Analytics** — fixed 2 backend URLs (`/api/health` → `/api/v1/health`, `/api/phase` → `/api/v1/phase`). Added 15 missing newer endpoints (iter 75–131) in abbreviated form. Added "Backend-only routes" note listing 4 routes that have no Next.js proxy file (`/api/v1/health/ping`, `/api/v1/events/summary`, `/api/v1/market-spreads/history`, `/api/v1/items/{item_id}/daily-stats`).
  - **§4.1 Provider → SnapshotManager** — updated pipeline steps: `snapshot.rates` → `snapshot.exchange_rates`, `snapshot.bfs_pricing` → `snapshot.prices_in_base` (BFS now inside step 2, not step 4). Updated step descriptions to match actual `_refresh()` order.
  - **§4.2 DataSnapshot Dataclass** — rewrote completely. 9 correct fields with type hints + key conventions. Added note that `league` lives on `SnapshotManager._config` (NOT on dataclass) and `snapshot_age_seconds` is computed by `SnapshotManager`.
  - **§4.3 Analytics Pipeline** — removed dead `RecipeArb` line. Added note explaining removal.
  - **§4.4 HistoricalStore (SQLite)** — rewrote table list (3→5: added `market_spreads`, `triangular_cycles`, `daily_stats`; removed non-existent `prices_history`). Added 12 new methods (write_market_spreads_batch/read_market_spreads/read_market_spreads_pairs, write_triangular_cycles_batch/read_triangular_cycles/read_triangular_cycles_keys, write_daily_stats_batch/read_daily_stats/read_daily_stats_latest_date/read_daily_stats_items, plus write_events_batch, get_latest_prices).
  - **§4.5 Scheduler Jobs** — added 4th job `daily_stats_refresh` (1 hour, TD-5 iter 131).
  - **§7.1 Frontend Routes** — removed 4 phantom entries that iter 140 added without verifying (`health/ping/route.ts`, `events/summary/route.ts`, `market-spreads/history/route.ts` — backend-only, no proxy file exists; `optimal-currency/route.ts` was duplicated at lines 506 + 515, removed the duplicate). Replaced them with inline `# Note:` comments. Added "Verified iter 141: 34 route.ts files = 34 entries after cleanup" line.
  - **§9 Data → Component Mapping** — rewrote completely. 10 entries → 16 entries (matching actual `TAB_MAP`). Each row now includes the actual component filename (verified via `grep -E "export (function|const) <Name>" src/components/dashboard/`). Added "Removed tabs" note documenting phantom `Arbitrage` + `Graph` removals.
  - **Header** — bumped version 1.1 → 1.2, updated date stamp + summary.
- **Final verification:** `pytest tests/ --ignore=tests/e2e -q` → **1466 passed, 0 failed, 0 errors**. 0 source-code changes this iter — only docs.

Stage Summary:
- **iter 141 SHIPPED — `docs/DATA_FLOW.md` full audit complete.** 1 doc file updated (`docs/DATA_FLOW.md`) with 8 section rewrites. ~30 individual drift items resolved. 0 source-code changes. 1466 pytest green (0 regressions — confirmed since no `.py`/`.ts`/`.tsx` was touched).
- **Modified files (1 doc + 2 meta-docs):** `docs/DATA_FLOW.md`, `STATUS.md` (header bump), `worklog.md` (this entry). `AGENT_NAVIGATION.md` header NOT bumped this iter (no changes to its content — the §1–§3 read was context only).
- **What was NOT done (intentionally deferred to iter 142+):**
  - **`docs/DATA_FLOW.md` §1, §2, §5, §6, §8, §10** — light-touch audit only (cosmetic, no major drift found). §2 POE2Scout API endpoints + §5 Field Transformation Reference would benefit from a deeper cross-check against `backend/api/provider.py` and `src/lib/poe2api.ts` respectively — candidate for iter 142.
  - **`docs/ARCHITECTURE.md` (303 lines)** — not audited this iter.
  - **`docs/MARKET_PLAYBOOK.md` (355 lines)** — not audited this iter.
  - **`docs/CORS_PROXY_GUIDE.md` (181 lines)** — not audited this iter.
  - **Per-tab UX/logic deep-audit** — still deferred since iter 139. Iter 141 only verified the component filename + primary data source per tab. Full per-tab audit (i18n coverage, error states, empty states, loading skeletons, accessibility) is candidate for iter 143+.
  - **9 items still untranslated** (F1) — poe2db has the pages but no Russian translation yet. Re-run pipeline after a patch / monthly.
  - **TD-3 runtime log verification** — still deferred since iter 136 (requires prod access).
- **Stopping point:** iter 141 = `docs/DATA_FLOW.md` full audit (8 sections, ~30 drift items). Next iter candidates: (a) `docs/ARCHITECTURE.md` + `docs/MARKET_PLAYBOOK.md` + `docs/CORS_PROXY_GUIDE.md` audit (next logical docs batch); (b) deep cross-check of `docs/DATA_FLOW.md` §2 (POE2Scout API) against `backend/api/provider.py` + §5 (Field Transformation) against `src/lib/poe2api.ts`; (c) per-tab UX/logic deep-audit; (d) re-run F1 pipeline after a patch / monthly; (e) TD-3 runtime log verification (requires prod access); (f) any new bugs the user identifies.
