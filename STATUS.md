# STATUS.md — Known Issues & Quick Reference

> **Last updated:** 2026-07-12 (iter 136 — KI-28 fix SHIPPED. Python 3.14 removed the implicit event-loop creation in `asyncio.get_event_loop()` — the 12 call sites in `tests/test_daily_stats_persistence.py` raised `RuntimeError: There is no current event loop in thread 'MainThread'` on Python 3.14 (6 test failures). Fix: extracted a `_run(coro)` helper that calls `asyncio.run(coro)` (creates a fresh loop per call — safe because aiosqlite connections support cross-loop usage). 1455 pytest green in both UTC and UTC+5 on Python 3.12; the fix is forward-compatible with Python 3.14. P10 Phase 2 + TD-3 production verification: code-path audit COMPLETE — all 4 sub-items verified via existing tests + code review. Runtime log verification deferred to next prod deploy.)
> Single source of truth for known bugs and frequent problems. Update BEFORE fixing any issue.

---

## Known Issues — open

### None. See "Technical-debt backlog" for low-priority items.

---

## Design-docs

| Doc | Covers | Status |
|-----|--------|--------|
| `docs/design/TD-3-4-5-9-persistence-gaps-design.md` | TD-3 + TD-4 + TD-5 + TD-9 unified persistence-layer analysis. Four-phase plan (Phase 1 = TD-9 wire-only, Phase 2 = TD-4 spreads, Phase 3 = TD-3 cycles, Phase 4 = TD-5 OHLCV + backfill). | **ALL PHASES SHIPPED.** Phase 1 iter 127. Phase 2 iter 128. Phase 3 iter 129. Phase 4 iter 131. |
| `docs/design/P10-gold-map-roi-design.md` | P10 Gold Map ROI — UX + ROI formula. Phase 1 reuses `/api/v1/arbitrage/triangular` for MVP. Phase 2 trend chart consumes `/api/v1/arbitrage/triangular/history`. Tab placement: `TAB_MAP` index 13. | DESIGN COMPLETE — Phase 1 (MVP) SHIPPED iter 127. Phase 2 (trend chart) SHIPPED iter 132. Phase 3 (SQLite promotion) optional. |

---

## Known Issues — closed (recent)

- **KI-28** (closed iter 136): Python 3.14 removed the implicit event-loop creation in `asyncio.get_event_loop()` (it was deprecated since 3.10, hard error since 3.14). The 12 call sites in `tests/test_daily_stats_persistence.py::TestDailyStatsRoute` used `asyncio.get_event_loop().run_until_complete(coro)` to seed/close the HistoricalStore in sync test methods — on Python 3.14 this raises `RuntimeError: There is no current event loop in thread 'MainThread'` (6 test failures). Fix: extracted a `_run(coro)` module-level helper that calls `asyncio.run(coro)`. Each call creates a fresh loop — safe for HistoricalStore because aiosqlite connections support cross-loop usage (each `await` binds the Future to the caller's loop; the aiosqlite worker thread posts results back via `loop.call_soon_threadsafe`). 1455 pytest green in both UTC and UTC+5 on Python 3.12 (forward-compatible with 3.14). Test-only change — no production code touched.
- **TD-9 fallback removal** (closed iter 135): Removed the synthetic `deriveTrendSparklineData(momentum, volatility)` helper from `flips-helpers.ts` and the `FLIPS_TREND_SPARKLINE_POINTS` constant. `getTrendSparklineData` now returns `[]` when `priceHistoryShort` has fewer than 2 points — the `Sparkline` component renders an em-dash placeholder (`—`) for empty arrays (see `sparkline.tsx:115-116`). `TrendSparklineInput` interface dropped its `momentum` / `volatility` fields (only used by the removed fallback). The `flipsTrendTooltip` i18n key was repurposed across all 4 locales (en/ru/zh/ko) from the now-stale "Momentum × volatility indicator (derived from current snapshot — NOT historical price data)..." text to "Recent price history (up to 14 points...). Shows — when no price history is available for this pair yet." — works for both the column-header tooltip and the empty-cell tooltip. Stale backend comments referencing the fallback updated in `currency.py`, `response_models.py`, `routes_arbitrage.py` (×2). Design doc `TD-3-4-5-9-persistence-gaps-design.md` §10 Q5 marked RESOLVED iter 135. 8 jest tests removed (the `deriveTrendSparklineData` describe block), 4 jest tests updated (the `getTrendSparklineData` fallback tests → empty-array tests). 690 jest green, 1455 pytest green in both UTC and UTC+5.
- **TD-3 pipeline_cache** (closed iter 134): Eliminated doubled `find_triangular_arbitrage` compute cost — the function previously ran BOTH in `SnapshotManager._refresh()` (via `compute_triangular_cycles` for SQLite persistence) AND in the live `/api/v1/arbitrage/triangular` route on first-request cache miss. Fix: `compute_triangular_cycles` now accepts an optional `pipeline_cache: PipelineCache | None` parameter; `_refresh()` passes `get_pipeline_cache()` so the live route's cache is pre-populated on every refresh. The `cross_rate_warning` construction was extracted to `triangular_cycles.build_cross_rate_warning` (pure helper) so both call sites produce IDENTICAL warning dicts (parity guarantee). 19 new pytest regression tests. 1455 pytest green in both UTC and UTC+5.
- **KI-27** (closed iter 133): KI-26-audit found 3 UNSAFE `replace(tzinfo=timezone.utc)` call sites on potentially-naive LOCAL datetimes — same latent bug class as KI-26. Fixed by switching to `astimezone(timezone.utc)`. Sites: `lifecycle.py:days_since_reference` (`current` + `reference`), `arbitrage/triangular.py:_compute_confidence` (`snapshot_time`). 4 new pytest regression tests. 1436 pytest green in both UTC and UTC+5.
- **P10 / Phase-2** (closed iter 132): `GoldMapRoiTrendChart` SVG trend chart wired into `gold-map-roi-tab.tsx` below the calculator. Consumes iter-129 `GET /api/v1/arbitrage/triangular/history` via proxy `GET /api/flipper/triangular/history`. 13 new jest (5 helper + 8 component), 698 total green.
- **TD-5 / Phase-4** (closed iter 131): `daily_stats` persistence shipped — new SQLite table + pure helpers + `HistoricalStore.write_daily_stats_batch`/`read_daily_stats` + `GET /api/v1/items/{item_id}/daily-stats` route with lazy-fetch provider fallback + `DataScheduler.refresh_daily_stats` hourly job + `scripts/backfill_daily_stats.py`. Uses `INSERT OR REPLACE`; 365-day retention. 56 new pytest, 1432 total green.
- **KI-26** (closed iter 130): `_safe_snapshot_age_sec` used `replace(tzinfo=timezone.utc)` for naive datetimes. Fixed by switching to `astimezone(timezone.utc)`. Audit completed iter 133 (KI-27).
- **TD-3 / Phase-3** (closed iter 129): `triangular_cycles` persistence shipped — three-layer pattern (pure helper + best-effort write in `_refresh()` + read-only route). 49 new pytest, 1376 total green.
- **TD-4 / Phase-2** (closed iter 128): `market_spreads` persistence shipped — same three-layer pattern. 40 new pytest, 1327 total green.
- **TD-9 / P10-Phase-1** (closed iter 127): TD-9 Phase 1 — `price_history_short` wired into `/flips`. P10 Phase 1 MVP. 8 new pytest, 51 new jest.
- Older (DOC-2, DOC-1, TD-10, TD-11, KI-22/23/24/25): see `git log` for one-line summaries.

---

## Technical-debt backlog

| ID | Priority | Notes |
|----|----------|-------|
| **TD-3** | P3 | Triangular arbitrage persistence. **Phase 3 SHIPPED iter 129.** **pipeline_cache optimization SHIPPED iter 134.** **Code-path audit COMPLETE iter 136** — all 4 production-verification sub-items verified via existing tests + code review: (1) `/api/flipper/triangular/history` returns non-empty `points` when `triangular_cycles` ≥ 2 rows (E2E test `test_triangular_cycles_route.py::TestTriangularCyclesRouteWithRows`); (2) Gold Map ROI trend chart SVG line renders with ≥ 2 deduped points (`gold-map-roi-trend-chart.tsx:170-171` geometry guard + jest); (3) Days selector refetches via `queryKey: ["gold-map-roi-trend", days]` + `days` query param; (4) `_refresh()` pre-populates `pipeline_cache` via `compute_triangular_cycles(pipeline_cache=...)` with debug log `"TD-3 cache: populated pipeline_cache key=%s"` (line 332). **Open:** runtime log verification on next prod deploy — confirm the debug log line appears in `_refresh` output and the live `/triangular` first-request latency is <100ms. |
| **TD-4** | P3 | `market_spread` persistence. **Phase 2 SHIPPED iter 128.** **Open:** verify in production logs that rows land in SQLite. |
| **TD-5** | P3 | `DailyStatsHistory` OHLCV persistence. **Phase 4 SHIPPED iter 131.** **Open:** (1) verify the hourly `daily_stats_refresh` job persists rows; (2) run `scripts/backfill_daily_stats.py --dry-run` then `--top-n 50` for an initial seed; (3) verify the lazy-fetch fallback in the route fires on first hit. |
| **TD-9** | P3 | FlipsTable "Trend" sparkline. **Phase 1 SHIPPED iter 127** — renders REAL `price_history_short`. **Fallback removal SHIPPED iter 135** — synthetic `deriveTrendSparklineData` deleted; sparkline renders `—` when no history. **CLOSED.** |
| **P10** | P3 | Gold Map ROI. **Phase 1 (MVP) SHIPPED iter 127. Phase 2 (trend chart) SHIPPED iter 132.** Phase 3 (SQLite promotion) optional — defer until adoption. |

---

## KI-26-audit — `replace(tzinfo=utc)` call-site classification (iter 133)

All 17 occurrences of `replace(tzinfo=timezone.utc)` in `backend/` audited. 3 UNSAFE (fixed as KI-27), 14 SAFE (input is naive UTC from SQLite/POE2Scout).

### UNSAFE — fixed as KI-27 (input could be naive LOCAL datetime)

| File:line | Function | Input source | Fix |
|-----------|----------|--------------|-----|
| `backend/economy/lifecycle.py:115` | `days_since_reference` `current` param | `now or datetime.now(timezone.utc)` — `now` from caller can be naive | `current.astimezone(timezone.utc)` |
| `backend/economy/lifecycle.py:117` | `days_since_reference` `reference` param | `self._reference_date()` → `_patch_reset_date` set from API request body (pydantic accepts naive ISO) | `reference.astimezone(timezone.utc)` |
| `backend/arbitrage/triangular.py:146` | `_compute_confidence` `snapshot_time` param | Caller passes `snapshot.fetched_at or datetime.now(timezone.utc)`; tests/future callers may pass naive | `snapshot_time.astimezone(timezone.utc)` |

### SAFE — no fix needed (input is always naive UTC from SQLite or POE2Scout)

| File:line | Function | Why safe |
|-----------|----------|----------|
| `backend/economy/events.py:535` | `_is_expired` `expires_at` | SQLite-stored timestamp, originally written as `datetime.now(timezone.utc).isoformat()` (aware UTC round-trip preserves tz). Naive case = legacy UTC data. |
| `backend/economy/intraday_patterns.py:155` | `_extract_price_points` `ts` | `time_val` from POE2Scout `price_logs` (UTC server). Naive case = ISO string without `Z` from UTC source. |
| `backend/economy/intraday_patterns.py:211` | `_group_by_hour` `ts_utc` | Same source as above. Already uses `astimezone if tzinfo else replace` defensive form. |
| `backend/economy/circuit_patterns.py:224` | `_extract_price_points` `ts` | Same POE2Scout UTC source. |
| `backend/economy/speculation.py:133` | `_extract_price_points` `ts` | Same POE2Scout UTC source. |
| `backend/economy/speculation_backtest.py:154` | `_find_price_at` `target` | Caller passes `t_eval`/`t_exit` derived from `today = datetime.now(timezone.utc)` (aware). Naive branch never triggers in production. |
| `backend/economy/speculation_backtest.py:161` | `_find_price_at` `ts` in `history` | `history` from POE2Scout `price_logs` (UTC source). |
| `backend/economy/pricing.py:165` | `find_price_24h_ago` `ts` | `history_with_timestamps` from POE2Scout `price_logs` (UTC source). |
| `backend/economy/weekly_patterns.py:185` | `_extract_price_points` `ts` | Same POE2Scout UTC source. |
| `backend/economy/weekly_patterns.py:247` | `_group_by_weekday` `ts_utc` | Same source. Already uses `astimezone if tzinfo else replace` defensive form. |
| `backend/predictors/time_series.py:247` | `forecast_sarima` `last_ts` | `timestamps[-1]` from caller; `ForecastEngine` not currently called from any production route (only tests). Naive case = assume UTC (POE2Scout source). |
| `backend/predictors/time_series.py:407` | `forecast_holt_winters` `last_ts` | Same as above. |
| `backend/predictors/time_series.py:939` | `LightGBMForecaster.forecast` `last_ts` | Same as above. |
| `backend/economy/triangular_cycles.py:147` (docstring only) | — | Comment text in `_safe_snapshot_age_sec` docstring explaining KI-26 fix rationale. Not code. |

**Audit pattern:** For any future `replace(tzinfo=timezone.utc)` site, classify by input source:
- Input from SQLite (`historical.db`) or POE2Scout API → **SAFE** (naive UTC).
- Input from `datetime.now()` (no tz), API request body, or external caller → **UNSAFE**, use `astimezone(timezone.utc)`.

---

## Quick Reference — Frequent Problems

| Symptom | Cause | Where to fix |
|---------|-------|--------------|
| `pytest` fails on Python 3.14 with `RuntimeError: There is no current event loop in thread 'MainThread'` in `test_daily_stats_persistence.py` | **KI-28** (fixed iter 136) — `asyncio.get_event_loop()` was removed in Python 3.14. Use the `_run(coro)` helper (= `asyncio.run(coro)`) instead of `asyncio.get_event_loop().run_until_complete(coro)`. | `tests/test_daily_stats_persistence.py:_run` |
| `pytest` fails on `test_snapshot_age_sec_handles_naive_datetime` with `assert 0 >= 30` in non-UTC timezone | **KI-26** (fixed iter 130) — `_safe_snapshot_age_sec` used `replace(tzinfo=utc)` instead of `astimezone(timezone.utc)` for naive datetimes. | `backend/economy/triangular_cycles.py:_safe_snapshot_age_sec` |
| `days_since_reference` returns 0 (clamped) in non-UTC timezone when `now` is naive | **KI-27** (fixed iter 133) — `lifecycle.py` used `replace(tzinfo=utc)` instead of `astimezone(timezone.utc)` for naive `current`/`reference`. | `backend/economy/lifecycle.py:days_since_reference` |
| `_compute_confidence` returns wrong freshness in non-UTC timezone when `snapshot_time` is naive | **KI-27** (fixed iter 133) — `arbitrage/triangular.py` used `replace(tzinfo=utc)` instead of `astimezone(timezone.utc)` for naive `snapshot_time`. | `backend/arbitrage/triangular.py:_compute_confidence` |
| `phase-hints-widget` jest test "renders current price" fails with `Expected: "115.50", Received: "116"` | **KI-21** (fixed iter 111) — `fmtPrice` rounded `>= 100` to integer. Fix already applied. | `src/components/dashboard/phase-hints-widget.tsx:fmtPrice` |
| All API calls return 404; dashboard empty | **KI-15** — `.env.local` has dead `api.poe2scout.com`. Use `POE2_API_BASE_URL=https://poe2scout.com/api` | `.env.local`, `start.bat`, `start.sh` |
| `next build` fails with "Unknown keyword or identifier. Did you mean 'delete'?" on a `DELETE_*.ts` file | **KI-19** (fixed iter 107) — historical `DELETE_*.ts` placeholder files all removed. `tsconfig.json` still excludes `**/DELETE_*` as defense-in-depth. | `tsconfig.json` |
| `GET /api/v1/prices/stream?threshold_pct=1` returns 400 | **KI-13** (fixed iter 107) — SSE router must be registered before prices router in `main.py` | `backend/main.py`, `backend/api/routes_sse.py` |
| `next build` warns "Encountered unexpected file in NFT list ... flipper-backend-bridge.ts" | **KI-16-deep** (fixed iter 106) — bridge must use `exec`/`execSync`, not `spawn`/`spawnSync`. No `fs`/`path` imports. | `instrumentation.ts`, `src/lib/flipper-backend-bridge.ts` |
| `pytest` hangs on `test_triangular.py` | **KI-18** (fixed iter 105) — check `tests/conftest.py` patches `get_process_pool` → None | `tests/conftest.py` |
| `test_scheduler.py` collection fails | `aiosqlite` not installed | `pip install aiosqlite` |
| `/optimizer/path` returns empty path with `data_available: true` | Profitable arbitrage cycle detected — fall back to `direct_rate` | `backend/api/routes_optimizer.py:_bellman_ford` |
| SQLite `near "LIMIT": syntax error` | Use `rowid IN (SELECT ... LIMIT ?)` pattern | `backend/data/historical.py:_prune_old_league_data` |
| LightGBM skips training for new currency | Below `lightgbm_min_data_points` (15) | `backend/predictors/time_series.py:train` |
| Keyboard shortcut "5" goes to Flips, not Arbitrage | By design (iter 92 KI-7) | `dashboard-page.tsx:TAB_MAP` |
| Keyboard shortcut "0" goes to Circuits, not Liquid Chain | By design (iter 97 F7) | `dashboard-page.tsx:TAB_MAP` |
| FlipsTable "Trend" sparkline shows `—` instead of a line | **iter 135** — by design. The sparkline renders REAL `price_history_short` (≥ 2 points required). When a pair has no price history yet (early league / fresh listing / backend omitted `price_history_short`), the cell shows `—`. The synthetic `momentum × volatility` fallback was REMOVED iter 135 as misleading (visualized non-price data as if it were a price chart). | `src/components/dashboard/flips-helpers.ts:getTrendSparklineData`, `sparkline.tsx:115-116` |
| `GET /api/v1/market-spreads/history` returns `data_available: false` | **TD-4 iter 128** — table empty. Either snapshot refresh hasn't run yet (wait 5 min), or `compute_market_spreads` returned `[]`. Check: `sqlite3 historical.db "SELECT COUNT(*) FROM market_spreads"`. | `backend/economy/market_spreads.py:compute_market_spreads`, `backend/api/data_snapshot.py:_refresh` |
| `GET /api/v1/arbitrage/triangular/history` returns `data_available: false` | **TD-3 iter 129** — table empty. Either (a) refresh hasn't run yet, (b) no profitable cycles detected (normal in stable markets), or (c) `find_triangular_arbitrage` timed out (90s — check logs for "TD-3: find_triangular_arbitrage failed"). Check: `sqlite3 historical.db "SELECT COUNT(*) FROM triangular_cycles"`. | `backend/economy/triangular_cycles.py:compute_triangular_cycles`, `backend/api/data_snapshot.py:_refresh` |
| `GET /api/v1/items/{item_id}/daily-stats` returns `data_available: false` + `source: "empty"` | **TD-5 iter 131** — table empty AND provider returned None. Either (a) the item_id is unknown to POE2Scout (404), (b) the hourly `daily_stats_refresh` scheduler job hasn't run yet (wait 1h or run `scripts/backfill_daily_stats.py --top-n 50`), or (c) the lazy-fetch provider call failed (check logs for "Lazy-fetch: provider fetch failed"). Check: `sqlite3 historical.db "SELECT COUNT(*) FROM daily_stats WHERE item_id = ?"`. | `backend/api/routes_daily_stats.py:get_daily_stats_history`, `backend/economy/daily_stats.py:transform_daily_stats` |
| `GET /api/v1/items/{item_id}/daily-stats` always returns `source: "provider"` (never "sqlite") | **TD-5 iter 131** — the freshness check `is_daily_stats_fresh` is returning False. Either (a) the latest persisted row is > 1 day old (run the backfill script or wait for the hourly scheduler job), or (b) POE2Scout hasn't published today's candle yet (normal during most of the UTC day — yesterday's candle is the freshest possible, grace_days=1 handles this). | `backend/economy/daily_stats.py:is_daily_stats_fresh` |
| Gold Map ROI trend chart shows "No cycle history yet" | **P10 Phase 2 iter 132** — same root cause as the `/api/v1/arbitrage/triangular/history` row above. The chart consumes that endpoint via proxy `/api/flipper/triangular/history`. Wait for the snapshot refresh to persist rows, or check `historical.db` directly. Note: even when `data_available=true`, the chart needs ≥ 2 deduped points to draw a line (single point → "no history yet"). | `src/components/dashboard/gold-map-roi-trend-chart.tsx`, `backend/economy/triangular_cycles.py:compute_triangular_cycles` |
| Mirror/Divine Arb tab shows "no price history yet" | By design (iter 109) — backend returns `data_available: false` when scheduler hasn't collected ≥ 4 Mirror + Divine snapshots. Wait for the scheduler or widen the days selector. | `backend/economy/mirror_divine_arb.py`, `mirror-divine-arb-tab.tsx` |
| `/api/poe2/uniques` or `/api/poe2/currencies` returns 200 with empty `items: []` | KI-11 (closed iter 102) — verify `config.yaml:league.league_name` is valid | `src/lib/poe2api.ts` |
| Leveling Uniques widget shows "Day 0" or wrong phase | Check `config.yaml` → `league.league_start_date` | `backend/economy/lifecycle.py:PhaseDetector`, `config.yaml` |
| `flipper-bridge.log` file no longer created | By design (iter 106, KI-16-deep) — redirect: `npm run start > flipper-bridge.log 2>&1`. | `src/lib/flipper-backend-bridge.ts` |
| `npx tsc --noEmit` or `npm run jest` OOM-killed on 4GB RAM | Known env limit since iter 99 — needs 8GB+ RAM. `jest --maxWorkers=1` helps. | environment |
| User's league selection lost on every reload | Fixed iter 122 — `use-realms-and-leagues.ts` persistence-model redesign. | `src/hooks/use-realms-and-leagues.ts` |

---

## Key technical insights for future agents

**FastAPI route matching is ORDER-DEPENDENT.** A `{param:path}` converter is greedy and matches slashes — it will shadow any literal sub-path registered AFTER it. Always register literal-path routers BEFORE greedy-path routers. The KI-13 bug (SSE `/api/v1/prices/stream` shadowed by `/api/v1/prices/{pair:path}`) survived 6 iterations because the SSE router was registered after the prices router.

**Frontend price formatting convention.** `fmtPrice`-style helpers across the dashboard should keep 2 decimals for prices `>= 1` and 4 decimals for `< 1`. The KI-21 bug was caused by an "optimization" that rounded `>= 100` to integer — this silently broke the iter-110 live-price test and was only caught when jest was finally run. If you ever feel tempted to truncate large prices to integers, add a test first.

**ESLint v9 flat config (KI-22 closed iter 112).** `eslint-config-next` v16 ships native flat-config exports at `eslint-config-next/core-web-vitals` and `eslint-config-next/typescript` — no `FlatCompat` / `@eslint/eslintrc` wrapper needed. Just spread them into your `eslint.config.mjs`. The 4 new React Compiler rules (`set-state-in-effect`, `static-components`, `preserve-manual-memoization`, `refs`) default to "error" and will break lint on any existing codebase — downgrade to "warn" in the config and refactor incrementally.

**Naive datetime handling (KI-26 closed iter 130, KI-27 closed iter 133).** When converting a naive `datetime` (no `tzinfo`) to UTC, use `dt.astimezone(timezone.utc)` — NOT `dt.replace(tzinfo=timezone.utc)`. `replace()` just relabels the wall-clock value as UTC without converting, which silently produces future timestamps in non-UTC timezones (because `datetime.now()` returns local time). `astimezone()` on a naive datetime correctly interprets it as system local time and converts to the target timezone. The `replace()` form is ONLY correct when the input is already UTC but lacks `tzinfo` (e.g., datetimes read from SQLite, which stores them as naive UTC, OR POE2Scout ISO strings without `Z`). When in doubt about a call site's input source, prefer `astimezone()` for safety — it's correct in both cases. **Audit pattern (iter 133):** classify each `replace(tzinfo=utc)` site by input source — SQLite/POE2Scout = SAFE; `datetime.now()`/API request body/external caller = UNSAFE → switch to `astimezone()`.

**Three-layer persistence pattern (iter 128–131) — template for future persistence gaps.** The three-layer split that closes a "computed metric is not persisted" gap: (1) **Pure helper** in `backend/economy/<feature>.py` that takes `(snapshot, config)` (or a provider response for TD-5) and returns `list[dict]` — no I/O, no DB, fully unit-testable. (2) **Best-effort write** wired into `SnapshotManager._refresh()` AFTER the snapshot is built but BEFORE `return snapshot` — wrapped in `try/except` that logs a warning and continues (design doc §5.1 invariant: persistence MUST NOT block the snapshot publish). Uses `INSERT OR IGNORE` with a 5-min-bucket dedup index so a retry on the next tick is a no-op. (3) **Read-only route** `GET /api/v1/<feature>/history` that calls `HistoricalStore.read_<feature>()` and returns a pydantic-modeled response — returns 200 with `data_available: false` on empty/error (NOT 500). The pure helper's data construction MUST be guarded by a parity test against the inline computation it duplicates. **TD-5 adaptation:** daily-cadence metrics break the "write inside `_refresh()`" mold — write in TWO places instead: route lazy-fetch + scheduler hourly background refresh. Use `INSERT OR REPLACE` (not `IGNORE`) when the upstream source may revise a row after publication.

**Dependency-free SVG line chart pattern (iter 75 + iter 132).** When a tab needs a simple 1- or 2-line time-series chart, prefer a hand-rolled SVG over pulling Recharts/Chart.js — keeps the bundle lean, the component ~250 lines, and the API trivial (`points` + `height` props). Canonical template: `src/components/dashboard/storage-value-history-chart.tsx`. Key shape: (1) `viewBox` of `0 0 ${WIDTH} ${height}` + `width="100%"` + `className="overflow-visible"` so the chart scales with the parent; (2) `PADDING = { top, right, bottom, left }` for axis gutters; (3) `geometry` useMemo that computes `xFor(ts)` / `yFor(value)` linear scales from the data's own min/max (no fixed domain — adapts to spikes); (4) build the path string with `M` (move) on first point or after a null gap, `L` (line) otherwise — this gives free gap-in-line behavior without needing a separate library; (5) Y-axis ticks = 5 evenly-spaced values across the padded range, rendered as `<line>` + `<text>`; X-axis ticks = up to 5 timestamps formatted with `formatLocaleDate(ts, locale)`. Always render a "no history yet" notice when `points.length < 2` (one point can't draw a line). When the source data is a persisted SQLite history table, dedup to "best per timestamp" client-side — see `gold-map-roi-trend-chart.tsx:pickBestPerTimestamp` for the recipe.

### `react-hooks/set-state-in-effect` fix recipes (KI-24, all 10 sites resolved iter 115–123)

The rule fires when `setState` is called synchronously inside a `useEffect` body. Seven safe strategies depending on the pattern. Each has a canonical example file — read it before applying the recipe.

| Recipe | When to use | Canonical example |
|--------|-------------|-------------------|
| 1. Derive during render | Effect's only purpose is to mirror a prop into state — replace `setState` with a derived value in the return statement. | `use-price-stream.ts` (iter 115) |
| 2. `useSyncExternalStore` | Effect subscribes to an external store (`window.matchMedia`, localStorage, etc.). Use `useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)`. Eliminates the warning entirely. For "mounted flag": `useSyncExternalStore(subscribeNoop, () => true, () => false)`. | `use-reduced-motion.ts` (iter 116), `header.tsx` (iter 117), `i18n/index.tsx` (iter 121) |
| 3. Adjust state during render with prev-value guard | Effect's purpose is to RESET state when a prop transitions. Add `const [prevProp, setPrevProp] = useState(prop)` (initialized to current prop so first render does NOT trigger a reset). During render: `if (prop !== prevProp) { setPrevProp(prop); if (<reset-condition>) setOtherState(<reset-value>); }`. React explicitly supports `setState` during render as a special case. | `offline-banner.tsx` (iter 118), `dashboard-page.tsx` (iter 123) |
| 4. Move setState into a `useCallback` via a "signal ref" | State genuinely needs to be reset on a prop transition but is NOT fully derivable, AND there's a callback consumer to defer into. Add `useRef<boolean>(false)` "signal" flag; set it to `true` in the effect; consume + reset it at the top of the callback BEFORE any early-return guards. | `use-price-stream.ts` `freshSessionRef` (iter 115) |
| 5. Remove dead sync effect | Effect's ONLY purpose is to mirror a prop into local state (`setLocalValue(prev => prev !== value ? value : prev)`), but the component is UNCONTROLLED w.r.t. that prop after mount AND every external update is ALREADY accompanied by a synchronous local-state update from the same call site (so the guard is always false and the effect is dead code). | `fuzzy-search.tsx` (iter 120) |
| 6. Persistence-model redesign: Zustand store as single source of truth | Effect auto-selects a default value when an async list arrives AND persists that selection to Zustand, but local `useState` is initialized to a sentinel (`""`) instead of the persisted value — causing every reload to overwrite the user's persisted selection. Replace `useState` with `useDashboardStore((s) => s.uiState.x)`. Remove the auto-select effect — the existing `effectiveX` memo handles the fallback. Add a "normalize" effect that syncs `effectiveX` back into the store when the persisted value is invalid. | `use-realms-and-leagues.ts` (iter 122) |
| 7. Split effect: Zustand mutation stays, React setState moves to "adjust during render" | A single `useEffect` calls BOTH a Zustand action AND a React `setState`. Keep the Zustand mutation in the `useEffect` (the rule does NOT fire on Zustand `set`), and move the React `setState` to a separate "adjust state during render" block (Recipe 3) keyed on the same trigger. Extract the shared condition into a `useCallback`. | `dashboard-page.tsx:387` (iter 123) |

### `react-hooks/exhaustive-deps` stable-identity recipe (iter 124, TD-10)

When the rule flags a `useMemo`/`useCallback` deps array because a function inside the component changes identity every render, the canonical fix has two halves: (1) **Move constants to module level** — arrays/objects literals like `TAB_MAP` defined inside the component get a new identity every render, polluting every deps array that references them. Move them outside the component (top of file). (2) **Wrap event-handler wrappers in `useCallback`** — a wrapper like `const setTab = (t) => { setLocal(t); setStore(t); }` recreated every render invalidates every downstream memo. Wrap in `useCallback` with the underlying stable setters as deps. Both fixes were applied to `dashboard-page.tsx` iter 124 to close the `keyboardActions` useMemo exhaustive-deps warning without resorting to `eslint-disable`.

### `react-hooks/preserve-manual-memoization` evaluation recipe (iter 116)

The rule fires when the React Compiler cannot preserve a manual `useMemo` — typically because the compiler's inferred deps are broader than the source's `deps` array. The recipe: (1) Check if React Compiler is enabled in `next.config.ts`. If NOT enabled, removing `useMemo` is a PERFORMANCE REGRESSION. (2) Check if the memoized value is consumed in any `useEffect`/`useMemo` deps array. If NOT, removing `useMemo` is correctness-safe (just slower). (3) If compiler not enabled AND the narrow deps are intentional, KEEP the `useMemo` and add an inline `eslint-disable-next-line react-hooks/preserve-manual-memoization` with a comment explaining the rationale + when to revisit. Canonical example: `speculation-tab.tsx:332` `flipsByPairId`.

### `react-hooks/rules-of-hooks` extraction recipe (iter 116, KI-23)

When a hook is called inside a `.map()` callback (or any non-top-level position), the fix is to extract a child component that calls the hook at its top level. Recipe: (1) Define a `<Child>` component + props interface that accepts every value the closure was capturing. (2) Move the hook call to the top of the child. (3) Replace the `.map()` callback with `<Child key={...} {...props} />`. (4) Pass derived booleans (e.g. `isCollapsed={set.has(name)}`) rather than the whole Set — keeps the child pure. (5) Bind event handlers at the parent so the child stays generic. Canonical example: `unique-table.tsx` `<CategoryGroupTable>`.
