# Worklog — PoE2 Market Dashboard

> Append-only shared multi-agent work log. Each section starts with `---`.
> Old task history is in `git log`. Trimmed to last 2 iterations.

---

Task ID: iter-129
Agent: main
Task: iter 129 — TD-3 Phase 3. Per iter 128's stopping-point brief: ship TD-3 Phase 3 alone (proves the TD-4 Phase 2 template generalizes). Scope = `triangular_cycles` SQLite table + `compute_triangular_cycles()` pure helper + best-effort write in `SnapshotManager._refresh()` (AFTER the TD-4 market_spreads block) + `GET /api/v1/arbitrage/triangular/history` read-only route. ~180 lines, medium risk, no migration (ADD TABLE only). Design doc: `docs/design/TD-3-4-5-9-persistence-gaps-design.md` §4 (schema), §5.1 (write path), §9 Phase 3 (file-by-file plan), §10 Q1 (open question — persist only profitable cycles).

Work Log:
- Cloned repo. Read `STATUS.md` (iter 128 SHIPPED — TD-4 Phase 2, 1327 pytest green), `worklog.md` (iter 127 + iter 128), `docs/design/TD-3-4-5-9-persistence-gaps-design.md` (full — §4 schema with `triangular_cycles` table + 3 indexes + dedup on `strftime('%Y-%m-%d %H:%M', timestamp), league, cycle_key`, §5.1 write path invariant, §6.1 no backfill for cycles, §7 retention = 90 days, §8.4 cycle_key collision (intentional — A→B→C→A and A→C→B→A share key), §9 Phase 3 = ~180 lines, §10 Q1 default = persist only profitable cycles).
- Read source files for context: `backend/data/historical.py` (809 lines — `HistoricalStore` class, market_spreads table + methods as TD-4 template), `backend/economy/market_spreads.py` (TD-4 pure helper template — docstring + tunable constants + pure function + helpers), `backend/api/routes_market_spreads.py` (TD-4 route template — thin wrapper, graceful degradation), `backend/api/response_models.py:MarketSpreadPoint + MarketSpreadsHistoryResponse` (TD-4 pydantic template), `backend/arbitrage/triangular.py:find_triangular_arbitrage` (the function to call — async, uses ProcessPoolExecutor, 90s timeout, returns `TriangularResult(opportunities, suspicious_triples)`), `backend/models/currency.py:TriangularOpportunity` (the cycle dataclass — cycle, net_profit_pct, step_rates, total_volume, confidence, min_starting_amount, quantized_profit_pct, continuous_profit_pct, integer_simulation), `backend/api/routes_arbitrage.py:792-918` (the live `/triangular` route — builds rates_dict + pair_volumes from snapshot.exchange_rates at lines 829-848, calls find_triangular_arbitrage with min_profit_pct=1.0 default + cross_rate_threshold_pct=7.0, caches result in pipeline_cache), `backend/api/data_snapshot.py:SnapshotManager._refresh` (the integration point — TD-4 market_spreads block at lines 617-642, TD-3 triangular_cycles block goes AFTER it, before `return snapshot`), `tests/test_market_spreads.py` + `tests/test_market_spreads_route.py` (TD-4 test template — 4 sections: pure-helper shape/formula/parity/error, persistence roundtrip/dedup/filter/league/order, SnapshotManager integration, E2E, route empty/with-rows/filter/validation/degraded), `tests/conftest.py` (KI-18 fix — autouse fixture forces `get_process_pool` → None for tests).
- **TD-3 Phase 3 implementation — `backend/data/historical.py`:**
  - Added `triangular_cycles` table to `_CREATE_TABLES_SQL` (10 columns: id, timestamp, league, cycle_key, cycle_currencies, raw_profit_pct, executable_estimate, executable_profit, confidence, snapshot_age_sec) + 3 indexes (idx_tri_cycles_ts on timestamp, idx_tri_cycles_key on cycle_key+league, idx_tri_cycles_dedup UNIQUE on `strftime('%Y-%m-%d %H:%M', timestamp), league, cycle_key`).
  - Added `write_triangular_cycles_batch(league, cycles, timestamp)` method — INSERT OR IGNORE via `executemany`, returns row count. Empty list returns 0 without DB call.
  - Added `read_triangular_cycles(league, cycle_key=None, days=30)` method — SELECT with optional cycle_key filter, `timestamp >= datetime('now', ? || ' days')` lookback, ORDER BY timestamp ASC. Returns list of dicts.
  - Added `read_triangular_cycles_keys(league)` method — SELECT DISTINCT cycle_key ORDER BY cycle_key ASC. Used by route to populate a cycle picker.
  - Extended `_prune_old_records` — third chunked-delete loop for `triangular_cycles` (same `rowid IN (SELECT ... LIMIT ?)` pattern, same chunk_size=1000, independent loop).
  - Extended `_prune_old_league_data` — league-distinct query now UNIONs `price_snapshots` + `market_spreads` + `triangular_cycles`; per-old-league chunked delete loop added for `triangular_cycles`.
  - Updated module docstring to document the new `triangular_cycles` table.
- **TD-3 Phase 3 implementation — `backend/economy/triangular_cycles.py` (NEW, ~230 lines):**
  - Async pure function `compute_triangular_cycles(snapshot, config, *, min_profit_pct=1.0, cross_rate_threshold_pct=7.0) -> list[dict]`. Builds `rates_for_bf` + `pair_volumes` from `snapshot.exchange_rates` (mirrors `routes_arbitrage.py:829-848` verbatim), calls `find_triangular_arbitrage()` with the route's defaults, returns dict list with 7 documented keys.
  - Helper `_build_cycle_key(cycle) -> str` — `sorted(set(cycle))` joined with `->` (e.g. `divine->exalted->mirror`). Collapses rotations to one key per design doc §4.3 + §8.4.
  - Helper `_strip_closing_node(cycle) -> list[str]` — strips the duplicate closing node if present (e.g. `["A","B","C","A"]` → `["A","B","C"]`).
  - Helper `_safe_snapshot_age_sec(snapshot_time) -> int` — defensive against naive datetime + None.
  - Field mapping: `raw_profit_pct` ← `continuous_profit_pct` (Bellman-Ford raw, NOT net or quantized); `executable_estimate` ← `min_starting_amount`; `executable_profit` ← `integer_simulation[-1]` (final amount, NOT delta — profit = executable_profit - executable_estimate); `confidence` ← `confidence`; `snapshot_age_sec` ← computed from `fetched_at`.
  - Never raises — `find_triangular_arbitrage` failure (including 90s timeout) logs warning and returns `[]`. Matches design doc §5.1 invariant.
- **TD-3 Phase 3 implementation — `backend/api/data_snapshot.py:SnapshotManager._refresh`:**
  - Added second best-effort try/except block AFTER the TD-4 market_spreads block (lines 644-672), BEFORE `return snapshot`.
  - Calls `compute_triangular_cycles(snapshot, config)` → if non-empty, calls `store.write_triangular_cycles_batch(league, cycles, timestamp=snapshot.fetched_at or now)`.
  - Failure logged as `logger.warning("TD-3: triangular_cycles persistence failed (non-fatal, next tick will retry): %s", e)` — does NOT block snapshot publish.
  - Used `as _get_store_td3` alias to avoid shadowing the TD-4 `get_historical_store` import in the same function scope.
- **TD-3 Phase 3 implementation — `backend/api/response_models.py`:**
  - Added `TriangularCyclePoint` model (8 fields: timestamp, cycle_key, cycle_currencies, raw_profit_pct, executable_estimate, executable_profit, confidence, snapshot_age_sec — all numeric fields `float | None` / `int | None`).
  - Added `TriangularCyclesHistoryResponse` model (7 fields: league, cycle_key, days, points, available_cycle_keys, data_available, fetched_at).
- **TD-3 Phase 3 implementation — `backend/api/routes_arbitrage.py`:**
  - Added `GET /api/v1/arbitrage/triangular/history` route (lines 921-1026) under the existing `arbitrage_router` (prefix `/api/v1/arbitrage`). Same thin-wrapper pattern as `routes_market_spreads.py`.
  - Query params: `cycle_key: str | None` (optional filter, default None), `days: int` (default 30, ge=1, le=90, matches `historical_retention_days`).
  - Returns `TriangularCyclesHistoryResponse` pydantic model. On exception: logs error, returns 200 with `data_available=false` + empty lists (NOT 500).
  - Distinct from the live `/triangular` route — `/history` reads from SQLite, does NOT call `find_triangular_arbitrage`. The live route is unchanged.
  - Added `TriangularCyclesHistoryResponse` to the import from `backend.api.response_models`.
  - Added module constants `DEFAULT_TD3_HISTORY_DAYS=30` + `MAX_TD3_HISTORY_DAYS=90`.
  - No router registration change needed — the new route is added to the existing `arbitrage_router` which is already registered in `backend/main.py:545`.
- **Test suite — `tests/test_triangular_cycles.py` (NEW, 36 tests, 4 sections):**
  - `TestComputeTriangularCyclesShape` (6 tests): empty rates, single cycle schema, cycle_key sorted-unique join, cycle_currencies strips closing node, helper functions.
  - `TestComputeTriangularCyclesFieldMapping` (8 tests): raw_profit_pct ← continuous_profit_pct, executable_estimate ← min_starting_amount, executable_profit ← integer_simulation[-1], executable_profit=0 when no simulation, confidence passthrough, snapshot_age_sec non-negative, snapshot_age_sec=0 when fetched_at=None, snapshot_age_sec handles naive datetime.
  - `TestComputeTriangularCyclesParity` (6 tests): rates_dict construction matches routes_arbitrage.py:829-831, pair_volumes construction matches routes_arbitrage.py:846-848, default min_profit_pct=1.0, default cross_rate_threshold_pct=7.0, custom min_profit_pct passed through, snapshot_time passed through.
  - `TestComputeTriangularCyclesErrorHandling` (4 tests): find_triangular_arbitrage failure returns [], no opportunities returns [], empty cycle skipped, multiple cycles all emitted.
  - `TestHistoricalStoreTriangularCycles` (9 tests): write/read roundtrip, dedup same/different minute buckets, cycle_key filter, read_keys, empty batch, empty read, league isolation, oldest-first ordering.
  - `TestSnapshotManagerTriangularCyclesIntegration` (2 tests): persistence failure non-fatal, empty cycles skips write.
  - `TestEndToEnd` (1 test): compute → write → read full roundtrip.
- **Test suite — `tests/test_triangular_cycles_route.py` (NEW, 13 tests, 5 sections):**
  - `TestTriangularCyclesRouteEmpty` (2 tests): 200 + data_available=false, fetched_at is ISO string.
  - `TestTriangularCyclesRouteWithRows` (4 tests): returns rows when persisted, cycle_key filter, available_cycle_keys populated + sorted, point has all 8 fields.
  - `TestTriangularCyclesRouteValidation` (4 tests): days=0 → 422, days=91 → 422, days=1/90 accepted, default days=30.
  - `TestTriangularCyclesRouteDegraded` (1 test): store failure returns 200 with empty result.
  - `TestTriangularCyclesRouteDistinctFromLive` (2 tests): /history does NOT call find_triangular_arbitrage, live + history routes coexist with distinct response shapes.
- **Documentation updates:**
  - `STATUS.md`: updated "Last updated" header to iter 129; added TD-3/Phase-3 closed-issue entry with full implementation summary; updated TD-3 entry in technical-debt backlog (marked Phase 3 SHIPPED, added performance note about doubled compute cost + future optimization to populate pipeline_cache from _refresh); updated TD-5 entry (now references "TD-3 Phase 3 patterns proven"); updated P10 entry (Phase 2 trend chart now unblocked — TD-3 Phase 3 SHIPPED); added new Quick Reference row for `GET /api/v1/arbitrage/triangular/history returns data_available: false`; updated "Key technical insights" paragraph for the three-layer pattern — added iter 129 confirmation that template generalizes + added note about the parity test on rates_dict/pair_volumes construction (not a formula, since cycle detection is delegated).
  - `worklog.md`: prepended iter-129 entry, trimmed to last 2 iterations (iter 128 + iter 129 — iter 127 moved to `git log`).

Stage Summary:
- **iter 129 SHIPPED — TD-3 Phase 3 complete.** `triangular_cycles` SQLite table + `compute_triangular_cycles()` pure helper + best-effort write in `SnapshotManager._refresh()` + `GET /api/v1/arbitrage/triangular/history` read-only route. **Confirms the TD-4 Phase 2 three-layer persistence pattern generalizes** — triangular_cycles followed the exact same shape (pure helper + best-effort write + read-only route + parity test), with the only addition being a parity test on the `rates_dict`/`pair_volumes` construction (not a formula, since the cycle detection itself is delegated to `find_triangular_arbitrage`).
- **Modified files (5):** `backend/data/historical.py` (schema + 3 methods + prune extensions + league-union extension), `backend/api/data_snapshot.py` (best-effort write in _refresh after TD-4 block), `backend/api/response_models.py` (2 new pydantic models), `backend/api/routes_arbitrage.py` (new /triangular/history route + import + constants), `STATUS.md`, `worklog.md`.
- **New files (3):** `backend/economy/triangular_cycles.py` (pure helper), `tests/test_triangular_cycles.py` (36 tests), `tests/test_triangular_cycles_route.py` (13 tests).
- **Test counts:** pytest 1376 green (1327 baseline + 49 new), 0 regressions. Jest/tsc/lint: not run (node_modules not present in env) — no frontend files touched.
- **Design doc §10 open questions — resolved defaults:**
  - Q1 (None-profit cycles): default = persist only profitable cycles (matches `find_triangular_arbitrage` filter at `min_profit_pct=1.0`). Implemented — `compute_triangular_cycles` uses `DEFAULT_MIN_PROFIT_PCT=1.0`. If a future iter needs hit-rate analysis, lower to 0.0.
  - Q4 (cadence): same 5-min bucket as market_spreads. If the live `/triangular` route is called more frequently than 5 min, some short-lived cycles will be missed by the persistence path — but the live route still serves them from pipeline_cache.
- **Performance note (NEW Known Characteristic, not a bug):** the compute runs `find_triangular_arbitrage` (~30-60s with 600+ currencies, 90s timeout) inside `_refresh()` — this DOUBLES the compute cost (one in _refresh, one in the live `/triangular` route's first-request cache). If this becomes a bottleneck, future iter can refactor to populate `pipeline_cache` from `_refresh()` so the live route reads pre-computed results (eliminates the doubled cost). Documented in STATUS.md TD-3 backlog entry.
- **What was NOT done (intentionally deferred to iter 130+):**
  - **TD-5 Phase 4** (`daily_stats` table + backfill script + scheduler + route) — ~250 lines + script, medium-high risk, one-shot backfill op. Now unblocked — TD-3 Phase 3 patterns proven. Design doc §9 Phase 4 + §5.2 (lazy fetch + cache strategy) + §6.3 (backfill via POE2Scout DayCount=90, 1 req/sec, ~17 min for 1000 items).
  - **P10 Phase 2** (trend chart) — now unblocked. Can consume `/api/v1/arbitrage/triangular/history` to render historical cycle profitability trend.
  - **TD-9 fallback removal** — `deriveTrendSparklineData` should be removed iter 130+ once production logs confirm no fallback path is hit for 2 iters (design doc §10 Q5).
  - **TD-3 pipeline_cache optimization** — eliminate the doubled compute cost by populating `pipeline_cache` from `_refresh()` (see Performance note above).
- **Stopping point:** iter 129 = TD-3 Phase 3 SHIPPED, all baselines preserved or improved (1376 pytest green, 0 regressions). Next iter (iter 130) candidates in priority order: (a) **TD-5 Phase 4** (highest risk of the remaining persistence phases — daily_stats table + one-shot backfill script + scheduler task + new endpoint, ~250 lines + script, but TD-3 Phase 3 template now proven); (b) **P10 Phase 2** (trend chart — frontend work, consumes the new `/api/v1/arbitrage/triangular/history` route); (c) **TD-3 pipeline_cache optimization** (eliminate doubled compute cost). Recommended: ship (a) alone in iter 130 (closes the last persistence gap), then (b) + (c) in iter 131+.

---

Task ID: iter-128
Agent: main
Task: iter 128 — TD-4 Phase 2. Per iter 127's stopping-point brief: ship TD-4 Phase 2 alone (establishes the persistence pattern for TD-3 Phase 3 + TD-5 Phase 4). Scope = `market_spreads` SQLite table + `compute_market_spreads()` pure helper + best-effort write in `SnapshotManager._refresh()` + `GET /api/v1/market-spreads/history` read-only route. ~150 lines, medium risk, no migration (ADD TABLE only). Design doc: `docs/design/TD-3-4-5-9-persistence-gaps-design.md` §4 (schema), §5.1 (write path), §9 Phase 2 (file-by-file plan), §10 Q1/Q2 (open questions).

Work Log:
- Cloned repo. Read `STATUS.md` (iter 127 SHIPPED — TD-9 Phase 1 + P10 Phase 1 MVP, 1274 pytest green), `worklog.md` (iter 126 + iter 127), `docs/design/TD-3-4-5-9-persistence-gaps-design.md` (full — §3 Option B recommended, §4 schema with `market_spreads` table + 3 indexes + dedup on `strftime('%Y-%m-%d %H:%M', timestamp), league, pair_key`, §5.1 write path invariant "persistence MUST NOT block snapshot publish", §6.2 no backfill for spreads, §7 retention = 90 days, §8.1 ADD TABLE only (no ALTER), §9 Phase 2 = ~150 lines, §10 Q2 default = persist only direct pairs BFS factor = 1.0).
- Read source files for context: `backend/data/historical.py`, `backend/api/routes_arbitrage.py:268-308` (the inline spread computation to mirror), `backend/api/data_snapshot.py:SnapshotManager._refresh`, `backend/economy/mirror_divine_arb.py`, `backend/api/routes_mirror_divine_arb.py`, `backend/api/response_models.py:MirrorDivineArbResponse`, `backend/economy/momentum.py:PriceMomentumTracker`, `backend/config.py:SpreadModelConfig`, `backend/models/currency.py:ExchangeRate`, `backend/main.py`.
- **TD-4 Phase 2 implementation — `backend/data/historical.py`:** Added `market_spreads` table + 3 indexes; added `write_market_spreads_batch()` + `read_market_spreads()` + `read_market_spreads_pairs()` methods; extended `_prune_old_records` + `_prune_old_league_data`.
- **TD-4 Phase 2 implementation — `backend/economy/market_spreads.py` (NEW, ~210 lines):** Pure function `compute_market_spreads(snapshot, config) -> list[dict]`. Mirrors `routes_arbitrage.py:274-308` spread formula. Helpers `_compute_liquidity_spread` + `_compute_momentum_factor`.
- **TD-4 Phase 2 implementation — `backend/api/data_snapshot.py:SnapshotManager._refresh`:** Added best-effort try/except block (lines 617-642) after tier classification, before `return snapshot`. Calls `compute_market_spreads` → if non-empty, `store.write_market_spreads_batch`. Failure logged as warning, non-fatal.
- **TD-4 Phase 2 implementation — `backend/api/response_models.py`:** Added `MarketSpreadPoint` + `MarketSpreadsHistoryResponse` pydantic models.
- **TD-4 Phase 2 implementation — `backend/api/routes_market_spreads.py` (NEW, ~125 lines):** `GET /api/v1/market-spreads/history` route. Thin wrapper around `HistoricalStore.read_market_spreads`. Returns 200 with `data_available=false` on empty/error.
- **TD-4 Phase 2 implementation — `backend/main.py`:** Added try/except import + `app.include_router(market_spreads_router)` (lines 696-706).
- **Test suite — `tests/test_market_spreads.py` (NEW, 30 tests):** 4 sections — pure-helper shape/formula/parity/error, persistence roundtrip/dedup/filter/league/order, SnapshotManager integration, E2E.
- **Test suite — `tests/test_market_spreads_route.py` (NEW, 10 tests):** 4 sections — empty, with-rows, validation, degraded.
- **Documentation updates:** `STATUS.md` (iter 128 header, TD-4/Phase-2 closed-issue, TD-3/TD-4/TD-5 backlog updates, new Quick Reference row, new "Key technical insights" paragraph for three-layer pattern). `AGENT_NAVIGATION.md` (4 new module-map entries).

Stage Summary:
- **iter 128 SHIPPED — TD-4 Phase 2 complete.** `market_spreads` SQLite table + `compute_market_spreads()` pure helper + best-effort write in `SnapshotManager._refresh()` + `GET /api/v1/market-spreads/history` read-only route. Establishes the three-layer persistence pattern (pure helper + best-effort write + read-only route) that TD-3 Phase 3 + TD-5 Phase 4 can copy without re-deriving the plumbing.
- **Test counts:** pytest 1327 green (1287 baseline + 40 new), 0 regressions. Jest/tsc/lint: not run (node_modules not present in env) — no frontend files touched.
- **Stopping point:** iter 128 = TD-4 Phase 2 SHIPPED. Next iter (iter 129) recommendation: ship TD-3 Phase 3 alone (proves the template generalizes).
