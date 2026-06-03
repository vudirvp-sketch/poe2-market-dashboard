# PoE2 Market Dashboard — Data Flow Tracking Reference

> **PURPOSE:** This file is the single source of truth for data provenance, transformation pipelines, and algorithmic formulas in the PoE2 Market Dashboard system. LLM agents MUST consult this file before modifying any API calls, data transformations, or UI subscriptions.
>
> **VERIFICATION STATUS:** Each data flow is traced from the original POE2Scout API response through the transformation layer to the UI component. Field mappings are documented with examples.
>
> **LAST UPDATED:** 2026-06-03 — Added CORS proxy fallback (§11), Cloudflare Worker guide (§12), WebSocket status UI, pre-populated cache docs.

---

## §0. Architecture Overview

```
Browser (React/Next.js)
    │
    ├── /api/poe2/*   ────→ POE2Scout API (api.poe2scout.com/api)
    │                          (Server-side fetch, cache, PascalCase→camelCase)
    │                          ↓ on connection error
    │                          CORS Proxy (Cloudflare Worker)
    │                          ↓ on connection error
    │                          Pre-populated cache (cache-snapshot.json)
    │
    └── /api/flipper/* ────→ FastAPI Backend (port 8000)
                               ├── Poe2ScoutProvider ────→ POE2Scout API
                               │   ├─ (fallback) ────→ CORS Proxy (Cloudflare Worker)
                               │   └─ OfficialTradeProvider (OAuth2 fallback, rarely used)
                               ├── SnapshotManager (replaces DataSnapshot)
                               │   ├── DataSnapshot dataclass (in-memory, TTL-cached)
                               │   ├── BFS transitive pricing for missing base pairs
                               │   └── Tier classification via classify_currencies()
                               ├── HistoricalStore (SQLite, persistent)
                               ├── DataScheduler (APScheduler, config-driven intervals)
                               ├── PipelineCache (TTL-based result cache)
                               ├── DailyStatsCache (LRU + TTL)
                               ├── ModelStore (LightGBM model persistence to disk)
                               ├── Analytics (scoring, forecasting, portfolio, anomaly, tiers, benchmarks)
                               └── WebSocket (routes_ws.py) ────→ Per-endpoint live updates
```

**Configuration source:** `backend/config.yaml` (loaded via Pydantic Settings into `AppConfig`). All intervals, thresholds, and model parameters are configurable there.

---

## §1. Data Sources & External APIs

### 1.1 POE2Scout API (Primary Source)

| Property | Value |
|----------|-------|
| **Base URL** | `https://api.poe2scout.com/api` (configurable via `POE2_API_BASE_URL` or `config.yaml → data.poe2scout_base_url`) |
| **Swagger UI** | `https://api.poe2scout.com/swagger` |
| **OpenAPI Spec** | `https://api.poe2scout.com/api/openapi.json` (OpenAPI 3.1.0) |
| **Authentication** | None (public API) |
| **Rate Limits** | None for consumers (server handles upstream) |
| **Response Format** | JSON, PascalCase for most endpoints, **snake_case for `/Realms`** |

**Complete Endpoint List (21 endpoints):**

| # | Endpoint | Method | Purpose | Response Shape |
|---|----------|--------|---------|----------------|
| 1 | `/Realms` | GET | Available realms | `RealmOptionResponse[]` (**snake_case!**) |
| 2 | `/Realms/{Realm}/Filters` | GET | Search filters for realm | `GetFiltersResponse` |
| 3 | `/Realms/{Realm}/LandingSplashInfo` | GET | Landing splash data | `GetLandingSplashInfoResponse` |
| 4 | `/{Realm}/Leagues` | GET | Leagues for realm | `GetResponse[]` (PascalCase) |
| 5 | `/{Realm}/Leagues/{LeagueName}/SnapshotPairs` | GET | All currency pairs with prices | `GetSnapshotPairsResponse[]` |
| 6 | `/{Realm}/Leagues/{LeagueName}/SnapshotHistory` | GET | Market snapshot history | `GetSnapshotHistoryResponse` |
| 7 | `/{Realm}/Leagues/{LeagueName}/ReferenceCurrencies` | GET | Reference/bridge currencies | `ReferenceCurrency[]` |
| 8 | `/{Realm}/Leagues/{LeagueName}/ExchangeSnapshot` | GET | Exchange overview | `GetExchangeSnapshotResponse` |
| 9 | `/{Realm}/Leagues/{LeagueName}/Items` | GET | All items for league | `GetItemsResponse[]` |
| 10 | `/{Realm}/Leagues/{LeagueName}/Items/Categories` | GET | Item categories | `GetCategoriesResponse` |
| 11 | `/{Realm}/Leagues/{LeagueName}/Items/{ItemId}` | GET | Single item by ID | `GetItemsResponse` |
| 12 | `/{Realm}/Leagues/{LeagueName}/Items/{ItemId}/History` | GET | Price history for item | `GetPriceHistoryResponse` |
| 13 | `/{Realm}/Leagues/{LeagueName}/Items/{ItemId}/DailyStatsHistory` | GET | OHLCV daily stats | `GetDailyStatsHistoryResponse` |
| 14 | `/{Realm}/Leagues/{LeagueName}/Items/PriceHistory` | GET | Bulk price histories | `GetItemPriceHistoriesResponse` |
| 15 | `/{Realm}/Leagues/{LeagueName}/Currencies/ByCategory` | GET | Currencies by category (paginated) | `GetByCategoryResponse` |
| 16 | `/{Realm}/Leagues/{LeagueName}/Currencies/{ApiId}` | GET | Single currency by ApiId | Currency with PriceLogs |
| 17 | `/{Realm}/Leagues/{LeagueName}/Currencies/Pairs/{CurrencyOneItemId}/{CurrencyTwoItemId}/History` | GET | Exchange pair history | `GetPairHistoryResponse` |
| 18 | `/{Realm}/Leagues/{LeagueName}/Uniques/ByCategory` | GET | Unique items by category (paginated) | `GetUniqueItemsResponse` |
| 19 | `/` | GET | Root | API info |
| 20 | `/health/live` | GET | Liveness probe | Health status |
| 21 | `/health/ready` | GET | Readiness probe | Health status |

**Endpoint Parameter Names (from OpenAPI spec):**

> **NOTE:** The Swagger spec uses PascalCase path parameters: `{Realm}`, `{LeagueName}`, `{ItemId}`, `{CurrencyOneItemId}`, `{CurrencyTwoItemId}`. The base URL already includes `/api`. When constructing URLs in code, use these exact parameter names for the path segments.

**Detailed Response Shapes:**

```typescript
// /Realms — snake_case!
interface RealmOptionResponse {
  value: string;              // e.g. "poe2/poe2" (used as {Realm} path param)
  label: string;              // e.g. "PoE2"
  game_api_id: string;        // e.g. "poe2"
  realm_api_id: string;       // e.g. "poe2"
  trade_api_path: string;
  default_league_value: string; // e.g. "runes" — use this, NOT League.IsCurrent
}

// /{Realm}/Leagues — PascalCase
interface GetResponse {  // League
  Value: string;               // displayName
  ShortName: string;           // name
  IsCurrent: boolean;          // ⚠️ ALWAYS FALSE — use default_league_value from realm
  DivinePrice: number | null;
  ChaosDivinePrice: number | null;
  BaseCurrencyApiId: string;
  BaseCurrencyText: string;
  BaseCurrencyIconUrl: string | null;
  ExaltedCurrencyText: string;
  ExaltedCurrencyIconUrl: string;
  DivineCurrencyText: string;
  DivineCurrencyIconUrl: string;
  ChaosCurrencyText: string;
  ChaosCurrencyIconUrl: string;
  DefaultCurrency: {
    ApiId: string;
    Text: string;
    IconUrl: string | null;
    RelativePrice: number;
  } | null;
}

// /{Realm}/Leagues/{LeagueName}/Items/Categories
interface GetCategoriesResponse {
  UniqueCategories: Array<{ ItemCategoryId: number; ApiId: string; Label: string; Icon: string | null }>;
  CurrencyCategories: Array<{ CurrencyCategoryId: number; ApiId: string; Label: string; Icon: string | null }>;
}

// /{Realm}/Leagues/{LeagueName}/Currencies/ByCategory — paginated
interface GetByCategoryResponse {
  CurrentPage: number;
  Pages: number;
  Total: number;
  Items: RawCurrencyItem[];
}
// Query params: Category (required), ReferenceCurrency?, Search?, Page? (default 1), PerPage? (1–250, default 25)

// /{Realm}/Leagues/{LeagueName}/Uniques/ByCategory — paginated
interface GetUniqueItemsResponse {
  CurrentPage: number;
  Pages: number;
  Total: number;
  Items: RawUniqueItem[];
}
// Query params: Category (required), ReferenceCurrency?, Search?, Page?, PerPage?

// /{Realm}/Leagues/{LeagueName}/SnapshotPairs
interface GetSnapshotPairsResponse {
  CurrencyExchangeSnapshotPairId: number;
  CurrencyExchangeSnapshotId: number;
  Volume: number;
  BaseCurrencyApiId: string;
  BaseCurrencyText: string;
  CurrencyOne: { CurrencyItemId: number; ItemId: number; CurrencyCategoryId: number; ApiId: string; Text: string; CategoryApiId: string; IconUrl: string | null; ItemMetadata?: any };
  CurrencyTwo: { CurrencyItemId: number; ItemId: number; CurrencyCategoryId: number; ApiId: string; Text: string; CategoryApiId: string; IconUrl: string | null; ItemMetadata?: any };
  CurrencyOneData: { ValueTraded: number; RelativePrice: string; StockValue: number; VolumeTraded: number; HighestStock: number };
  CurrencyTwoData: { ValueTraded: number; RelativePrice: string; StockValue: number; VolumeTraded: number; HighestStock: number };
}

// /{Realm}/Leagues/{LeagueName}/Items/{ItemId}/History
interface GetPriceHistoryResponse {
  PriceHistory: Array<{ Price: number; Time: string; Quantity: number }>;
  HasMore: boolean;
}
// Query params: LogCount (required), EndTime?, ReferenceCurrency?

// /{Realm}/Leagues/{LeagueName}/Items/{ItemId}/DailyStatsHistory
interface GetDailyStatsHistoryResponse {
  DailyStats: Array<{ Time: string; Open: number; High: number; Low: number; Close: number; Average: number; Volume: number }>;
  HasMore: boolean;
  BaseCurrencyApiId: string;
  BaseCurrencyText: string;
}
// Query params: DayCount (required), EndDate?

// /{Realm}/Leagues/{LeagueName}/Currencies/Pairs/{CurrencyOneItemId}/{CurrencyTwoItemId}/History
interface GetPairHistoryResponse {
  History: Array<{ Epoch: number; Data: { CurrencyOneData: { ValueTraded: number; RelativePrice: string; StockValue: number; VolumeTraded: number; HighestStock: number }; CurrencyTwoData: { ...same... } } }>;
  Meta: { HasMore: boolean };
  BaseCurrencyApiId: string;
  BaseCurrencyText: string;
}
// Query params: Limit (required), EndEpoch?

// /{Realm}/Leagues/{LeagueName}/SnapshotHistory
interface GetSnapshotHistoryResponse {
  Data: Array<{ Epoch: number; MarketCap: number; Volume: number }>;
  Meta: { HasMore: boolean };
  BaseCurrencyApiId: string;
  BaseCurrencyText: string;
}
// Query params: Limit (required), EndEpoch?

// /{Realm}/Leagues/{LeagueName}/ExchangeSnapshot
interface GetExchangeSnapshotResponse {
  Epoch: number;
  Volume: number;
  MarketCap: number;
  BaseCurrencyApiId: string;
  BaseCurrencyText: string;
}

// /{Realm}/Leagues/{LeagueName}/ReferenceCurrencies
interface ReferenceCurrency {
  ApiId: string;
  Text: string;
  IconUrl: string | null;
  RelativePrice: number;
}

// /Realms/{Realm}/Filters
interface GetFiltersResponse {
  Filters: Array<{ DisplayName: string; Category: string; Identifier: string; ItemKind: string }>;
}

// /{Realm}/Leagues/{LeagueName}/Items/PriceHistory — bulk
interface GetItemPriceHistoriesResponse {
  ItemHistories: Array<{ ItemId: number; History: Array<{ Price: number; Time: string; Quantity: number }> }>;
}
```

**Critical Field Naming Conventions:**

```
PascalCase endpoints (most):    Value, ShortName, ApiId, Text, RelativePrice, ...
snake_case endpoint (/Realms):  value, label, realm_api_id, game_api_id, ...
```

**Critical Bug Warnings:**

1. **PriceLogs are REVERSE chronological** — newest first. Always sort by timestamp ascending before charting.
2. **Category=all returns EMPTY** — must fetch all categories and merge.
3. **League IsCurrent is always false** — use `default_league_value` from realm instead.
4. **String fields in numeric positions** — Volume, RelativePrice, etc. come as strings from some endpoints. Use `safeParseFloat()`.
5. **LogCount must be multiple of 4** — ItemHistory API returns 400 otherwise.
6. **Numeric ItemIds required** — `/Currencies/Pairs/{CurrencyOneItemId}/{CurrencyTwoItemId}/History` expects integers, not ApiId strings.
7. **Timezone: PriceLogs timestamps are UTC** — assume UTC unless API specifies otherwise.
8. **RelativePrice "0E-8"** — POE2Scout returns scientific-notation zero for some pairs. `safeParseFloat()` returns `null` for these.
9. **Realm path parameter** — The `value` field from `/Realms` is used as the `{Realm}` path parameter (e.g., `"poe2/poe2"` for PoE2, but `"poe2"` also works for most endpoints).

---

## §2. Frontend → Backend Data Flows

### 2.1 Market Data Flow (No Backend Required)

```
User Browser
    │
    ├─→ GET /api/poe2/health ─────────────→ poe2api.ts::getHealth()
    │                                            │
    │                                        cachedFetch(BASE_URL + "/health/live")
    │                                            │
    │                                        return: { status: string; apiBaseUrl: string }
    │
    ├─→ GET /api/poe2/realms ──────────────→ poe2api.ts::getRealms()
    │                                            │
    │                                        cachedFetch(BASE_URL + "/Realms")
    │                                            │
    │                                        map: RawRealm[] → Realm[]
    │                                        (extract realm_api_id → name, game_api_id → displayName,
    │                                         default_league_value → defaultLeague)
    │                                            │
    │                                        return: Realm[]
    │
    ├─→ GET /api/poe2/leagues ──────────────→ poe2api.ts::getLeagues()
    │        ?realm=poe2                          │
    │                                        cachedFetch(BASE_URL + "/{realm}/Leagues")
    │                                            │
    │                                        map: RawLeague[] → League[]
    │                                        (use ShortName for name, Value for displayName)
    │                                        (mark active using default_league_value)
    │                                        (extract BaseCurrencyApiId, BaseCurrencyText, DefaultCurrency)
    │                                            │
    │                                        return: League[]
    │
    ├─→ GET /api/poe2/exchange ──────────────→ poe2api.ts::getSnapshotPairs()
    │        ?realm=poe2&league=vaal              │
    │                                        cachedFetch(BASE_URL + "/{realm}/Leagues/{league}/SnapshotPairs")
    │                                            │
    │                                        map: RawSnapshotPair[] → ExchangePair[] (via mapSnapshotPair)
    │                                        Enrich with 7d changes via buildCurrencyChangeMap()
    │                                            │
    │                                        return: ExchangePair[]
    │
    ├─→ GET /api/poe2/currencies ──────────────→ poe2api.ts::getCurrenciesByCategory()
    │        ?realm=poe2&league=vaal&category=currency
    │                                            │
    │                                        If category="all":
    │                                          1. getItemCategories() → currencyCats[]
    │                                          2. For each cat: fetch all pages (perPage=250)
    │                                          3. Merge all items, client-side paginate
    │                                        Else:
    │                                          cachedFetch(...)
    │                                            │
    │                                        map: RawCurrencyItem → PoeItem (via mapCurrencyItem)
    │                                        (computeChangePercent from PriceLogs)
    │                                        (compute7dChangePercent from PriceLogs)
    │                                        (computeVolume24h from PriceLogs)
    │                                        (mapPriceLogs to history)
    │                                        (computePreviousPrice + delta → change)
    │                                        (computePrevious7dPrice + delta → sevenDayPriceChange)
    │                                        (CurrentPrice / referencePrice → relativePrice)
    │                                            │
    │                                        return: PaginatedResponse<PoeItem>
    │
    ├─→ GET /api/poe2/uniques ──────────────→ poe2api.ts::getUniquesByCategory()
    │        ?realm=poe2&league=vaal&category=all
    │                                            │
    │                                        Same logic as currencies — category="all" merges all.
    │                                        map: RawUniqueItem → PoeItem (via mapUniqueItem)
    │                                        (Text || Name → name, Type → type)
    │                                        Supports: search parameter for fuzzy search
    │                                            │
    │                                        return: PaginatedResponse<PoeItem>
    │
    ├─→ GET /api/poe2/items ──────────────→ poe2api.ts::getItems()
    │        ?realm=poe2&league=vaal              │
    │                                        cachedFetch(BASE_URL + "/{realm}/Leagues/{league}/Items")
    │                                            │
    │                                        return: PoeItem[]
    │
    └─→ GET /api/poe2/overview ──────────────→ Combined endpoint
             ?realm=poe2&league=vaal              │
                                              Returns:
                                              ├─ getExchangeSnapshot() → exchange data
                                              ├─ getSnapshotHistory() → chart data
                                              └─ getReferenceCurrencies() → reference pills
```

### 2.2 Flipper Analytics Flow (Requires FastAPI Backend)

```
User Browser
    │
    ├─→ GET /api/flipper/health ────────────→ flipper-proxy.ts::proxyToFlipper()
    │                                              │
    │                                          fetch(FLIPPER_API_URL + "/api/health")
    │                                              │
    │                                          return: FlipperHealthResponse
    │                                          {
    │                                            status: "ok"|"degraded"|"error"|"offline",
    │                                            provider: "reachable"|"unreachable",
    │                                            timestamp: ISO8601,
    │                                            league?: string,
    │                                            baseCurrency?: string,          // was base_currency
    │                                            activeEvents?: number,          // was active_events
    │                                            cacheEntries?: number,          // was cache_entries
    │                                            snapshot?: {
    │                                              snapshotValid, snapshotStale,  // transformed by proxy
    │                                              snapshotAgeSeconds, lastRefresh
    │                                            },
    │                                            dailyStatsCache?: {             // was daily_stats_cache
    │                                              size, maxSize, staleEntries, oldestEntryAge
    │                                            }
    │                                          }
    │
    ├─→ GET /api/flipper/phase ─────────────→ flipper-proxy.ts
    │                                              │
    │                                          fetch(FLIPPER_API_URL + "/api/phase")
    │                                              │
    │                                          return: FlipperPhaseResponse
    │                                          { phase: "EARLY"|"MID"|"LATE", days_since_ref: int, league: string }
    │
    ├─→ GET /api/flipper/prices ────────────→ routes_prices.py (FastAPI)
    │                                              │
    │                                          SnapshotManager.get_snapshot().get_prices()
    │                                              │
    │                                          return: PricesResponse
    │                                          { league, phase, rates: [{pair, currency_from, currency_to,
    │                                            raw_rate, volume_traded, stock_value, volatility,
    │                                            momentum, acceleration, cluster_from, cluster_to,
    │                                            timestamp}], base_currency, stale, data_available, fetched_at }
    │
    ├─→ GET /api/flipper/heatmap ────────────→ routes_prices.py
    │                                              │
    │                                          24h price change heatmap data
    │                                              │
    │                                          return: HeatmapResponse
    │
    ├─→ GET /api/flipper/currencies ─────────→ routes_prices.py
    │                                              │
    │                                          Currency metadata from DataSnapshot
    │                                              │
    │                                          return: CurrencyInfo[]
    │
    ├─→ GET /api/flipper/tiers ─────────────→ routes_prices.py
    │                                              │
    │                                          Tier classifications via classify_currencies()
    │                                              │
    │                                          return: TiersResponse
    │                                          { tiers: [{apiId, tier, tierLabel, relativePrice, tierAnchor}],
    │                                            boundaries: {t0Min..t4Min}, dataAvailable }
    │
    ├─→ GET /api/flipper/benchmarks/{currency} → routes_prices.py
    │                                              │
    │                                          Historical benchmarks via compute_benchmarks()
    │                                              │
    │                                          return: BenchmarksResponse
    │                                          { currencyApiId, currentPrice,
    │                                            benchmark: {low30d, high30d, rangePosition,
    │                                              percentile30d, currentVsAvg}, days, dataAvailable }
    │
    ├─→ GET /api/flipper/flips ──────────────→ routes_arbitrage.py
    │                                              │
    │                                          scorer.compute_flips() + quantized analysis
    │                                              │
    │                                          return: FlipsResponse
    │                                          { league, total, opportunities: [{
    │                                            currency, score, spread, spreadAfterFees(DEPRECATED),
    │                                            volume24h, momentum, volatility, cluster,
    │                                            bid, ask, midPrice,
    │                                            quantizedAnalysis?: {
    │                                              qSpreads, minProfitableLot, optimalLotProfitPct,
    │                                              recommendedRatio, brickResistance, theoreticalSpread
    │                                            },
    │                                            tierDistance?
    │                                          }], eventStatus: {anyActive, affectedCurrencies, summary},
    │                                          fetchedAt, dataAvailable?, feeWarning? }
    │
    ├─→ GET /api/flipper/triangular ─────────→ routes_arbitrage.py
    │                                              │
    │                                          triangular.find_triangular_arbitrage()
    │                                          + integer simulation + quantized profit
    │                                              │
    │                                          return: TriangularResponse
    │                                          { league, total, opportunities: [{
    │                                            cycle, netProfitPct, stepRates, totalVolume,
    │                                            confidence, minStartingAmount?,
    │                                            quantizedProfitPct?, continuousProfitPct?,
    │                                            integerSimulation?
    │                                          }], fetchedAt, dataAvailable?, feeWarning? }
    │
    ├─→ ~~GET /api/flipper/forecast/{currency} → routes_forecast.py~~ ⛔ DEPRECATED — file does not exist
    │                                              │
    │                                          ~~ForecastEngine.forecast() (3 models in parallel)~~
    │                                              │
    │                                          ~~return: ForecastResponse (per model: SARIMA, Holt-Winters, LightGBM)~~
    │                                          ~~{ currency, model_name, point_forecast, ci_lower, ci_upper,
    │                                            timestamps, low_confidence, disagreement, mape }~~
    │
    ├─→ ~~GET /api/flipper/forecast/{currency}/stl → routes_forecast.py~~ ⛔ DEPRECATED — file does not exist
    │                                              │
    │                                          ~~STL decomposition of price series~~
    │                                              │
    │                                          ~~return: STL decomposition data~~
    │
    ├─→ GET /api/flipper/anomalies ──────────→ routes_anomalies.py
    │                                              │
    │                                          AnomalyDetector.detect_anomalies_batch()
    │                                          (Z-score, MACD, RSI, STL residual, sustained momentum)
    │                                              │
    │                                          return: AnomalyAlert[]
    │                                          { currency, timestamp, alertScore, triggeredIndicators,
    │                                            direction, isConfirmed }
    │
    ├─→ GET /api/flipper/storage-value/{currency} → routes_storage_value.py
    │                                              │
    │                                          project_value() — hold/sell decision
    │                                              │
    │                                          return: StorageValueResult
    │                                          { currency, currentPrice, projectedPrice,
    │                                            riskDiscount, adjustedPrice, netValueAfterFees,
    │                                            ratio, decision: "BUY_HOLD"|"SELL_CONVERT"|"NEUTRAL" }
    │
    ├─→ ~~GET /api/flipper/portfolio ────────────→ routes_portfolio.py~~ ⛔ DEPRECATED — file does not exist
    │                                              │
    │                                          ~~PortfolioOptimizer.optimize()~~
    │                                          ~~(risk_parity or min_variance, Ledoit-Wolf shrinkage)~~
    │                                              │
    │                                          ~~return: PortfolioData~~
    │                                          ~~{ method, weights: {currency: weight}, expectedRisk,
    │                                            correlationWarning, lastRebalance }~~
    │
    ├─→ ~~GET /api/flipper/portfolio/frontier ──→ routes_portfolio.py~~ ⛔ DEPRECATED — file does not exist
    │                                              │
    │                                          ~~compute_efficient_frontier_chart_data()~~
    │                                              │
    │                                          ~~return: Efficient frontier data (scatter plot)~~
    │
    ├─→ ~~GET /api/flipper/portfolio/correlation → routes_portfolio.py~~ ⛔ DEPRECATED — file does not exist
    │                                              │
    │                                          ~~Correlation matrix for portfolio currencies~~
    │                                              │
    │                                          ~~return: Correlation matrix data~~
    │
    ├─→ ~~POST /api/flipper/portfolio/rebalance → routes_portfolio.py~~ ⛔ DEPRECATED — file does not exist
    │                                              │
    │                                          ~~Trigger portfolio rebalance~~
    │                                              │
    │                                          ~~return: Rebalance result~~
    │
    ├─→ ~~GET /api/flipper/recipes ────────────────→ routes_recipes.py~~ ⛔ DEPRECATED — file does not exist
    │                                              │
    │                                          ~~find_profitable_recipes()~~
    │                                              │
    │                                          ~~return: RecipeOpportunity[]~~
    │                                          ~~{ name, inputs, output, input_cost_chaos,
    │                                            output_value_chaos, profit_chaos, profit_pct }~~
    │
    ├─→ GET /api/flipper/events ────────────────→ routes_events.py
    │                                              │
    │                                          Load from SQLite via EventManager
    │                                              │
    │                                          return: FlipperEventsSummary
    │                                          { events: [{id, type, description, created_at,
    │                                            expires_at, is_active, metadata}], total }
    │
    ├─→ POST /api/flipper/events ────────────────→ routes_events.py
    │                                              │
    │                                          Create new event
    │                                              │
    ├─→ DELETE /api/flipper/events/{eventId} ──→ routes_events.py
    │                                              │
    │                                          Delete event
    │
    ├─→ POST /api/flipper/events/{eventId}/deactivate → routes_events.py
    │                                              │
    │                                          Deactivate event (set is_active=false)
    │
    ├─→ WebSocket /ws/storage-value/{currency} → routes_ws.py
    │        Live storage value updates
    │
    ├─→ WebSocket /ws/forecast/{currency} ────→ routes_ws.py
    │        Live forecast updates
    │
    ├─→ WebSocket /ws/anomalies ──────────────→ routes_ws.py
    │        Live anomaly alerts
    │
    ├─→ WebSocket /ws/flips ──────────────────→ routes_ws.py
    │        Live flip opportunity alerts
    │
    └─→ WebSocket /ws/events ─────────────────→ routes_ws.py
             Live event notifications
```

---

## §3. Backend Internal Data Flows

### 3.1 Poe2ScoutProvider → SnapshotManager → Analytics

```
POE2Scout API
    │
    ├─→ Poe2ScoutProvider.get_exchange_rates(league)
    │        │
    │        httpx.AsyncClient GET "/SnapshotPairs"
    │        (10s timeout, semaphore max 5 concurrent, 2 retries on 429)
    │        │
    │        Derive cross-rates from relative_price
    │        │
    │        return: {"{from}/{to}": ExchangeRate, ...}
    │
    ├─→ Poe2ScoutProvider.get_currency_metadata(league)
    │        │
    │        For each category: fetch all pages (250/page)
    │        │
    │        return: CurrencyInfo[]
    │
    ├─→ Poe2ScoutProvider.get_historical_prices(currency, days)
    │        │
    │        httpx GET "/Currencies/{currency}"
    │        │
    │        return: PricePoint[]
    │
    ├─→ Poe2ScoutProvider.get_all_currencies_with_prices(league)
    │        │
    │        Fetches all ByCategory currencies across all pages
    │        │
    │        return: list[dict]  (raw currency data with prices)
    │
    └─→ Poe2ScoutProvider.get_daily_stats(league, item_id, ...)
             │
             httpx GET "/Items/{item_id}/DailyStatsHistory"
             │
             return: dict | None

Poe2ScoutProvider
    │
    ├─→ SnapshotManager._refresh()
    │        │
    │        1. get_exchange_rates() → snapshot.exchange_rates
    │        2. get_currency_metadata() → snapshot.currencies + snapshot.currency_metadata
    │        3. For each currency: get_historical_prices() → snapshot.price_histories
    │        4. Compute transitive prices via BFS for currencies without direct base pair
    │           → snapshot.current_prices, snapshot.prices_in_base
    │        5. Apply clustering (KMeans on volatility, price_change, liquidity)
    │           → CurrencyClusterer
    │        6. Compute momentum/volatility/acceleration per currency
    │           → PriceMomentumTracker
    │        7. Tier classification via classify_currencies()
    │           → snapshot.tiers
    │        8. Cache with TTL (config: cache_ttl_prices_minutes, default 5 min)
    │        │
    │        return: updated DataSnapshot
    │
    ├─→ SnapshotManager.get_snapshot()
    │        │
    │        if stale and not refreshing: _refresh()
    │        │
    │        return: DataSnapshot
    │
    └─→ DataScheduler (APScheduler, config-driven intervals)
             │
             collect_price_snapshot() — every 30 min (config: price_snapshot_interval_minutes)
                 │
                 HistoricalStore.append_prices(snapshot)
                 │
                 (broadcast to WebSocket clients)
             │
             prune_events() — every 15 min (config: event_pruning_interval_minutes)
             │
             persist_models() — every 30 min (config: model_persistence_interval_minutes)
                 │
                 ModelStore.save() — persist LightGBM models to disk
```

### 3.2 DataSnapshot Dataclass

```python
@dataclass
class DataSnapshot:
    exchange_rates: dict[str, ExchangeRate]
    currencies: list[CurrencyInfo]
    currency_metadata: list[dict]        # raw currency data with prices
    price_histories: dict[str, list[PricePoint]]
    current_prices: dict[str, float]     # currency → price in base currency
    prices_in_base: dict[str, float]     # transitive prices via BFS
    tiers: list[CurrencyTier]            # tier classifications
    fetched_at: datetime
    valid: bool
```

### 3.3 HistoricalStore (SQLite Persistence)

```
HistoricalStore/
    │
    ├─→ init() ──────────────────────────→ Create tables if not exist
    │                                           prices_history (id AUTO, currency, timestamp, price, volume, UNIQUE(currency, timestamp))
    │                                           events (event_id TEXT PK, type, description, created_at, expires_at, is_active, metadata JSON)
    │                                           price_snapshots (id AUTO, timestamp, data BLOB)
    │                                           indexes: prices_history(currency, timestamp), events(is_active, expires_at)
    │
    ├─→ append_prices(snapshot) ──────────→ INSERT INTO prices_history
    │                                           (for each currency in snapshot)
    │                                           ON CONFLICT(currency, timestamp) DO UPDATE SET price=excluded.price, volume=excluded.volume
    │
    ├─→ get_price_history(currency, days) ─→ SELECT timestamp, price, volume
    │                                           WHERE currency = ? AND timestamp > ?
    │                                           ORDER BY timestamp ASC
    │
    ├─→ get_recent_prices(currencies, hours) ─→ SELECT * FROM prices_history
    │                                             WHERE currency IN (?) AND timestamp > ?
    │
    ├─→ save_event(event) ─────────────────→ INSERT INTO events
    │                                           (id, type, description, created_at, expires_at, is_active, metadata)
    │
    ├─→ load_events() ─────────────────────→ SELECT * FROM events WHERE is_active = 1 AND expires_at > NOW()
    │
    └─→ prune_expired_events() ─────────────→ UPDATE events SET is_active = 0 WHERE expires_at < NOW()
```

### 3.4 Additional Backend Stores

| Store | File | Purpose | TTL / Limits |
|-------|------|---------|--------------|
| `PipelineCache` | `backend/data/pipeline_cache.py` | TTL-based cache for computed pipeline results | Configurable per entry |
| `DailyStatsCache` | `backend/data/daily_stats_cache.py` | LRU + TTL cache for daily OHLCV stats | LRU with max size + per-entry TTL |
| `ModelStore` | `backend/predictors/model_store.py` | Persist/reload LightGBM models to/from disk | Persisted every 30 min by scheduler |

### 3.5 Scheduled Tasks (APScheduler via DataScheduler)

| Job ID | Schedule | Function | Description |
|--------|----------|----------|-------------|
| `collect_price_snapshot` | Every 30 min (config: `price_snapshot_interval_minutes`) | `SnapshotManager._refresh()` + `HistoricalStore.append_prices()` | Fetch fresh data, persist to SQLite |
| `prune_events` | Every 15 min (config: `event_pruning_interval_minutes`) | `EventManager.prune_expired()` | Clean up expired events |
| `persist_models` | Every 30 min (config: `model_persistence_interval_minutes`) | `ModelStore.save()` | Persist LightGBM models to disk |

> **⚠️ CORRECTION (2026-06-02):** The old version documented a 5-minute snapshot interval and several jobs (broadcast_update, warm_cache, prune_history) that no longer exist. The actual scheduler runs 3 jobs with configurable intervals from `config.yaml`. The `warm_cache` and `prune_history` jobs have been removed. Broadcasting is done inline after snapshot refresh.

### 3.6 Backend Config (config.yaml → Pydantic Settings)

| Config Section | Key Fields | Defaults |
|----------------|-----------|----------|
| `data` | `primary_provider="poe2scout"`, `fallback_provider="official"`, `poe2scout_base_url`, `cors_proxy_url=""`, `cors_proxy_fallback_enabled=True`, `cache_ttl_prices_minutes=5`, `cache_ttl_history_hours=24`, `rate_limit_per_second=1.0`, `historical_retention_days=90` | — |
| `league` | `league_name="runes"`, `realm="poe2"`, `phase_early_days=7`, `phase_mid_days=35`, `base_currency="exalted"` | — |
| `filters` | `min_volume_24h=200`, `max_volatility=0.4`, `max_spread=0.15` | — |
| `scoring` | `momentum_negative_threshold=-0.01`, `volatility_reference=0.05`, `phase_multiplier_early/mid/late=1.2/1.0/0.9`, `flashback_multiplier=1.5`, `event_multiplier=2.0` | — |
| `forecasting` | `sarima_seasonal_period=None`, `lightgbm_retrain_interval_hours=6`, `lightgbm_min_data_points=15`, `forecast_horizon_hours=24`, `significance_level=0.05` | — |  
| `anomaly` | `bonferroni_alpha=0.01`, `alert_score_threshold=0.4`, `rsi_period=14`, `rsi_overbought=70`, `rsi_oversold=30`, `macd_fast/slow/signal=12/26/9` | — |
| `clustering` | `n_clusters=3`, `recluster_interval_hours=1` | — |
| `portfolio` | `method="risk_parity"`, `correlation_shock_threshold=0.5`, `ledoit_wolf_shrinkage=True`, `rebalance_interval_hours=24` | — |
| `events` | `default_expiry_hours=48`, `event_score_penalty=0.5` | — |
| `scheduler` | `price_snapshot_interval_minutes=30`, `reclustering_interval_hours=1`, `model_persistence_interval_minutes=30`, `event_pruning_interval_minutes=15` | — |
| `tiers` | `t0_min=50`, `t1_min=10`, `t2_min=1`, `t3_min=0.1`, `t4_min=0.01` | — |
| `quantization` | `default_lot_sizes=[1,5,10,50,100]`, `max_lot_search=10000`, `brick_resistance_weight=0.2` | — |
| `storage_value` | `buy_threshold=1.03`, `sell_threshold=0.97`, `liquidity_normalization=10.0` | — |
| `benchmarks` | `lookback_days=30`, `include_league_lifetime=True` | — |

Singleton: `get_settings() → AppConfig`

---

## §4. Field Transformation Reference

### 4.1 PoeItem Transformation (Frontend)

```typescript
// Source: RawCurrencyItem or RawUniqueItem from POE2Scout API
// Destination: PoeItem (src/lib/types.ts)

interface RawCurrencyItem {
  CurrencyItemId: number;     // ⚠️ Use for API calls, not ItemId!
  ItemId: number;             // Alternative identifier
  CurrencyCategoryId: number;
  ApiId: string;             // e.g. "divine", "exalted"
  Text: string;              // e.g. "Divine Orb"
  CategoryApiId: string;     // e.g. "currency"
  IconUrl: string | null;
  ItemMetadata?: any;
  PriceLogs: (RawPriceLogEntry | null)[];  // ⚠️ NEWEST FIRST!
  CurrentPrice: number | null;
  CurrentQuantity: number | null;
}

interface RawUniqueItem {
  UniqueItemId: number;      // ⚠️ Different from CurrencyItemId!
  ItemId: number;
  ApiId: string;
  Text: string;              // Primary name
  Name: string;              // Alternative name (used as fallback: Text || Name)
  CategoryApiId: string;
  Type: string;              // Item type (mapped to PoeItem.type)
  IconUrl: string | null;
  IsChanceable?: boolean;
  ItemMetadata?: any;
  PriceLogs: (RawPriceLogEntry | null)[];  // ⚠️ NEWEST FIRST!
  CurrentPrice: number | null;
  CurrentQuantity: number | null;
}

interface PoeItem {
  id: string;                // = String(CurrencyItemId || UniqueItemId || ItemId)
  apiId: string;             // = ApiId
  name: string;              // = Text (or Text || Name for uniques)
  type: string;              // = CategoryApiId (or Type for uniques)
  category: string;          // = CategoryApiId
  iconUrl: string | null;    // = IconUrl
  price: number | null;      // = CurrentPrice
  chaosEquivalentRate: number | null; // = CurrentPrice (chaos-equivalent rate)
  relativePrice: number | null; // = CurrentPrice / referencePrice
  change: number | null;     // = currentPrice - computePreviousPrice(PriceLogs)
  changePercent: number | null; // = computeChangePercent(PriceLogs) — 24h
  volume: number | null;     // = computeVolume24h(PriceLogs)
  sevenDayPriceChange: number | null; // = currentPrice - computePrevious7dPrice(PriceLogs)
  sevenDayPriceChangePercent: number | null; // = compute7dChangePercent(PriceLogs)
  history: PoeItemHistoryPoint[] | null; // = mapPriceLogs(PriceLogs)
  dailyStats: DailyStat[] | null;       // = null (fetched separately)
  lowConfidence: boolean;    // = CurrentQuantity < 5
  listingCount: number | null; // = CurrentQuantity
  baseType: null;            // Hardcoded null (not in API)
  links: null;               // Hardcoded null
  variant: null;             // Hardcoded null
  levelRequired: null;       // Hardcoded null
}
```

### 4.2 ExchangePair Transformation

```typescript
// Source: RawSnapshotPair from POE2Scout API (GetSnapshotPairsResponse)
// Destination: ExchangePair (src/lib/types.ts)

interface RawSnapshotPair {
  CurrencyExchangeSnapshotPairId: number;
  CurrencyExchangeSnapshotId: number;
  Volume: number;
  BaseCurrencyApiId: string;
  BaseCurrencyText: string;
  CurrencyOne: { CurrencyItemId: number; ItemId: number; CurrencyCategoryId: number; ApiId: string; Text: string; CategoryApiId: string; IconUrl: string | null; ItemMetadata?: any };
  CurrencyTwo: { ...same structure... };
  CurrencyOneData: { ValueTraded: number; RelativePrice: string; StockValue: number; VolumeTraded: number; HighestStock: number };
  CurrencyTwoData: { ValueTraded: number; RelativePrice: string; StockValue: number; VolumeTraded: number; HighestStock: number };
}

interface ExchangePair {
  id: string;                  // = String(CurrencyExchangeSnapshotPairId)
  currency1Id: string;         // = CurrencyOne.ApiId (e.g. "divine")
  currency1Name: string;       // = CurrencyOne.Text (e.g. "Divine Orb")
  currency1IconUrl: string | null; // = CurrencyOne.IconUrl
  currency1ItemId: number;     // = CurrencyOne.ItemId (⚠️ NUMERIC! Use for history API)
  currency2Id: string;
  currency2Name: string;
  currency2IconUrl: string | null;
  currency2ItemId: number;
  price: number | null;        // = safeParseFloat(CurrencyOneData.RelativePrice) — null for "0E-8"
  relativePrice: number;       // = price ?? 0
  volume: number;              // = CurrencyOneData.VolumeTraded
  change: number | null;       // Enriched later via buildCurrencyChangeMap()
  changePercent: number | null; // Enriched later via buildCurrencyChangeMap()
  sevenDayChange: number | null; // Enriched later via buildCurrencyChangeMap()
  sevenDayChangePercent: number | null; // Enriched later via buildCurrencyChangeMap()
  history: ExchangePairHistoryPoint[] | null; // Fetched on demand
}
```

**⚠️ CRITICAL:** Use `currency1ItemId` (numeric) for history API calls, NOT `currency1Id` (string ApiId).

### 4.3 OHLCVCandle (exported from poe2api.ts)

```typescript
// ⚠️ NOTE: This interface is exported from poe2api.ts, NOT types.ts
export interface OHLCVCandle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
```

### 4.4 Flipper-Specific Types

```typescript
interface FlipOpportunity {
  currency: string;
  score: number;                // 0.0 to 1.0
  spread: number;               // Raw spread (no fees)
  spreadAfterFees: number;      // ⚠️ DEPRECATED — kept for backward compat
  volume24h: number;            // was volume_24h in backend response (transformed by proxy)
  momentum: number;
  volatility: number;
  cluster: string;              // "stable"|"moderate"|"volatile_illiquid"
  bid: number;
  ask: number;
  midPrice: number;             // was mid_price in backend response (transformed by proxy)
  quantizedAnalysis?: QuantizedAnalysis;  // was quantized_analysis (transformed by proxy)
  tierDistance?: number;        // was tier_distance (transformed by proxy)
}

interface QuantizedAnalysis {
  qSpreads: QuantizedSpread[];
  minProfitableLot: number;
  optimalLotProfitPct: number;
  recommendedRatio: number;
  brickResistance: number;
  theoreticalSpread: number;
}

interface QuantizedSpread {
  lotSize: number;
  actualCost: number;
  actualRevenue: number;
  netProfit: number;
  grossProfitPct: number;
  qSpread: number;
}

interface CurrencyTier {
  apiId: string;
  tier: number;          // 0-4
  tierLabel: string;     // e.g. "T0", "T1", etc.
  relativePrice: number;
  tierAnchor: string;    // Name of tier boundary currency
}

interface HistoricalBenchmark {
  low30d: number;
  high30d: number;
  rangePosition: number; // 0-1, where current price sits in 30d range
  percentile30d: number;
  currentVsAvg: number;  // % above/below 30d average
}

interface AnomalyAlert {
  currency: string;
  timestamp: string;
  alertScore: number;          // 0.0-1.0 (was alert_score, transformed by proxy)
  triggeredIndicators: string[];  // was triggered_indicators (transformed by proxy)
  direction: string;           // "up"|"down"|null
  isConfirmed: boolean;        // was is_confirmed (transformed by proxy)
}

interface StorageValueResult {
  currency: string;
  currentPrice: number;         // was current_price (transformed by proxy)
  projectedPrice: number;       // was projected_price (transformed by proxy)
  riskDiscount: number;         // was risk_discount (transformed by proxy)
  adjustedPrice: number;        // was adjusted_price (transformed by proxy)
  netValueAfterFees: number;    // was net_value_after_fees (transformed by proxy)
  ratio: number;
  decision: "BUY_HOLD"|"SELL_CONVERT"|"NEUTRAL";
}
```

---

## §5. Formula Reference (Canonical)

> **IMPORTANT:** All formulas in this section are the authoritative source. When modifying calculations, update this section AND `PoE2_Flipper_Canonical_Formulas.md`. See the canonical formulas file for full verification examples.

### 5.1 Price Change Calculations (Frontend)

```typescript
// §5.1.1: PriceLogs sorting (MUST DO BEFORE ANY COMPUTATION)
function sortPriceLogs(logs: RawPriceLogEntry[]): RawPriceLogEntry[] {
  return [...logs].sort((a, b) =>
    new Date(a.Time).getTime() - new Date(b.Time).getTime()  // ASCENDING (oldest first)
  );
}

// §5.1.2: Compute 24h change percent
// Formula: ((current_price - price_24h_ago) / price_24h_ago) * 100
function computeChangePercent(logs: RawPriceLogEntry[]): number | null {
  const sorted = sortPriceLogs(logs);
  if (sorted.length < 2) return null;

  const now = sorted[sorted.length - 1];
  const targetTime = new Date(now.Time.getTime() - 24 * 60 * 60 * 1000);

  let closest = sorted[0];
  let minDiff = Infinity;
  for (const log of sorted) {
    const diff = Math.abs(log.Time.getTime() - targetTime.getTime());
    if (diff < minDiff) { minDiff = diff; closest = log; }
  }

  if (minDiff > 6 * 60 * 60 * 1000) return null; // >6h gap → too sparse
  return ((now.Price - closest.Price) / closest.Price) * 100;
}

// §5.1.3: Compute 7d change percent
function compute7dChangePercent(logs: RawPriceLogEntry[]): number | null {
  const sorted = sortPriceLogs(logs);
  if (sorted.length < 2) return null;

  const now = sorted[sorted.length - 1];
  const targetTime = new Date(now.Time.getTime() - 7 * 24 * 60 * 60 * 1000);

  let closest = sorted[0];
  let minDiff = Infinity;
  for (const log of sorted) {
    const diff = Math.abs(log.Time.getTime() - targetTime.getTime());
    if (diff < minDiff) { minDiff = diff; closest = log; }
  }

  if (minDiff > 12 * 60 * 60 * 1000) return null; // >12h gap
  return ((now.Price - closest.Price) / closest.Price) * 100;
}

// §5.1.4: Compute 24h volume
// Formula: SUM(Quantity) for all logs within 24h of latest
function computeVolume24h(logs: RawPriceLogEntry[]): number | null {
  const sorted = sortPriceLogs(logs);
  if (sorted.length === 0) return null;

  const latestTime = sorted[sorted.length - 1].Time;
  const cutoff = new Date(latestTime.getTime() - 24 * 60 * 60 * 1000);

  return sorted
    .filter(l => l.Time >= cutoff)
    .reduce((sum, l) => sum + (l.Quantity || 0), 0);
}

// §5.1.5: Relative price
function computeRelativePrice(currentPrice: number, referencePrice: number): number {
  if (!currentPrice || !referencePrice) return 0;
  return currentPrice / referencePrice;
}
```

### 5.2 Backend Analytics Formulas

#### 5.2.1 League Phase Detection

```python
# backend/economy/lifecycle.py — PhaseDetector

days_since_reference = floor((current_utc - reference_timestamp) / 86400)
reference_timestamp = max(league_start_timestamp, last_major_patch_timestamp)

if days_since_reference <= phase_early_days:   → EARLY   (default: 7 days)
elif days_since_reference <= phase_mid_days:    → MID     (default: 35 days)
else:                                            → LATE

# Resets on major patch detection
```

#### 5.2.2 Momentum, Volatility, Acceleration

```python
# backend/economy/momentum.py — PriceMomentumTracker
# See PoE2_Flipper_Canonical_Formulas.md §2 for full verification

log_returns[i] = ln(P[i+1] / P[i])

momentum = mean(log_returns)
volatility = std(log_returns, ddof=1)  # ⚠️ ddof=1 — Bessel's correction
acceleration = (log_returns[-1] - log_returns[-m]) / m
    where m = max(1, floor(len(log_returns) / 4))
```

#### 5.2.3 Currency Clustering (KMeans)

```python
# backend/predictors/clustering.py — CurrencyClusterer
# See PoE2_Flipper_Canonical_Formulas.md §5 for full verification

# Features per currency:
volatility_24h = std(log_returns, ddof=1)
price_change_rate_24h = (price_now - price_24h_ago) / price_24h_ago
liquidity_score_24h = log1p(volume_24h) / log1p(max_volume)

# Min-max normalize to [0,1] (all identical → 0.5)

# KMeans(n_clusters=3, init='k-means++', n_init=10, random_state=42)

# Label assignment (post-hoc, centroid-based):
#   stable           = argmin(centroid[:, 0])  # lowest volatility
#   volatile_illiquid = argmax(centroid[:, 0])  # highest volatility
#   moderate          = remaining cluster
# Tiebreaker (volatility diff < 0.1): lower liquidity → volatile_illiquid
```

#### 5.2.4 Spread Estimation Model

> **⚠️ IMPORTANT (Step 4):** The previous model used volume + volatility only.
> The new model (Step 4) uses real SnapshotPair data: HighestStock as a liquidity
> proxy, combined with volume for tighter spreads on deep-orderbook pairs.
> BFS-computed transitive prices get a 1.5x widening. Stale data is filtered out.

```python
# backend/api/routes_arbitrage.py — _build_flip_opportunities()
# See PoE2_Flipper_Canonical_Formulas.md §7.1.1 for full details

# Step 1: Liquidity-based spread (volume + stock depth from SnapshotPair)
if volume > 0 and highest_stock > 0:
    liquidity_score = log1p(volume) * log1p(highest_stock)
    liquidity_spread = 0.04 / (1.0 + liquidity_score / 40.0)
elif volume > 0:
    liquidity_spread = 0.05 / (1.0 + log1p(volume) / 8.0)  # volume-only fallback
else:
    liquidity_spread = 0.08  # 8% for zero-volume pairs

# Step 2: Volatility component
vol_spread = volatility * 0.5

# Step 3: Base spread = liquidity + volatility
market_spread = liquidity_spread + vol_spread

# Step 4: BFS fallback widening (1.5x for transitive prices)
market_spread *= 1.5 if is_bfs_pair else 1.0

# Step 5: Apply bounds [0.5%, 15%]
market_spread = max(0.005, min(0.15, market_spread))

# Step 6: Momentum amplification (capped at 50% wider)
momentum_24h_raw = abs(exp(momentum * 24) - 1)
momentum_factor = min(momentum_24h_raw, 0.5)
total_spread = market_spread * (1.0 + momentum_factor)
total_spread = min(total_spread, 0.20)  # hard cap at 20%

# Step 7: Derive bid/ask from mid_price and total_spread
bid = mid_price * (1 - total_spread / 2)
ask = mid_price * (1 + total_spread / 2)
```

#### 5.2.5 Flip Opportunity Scoring

```python
# backend/arbitrage/scorer.py
# See PoE2_Flipper_Canonical_Formulas.md §7 for full verification

# Score = expected_profit * momentum_penalty * vol_penalty * phase_multiplier
# Output: 0.0 to 1.0
# Gold/commission fees are EXCLUDED from all calculations.

spread = (ask - bid) / mid_price
if spread <= 0: return 0.0

fill_probability = log1p(volume_24h) / log1p(max_volume)
fill_probability = min(fill_probability, 1.0)

expected_profit = spread * fill_probability

# Momentum penalty (filter-style, NOT additive)
if momentum < momentum_neg_threshold:  # default: -0.01
    momentum_penalty = 0.5
elif momentum < 0:
    momentum_penalty = 0.8
else:
    momentum_penalty = 1.0

# Volatility penalty
vol_penalty = 1.0 / (1.0 + (volatility / vol_reference) ** 2)  # default: 0.05

# Phase multiplier
PHASE_MULTIPLIERS = { 'early': 1.2, 'mid': 1.0, 'late': 0.9 }
# League type multipliers (stack on top):
#   standard: 1.0, flashback: 1.5, event: 2.0

score = expected_profit * momentum_penalty * vol_penalty * phase_multiplier
return clamp(score, 0.0, 1.0)
```

#### 5.2.6 Quantized Analysis

```python
# backend/arbitrage/scorer.py — compute_quantized_analysis()
# For each lot_size in config.default_lot_sizes [1, 5, 10, 50, 100]:
#   actual_cost = bid * lot_size
#   actual_revenue = ask * lot_size
#   net_profit = actual_revenue - actual_cost  # no gold fees
#   gross_profit_pct = (ask - bid) / mid_price * 100
#   q_spread = (ask - bid) / mid_price
#
# minProfitableLot = smallest lot where net_profit > 0
# optimalLotProfitPct = max profit_pct across all lots
# brickResistance = weighted measure of lot size vs spread (weight from config)
# theoreticalSpread = raw (ask - bid) / mid_price
```

#### 5.2.7 Tier Classification

```python
# backend/economy/tiers.py
# Boundaries from config: t0_min=50, t1_min=10, t2_min=1, t3_min=0.1, t4_min=0.01

def compute_tier(relative_price: float, boundaries: TierBoundaryConfig) -> int:
    """Returns tier 0-4 based on relative_price vs tier boundaries."""
    if relative_price >= boundaries.t0_min: return 0
    if relative_price >= boundaries.t1_min: return 1
    if relative_price >= boundaries.t2_min: return 2
    if relative_price >= boundaries.t3_min: return 3
    if relative_price >= boundaries.t4_min: return 4
    return 4  # below t4_min still tier 4

def tier_distance(tier_a: int, tier_b: int) -> int:
    """Absolute difference between tiers — used in flip scoring."""
    return abs(tier_a - tier_b)
```

#### 5.2.8 Triangular Arbitrage Detection

```python
# backend/arbitrage/triangular.py
# See PoE2_Flipper_Canonical_Formulas.md §8 for full details

def find_triangular_arbitrage(
    rates: dict[tuple[str, str], float],  # (from, to) -> raw_rate
    config: AppConfig,
    min_profit_pct: float = 0.1,
) -> list[TriangularOpportunity]:
    """
    Bellman-Ford negative cycle detection.

    Gold/commission fees are EXCLUDED — raw rates used directly.
    Edge weight: -ln(raw_rate)

    Additional outputs:
    - simulate_cycle_integers(): integer-based simulation for real trading
    - find_min_profitable_start(): minimum amount to start the cycle
    - quantized_profit_pct: profit accounting for lot sizes
    - continuous_profit_pct: theoretical continuous rate
    """
```

#### 5.2.9 Portfolio Optimization

```python
# backend/arbitrage/portfolio.py — PortfolioOptimizer

# TWO methods: risk_parity (default) and min_variance
# BOTH use Ledoit-Wolf shrinkage for covariance matrix

# Risk Parity (equal risk contribution):
def risk_parity_weights(cov: np.ndarray) -> np.ndarray:
    # Minimize: sum((w_i * marginal_risk_i - portfolio_risk/n)^2)
    # Subject to: sum(w_i) = 1, w_i >= 0
    # Bounds: (0.01, 1.0) per asset
    # Initial guess: inverse volatility weights
    # Method: SLSQP

# Minimum Variance:
def min_variance_weights(cov: np.ndarray) -> np.ndarray:
    # Minimize: w^T @ cov @ w
    # Subject to: sum(w_i) = 1, w_i >= 0

# Efficient Frontier:
def compute_efficient_frontier_chart_data(...) -> dict:
    # Grid of target returns → optimal portfolio weights at each level

# Correlation Shock Detection:
def detect_correlation_shock(corr_matrix, threshold=0.5) -> bool:
    # Flag if any off-diagonal element exceeds threshold
```

#### 5.2.10 Forecasting (Three Models in Parallel)

```python
# backend/predictors/time_series.py — ForecastEngine
# See PoE2_Flipper_Canonical_Formulas.md §2 for log-return math

# Three models run in parallel:
# 1. SARIMA — auto_arima with ADF test for stationarity
# 2. Holt-Winters — exponential smoothing (short-horizon secondary)
# 3. LightGBM — primary short-horizon with feature engineering
#
# All models operate on log-prices; convert back at output.

# Model agreement check:
# if SARIMA and LightGBM diverge >20%: flag disagreement=True on both

# Event flag behavior:
# - SARIMA: labeled low_confidence=True when event active
# - Holt-Winters: disabled entirely when event active
# - LightGBM: includes is_event_active feature

# Additional: STL decomposition endpoint
# compute_stl_decomposition() for seasonal/trend/residual analysis
```

#### 5.2.11 Anomaly Detection (5 Indicators)

```python
# backend/predictors/anomaly.py — AnomalyDetector
# See PoE2_Flipper_Canonical_Formulas.md §4 for full details

# 1. Z-Score with Bonferroni Correction
#    threshold ≈ 3.41 for N=30 currencies (bonferroni_alpha = 0.01/N)

# 2. MACD (Moving Average Convergence Divergence)
#    EMA_fast=12, EMA_slow=26, Signal=9

# 3. RSI (Relative Strength Index)
#    period=14, overbought=70, oversold=30

# 4. STL Residual Anomaly
#    MAD-based threshold (robust to outliers)

# 5. Sustained Momentum Direction
#    m=3 consecutive log-returns all positive or all negative

# Ensemble alert scoring:
# alert_score = sum(weight_i for triggered indicators) — default weight=0.2 each
# is_confirmed = alert_score >= 0.4
# direction by majority vote
```

#### 5.2.12 Projected Value & Hold/Sell Decision

```python
# backend/predictors/storage_value.py — project_value()
# See PoE2_Flipper_Canonical_Formulas.md §6 for full verification

projected_price = current_price * exp(log_momentum * horizon_hours)

z = abs(norm.ppf(significance_level))  # default: 0.05 → z=1.645  (renamed from confidence_level — see HIGH-7)
risk_discount = exp(-volatility * z * sqrt(horizon_hours))

liq_factor = min(liquidity_score / liquidity_normalization, 1.0)  # default norm=10.0
adjusted_price = projected_price * risk_discount * (0.9 + liq_factor * 0.1)

# Gold fees EXCLUDED: net_value = adjusted_price
ratio = net_value / current_price

if ratio > buy_threshold:   decision = "BUY_HOLD"     # default: 1.03
elif ratio < sell_threshold: decision = "SELL_CONVERT" # default: 0.97
else:                        decision = "NEUTRAL"
```

#### 5.2.13 Historical Benchmarks

```python
# backend/economy/benchmarks.py — compute_benchmarks()

# Over lookback_days (default: 30):
# low30d = min price
# high30d = max price
# rangePosition = (current - low) / (high - low)   # 0-1
# percentile30d = percentile rank of current price
# currentVsAvg = (current - mean) / mean * 100      # % above/below average
```

---

## §6. Caching Strategy

### 6.1 Frontend Cache (poe2api.ts)

```typescript
// In-memory cache with stale-while-revalidate
// NOTE: Cache entries do NOT contain an 'inflight' field.
// Request deduplication uses a SEPARATE Map (pendingRequests).
const cache = new Map<string, { data: unknown; ts: number }>();
const pendingRequests = new Map<string, Promise<unknown>>();

const CACHE_TTL = 60_000;              // 60s — fresh
const CACHE_STALE_TTL = 600_000;        // 10min — serve stale, revalidate in background
const MAX_CACHE_SIZE = 500;             // Max entries before LRU eviction
const FETCH_TIMEOUT = 30_000;           // 30s per request
const FETCH_RETRIES = 3;                // Max retry attempts
const REVALIDATION_TTL_MS = 60_000;     // 1min — dedup revalidation calls
const REQUEST_DEDUP_WINDOW = 10_000;    // 10s — dedup concurrent identical requests

// Change map — separate cache for 7d change enrichment of ExchangePairs
const CHANGE_MAP_TTL = 5 * 60_000;      // 5min
const CHANGE_MAP_STALE_TTL = 20 * 60_000; // 20min
// buildCurrencyChangeMap() fetches ALL ByCategory currencies and builds
// Map<apiId, CurrencyChangeEntry> for enriching ExchangePair 7d changes

async function cachedFetch<T>(url: string, options?: { maxRetries?: number }): Promise<T> {
  const hit = cache.get(url);
  const now = Date.now();

  // Fresh hit — return immediately
  if (hit && now - hit.ts < CACHE_TTL) {
    return hit.data as T;
  }

  // Stale but usable — return immediately, revalidate in background
  if (hit && now - hit.ts < CACHE_STALE_TTL) {
    revalidateInBackground(url).catch(() => {});
    return hit.data as T;
  }

  // Request deduplication — uses SEPARATE Map, not cache entry field
  const pending = pendingRequests.get(url);
  if (pending) return pending as Promise<T>;

  // Cache miss or very stale — fetch
  const fetchPromise = doFetch<T>(url, maxRetries)
    .catch((err) => {
      if (hit) { return hit.data as T; }  // Last resort — very stale data
      throw err;
    })
    .finally(() => pendingRequests.delete(url));

  pendingRequests.set(url, fetchPromise);
  return fetchPromise;
}
```

### 6.2 Backend Cache (Poe2ScoutProvider)

```python
class Poe2ScoutProvider(BaseDataProvider):
    def __init__(self):
        self._metadata_cache: dict[str, tuple[list[CurrencyInfo], float]] = {}
        self._metadata_cache_ttl = 3600.0  # 1 hour
        self._exchange_cache: dict[str, tuple[dict, float]] = {}
        self._exchange_cache_ttl = 300.0  # 5 minutes
        # Uses httpx.AsyncClient with 10s timeout
        # Semaphore for concurrency control (max 5)
        # 2 retries on 429 status

    def invalidate_cache(self, league: str = None):
        if league:
            self._metadata_cache.pop(league, None)
            self._exchange_cache.pop(league, None)
        else:
            self._metadata_cache.clear()
            self._exchange_cache.clear()
```

### 6.3 SnapshotManager Cache

```python
class SnapshotManager:
    # TTL: config.cache_ttl_prices_minutes * 60 (default: 5 min)
    # Async lock to prevent concurrent refresh
    # Stale fallback: if refresh fails, serve stale snapshot
    # Computes ~16 coordinated API requests per refresh
```

### 6.4 Additional Backend Caches

| Cache | File | TTL | Eviction |
|-------|------|-----|----------|
| `PipelineCache` | `backend/data/pipeline_cache.py` | Configurable per entry | TTL expiry |
| `DailyStatsCache` | `backend/data/daily_stats_cache.py` | LRU + per-entry TTL | LRU when full + TTL expiry |
| `ModelStore` | `backend/predictors/model_store.py` | Persisted to disk | Manual / scheduler (every 30 min) |

---

## §7. Error Handling & Fallbacks

### 7.1 Network Errors (poe2api.ts)

```typescript
const FETCH_RETRIES = 3;
const FETCH_TIMEOUT = 30_000;
const RETRY_BACKOFF = [1000, 2000, 4000]; // ms (with jitter)

// 4xx errors (client errors) → don't retry, throw immediately
// AbortError (timeout) → throw immediately
// ECONNRESET/EPIPE/ETIMEDOUT → retry with backoff + jitter
// ECONNREFUSED/ENOTFOUND → throw with hint
```

**Fallback data on error:**

| Function | Fallback |
|----------|----------|
| `getRealms()` | `FALLBACK_REALMS` (4 entries: poe2, pc, xbox, sony) |
| `getLeagues()` | `FALLBACK_LEAGUES` (per realm) |
| `getItemCategories()` | `FALLBACK_CATEGORIES` — `[{name: "all", displayName: "All", count: 0}]` |
| `getReferenceCurrencies()` | `FALLBACK_REFERENCE_CURRENCIES` — exalted, divine, chaos |
| All other functions | Return empty array `[]` |
| Dynamic fallbacks | `dynamicRealmsFallback`, `dynamicLeaguesFallback` (auto-cached from live API) |

### 7.2 Backend Proxy (flipper-proxy.ts)

```typescript
const FLIPPER_API_URL = process.env.FLIPPER_API_URL || "http://localhost:8000";

async function proxyToFlipper(
  path: string, searchParams?, method?, body?, maxRetries?
): Promise<Response>
  // Default: method="GET", maxRetries=1
  // Timeout: AbortSignal.timeout(15_000)
  // Deduplicates concurrent GET requests
  // Error mapping:
  //   503 → backend_insufficient_data
  //   422 → insufficient_data
  //   5xx → server_error
  //   timeout → backend_timeout
  //   ECONNREFUSED → backend_offline
  //   ECONNRESET → backend_connection_reset

async function proxyWithFallback(
  path: string, fallback, searchParams?, method?, body?
): Promise<Response>
  // Returns 200 with fallback data instead of error responses
  // ProxyFallbackOptions: { offlineFallback, insufficientDataFallback?, catch503? }
```

### 7.3 Error Types Reference

```typescript
type FlipperErrorType =
  | "backend_offline"           // Connection refused
  | "backend_timeout"           // Request timed out
  | "backend_connection_reset"  // Connection reset during request
  | "backend_insufficient_data" // Not enough historical data
  | "insufficient_data"         // General insufficient data
  | "server_error"              // 5xx from backend
  | "upstream_error"            // POE2Scout API error
  // Note: "validation_error" removed — 422 now maps to "insufficient_data"

class FlipperApiError extends Error {
  status: number;
  errorType: FlipperErrorType | undefined;
  detail: string | undefined;
  hint: string | undefined;
}
```

---

## §8. WebSocket Real-Time Updates

### 8.1 Per-Endpoint WebSocket Channels

> **⚠️ CORRECTION (2026-06-02):** The old version described a single `/ws` endpoint
> with channel subscriptions. The actual implementation uses **per-endpoint WebSocket
> routes** for more granular live updates.

| WebSocket Route | Purpose | Data Format |
|----------------|---------|-------------|
| `/ws/storage-value/{currency}` | Live storage value updates | `{ currency, current_price, projected_price, ... }` |
| `/ws/forecast/{currency}` | Live forecast updates | `{ currency, forecast_data, ... }` |
| `/ws/anomalies` | Live anomaly alerts | `{ currency, alert_score, direction, ... }` |
| `/ws/flips` | Live flip opportunity alerts | `{ opportunities, ... }` |
| `/ws/events` | Live event notifications | `{ event_type, description, ... }` |

### 8.2 Server-Side Connection Manager

```python
# routes_ws.py
class ConnectionManager:
    def __init__(self):
        self.active_connections: dict[str, list[WebSocket]] = defaultdict(list)

    async def connect(self, websocket: WebSocket, channels: list[str]):
        await websocket.accept()
        for channel in channels:
            self.active_connections[channel].append(websocket)

    def disconnect(self, websocket: WebSocket, channels: list[str]):
        for channel in channels:
            if websocket in self.active_connections[channel]:
                self.active_connections[channel].remove(websocket)

    async def broadcast(self, channel: str, message: dict):
        disconnected = []
        for connection in self.active_connections[channel]:
            try:
                await connection.send_json(message)
            except WebSocketDisconnect:
                disconnected.append(connection)
        for conn in disconnected:
            self.disconnect(conn, [channel])
```

---

## §9. Event System

### 9.1 Event Types

> **⚠️ CORRECTION (2026-06-02):** The old version listed game-event types
> (`league_start`, `flashback`, `race`, `tempest`, `invasion`). The actual
> backend uses these event type enums:

| Type | Description | Impact on Scoring |
|------|-------------|-------------------|
| `MAJOR_PATCH` | Major game patch release | Phase reset, volatility boost |
| `MINOR_PATCH` | Minor patch/hotfix | Moderate volatility boost |
| `STREAMER_HYPE` | Streamer-driven demand spike | Momentum boost for affected currencies |
| `OTHER` | Custom/user-defined event | Configurable via metadata |

### 9.2 Event Schema

```python
class MarketEvent(BaseModel):
    event_type: EventType        # MAJOR_PATCH | MINOR_PATCH | STREAMER_HYPE | OTHER
    description: str
    affected_currencies: list[str] = []
    timestamp: datetime
    expires_at: datetime
    is_active: bool = True
    metadata: dict = {}          # Type-specific data
                                 # e.g., {"multiplier": 2.0, "affected_currencies": ["divine"]}
```

### 9.3 Event Manager

```python
# backend/economy/events.py — EventManager
# SQLite-backed CRUD with automatic pruning
# Pruning interval: config.event_pruning_interval_minutes (default: 15 min)
# Default expiry: config.events.default_expiry_hours (default: 48h)
# Event score penalty: config.events.event_score_penalty (default: 0.5)
```

---

## §10. API Path Reference

### 10.1 Frontend Routes (Next.js)

```
Frontend API Routes (src/app/api/)
│
├── poe2/                          # Direct POE2Scout proxy (no backend required)
│   ├── health/route.ts            → getHealth()
│   ├── realms/route.ts            → getRealms()
│   ├── leagues/route.ts           → getLeagues(realm, defaultLeagueValue)
│   ├── exchange/route.ts          → getSnapshotPairs(realm, league)
│   ├── currencies/route.ts        → getCurrenciesByCategory(...)
│   ├── uniques/route.ts           → getUniquesByCategory(...)
│   ├── items/route.ts             → getItems(realm, league)
│   └── overview/route.ts          → Combined: getExchangeSnapshot + getSnapshotHistory + getReferenceCurrencies
│
└── flipper/                       # FastAPI backend proxy (requires backend)
    ├── health/route.ts            → GET /api/health
    ├── phase/route.ts             → GET /api/phase
    ├── currencies/route.ts        → GET /api/currencies
    ├── prices/route.ts            → GET /api/prices
    ├── heatmap/route.ts           → GET /api/prices/heatmap
    ├── flips/route.ts             → GET /api/arbitrage/flips
    ├── triangular/route.ts        → GET /api/arbitrage/triangular
    ├── tiers/route.ts             → GET /api/tiers
    ├── recipes/route.ts           → GET /api/recipes
    ├── forecast/[currency]/route.ts → GET /api/forecast/{currency}
    ├── anomalies/route.ts         → GET /api/anomalies
    ├── storage-value/[currency]/route.ts → GET /api/storage-value/{currency}
    ├── benchmarks/[currency]/route.ts → GET /api/benchmarks/{currency_api_id}
    ├── portfolio/route.ts         → GET /api/portfolio
    ├── portfolio/correlation/route.ts → GET /api/portfolio/correlation
    ├── portfolio/frontier/route.ts → GET /api/portfolio/frontier
    ├── portfolio/rebalance/route.ts → POST /api/portfolio/rebalance
    ├── events/route.ts            → GET/POST /api/events
    ├── events/[eventId]/route.ts  → DELETE /api/events/{eventId}
    ├── events/[eventId]/deactivate/route.ts → POST /api/events/{eventId}/deactivate
    ├── ws/info/route.ts           → WebSocket connection info
    ├── auth/start/route.ts        → GET /api/auth/start  (OAuth2 stub, not configured)
    └── auth/callback/route.ts     → GET /api/auth/callback (OAuth2 stub, not configured)
```

### 10.2 Backend Routes (FastAPI)

```
FastAPI Routes (backend/api/)
│
├── main.py                    # /api/health — health check with provider status
├── routes_prices.py           # /api/phase, /api/currencies, /api/prices,
│                              # /api/prices/heatmap, /api/prices/{pair},
│                              # /api/tiers, /api/benchmarks/{currency_api_id}
├── routes_arbitrage.py        # /api/arbitrage/flips, /api/arbitrage/triangular
├── ~~routes_forecast.py~~      # ⛔ DEPRECATED — file does not exist; /api/forecast/{currency}, /api/forecast/{currency}/stl
├── ~~routes_portfolio.py~~     # ⛔ DEPRECATED — file does not exist; /api/portfolio, /api/portfolio/rebalance,
│                              # /api/portfolio/frontier, /api/portfolio/correlation
├── routes_events.py           # /api/events (GET/POST), /api/events/summary (GET),
│                              # /api/events/{event_id} (GET/DELETE),
│                              # /api/events/{event_id}/deactivate (POST)
├── ~~routes_recipes.py~~       # ⛔ DEPRECATED — file does not exist; /api/recipes (GET), /api/recipes/definitions (GET)
├── routes_anomalies.py        # /api/anomalies
├── routes_storage_value.py    # /api/storage-value/{currency}
├── routes_auth.py             # /api/auth/start, /api/auth/callback, /api/auth/status
│                              # ⚠️ EXISTS but NOT registered in app — effectively dead code
└── routes_ws.py               # WebSocket: /ws/storage-value/{currency}, /ws/forecast/{currency},
                               # /ws/anomalies, /ws/flips, /ws/events
```

### 10.3 POE2Scout API Paths

```
POE2Scout API (base: https://api.poe2scout.com/api)
│
├── /                                           # GET — root
├── /health/live                                # GET — liveness probe
├── /health/ready                               # GET — readiness probe
├── /Realms                                     # GET — list realms (snake_case!)
├── /Realms/{Realm}/Filters                     # GET — realm search filters
├── /Realms/{Realm}/LandingSplashInfo           # GET — landing splash data
├── /{Realm}/Leagues                            # GET — list leagues
├── /{Realm}/Leagues/{LeagueName}/SnapshotPairs # GET — all currency pairs
├── /{Realm}/Leagues/{LeagueName}/SnapshotHistory # GET — market history
├── /{Realm}/Leagues/{LeagueName}/ExchangeSnapshot # GET — exchange overview
├── /{Realm}/Leagues/{LeagueName}/ReferenceCurrencies # GET — bridge currencies
├── /{Realm}/Leagues/{LeagueName}/Items         # GET — all items
├── /{Realm}/Leagues/{LeagueName}/Items/Categories # GET — item categories
├── /{Realm}/Leagues/{LeagueName}/Items/{ItemId} # GET — single item
├── /{Realm}/Leagues/{LeagueName}/Items/{ItemId}/History # GET — price history (⚠️ LogCount multiple of 4)
├── /{Realm}/Leagues/{LeagueName}/Items/{ItemId}/DailyStatsHistory # GET — OHLCV
├── /{Realm}/Leagues/{LeagueName}/Items/PriceHistory # GET — bulk price histories
├── /{Realm}/Leagues/{LeagueName}/Currencies/ByCategory # GET — currencies (paginated)
├── /{Realm}/Leagues/{LeagueName}/Currencies/{ApiId} # GET — single currency
├── /{Realm}/Leagues/{LeagueName}/Currencies/Pairs/{CurrencyOneItemId}/{CurrencyTwoItemId}/History # GET — pair history
└── /{Realm}/Leagues/{LeagueName}/Uniques/ByCategory # GET — uniques (paginated)
```

---

## §11. Critical Gotchas for LLM Agents

### §11.1 Data Source Confusion

1. **Never assume data comes from the backend** — check which route handles it:
   - `/api/poe2/*` → POE2Scout API directly (no backend)
   - `/api/flipper/*` → FastAPI backend (with analytics)

2. **Never hardcode API paths** — use the exported functions from `src/lib/poe2api.ts` or `src/lib/flipper-proxy.ts`.

3. **Never use string ApiId where numeric ItemId is required** — the CurrencyPairHistory endpoint expects integers.

4. **`/api/flipper/auth/*` routes exist but backend auth is not configured** — these are dead code.

### §11.2 Response Shape Pitfalls

1. **PriceLogs are newest-first** — always sort before computing changes.
2. **Category=all returns empty** — must merge all categories.
3. **League IsCurrent is always false** — use realm's default_league_value.
4. **Some numeric fields come as strings** — use safeParseFloat() or Number().
5. **Pagination metadata differs** — API uses `CurrentPage/Pages/Total`, frontend uses `page/totalPages/totalItems`.
6. **RelativePrice "0E-8"** — POE2Scout returns scientific-notation zero; safeParseFloat returns null.
7. **RawUniqueItem has UniqueItemId** — different from RawCurrencyItem's CurrencyItemId.
8. **GetCategoriesResponse has two arrays** — `UniqueCategories` and `CurrencyCategories` (not a flat list).

### §11.3 Type Mismatches

1. **Frontend uses camelCase** — API returns PascalCase. Transformation happens in poe2api.ts.
2. **Backend uses snake_case** — Python Pydantic models use snake_case.
3. **ExchangePair uses numeric ItemId** — not string ApiId for history calls.
4. **FlipOpportunity.spread_after_fees is DEPRECATED** — kept for backward compatibility only.
5. **OHLCVCandle is exported from poe2api.ts** — not types.ts (breaks convention).
6. **Backend CurrencyTier uses tier_label (snake_case)** — frontend expects tierLabel (camelCase). Proxy route must transform.

### §11.4 Caching Assumptions

1. **Server-side cache in poe2api.ts** — same request returns same data for 60s.
2. **Backend SnapshotManager refreshes every 30 min** (configurable) — analytics lag behind real-time.
3. **HistoricalStore is SQLite** — persists across restarts, used for forecasting.
4. **Metadata cache in Poe2ScoutProvider** — 1-hour TTL to avoid N+1 requests.
5. **Change map cache** — 5min TTL, 20min stale TTL; used to enrich ExchangePair 7d changes.
6. **LightGBM models persisted to disk** — survive backend restarts; retrained every 6 hours.
7. **Max cache size is 500 entries** — LRU eviction when exceeded.

### §11.5 Error Handling Patterns

1. **Fallback data** — never show blank UI, always have fallback values.
2. **Backend offline detection** — check `/api/flipper/health` on mount.
3. **Graceful degradation** — market tabs work without backend, flipper tabs show offline message.
4. **Retry with backoff** — transient network errors retry 3 times before failing.
5. **Stale-while-revalidate** — serve stale data immediately, fetch fresh in background.

### §11.6 Known Discrepancies

1. **Two overlapping helper files:** `src/components/dashboard/flips-helpers.ts` and `src/lib/flipper-helpers.ts` both export `scoreColor()` with different thresholds/Tailwind classes.
2. **League name default mismatch (RESOLVED):** Backend config now defaults to `"runes"`, frontend Zustand store defaults to `"runes"`. (Previously backend defaulted to `"vaal"` while frontend used `"runes"`.)
3. **Backend `FeesConfig` is empty** (`pass`) — gold fee removal left it as a placeholder.
4. **`routes_auth.py` exists in backend but is NOT registered in app** — effectively dead code.
5. **`OfficialTradeProvider` exists** but requires `GGG_CLIENT_ID`/`GGG_CLIENT_SECRET` env vars that are "never configured" — dead code unless manually set.

---

## §12. Quick Reference: Data → Component

### 12.1 Market Overview Tab

```
src/components/dashboard/MarketOverview.tsx
    │
    ├─→ GET /api/poe2/overview → exchange snapshot, snapshot history, reference currencies
    ├─→ Realm/league selectors (from store)
    └─→ getSnapshotHistory() → chart (volume, marketCap over time)
```

### 12.2 Currencies Tab

```
src/components/dashboard/VirtualCurrencyGrid.tsx
    │
    ├─→ getItemCategories() → category selector
    ├─→ getCurrenciesByCategory(category, page) → virtual scrolling list
    │       │
    │       Each row: iconUrl, name, price, changePercent, volume
    │       Click → DetailDialog
    └─→ DetailDialog:
            ├─→ getItemHistory(itemId) → line chart
            └─→ getItemDailyStats(itemId) → candlestick chart (with SMA/EMA/RSI/Bollinger overlays)
```

### 12.3 Uniques Tab

```
src/components/dashboard/UniqueTable.tsx
    │
    ├─→ getItemCategories() → category selector
    ├─→ getUniquesByCategory(category, page, search) → paginated list with search
    │       │
    │       Each row: iconUrl, name, price
    └─→ DetailDialog:
            ├─→ getItemHistory(itemId) → line chart
            └─→ getItemDailyStats(itemId) → candlestick chart
```

### 12.4 Exchange Tab

```
src/components/dashboard/ExchangeTable.tsx
    │
    ├─→ getSnapshotPairs() → pairs table (enriched with 7d changes)
    │       │
    │       Each row: currency1Name/currency2Name, relativePrice, volume, changePercent
    │       Click → PairDetailDialog
    ├─→ PairDetailDialog:
    │       ├─→ getCurrencyPairHistory(id1, id2) → chart
    │       └─→ getPairDailyStats() → OHLCV chart
    └─→ getReferenceCurrencies() → reference currency pills
```

### 12.5 Arbitrage Tab (Requires Backend)

```
src/components/dashboard/ArbitrageTab.tsx
    │
    ├─→ GET /api/flipper/health → check backend status
    ├─→ GET /api/flipper/flips → scored opportunities (with quantized_analysis)
    ├─→ GET /api/flipper/triangular → triangular arbitrage cycles
    └─→ GET /api/flipper/recipes → vendor recipe profits
```

### 12.6 Flips Tab (Requires Backend)

```
src/components/dashboard/FlipsTab.tsx
    │
    ├─→ GET /api/flipper/health → check backend status
    ├─→ GET /api/flipper/flips → scored opportunities
    │       │
    │       Each row: currency, score (color-coded), spread, volume_24h,
    │                 momentum, cluster, quantized_analysis
    ├─→ GET /api/flipper/tiers → tier classifications
    ├─→ GET /api/flipper/events → active market events
    └─→ FlipsDetailDialog → flip detail + storage value data
```

### 12.7 Forecast Tab (Requires Backend)

```
src/components/dashboard/ForecastTab.tsx
    │
    ├─→ GET /api/flipper/forecast/{currency} → 3-model forecast (SARIMA, Holt-Winters, LightGBM)
    ├─→ GET /api/flipper/anomalies → anomaly alerts (Z-score, MACD, RSI, STL, momentum)
    └─→ GET /api/flipper/currencies → currency list for selector
```

### 12.8 Portfolio Tab (Requires Backend)

```
src/components/dashboard/PortfolioTab.tsx
    │
    ├─→ GET /api/flipper/portfolio → optimized weights (pie chart)
    ├─→ GET /api/flipper/portfolio/frontier → efficient frontier (scatter plot)
    ├─→ GET /api/flipper/portfolio/correlation → correlation matrix
    └─→ POST /api/flipper/portfolio/rebalance → apply rebalance
```

### 12.9 Currency Graph Tab (Requires Backend)

```
src/components/dashboard/CurrencyGraphTab.tsx
    │
    ├─→ GET /api/flipper/currencies → currency list
    ├─→ GET /api/flipper/forecast/{currency} → forecast for selected currency
    └─→ GET /api/flipper/storage-value/{currency} → hold/sell decision
```

### 12.10 Watchlist Tab

```
src/components/dashboard/WatchlistTab.tsx
    │
    ├─→ Exchange pair data via fetchApi
    └─→ Zustand store watchlist (persisted)
```

### 12.11 Recipes Tab (Requires Backend)

```
src/components/dashboard/RecipesTab.tsx
    │
    └─→ GET /api/flipper/recipes → profitable vendor recipes
```

### 12.12 Utility Components

| Component | Data Sources |
|-----------|-------------|
| `MarketHeatmap` | 24h price change data |
| `TierDriftTracker` | GET /api/flipper/tiers — tier changes over time |
| `TakeProfitCalculator` | Quantized analysis from flip data |
| `VolumeLiquidityIndicators` | Volume & liquidity scores |
| `Sparkline` | Inline mini chart from price history |
| `CandlestickChart` | OHLCV with SMA/EMA/RSI/Bollinger overlays (src/lib/technical-indicators.ts) |
| `FlipperStickyBar` | Market sentiment + top flips |
| `FlipperBackendStatusCard` | Backend health status |
| `EventsSidebar` | Event management CRUD |

---

## Appendix A: Common Data Flow Mistakes

### A.1 Wrong API for Data

**WRONG:**
```typescript
// Trying to get flipper data from market endpoint
const data = await getExchangeSnapshot(realm, league);
if (data.opportunities) { ... } // undefined!
```

**CORRECT:**
```typescript
// Use flipper endpoint for flipper data
const data = await fetchApi<FlipsResponse>("/api/flipper/flips");
if (data.opportunities) { ... } // correct
```

### A.2 Using String ApiId Where Numeric ItemId Required

**WRONG:**
```typescript
const history = await getCurrencyPairHistory(
  realm, league,
  pair.currency1Id,  // "divine" — causes 422
  pair.currency2Id,  // "exalted" — causes 422
  168
);
```

**CORRECT:**
```typescript
const history = await getCurrencyPairHistory(
  realm, league,
  pair.currency1ItemId,  // 12345 — correct
  pair.currency2ItemId,  // 67890 — correct
  168
);
```

### A.3 Forgetting PriceLogs Sort

**WRONG:**
```typescript
const change = ((logs[0].Price - logs[logs.length-1].Price) / logs[logs.length-1].Price) * 100;
// Assumes oldest first — WRONG, API returns newest first!
```

**CORRECT:**
```typescript
const sorted = [...logs].sort((a, b) =>
  new Date(a.Time).getTime() - new Date(b.Time).getTime()
);
const now = sorted[sorted.length - 1];
const oldest = sorted[0];
const change = ((now.Price - oldest.Price) / oldest.Price) * 100;
```

### A.4 Not Handling Backend Offline

**WRONG:**
```typescript
const data = await fetchApi<FlipOpportunity[]>("/api/flipper/flips");
// If backend offline: throws FlipperApiError with status 503
// UI crashes or shows generic error
```

**CORRECT:**
```typescript
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

### A.5 Using DEPRECATED spread_after_fees

**WRONG:**
```typescript
// spread_after_fees is DEPRECATED
const profit = flip.spread_after_fees * flip.volume_24h;
```

**CORRECT:**
```typescript
// Use raw spread (gold fees excluded by design decision)
const profit = flip.spread * flip.volume_24h;
// Or use quantized analysis for lot-level profit
const qAnalysis = flip.quantized_analysis;
if (qAnalysis) {
  const optimalLot = qAnalysis.minProfitableLot;
  const profitPct = qAnalysis.optimalLotProfitPct;
}
```

### A.6 Confusing Realm Path Parameter

**WRONG:**
```typescript
// Using game_api_id as realm path parameter
const url = BASE_URL + `/poe2/Leagues`;  // may work but is unreliable
```

**CORRECT:**
```typescript
// Use the 'value' field from /Realms response
// For PoE2: value = "poe2/poe2", but "poe2" also typically works
const realmValue = realm.name;  // extracted from RealmOptionResponse.value
const url = BASE_URL + `/${realmValue}/Leagues`;
```

---

## §11. CORS Proxy & Network Resilience (Updated 2026-06-03)

### 11.1 Problem Statement

POE2Scout API (`api.poe2scout.com`) is blocked in some regions (notably Russia). Both the frontend and backend need a way to route requests through a CORS proxy running on Cloudflare's edge network, which is not subject to the same blocking.

### 11.2 Three-Layer Resilience Architecture

```
Layer 1: Frontend (poe2api.ts)
  ┌─────────────────────────────────────────────────────────┐
  │ cachedFetch(BASE_URL + path)                            │
  │   ↓ on connection error                                │
  │ cachedFetch(CORS_PROXY_URL + path)  ← Cloudflare Worker│
  │   ↓ on connection error                                │
  │ return snapshot data from cache-snapshot.json           │
  └─────────────────────────────────────────────────────────┘

Layer 2: Frontend → Backend proxy (flipper-proxy.ts)
  ┌─────────────────────────────────────────────────────────┐
  │ proxyToFlipper(path)                                    │
  │   → fetch(FLIPPER_API_URL + path, { signal: 15s })     │
  │   → Circuit breaker: 5 consecutive failures → 60s open │
  │   → proxyWithFallback() returns 200 with fallback data  │
  └─────────────────────────────────────────────────────────┘

Layer 3: Backend CORS proxy fallback (Poe2ScoutProvider)
  ┌─────────────────────────────────────────────────────────┐
  │ _request(path)                                          │
  │   → _do_request(BASE_URL + path)                        │
  │   ↓ on connection error                                │
  │   → _do_request(CORS_PROXY_URL + path)  ← Cloudflare   │
  │   → Marks primary as unreachable for 5 min cooldown    │
  │   → After cooldown, retries primary automatically      │
  └─────────────────────────────────────────────────────────┘
```

### 11.3 Pre-populated Cache (cache-snapshot.json)

**Purpose:** The dashboard must show data even when the POE2Scout API is completely unreachable. The `cache-snapshot.json` file is a pre-fetched snapshot of key API responses that is loaded at server startup.

**Location:** `src/data/cache-snapshot.json`

**Format:**
```json
{
  "version": 1,
  "timestamp": "2026-06-03T00:00:00Z",
  "entries": {
    "https://api.poe2scout.com/api/Realms": {
      "data": [...],
      "ts": 1748908800000
    }
  }
}
```

**Loading:** `src/lib/cache-prepopulator.ts::prepopulateCache()` reads the snapshot on server startup and inserts entries into the `poe2api.ts` in-memory cache. Entries are marked as "stale but usable" so `cachedFetch` serves them immediately while triggering background revalidation.

**Regeneration:** Run `npx tsx scripts/generate-cache-snapshot.ts` when the API is reachable. This fetches fresh data and overwrites the snapshot file. Commit the updated file to the repository.

**Endpoints snapshot includes:**
- `/Realms` (critical)
- `/{realm}/Leagues` (critical)
- `/{realm}/Leagues/{league}/ExchangeSnapshot`
- `/{realm}/Leagues/{league}/SnapshotPairs`
- `/{realm}/Leagues/{league}/SnapshotHistory?Limit=24`
- `/{realm}/Leagues/{league}/ReferenceCurrencies`
- `/{realm}/Leagues/{league}/Items/Categories`
- `/{realm}/Leagues/{league}/Currencies/ByCategory?Category=currency&Page=1&PerPage=250`
- `/{realm}/Leagues/{league}/Items?Page=1&PerPage=50`

### 11.4 Circuit Breaker in flipper-proxy.ts

The frontend proxy to the FastAPI backend uses a circuit breaker pattern to avoid hammering an unreachable backend:

| Parameter | Value | Description |
|-----------|-------|-------------|
| `FLIPPER_CB_THRESHOLD` | 5 | Open after 5 consecutive failures |
| `FLIPPER_CB_COOLDOWN` | 60,000 ms | Wait 60s before trying again |
| `flipperCircuitBreakerOpen` | boolean | Tracks open/closed state |
| `flipperConsecutiveFailures` | number | Running count of failures |

**Flow:**
1. On each connection failure → increment `flipperConsecutiveFailures`
2. When `flipperConsecutiveFailures >= 5` → set `flipperCircuitBreakerOpen = true`, record timestamp
3. While open → return 503 immediately with `error_type: "backend_offline"`
4. After 60s cooldown → set `flipperCircuitBreakerOpen = false`, try one request
5. On any successful HTTP response → reset `flipperConsecutiveFailures = 0`

### 11.5 Backend CORS Proxy Fallback (Poe2ScoutProvider)

**Config fields (in `config.yaml → data`):**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `cors_proxy_url` | string | `""` | Cloudflare Worker URL, e.g. `"https://poe2scout-proxy.xxx.workers.dev/api"` |
| `cors_proxy_fallback_enabled` | bool | `true` | Enable automatic fallback on connection errors |

**Env var overrides (take precedence over config.yaml):**
- `POE2SCOUT_BASE_URL` — overrides `data.poe2scout_base_url`
- `POE2SCOUT_CORS_PROXY_URL` — overrides `data.cors_proxy_url`

**Fallback logic in `Poe2ScoutProvider._request()`:**
1. Check if primary URL is known-unreachable (`_should_try_proxy_first()`)
   - If yes and cooldown hasn't expired (5 min) → try proxy directly
2. Try primary URL (`_do_request(base_url, path)`)
   - If success → clear unreachable flag, return data
3. If primary fails → try CORS proxy (`_do_request(cors_proxy_url, path)`)
   - If proxy succeeds → mark primary as unreachable, set cooldown
4. If both fail → return None

**Cooldown:** When primary is detected as unreachable, subsequent requests skip the primary and go directly to the proxy for 5 minutes (`_primary_cooldown = 300.0`). After cooldown, the primary is retried automatically.

### 11.6 WebSocket Status UI Notification

**Problem:** `use-websocket.ts` exports `status`, `reconnectCount`, and `lastError`, but the UI components had no visual indicator of the WebSocket connection state.

**Solution:** Added a WS status badge to both `FlipperBackendStatusCard` and `FlipperStickyBar`:

| WS Status | Color | Icon | Text |
|-----------|-------|------|------|
| `connected` | Green | `WifiHigh` | "WS: Live" |
| `connecting` | Amber | `Loader2` (spinning) | "WS: Connecting" |
| `disconnected` | Gray | `Wifi` | "WS: Off" |

**Props added:**
- `FlipperBackendStatusCard`: `wsStatus?: WebSocketStatus`
- `FlipperStickyBar`: `wsStatus?: WebSocketStatus`

**i18n keys added** (all 4 locales — en, ru, zh, ko):
- `stickyBarWsConnected`, `stickyBarWsConnecting`, `stickyBarWsDisconnected`
- `wsStatusConnected`, `wsStatusConnecting`, `wsStatusDisconnected`

---

## §12. Cloudflare Worker Setup — Step-by-Step Guide

This section describes how to deploy the CORS proxy Cloudflare Worker for regions where `api.poe2scout.com` is blocked.

### 12.1 Prerequisites

1. A **Cloudflare account** (free tier is sufficient)
2. **Node.js** 18+ installed on your machine
3. The `poe2-market-dashboard` repository cloned locally

### 12.2 Step 1: Install Wrangler CLI

```bash
npm install -g wrangler
```

Verify installation:
```bash
wrangler --version
```

### 12.3 Step 2: Login to Cloudflare

```bash
wrangler login
```

This opens a browser window. Authorize the Wrangler CLI to access your Cloudflare account. After authorization, you'll see a success message in the terminal.

### 12.4 Step 3: Configure the Worker

Navigate to the `cloudflare-worker/` directory in the repository:

```bash
cd cloudflare-worker/
```

Review `wrangler.toml` — the default configuration should work as-is:

```toml
name = "poe2scout-proxy"
main = "worker.js"
compatibility_date = "2024-12-01"
compatibility_flags = ["nodejs_compat"]
```

**If you want a custom domain** (optional), uncomment one of the `routes` sections in `wrangler.toml` and edit it to match your domain. See the comments in the file for Options A, B, and C.

### 12.5 Step 4: Deploy the Worker

```bash
wrangler deploy
```

The output will include the Worker URL:
```
Published poe2scout-proxy (x.xx sec)
  https://poe2scout-proxy.YOUR-ACCOUNT.workers.dev
```

**Write down this URL** — you need it for the next step.

### 12.6 Step 5: Verify the Worker

Test the proxy in your browser or with curl:

```bash
# Test that the proxy forwards requests correctly
curl https://poe2scout-proxy.YOUR-ACCOUNT.workers.dev/api/health/live

# Test analytics endpoint
curl https://poe2scout-proxy.YOUR-ACCOUNT.workers.dev/__analytics
```

You should get a JSON response from the POE2Scout API.

### 12.7 Step 6: Configure the Dashboard

**Option A: Frontend-only (for browser users behind the block)**

Create or edit `.env.local` in the project root:

```bash
# .env.local
POE2_CORS_PROXY_URL=https://poe2scout-proxy.YOUR-ACCOUNT.workers.dev/api
```

This makes the frontend `poe2api.ts` fall back to the proxy when the direct API is unreachable.

**Option B: Backend CORS proxy (for the FastAPI backend behind the block)**

Edit `config.yaml`:

```yaml
data:
  cors_proxy_url: "https://poe2scout-proxy.YOUR-ACCOUNT.workers.dev/api"
  cors_proxy_fallback_enabled: true
```

OR set the environment variable (takes precedence):

```bash
export POE2SCOUT_CORS_PROXY_URL=https://poe2scout-proxy.YOUR-ACCOUNT.workers.dev/api
```

**Option C: Both frontend and backend (recommended for full coverage)**

```bash
# .env.local
POE2_CORS_PROXY_URL=https://poe2scout-proxy.YOUR-ACCOUNT.workers.dev/api
```

```yaml
# config.yaml
data:
  cors_proxy_url: "https://poe2scout-proxy.YOUR-ACCOUNT.workers.dev/api"
  cors_proxy_fallback_enabled: true
```

### 12.8 Step 7: Restart Services

After configuration changes, restart both services:

```bash
# Restart Next.js frontend
# (Ctrl+C the dev server, then:)
npm run dev

# Restart FastAPI backend
# (Ctrl+C uvicorn, then:)
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

### 12.9 Step 10: Verify End-to-End

1. Open `https://localhost:3000` in your browser
2. Check the browser console — you should NOT see connection errors to `api.poe2scout.com`
3. If the API is blocked, requests should go through the Worker proxy instead
4. Check the backend logs — you should see "retrying through CORS proxy" messages if the primary URL is unreachable

### 12.10 Custom Domain (Optional)

If you own a domain managed by Cloudflare:

1. Log in to `https://dash.cloudflare.com`
2. Add your domain (if not already added)
3. Edit `cloudflare-worker/wrangler.toml` — uncomment and edit the `routes` section:

```toml
routes = [
  { pattern = "poe2api.yourdomain.com/api/*", zone_name = "yourdomain.com" }
]
```

4. Redeploy: `wrangler deploy`
5. Update your `.env.local` and `config.yaml` to use the custom domain URL

### 12.11 Monitoring

The Worker includes built-in analytics accessible at:
```
https://poe2scout-proxy.YOUR-ACCOUNT.workers.dev/__analytics
```

Returns JSON with request counts, success rates, and path distributions. Note: analytics are in-memory only and reset on Worker restart.

For persistent monitoring, use the Cloudflare dashboard:
```
https://dash.cloudflare.com → Workers → poe2scout-proxy → Metrics
```

### 12.12 Rate Limits (Free Tier)

| Limit | Value |
|-------|-------|
| Requests/day | 100,000 |
| CPU time/request | 10 ms |
| Script size | 1 MB |
| Number of Workers | 10 |

These limits are generous for a single-user or small-team dashboard. If you need more, upgrade to the Workers Paid plan ($5/month for 10M requests).

---

> **LAST UPDATED:** 2026-06-03 — Added §11 (CORS Proxy & Network Resilience), §12 (Cloudflare Worker Setup Guide), updated §3.6 with `cors_proxy_url` and `cors_proxy_fallback_enabled` config fields.
