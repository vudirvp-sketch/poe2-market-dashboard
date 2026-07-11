# Worklog — PoE2 Market Dashboard

> Append-only shared multi-agent work log. Each section starts with `---`.
> Old task history is in `git log`. Trimmed to last 2 iterations.

---

Task ID: iter-128
Agent: main
Task: iter 128 — TD-4 Phase 2. Per iter 127's stopping-point brief: ship TD-4 Phase 2 alone (establishes the persistence pattern for TD-3 Phase 3 + TD-5 Phase 4). Scope = `market_spreads` SQLite table + `compute_market_spreads()` pure helper + best-effort write in `SnapshotManager._refresh()` + `GET /api/v1/market-spreads/history` read-only route. ~150 lines, medium risk, no migration (ADD TABLE only). Design doc: `docs/design/TD-3-4-5-9-persistence-gaps-design.md` §4 (schema), §5.1 (write path), §9 Phase 2 (file-by-file plan), §10 Q1/Q2 (open questions).

Work Log:
- Cloned repo. Read `STATUS.md` (iter 127 SHIPPED — TD-9 Phase 1 + P10 Phase 1 MVP, 1274 pytest green), `worklog.md` (iter 126 + iter 127), `docs/design/TD-3-4-5-9-persistence-gaps-design.md` (full — §3 Option B recommended, §4 schema with `market_spreads` table + 3 indexes + dedup on `strftime('%Y-%m-%d %H:%M', timestamp), league, pair_key`, §5.1 write path invariant "persistence MUST NOT block snapshot publish", §6.2 no backfill for spreads, §7 retention = 90 days, §8.1 ADD TABLE only (no ALTER), §9 Phase 2 = ~150 lines, §10 Q2 default = persist only direct pairs BFS factor = 1.0).
- Read source files for context: `backend/data/historical.py` (590 lines — `HistoricalStore` class, `_CREATE_TABLES_SQL` constant, `_prune_old_records` chunked-delete pattern, `_prune_old_league_data` same pattern, `get_historical_store` singleton), `backend/api/routes_arbitrage.py:268-308` (the inline spread computation to mirror — `liquidity_spread` from volume/highest_stock piecewise formula, `vol_spread = volatility * volatility_weight`, `market_spread = max(min, min(max, (liquidity + vol) * bfs_widening))`, `momentum_factor = min(|exp(momentum*24) - 1|, max_momentum_factor)`, `total_spread = min(max_total, market_spread * (1 + momentum_factor))`), `backend/api/data_snapshot.py:SnapshotManager._refresh` (the integration point — builds snapshot, populates exchange_rates + price_histories + currencies + tiers, returns snapshot; TD-4 write goes after tier classification, before `return snapshot`), `backend/economy/mirror_divine_arb.py` (template for pure-helper module — docstring + tunable constants + pure function), `backend/api/routes_mirror_divine_arb.py` (template for read-only route — thin wrapper, graceful degradation), `backend/api/response_models.py:MirrorDivineArbResponse` (template for pydantic response model), `backend/economy/momentum.py:PriceMomentumTracker` (reused for momentum + volatility computation), `backend/config.py:SpreadModelConfig` (the spread_model config values), `backend/models/currency.py:ExchangeRate` (the rate dataclass — currency_from, currency_to, raw_rate, volume_traded, highest_stock), `backend/main.py` (router registration pattern — try/except ImportError, `app.include_router`).
- **TD-4 Phase 2 implementation — `backend/data/historical.py`:**
  - Added `market_spreads` table to `_CREATE_TABLES_SQL` (11 columns: id, timestamp, league, pair_key, currency_from, currency_to, raw_rate, volume_24h, market_spread, total_spread, momentum_factor, bfs_widening_factor) + 3 indexes (idx_market_spreads_ts on timestamp, idx_market_spreads_pair on pair_key+league, idx_market_spreads_dedup UNIQUE on `strftime('%Y-%m-%d %H:%M', timestamp), league, pair_key`).
  - Added `write_market_spreads_batch(league, spreads, timestamp)` method — INSERT OR IGNORE via `executemany`, returns row count. Empty list returns 0 without DB call.
  - Added `read_market_spreads(league, pair_key=None, days=30)` method — SELECT with optional pair filter, `timestamp >= datetime('now', ? || ' days')` lookback, ORDER BY timestamp ASC. Returns list of dicts.
  - Added `read_market_spreads_pairs(league)` method — SELECT DISTINCT pair_key ORDER BY pair_key ASC. Used by route to populate a pair picker.
  - Extended `_prune_old_records` — second chunked-delete loop for `market_spreads` (same `rowid IN (SELECT ... LIMIT ?)` pattern, same chunk_size=1000, independent loop so a failure in one doesn't skip the other).
  - Extended `_prune_old_league_data` — league-distinct query now UNIONs `price_snapshots` + `market_spreads`; per-old-league chunked delete loop added for `market_spreads`.
  - Updated module docstring to document the new `market_spreads` table.
- **TD-4 Phase 2 implementation — `backend/economy/market_spreads.py` (NEW, ~210 lines):**
  - Pure function `compute_market_spreads(snapshot, config) -> list[dict]`. Iterates over `snapshot.exchange_rates` (direct pairs only — BFS factor = 1.0 per design doc §10 Q2 default). For each pair: looks up price history for `currency_from` (original-case first via currencies lookup, then lowercase fallback — mirrors `routes_arbitrage.py:180-189, 250-252`), computes `liquidity_spread` + `vol_spread` + `market_spread` + `momentum_factor` + `total_spread` using the same formula as `routes_arbitrage.py:274-308`, returns dict with all 9 documented keys.
  - Helper `_compute_liquidity_spread(volume, highest_stock, spread_model)` — the 3-branch piecewise formula (both / volume_only / no_volume).
  - Helper `_compute_momentum_factor(history, spread_model) -> (momentum_factor, volatility)` — uses `PriceMomentumTracker` with window_size=24 (matches routes_arbitrage.py:253), returns `(0.0, min_volatility)` when <2 price points.
  - Pairs with no price history are STILL emitted (with `momentum_factor=0.0`) — matches routes_arbitrage.py which does NOT skip pairs without history.
  - Empty currency_from/to skipped.
  - Never raises — logs debug message for skipped pairs.
- **TD-4 Phase 2 implementation — `backend/api/data_snapshot.py:SnapshotManager._refresh`:**
  - Added best-effort persistence block after tier classification, before `return snapshot`. Imports `compute_market_spreads` + `get_historical_store` lazily (inside the try block — avoids circular import risk). Calls `compute_market_spreads(snapshot, config)` → `store.write_market_spreads_batch(league, spreads, timestamp=snapshot.fetched_at or now)`. Logs debug on success with row count.
  - Wrapped in `try/except Exception` that logs a warning and continues — design doc §5.1 invariant: "persistence MUST NOT block the snapshot publish". Next tick retries via INSERT OR IGNORE dedup (5-min bucket).
- **TD-4 Phase 2 implementation — `backend/api/routes_market_spreads.py` (NEW, ~115 lines):**
  - `GET /api/v1/market-spreads/history?pair=&days=30` — read-only thin wrapper around `HistoricalStore.read_market_spreads` + `read_market_spreads_pairs`. Query params: `pair` (optional str, directional e.g. "exalted/divine"), `days` (default 30, ge=1, le=90).
  - Returns `MarketSpreadsHistoryResponse` dict with: league, pair, days, points (list of `MarketSpreadPoint`), available_pairs (distinct pair_keys), data_available (bool), fetched_at (ISO).
  - Graceful degradation: `try/except Exception` around the store calls — returns 200 with `data_available=false` + empty points/available_pairs on any failure (NOT 500).
- **TD-4 Phase 2 implementation — `backend/api/response_models.py`:**
  - Added `MarketSpreadPoint` pydantic model (10 fields: timestamp, pair_key, currency_from, currency_to, raw_rate, volume_24h, market_spread, total_spread, momentum_factor, bfs_widening_factor — all numeric fields `float | None`).
  - Added `MarketSpreadsHistoryResponse` pydantic model (7 fields: league, pair, days, points, available_pairs, data_available, fetched_at).
- **TD-4 Phase 2 implementation — `backend/main.py`:**
  - Registered `routes_market_spreads.router` via `try/except ImportError` + `app.include_router` — same pattern as all other routers. Placed after `mirror_divine_arb_router`.
- **TD-4 Phase 2 tests — `tests/test_market_spreads.py` (NEW, ~580 lines, 30 tests):**
  - `TestComputeMarketSpreadsShape` (5 tests): empty rates → empty list; single pair has all 9 expected keys; pair_key format is directional (NOT sorted); bfs_widening_factor always 1.0 for direct pairs; raw_rate + volume passed through.
  - `TestComputeMarketSpreadsFormula` (7 tests): market_spread clamped to min; market_spread clamped to max (when max > min); total_spread clamped to max; momentum_factor=0 with no history; momentum_factor=0 with 1 point; momentum_factor>0 with trending history; total_spread >= market_spread.
  - `TestComputeMarketSpreadsHistoryLookup` (4 tests): original-case api_id lookup; lowercase fallback; pair with no history still emitted; empty currency_from/to skipped.
  - `TestComputeMarketSpreadsFormulaParity` (1 test): **regression guard** — for a known input, `compute_market_spreads` output matches the inline formula in `routes_arbitrage.py:274-308` (manually computes `liquidity_spread` + `momentum_factor` + `vol_spread` + `market_spread` + `total_spread` and asserts equality within 1e-9).
  - `TestHistoricalStoreMarketSpreads` (9 tests, async): write+read roundtrip; dedup same-minute-bucket (1 row); dedup different-minute-buckets (2 rows); read with pair filter; read_pairs alphabetical; empty batch returns 0; read empty returns []; league isolation; rows ordered oldest-first.
  - `TestSnapshotManagerIntegration` (2 tests): persistence failure does NOT block snapshot (simulated DB lock → caught + logged); empty spreads skips write entirely.
  - `TestEndToEnd` (1 test, async): compute_market_spreads → write_market_spreads_batch → read_market_spreads — full roundtrip with value equality assertions.
- **TD-4 Phase 2 tests — `tests/test_market_spreads_route.py` (NEW, ~240 lines, 10 tests):**
  - `TestMarketSpreadsRouteEmpty` (2 tests): returns 200 with data_available=false when no rows; fetched_at is ISO string.
  - `TestMarketSpreadsRouteWithRows` (4 tests): returns rows when persisted; pair filter returns only matching rows; available_pairs populated + sorted; point has all 10 expected fields with correct values.
  - `TestMarketSpreadsRouteValidation` (4 tests): days=0 → 422; days=91 → 422; days=1 + days=90 accepted; default days=30.
  - `TestMarketSpreadsRouteDegraded` (1 test): HistoricalStore raises → 200 with data_available=false (NOT 500).
- **Test runs:**
  - `python -m pytest tests/test_market_spreads.py tests/test_market_spreads_route.py` → 40 passed in 4.40s.
  - `python -m pytest tests/ --ignore=tests/e2e` → 1327 passed (1287 baseline + 40 new), 0 failures, 0 errors. No regressions.
  - Frontend (jest/tsc/lint): node_modules not present in this env — skipped. No frontend files touched (all changes are Python backend).
- **Documentation updates:**
  - `STATUS.md`: updated "Last updated" header to iter 128; added TD-4/Phase-2 closed-issue entry with full implementation summary; updated TD-3/TD-4/TD-5/TD-9/P10 entries in technical-debt backlog (TD-4 marked SHIPPED, TD-3/TD-5 now reference "TD-4 Phase 2 patterns established"); added new Quick Reference row for `GET /api/v1/market-spreads/history returns data_available: false`; added new "Key technical insights" paragraph documenting the TD-4 Phase 2 three-layer persistence pattern (pure helper + best-effort write + read-only route) as a template for TD-3 Phase 3 + TD-5 Phase 4. Trimmed duplicate stale sections.
  - `AGENT_NAVIGATION.md`: updated header to iter 128; added 4 new module-map entries (`backend/economy/market_spreads.py`, `backend/api/routes_market_spreads.py`, `backend/api/data_snapshot.py:SnapshotManager._refresh` integration point, `backend/data/historical.py` market_spreads table + methods).

Stage Summary:
- **iter 128 SHIPPED — TD-4 Phase 2 complete.** `market_spreads` SQLite table + `compute_market_spreads()` pure helper + best-effort write in `SnapshotManager._refresh()` + `GET /api/v1/market-spreads/history` read-only route. Establishes the three-layer persistence pattern (pure helper + best-effort write + read-only route) that TD-3 Phase 3 + TD-5 Phase 4 can copy without re-deriving the plumbing.
- **Modified files (5):** `backend/data/historical.py` (schema + 3 methods + prune extensions), `backend/api/data_snapshot.py` (best-effort write in _refresh), `backend/api/response_models.py` (2 new pydantic models), `backend/main.py` (router registration), `STATUS.md`, `AGENT_NAVIGATION.md`, `worklog.md`.
- **New files (4):** `backend/economy/market_spreads.py` (pure helper), `backend/api/routes_market_spreads.py` (route), `tests/test_market_spreads.py` (30 tests), `tests/test_market_spreads_route.py` (10 tests).
- **Test counts:** pytest 1327 green (1287 baseline + 40 new), 0 regressions. Jest/tsc/lint: not run (node_modules not present in env) — no frontend files touched.
- **Design doc §10 open questions — resolved defaults:**
  - Q2 (BFS pairs): default = persist only direct pairs (BFS factor = 1.0). Implemented — `compute_market_spreads` only iterates `snapshot.exchange_rates` (direct pairs). If a future iter needs BFS pairs for slippage modeling, extend with `include_bfs: bool` parameter.
  - Q4 (cadence): the 5-min bucket matches POE2Scout's snapshot cadence (assumed). Open for investigation during Phase 3 if data loss is suspected.
- **What was NOT done (intentionally deferred to iter 129+):**
  - **TD-3 Phase 3** (`triangular_cycles` table + write/read + route) — ~180 lines, medium risk. Now unblocked — copy the TD-4 Phase 2 template: pure helper in `backend/economy/triangular_cycles.py`, `HistoricalStore.write_triangular_cycles_batch()` + `read_triangular_cycles()`, best-effort write in `SnapshotManager._refresh()` after `find_triangular_arbitrage` call, `GET /api/v1/arbitrage/triangular/history?cycle_key=&days=30` route. Design doc §9 Phase 3.
  - **TD-5 Phase 4** (`daily_stats` table + backfill script + scheduler + route) — ~250 lines + script, medium-high risk, one-shot backfill op. Depends on TD-3 Phase 3 patterns. Design doc §9 Phase 4 + §5.2 (lazy fetch + cache strategy) + §6.3 (backfill via POE2Scout DayCount=90, 1 req/sec, ~17 min for 1000 items).
  - **P10 Phase 2** (trend chart) — depends on TD-3 Phase 3.
  - **TD-9 fallback removal** — `deriveTrendSparklineData` should be removed iter 129+ once production logs confirm no fallback path is hit for 2 iters (design doc §10 Q5).
- **Stopping point:** iter 128 = TD-4 Phase 2 SHIPPED, all baselines preserved or improved (1327 pytest green, 0 regressions). Next iter (iter 129) candidates in priority order: (a) **TD-3 Phase 3** (lowest risk of the remaining persistence phases — copy the TD-4 template, ~180 lines, no migration); (b) **TD-5 Phase 4** (highest risk — daily_stats table + one-shot backfill script + scheduler task + new endpoint, ~250 lines + script). Recommended: ship (a) alone in iter 129 (proves the template generalizes), then (b) in iter 130+ once the triangular_cycles pattern is proven.

---

Task ID: iter-127
Agent: main
Task: iter 127 — TD-9 Phase 1 + P10 Phase 1 MVP. Per iter 126's brief: ship two user-visible improvements in one iter. TD-9 Phase 1 = wire `price_history_short` from `snapshot.price_histories[-14:]` into `/flips` response (cheapest fix, no persistence). P10 Phase 1 MVP = new `gold-map-roi-tab.tsx` + `gold-map-roi-calculator.tsx` + localStorage + i18n × 4 locales + add to `TAB_MAP` at index 13 (click-only) — reuses existing `/api/flipper/triangular`.

Stage Summary:
- **iter 127 SHIPPED — TD-9 Phase 1 + P10 Phase 1 MVP complete.** TD-9: FlipsTable "Trend" sparkline now renders REAL `price_history_short` (up to 14 points) instead of synthetic `momentum × volatility` shape. Synthetic shape kept as fallback for zero-history edge case. P10: new "Gold ROI" tab (click-only, index 13) computes Castaway-run ROI with 4-tier recommendation flag (AVOID/MARGINAL/FARM/STRONG_FARM at 0/50/150%). 3 inputs persisted to localStorage with 7-day staleness warning. Reuses existing `/api/flipper/triangular` — NO new backend route.
- **Test counts:** pytest 1274 green (+8 TD-9). Jest 685 green (+12 TD-9 + +51 P10 = +63). tsc green. Lint 111 warnings (unchanged).
- **Stopping point:** iter 127 = TD-9 Phase 1 + P10 Phase 1 MVP SHIPPED. Next iter (iter 128) recommendation: ship TD-4 Phase 2 alone (establishes the persistence pattern).
