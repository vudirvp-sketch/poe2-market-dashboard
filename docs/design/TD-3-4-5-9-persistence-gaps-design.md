# Design Doc — TD-3 / TD-4 / TD-5 / TD-9 Persistence Gaps

> **Status:** ALL PHASES SHIPPED. Phase 1 (TD-9) iter 127. Phase 2 (TD-4) iter 128. Phase 3 (TD-3) iter 129. Phase 4 (TD-5) iter 131.
> **Owner:** main agent. **Reviewed:** iter 127 implementation agent (Phase 1).
> **Scope:** architectural analysis of four related persistence gaps.

---

## 1. Problem statement

Four P3 technical-debt items share the same root cause — *computed metrics
are not persisted, so they cannot be backtested or trended*:

| ID  | Symptom (today)                                                                                                          | Where the symptom lives                                |
|-----|--------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------|
| TD-3 | Triangular arbitrage `executable_estimate` is computed per request and discarded — cannot backtest profit per cycle over time | `backend/arbitrage/triangular.py` + `routes_arbitrage.py` `/triangular` |
| TD-4 | `market_spread` (computed from volume + volatility, see §7 of `PoE2_Flipper_Canonical_Formulas.md`) is not persisted      | `routes_arbitrage.py:259-269` + `triangular.py:287`    |
| TD-5 | POE2Scout `DailyStatsHistory` endpoint (daily OHLCV per item) is implemented in `Poe2ScoutProvider.get_daily_stats()` but never called by `DataSnapshot` | `backend/data/providers/poe2scout.py:735-761`         |
| TD-9 | FlipsTable "Trend" sparkline is synthetic — derived from `momentum × volatility` — instead of real short price history      | `src/components/dashboard/flips-helpers.ts:131` `deriveTrendSparklineData` |

Closing any one of them in isolation risks: (a) re-implementing the same
persistence layer four times, (b) divergent schema choices that block a
future unified backtest, (c) SQLite write-amplification on the hot
`price_snapshots` table. This doc proposes **one** coherent persistence
extension that closes all four.

---

## 2. What DataSnapshot already collects vs. what's missing

`backend/api/data_snapshot.py:DataSnapshot` (atomic `_SnapshotState`,
refreshed every 5 min) already exposes:

| Field                         | Source                                            | Used by TD-*        |
|-------------------------------|---------------------------------------------------|---------------------|
| `exchange_rates: dict[str, ExchangeRate]` | `provider.get_exchange_rates(league)` — SnapshotPairs (~46 pairs) | TD-3, TD-4 (raw input) |
| `currencies: dict[str, dict]`  | `provider.get_all_currencies_with_prices(league)` — ByCategory (~15 calls) | TD-4 (volume) |
| `price_histories: dict[str, list[PricePoint]]` | ByCategory `price_logs` + per-currency fallback for missing-from-ByCategory SnapshotPairs currencies | TD-9 (already sufficient!) |
| `current_prices: dict[str, float]` | ByCategory `current_price`                  | TD-3, TD-4 |
| `prices_in_base: dict[str, float]` | `compute_transitive_prices()` BFS              | TD-3 input |
| `tiers: dict[str, CurrencyTier]` | `backend.economy.tiers.classify_currencies`     | (not used by TD-* directly) |

### What's already there but not surfaced to /flips

`price_histories` is already populated for every active currency in
`DataSnapshot`. The `speculation.py`, `circuit_patterns.py`, and
`mirror_divine_arb.py` modules each slice the last 14 points into a
`price_history_short` field. **TD-9 only needs the `/flips` route to do the
same slice — no new persistence is required.** This is the cheapest fix and
should be the first one shipped (Section 6.1).

### What's missing entirely

| Missing data                                 | Why we need it                                                                 | Source if added |
|----------------------------------------------|--------------------------------------------------------------------------------|-----------------|
| Per-cycle triangular arbitrage opportunities over time | TD-3 backtest needs historical "this cycle was profitable on day X" records | Computed by `find_triangular_arbitrage()` per snapshot |
| `market_spread` per pair per snapshot        | TD-4 backtest needs spread time-series to model slippage                       | Already computed in `routes_arbitrage.py` line 259-269 — just not stored |
| Daily OHLCV per item                          | TD-5 — `DailyStatsHistory` returns canonical daily candles that are more accurate than the 5-min `price_snapshots` aggregation | POE2Scout `/{Realm}/Leagues/{LeagueName}/Items/{ItemId}/DailyStatsHistory` — already implemented in `provider.get_daily_stats()` |

**Insight:** TD-3 and TD-4 are "store what we already compute". TD-5 is
"fetch what we already have a provider method for". TD-9 is "slice what's
already in the snapshot for a different endpoint". **None of them require
new network code** — only persistence + wiring.

---

## 3. Schema options

Three options were considered. The recommendation is **Option B
(new tables in the existing `historical.db`)**.

### Option A — Extend `price_snapshots` table with new columns

Add `market_spread REAL`, `triangular_cycles TEXT` (JSON), `daily_ohlcv TEXT` (JSON) to the existing `price_snapshots` table.

**Pros:** Single table, single index, no JOIN needed.
**Cons:**
- `price_snapshots` is the hot write path (every 5 min, ~46 rows per league). Adding JSON blobs inflates row size ~10×, slowing the chunked prune in `_prune_old_records`.
- TD-3 cycles and TD-5 OHLCV have **different cadences** than price snapshots (cycles: per-request, OHLCV: daily). Storing them in the same row forces either (a) NULL columns when no cycle was detected that minute, or (b) duplicate rows.
- Schema migration risk: ALTER TABLE on a multi-million-row SQLite table is `SQLITE_ENABLE_UPDATE_DELETE_LIMIT`-sensitive and locks the DB.
- Breaks the existing dedup unique index `idx_price_snapshot_dedup` (5-min bucket on `timestamp, league, currency`).

**Verdict: rejected.** Conflates three different cadences into one row.

### Option B (RECOMMENDED) — Three new tables in `historical.db`

Add three new tables alongside `price_snapshots` and `events`. Each has its
own cadence and indexes. The existing `historical.py:HistoricalStore`
class gains three new write/read methods. No changes to
`price_snapshots`.

```sql
-- TD-3: triangular arbitrage cycle snapshots
CREATE TABLE IF NOT EXISTS triangular_cycles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,            -- ISO 8601 UTC, aligned to snapshot refresh
    league TEXT NOT NULL,
    cycle_key TEXT NOT NULL,            -- "exalted->divine->mirror->exalted" (sorted join)
    cycle_currencies TEXT NOT NULL,     -- JSON array: ["exalted", "divine", "mirror"]
    raw_profit_pct REAL,                -- Bellman-Ford continuous profit
    executable_estimate INTEGER,        -- min profitable start amount (binary-search result)
    executable_profit INTEGER,          -- final amount after integer simulation
    confidence REAL,                    -- _compute_confidence() score
    snapshot_age_sec INTEGER            -- for staleness filtering
);
CREATE INDEX IF NOT EXISTS idx_tri_cycles_ts ON triangular_cycles(timestamp);
CREATE INDEX IF NOT EXISTS idx_tri_cycles_key ON triangular_cycles(cycle_key, league);
CREATE INDEX IF NOT EXISTS idx_tri_cycles_dedup
    ON triangular_cycles(strftime('%Y-%m-%d %H:%M', timestamp), league, cycle_key);

-- TD-4: market spread per pair per snapshot
CREATE TABLE IF NOT EXISTS market_spreads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    league TEXT NOT NULL,
    pair_key TEXT NOT NULL,             -- "exalted/divine" (currency_from/currency_to)
    currency_from TEXT NOT NULL,
    currency_to TEXT NOT NULL,
    raw_rate REAL,
    volume_24h REAL,
    market_spread REAL,                 -- computed: max(0.01, min(0.15, volume_spread + vol_spread))
    total_spread REAL,                  -- market_spread × (1 + momentum_factor)
    momentum_factor REAL,
    bfs_widening_factor REAL            -- 1.0 for direct pairs, >1.0 for BFS-derived
);
CREATE INDEX IF NOT EXISTS idx_market_spreads_ts ON market_spreads(timestamp);
CREATE INDEX IF NOT EXISTS idx_market_spreads_pair ON market_spreads(pair_key, league);
CREATE INDEX IF NOT EXISTS idx_market_spreads_dedup
    ON market_spreads(strftime('%Y-%m-%d %H:%M', timestamp), league, pair_key);

-- TD-5: daily OHLCV per item (cached from POE2Scout DailyStatsHistory)
CREATE TABLE IF NOT EXISTS daily_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,                 -- YYYY-MM-DD (UTC, per POE2Scout convention)
    league TEXT NOT NULL,
    item_id INTEGER NOT NULL,           -- POE2Scout numeric ItemId (matches ByCategory)
    api_id TEXT,                        -- lowercase api_id for cross-joining with price_snapshots
    open REAL,
    high REAL,
    low REAL,
    close REAL,
    average REAL,
    volume REAL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_stats_dedup
    ON daily_stats(date, league, item_id);
CREATE INDEX IF NOT EXISTS idx_daily_stats_item ON daily_stats(item_id, league, date);
CREATE INDEX IF NOT EXISTS idx_daily_stats_api_id ON daily_stats(api_id, league, date);
```

**Pros:**
- Each table has its own natural cadence (cycles: ~5 min, spreads: ~5 min, OHLCV: daily).
- Write paths are independent — a failure in `triangular_cycles` write doesn't block the price snapshot write.
- No migration of existing `price_snapshots` data — only ADD TABLE.
- Existing chunked-prune pattern (`rowid IN (SELECT ... LIMIT ?)`) extends trivially to each new table.
- TD-3 backtest becomes: `SELECT * FROM triangular_cycles WHERE cycle_key = ? AND league = ? AND timestamp >= ? ORDER BY timestamp ASC`.

**Cons:**
- Three new write paths must be wired into the snapshot refresh flow (Section 5).
- `HistoricalStore` class grows ~150 lines (3 tables × ~50 lines/method).
- Disk usage grows: estimate ~50 KB/cycle-day × 5 cycles/snapshot × 288 snapshots/day ≈ 70 MB/league/90-day-window. Spread table: similar. OHLCV: ~5 KB/item × 1000 items × 90 days ≈ 450 MB/league — **need retention strategy** (Section 7).

**Verdict: recommended.** Cleanest separation of concerns, lowest migration risk.

### Option C — Separate SQLite database (`analytics.db`)

New `backend/data/analytics_historical.py:AnalyticsHistoricalStore` with its own `analytics.db` file.

**Pros:** Zero risk to existing `historical.db` — no shared lock, no shared migration.
**Cons:**
- Two databases to back up, two singleton lifecycles to manage, two retention prune jobs.
- Cross-database JOINs impossible (SQLite ATTACH is fragile across OS/network FS).
- The existing `_prune_old_league_data` pattern needs duplication.
- Adds complexity with no real benefit — `historical.db` is already async via `aiosqlite` and uses chunked deletes, so contention isn't a real problem.

**Verdict: rejected.** Adds operational complexity without solving a real problem.

---

## 4. Recommended schema (final, for implementation iter 127+)

See Option B above. Concrete decisions:

1. **Cadence alignment:** Triangular cycles + market spreads write **once per successful `DataSnapshot` refresh** (every 5 min, in the same `SnapshotManager._refresh()` flow, after the snapshot is built). Daily stats write **once per day per item**, fetched lazily (Section 5).

2. **Dedup keys:** Use the same `strftime('%Y-%m-%d %H:%M', timestamp)` 5-minute bucket pattern as `price_snapshots`. Cycles and spreads use `INSERT OR IGNORE` — if a refresh runs twice in the same minute, the second write is silently dropped. Daily stats use `INSERT OR REPLACE` because the source endpoint may revise a day's candle.

3. **`cycle_key` format:** Sorted JSON array joined with `->`. Example: `divine->exalted->mirror` (alphabetical sort). This makes the same cycle in different rotations (A→B→C vs A→C→B) collapse to the same key — important for backtest grouping.

4. **`pair_key` format:** `${currency_from}/${currency_to}` — same order as `ExchangeRate` keys. NOT sorted — the spread is directional (A/B spread ≠ B/A spread because of BFS widening).

5. **OHLCV `api_id` population:** The `DailyStatsHistory` endpoint takes an `item_id` (numeric), not an `api_id`. The write path must look up `item_id → api_id` from `DataSnapshot.currency_metadata` (which has `item_id` field) and populate `api_id` for cross-joining with `price_snapshots`.

---

## 5. Write path integration

### 5.1 Triangular cycles + market spreads (TD-3, TD-4)

Both write inside `SnapshotManager._refresh()` after the snapshot is built, **before** publishing `_state`. Pseudocode:

```python
# In SnapshotManager._refresh(), after snapshot.valid = True:

# 5-min tick: store cycles + spreads for backtest
try:
    store = get_historical_store()
    await store.write_triangular_cycles(
        league=league,
        timestamp=snapshot.fetched_at,
        cycles=computed_cycles,  # list of dicts from find_triangular_arbitrage()
    )
    await store.write_market_spreads(
        league=league,
        timestamp=snapshot.fetched_at,
        spreads=computed_spreads,  # list of dicts from _compute_spread_per_pair()
    )
except Exception as e:
    logger.warning("Persist cycles/spreads failed (non-fatal): %s", e)
    # Don't fail the snapshot refresh — persistence is best-effort.
```

**Critical invariant:** the persistence write MUST NOT block the snapshot
publish. If SQLite is slow or locked, the snapshot is still published
fresh; the historical write is dropped for that tick (next tick will catch
up via `INSERT OR IGNORE` dedup).

### 5.2 Daily OHLCV (TD-5)

Daily OHLCV is **not** on the 5-min snapshot path — it's daily, and it's
expensive (one HTTP call per item). Strategy:

1. **Lazy fetch + cache.** When a route needs OHLCV for an item (e.g. a
   future candlestick route), check `daily_stats` table first. If the
   latest row for that `(item_id, league)` is from today (or yesterday if
   the POE2Scout daily candle hasn't been published yet), serve from
   SQLite. Otherwise, fetch from POE2Scout and persist.

2. **Background refresh job.** A new scheduler task
   (`backend/scheduler.py:_refresh_daily_stats_loop`) runs once per hour,
   picks the top-N most-traded items (by `volume_24h` from the latest
   snapshot), and refreshes their daily OHLCV. N configurable, default 50.

3. **API surface.** New endpoint `GET /api/v1/items/{item_id}/daily-stats?day_count=30`.
   Mirrors the existing `get_daily_stats` provider call but reads from
   SQLite first. Falls back to provider on miss.

**Avoid:** calling `get_daily_stats` for every item on every snapshot
refresh — that's ~1000 HTTP calls per 5-min tick, 200× the current rate.

### 5.3 FlipsTable sparkline (TD-9)

**No persistence change.** The `/flips` route already receives
`DataSnapshot` with full `price_histories`. TD-9 fix:

1. In `routes_arbitrage.py:_build_flips_response`, for each opportunity,
   slice `snapshot.price_histories[opp.api_id][-14:]` into a
   `price_history_short` field (same shape as `speculation.py:214`).
2. Add `price_history_short: list[SpeculationPriceHistoryPoint]` to the
   `FlipOpportunity` pydantic model in `response_models.py`.
3. Add `priceHistoryShort: { date: string; price: number }[]` to the TS
   `FlipOpportunity` type.
4. In `flips-table.tsx:448`, replace
   `deriveTrendSparklineData(opp.momentum, opp.volatility)` with
   `opp.priceHistoryShort.map(p => p.price)`.
5. **Keep `deriveTrendSparklineData` as a fallback** for opportunities
   where `priceHistoryShort` is empty (less than 2 points). The function
   already exists and is well-tested.
6. Remove the "derived indicator, not historical" tooltip once the
   fallback is the only path that uses it.

---

## 6. Backfill strategy

### 6.1 Triangular cycles (TD-3) — NO BACKFILL

Cannot backtest cycles before persistence existed — the snapshots are gone.
Accept that TD-3 backtest starts from the first persisted tick (iter 127+
onward). Document this in the route's `data_available` flag.

### 6.2 Market spreads (TD-4) — NO BACKFILL

Same reason — spreads depend on the momentary `volume_24h` and
`momentum_factor`, which aren't in `price_snapshots`. Accept empty
backtest window for spreads before iter 127+.

### 6.3 Daily OHLCV (TD-5) — BACKFILL VIA POE2SCOUT

The `DailyStatsHistory` endpoint accepts `DayCount` (up to 90) and
`EndDate`. Strategy:

1. **One-shot backfill script** `scripts/backfill_daily_stats.py` — for
   each item in `currency_metadata`, call
   `provider.get_daily_stats(league, item_id, day_count=90)`. Persist all
   returned rows. Rate-limit: 1 request/sec (matches POE2Scout polite
   policy). Estimated runtime: ~17 min for 1000 items.
2. **Idempotent:** `INSERT OR REPLACE` with the dedup index means reruns
   are safe.
3. **Run manually** after the iter 127 implementation ships — not on a
   scheduler. Documented in `STATUS.md` "Quick Reference" as a one-time
   op.

### 6.4 FlipsTable sparkline (TD-9) — NO BACKFILL NEEDED

Real-time only — sparkline shows the last 14 points of the *current*
`DataSnapshot`. No historical data needed.

---

## 7. Retention strategy

| Table              | Default retention                          | Prune mechanism                                  |
|--------------------|--------------------------------------------|--------------------------------------------------|
| `triangular_cycles` | 90 days (matches `historical_retention_days`) | Extend `_prune_old_records` with a third chunked-delete loop |
| `market_spreads`    | 90 days                                    | Same                                             |
| `daily_stats`       | 365 days (longer — daily candles are smaller and more valuable for long-term backtest) | New `_prune_old_daily_stats` method, same chunked pattern |

**Disk budget sanity check** (90-day window, 1 league, 46 active pairs, 5 cycles/snapshot avg):

- `triangular_cycles`: 288 snapshots/day × 5 cycles × 90 days × ~200 bytes/row ≈ 26 MB
- `market_spreads`: 288 × 46 pairs × 90 × ~150 bytes ≈ 180 MB
- `daily_stats`: 1000 items × 365 days × ~80 bytes ≈ 29 MB (with the longer retention)

Total: ~235 MB. Acceptable for a single SQLite file. If `market_spreads`
grows beyond 500 MB, consider adding a `pair_key` partition or shortening
retention to 30 days.

---

## 8. Migration risk

### 8.1 Risk: existing `historical.db` corruption

**Mitigation:** All changes are ADD TABLE — no ALTER, no DROP. Existing
tables and indexes are untouched. The `_CREATE_TABLES_SQL` constant grows
by three `CREATE TABLE IF NOT EXISTS` blocks. The `init()` flow runs the
same `executescript` it always has — for existing DBs, the IF NOT EXISTS
makes the new tables a no-op on subsequent startups.

### 8.2 Risk: write contention on the hot snapshot path

**Mitigation:**
- `aiosqlite` serializes writes on a single connection — there's no
  concurrent write risk. The new writes happen AFTER the snapshot is
  built, so they don't delay the snapshot publish.
- All three new write methods use `INSERT OR IGNORE` (cycles + spreads)
  or `INSERT OR REPLACE` (daily_stats) — no read-modify-write cycles.
- Best-effort: a write failure logs a warning and continues. The next
  snapshot tick will retry.

### 8.3 Risk: POE2Scout rate-limit on backfill

**Mitigation:** `scripts/backfill_daily_stats.py` uses an explicit
`time.sleep(1.0)` between calls. 1000 items = 17 minutes. If the provider
returns 429, the existing `Poe2ScoutProvider._request` already has retry
logic with exponential backoff (see `backend/data/providers/base.py`).

### 8.4 Risk: `cycle_key` collision

Two different Bellman-Ford outputs could produce the same sorted cycle key
if they share the same currencies in a different rotation. **This is
intentional** — for backtest purposes, A→B→C→A and A→C→B→A are the same
arbitrage opportunity, just executed in reverse. If the profit differs by
rotation, store both as separate rows with the same `cycle_key` but
different `cycle_currencies` JSON (preserves rotation order for analysis).

### 8.5 Risk: TD-9 schema divergence

The pydantic `FlipOpportunity` model would gain a new required field
`price_history_short`. Existing clients would break.

**Mitigation:** Make the field `Optional` with `default_factory=list`
(matches `SpeculationPriceHistoryPoint` convention). Old clients ignore
the new field. Frontend fallback to `deriveTrendSparklineData` handles
empty arrays.

### 8.6 Risk: backfill script runs against the wrong league

**Mitigation:** `scripts/backfill_daily_stats.py` reads league from
`config.yaml:league.league_name` (same source as `_prune_old_league_data`).
Add a `--dry-run` flag that prints the league + item count without writing.
Add a `--league` override flag for one-off backfills of a specific league.

---

## 9. Implementation phasing (suggested for iter 127+)

Each phase is independently shippable. Stop after any phase if a regression
appears.

### Phase 1 (cheapest, no persistence) — TD-9 only
- Wire `price_history_short` from `snapshot.price_histories` into `/flips`
  response.
- Update pydantic model + TS type.
- Switch FlipsTable sparkline to real data with fallback.
- Estimated diff: ~50 lines across 4 files.
- Risk: very low — additive field, fallback preserved.
- Tests: extend `tests/test_flips_integration.py` with a case asserting
  `price_history_short` is populated when snapshot has price history.

### Phase 2 — TD-4 market_spreads table
- Add `market_spreads` table to `historical.py:_CREATE_TABLES_SQL`.
- Add `HistoricalStore.write_market_spreads_batch()`.
- Wire into `SnapshotManager._refresh()` as best-effort post-publish write.
- Add `GET /api/v1/market-spreads/history?pair=exalted/divine&days=30`
  endpoint (read-only).
- Estimated diff: ~150 lines.
- Risk: low — new table, new endpoint, no changes to existing routes.

### Phase 3 — TD-3 triangular_cycles table
- Add `triangular_cycles` table.
- Add `HistoricalStore.write_triangular_cycles_batch()`.
- Wire into `SnapshotManager._refresh()` after the `find_triangular_arbitrage`
  call.
- Add `GET /api/v1/arbitrage/triangular/history?cycle_key=...&days=30`
  endpoint.
- Estimated diff: ~180 lines.
- Risk: medium — depends on Phase 2 patterns being established.

### Phase 4 — TD-5 daily_stats table + backfill
- Add `daily_stats` table.
- Add `HistoricalStore.write_daily_stats_batch()` + `read_daily_stats()`.
- Add `scripts/backfill_daily_stats.py` + run once.
- Add scheduler task `_refresh_daily_stats_loop`.
- Add `GET /api/v1/items/{item_id}/daily-stats?day_count=30` endpoint.
- Estimated diff: ~250 lines + script.
- Risk: medium — new background task, new HTTP path, one-shot backfill op.

---

## 10. Open questions (defer to iter 127 implementation agent)

1. **Should `triangular_cycles` persist `None`-profit cycles?** Currently
   `find_triangular_arbitrage` filters out cycles below `min_profit_pct`.
   Persisting the failures too would let a backtest compute hit-rate.
   *Default: persist only profitable cycles (matches current filter).*

2. **Should `market_spreads` cover BFS-derived pairs?** BFS widening
   produces pairs that don't exist in `SnapshotPairs`. The spread formula
   multiplies by `bfs_widening_factor`. Persisting these would inflate the
   table 5-10×. *Default: persist only direct pairs (BFS factor = 1.0).*

3. **Should `daily_stats` use `item_id` or `api_id` as the primary
   join key?** `item_id` is what POE2Scout returns; `api_id` is what the
   rest of the codebase uses. *Default: persist both, index both, prefer
   `api_id` for cross-table joins.*

4. **Does the existing `idx_price_snapshot_dedup` 5-min bucket match
   POE2Scout's snapshot cadence?** If POE2Scout updates faster than 5 min,
   we're losing data. *Needs investigation during Phase 2 implementation.*

5. **TD-9 fallback removal timing.** When can `deriveTrendSparklineData`
   be removed? *Default: keep for 2 iters after TD-9 ships (iter 129+),
   then remove if no fallback path is hit in production logs.*
   **RESOLVED iter 135:** `deriveTrendSparklineData` removed. The
   `getTrendSparklineData` helper now returns `[]` when no real history
   exists (≥ 2 points required), and the `Sparkline` component renders
   an em-dash placeholder (`—`) for empty arrays. The `TrendSparklineInput`
   interface dropped its `momentum` / `volatility` fields. Six iters of
   production exposure (iter 127→134) without a logged fallback hit
   established sufficient confidence to remove the synthetic path.

---

## 11. References

- `STATUS.md` "Technical-debt backlog" — TD-3, TD-4, TD-5, TD-9 entries.
- `backend/data/historical.py` — existing `HistoricalStore` (590 lines,
  the file this design extends).
- `backend/api/data_snapshot.py:SnapshotManager._refresh()` — the
  integration point for cycles + spreads writes.
- `backend/data/providers/poe2scout.py:get_daily_stats()` (line 735) —
  the existing provider method for TD-5.
- `backend/economy/speculation.py:214` — canonical `price_history_short`
  slice pattern (TD-9 will mirror this).
- `src/components/dashboard/flips-helpers.ts` — `getTrendSparklineData`
  (TD-9 sparkline helper). **Note:** the synthetic `deriveTrendSparklineData`
  fallback was REMOVED iter 135 — see §10 Q5 below for resolution.
- `PoE2_Flipper_Canonical_Formulas.md` §7 — `market_spread` formula
  definition.
- `PoE2_Flipper_Canonical_Formulas.md` §8 — triangular arbitrage
  Bellman-Ford algorithm (the source of `executable_estimate`).
- `docs/MARKET_PLAYBOOK.md` §C.8 — Gold Map ROI (separate design-doc
  covers this — `docs/design/P10-gold-map-roi-design.md`).
