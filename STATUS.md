# STATUS.md — Known Issues & Quick Reference

> **Last updated:** 2026-07-13 (iter 142 — `docs/ARCHITECTURE.md` + `docs/MARKET_PLAYBOOK.md` + `docs/CORS_PROXY_GUIDE.md` audit: ARCHITECTURE.md (12 drift items — tabs 10→16, DataSnapshot fields, HistoricalStore tables 3→5, scheduler jobs 3→4, poe2api.ts circuit breaker thresholds, Graph tab phantom removed, /api/health → /api/v1/health/ping, P10 Gold Map ROI tab added); MARKET_PLAYBOOK.md (P10 marked SHIPPED, sections C.1–C.7 iter-by-iter detail trimmed 355→205 lines); CORS_PROXY_GUIDE.md (poe2api.ts circuit breaker open duration 30s → 60s, cache TTL clarified as 60s fresh / 30min stale). New bug KI-31 found + fixed: `.env.example` shipped with dead `api.poe2scout.com` URL. 1466 pytest green, 1 source-code change (`.env.example` only).)
> Single source of truth for known bugs and frequent problems. Update BEFORE fixing any issue.

---

## Known Issues — open

### None. See "Technical-debt backlog" for low-priority items.

---

## Technical-debt backlog

| ID | Priority | Notes |
|----|----------|-------|
| **TD-3** | P3 | Triangular arbitrage persistence. All phases SHIPPED iter 129–134. **Open:** runtime log verification on next prod deploy — confirm the debug log `"TD-3 cache: populated pipeline_cache key=%s"` appears in `_refresh` output. |
| **TD-4** | P3 | `market_spread` persistence. Phase 2 SHIPPED iter 128. **Open:** verify in production logs that rows land in SQLite. |
| **TD-5** | P3 | `DailyStatsHistory` OHLCV persistence. Phase 4 SHIPPED iter 131. **Open:** (1) verify the hourly `daily_stats_refresh` job persists rows; (2) run `scripts/backfill_daily_stats.py --dry-run` then `--top-n 50` for an initial seed; (3) verify the lazy-fetch fallback in the route fires on first hit. |
| **F1** | P3 | Russian translations. **Pipeline SHIPPED iter 137.** Periodic re-run iter 138: 643 items, 634 translated, 9 still no poe2db Russian page. **Open:** re-run `--fetch-ru-by-item` periodically (monthly / after each patch) as poe2db adds translations. |

---

## F1 — 9 items with no poe2db Russian page (deferred)

poe2db has the pages but no Russian translation — titles are English-only. Re-run the pipeline periodically to pick them up.

| api_id | poe2db URL |
|--------|------------|
| `aldurs-legacy` | https://poe2db.tw/ru/Aldurs_Legacy |
| `betrayal-of-aldur` | https://poe2db.tw/ru/Betrayal_of_Aldur |
| `vision-rune` | https://poe2db.tw/ru/Vision_Rune |
| `rebirth-rune` | https://poe2db.tw/ru/Rebirth_Rune |
| `ward-rune` | https://poe2db.tw/ru/Ward_Rune |
| `stone-rune` | https://poe2db.tw/ru/Stone_Rune |
| `breath-of-aldur` | https://poe2db.tw/ru/Breath_of_Aldur |
| `ire-of-aldur` | https://poe2db.tw/ru/Ire_of_Aldur |
| `passion-of-aldur` | https://poe2db.tw/ru/Passion_of_Aldur |

---

## Design-docs

| Doc | Covers | Status |
|-----|--------|--------|
| `docs/design/TD-3-4-5-9-persistence-gaps-design.md` | TD-3 + TD-4 + TD-5 + TD-9 unified persistence-layer analysis. Four-phase plan. | **ALL PHASES SHIPPED.** Phase 1 iter 127. Phase 2 iter 128. Phase 3 iter 129. Phase 4 iter 131. |
| `docs/design/P10-gold-map-roi-design.md` | P10 Gold Map ROI — UX + ROI formula. | DESIGN COMPLETE — Phase 1 (MVP) SHIPPED iter 127. Phase 2 (trend chart) SHIPPED iter 132. Phase 3 (SQLite promotion) optional. |

---

## Quick Reference — Frequent Problems

| Symptom | Cause | Where to fix |
|---------|-------|--------------|
| `python scripts/sync_currency_names_from_poe2db.py --fetch-ids` raises `http.client.InvalidURL` | **KI-29** (fixed iter 137) — league name with spaces not URL-encoded. | `scripts/sync_currency_names_from_poe2db.py:fetch_poe2scout_items` |
| `--fetch-ru` returns "pairs" but they're all gibberish | **KI-30** (fixed iter 137) — category-page parser matches infobox stat rows. Use `--fetch-ru-by-item` (or parallel runner) instead. | `scripts/sync_currency_names_from_poe2db.py:fetch_poe2db_ru_names_by_item` |
| Every API call 404s even on a fresh checkout (no `.env.local` edits) | **KI-31** (fixed iter 142) — `.env.example` shipped with `POE2_API_BASE_URL=https://api.poe2scout.com/api` (dead `api.` subdomain, see KI-15). Users copying it to `.env.local` would override the correct built-in default (`https://poe2scout.com/api`) and get 404 on every endpoint. Fix: `.env.example` now uses bare domain + corrected comment. | `.env.example:7` |
| After updating `currency_names.json`, the TS mirror is out of sync | Run `python scripts/sync_currency_names_ts.py` to regenerate `src/lib/currency-names.ts` from the JSON. | `scripts/sync_currency_names_ts.py` |
| `pytest` fails on Python 3.14 with `RuntimeError: There is no current event loop in thread 'MainThread'` in `test_daily_stats_persistence.py` | **KI-28** (fixed iter 136) — `asyncio.get_event_loop()` was removed in Python 3.14. Use the `_run(coro)` helper (= `asyncio.run(coro)`) instead. | `tests/test_daily_stats_persistence.py:_run` |
| `pytest` fails on `test_snapshot_age_sec_handles_naive_datetime` with `assert 0 >= 30` in non-UTC timezone | **KI-26** (fixed iter 130) — `_safe_snapshot_age_sec` used `replace(tzinfo=utc)` instead of `astimezone(timezone.utc)` for naive datetimes. | `backend/economy/triangular_cycles.py:_safe_snapshot_age_sec` |
| `phase-hints-widget` jest test "renders current price" fails with `Expected: "115.50", Received: "116"` | **KI-21** (fixed iter 111) — `fmtPrice` rounded `>= 100` to integer. Fix already applied. | `src/components/dashboard/phase-hints-widget.tsx:fmtPrice` |
| All API calls return 404; dashboard empty | **KI-15** — `.env.local` has dead `api.poe2scout.com`. Use `POE2_API_BASE_URL=https://poe2scout.com/api` | `.env.local`, `start.bat`, `start.sh` |
| `next build` warns "Encountered unexpected file in NFT list ... flipper-backend-bridge.ts" | **KI-16-deep** (fixed iter 106) — bridge must use `exec`/`execSync`, not `spawn`/`spawnSync`. No `fs`/`path` imports. | `instrumentation.ts`, `src/lib/flipper-backend-bridge.ts` |
| `pytest` hangs on `test_triangular.py` | **KI-18** (fixed iter 105) — check `tests/conftest.py` patches `get_process_pool` → None | `tests/conftest.py` |
| 6 pytest modules fail on collection (`test_daily_stats_persistence`, `test_market_spreads*`, `test_scheduler`, `test_triangular_cycles*`) | Env-setup issue — `aiosqlite` missing from active venv. Run `pip install -r requirements.txt` (or `pip install aiosqlite`). With aiosqlite installed, the full suite is **1466 pytest green** (vs 1289 with the 6 modules skipped). Does NOT indicate a regression. | env-only |
| `/optimizer/path` returns empty path with `data_available: true` | Profitable arbitrage cycle detected — fall back to `direct_rate` | `backend/api/routes_optimizer.py:_bellman_ford` |
| SQLite `near "LIMIT": syntax error` | Use `rowid IN (SELECT ... LIMIT ?)` pattern | `backend/data/historical.py:_prune_old_league_data` |
| FlipsTable "Trend" sparkline shows `—` instead of a line | By design (iter 135) — sparkline renders REAL `price_history_short` (≥ 2 points required). The synthetic `momentum × volatility` fallback was REMOVED as misleading. | `src/components/dashboard/flips-helpers.ts:getTrendSparklineData`, `sparkline.tsx:115-116` |
| `/api/v1/market-spreads/history` returns `data_available: false` | **TD-4** — table empty. Wait 5 min for snapshot refresh, or check `sqlite3 historical.db "SELECT COUNT(*) FROM market_spreads"`. | `backend/economy/market_spreads.py:compute_market_spreads` |
| `/api/v1/arbitrage/triangular/history` returns `data_available: false` | **TD-3** — table empty. Either (a) refresh hasn't run yet, (b) no profitable cycles detected (normal in stable markets), or (c) `find_triangular_arbitrage` timed out (90s — check logs for "TD-3: find_triangular_arbitrage failed"). | `backend/economy/triangular_cycles.py:compute_triangular_cycles` |
| `/api/v1/items/{item_id}/daily-stats` returns `data_available: false` | **TD-5** — table empty AND provider returned None. Either (a) item_id unknown to POE2Scout (404), (b) hourly `daily_stats_refresh` scheduler hasn't run yet, or (c) lazy-fetch provider call failed. | `backend/api/routes_daily_stats.py:get_daily_stats_history` |
| Gold Map ROI trend chart shows "No cycle history yet" | **P10 Phase 2** — same root cause as `/api/v1/arbitrage/triangular/history` row above. The chart needs ≥ 2 deduped points to draw a line. | `src/components/dashboard/gold-map-roi-trend-chart.tsx` |
| Mirror/Divine Arb tab shows "no price history yet" | By design (iter 109) — backend returns `data_available: false` when scheduler hasn't collected ≥ 4 Mirror + Divine snapshots. | `backend/economy/mirror_divine_arb.py`, `mirror-divine-arb-tab.tsx` |
| `/api/poe2/uniques` or `/api/poe2/currencies` returns 200 with empty `items: []` | KI-11 (closed iter 102) — verify `config.yaml:league.league_name` is valid | `src/lib/poe2api.ts` |
| User's league selection lost on every reload | Fixed iter 122 — `use-realms-and-leagues.ts` persistence-model redesign. | `src/hooks/use-realms-and-leagues.ts` |

---

## Key technical insights for future agents

**FastAPI route matching is ORDER-DEPENDENT.** A `{param:path}` converter is greedy and matches slashes — it will shadow any literal sub-path registered AFTER it. Always register literal-path routers BEFORE greedy-path routers. (KI-13 lesson.)

**Frontend price formatting convention.** `fmtPrice`-style helpers should keep 2 decimals for prices `>= 1` and 4 decimals for `< 1`. Never truncate large prices to integers — this silently broke the iter-110 live-price test (KI-21).

**Naive datetime handling (KI-26 / KI-27).** When converting a naive `datetime` (no `tzinfo`) to UTC, use `dt.astimezone(timezone.utc)` — NOT `dt.replace(tzinfo=timezone.utc)`. `replace()` just relabels the wall-clock value as UTC without converting, which silently produces future timestamps in non-UTC timezones. `replace()` is ONLY correct when the input is already UTC but lacks `tzinfo` (e.g., datetimes read from SQLite, which stores them as naive UTC, OR POE2Scout ISO strings without `Z`). **Audit pattern:** classify each `replace(tzinfo=utc)` site by input source — SQLite/POE2Scout = SAFE; `datetime.now()`/API request body/external caller = UNSAFE → switch to `astimezone()`.

**Three-layer persistence pattern (iter 128–131) — template for future persistence gaps.** (1) **Pure helper** in `backend/economy/<feature>.py` that takes `(snapshot, config)` and returns `list[dict]` — no I/O, fully unit-testable. (2) **Best-effort write** wired into `SnapshotManager._refresh()` AFTER the snapshot is built but BEFORE `return snapshot` — wrapped in `try/except` that logs a warning and continues (persistence MUST NOT block the snapshot publish). Uses `INSERT OR IGNORE` with a dedup index. (3) **Read-only route** `GET /api/v1/<feature>/history` that calls `HistoricalStore.read_<feature>()` and returns 200 with `data_available: false` on empty/error (NOT 500). The pure helper's data construction MUST be guarded by a parity test against the inline computation it duplicates. **TD-5 adaptation:** daily-cadence metrics break the "write inside `_refresh()`" mold — write in TWO places instead: route lazy-fetch + scheduler hourly background refresh. Use `INSERT OR REPLACE` (not `IGNORE`) when the upstream source may revise a row after publication.

**Dependency-free SVG line chart pattern (iter 75 + iter 132).** When a tab needs a simple 1- or 2-line time-series chart, prefer a hand-rolled SVG over pulling Recharts/Chart.js — keeps the bundle lean, the component ~250 lines, and the API trivial (`points` + `height` props). Canonical template: `src/components/dashboard/storage-value-history-chart.tsx`. Key shape: (1) `viewBox` of `0 0 ${WIDTH} ${height}` + `width="100%"` + `className="overflow-visible"`; (2) `geometry` useMemo that computes `xFor(ts)` / `yFor(value)` linear scales from the data's own min/max; (3) build the path string with `M` on first point or after a null gap, `L` otherwise; (4) always render a "no history yet" notice when `points.length < 2`. When the source data is a persisted SQLite history table, dedup to "best per timestamp" client-side — see `gold-map-roi-trend-chart.tsx:pickBestPerTimestamp`.

**Translation pipeline (iter 137).** Three stages: `--fetch-ids` (live poe2scout.com API, paginates all 17 categories), `--fetch-ru-by-item` (per-item poe2db page fetch + `<title>` tag extraction), `--diff` + `--apply --confirm` (writes to JSON, preserves RU/EN key parity, idempotent). Run `python scripts/sync_currency_names_ts.py` afterwards to regenerate the TS mirror. Bump count assertions in `tests/test_currency_names_ru.py` to match. The legacy `--fetch-ru` (category-page parser) is BROKEN per KI-30 — do not use it. For speed, use `scripts/fetch_ru_by_item_parallel.py` (thread-pooled version, ~20s for 346 items; ~1s when only 9 untranslated remain).
