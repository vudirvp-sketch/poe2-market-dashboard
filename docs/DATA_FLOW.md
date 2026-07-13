# PoE2 Market Dashboard — Data Flow Reference

> **Version:** 1.4 | **Date:** 2026-07-13 (iter 149 — §9 Gold Map ROI row removed (P10 tab deleted, see STATUS.md KI-35). §6 proxy-route listing: `/api/flipper/triangular/history` row removed (only consumer was the gold-map-roi-trend-chart, deleted). Backend route `/api/v1/arbitrage/triangular/history` KEPT for TD-3 persistence.)

---

## 1. Architecture Overview (Quick)

```
Browser → Next.js (port 3000)
            ├── /api/poe2/*     → POE2Scout API (server-side fetch + cache)
            │                       ↓ on connection error
            │                       CORS Proxy (Cloudflare Worker)
            │                       ↓ on connection error
            │                       Pre-populated cache (cache-snapshot.json)
            └── /api/flipper/*  → FastAPI Backend (port 8000)
                                    → POE2Scout API + SQLite + ML Models
```

**Full architecture diagram:** See [`ARCHITECTURE.md`](./ARCHITECTURE.md) §1

---

## 2. POE2Scout API Endpoints

**Base URL:** `https://poe2scout.com/api` (configurable via `POE2_API_BASE_URL` or `config.yaml → data.poe2scout_base_url`)

| # | Endpoint | Purpose | Response Case |
|---|----------|---------|---------------|
| 1 | `/Realms` | Available realms | **snake_case** |
| 2 | `/Realms/{Realm}/Filters` | Search filters | PascalCase |
| 3 | `/Realms/{Realm}/LandingSplashInfo` | Landing splash | PascalCase |
| 4 | `/{Realm}/Leagues` | Leagues for realm | PascalCase |
| 5 | `/{Realm}/Leagues/{LeagueName}/SnapshotPairs` | All currency pairs | PascalCase |
| 6 | `/{Realm}/Leagues/{LeagueName}/SnapshotHistory` | Market snapshot history | PascalCase |
| 7 | `/{Realm}/Leagues/{LeagueName}/ReferenceCurrencies` | Reference/bridge currencies | PascalCase |
| 8 | `/{Realm}/Leagues/{LeagueName}/ExchangeSnapshot` | Exchange overview | PascalCase |
| 9 | `/{Realm}/Leagues/{LeagueName}/Items` | All items | PascalCase |
| 10 | `/{Realm}/Leagues/{LeagueName}/Items/Categories` | Item categories | PascalCase |
| 11 | `/{Realm}/Leagues/{LeagueName}/Items/{ItemId}` | Single item | PascalCase |
| 12 | `/{Realm}/Leagues/{LeagueName}/Items/{ItemId}/History` | Price history | PascalCase |
| 13 | `/{Realm}/Leagues/{LeagueName}/Items/{ItemId}/DailyStatsHistory` | OHLCV daily stats | PascalCase |
| 14 | `/{Realm}/Leagues/{LeagueName}/Items/PriceHistory` | Bulk price histories | PascalCase |
| 15 | `/{Realm}/Leagues/{LeagueName}/Currencies/ByCategory` | Currencies (paginated) | PascalCase |
| 16 | `/{Realm}/Leagues/{LeagueName}/Currencies/{ApiId}` | Single currency | PascalCase |
| 17 | `/{Realm}/Leagues/{LeagueName}/Currencies/Pairs/{CurrencyOneItemId}/{CurrencyTwoItemId}/History` | Exchange pair history | PascalCase |
| 18 | `/{Realm}/Leagues/{LeagueName}/Uniques/ByCategory` | Uniques (paginated) | PascalCase |
| 19 | `/` | Root | — |
| 20 | `/health/live` | Liveness probe | — |
| 21 | `/health/ready` | Readiness probe | — |

**Note (verified iter 144):** Endpoints #2 (`/Realms/{Realm}/Filters`), #3 (`/Realms/{Realm}/LandingSplashInfo`), and #21 (`/health/ready`) exist in the POE2Scout API spec (per Swagger at `poe2scout.com/api/swagger`) but are NOT consumed by either the frontend (`src/lib/poe2api.ts`) or the backend (`backend/data/providers/poe2scout.py`). They are listed here for completeness. Endpoint #20 (`/health/live`) is consumed by `getHealth()` in `poe2api.ts:1187`.

**Path parameters:** PascalCase in spec — `{Realm}`, `{LeagueName}`, `{ItemId}`, `{CurrencyOneItemId}`, `{CurrencyTwoItemId}`. Base URL already includes `/api`.

**API response shapes:** See [`DATA_CONTRACTS.md`](./DATA_CONTRACTS.md) §6

**Critical API bugs:**
1. **PriceLogs are REVERSE chronological** — newest first. Always sort ascending before any computation.
2. **Category=all returns EMPTY** — must fetch all categories and merge client-side.
3. **League IsCurrent works for poe2 realm** — prefer it when true, else fallback to `default_league_value` from `/Realms`.
4. **Decimal values as strings** — Volume, RelativePrice etc. may come as strings. Use `safeParseFloat()`.
5. **LogCount must be multiple of 4** — ItemHistory API returns 400 otherwise.
6. **Numeric ItemIds required** — `/Currencies/Pairs/{C1}/{C2}/History` expects integers, not ApiId strings.
7. **Timestamps are UTC** — assume UTC unless API specifies otherwise.
8. **RelativePrice "0E-8"** — scientific-notation zero. `safeParseFloat()` returns `null`.

---

## 3. Frontend Data Flows

### 3.1 Market Data (No Backend Required)

```
Browser
  → GET /api/poe2/realms
  → poe2api.ts::getRealms()
      cachedFetch(BASE_URL + "/Realms")
      map: RawRealm[] → Realm[]
        (realm_api_id → name, game_api_id → displayName,
         default_league_value → defaultLeague)
      return: Realm[]

  → GET /api/poe2/leagues?realm=poe2
  → poe2api.ts::getLeagues()
      cachedFetch(BASE_URL + "/{realm}/Leagues")
      map: RawLeague[] → League[]
        (ShortName → name, Value → displayName)
        (mark active using default_league_value)
        (extract BaseCurrencyApiId, BaseCurrencyText, DefaultCurrency)
      return: League[]

  → GET /api/poe2/exchange?realm=poe2&league=runes
  → poe2api.ts::getSnapshotPairs()
      cachedFetch(BASE_URL + "/{realm}/Leagues/{league}/SnapshotPairs")
      map: RawSnapshotPair[] → ExchangePair[] (via mapSnapshotPair)
      Enrich with 7d changes via buildCurrencyChangeMap()
      return: ExchangePair[]

  → GET /api/poe2/currencies?realm=poe2&league=runes&category=currency
  → poe2api.ts::getCurrenciesByCategory()
      If category="all": fetch all categories, merge, client-side paginate
      Else: cachedFetch(...)
      map: RawCurrencyItem → PoeItem (via mapCurrencyItem)
        (computeChangePercent, compute7dChangePercent, computeVolume24h from PriceLogs)
        (CurrentPrice / referencePrice → relativePrice)
      return: PaginatedResponse<PoeItem>

  → GET /api/poe2/uniques?realm=poe2&league=runes&category=all
  → poe2api.ts::getUniquesByCategory()
      Same category="all" merge logic as currencies
      map: RawUniqueItem → PoeItem (via mapUniqueItem)
        (Text || Name → name, Type → type)
      return: PaginatedResponse<PoeItem>

  → GET /api/poe2/items?realm=poe2&league=runes
  → poe2api.ts::getItems()
      cachedFetch(BASE_URL + "/{realm}/Leagues/{league}/Items")
      return: PoeItem[]

  → GET /api/poe2/overview?realm=poe2&league=runes
  → Combined endpoint:
      getExchangeSnapshot() → exchange data
      getSnapshotHistory() → chart data
      getReferenceCurrencies() → reference pills

  → GET /api/poe2/health
  → poe2api.ts::getHealth()
      cachedFetch(BASE_URL + "/health/live")
      return: { reachable: boolean }
```

### 3.2 Flipper Analytics (Requires FastAPI Backend)

```
Browser
  → GET /api/flipper/health
  → flipper-proxy.ts → fetch(FLIPPER_API_URL + "/api/v1/health")
  → return: FlipperHealthResponse

  → GET /api/flipper/phase
  → flipper-proxy.ts → fetch(FLIPPER_API_URL + "/api/v1/phase")
  → return: FlipperPhaseResponse { phase, daysSinceRef, league, dataAvailable }

  → GET /api/flipper/prices
  → flipper-proxy.ts → routes_prices.py
  → SnapshotManager.get_snapshot().get_prices()
  → return: PricesResponse { league, phase, rates[], baseCurrency, stale, dataAvailable }

  → GET /api/flipper/heatmap
  → flipper-proxy.ts → routes_prices.py
  → 24h price change heatmap data

  → GET /api/flipper/currencies
  → flipper-proxy.ts → routes_prices.py
  → Currency metadata from DataSnapshot

  → GET /api/flipper/tiers
  → flipper-proxy.ts → routes_prices.py
  → Tier classifications via classify_currencies()
  → return: TiersResponse { tiers[], boundaries, dataAvailable }

  → GET /api/flipper/benchmarks/{currency}
  → flipper-proxy.ts → routes_prices.py
  → Historical benchmarks via compute_benchmarks()
  → return: BenchmarksResponse { currencyApiId, currentPrice, benchmark{...}, dataAvailable }

  → GET /api/flipper/flips
  → flipper-proxy.ts → routes_arbitrage.py
  → scorer.compute_flips() + quantized analysis
  → return: FlipsResponse { league, total, opportunities[], eventStatus, fetchedAt }

  → GET /api/flipper/triangular
  → flipper-proxy.ts → routes_arbitrage.py
  → triangular.find_triangular_arbitrage() + integer simulation
  → return: TriangularResponse { league, total, opportunities[], fetchedAt }

  → GET /api/flipper/anomalies
  → flipper-proxy.ts → routes_anomalies.py
  → AnomalyDetector.detect_anomalies_batch()
  → return: AnomalyAlert[]

  → GET /api/flipper/storage-value/{currency}
  → flipper-proxy.ts → routes_storage_value.py
  → project_value() — hold/sell decision
  → return: StorageValueResponse

  → GET /api/flipper/portfolio/correlation
  → flipper-proxy.ts → routes_portfolio.py
  → Correlation matrix for all eligible currencies
  → return: { currencies[], matrix[][], dataAvailable, fetchedAt }

  → GET /api/flipper/optimizer/path
  → flipper-proxy.ts → routes_optimizer.py
  → Optimal currency conversion path (Dijkstra)
  → return: OptimizerPathResponse

  → GET /api/flipper/optimizer/matrix
  → flipper-proxy.ts → routes_optimizer.py
  → Effective rate matrix
  → return: OptimizerMatrixResponse

  → GET /api/flipper/analyst/summary
  → flipper-proxy.ts → routes_analyst.py
  → League analyst summary
  → return: AnalystSummaryResponse

  → GET /api/flipper/optimal-currency
  → flipper-proxy.ts → routes_arbitrage.py
  → Cross-currency optimal payment analysis
  → return: OptimalPaymentResult

  → GET/POST /api/flipper/events
  → flipper-proxy.ts → routes_events.py
  → EventManager CRUD (dual-write: memory + SQLite)
  → return: FlipperEventsSummary { events[], total }

  → GET/DELETE /api/flipper/events/{id}
  → flipper-proxy.ts → routes_events.py

  → POST /api/flipper/events/{id}/deactivate
  → flipper-proxy.ts → routes_events.py

  # ── Newer endpoints (iter 75–131) — same proxy pattern, abbreviated ──
  → GET /api/flipper/health/circuit-breakers     → routes_health (main.py)
  → GET /api/flipper/prices/stream (SSE)         → routes_sse.py (KI-13: registered before /prices/{pair})
  → GET /api/flipper/storage-value/{c}/history    → routes_storage_value.py
  → GET /api/flipper/content-pulse                → routes_content_pulse.py (F3 iter 75)
  → GET /api/flipper/speculation                  → routes_speculation.py (F5 iter 77)
  → GET /api/flipper/speculation/backtest         → routes_speculation_backtest.py (F5 iter 79)
  → GET /api/flipper/phase-hints                  → routes_phase_hints.py (F6 iter 78)
  → GET /api/flipper/circuit-patterns             → routes_circuit_patterns.py (F7/P8 iter 97)
  → GET /api/flipper/intraday-patterns            → routes_intraday_patterns.py (P4 iter 98)
  → GET /api/flipper/weekly-patterns              → routes_weekly_patterns.py (P5 iter 99)
  → GET /api/flipper/mirror-divine-arb            → routes_mirror_divine_arb.py (P7 iter 109)
  → GET /api/flipper/leveling-uniques             → routes_leveling_uniques.py (P9 iter 110)
  → GET /api/flipper/liquid-chain                 → routes_liquid_chain.py (analysis + opportunities)
  → POST /api/flipper/batch                       → routes_batch.py
```

**Backend-only routes (no Next.js proxy file — called directly or not exposed):**
- `/api/v1/health/ping` — called directly from `flipper-proxy.ts:191` (bypasses proxy layer; ultra-lightweight plain-text "ok" response).
- `/api/v1/events/summary` — backend-only, no proxy.
- `/api/v1/market-spreads/history` (TD-4 iter 128) — backend-only, no proxy.
- `/api/v1/items/{item_id}/daily-stats` (TD-5 iter 131) — backend-only, no proxy.

**Real-time updates (SSE only — WS removed iter 58):**

| Route | Purpose |
|-------|---------|
| `/api/v1/prices/stream` | SSE — per-currency price change events (P0-1 fixed iter 55) |

All other channels (flips, anomalies, events, storage-value, forecast) use
REST + React Query polling. The SSE stream carries `{pair, change_pct,
new_price, old_price, timestamp}` per changed currency and is the sole
push-based invalidation channel.

---

## 4. Backend Internal Data Flows

### 4.1 Provider → SnapshotManager → Analytics

```
Poe2ScoutProvider (httpx AsyncClient, semaphore=5, 2 retries on 429)
  │
  ├── get_exchange_rates(league)
  │     GET "/SnapshotPairs" → derive cross-rates
  │     return: {"{from}/{to}": SnapshotPair}
  │
  ├── get_currency_metadata(league)
  │     For each category: fetch all pages (250/page)
  │     return: CurrencyInfo[]
  │
  ├── get_historical_prices(currency, days)
  │     GET "/Currencies/{currency}"
  │     return: PricePoint[]
  │
  ├── get_all_currencies_with_prices(league)
  │     Fetches all ByCategory currencies across all pages
  │     return: list[dict] (raw currency data with prices)
  │
  └── get_daily_stats(league, item_id, ...)
        GET "/Items/{item_id}/DailyStatsHistory"
        return: dict | None

Poe2ScoutProvider
  │
  └── SnapshotManager._refresh()
        │
        1. get_exchange_rates() → snapshot.exchange_rates
        2. Build prices_in_base from exchange rates + BFS transitive pricing
           for currencies without direct base pair → snapshot.prices_in_base
        3. get_all_currencies_with_prices() (ByCategory, ~15 requests)
           → snapshot.currencies + currency_metadata + price_histories + current_prices
        4. Fill missing price histories for SnapshotPair currencies not in ByCategory
        5. Apply clustering (KMeans) → CurrencyClusterer
        6. Compute momentum/volatility/acceleration → PriceMomentumTracker
        7. Tier classification via classify_currencies() → snapshot.tiers
        8. Cache with TTL (default: 5 min)
        │
        return: updated DataSnapshot
```

### 4.2 DataSnapshot Dataclass

Verified against `backend/api/data_snapshot.py:53-87` (iter 141):

```python
@dataclass
class DataSnapshot:
    exchange_rates: dict[str, ExchangeRate] = field(default_factory=dict)   # key: "from/to"
    currencies: dict[str, dict] = field(default_factory=dict)                # key: api_id.lower()
    currency_metadata: list[CurrencyInfo] = field(default_factory=list)
    price_histories: dict[str, list[PricePoint]] = field(default_factory=dict)  # key: api_id.lower()
    current_prices: dict[str, float] = field(default_factory=dict)           # key: api_id.lower()
    prices_in_base: dict[str, float] = field(default_factory=dict)           # transitive mid_price via BFS
    tiers: dict[str, CurrencyTier] = field(default_factory=dict)             # key: api_id.lower()
    fetched_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    valid: bool = False
```

**Note:** `league` is NOT stored on the dataclass — it lives on `SnapshotManager._config`. `snapshot_age_seconds` is computed by `SnapshotManager` (now - `fetched_at`), not stored.

**BFS transitive pricing:** When no direct pair exists between a currency and the base (exalted), mid_price is computed via `_compute_transitive_prices()` (BFS through intermediate currencies that already have a base price).

### 4.3 Analytics Pipeline

```
DataSnapshot
  │
  ├── Scorer → FlipOpportunity[] (raw_spread × fill_prob × penalties × phase)
  ├── TriangularArb → TriangularCycle[] (Bellman-Ford negative cycles)
  ├── PortfolioOptimizer → allocation + correlation (Ledoit-Wolf shrinkage)
  ├── AnomalyDetector → anomaly indicators (Z-score, MACD, RSI, STL, momentum)
  ├── PhaseDetector → EARLY/MID/LATE (based on league_start_date)
  └── EventManager → active events + scoring penalties
```

**Note:** `RecipeArb` was removed from the codebase (vendor recipe profit calculations no longer exist as a separate analytics module).

### 4.4 HistoricalStore (SQLite)

```
HistoricalStore (historical.db)
  │
  ├── init() → Create 5 tables (10s timeout for startup resilience):
  │     1. price_snapshots      — league+currency+timestamp price rows
  │     2. events               — StoredEvent persistence
  │     3. market_spreads       — TD-4 iter 128
  │     4. triangular_cycles    — TD-3 iter 129
  │     5. daily_stats          — TD-5 iter 131 (OHLCV daily history)
  │
  ├── write_price_snapshot(s) / write_price_snapshots_batch(s) → INSERT ON CONFLICT UPDATE
  ├── get_price_history(currency, days) / get_latest_prices(league)
  ├── write_event(e) / write_events_batch(es) / read_active_events() / prune_expired_events()
  ├── write_market_spreads_batch(s) / read_market_spreads(...) / read_market_spreads_pairs(league)  [TD-4]
  ├── write_triangular_cycles_batch(s) / read_triangular_cycles(...) / read_triangular_cycles_keys(league)  [TD-3]
  ├── write_daily_stats_batch(s) / read_daily_stats(...) / read_daily_stats_latest_date(league)
  │     / read_daily_stats_items(league)  [TD-5]
  └── _prune_old_league_data(league) → Remove data from previous leagues on startup
```

### 4.5 Scheduler Jobs

| Job | Interval | Function |
|-----|----------|----------|
| price_snapshot | 30 min | Fetch prices + persist to SQLite (`price_snapshots` table) |
| event_pruning | 15 min | Prune expired events from memory + SQLite |
| model_persistence | 30 min | Save LightGBM models to disk |
| daily_stats_refresh | 1 hour | Refresh DailyStatsHistory for top-N items (TD-5 iter 131) |

All intervals configurable in `config.yaml` → `scheduler:` section.

**Caching & resilience:** See [`ARCHITECTURE.md`](./ARCHITECTURE.md) §7 and [`BACKEND_GUIDE.md`](./BACKEND_GUIDE.md) §5

---

## 5. Field Transformation Reference

### 5.1 PoeItem Transformation (Frontend)

```typescript
// Source: RawCurrencyItem or RawUniqueItem → Destination: PoeItem

// RawCurrencyItem (from /Currencies/ByCategory)
interface RawCurrencyItem {
  CurrencyItemId: number;     // ⚠️ Use for API calls, not ItemId!
  ItemId: number;
  CurrencyCategoryId: number;
  ApiId: string;              // e.g. "divine", "exalted"
  Text: string;               // e.g. "Divine Orb"
  CategoryApiId: string;      // e.g. "currency"
  IconUrl: string | null;
  ItemMetadata: Record<string, unknown> | null;
  PriceLogs: (RawPriceLogEntry | null)[];  // ⚠️ NEWEST FIRST!
  CurrentPrice: number | null;
  CurrentQuantity: number | null;
}

// RawUniqueItem (from /Uniques/ByCategory)
// ⚠️ NOTE (verified iter 144): RawUniqueItem has NO ApiId field (unlike RawCurrencyItem).
//    CategoryApiId is shared by ALL items in the same category, so it cannot
//    serve as a unique identifier. Code uses String(ItemId || UniqueItemId)
//    as the apiId substitute — see mapUniqueItem() comment in poe2api.ts:1025.
interface RawUniqueItem {
  UniqueItemId: number;       // ⚠️ Different from CurrencyItemId!
  ItemId: number;
  Text: string;               // Primary name
  Name: string;               // Fallback name: Text || Name
  CategoryApiId: string;
  Type: string;               // Mapped to PoeItem.type
  IconUrl: string | null;
  IsChanceable: boolean | null;
  ItemMetadata: Record<string, unknown> | null;
  PriceLogs: (RawPriceLogEntry | null)[];  // ⚠️ NEWEST FIRST!
  CurrentPrice: number | null;
  CurrentQuantity: number | null;
}

// Mapping: RawCurrencyItem / RawUniqueItem → PoeItem
//   id              = String(ItemId || CurrencyItemId)        [currencies]
//                     String(ItemId || UniqueItemId)          [uniques]
//                     ⚠️ ItemId takes PRIORITY — verified iter 144 against
//                        poe2api.ts:977 (mapCurrencyItem) and :1024 (mapUniqueItem).
//   apiId           = ApiId                                   [currencies]
//                     String(ItemId || UniqueItemId)          [uniques — NO ApiId field!]
//   name            = Text (or Text || Name for uniques)
//   type            = CategoryApiId (or Type for uniques)
//   category        = CategoryApiId
//   iconUrl         = IconUrl
//   price           = CurrentPrice
//   chaosEquivalentRate = CurrentPrice (chaos-equivalent rate)
//   relativePrice   = referencePrice && currentPrice
//                       ? currentPrice / referencePrice
//                       : currentPrice
//                     ⚠️ falls back to currentPrice when referencePrice is missing
//   change          = currentPrice - computePreviousPrice(PriceLogs) — null if either is null
//   changePercent   = computeChangePercent(PriceLogs) — 24h
//   volume          = computeVolume24h(PriceLogs) ?? 0
//   sevenDayPriceChange = currentPrice - computePrevious7dPrice(PriceLogs) — null if either is null
//   sevenDayPriceChangePercent = compute7dChangePercent(PriceLogs)
//   history         = mapPriceLogs(PriceLogs)
//   dailyStats      = null (fetched separately)
//   lowConfidence   = (CurrentQuantity ?? 0) < 5
//   listingCount    = CurrentQuantity ?? 0
//   baseType        = null (not in API)
//   links           = null
//   variant         = null
//   levelRequired   = null
```

### 5.2 ExchangePair Transformation

```typescript
// Source: RawSnapshotPair → Destination: ExchangePair

// Mapping: RawSnapshotPair → ExchangePair
//   id                      = String(CurrencyExchangeSnapshotPairId)
//   currency1Id             = CurrencyOne.ApiId (e.g. "divine")
//   currency1Name           = CurrencyOne.Text
//   currency1IconUrl        = CurrencyOne.IconUrl
//   currency1ItemId         = CurrencyOne.ItemId  ⚠️ NUMERIC! Use for history API
//   currency1CategoryApiId  = CurrencyOne.CategoryApiId || ""
//   currency2Id             = CurrencyTwo.ApiId
//   currency2Name           = CurrencyTwo.Text
//   currency2IconUrl        = CurrencyTwo.IconUrl
//   currency2ItemId         = CurrencyTwo.ItemId
//   currency2CategoryApiId  = CurrencyTwo.CategoryApiId || ""
//   price                   = safeParseFloat(CurrencyOneData.RelativePrice) — null for "0E-8"
//   relativePrice           = safeParseFloat(CurrencyOneData.RelativePrice)
//                             ⚠️ NOT `price ?? 0` — code at poe2api.ts:1171 assigns relPrice1
//                             directly; can be null. Doc previously claimed `?? 0` fallback — wrong.
//   currency2RelativePrice  = safeParseFloat(CurrencyTwoData.RelativePrice)  // needed for cross-rate
//   volume                  = CurrencyOneData.VolumeTraded ?? 0
//   change                  = null (initialized) → Enriched later via buildCurrencyChangeMap()
//   changePercent           = null (initialized) → Enriched later via buildCurrencyChangeMap()
//   sevenDayChange          = null (initialized) → Enriched later via buildCurrencyChangeMap()
//   sevenDayChangePercent   = null (initialized) → Enriched later via buildCurrencyChangeMap()
//   history                 = null (initialized) → Fetched on demand
```

**⚠️ CRITICAL:** Use `currency1ItemId` (numeric) for history API calls, NOT `currency1Id` (string ApiId).

### 5.3 Case Transform Rules

| Layer | From | To | Exception |
|-------|------|----|-----------|
| POE2Scout → Frontend | PascalCase | camelCase | `/Realms` stays snake_case |
| Backend Python → JSON | snake_case | PascalCase (Pydantic alias) | — |
| Backend JSON → Frontend proxy | snake_case | camelCase | `flipper-proxy.ts` transform |

### 5.4 Flipper Proxy Transform (snake_case → camelCase)

The proxy route handlers in `/api/flipper/*` transform backend snake_case responses to frontend camelCase:

```
volume_24h       → volume24h
mid_price        → midPrice
quantized_analysis → quantizedAnalysis
tier_distance    → tierDistance
alert_score      → alertScore
triggered_indicators → triggeredIndicators
is_confirmed     → isConfirmed
current_price    → currentPrice
projected_price  → projectedPrice
risk_discount    → riskDiscount
adjusted_price   → adjustedPrice
net_value        → netValue
```

---

## 6. Event System

### 6.1 Event Types

| Type | Description | Impact on Scoring |
|------|-------------|-------------------|
| `MAJOR_PATCH` | Major game patch release | Phase reset, volatility boost |
| `MINOR_PATCH` | Minor patch/hotfix | Moderate volatility boost |
| `STREAMER_HYPE` | Streamer-driven demand spike | Momentum boost for affected currencies |
| `OTHER` | Custom/user-defined event | Configurable via metadata |

### 6.2 Event Manager

**Location:** `backend/economy/events.py`

- **Dual-write:** In-memory + SQLite (events table)
- **Auto-expiry:** `default_expiry_hours` from config (default: 48h)
- **Scoring penalty:** `event_score_penalty` from config (default: 0.5) applied to affected currencies
- **Pruning:** Scheduler runs every 15 min, removes expired events
- **Load on startup:** Reads active events from SQLite, prunes expired

---

## 7. API Path Reference

### 7.1 Frontend Routes (Next.js `src/app/api/`)

```
poe2/                               # Direct POE2Scout proxy (no backend)
  health/route.ts                   → getHealth()
  realms/route.ts                   → getRealms()
  leagues/route.ts                  → getLeagues(realm, defaultLeagueValue)
  exchange/route.ts                 → getSnapshotPairs(realm, league)
  currencies/route.ts              → getCurrenciesByCategory(...)
  uniques/route.ts                 → getUniquesByCategory(...)
  items/route.ts                   → getItems(realm, league)
  overview/route.ts                → Combined: getExchangeSnapshot + getSnapshotHistory + getReferenceCurrencies

flipper/                            # FastAPI backend proxy
  health/route.ts                  → GET /api/v1/health
  health/circuit-breakers/route.ts → GET /api/v1/health/circuit-breakers
  # Note: /api/v1/health/ping is called DIRECTLY from flipper-proxy.ts (no proxy file)
  phase/route.ts                   → GET /api/v1/phase
  currencies/route.ts              → GET /api/v1/currencies
  prices/route.ts                  → GET /api/v1/prices
  prices/stream/route.ts           → GET /api/v1/prices/stream (SSE)
  heatmap/route.ts                 → GET /api/v1/prices/heatmap
  flips/route.ts                   → GET /api/v1/arbitrage/flips
  triangular/route.ts              → GET /api/v1/arbitrage/triangular
  tiers/route.ts                   → GET /api/v1/tiers
  anomalies/route.ts               → GET /api/v1/anomalies
  storage-value/[currency]/route.ts        → GET /api/v1/storage-value/{currency}
  storage-value/[currency]/history/route.ts → GET /api/v1/storage-value/{currency}/history
  benchmarks/[currency]/route.ts   → GET /api/v1/benchmarks/{currency_api_id}
  optimizer/path/route.ts          → GET /api/v1/optimizer/path
  optimizer/matrix/route.ts        → GET /api/v1/optimizer/matrix
  analyst/summary/route.ts         → GET /api/v1/analyst/summary
  optimal-currency/route.ts        → GET /api/v1/arbitrage/optimal-currency
  portfolio/correlation/route.ts   → GET /api/v1/portfolio/correlation
  # Note: events/summary is backend-only (no proxy file)
  content-pulse/route.ts           → GET /api/v1/content-pulse (F3 iter 75)
  speculation/route.ts             → GET /api/v1/speculation (F5 iter 77)
  speculation/backtest/route.ts    → GET /api/v1/speculation/backtest (F5 iter 79)
  phase-hints/route.ts             → GET /api/v1/phase-hints (F6 iter 78)
  circuit-patterns/route.ts        → GET /api/v1/circuit-patterns (F7/P8 iter 97)
  intraday-patterns/route.ts       → GET /api/v1/intraday-patterns (P4 iter 98)
  weekly-patterns/route.ts         → GET /api/v1/weekly-patterns (P5 iter 99)
  mirror-divine-arb/route.ts       → GET /api/v1/mirror-divine-arb (P7 iter 109)
  leveling-uniques/route.ts        → GET /api/v1/leveling-uniques (P9 iter 110)
  # Note: market-spreads/history is backend-only (no proxy file) — TD-4 iter 128
  liquid-chain/route.ts            → GET /api/v1/liquid-chain/{analysis|opportunities}
  batch/route.ts                   → POST /api/v1/batch
  events/route.ts                  → GET/POST /api/v1/events
  events/[eventId]/route.ts        → GET/DELETE /api/v1/events/{id}
  events/[eventId]/deactivate/route.ts → POST /api/v1/events/{id}/deactivate
```

**Verified iter 141:** 34 `route.ts` files under `src/app/api/flipper/` (vs §7.1 listing = 34 entries after cleanup). Backend-only routes that have no proxy file: `/api/v1/health/ping`, `/api/v1/events/summary`, `/api/v1/market-spreads/history`, `/api/v1/items/{item_id}/daily-stats`.

### 7.2 Backend Routes (FastAPI `backend/api/`)

```
main.py                  # /api/v1/health, /api/v1/health/ping, /api/v1/health/circuit-breakers
routes_prices.py         # /api/v1/phase, /api/v1/currencies, /api/v1/prices,
                         # /api/v1/prices/heatmap, /api/v1/tiers,
                         # /api/v1/benchmarks/{currency_api_id}
routes_optimizer.py      # /api/v1/optimizer/path, /api/v1/optimizer/matrix
routes_analyst.py        # /api/v1/analyst/summary
routes_arbitrage.py      # /api/v1/arbitrage/flips, /api/v1/arbitrage/triangular,
                         # /api/v1/arbitrage/triangular/history (TD-3 iter 129),
                         # /api/v1/arbitrage/optimal-currency
routes_events.py         # /api/v1/events (GET/POST), /api/v1/events/summary,
                         # /api/v1/events/{id} (GET/DELETE),
                         # /api/v1/events/{id}/deactivate (POST)
routes_anomalies.py      # /api/v1/anomalies
routes_storage_value.py  # /api/v1/storage-value/{currency},
                         # /api/v1/storage-value/{currency}/history
routes_portfolio.py      # /api/v1/portfolio/correlation (ACTIVE)
routes_sse.py            # /api/v1/prices/stream (SSE — KI-13: registered before /api/v1/prices/{pair})
routes_content_pulse.py  # /api/v1/content-pulse (F3 iter 75)
routes_speculation.py    # /api/v1/speculation (F5 iter 77)
routes_speculation_backtest.py  # /api/v1/speculation/backtest (F5 iter 79)
routes_phase_hints.py    # /api/v1/phase-hints (F6 iter 78)
routes_circuit_patterns.py  # /api/v1/circuit-patterns (F7/P8 iter 97)
routes_intraday_patterns.py # /api/v1/intraday-patterns (P4 iter 98)
routes_weekly_patterns.py   # /api/v1/weekly-patterns (P5 iter 99)
routes_mirror_divine_arb.py # /api/v1/mirror-divine-arb (P7 iter 109)
routes_leveling_uniques.py  # /api/v1/leveling-uniques (P9 iter 110)
routes_market_spreads.py    # /api/v1/market-spreads/history (TD-4 iter 128)
routes_daily_stats.py       # /api/v1/items/{item_id}/daily-stats (TD-5 iter 131 — backend-only, no proxy)
routes_liquid_chain.py      # /api/v1/liquid-chain/analysis, /api/v1/liquid-chain/opportunities
routes_batch.py             # /api/v1/batch (POST)
```

**Note:** `routes_auth.py`, `routes_ws.py`, and `routes_scanner.py` have been **deleted** — `routes_auth.py` was dead code (removed earlier); `routes_ws.py` was removed in iter 58 (P0-2 + P1-1 + P1-2); `routes_scanner.py` was deprecated in iter 67 and removed in iter 68 (P2-4 follow-up — its filter/sort params now live on `/api/v1/arbitrage/flips`). See STATUS.md §Fixed.

### 7.3 POE2Scout API Paths

```
/api                                           # Root
/api/health/live                               # Liveness probe
/api/health/ready                              # Readiness probe
/api/Realms                                    # Realms (snake_case!)
/api/Realms/{Realm}/Filters                    # Search filters
/api/Realms/{Realm}/LandingSplashInfo          # Landing splash
/api/{Realm}/Leagues                           # Leagues
/api/{Realm}/Leagues/{LeagueName}/SnapshotPairs
/api/{Realm}/Leagues/{LeagueName}/SnapshotHistory
/api/{Realm}/Leagues/{LeagueName}/ExchangeSnapshot
/api/{Realm}/Leagues/{LeagueName}/ReferenceCurrencies
/api/{Realm}/Leagues/{LeagueName}/Items
/api/{Realm}/Leagues/{LeagueName}/Items/Categories
/api/{Realm}/Leagues/{LeagueName}/Items/{ItemId}
/api/{Realm}/Leagues/{LeagueName}/Items/{ItemId}/History
/api/{Realm}/Leagues/{LeagueName}/Items/{ItemId}/DailyStatsHistory
/api/{Realm}/Leagues/{LeagueName}/Items/PriceHistory
/api/{Realm}/Leagues/{LeagueName}/Currencies/ByCategory
/api/{Realm}/Leagues/{LeagueName}/Currencies/{ApiId}
/api/{Realm}/Leagues/{LeagueName}/Currencies/Pairs/{C1}/{C2}/History
/api/{Realm}/Leagues/{LeagueName}/Uniques/ByCategory
```

---

## 8. Critical Gotchas for Data Flows

### 8.1 Data Source Confusion

1. **Never assume data comes from the backend** — check which route handles it:
   - `/api/poe2/*` → POE2Scout API directly (no backend)
   - `/api/flipper/*` → FastAPI backend (with analytics)
2. **Never hardcode API paths** — use exported functions from `poe2api.ts` or `flipper-proxy.ts`
3. **Never use string ApiId where numeric ItemId is required** — CurrencyPairHistory expects integers
4. ~~`/api/flipper/auth/*`~~ — **removed** (auth was never configured)

### 8.2 Response Shape Pitfalls

1. **PriceLogs newest-first** — always sort before computing changes
2. **Category=all returns empty** — must merge all categories
3. **IsCurrent works for poe2 realm** — prefer it when true, else use realm's `default_league_value`
4. **Some numeric fields are strings** — use `safeParseFloat()` or `Number()`
5. **Pagination metadata differs** — API uses `CurrentPage/Pages/Total`, frontend uses `page/totalPages/totalItems`
6. **RelativePrice "0E-8"** — scientific-notation zero; `safeParseFloat` returns `null`
7. **RawUniqueItem has UniqueItemId** — different from RawCurrencyItem's CurrencyItemId
8. **GetCategoriesResponse has two arrays** — `UniqueCategories` and `CurrencyCategories`

### 8.3 Type Mismatches

1. **Frontend uses camelCase** — API returns PascalCase, transformed in poe2api.ts
2. **Backend uses snake_case** — Pydantic models use snake_case, serialized as PascalCase
3. **ExchangePair uses numeric ItemId** — not string ApiId for history calls
4. **FlipOpportunity.spreadAfterFees is DEPRECATED** — kept for backward compatibility only
5. **Backend CurrencyTier uses tier_label** — frontend expects tierLabel (proxy must transform)

### 8.4 Caching Assumptions

1. **Server-side cache in poe2api.ts** — 60s fresh, 30min stale-while-revalidate
2. **Backend SnapshotManager refreshes every 5 min** — analytics lag behind real-time
3. **HistoricalStore is SQLite** — persists across restarts, used for forecasting
4. **Metadata cache in Poe2ScoutProvider** — 1-hour TTL to avoid N+1 requests
5. **Change map cache** — 5min TTL, 20min stale TTL; enriches ExchangePair 7d changes
6. **LightGBM models persisted to disk** — survive backend restarts; retrained every 6h
7. **Max cache size 500 entries** — LRU eviction when exceeded

### 8.5 Known Discrepancies

1. **`scoreColor` re-export:** `src/components/dashboard/flips-helpers.ts` now re-exports `scoreColor` from `src/lib/flipper-helpers.ts` — no longer duplicated with different thresholds
2. ~~`FeesConfig` with `gold_enabled` flag~~ — **removed** in v1.17+. Gold fees are permanently excluded from all calculations.
3. ~~`routes_auth.py`~~ — **deleted** from codebase (was dead code, now removed)
4. **`OfficialTradeProvider` exists** but requires env vars that are never configured — dead code unless manually set

---

## 9. Data → Component Mapping

Verified against `src/components/dashboard/dashboard-page.tsx` `TAB_MAP` (16 entries, iter 141):

| # | Tab | Component file | Data Sources |
|---|-----|----------------|-------------|
| 1 | **Overview** | `overview-tab-content.tsx` | `/api/poe2/overview`, realm/league selectors |
| 2 | **Currencies** | `currencies-tab-content.tsx` | `/api/poe2/currencies`, `/api/poe2/items/{id}/History`, `/api/poe2/items/{id}/DailyStatsHistory` |
| 3 | **Uniques** | `uniques-tab-content.tsx` | `/api/poe2/uniques`, same detail endpoints |
| 4 | **Exchange** | `exchange-tab-content.tsx` | `/api/poe2/exchange`, `/api/poe2/currencies/Pairs/{c1}/{c2}/History`, reference currencies |
| 5 | **Flips** | `flips-tab.tsx` | `/api/flipper/flips`, `/api/flipper/tiers`, `/api/flipper/events`, `/api/flipper/storage-value/{c}` |
| 6 | **Optimizer** | `optimizer-tab.tsx` | `/api/flipper/optimizer/path`, `/api/flipper/optimizer/matrix` |
| 7 | **Analyst** | `analyst-tab.tsx` | `/api/flipper/analyst/summary`, `/api/poe2/analyst-fallback` (no backend) |
| 8 | **Storage Value** (F2) | `storage-value-tab.tsx` | `/api/flipper/storage-value/{c}`, `/api/flipper/storage-value/{c}/history` |
| 9 | **Speculation** (F5) | `speculation-tab.tsx` | `/api/flipper/speculation`, `/api/flipper/speculation/backtest` |
| 10 | **Circuit Patterns** (F7/P8) | `circuit-patterns-tab.tsx` | `/api/flipper/circuit-patterns` |
| 11 | **Intraday Patterns** (P4) | `intraday-patterns-tab.tsx` | `/api/flipper/intraday-patterns` |
| 12 | **Weekly Patterns** (P5) | `weekly-patterns-tab.tsx` | `/api/flipper/weekly-patterns` |
| 13 | **Mirror/Divine Arb** (P7) | `mirror-divine-arb-tab.tsx` | `/api/flipper/mirror-divine-arb` |
| 14 | **Liquid Chain** | `liquid-chain-tab.tsx` | `/api/flipper/liquid-chain` (analysis) |
| 15 | **Watchlist** | `watchlist-tab.tsx` | Exchange pair data via fetchApi, Zustand store (persisted) |

**Removed tabs (phantom entries from pre-iter 141 docs):**
- `Arbitrage` — removed iter 92 (KI-7), was dead (`Flips` tab now covers this).
- `Graph` (`CurrencyGraphTab`) — removed iter 87.
- `Gold Map ROI` — removed iter 149 (KI-35), deemed unused.

**Utility components:**

| Component | Data Sources |
|-----------|-------------|
| `MarketHeatmap` | 24h price change data |
| `TierDriftTracker` | `/api/flipper/tiers` |
| `TakeProfitCalculator` | Quantized analysis from flip data |
| `VolumeLiquidityIndicators` | Volume & liquidity scores |
| `Sparkline` | Inline mini chart from price history |
| `CandlestickChart` | OHLCV with SMA/EMA/RSI/Bollinger overlays (`technical-indicators.ts`) |
| `FlipperStickyBar` | Market sentiment + top flips |
| `FlipperBackendStatusCard` | Backend health status + data freshness badge |
| `EventsSidebar` | Event management CRUD |

---

## 10. Common Data Flow Mistakes

### 10.1 Wrong API for Data

```typescript
// ❌ WRONG: Trying to get flipper data from market endpoint
const data = await getExchangeSnapshot(realm, league);
if (data.opportunities) { ... } // undefined!

// ✅ CORRECT: Use flipper endpoint for flipper data
const data = await fetchApi<FlipsResponse>("/api/flipper/flips");
if (data.opportunities) { ... } // correct
```

### 10.2 Using String ApiId Where Numeric ItemId Required

```typescript
// ❌ WRONG
const history = await getCurrencyPairHistory(
  realm, league,
  pair.currency1Id,  // "divine" — causes 422
  pair.currency2Id,  // "exalted" — causes 422
  168
);

// ✅ CORRECT
const history = await getCurrencyPairHistory(
  realm, league,
  pair.currency1ItemId,  // 12345 — correct
  pair.currency2ItemId,  // 67890 — correct
  168
);
```

### 10.3 Forgetting PriceLogs Sort

```typescript
// ❌ WRONG: Assumes oldest first
const change = ((logs[0].Price - logs[logs.length-1].Price) / logs[logs.length-1].Price) * 100;

// ✅ CORRECT: Always sort first (API returns newest first!)
const sorted = [...logs].sort((a, b) =>
  new Date(a.Time).getTime() - new Date(b.Time).getTime()
);
const now = sorted[sorted.length - 1];
const oldest = sorted[0];
const change = ((now.Price - oldest.Price) / oldest.Price) * 100;
```

### 10.4 Not Handling Backend Offline

```typescript
// ❌ WRONG: UI crashes on backend offline
const data = await fetchApi<FlipOpportunity[]>("/api/flipper/flips");

// ✅ CORRECT: Check error type, show appropriate UI
const { data, error } = useQuery({
  queryKey: ["flips"],
  queryFn: () => fetchApi<FlipsResponse>("/api/flipper/flips"),
  retry: false,
});
if (error) {
  const errorType = getFlipperErrorType(error);
  if (errorType === "backend_offline") {
    return <FlipperBackendStatusCard type="offline" />;
  }
}
```

### 10.5 Using DEPRECATED spreadAfterFees

```typescript
// ❌ WRONG
const profit = flip.spreadAfterFees * flip.volume24h;

// ✅ CORRECT
const profit = flip.spread * flip.volume24h;
// Or use quantized analysis for lot-level profit
const qAnalysis = flip.quantizedAnalysis;
if (qAnalysis) {
  const optimalLot = qAnalysis.minProfitableLot;
  const profitPct = qAnalysis.optimalLotProfitPct;
}
```

### 10.6 Confusing Realm Path Parameter

```typescript
// ❌ WRONG: Using game_api_id as realm path parameter
const url = BASE_URL + `/poe2/Leagues`;  // may work but unreliable

// ✅ CORRECT: Use the 'value' field from /Realms response
const realmValue = realm.name;  // extracted from RealmOptionResponse.value
const url = BASE_URL + `/${realmValue}/Leagues`;
```
