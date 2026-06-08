# PoE2 Market Dashboard — Data Flow Reference

> **Version:** 1.0 | **Date:** 2026-06-08

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

**Base URL:** `https://api.poe2scout.com/api` (configurable via `POE2_API_BASE_URL` or `config.yaml → data.poe2scout_base_url`)

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
| 17 | `/{Realm}/Leagues/{LeagueName}/Currencies/Pairs/{C1}/{C2}/History` | Exchange pair history | PascalCase |
| 18 | `/{Realm}/Leagues/{LeagueName}/Uniques/ByCategory` | Uniques (paginated) | PascalCase |
| 19 | `/` | Root | — |
| 20 | `/health/live` | Liveness probe | — |
| 21 | `/health/ready` | Readiness probe | — |

**Path parameters:** PascalCase in spec — `{Realm}`, `{LeagueName}`, `{ItemId}`, `{CurrencyOneItemId}`, `{CurrencyTwoItemId}`. Base URL already includes `/api`.

**API response shapes:** See [`DATA_CONTRACTS.md`](./DATA_CONTRACTS.md) §6

**Critical API bugs:**
1. **PriceLogs are REVERSE chronological** — newest first. Always sort ascending before any computation.
2. **Category=all returns EMPTY** — must fetch all categories and merge client-side.
3. **League IsCurrent is always false** — use `default_league_value` from `/Realms` instead.
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
  → flipper-proxy.ts → fetch(FLIPPER_API_URL + "/api/health")
  → return: FlipperHealthResponse

  → GET /api/flipper/phase
  → flipper-proxy.ts → fetch(FLIPPER_API_URL + "/api/phase")
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
  → flipper-proxy.ts → routes_prices.py
  → Optimal currency conversion path
  → return: OptimizerPathResponse

  → GET /api/flipper/optimizer/matrix
  → flipper-proxy.ts → routes_prices.py
  → Effective rate matrix
  → return: OptimizerMatrixResponse

  → GET /api/flipper/analyst/summary
  → flipper-proxy.ts → routes_prices.py
  → League analyst summary
  → return: AnalystSummaryResponse

  → GET/POST /api/flipper/events
  → flipper-proxy.ts → routes_events.py
  → EventManager CRUD (dual-write: memory + SQLite)
  → return: FlipperEventsSummary { events[], total }

  → GET/DELETE /api/flipper/events/{id}
  → flipper-proxy.ts → routes_events.py

  → POST /api/flipper/events/{id}/deactivate
  → flipper-proxy.ts → routes_events.py
```

**WebSocket channels (real-time updates):**

| Route | Purpose |
|-------|---------|
| `/ws/storage-value/{currency}` | Live storage value updates |
| `/ws/forecast/{currency}` | Live forecast updates |
| `/ws/anomalies` | Live anomaly alerts |
| `/ws/flips` | Live flip opportunity alerts |
| `/ws/events` | Live event notifications |

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
        1. get_exchange_rates() → snapshot.rates
        2. get_currency_metadata() → snapshot.currencies
        3. For each currency: get_historical_prices() → snapshot.price_histories
        4. BFS transitive pricing for currencies without direct base pair → snapshot.bfs_pricing
        5. Apply clustering (KMeans) → CurrencyClusterer
        6. Compute momentum/volatility/acceleration → PriceMomentumTracker
        7. Tier classification via classify_currencies() → snapshot.tiers
        8. Cache with TTL (default: 5 min)
        │
        return: updated DataSnapshot
```

### 4.2 DataSnapshot Dataclass

```python
@dataclass
class DataSnapshot:
    league: str
    fetched_at: datetime
    rates: dict[str, SnapshotPair]          # key: "currency1/currency2"
    currencies: list[CurrencyItem]
    price_histories: dict[str, list[PriceLogEntry]]  # key: api_id
    bfs_pricing: dict[str, float]           # transitive mid_price via BFS
    snapshot_age_seconds: float
```

**BFS transitive pricing:** When no direct pair exists between a currency and the base (exalted), mid_price is computed via breadth-first search through existing pairs.

### 4.3 Analytics Pipeline

```
DataSnapshot
  │
  ├── Scorer → FlipOpportunity[] (raw_spread × fill_prob × penalties × phase)
  ├── TriangularArb → TriangularCycle[] (Bellman-Ford negative cycles)
  ├── PortfolioOptimizer → allocation + correlation (Ledoit-Wolf shrinkage)
  ├── AnomalyDetector → anomaly indicators (Z-score, MACD, RSI, STL, momentum)
  ├── PhaseDetector → EARLY/MID/LATE (based on league_start_date)
  ├── EventManager → active events + scoring penalties
  └── RecipeArb → vendor recipe profit calculations (gold_enabled: false)
```

### 4.4 HistoricalStore (SQLite)

```
HistoricalStore (historical.db)
  │
  ├── init() → Create tables: prices_history, events, price_snapshots
  │     (10s timeout for startup resilience)
  ├── append_price_snapshot(league, rates) → INSERT ON CONFLICT UPDATE
  ├── get_price_history(currency, days) → SELECT WHERE currency=? AND timestamp>?
  ├── save_event(event) / load_events() / prune_expired_events()
  └── _prune_old_league_data(league) → Remove data from previous leagues on startup
```

### 4.5 Scheduler Jobs

| Job | Interval | Function |
|-----|----------|----------|
| price_snapshot | 30 min | Fetch prices + persist to SQLite |
| event_pruning | 15 min | Prune expired events from memory + SQLite |
| model_persistence | 30 min | Save LightGBM models to disk |

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
  ItemMetadata?: any;
  PriceLogs: (RawPriceLogEntry | null)[];  // ⚠️ NEWEST FIRST!
  CurrentPrice: number | null;
  CurrentQuantity: number | null;
}

// RawUniqueItem (from /Uniques/ByCategory)
interface RawUniqueItem {
  UniqueItemId: number;       // ⚠️ Different from CurrencyItemId!
  ItemId: number;
  ApiId: string;
  Text: string;               // Primary name
  Name: string;               // Fallback name: Text || Name
  CategoryApiId: string;
  Type: string;               // Mapped to PoeItem.type
  IconUrl: string | null;
  IsChanceable?: boolean;
  ItemMetadata?: any;
  PriceLogs: (RawPriceLogEntry | null)[];  // ⚠️ NEWEST FIRST!
  CurrentPrice: number | null;
  CurrentQuantity: number | null;
}

// Mapping: RawCurrencyItem / RawUniqueItem → PoeItem
//   id              = String(CurrencyItemId || UniqueItemId || ItemId)
//   apiId           = ApiId
//   name            = Text (or Text || Name for uniques)
//   type            = CategoryApiId (or Type for uniques)
//   category        = CategoryApiId
//   iconUrl         = IconUrl
//   price           = CurrentPrice
//   chaosEquivalentRate = CurrentPrice (chaos-equivalent rate)
//   relativePrice   = CurrentPrice / referencePrice
//   change          = currentPrice - computePreviousPrice(PriceLogs)
//   changePercent   = computeChangePercent(PriceLogs) — 24h
//   volume          = computeVolume24h(PriceLogs)
//   sevenDayPriceChange = currentPrice - computePrevious7dPrice(PriceLogs)
//   sevenDayPriceChangePercent = compute7dChangePercent(PriceLogs)
//   history         = mapPriceLogs(PriceLogs)
//   dailyStats      = null (fetched separately)
//   lowConfidence   = CurrentQuantity < 5
//   listingCount    = CurrentQuantity
//   baseType        = null (not in API)
//   links           = null
//   variant         = null
//   levelRequired   = null
```

### 5.2 ExchangePair Transformation

```typescript
// Source: RawSnapshotPair → Destination: ExchangePair

// Mapping: RawSnapshotPair → ExchangePair
//   id                  = String(CurrencyExchangeSnapshotPairId)
//   currency1Id         = CurrencyOne.ApiId (e.g. "divine")
//   currency1Name       = CurrencyOne.Text
//   currency1IconUrl    = CurrencyOne.IconUrl
//   currency1ItemId     = CurrencyOne.ItemId  ⚠️ NUMERIC! Use for history API
//   currency2Id         = CurrencyTwo.ApiId
//   currency2Name       = CurrencyTwo.Text
//   currency2IconUrl    = CurrencyTwo.IconUrl
//   currency2ItemId     = CurrencyTwo.ItemId
//   price               = safeParseFloat(CurrencyOneData.RelativePrice) — null for "0E-8"
//   relativePrice       = price ?? 0
//   volume              = CurrencyOneData.VolumeTraded
//   change              = Enriched later via buildCurrencyChangeMap()
//   changePercent       = Enriched later via buildCurrencyChangeMap()
//   sevenDayChange      = Enriched later via buildCurrencyChangeMap()
//   sevenDayChangePercent = Enriched later via buildCurrencyChangeMap()
//   history             = Fetched on demand
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
net_value_after_fees → netValueAfterFees
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
  health/route.ts                  → GET /api/health
  phase/route.ts                   → GET /api/phase
  currencies/route.ts              → GET /api/currencies
  prices/route.ts                  → GET /api/prices
  heatmap/route.ts                 → GET /api/prices/heatmap
  flips/route.ts                   → GET /api/arbitrage/flips
  triangular/route.ts             → GET /api/arbitrage/triangular
  tiers/route.ts                   → GET /api/tiers
  anomalies/route.ts              → GET /api/anomalies
  storage-value/[currency]/route.ts → GET /api/storage-value/{currency}
  benchmarks/[currency]/route.ts  → GET /api/benchmarks/{currency_api_id}
  optimizer/path/route.ts         → GET /api/optimizer/path
  optimizer/matrix/route.ts       → GET /api/optimizer/matrix
  analyst/summary/route.ts        → GET /api/analyst/summary
  portfolio/correlation/route.ts  → GET /api/portfolio/correlation
  events/route.ts                 → GET/POST /api/events
  events/[eventId]/route.ts       → GET/DELETE /api/events/{id}
  events/[eventId]/deactivate/route.ts → POST /api/events/{id}/deactivate
  ws/info/route.ts                → WebSocket connection info
```

### 7.2 Backend Routes (FastAPI `backend/api/`)

```
main.py                  # /api/health
routes_prices.py         # /api/phase, /api/currencies, /api/prices,
                         # /api/prices/heatmap, /api/tiers,
                         # /api/benchmarks/{currency_api_id},
                         # /api/optimizer/path, /api/optimizer/matrix,
                         # /api/analyst/summary
routes_arbitrage.py      # /api/arbitrage/flips, /api/arbitrage/triangular
routes_events.py         # /api/events (GET/POST), /api/events/summary,
                         # /api/events/{id} (GET/DELETE),
                         # /api/events/{id}/deactivate (POST)
routes_anomalies.py      # /api/anomalies
routes_storage_value.py  # /api/storage-value/{currency}
routes_portfolio.py      # /api/portfolio/correlation (ACTIVE)
routes_ws.py             # WebSocket: /ws/storage-value/{c}, /ws/forecast/{c},
                         # /ws/anomalies, /ws/flips, /ws/events
```

**Note:** `routes_auth.py` exists but is NOT registered in the app — effectively dead code.

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
4. **`/api/flipper/auth/*` routes exist but auth is not configured** — dead code

### 8.2 Response Shape Pitfalls

1. **PriceLogs newest-first** — always sort before computing changes
2. **Category=all returns empty** — must merge all categories
3. **IsCurrent is always false** — use realm's `default_league_value`
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
5. **OHLCVCandle exported from poe2api.ts** — not types.ts (breaks convention)
6. **Backend CurrencyTier uses tier_label** — frontend expects tierLabel (proxy must transform)

### 8.4 Caching Assumptions

1. **Server-side cache in poe2api.ts** — 60s fresh, 10min stale-while-revalidate
2. **Backend SnapshotManager refreshes every 5 min** — analytics lag behind real-time
3. **HistoricalStore is SQLite** — persists across restarts, used for forecasting
4. **Metadata cache in Poe2ScoutProvider** — 1-hour TTL to avoid N+1 requests
5. **Change map cache** — 5min TTL, 20min stale TTL; enriches ExchangePair 7d changes
6. **LightGBM models persisted to disk** — survive backend restarts; retrained every 6h
7. **Max cache size 500 entries** — LRU eviction when exceeded

### 8.5 Known Discrepancies

1. **Two overlapping helper files:** `src/components/dashboard/flips-helpers.ts` and `src/lib/flipper-helpers.ts` both export `scoreColor()` with different thresholds/Tailwind classes
2. **Backend `FeesConfig` has `gold_enabled` flag** (default: `false`) — controls gold fee inclusion
3. **`routes_auth.py` exists but NOT registered** — dead code
4. **`OfficialTradeProvider` exists** but requires env vars that are never configured — dead code unless manually set

---

## 9. Data → Component Mapping

| Tab | Components | Data Sources |
|-----|-----------|-------------|
| **Overview** | `MarketOverview`, `MarketHeatmap` | `/api/poe2/overview`, realm/league selectors |
| **Currencies** | `VirtualCurrencyGrid`, `DetailDialog` | `/api/poe2/currencies`, `/api/poe2/items/{id}/History`, `/api/poe2/items/{id}/DailyStatsHistory` |
| **Uniques** | `UniqueTable`, `DetailDialog` | `/api/poe2/uniques`, same detail endpoints |
| **Exchange** | `ExchangeTable`, `PairDetailDialog` | `/api/poe2/exchange`, `/api/poe2/currencies/Pairs/{c1}/{c2}/History`, reference currencies |
| **Arbitrage** | `ArbitrageTab` | `/api/flipper/health`, `/api/flipper/flips`, `/api/flipper/triangular` |
| **Flips** | `FlipsTab`, `FlipsDetailDialog` | `/api/flipper/flips`, `/api/flipper/tiers`, `/api/flipper/events`, `/api/flipper/storage-value/{c}` |
| **Forecast** | Anomaly + storage-value tabs | `/api/flipper/anomalies`, `/api/flipper/currencies` |
| **Portfolio** | `OptimizerTab`, `ComparativeChart` | `/api/flipper/portfolio/correlation` |
| **Graph** | `CurrencyGraphTab`, `ComparativeChart` | `/api/flipper/currencies`, `/api/flipper/storage-value/{c}` |
| **Watchlist** | `WatchlistTab` | Exchange pair data via fetchApi, Zustand store (persisted) |

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
| `FlipperBackendStatusCard` | Backend health status + WS status |
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
