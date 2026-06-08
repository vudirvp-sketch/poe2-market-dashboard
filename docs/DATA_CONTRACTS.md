# PoE2 Market Dashboard — Data Contracts

> **Version:** 1.0 | **Date:** 2026-06-08

---

## 1. Key Naming Conventions

| Layer | Convention | Example |
|-------|-----------|---------|
| POE2Scout API responses | PascalCase | `CurrencyItemId`, `RelativePrice` |
| POE2Scout `/Realms` | snake_case | `default_league_value`, `game_api_id` |
| Frontend TypeScript types | camelCase | `currencyItemId`, `relativePrice` |
| Backend Python attrs | snake_case | `currency_item_id`, `relative_price` |
| Backend JSON serialization | PascalCase (via Pydantic alias) | `CurrencyItemId` |
| Proxy transform | snake_case → camelCase | `days_since_reference` → `daysSinceReference` |

**Single source of truth:** All frontend types in `src/lib/types.ts`. No duplicates.

## 2. Core Frontend Types

### 2.1 Realm & League

```typescript
interface Realm {
  name: string;
  displayName: string;
  defaultLeague?: string;
}

interface League {
  name: string;          // ShortName: "runes"
  displayName: string;   // "Runes of Aldur"
  startAt: string | null;
  endAt: string | null;
  active: boolean;
  baseCurrencyApiId?: string;
  baseCurrencyText?: string;
  defaultCurrency?: {
    apiId: string;
    text: string;
    iconUrl: string | null;
    relativePrice: number;
  };
}
```

### 2.2 Currency & Exchange

```typescript
interface PoeItem {
  id: string;
  apiId: string;
  name: string;
  type: string;
  category: string;
  iconUrl: string | null;
  price: number | null;
  chaosEquivalentRate: number | null;   // POE2Scout modeled rate (ratio, not tradeable price)
  relativePrice: number | null;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
  sevenDayPriceChange: number | null;
  sevenDayPriceChangePercent: number | null;
  history: PoeItemHistoryPoint[] | null;
  dailyStats: DailyStat[] | null;
  lowConfidence: boolean;
  listingCount: number | null;
  baseType: string | null;
  links: number | null;
  variant: string | null;
  levelRequired: number | null;
}

interface ExchangePair {
  id: string;
  currency1Id: string;
  currency1Name: string;
  currency1IconUrl: string | null;
  currency1ItemId: number;              // Required for CurrencyPairHistory API
  currency2Id: string;
  currency2Name: string;
  currency2IconUrl: string | null;
  currency2ItemId: number;
  price: number | null;                 // null = data error (distinguished from "free")
  relativePrice: number | null;         // null when no trade data ("0E-8")
  currency2RelativePrice: number | null; // Required for cross-rate computation
  volume: number;
  change: number | null;
  changePercent: number | null;
  sevenDayChange: number | null;
  sevenDayChangePercent: number | null;
  history: ExchangePairHistoryPoint[] | null;
}
```

### 2.3 Flipper Types

```typescript
interface FlipOpportunity {
  currency: string;
  score: number;
  spread?: number;          // ⚠️ May be undefined — use ?? 0
  spreadAfterFees?: number; // @deprecated — use spread
  volume24h?: number;       // ⚠️ May be undefined
  momentum?: number;        // ⚠️ May be undefined
  volatility?: number;      // ⚠️ May be undefined
  cluster: string;
  bid?: number;
  ask?: number;
  midPrice?: number;
  quantizedAnalysis?: QuantizedAnalysis;
  tierDistance?: number;
}

interface QuantizedAnalysis {
  qSpreads: Record<string, QuantizedSpread>;
  minProfitableLot: number;
  optimalLotProfitPct: number;
  recommendedRatio: [number, number];
  brickResistance: number;
  theoreticalSpread: number;
}

interface TriangularCycle {
  cycle: string[];
  netProfitPct: number;
  stepRates: number[];
  totalVolume?: number;       // ⚠️ May be undefined
  confidence: number;
  minStartingAmount?: number;
  quantizedProfitPct?: number;
  continuousProfitPct?: number;
  integerSimulation?: number[];
}
```

### 2.4 Health & Status Types

```typescript
interface FlipperHealthResponse {
  status: "ok" | "degraded" | "error" | "offline";
  provider: "reachable" | "unreachable";
  timestamp: string;
  league?: string;
  baseCurrency?: string;
  activeEvents?: number;
  cacheEntries?: number;
  snapshot?: {
    snapshotValid: boolean;
    snapshotStale: boolean;
    snapshotAgeSeconds: number | null;
    snapshotTtlSeconds: number;
    exchangeRatesCount: number;
    currenciesCount: number;
    priceHistoriesCount: number;
    fetchedAt: string | null;
  };
  dailyStatsCache?: {
    size: number;
    max: number;
    staleEntries: number;
    ttlSeconds: number;
  };
}
```

### 2.5 Other Key Types

```typescript
interface FlipperPhaseResponse {
  phase: string;               // "EARLY" | "MID" | "LATE"
  daysSinceReference: number;
  daysSinceRef?: number;       // @deprecated
  league: string;
  dataAvailable?: boolean;
}

interface StorageValueResponse {
  currency: string;
  currentPrice: number;
  projectedPrice: number;
  riskDiscount: number;
  adjustedPrice: number;
  netValueAfterFees: number;
  ratio: number;
  decision: string;            // "HOLD" | "SELL"
  dataAvailable: boolean;
  inputs?: StorageValueInputs;
}

interface CurrencyTier {
  apiId: string;
  tier: number;                // 0-5 (T0=Ultra, T5=Micro)
  tierLabel: string;
  relativePrice: number;
  tierAnchor: string;
}

interface AnalystSummaryResponse {
  league: string;
  summary: {
    totalCurrencies: number;
    totalPairs: number;
    trendingUp: number;
    trendingDown: number;
    stable: number;
    anomalyCount: number;
  };
  trends: CurrencyTrend[];
  anomalies: PriceAnomaly[];
  facts: LeagueFact[];
  dataAvailable: boolean;
  fetchedAt: string;
}

interface OptimizerPathResponse {
  fromCurrency: string;
  toCurrency: string;
  amount: number;
  path: string[];
  stepRates: number[];
  effectiveRate: number;
  outputAmount: number;
  directRate: number | null;
  directOutputAmount: number | null;
  pathAdvantagePct: number | null;
  hops: number;
  dataAvailable: boolean;
  fetchedAt: string;
}
```

### 2.6 Error Types

```typescript
type FlipperErrorType =
  | "backend_offline"           // Connection refused (process not running)
  | "backend_timeout"           // Request timed out
  | "backend_connection_reset"  // ECONNRESET
  | "backend_insufficient_data" // Running but lacks enough data
  | "insufficient_data"         // Generic insufficient data
  | "server_error"              // 5xx from backend
  | "upstream_error";           // 502 Bad Gateway

class FlipperApiError extends Error {
  readonly status: number;
  readonly errorType: FlipperErrorType | undefined;
  readonly detail: string | undefined;
  readonly hint: string | undefined;
}
```

## 3. Backend Pydantic Models (schemas.py)

Key models with PascalCase serialization:

| Model | Key Fields | Used By |
|-------|-----------|---------|
| `PriceLogEntry` | `price`, `time`, `quantity` | Currency/Unique price history |
| `CurrencyItem` | `apiId`, `text`, `iconUrl`, `categoryApiId` | Currency metadata |
| `CurrencyItemExtended` | + `priceLogs`, `currentPrice`, `currentQuantity` | Currency with prices |
| `UniqueItem` | `name`, `text`, `categoryApiId`, `isChanceable` | Unique items |
| `SnapshotPair` | `currencyOne`, `currencyTwo`, `currencyOneData`, `currencyTwoData` | Exchange pairs |
| `PairDataDetails` | `valueTraded`, `relativePrice`, `stockValue`, `volumeTraded` | Per-currency pair data |
| `RealmOption` | `value`, `label`, `defaultLeagueValue` | Realm selectors |
| `LeagueInfo` | `value`, `shortName`, `isCurrent`, `defaultCurrency` | League selectors |
| `DailyStatsPoint` | `time`, `open`, `high`, `low`, `close`, `volume` | OHLCV data |

## 4. API Endpoint Contracts

### 4.1 Frontend Proxy → POE2Scout (`/api/poe2/*`)

| Endpoint | POE2Scout Path | Response Type | Case Transform |
|----------|---------------|---------------|----------------|
| `/api/poe2/realms` | `/Realms` | `RealmOption[]` | snake_case (kept as-is) |
| `/api/poe2/leagues` | `/Leagues` | `LeagueInfo[]` | PascalCase→camelCase |
| `/api/poe2/currencies` | `/Currencies/{cat}?page=N` | `PaginatedResponse<PoeItem>` | PascalCase→camelCase |
| `/api/poe2/items` | `/Items/{cat}?page=N` | `PaginatedResponse<PoeItem>` | PascalCase→camelCase |
| `/api/poe2/exchange` | `/SnapshotPairs` | `ExchangeSnapshot` | PascalCase→camelCase |
| `/api/poe2/overview` | `/SnapshotHistory` | `SnapshotHistoryPoint[]` | PascalCase→camelCase |
| `/api/poe2/uniques` | `/UniqueItems/{cat}?page=N` | `PaginatedResponse<PoeItem>` | PascalCase→camelCase |
| `/api/poe2/health` | Connectivity check | `{ reachable: boolean }` | — |

### 4.2 Frontend Proxy → FastAPI (`/api/flipper/*`)

| Endpoint | Backend Route | Response Type | Transform |
|----------|--------------|---------------|-----------|
| `/api/flipper/health` | `GET /api/health` | `FlipperHealthResponse` | snake→camel |
| `/api/flipper/phase` | `GET /api/phase` | `FlipperPhaseResponse` | snake→camel |
| `/api/flipper/currencies` | `GET /api/currencies` | `CurrencyItem[]` | snake→camel |
| `/api/flipper/prices` | `GET /api/prices` | `{ rates, currencies, ... }` | snake→camel |
| `/api/flipper/heatmap` | `GET /api/prices/heatmap` | `HeatmapData` | snake→camel |
| `/api/flipper/flips` | `GET /api/arbitrage/flips` | `FlipsResponse` | snake→camel |
| `/api/flipper/triangular` | `GET /api/arbitrage/triangular` | `TriangularResponse` | snake→camel |
| `/api/flipper/events` | `GET/POST /api/events` | `Event[]` | snake→camel |
| `/api/flipper/events/[id]` | `GET/DELETE /api/events/{id}` | `Event` | snake→camel |
| `/api/flipper/events/[id]/deactivate` | `POST /api/events/{id}/deactivate` | `Event` | snake→camel |
| `/api/flipper/anomalies` | `GET /api/anomalies` | `AnomalyResponse` | snake→camel |
| `/api/flipper/storage-value/[c]` | `GET /api/storage-value/{c}` | `StorageValueResponse` | snake→camel |
| `/api/flipper/tiers` | `GET /api/prices/tiers` | `TiersResponse` | snake→camel |
| `/api/flipper/benchmarks/[c]` | `GET /api/prices/benchmarks/{c}` | `BenchmarksResponse` | snake→camel |
| `/api/flipper/optimizer/path` | `GET /api/optimizer/path` | `OptimizerPathResponse` | snake→camel |
| `/api/flipper/optimizer/matrix` | `GET /api/optimizer/matrix` | `OptimizerMatrixResponse` | snake→camel |
| `/api/flipper/analyst/summary` | `GET /api/analyst/summary` | `AnalystSummaryResponse` | snake→camel |
| `/api/flipper/portfolio/correlation` | `GET /api/portfolio/correlation` | `CorrelationResponse` | snake→camel |

## 5. DataSnapshot Dataclass (Backend)

The central data structure in the FastAPI backend, built by `SnapshotManager`:

```python
@dataclass
class DataSnapshot:
    league: str
    fetched_at: datetime
    rates: dict[str, SnapshotPair]      # key: "currency1/currency2"
    currencies: list[CurrencyItem]
    price_histories: dict[str, list[PriceLogEntry]]  # key: api_id
    bfs_pricing: dict[str, float]       # transitive mid_price via BFS
    snapshot_age_seconds: float
```

**BFS transitive pricing:** When no direct pair exists between currency A and the base currency (exalted), the mid_price is computed via breadth-first search through existing pairs. This ensures every currency has a price relative to the base, even without a direct market.

## 6. POE2Scout API Response Shapes (Reference)

These are the raw API shapes BEFORE PascalCase→camelCase transformation:

### /Realms (snake_case — NOT transformed)
```json
{
  "data": [
    {
      "value": "poe2/pc",
      "label": "PoE2 PC",
      "game_api_id": "poe2",
      "realm_api_id": "poe2",
      "trade_api_path": "poe2",
      "default_league_value": "runes"
    }
  ]
}
```

### /Leagues (PascalCase — transformed)
```json
{
  "data": [
    {
      "Value": "Runes of Aldur",
      "ShortName": "runes",
      "IsCurrent": true,
      "BaseCurrencyApiId": "exalted",
      "BaseCurrencyText": "Exalted Orb",
      "DefaultCurrency": { "ApiId": "exalted", "Text": "Exalted Orb", "RelativePrice": 1.0 }
    }
  ]
}
```

### /SnapshotPairs (PascalCase — transformed)
```json
{
  "Data": [
    {
      "CurrencyExchangeSnapshotPairId": 123,
      "CurrencyOne": { "ApiId": "exalted", "Text": "Exalted Orb" },
      "CurrencyTwo": { "ApiId": "chaos", "Text": "Chaos Orb" },
      "CurrencyOneData": { "ValueTraded": "100.5", "RelativePrice": "1.0", "VolumeTraded": 500 },
      "CurrencyTwoData": { "ValueTraded": "50.2", "RelativePrice": "0.05", "VolumeTraded": 300 }
    }
  ]
}
```

**Key note:** Decimal values come as strings in POE2Scout responses (e.g., `"RelativePrice": "0.05"`). The `poe2api.ts` transformer converts these to numbers.
