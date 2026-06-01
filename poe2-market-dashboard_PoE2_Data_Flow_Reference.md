# PoE2 Market Dashboard — Data Flow Tracking Reference

> **PURPOSE:** This file is the single source of truth for data provenance, transformation pipelines, and algorithmic formulas in the PoE2 Market Dashboard system. LLM agents MUST consult this file before modifying any API calls, data transformations, or UI subscriptions.
>
> **VERIFICATION STATUS:** Each data flow is traced from the original POE2Scout API response through the transformation layer to the UI component. Field mappings are documented with examples.
>
> **UPDATED:** Document includes complete formula references, algorithm pseudocode, WebSocket flows, and improved endpoint documentation.

---

## §0. Architecture Overview

```
Browser (React/Next.js)
    │
    ├── /api/poe2/*   ────→ POE2Scout API (api.poe2scout.com/api)
    │                          (Server-side fetch, cache, PascalCase→camelCase)
    │
    └── /api/flipper/* ────→ FastAPI Backend (port 8000)
                               ├── Poe2ScoutProvider ────→ POE2Scout API
                               ├── DataSnapshot (in-memory, periodic refresh)
                               ├── HistoricalStore (SQLite, persistent)
                               ├── Scheduler (background tasks via APScheduler)
                               ├── Analytics (scoring, forecasting, portfolio)
                               └── WebSocket (routes_ws.py) ────→ Live updates
```

---

## §1. Data Sources & External APIs

### 1.1 POE2Scout API (Primary Source)

| Property | Value |
|----------|-------|
| **Base URL** | `https://api.poe2scout.com/api` (configurable via `POE2_API_BASE_URL`) |
| **Swagger UI** | `https://api.poe2scout.com/swagger` |
| **Authentication** | None (public API) |
| **Rate Limits** | None for consumers (server handles upstream) |
| **Response Format** | JSON, PascalCase for most endpoints, **snake_case for `/Realms`** |

**Key Endpoints:**

| Endpoint | Method | Purpose | Response Shape |
|----------|--------|---------|----------------|
| `/Realms` | GET | Available realms | `RawRealm[]` (**snake_case!**) |
| `/{realm}/Leagues` | GET | Leagues for realm | `RawLeague[]` (PascalCase) |
| `/{realm}/Leagues/{league}/SnapshotPairs` | GET | All currency pairs with prices | `RawSnapshotPair[]` |
| `/{realm}/Leagues/{league}/Currencies/ByCategory` | GET | Currencies by category (paginated) | `RawPaginatedResponse<RawCurrencyItem>` |
| `/{realm}/Leagues/{league}/Uniques/ByCategory` | GET | Unique items by category (paginated) | `RawPaginatedResponse<RawUniqueItem>` |
| `/{realm}/Leagues/{league}/Items/Categories` | GET | All item categories | `RawCategoriesResponse` |
| `/{realm}/Leagues/{league}/Items/{itemId}/History` | GET | Price history for item | `{PriceHistory: [...], HasMore}` |
| `/{realm}/Leagues/{league}/Items/{itemId}/DailyStatsHistory` | GET | OHLCV daily stats | `{DailyStats: [...], HasMore}` |
| `/{realm}/Leagues/{league}/Currencies/Pairs/{id1}/{id2}/History` | GET | Exchange pair history | `{History: [...], Meta}` |
| `/{realm}/Leagues/{league}/ReferenceCurrencies` | GET | Reference/bridge currencies | `RawReferenceCurrency[]` |
| `/{realm}/Leagues/{league}/SnapshotHistory` | GET | Market snapshot history | `{Data: [...], Meta}` |
| `/{realm}/Leagues/{league}/ExchangeSnapshot` | GET | Exchange overview | `ExchangeSnapshot` |

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
6. **Numeric ItemIds required** — `/Currencies/Pairs/{ItemId1}/{ItemId2}/History` expects integers, not ApiId strings.
7. **Timezone: PriceLogs timestamps are UTC** — assume UTC unless API specifies otherwise.

---

## §2. Frontend → Backend Data Flows

### 2.1 Market Data Flow (No Backend Required)

```
User Browser
    │
    ├─→ GET /api/poe2/realms ──────────────→ poe2api.ts::getRealms()
    │                                            │
    │                                        cachedFetch(BASE_URL + "/Realms")
    │                                            │
    │                                        map: RawRealm[] → Realm[]
    │                                        (extract realm_api_id, game_api_id, default_league_value)
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
    │                                            │
    │                                        return: League[]
    │
    ├─→ GET /api/poe2/exchange ──────────────→ poe2api.ts::getExchangeSnapshot()
    │        ?realm=poe2&league=runes               │
    │                                        cachedFetch(BASE_URL + "/{realm}/Leagues/{league}/ExchangeSnapshot")
    │                                            │
    │                                        return: ExchangeSnapshot (pairs:[], referenceCurrency, timestamp, volume, marketCap)
    │
    ├─→ GET /api/poe2/currencies ──────────────→ poe2api.ts::getCurrenciesByCategory()
    │        ?realm=poe2&league=runes&category=currency
    │                                            │
    │                                        If category="all":
    │                                          1. getItemCategories() → currencyCats[]
    │                                          2. For each cat: fetch all pages (250/page)
    │                                          3. Merge all items, client-side paginate
    │                                        Else:
    │                                          cachedFetch(...)
    │                                            │
    │                                        map: RawCurrencyItem → PoeItem
    │                                        (computeChangePercent from PriceLogs)
    │                                        (computeVolume24h from PriceLogs)
    │                                        (mapPriceLogs to history)
    │                                            │
    │                                        return: PaginatedResponse<PoeItem>
    │
    └─→ GET /api/poe2/uniques ──────────────→ poe2api.ts::getUniquesByCategory()
             ?realm=poe2&league=runes&category=all
                                          │
                                          Same logic as currencies — category="all" merges all.
                                          map: RawUniqueItem → PoeItem
                                          return: PaginatedResponse<PoeItem>
```

### 2.2 Flipper Analytics Flow (Requires FastAPI Backend)

```
User Browser
    │
    ├─→ GET /api/flipper/health ────────────→ flipper-proxy.ts::proxyWithFallback()
    │                                              │
    │                                          fetch(FASTAPI_URL + "/api/health")
    │                                              │
    │                                          return: FlipperHealthResponse
    │                                          {
    │                                            status: "ok"|"degraded"|"error"|"offline",
    │                                            provider: "reachable"|"unreachable",
    │                                            snapshot: {snapshot_valid, snapshot_stale, snapshot_age_seconds, last_refresh},
    │                                            daily_stats_cache: {size, max_size, stale_entries, oldest_entry_age},
    │                                            version: string,
    │                                            timestamp: ISO8601 string
    │                                          }
    │
    ├─→ GET /api/flipper/phase ─────────────→ flipper-proxy.ts
    │                                              │
    │                                          fetch(FASTAPI_URL + "/api/phase")
    │                                              │
    │                                          return: PhaseInfo
    │                                          {current_phase: "standard"|"flashback"|"event", multiplier: float, description: string}
    │
    ├─→ GET /api/flipper/prices ────────────→ routes_prices.py (FastAPI)
    │                                              │
    │                                          DataSnapshot.get_prices()
    │                                              │
    │                                          return: [{currency, bid, ask, mid, volume, momentum, volatility, cluster}, ...]

### 2.2a GET /api/prices — Response Structure

The `/api/prices` endpoint (implemented in `routes_prices.py`) is the primary
data source for the dashboard. It returns all exchange rates with derived
metrics computed from DataSnapshot.

**Response shape:**

```json
{
  "league": "vaal",
  "phase": "MID",
  "rates": [
    {
      "pair": "divine/exalted",
      "currency_from": "divine",
      "currency_to": "exalted",
      "raw_rate": 0.123,
      "volume_traded": 1500,
      "stock_value": 200.0,
      "volatility": 0.0234,
      "momentum": 0.0012,
      "acceleration": -0.0003,
      "cluster_from": "moderate",
      "cluster_to": "stable",
      "timestamp": "2025-06-02T12:00:00+00:00"
    }
  ],
  "base_currency": "exalted",
  "stale": false,
  "data_available": true,
  "fetched_at": "2025-06-02T12:00:00+00:00"
}
```

**Key fields:**

| Field | Type | Description |
|-------|------|-------------|
| `pair` | string | Currency pair key (e.g. "divine/exalted") |
| `currency_from` | string | Source currency api_id |
| `currency_to` | string | Target currency api_id |
| `raw_rate` | float | Exchange rate from→to |
| `volume_traded` | number | 24h trading volume for this pair |
| `stock_value` | number | Stock value from snapshot |
| `volatility` | float | Std of log-returns (from PriceMomentumTracker) |
| `momentum` | float | Mean of log-returns (from PriceMomentumTracker) |
| `acceleration` | float | Change in momentum (from PriceMomentumTracker) |
| `cluster_from` | string | Cluster label for currency_from ("stable"/"moderate"/"volatile") |
| `cluster_to` | string | Cluster label for currency_to |
| `timestamp` | string | ISO 8601 timestamp of the rate data |
    │
    ├─→ GET /api/flipper/flips ──────────────→ routes_arbitrage.py
    │                                              │
    │                                          scorer.compute_flips()
    │                                              │
    │                                          return: FlipsResponse
    │                                          {opportunities: [{currency, score, spread, volume_24h, momentum, volatility, cluster, bid, ask, mid}, ...]}
    │
    ├─→ GET /api/flipper/triangular ─────────→ routes_arbitrage.py
    │                                              │
    │                                          triangular.find_triangular_arbitrage()
    │                                              │
    │                                          return: TriangularResponse
    │
    ├─→ GET /api/flipper/forecast/{currency} → routes_forecast.py
    │                                              │
    │                                          time_series.forecast()
    │                                              │
    │                                          return: ForecastResponse
    │                                          {currency, forecast: [{timestamp, price, lower, upper}, ...], model, horizon}
    │
    ├─→ GET /api/flipper/portfolio ────────────→ routes_portfolio.py
    │                                              │
    │                                          portfolio.optimize()
    │                                              │
    │                                          return: PortfolioData
    │                                          {method, weights: {currency: weight}, expected_risk, correlation_warning, last_rebalance}
    │
    ├─→ GET /api/flipper/events ────────────────→ routes_events.py
    │                                              │
    │                                          Load from SQLite via EventManager
    │                                              │
    │                                          return: Event[]
    │                                          {id, type, description, created_at, expires_at, is_active, metadata}
    │
    ├─→ GET /api/flipper/recipes ────────────────→ routes_recipes.py
    │                                              │
    │                                          Return predefined trading recipes
    │                                              │
    │                                          return: Recipe[]
    │                                          {id, name, steps: [{from, to, expected_rate}], notes}
    │
    └─→ WebSocket /ws ────────────────────────────→ routes_ws.py
                │                                      │
                │                                  ws_manager.broadcast(data)
                │                                      │
                │                                  Client receives live price updates
                │
                └─→ Browser subscribes to channels
                        ├─→ prices: real-time bid/ask updates
                        ├─→ flips: new opportunity alerts
                        └─→ events: market event notifications
```

---

## §3. Backend Internal Data Flows

### 3.1 Poe2ScoutProvider → DataSnapshot → Analytics

```
POE2Scout API
    │
    ├─→ Poe2ScoutProvider.get_exchange_rates(league)
    │        │
    │        cachedFetch("/SnapshotPairs")
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
    └─→ Poe2ScoutProvider.get_historical_prices(currency, days)
             │
             cachedFetch("/Currencies/{currency}")
             │
             return: PricePoint[]

Poe2ScoutProvider
    │
    ├─→ DataSnapshot.refresh()
    │        │
    │        1. get_exchange_rates() → self._exchange_rates
    │        2. get_currency_metadata() → self._currencies
    │        3. For each currency: get_historical_prices() → self._price_histories
    │        4. Apply clustering (KMeans on volatility, price_change, liquidity)
    │        5. Compute momentum/volatility per currency
    │        6. Cache with TTL (default: 5 min)
    │        │
    │        return: updated snapshot
    │
    ├─→ DataSnapshot.get_prices()
    │        │
    │        return: [{currency, bid, ask, mid, volume, momentum, volatility, cluster}, ...]
    │
    └─→ Scheduler (APScheduler, every 5 min)
             │
             DataSnapshot.refresh()
             │
             HistoricalStore.append_prices(snapshot)
             │
             ws_manager.broadcast_snapshot(snapshot)  // Push to WebSocket clients
```

### 3.2 HistoricalStore (SQLite Persistence)

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
    ├─→ prune_expired_events() ─────────────→ UPDATE events SET is_active = 0 WHERE expires_at < NOW()
    │
    └─→ prune_old_prices(days=30) ──────────→ DELETE FROM prices_history WHERE timestamp < datetime('now', '-30 days')
           │
           └─→ Called by scheduler weekly
```

### 3.3 Scheduled Tasks (APScheduler)

| Job ID | Schedule | Function | Description |
|--------|----------|----------|-------------|
| `snapshot_refresh` | Every 5 min | `DataSnapshot.refresh()` | Fetch fresh data from POE2Scout |
| `append_to_history` | After snapshot | `HistoricalStore.append_prices()` | Persist snapshot to SQLite |
| `broadcast_update` | After snapshot | `ws_manager.broadcast()` | Push to WebSocket clients |
| `prune_events` | Every hour | `EventManager.prune_expired()` | Clean up expired events |
| `prune_history` | Sunday 3 AM | `HistoricalStore.prune_old_prices()` | Remove prices older than 30 days |
| `warm_cache` | Every 30 min | `Poe2ScoutProvider.warm_cache()` | Pre-fetch frequently used data |

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
  PriceLogs: (RawPriceLogEntry | null)[];  // ⚠️ NEWEST FIRST!
  CurrentPrice: number | null;
  CurrentQuantity: number | null;
}

interface PoeItem {
  id: string;                // = String(CurrencyItemId || ItemId) — prefer CurrencyItemId
  apiId: string;             // = ApiId
  name: string;              // = Text
  type: string;              // = CategoryApiId
  category: string;           // = CategoryApiId
  iconUrl: string | null;    // = IconUrl
  price: number | null;       // = CurrentPrice
  priceChaos: number | null; // = CurrentPrice (PoE2 base = Exalted)
  relativePrice: number | null; // = CurrentPrice / referencePrice
  change: number | null;     // = currentPrice - previousPrice (from PriceLogs)
  changePercent: number | null; // = ((now - 24h_ago) / 24h_ago) * 100
  volume: number | null;     // = sum(Quantity) for last 24h from PriceLogs
  sevenDayPriceChange: number | null;
  sevenDayPriceChangePercent: number | null;
  history: PoeItemHistoryPoint[] | null;
  dailyStats: DailyStat[] | null;
  lowConfidence: boolean;    // = CurrentQuantity < 5
  listingCount: number | null; // = CurrentQuantity
}
```

### 4.2 ExchangePair Transformation

```typescript
// Source: RawSnapshotPair from POE2Scout API
// Destination: ExchangePair (src/lib/types.ts)

interface RawSnapshotPair {
  CurrencyExchangeSnapshotPairId: number;
  CurrencyOne: { ItemId: number; ApiId: string; Text: string; IconUrl: string | null };
  CurrencyTwo: { ItemId: number; ApiId: string; Text: string; IconUrl: string | null };
  CurrencyOneData: { RelativePrice: string; VolumeTraded: number; ... };
  CurrencyTwoData: { RelativePrice: string; VolumeTraded: number; ... };
}

interface ExchangePair {
  id: string;                  // = String(CurrencyExchangeSnapshotPairId)
  currency1Id: string;          // = CurrencyOne.ApiId (e.g. "divine")
  currency1Name: string;       // = CurrencyOne.Text (e.g. "Divine Orb")
  currency1IconUrl: string | null;
  currency1ItemId: number;     // = CurrencyOne.ItemId (⚠️ NUMERIC! Use for history API)
  currency2Id: string;
  currency2Name: string;
  currency2IconUrl: string | null;
  currency2ItemId: number;
  price: number | null;        // = parseFloat(RelativePrice) || null
  relativePrice: number;        // = price ?? 0
  volume: number;              // = CurrencyOneData.VolumeTraded
  change: number | null;
  changePercent: number | null;
  history: ExchangePairHistoryPoint[] | null;
}
```

**⚠️ CRITICAL:** Use `currency1ItemId` (numeric) for history API calls, NOT `currency1Id` (string ApiId).

---

## §5. Formula Reference (Canonical)

> **IMPORTANT:** All formulas in this section are the authoritative source. When modifying calculations, update this section.

### 5.1 Price Change Calculations

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

  // Find closest entry to 24h ago
  let closest = sorted[0];
  let minDiff = Infinity;
  for (const log of sorted) {
    const diff = Math.abs(log.Time.getTime() - targetTime.getTime());
    if (diff < minDiff) { minDiff = diff; closest = log; }
  }

  // If data is too sparse (>6h gap), return null
  if (minDiff > 6 * 60 * 60 * 1000) return null;

  return ((now.Price - closest.Price) / closest.Price) * 100;
}

// §5.1.3: Compute 7d change percent
// Formula: ((current_price - price_7d_ago) / price_7d_ago) * 100
function computeSevenDayChangePercent(logs: RawPriceLogEntry[]): number | null {
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
// Formula: CurrentPrice / ReferenceCurrencyPrice
function computeRelativePrice(currentPrice: number, referencePrice: number): number {
  if (!currentPrice || !referencePrice) return 0;
  return currentPrice / referencePrice;
}
```

### 5.2 Backend Analytics Formulas

#### 5.2.1 Momentum Calculation

```python
# Formula: mean(log_returns) over lookback window
# log_return = ln(price_t / price_t-1)

def compute_momentum(price_history: list[PricePoint], lookback_hours: int = 24) -> float:
    """
    Momentum indicator: average logarithmic return.
    Positive = upward trend, Negative = downward trend.
    Range: approximately -0.1 to +0.1 for typical currencies.
    """
    if len(price_history) < 2:
        return 0.0

    cutoff = datetime.utcnow() - timedelta(hours=lookback_hours)
    recent = [p for p in price_history if p.timestamp >= cutoff]

    if len(recent) < 2:
        return 0.0

    log_returns = []
    for i in range(1, len(recent)):
        if recent[i-1].price > 0:
            log_returns.append(math.log(recent[i].price / recent[i-1].price))

    return statistics.mean(log_returns) if log_returns else 0.0
```

#### 5.2.2 Volatility Calculation

```python
# Formula: standard deviation of log_returns (ddof=1)
# Uses sample standard deviation for better estimation

def compute_volatility(price_history: list[PricePoint], lookback_hours: int = 24) -> float:
    """
    Volatility indicator: standard deviation of log returns.
    Higher = more volatile/risky currency.
    Range: 0.01 to 0.5+ for extreme cases.
    """
    if len(price_history) < 3:
        return 0.0

    cutoff = datetime.utcnow() - timedelta(hours=lookback_hours)
    recent = [p for p in price_history if p.timestamp >= cutoff]

    if len(recent) < 3:
        return 0.0

    log_returns = []
    for i in range(1, len(recent)):
        if recent[i-1].price > 0:
            log_returns.append(math.log(recent[i].price / recent[i-1].price))

    if len(log_returns) < 2:
        return 0.0

    # Sample standard deviation (ddof=1)
    mean = statistics.mean(log_returns)
    variance = sum((x - mean) ** 2 for x in log_returns) / (len(log_returns) - 1)
    return math.sqrt(variance)
```

#### 5.2.3 Currency Clustering

> **⚠️ CORRECTION (2026-06-02):** The old version of this section described a
> threshold heuristic (weighted sum with cutoffs 0.25/0.5). This was **never
> implemented**. The actual code uses **KMeans clustering** as described below
> and as documented in `PoE2_Flipper_Canonical_Formulas.md §5`.

```python
# KMeans clustering on normalized features (backend/predictors/clustering.py)
# Features: [volatility_24h, price_change_rate_24h, liquidity_score_24h]
# All features are min-max normalized to [0,1]; if all identical -> 0.5

from sklearn.cluster import KMeans

def cluster_currencies(
    price_histories: dict[str, list[float]],
    volumes_24h: dict[str, float],
    prices_now: dict[str, float],
    prices_24h_ago: dict[str, float],
) -> dict[str, ClusterLabel]:
    """
    One-shot clustering: compute features, normalize, run KMeans, assign labels.

    Algorithm: KMeans(n_clusters=3, init='k-means++', n_init=10, random_state=42)

    Cluster label assignment (post-hoc, centroid-based):
        stable           = argmin(centroid[:, 0])  # lowest volatility
        volatile_illiquid = argmax(centroid[:, 0])  # highest volatility
        moderate          = remaining cluster

    Tiebreaker (if two centroids have volatility difference < 0.1):
        lower liquidity -> volatile_illiquid
    """
    # Step 1: Compute features per currency
    #   volatility_24h = std(log_returns, ddof=1) over window
    #   price_change_rate_24h = (price_now - price_24h_ago) / price_24h_ago
    #   liquidity_score_24h = log1p(volume_24h) / log1p(max_volume)

    # Step 2: Min-max normalize to [0,1]

    # Step 3: KMeans with k=3

    # Step 4: Assign semantic labels based on centroid volatility ordering
```

#### 5.2.4 Flip Opportunity Scoring

> **⚠️ CORRECTION (2026-06-02):** The old version described a weighted-sum formula
> with CLUSTER_PENALTIES and PHASE_MULTIPLIERS for standard/flashback/event.
> This was **never implemented**. The actual scoring follows
> `PoE2_Flipper_Canonical_Formulas.md §7` — expected profit per trade,
> scaled by fill probability and penalty factors. Gold fees are excluded.

```python
# Score = expected_profit * momentum_penalty * vol_penalty * phase_multiplier
# Output: 0.0 to 1.0
# Gold/commission fees are EXCLUDED from all calculations.

# From backend/arbitrage/scorer.py:

PHASE_MULTIPLIERS = {
    'early': 1.2,
    'mid': 1.0,
    'late': 0.9,
}

# League type multipliers (stack on top of phase):
#   standard: 1.0, flashback: 1.5, event: 2.0

def compute_opportunity_score(
    bid: float, ask: float, mid_price: float,
    volume_24h: float, max_volume: float,
    volatility: float, phase_multiplier: float,
    momentum: float,
    momentum_neg_threshold: float = -0.01,
    vol_reference: float = 0.05,
) -> float:
    """
    Compute flip opportunity score.

    Formula (gold fees excluded per project decision):
        spread = (ask - bid) / mid_price
        fill_probability = log1p(volume_24h) / log1p(max_volume)
        expected_profit = spread * fill_probability
        momentum_penalty:
            0.5 if momentum < -0.01 (strong negative)
            0.8 if -0.01 <= momentum < 0 (slight negative)
            1.0 if momentum >= 0 (positive)
        vol_penalty = 1.0 / (1.0 + (volatility / vol_reference)^2)
        score = expected_profit * momentum_penalty * vol_penalty * phase_multiplier
        score = clamp(score, 0.0, 1.0)
    """
    spread = (ask - bid) / mid_price
    fill_probability = log1p(volume_24h) / log1p(max_volume)
    expected_profit = spread * fill_probability

    if momentum < momentum_neg_threshold:
        momentum_penalty = 0.5
    elif momentum < 0:
        momentum_penalty = 0.8
    else:
        momentum_penalty = 1.0

    vol_penalty = 1.0 / (1.0 + (volatility / vol_reference) ** 2)

    score = expected_profit * momentum_penalty * vol_penalty * phase_multiplier
    return min(max(score, 0.0), 1.0)
```

#### 5.2.5 Triangular Arbitrage Detection

> **⚠️ CORRECTION (2026-06-02):** The old signature accepted a nested dict
> `exchange_rates: dict[str, dict[str, float]]`. The actual code uses a flat
> dict with tuple keys plus a separate prices dict. Gold fees are excluded.

```python
# Uses Bellman-Ford algorithm to detect negative cycles in currency graph
# From backend/arbitrage/triangular.py:

def find_triangular_arbitrage(
    rates: dict[tuple[str, str], float],  # (currency_from, currency_to) -> raw_rate
    prices: dict[str, float],             # currency -> price in reference currency
    min_profit_pct: float = 0.1,
    pair_volumes: dict[tuple[str, str], float] | None = None,
    snapshot_time: datetime | None = None,
) -> list[TriangularOpportunity]:
    """
    Find profitable triangular (and multi-hop) arbitrage cycles.

    Gold/commission fees are EXCLUDED — raw rates are used directly.

    Edge weight: -ln(raw_rate)
    Cycle validation: simulated profit < min_profit_pct → discarded

    Confidence score based on:
    - Data freshness (max 1.0 if <5min old, decays)
    - Volume (bottleneck = min across edges)
    - Cycle length penalty = 1/len(cycle)
    """
```

#### 5.2.6 Portfolio Optimization (Risk Parity)

> **⚠️ CORRECTION (2026-06-02):** Risk parity now uses Ledoit-Wolf shrinkage
> for the covariance matrix (was using plain sample covariance, which is noisier
> with small samples). This matches the min_variance method and the original
> documentation claim.

```python
# Ledoit-Wolf shrinkage estimator for covariance matrix (now used for BOTH methods)
# Then optimize for risk parity (equal risk contribution)

def optimize_portfolio_risk_parity(
    price_histories: dict[str, list[PricePoint]],
    lookback_days: int = 30
) -> dict[str, float]:
    """
    Optimize portfolio weights using risk parity approach.

    1. Compute log-returns matrix
    2. Apply Ledoit-Wolf shrinkage to covariance matrix
    3. Solve for risk-parity weights (each asset contributes equally to portfolio risk)
    """
    # Step 1: Compute log returns
    returns = {}
    for currency, history in price_histories.items():
        sorted_history = sorted(history, key=lambda x: x.timestamp)
        if len(sorted_history) < 10:
            continue
        log_returns = []
        for i in range(1, len(sorted_history)):
            if sorted_history[i-1].price > 0:
                log_returns.append(math.log(
                    sorted_history[i].price / sorted_history[i-1].price
                ))
        returns[currency] = log_returns

    if not returns:
        return {}

    # Find common length
    min_len = min(len(r) for r in returns.values())
    returns_matrix = np.array([r[-min_len:] for r in returns.values()])

    # Step 2: Ledoit-Wolf shrinkage
    cov_matrix = ledoit_wolf_shrinkage(returns_matrix.T)

    # Step 3: Risk parity optimization
    # Minimize: sum((w_i * marginal_risk_i - portfolio_risk/n)^2)
    # Subject to: sum(w_i) = 1, w_i >= 0

    def risk_contribution(w, cov):
        port_vol = np.sqrt(w @ cov @ w)
        marginal = cov @ w
        return w * marginal / port_vol

    def risk_parity_objective(w, cov):
        n = len(w)
        rc = risk_contribution(w, cov)
        target_rc = np.ones(n) * (np.sqrt(w @ cov @ w) / n)
        return np.sum((rc - target_rc) ** 2)

    # Initial guess: equal weights
    n = len(returns)
    w0 = np.ones(n) / n

    # Optimize
    result = minimize(
        risk_parity_objective,
        w0,
        args=(cov_matrix,),
        method='SLSQP',
        bounds=[(0.01, 0.5) for _ in range(n)],  # Max 50%, min 1% per asset
        constraints={'type': 'eq', 'fun': lambda w: np.sum(w) - 1}
    )

    weights = dict(zip(returns.keys(), result.x))
    return {k: float(v) for k, v in weights.items()}
```

#### 5.2.7 Forecasting

> **⚠️ CORRECTION (2026-06-02):** The old version described a simple binary
> choice (LightGBM if <50 points, SARIMA otherwise). The actual system runs
> **three models in parallel** with model agreement checks and event flags.

```python
# Three models run in parallel (backend/predictors/time_series.py):
# 1. SARIMA — auto_arima with ADF test for stationarity
# 2. Holt-Winters — exponential smoothing (short-horizon secondary opinion)
# 3. LightGBM — primary short-horizon model with feature engineering
#
# All models operate on log-prices; convert back to price space at output.

class ForecastEngine:
    def forecast(
        self, currency, price_series, volumes, timestamps,
        is_event_active, seasonal_period
    ) -> dict[str, ForecastResult]:
        """
        Run all available forecasting models and return results.

        Strategy:
        1. Convert prices to log-prices
        2. Auto-detect seasonal period from data frequency
        3. Run SARIMA, Holt-Winters, and LightGBM in parallel
        4. Check model agreement: if SARIMA and LightGBM diverge >20%,
           flag disagreement=True on both results

        Event flag behavior:
        - SARIMA: labeled low_confidence=True when event active
        - Holt-Winters: disabled entirely when event active
        - LightGBM: includes is_event_active feature

        Returns dict: {'sarima': ForecastResult, 'holt_winters': ForecastResult,
                       'lightgbm': ForecastResult}
        """
```

---

## §6. Caching Strategy

### 6.1 Frontend Cache (poe2api.ts)

> **⚠️ CORRECTION (2026-06-02):** The old version described an `inflight` field
> stored inside the cache entry. The actual implementation uses a **separate**
> `pendingRequests` Map for request deduplication, not an `inflight` field in
> the cache. The cache only stores `{ data, ts }`.

```typescript
// In-memory cache with stale-while-revalidate
// NOTE: Cache entries do NOT contain an 'inflight' field.
// Request deduplication uses a SEPARATE Map (pendingRequests).
const cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL = 60_000;         // 60s — fresh
const CACHE_STALE_TTL = 600_000;  // 10min — serve stale, revalidate in background
const REQUEST_DEDUP_WINDOW = 10_000; // 10s — dedup concurrent identical requests

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
      // Last resort — return very stale data if available
      if (hit) { return hit.data as T; }
      throw err;
    })
    .finally(() => pendingRequests.delete(url));

  pendingRequests.set(url, fetchPromise);
  return fetchPromise;
}
```

### 6.2 Backend Cache (Poe2ScoutProvider)

```python
class Poe2ScoutProvider:
    def __init__(self):
        self._metadata_cache: dict[str, tuple[list[CurrencyInfo], float]] = {}
        self._metadata_cache_ttl = 3600.0  # 1 hour
        self._exchange_cache: dict[str, tuple[dict, float]] = {}
        self._exchange_cache_ttl = 300.0  # 5 minutes

    async def get_currency_metadata(self, league: str) -> list[CurrencyInfo]:
        if league in self._metadata_cache:
            cached_meta, cached_ts = self._metadata_cache[league]
            if time.time() - cached_ts < self._metadata_cache_ttl:
                return cached_meta

        result = await self._fetch_all_categories(league)
        self._metadata_cache[league] = (result, time.time())
        return result

    def invalidate_cache(self, league: str = None):
        """Explicit cache invalidation."""
        if league:
            self._metadata_cache.pop(league, None)
            self._exchange_cache.pop(league, None)
        else:
            self._metadata_cache.clear()
            self._exchange_cache.clear()
```

### 6.3 DataSnapshot Cache

```python
@dataclass
class DataSnapshot:
    _exchange_rates: dict[str, ExchangeRate]
    _currencies: list[CurrencyInfo]
    _price_histories: dict[str, list[PricePoint]]
    _clusters: dict[str, str]
    _last_refresh: float
    _refreshing: bool = False

    SNAPSHOT_TTL = 300.0  # 5 minutes

    def is_stale(self) -> bool:
        return time.time() - self._last_refresh > self.SNAPSHOT_TTL

    def is_refreshing(self) -> bool:
        return self._refreshing

    async def get_or_refresh(self) -> 'DataSnapshot':
        """Get snapshot, refresh if stale or not refreshing."""
        if self.is_stale() and not self.is_refreshing():
            await self.refresh()
        return self
```

---

## §7. Error Handling & Fallbacks

### 7.1 Network Errors (poe2api.ts)

```typescript
// unwrapNetworkError: walk AggregateError/cause chain
// ETIMEDOUT/ECONNRESET → retry with backoff
// ECONNREFUSED/ENOTFOUND → throw with hint

const FETCH_RETRIES = 3;
const FETCH_TIMEOUT = 30_000;
const RETRY_BACKOFF = [1000, 2000, 4000]; // ms

// 4xx errors (client errors) → don't retry, throw immediately
// AbortError (timeout) → throw immediately
// ECONNRESET/EPIPE/ETIMEDOUT → retry with backoff
// ECONNREFUSED/ENOTFOUND → throw with hint
```

**Fallback data on error:**

| Function | Fallback |
|----------|----------|
| `getRealms()` | `FALLBACK_REALMS` (poe2, pc, xbox, sony) |
| `getLeagues()` | `FALLBACK_LEAGUES` (per realm) |
| `getItemCategories()` | `[{name: "all", displayName: "All", count: 0}]` |
| `getReferenceCurrencies()` | `[{apiId: "exalted", ...}, {apiId: "divine", ...}, {apiId: "chaos", ...}]` |
| All other functions | Return empty array `[]` |

### 7.2 Backend Offline Detection (flipper-proxy.ts)

```typescript
interface proxyOptions {
  offlineFallback?: T;
  timeout?: number;
}

async function proxyWithFallback<T>(
  path: string,
  options: proxyOptions,
  searchParams: URLSearchParams
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeout ?? 15000);

  try {
    const res = await fetch(FASTAPI_URL + path + "?" + searchParams.toString(), {
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return Response.json(
        { error_type: mapStatusToErrorType(res.status), ...body },
        { status: res.status }
      );
    }
    return Response.json(await res.json());
  } catch (err) {
    clearTimeout(timeoutId);
    if (isConnectionError(err)) {
      return Response.json(
        { error_type: "backend_offline", detail: "Backend not reachable" },
        { status: 503 }
      );
    }
    if (err instanceof DOMException && err.name === 'AbortError') {
      return Response.json(
        { error_type: "backend_timeout", detail: "Backend request timed out" },
        { status: 504 }
      );
    }
    return Response.json(options.offlineFallback ?? { error: "Unknown error" }, { status: 500 });
  }
}
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
  | "validation_error";         // Invalid parameters

class FlipperApiError extends Error {
  status: number;
  errorType: FlipperErrorType | undefined;
  detail: string | undefined;
  hint: string | undefined;
}
```

---

## §8. WebSocket Real-Time Updates

### 8.1 Connection Flow

```
Browser
    │
    ├─→ Connect to wss://backend/ws?token=xxx
    │        │
    │        ws_manager.register(client, channels)
    │        │
    │        Subscribe to channels:
    │        ├─→ prices: bid/ask updates
    │        ├─→ flips: new opportunity alerts
    │        ├─→ events: market events
    │        └─→ snapshot: periodic market state
    │
    └─→ Receive messages
             │
             Message format:
             {
               channel: string,
               event: "update" | "alert" | "snapshot",
               data: unknown,
               timestamp: ISO8601
             }
```

### 8.2 Server-Side Broadcasting

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

        # Clean up disconnected
        for conn in disconnected:
            self.disconnect(conn, [channel])

# Broadcasting from scheduler (every 5 min)
async def on_snapshot_refreshed(snapshot: DataSnapshot):
    await ws_manager.broadcast("snapshot", {
        "event": "snapshot",
        "data": {
            "prices": snapshot.get_prices(),
            "timestamp": datetime.utcnow().isoformat()
        }
    })
```

---

## §9. Event System

### 9.1 Event Types

| Type | Description | Impact on Scoring |
|------|-------------|-------------------|
| `league_start` | New league launched | Phase multiplier = 2.0 |
| `flashback` | Flashback league | Phase multiplier = 1.5 |
| `race` | Race event | Phase multiplier = 1.3 |
| `tempest` |特定类型的天气事件 | Momentum boost +0.1 |
| `invasion` | Boss invasion | Volatility boost x1.5 |
| `custom` | User-defined event | Configurable multiplier |

### 9.2 Event Schema

```python
class Event(BaseModel):
    event_id: str           # Unique identifier (e.g., "evt_2024_001")
    type: str                # Event type from table above
    description: str         # Human-readable description
    created_at: datetime
    expires_at: datetime
    is_active: bool = True
    metadata: dict = {}       # Type-specific data
                            # e.g., {"multiplier": 2.0, "affected_currencies": ["divine", "exalted"]}
```

---

## §10. API Path Reference

### 10.1 Frontend Routes (Next.js)

```
Frontend API Routes (src/app/api/)
│
├── poe2/                          # Direct POE2Scout proxy (no backend required)
│   ├── realms/route.ts            → getRealms()
│   ├── leagues/route.ts           → getLeagues(realm)
│   ├── exchange/route.ts          → getExchangeSnapshot(realm, league)
│   ├── currencies/route.ts        → getCurrenciesByCategory(...)
│   ├── uniques/route.ts           → getUniquesByCategory(...)
│   ├── items/route.ts              → getItems(realm, league)
│   ├── overview/route.ts          → LandingSplashInfo (top items, top currencies)
│   ├── snapshot-history/route.ts  → getSnapshotHistory(realm, league, hours)
│   ├── currency-pair-history/route.ts → getCurrencyPairHistory(realm, league, id1, id2, hours)
│   ├── reference-currencies/route.ts  → getReferenceCurrencies(realm, league)
│   └── health/route.ts            → Health check (POE2Scout reachability)
│
└── flipper/                       # FastAPI backend proxy (requires backend)
    ├── health/route.ts            → GET /api/health
    ├── phase/route.ts             → GET /api/phase
    ├── currencies/route.ts        → GET /api/currencies
    ├── prices/route.ts            → GET /api/prices
    ├── heatmap/route.ts           → GET /api/prices/heatmap
    ├── flips/route.ts             → GET /api/arbitrage/flips
    ├── triangular/route.ts        → GET /api/arbitrage/triangular
    ├── forecast/[currency]/route.ts → GET /api/forecast/{currency}
    ├── anomalies/route.ts         → GET /api/anomalies
    ├── storage-value/[currency]/route.ts → GET /api/storage-value/{currency}
    ├── portfolio/route.ts         → GET /api/portfolio
    ├── portfolio/frontier/route.ts → GET /api/portfolio/frontier
    ├── portfolio/rebalance/route.ts → POST /api/portfolio/rebalance
    ├── recipes/route.ts           → GET /api/recipes
    ├── events/route.ts            → GET/POST /api/events
    ├── events/[eventId]/route.ts  → GET/PUT/DELETE /api/events/{id}
    └── ws/route.ts                → WebSocket upgrade
```

### 10.2 Backend Routes (FastAPI)

```
FastAPI Routes (backend/api/)
│
├── routes_prices.py          # /api/prices, /api/prices/heatmap, /api/currencies
├── routes_arbitrage.py        # /api/arbitrage/flips, /api/arbitrage/triangular
├── routes_forecast.py         # /api/forecast/{currency}
├── routes_portfolio.py        # /api/portfolio, /api/portfolio/frontier, /api/portfolio/rebalance
├── routes_events.py           # /api/events, /api/events/{id}
├── routes_anomalies.py        # /api/anomalies
├── routes_storage_value.py    # /api/storage-value/{currency}
├── routes_phase.py            # /api/phase
├── routes_recipes.py          # /api/recipes
├── routes_ws.py               # WebSocket /ws
├── routes_auth.py             # OAuth2 authentication
└── main.py                    # App entry, CORS, lifespan events
```

### 10.3 POE2Scout API Paths

```
POE2Scout API (base: https://api.poe2scout.com/api)
│
├── Realms                                          # GET — list realms (snake_case!)
├── {realm}/Leagues                                 # GET — list leagues
├── {realm}/Leagues/{league}/SnapshotPairs          # GET — all currency pairs
├── {realm}/Leagues/{league}/SnapshotHistory        # GET — market history
├── {realm}/Leagues/{league}/ExchangeSnapshot        # GET — exchange overview
├── {realm}/Leagues/{league}/ReferenceCurrencies    # GET — bridge currencies
├── {realm}/Leagues/{league}/Items                  # GET — all items
├── {realm}/Leagues/{league}/Items/Categories       # GET — item categories
├── {realm}/Leagues/{league}/Items/{itemId}        # GET — single item
├── {realm}/Leagues/{league}/Items/{itemId}/History # GET — price history (⚠️ multiple of 4)
├── {realm}/Leagues/{league}/Items/{itemId}/DailyStatsHistory # GET — OHLCV
├── {realm}/Leagues/{league}/Currencies/ByCategory # GET — currencies (paginated)
├── {realm}/Leagues/{league}/Currencies/{apiId}    # GET — single currency
├── {realm}/Leagues/{league}/Currencies/Pairs/{id1}/{id2}/History # GET — pair history
├── {realm}/Leagues/{league}/Uniques/ByCategory     # GET — uniques (paginated)
└── Realms/{realm}/Filters                           # GET — realm filters
```

---

## §11. Critical Gotchas for LLM Agents

### §11.1 Data Source Confusion

1. **Never assume data comes from the backend** — check which route handles it:
   - `/api/poe2/*` → POE2Scout API directly (no backend)
   - `/api/flipper/*` → FastAPI backend (with analytics)

2. **Never hardcode API paths** — use the exported functions from `src/lib/poe2api.ts` or `src/lib/flipper-proxy.ts`.

3. **Never use string ApiId where numeric ItemId is required** — the CurrencyPairHistory endpoint expects integers.

### §11.2 Response Shape Pitfalls

1. **PriceLogs are newest-first** — always sort before computing changes.
2. **Category=all returns empty** — must merge all categories.
3. **League IsCurrent is always false** — use realm's default_league_value.
4. **Some numeric fields come as strings** — use safeParseFloat() or Number().
5. **Pagination metadata differs** — API uses `CurrentPage/Pages/Total`, frontend uses `page/totalPages/totalItems`.

### §11.3 Type Mismatches

1. **Frontend uses camelCase** — API returns PascalCase. Transformation happens in poe2api.ts.
2. **Backend uses snake_case** — Python Pydantic models use snake_case.
3. **ExchangePair uses numeric ItemId** — not string ApiId for history calls.
4. **FlipOpportunity.spread is raw** — gold fees are NOT deducted (design decision).

### §11.4 Caching Assumptions

1. **Server-side cache in poe2api.ts** — same request returns same data for 60s.
2. **Backend DataSnapshot refreshes every 5 min** — analytics lag behind real-time.
3. **HistoricalStore is SQLite** — persists across restarts, used for forecasting.
4. **Metadata cache in Poe2ScoutProvider** — 1-hour TTL to avoid N+1 requests.

### §11.5 Error Handling Patterns

1. **Fallback data** — never show blank UI, always have fallback values.
2. **Backend offline detection** — check `/api/flipper/health` on mount.
3. **Graceful degradation** — market tabs work without backend, flipper tabs show offline message.
4. **Retry with backoff** — transient network errors retry 3 times before failing.

---

## §12. Quick Reference: Data → Component

### 12.1 Overview Tab

```
src/components/dashboard/OverviewTab.tsx
    │
    ├─→ getRealms() → realm selector
    ├─→ getLeagues(realm) → league selector
    ├─→ getSnapshotHistory(league) → chart (totalVolume, totalMarketCap over time)
    └─→ getSnapshotPairs(league) → top pairs table (enriched with history for top 20)
```

### 12.2 Currencies Tab

```
src/components/dashboard/CurrenciesTab.tsx
    │
    ├─→ getItemCategories() → category selector
    ├─→ getCurrenciesByCategory(category, page) → virtual scrolling list
    │       │
    │       Each row:
    │       ├─→ iconUrl (item icon)
    │       ├─→ name (item name)
    │       ├─→ price (current price)
    │       ├─→ changePercent (24h change, from PriceLogs)
    │       ├─→ volume (24h volume, from PriceLogs)
    │       └─→ Click → detail panel
    └─→ Detail panel:
            ├─→ getItemHistory(itemId) → line chart
            └─→ getItemDailyStats(itemId) → candlestick chart
```

### 12.3 Uniques Tab

```
src/components/dashboard/UniquesTab.tsx
    │
    ├─→ getItemCategories() → category selector
    ├─→ getUniquesByCategory(category, page, search) → paginated list with search
    │       │
    │       Each row: iconUrl, name, price
    └─→ Detail panel:
            ├─→ getItemHistory(itemId) → line chart
            └─→ getItemDailyStats(itemId) → candlestick chart
```

### 12.4 Exchange Tab

```
src/components/dashboard/ExchangeTab.tsx
    │
    ├─→ getExchangeSnapshot() → reference currency selector
    ├─→ getSnapshotPairs() → pairs table (top 20 enriched with history)
    │       │
    │       Each row: currency1Name/currency2Name, relativePrice, volume, changePercent
    │       Click → getCurrencyPairHistory(id1, id2) → chart
    └─→ getReferenceCurrencies() → reference currency pills
```

### 12.5 Flips Tab (Requires Backend)

```
src/components/dashboard/FlipsTab.tsx
    │
    ├─→ GET /api/flipper/health → check backend status
    │       │
    │       If offline: show FlipperBackendStatusCard
    │       If online: continue
    │
    ├─→ GET /api/flipper/prices → all prices with clusters
    │
    ├─→ GET /api/flipper/flips → scored opportunities
    │       │
    │       Each row: currency, score (color-coded), spread, volume_24h, momentum, cluster
    │
    ├─→ GET /api/flipper/events → active market events
    │
    └─→ WebSocket /ws → live price updates
```

### 12.6 Portfolio Tab (Requires Backend)

```
src/components/dashboard/PortfolioTab.tsx
    │
    ├─→ GET /api/flipper/portfolio → optimized weights
    │       │
    │       Show: pie chart of weights, expected risk, correlation warnings
    │
    ├─→ GET /api/flipper/portfolio/frontier → efficient frontier
    │       │
    │       Show: scatter plot of risk vs return
    │
    └─→ POST /api/flipper/portfolio/rebalance → apply rebalance
```

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

### A.5 Not Using Safe Parse for Numeric Strings

**WRONG:**
```typescript
const price = data.CurrentPrice; // String "123.45" — causes type issues
const volume = data.VolumeTraded; // String "1000000" — arithmetic fails
```

**CORRECT:**
```typescript
const price = safeParseFloat(data.CurrentPrice); // 123.45
const volume = safeParseFloat(data.VolumeTraded) || 0; // 1000000
```

---

## Appendix B: Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `POE2_API_BASE_URL` | `https://api.poe2scout.com/api` | POE2Scout API base URL |
| `FASTAPI_URL` | `http://localhost:8000` | FastAPI backend URL |
| `CORS_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | Allowed CORS origins |
| `DATABASE_URL` | `sqlite:///./poe2scout.db` | SQLite database path |
| `SNAPSHOT_REFRESH_INTERVAL` | `300` | Snapshot refresh interval in seconds |
| `HISTORY_RETENTION_DAYS` | `30` | Days to retain historical prices |
| `WS_HEARTBEAT_INTERVAL` | `30` | WebSocket heartbeat in seconds |

---

## Appendix C: Glossary

| Term | Definition |
|------|------------|
| **PriceLog** | Individual price observation with timestamp, price, quantity |
| **Momentum** | Mean log-return over lookback period (positive=up, negative=down) |
| **Volatility** | Standard deviation of log-returns (higher=more volatile) |
| **Spread** | (ask - bid) / mid_price — measure of liquidity |
| **Cluster** | Classification: stable/moderate/volatile_illiquid |
| **RelativePrice** | Price expressed in reference currency (e.g., chaos) |
| **Triangular Arbitrage** | Profitable cycle through 3 currencies |
| **Risk Parity** | Portfolio optimization where each asset contributes equally to risk |
| **Ledoit-Wolf Shrinkage** | Method to improve covariance matrix estimation |

---

*This document is the single source of truth for data flows in the PoE2 Market Dashboard. Update this file when adding new endpoints, changing data transformations, or modifying algorithms.*
