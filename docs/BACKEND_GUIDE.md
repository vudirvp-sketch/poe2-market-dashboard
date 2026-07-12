# PoE2 Market Dashboard — Backend Guide

> **Version:** 1.2 | **Date:** 2026-07-13 (iter 143 — doc-drift re-audit: §1 Poe2Scout provider method signatures (4 wrong → 4 correct), §2 /api/health → /api/v1/health, §5 PipelineCache/DailyStatsCache locations (deleted shim files in iter 66 — facades live in unified_cache.py), §6.2 triangular cross-rate threshold 10% → 7%, §7 E2E tests list 4 → 6 files)

---

## 1. Provider Architecture

### Poe2ScoutProvider (Primary)

**Location:** `backend/data/providers/poe2scout.py`

- Uses `httpx.AsyncClient` with connection pooling
- Semaphore limits concurrent requests to 5
- `rate_limit_lock` (asyncio.Lock) serializes rate-limit calculations to prevent race conditions on `_last_request_time`
- 2 retries on HTTP 429 (rate limit) with exponential backoff
- CORS proxy fallback: if primary URL fails, retries through `cors_proxy_url` (from `config.yaml` or `POE2SCOUT_CORS_PROXY_URL` env var)
- All API calls use league name as path parameter (ShortName format, e.g., "runes")

**Key methods** (verified iter 143 against `backend/data/providers/poe2scout.py`):
- `get_exchange_rates(league)` → `dict[str, ExchangeRate]` — all trading pairs (1 request to `/SnapshotPairs`)
- `get_currency_metadata(league)` → `list[CurrencyInfo]` — currency metadata (cached 1h on the provider instance)
- `get_all_currencies_with_prices(league)` → `list[dict]` — paginated `ByCategory` call across all configured categories; returns raw dicts with `api_id`, `text`, `category_api_id`, `icon_url`, `current_price`, `price_logs`, etc.
- `get_historical_prices(currency, days)` → `list[PricePoint]` — single-currency price history (fallback for currencies missing from `ByCategory`)
- `get_bulk_price_histories(league)` → `dict[int, list[PricePoint]]` — bulk variant by `ItemId`
- `get_daily_stats(league, item_id, day_count, end_date)` → `dict | None` — daily OHLCV (TD-5 iter 131)
- `get_realms()` / `get_leagues()` / `get_reference_currencies(league)` / `get_snapshot_history(...)` / `get_pair_history(...)` — auxiliary selectors used by the Next.js proxy routes

> The abstract `BaseDataProvider` interface (in `backend/data/providers/base.py`) requires only `get_current_price`, `get_historical_prices`, `get_exchange_rates`, `get_currency_metadata`, and `name()`. The other methods above are Poe2Scout-specific extensions.

### OfficialTradeProvider (Fallback)

**Location:** `backend/data/providers/official.py`

- OAuth2-based provider for GGG's official trade API
- Rarely used — requires `GGG_CLIENT_ID` and `GGG_CLIENT_SECRET` env vars
- League mapping: `_poe2scout_to_ggg_league` dict (e.g., `"runes": "Runes of Aldur"`)

### Base Provider Interface

**Location:** `backend/data/providers/base.py`

Abstract `DataProvider` class that all providers implement. Ensures consistent interface regardless of data source.

## 2. SnapshotManager Lifecycle

**Location:** `backend/api/data_snapshot.py`

The `SnapshotManager` is the central data orchestrator. It maintains a TTL-cached `DataSnapshot` that is refreshed periodically.

```
Startup:
  1. SnapshotManager created with config
  2. start_periodic_refresh() called as background task
  3. First refresh fetches from Poe2ScoutProvider
  4. DataSnapshot built with rates, currencies, price_histories
  5. BFS transitive pricing computed for currencies without direct pairs

Periodic Refresh:
  - Every cache_ttl_prices_minutes (default: 5 min)
  - Non-blocking: old snapshot served while new one fetches
  - On failure: existing snapshot remains (stale but usable)

Health Info:
  - snapshot_valid, snapshot_stale, snapshot_age_seconds
  - exchange_rates_count, currencies_count, price_histories_count
  - snapshot_ttl_seconds, fetched_at
  - Exposed via /api/v1/health endpoint (and /api/v1/health/ping for the lightweight bridge check)
```

**BFS Transitive Pricing:**

When a currency has no direct trading pair with the base currency (exalted), the SnapshotManager computes its mid_price via breadth-first search through the graph of existing pairs. This ensures every currency has a price relative to the base, enabling scoring and analytics for all currencies.

## 3. HistoricalStore (SQLite)

**Location:** `backend/data/historical.py`

SQLite database (`historical.db`) for persistent time-series storage.

**Tables** (5 — verified iter 140 against `backend/data/historical.py`):
- `price_snapshots` — periodic full snapshot archive (scheduler)
- `events` — persisted event flags (dual-write with EventManager)
- `market_spreads` — TD-4 Phase 2 (iter 128) — per-snapshot spread metrics
- `triangular_cycles` — TD-3 Phase 3 (iter 129) — per-snapshot triangular arbitrage cycles
- `daily_stats` — TD-5 Phase 4 (iter 131) — per-item daily OHLCV (lazy-fetch + hourly scheduler refresh)

**Key methods:**
- `init()` — Create tables if not exist (with 10s timeout for startup resilience)
- `write_price_snapshot(...)` / `write_price_snapshots_batch(...)` — append snapshot rows
- `get_price_history(currency, hours)` / `get_latest_prices(...)` — read historical prices
- `write_event(...)` / `write_events_batch(...)` / `read_active_events(...)` / `prune_expired_events()` — events dual-write
- `write_market_spreads_batch(...)` / `read_market_spreads(...)` / `read_market_spreads_pairs(...)` — TD-4 (iter 128)
- `write_triangular_cycles_batch(...)` / `read_triangular_cycles(...)` / `read_triangular_cycles_keys(...)` — TD-3 (iter 129)
- `write_daily_stats_batch(...)` / `read_daily_stats(...)` / `read_daily_stats_items(...)` / `read_daily_stats_latest_date(...)` — TD-5 (iter 131)
- `_prune_old_league_data(league)` / `_prune_old_records(...)` — retention

**Startup behavior:** If `init()` fails or times out, the backend continues without history (degraded mode). See Fix 9 in `main.py`.

## 4. DataScheduler

**Location:** `backend/scheduler.py`

APScheduler-based background scheduler running **4 jobs** (TD-5 added job #4 in iter 131):

| Job | Interval | Purpose |
|-----|----------|---------|
| `price_snapshot` | 30 min (config: `price_snapshot_interval_minutes`) | Fetch current prices via provider + persist to SQLite |
| `event_pruning` | 15 min (config: `event_pruning_interval_minutes`) | Prune expired events from memory + SQLite |
| `model_persistence` | 30 min (config: `model_persistence_interval_minutes`) | Save LightGBM models to disk |
| `daily_stats_refresh` | 1 hour (config: `daily_stats_refresh_interval_hours`) | TD-5 (iter 131) — fetch daily OHLCV for top-N items + persist to `daily_stats` SQLite table |

**Configuration:** All intervals are defined in `config.yaml` under `scheduler:` section.

**Startup resilience:** If scheduler fails to start, the backend continues without scheduled jobs (manual API calls still work).

## 5. Cache Layers

### UnifiedCache (Phase 1.2)

**Location:** `backend/data/unified_cache.py`

Single TTL + LRU cache supporting both sync and async access patterns. All entries live in one OrderedDict (LRU-ordered) with namespace-scoped TTL and max_entries. A separate LRUDict serves as a stale fallback store.

**Namespaces:**
- `pipeline`: TTL from config (5 min default), max 64 entries
- `daily_stats`: TTL 3600s (1 hour), max 256 entries

**Key features:**
- Shared storage: PipelineCache and DailyStatsCache share one LRU store
- Namespace-scoped TTL and eviction policies
- Stale fallback: expired entries kept for degraded-mode serving
- No external dependencies (cachetools removed)

### PipelineCache (facade)

**Location:** `backend/data/unified_cache.py` — class `PipelineCache` (defined directly in this file, NOT a separate shim)

Thin facade over UnifiedCache with namespace="pipeline". Provides the same interface as the original PipelineCache:

- `get(key)` → CachedEntry | None
- `put(key, value)` → None
- `invalidate(key=None)` → None
- `stats()` → dict

> **Historical note (verified iter 143):** The standalone `backend/data/pipeline_cache.py` shim file was DELETED in iter 66 (P2-2 cleanup). All call sites now import directly from `backend.data.unified_cache` (e.g. `from backend.data.unified_cache import get_pipeline_cache`). The `PipelineCache` class definition lives inside `unified_cache.py` as a facade over the shared `UnifiedCache` singleton.

### DailyStatsCache (facade)

**Location:** `backend/data/unified_cache.py` — class `DailyStatsCache` (defined directly in this file, NOT a separate shim)

Thin facade over UnifiedCache with namespace="daily_stats". Provides the same interface as the original DailyStatsCache:

- `get_or_fetch(fetch_fn, league, item_id, days)` → DailyStatsResult
- `invalidate()` → None
- `stats()` → dict

> **Historical note (verified iter 143):** The standalone `backend/data/daily_stats_cache.py` shim file was DELETED in iter 66 (P2-2 cleanup). All call sites now import directly from `backend.data.unified_cache` (e.g. `from backend.data.unified_cache import get_daily_stats_cache`). The `DailyStatsCache` class definition lives inside `unified_cache.py`. The `_cache` property returns a `_DailyStatsCacheProxy` that supports `.clear()` for test compatibility.

### ModelStore

**Location:** `backend/predictors/model_store.py`

Persists trained LightGBM models to disk. On startup, the backend attempts to load previously saved models to avoid retraining from scratch.

**Storage path:** `models/` directory (relative to backend working directory)

## 6. Analytics Pipeline

### 6.1 Scorer

**Location:** `backend/arbitrage/scorer.py`

Scoring formula (see `PoE2_Flipper_Canonical_Formulas.md` §7 for full details):

```
score = raw_spread × fill_probability × momentum_penalty × vol_penalty × phase_multiplier × tier_penalty
```

- `raw_spread`: (ask - bid) / mid_price, no fees deducted
- `fill_probability`: Volume-based estimation of trade execution likelihood
- `momentum_penalty`: Reduces score for negative momentum
- `vol_penalty`: Reduces score for high volatility
- `phase_multiplier`: EARLY=1.2, MID=1.0, LATE=0.9 (from config)
- `tier_penalty`: Adjusts for tier distance between currencies

**Quantized Analysis (P1-1):** Integer-aware spread analysis at multiple lot sizes. Computes actual cost, revenue, and profit at each lot size, finding the minimum profitable lot and optimal lot.

### 6.2 Triangular Arbitrage

**Location:** `backend/arbitrage/triangular.py`

- Bellman-Ford algorithm for negative cycle detection
- Volume-based spread estimation for edge weights
- Cross-rate divergence filtering to remove false positives (route-facing default `cross_rate_threshold_pct=7.0` — verified iter 143 against `backend/api/routes_arbitrage.py:874` + `backend/arbitrage/triangular.py:492`. The internal `_compute_cross_rate_divergence` helper has a 5.0% default, but the route and the async `find_triangular_arbitrage` wrapper override it to 7.0%.)
- Integer simulation validation (P1-2): verifies profit at integer amounts
- **Async with executor offload (v1.30):** `find_triangular_arbitrage()` is `async def` and offloads ALL CPU-bound work (Bellman-Ford + cross-rate validation + integer simulation) to a thread via `loop.run_in_executor()`. The sync implementation lives in `_find_triangular_arbitrage_sync()`. This prevents the O(V*V*E) loop from blocking the asyncio event loop and triggering circuit breaker failures.

### 6.3 Portfolio

**Location:** `backend/arbitrage/portfolio.py`

- Risk parity (SLSQP optimization)
- Min-variance (Ledoit-Wolf shrinkage)
- Correlation matrix with Spearman rank correlation
- Correlation shock detection (threshold from config)
- Efficient frontier computation

**Correlation matrix:** Uses Spearman rank correlation. Pre-checks `np.std() == 0` to avoid scipy `ConstantInputWarning`. `min_overlap = max(2, 0.3 * min_len)` for early-league compatibility.

### 6.4 Anomaly Detection

**Location:** `backend/predictors/anomaly.py`

5-indicator ensemble:
1. Z-score with Bonferroni correction (alpha from config)
2. MACD (fast/slow/signal from config)
3. RSI (period/overbought/oversold from config)
4. STL residual threshold (MAD-based)
5. Sustained momentum detection (periods from config)

### 6.5 Time-Series Forecasting

**Location:** `backend/predictors/time_series.py`

- SARIMA (auto-detect seasonal period, or from config)
- LightGBM gradient boosting
- 24h forecast horizon with 95% confidence interval
- Retrain interval: 6 hours (configurable)

### 6.6 Storage Value

**Location:** `backend/predictors/storage_value.py`

- Projected value with risk discount and liquidity adjustment
- Hold/sell decision based on ratio vs thresholds (buy_threshold, sell_threshold from config)
- Formula: `ratio = adjusted_price / current_price`

### 6.7 Phase Detection

**Location:** `backend/economy/lifecycle.py`

- EARLY: days 0-14 inclusive (default `phase_early_days`)
- MID: days 15-42 inclusive (default `phase_mid_days`)
- LATE: days 43+
- Reset support for major patch events

**Note:** Boundaries use ≤ (inclusive). `phase_early_days` and `phase_mid_days` are configurable via `config.yaml`.

### 6.8 Event Management

**Location:** `backend/economy/events.py`

- In-memory + SQLite dual-write
- Auto-expiry based on `default_expiry_hours` (config)
- Scoring penalty propagation to affected currencies
- Major patch event detection with PhaseDetector reset
- Load from SQLite on startup, prune expired

### 6.9 Recipe Arbitrage (REMOVED in iter 87)

The `backend/arbitrage/recipe.py` module and the `RecipeOpportunity` dataclass
in `backend/models/currency.py` were deleted in iter 87 — the code had zero
production callers and no recipes were ever defined in `config.yaml`. The
associated `tests/test_recipe.py` was also removed.

### 6.10 Quick Filter

**Location:** `backend/arbitrage/quick_filter.py`

Pre-filters currency pairs by:
- Minimum 24h volume (`min_volume_24h` from config)
- Maximum volatility (`max_volatility` from config)
- Maximum spread (`max_spread` from config)

### 6.11 Optimizer

**Location:** `backend/api/routes_optimizer.py`

Dijkstra-based optimal currency conversion path finder. Given a source currency, target currency, and amount, finds the path that maximizes output by exploring the graph of all available exchange rates.

**Endpoints:**
- `GET /api/v1/optimizer/path` — Find optimal conversion path for a given currency pair and amount
- `GET /api/v1/optimizer/matrix` — Get the effective rate matrix for all currency pairs

**Algorithm:** Dijkstra shortest-path on `-log(rate)` weights. Note: when rates > 1, `-log(rate)` produces negative weights which violate Dijkstra's precondition — this can produce suboptimal paths in certain edge cases (known issue, tracked for future fix with Bellman-Ford).

### 6.12 Analyst

**Location:** `backend/api/routes_analyst.py`

League analyst summary endpoint that provides an overview of the current market state:
- Trend counts (up/down/stable)
- Anomaly highlights
- League facts (phase, tier distribution, top movers)

**Endpoint:** `GET /api/v1/analyst/summary`

**Frontend fallback:** When the backend is offline, `/api/poe2/analyst-fallback` provides a lightweight version computed entirely in Next.js using cached POE2Scout data.

### 6.13 Tier Classification

**Location:** `backend/economy/tiers.py`

Classifies currencies into tiers (T0–T5) based on configurable relative price boundaries. Tier anchors (Mirror, Divine, Exalted, Chaos) define the reference points. Used by the Flips tab for tier-distance scoring and the Tiers endpoint.

### 6.14 Benchmarks

**Location:** `backend/economy/benchmarks.py`

Computes historical benchmark statistics for individual currencies: mean, median, percentiles, and deviation from current price. Uses data from HistoricalStore. Referenced by the Benchmarks endpoint.

### 6.15 Momentum

**Location:** `backend/economy/momentum.py`

`PriceMomentumTracker` computes rolling momentum, volatility, and acceleration from price histories using the formulas in `PoE2_Flipper_Canonical_Formulas.md` §2. Used by Scorer and AnomalyDetector.

## 7. Backend Testing Guide

**Location:** `tests/`

### Unit Tests (42 files — verified iter 140)

```
tests/
├── test_anomaly.py                       — Anomaly detection indicators
├── test_benchmarks.py                    — Historical benchmark calculations
├── test_circuit_patterns.py              — F7 / P8 trajectory classification
├── test_clustering.py / test_clustering_helpers.py — KMeans currency clustering
├── test_compression.py                   — Response compression middleware
├── test_content_pulse.py                 — F3 per-category turnover
├── test_currency_names_ru.py             — F1 RU translations parity
├── test_daily_stats_history.py           — TD-5 daily stats cache + history
├── test_daily_stats_persistence.py       — TD-5 SQLite persistence
├── test_events.py                        — Event management + expiry
├── test_flips_filters.py / test_flips_integration.py — /flips filter/sort + e2e
├── test_intraday_patterns.py             — P4 time-of-day patterns
├── test_leveling_uniques.py              — P9 lifecycle widget
├── test_lifecycle.py                     — Phase detection (EARLY/MID/LATE)
├── test_liquid_chain.py                  — Liquid chain analysis
├── test_market_spreads.py / test_market_spreads_route.py — TD-4 persistence + route
├── test_mirror_divine_arb.py             — P7 Mirror/Divine arbitrage
├── test_model_store.py                   — LightGBM model persistence
├── test_momentum.py                      — Price momentum calculations
├── test_new_params.py                    — New config parameters
├── test_optimal_currency.py              — Optimal payment route
├── test_phase_hints.py                   — F6 phase-aware hints
├── test_pickle_safety.py                 — DataSnapshot pickle safety
├── test_pipeline_cache_degraded.py       — Pipeline cache in degraded mode
├── test_pricing.py                       — BFS transitive pricing + 24h-ago lookup
├── test_routes_events_invalidation.py    — Event cache invalidation
├── test_routes_optimizer.py              — Optimizer path + matrix
├── test_scheduler.py                     — APScheduler job execution (4 jobs incl. daily_stats_refresh)
├── test_scorer.py                        — Opportunity scoring
├── test_snapshot_atomic_swap.py          — SnapshotManager atomic swap
├── test_speculation.py / test_speculation_backtest.py — F5 z-score signals + backtest
├── test_storage_value.py / test_storage_value_history.py — Hold/sell + history
├── test_sync_currency_names.py           — F1 pipeline (fetch-ids / fetch-ru-by-item / diff / apply)
├── test_triangular.py                    — Bellman-Ford cycle detection
├── test_triangular_cycles.py / test_triangular_cycles_route.py — TD-3 persistence + route
└── test_weekly_patterns.py               — P5 weekday/weekend patterns
```

> **Note on test count:** The full suite is **1466 pytest green** when `aiosqlite` is installed in the venv (the 6 persistence/scheduler modules require it). Without `aiosqlite`, those 6 modules are skipped and the suite reports 1289 passed. See `STATUS.md` Quick Reference for the env-recovery row.

### E2E Tests

```
tests/e2e/
├── conftest.py           — Shared fixtures (mock provider, test client)
├── mock_provider.py      — Mock Poe2ScoutProvider for deterministic tests
├── test_api_e2e.py       — Full API endpoint integration tests
├── test_analyst.py       — /api/v1/analyst/summary integration tests
├── test_degraded_mode.py — Backend behavior when provider is unreachable
└── test_sse.py           — /api/v1/prices/stream SSE contract tests
```

### Key Fixtures

- `mock_provider` — Returns deterministic data without hitting real API
- `test_client` — FastAPI TestClient with mock provider injected
- League name in all tests: "runes" (current league ShortName)

### Running Tests

```bash
pip install -r requirements.txt
pytest tests/ -v                      # All tests
pytest tests/test_scorer.py -v        # Single module
pytest tests/e2e/ -v                  # E2E tests (requires mock provider)
```
