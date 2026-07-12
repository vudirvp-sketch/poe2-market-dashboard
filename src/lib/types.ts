// ============================================================================
// PoE2 Market Dashboard — Shared Types (Single Source of Truth)
//
// ALL type definitions live here. poe2api.ts imports from this file.
// No duplicate type definitions across the codebase.
// ============================================================================

export interface Realm {
  name: string;
  displayName: string;
  /** The default/current league name for this realm (from API) */
  defaultLeague?: string;
}

export interface League {
  name: string;
  displayName: string;
  startAt: string | null;
  endAt: string | null;
  active: boolean;
  /** Base currency API ID for this league (e.g. "exalted") */
  baseCurrencyApiId?: string;
  /** Base currency display name */
  baseCurrencyText?: string;
  /** Default reference currency for this league */
  defaultCurrency?: {
    apiId: string;
    text: string;
    iconUrl: string | null;
    relativePrice: number;
  };
}

export interface PoeItem {
  id: string;
  apiId: string;
  name: string;
  /** Russian name for unique items (looked up from poe2db slug via
   *  UNIQUE_NAMES_RU in src/lib/currency-names.ts). Null for currencies
   *  (currencies use getCurrencyDisplayName(apiId, locale) at render time
   *  instead). Added iter 147 (TD-6 phase 2). */
  nameRu?: string | null;
  type: string;
  category: string;
  iconUrl: string | null;
  price: number | null;
  /** Chaos-equivalent rate for 1 unit of this currency.
   *  This is POE2Scout's modeled estimate of what 1 unit is worth in Chaos —
   *  it is a RATE (ratio), not a direct tradeable price. */
  chaosEquivalentRate: number | null;
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

export interface PoeItemHistoryPoint {
  timestamp: string;
  price: number;
  /** Chaos-equivalent rate at this point in time. */
  chaosEquivalentRate: number;
  relativePrice: number;
  volume: number;
}

export interface DailyStat {
  day: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ExchangePair {
  id: string;
  currency1Id: string;
  currency1Name: string;
  currency1IconUrl: string | null;
  /** Numeric ItemId — required for the CurrencyPairHistory API endpoint */
  currency1ItemId: number;
  /** POE2Scout category of currency1 (e.g. "currency", "ritual", "ultimatum").
   *  Used to distinguish pure currencies from craft items (Omens, Soul Cores). */
  currency1CategoryApiId: string;
  currency2Id: string;
  currency2Name: string;
  currency2IconUrl: string | null;
  /** Numeric ItemId — required for the CurrencyPairHistory API endpoint */
  currency2ItemId: number;
  /** POE2Scout category of currency2 (e.g. "currency", "ritual", "ultimatum").
   *  Used to distinguish pure currencies from craft items (Omens, Soul Cores). */
  currency2CategoryApiId: string;
  /** Fix 2.4: price is now number | null to distinguish "free" from "data error" */
  price: number | null;
  /** Relative price of currency1 in base currency. null when no trade data ("0E-8"). */
  relativePrice: number | null;
  /** Relative price of currency2 in base currency. null when no trade data ("0E-8").
   *  Required for computing correct cross-rates: crossRate(c1→c2) = relativePrice / currency2RelativePrice. */
  currency2RelativePrice: number | null;
  volume: number;
  change: number | null;
  changePercent: number | null;
  /** Absolute price change over 7 days (null when no data) */
  sevenDayChange: number | null;
  /** Percent price change over 7 days (null when no data) */
  sevenDayChangePercent: number | null;
  history: ExchangePairHistoryPoint[] | null;
}

export interface ExchangePairHistoryPoint {
  timestamp: string;
  relativePrice: number;
  volume: number;
}

export interface ItemCategory {
  name: string;
  displayName: string;
  count: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
}

export interface ReferenceCurrency {
  apiId: string;
  text: string;
  iconUrl: string | null;
  relativePrice: number;
}

export interface SnapshotHistoryPoint {
  timestamp: string;
  totalVolume: number;
  totalMarketCap: number;
  itemCount: number;
}

// ============================================================================
// Flipper backend shared types (used across dashboard-page, tabs, sidebar)
// ============================================================================

/** Scored flip opportunity from GET /api/flipper/flips
 *
 *  ⚠️ DEFENSIVE NULLABILITY: The backend may omit numeric fields (return
 *  undefined) when data is insufficient (e.g. early league, no volume).
 *  UI code MUST use `?? 0` or `?.` when accessing these fields to avoid
 *  runtime TypeError on `.toLocaleString()`, `.toFixed()`, etc.
 */
export interface FlipOpportunity {
  currency: string;
  /** Russian name for currency_from (from backend currency_names_ru mapping) */
  currencyFromRu?: string | null;
  /** English name for currency_from */
  currencyFromEn?: string | null;
  /** Russian name for currency_to */
  currencyToRu?: string | null;
  /** English name for currency_to */
  currencyToEn?: string | null;
  score: number;
  /** Raw spread (ask - bid) / mid_price — no fees deducted.
   *  May be undefined when backend has insufficient data. */
  spread?: number;
  /** @deprecated Use spread instead. Kept for backward compat. */
  spreadAfterFees?: number;
  /** 24h trading volume. May be undefined when backend has insufficient data. */
  volume24h?: number;
  /** Price momentum. May be undefined when backend has insufficient data. */
  momentum?: number;
  /** Volatility measure. May be undefined when backend has insufficient data. */
  volatility?: number;
  cluster: string;
  bid?: number;
  ask?: number;
  midPrice?: number;
  /** P1-1: Quantized analysis (integer-aware spread) */
  quantizedAnalysis?: QuantizedAnalysis;
  /** P1-3: Tier distance between the two currencies */
  tierDistance?: number;
  /** Absolute profit per 1 unit of currency_from in base currency (exalted). */
  profitPerUnitBase?: number;
  /** Fair cross-rate: how many currency_to per 1 currency_from based on prices_in_base. */
  fairRate?: number;
  /** Deviation of market rate from fair rate as percentage. */
  deviationPct?: number;
  /** Price of currency_from in base currency (exalted). */
  priceFromInBase?: number;
  /** Price of currency_to in base currency (exalted). */
  priceToInBase?: number;
  /**
   * TD-9 (iter 127 + iter 135 fallback removal): up to 14 most-recent
   * (date, price) points for currency_from, oldest-first. Empty array when
   * no price history is available (frontend Sparkline renders an em-dash
   * placeholder — no synthetic fallback since iter 135).
   */
  priceHistoryShort?: SpeculationPriceHistoryPoint[];
}

/** P1-1: Quantized spread result at a specific lot size */
export interface QuantizedSpread {
  lotSize: number;
  actualCost: number;
  actualRevenue: number;
  netProfit: number;
  grossProfitPct: number;
  qSpread: number;
}

/** P1-1: Complete quantized analysis for a currency pair */
export interface QuantizedAnalysis {
  qSpreads: Record<string, QuantizedSpread>;
  minProfitableLot: number;
  optimalLotProfitPct: number;
  recommendedRatio: [number, number];
  brickResistance: number;
  theoreticalSpread: number;
}

/** Event status embedded in FlipsResponse */
export interface FlipEventStatus {
  anyActive: boolean;
  affectedCurrencies: string[];
  summary: Record<string, unknown> | null;
}

/** Response shape from GET /api/flipper/flips */
export interface FlipsResponse {
  league: string;
  total: number;
  opportunities: FlipOpportunity[];
  eventStatus: FlipEventStatus;
  fetchedAt: string;
  /** true when backend has not accumulated enough data yet */
  dataAvailable?: boolean;
}

/** Triangular arbitrage cycle from GET /api/flipper/triangular
 *  ⚠️ DEFENSIVE NULLABILITY: totalVolume may be undefined when backend
 *  has insufficient data. UI code MUST use `?? 0` before calling methods. */
export interface TriangularCycle {
  cycle: string[];
  netProfitPct: number;
  stepRates: number[];
  /** Total volume across all edges. May be undefined when backend has insufficient data. */
  totalVolume?: number;
  confidence: number;
  /** P1-2: Minimum starting capital for integer-profitable cycle */
  minStartingAmount?: number;
  /** P1-2: Profit validated via integer simulation */
  quantizedProfitPct?: number;
  /** P1-2: Original float profit (for reference) */
  continuousProfitPct?: number;
  /** P1-2: Amounts at each step for min_start */
  integerSimulation?: number[];
}

/** Response shape from GET /api/flipper/triangular */
export interface CrossRateWarning {
  suspiciousTriplesCount: number;
  affectedCurrencies: string[];
  message: string;
}

export interface TriangularResponse {
  league: string;
  total: number;
  opportunities: TriangularCycle[];
  fetchedAt: string;
  /** true when backend has not accumulated enough data yet */
  dataAvailable?: boolean;
  /** Warning about cross-rate inconsistencies causing false positives */
  crossRateWarning?: CrossRateWarning | null;
}

// ============================================================================
// Triangular arbitrage history (TD-3 Phase 3, iter 129)
// ============================================================================

/** A single persisted triangular-cycle row from GET /api/flipper/triangular/history.
 *
 *  Mirrors the backend pydantic model `TriangularCyclePoint` in
 *  `backend/api/response_models.py`. Numeric fields are `number | null`
 *  because the integer simulation may not find a profitable start
 *  (`executable_estimate = 0`, `executable_profit = 0`). */
export interface TriangularCycleHistoryPoint {
  /** ISO 8601 UTC timestamp aligned to the snapshot refresh (5-min bucket). */
  timestamp: string;
  /** Sorted-unique currencies joined with '->'. Example: 'divine->exalted->mirror'.
   *  Collapses rotations to one key (A->B->C->A and A->C->B->A share the same key). */
  cycleKey: string;
  /** JSON array of the cycle traversal order (closing node stripped).
   *  Example: '["exalted","divine","mirror"]'. Lets a future analyst recover
   *  the exact rotation. */
  cycleCurrencies: string;
  /** Bellman-Ford continuous profit %, BEFORE integer quantization.
   *  Matches TriangularCycle.continuousProfitPct. May be null for legacy rows. */
  rawProfitPct: number | null;
  /** Min profitable starting amount from binary search. 0 when no profitable
   *  integer amount found. May be null for legacy rows. */
  executableEstimate: number | null;
  /** Final amount after integer simulation. Profit = executableProfit - executableEstimate.
   *  May be null for legacy rows. */
  executableProfit: number | null;
  /** _compute_confidence() score (0..1), based on data freshness + volume + cycle length.
   *  May be null for legacy rows. */
  confidence: number | null;
  /** Seconds between snapshot.fetched_at and the persistence write. For staleness filtering.
   *  May be null for legacy rows. */
  snapshotAgeSec: number | null;
}

/** Response shape from GET /api/flipper/triangular/history.
 *
 *  Empty `points` list + `dataAvailable=false` when no rows match the lookback
 *  window (e.g. the feature just shipped and the first snapshot hasn't
 *  persisted yet, or no profitable cycles were detected in the window). */
export interface TriangularCyclesHistoryResponse {
  league: string;
  /** Cycle_key filter applied to the query (e.g. 'divine->exalted->mirror').
   *  Null when no filter was applied. */
  cycleKey: string | null;
  /** Lookback window in days used for the query. */
  days: number;
  /** Persisted cycle rows, oldest-first. Empty when no rows match. */
  points: TriangularCycleHistoryPoint[];
  /** Distinct cycle_keys that have at least one persisted row in this league
   *  (alphabetical). Useful for the UI to populate a cycle picker. Empty when
   *  no rows exist. */
  availableCycleKeys: string[];
  /** Whether at least one row matched the query. */
  dataAvailable: boolean;
  /** ISO 8601 timestamp of data fetch. */
  fetchedAt: string;
}

/** Response shape from GET /api/flipper/health */
export interface FlipperHealthResponse {
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

/** Response shape from GET /api/flipper/phase */
export interface FlipperPhaseResponse {
  phase: string;
  /** days_since_reference from backend — transformed by proxyWithFallback (snake_case → camelCase) */
  daysSinceReference: number;
  /** @deprecated Use daysSinceReference instead — kept for backward compat in old code */
  daysSinceRef?: number;
  league: string;
  dataAvailable?: boolean;
}

/** Summary shape from GET /api/flipper/events?active_only=true (count only) */
export interface FlipperEventsSummary {
  events: { eventId: string }[];
  total: number;
}

/** Storage value inputs from GET /api/flipper/storage-value/[currency] */
export interface StorageValueInputs {
  momentum: number;
  volatility: number;
  acceleration: number;
  liquidityScore: number;
  horizonHours: number;
  significanceLevel: number;
}

/** Storage value response from GET /api/flipper/storage-value/[currency] */
export interface StorageValueResponse {
  currency: string;
  currentPrice: number;
  projectedPrice: number;
  riskDiscount: number;
  adjustedPrice: number;
  /** Adjusted price after risk discount and liquidity (gold fees disabled, equals adjustedPrice) */
  netValue: number;
  ratio: number;
  decision: string;
  dataAvailable: boolean;
  /** Total current value for the requested quantity (iter 74 — added by backend in routes_storage_value.py). */
  totalCurrentValue?: number;
  /** Total projected value (projectedPrice × quantity). */
  totalProjectedValue?: number;
  /** Total net value (netValue × quantity). */
  totalNetValue?: number;
  inputs?: StorageValueInputs;
}

/** A single point in the storage-value history time-series (iter 75, F2 follow-up). */
export interface StorageValueHistoryPoint {
  /** ISO 8601 timestamp of the price observation. */
  timestamp: string;
  /** Price of the currency at this timestamp (in base currency). */
  price: number;
  /** Nearest mirror price within 24h tolerance. Null when no mirror trade near this time. */
  mirrorPrice: number | null;
  /** Nearest Hinekora's Lock price within 24h tolerance. Null when no hinekora trade near this time. */
  hinekoraPrice: number | null;
  /** price / mirrorPrice. Null when mirrorPrice is null or zero. */
  ratioMirror: number | null;
  /** price / hinekoraPrice. Null when hinekoraPrice is null or zero. */
  ratioHinekora: number | null;
}

/** Storage value history response from GET /api/flipper/storage-value/[currency]/history (iter 75). */
export interface StorageValueHistoryResponse {
  currency: string;
  mirrorCurrency: string;
  hinekoraCurrency: string;
  /** Time-series of price + ratio_mirror + ratio_hinekora, sorted ascending by timestamp. */
  points: StorageValueHistoryPoint[];
  dataAvailable: boolean;
  fetchedAt: string;
}

// ============================================================================
// Content Pulse (F3 backend / F4 widget, iter 75 + iter 76)
// ============================================================================

/** A single rising/falling item within a content-pulse category.
 *  Backend (Pydantic) shape: ContentPulseMoverData. */
export interface ContentPulseMover {
  /** Item API identifier (e.g. "circle-coin", "breachstone"). */
  apiId: string;
  /** Display name (EN) — backend returns `text` field, proxy camelCases to `apiId`/`text`.
   *  We keep `text` here to match the backend field name. */
  text: string;
  /** Price % change over the available price_logs window. */
  trendPct: number;
  /** Current price in base currency. */
  currentPrice: number;
}

/** Per-category turnover snapshot + rolling deltas + top movers + overheat index.
 *  Backend (Pydantic) shape: ContentPulseCategoryData. */
export interface ContentPulseCategory {
  /** League mechanic category (e.g. "ritual", "breach"). */
  category: string;
  /** Sum of 24h volume_traded across all items in the category
   *  (iter 95 TD-2 fix: was current_quantity / listings count). */
  todayVolume: number;
  /** Mean daily volume over the last 7 days. */
  rolling7d: number;
  /** Mean daily volume over the last 30 days. */
  rolling30d: number;
  /** (today / rolling_7d - 1) * 100. Null when no historical data. */
  delta7dPct: number | null;
  /** (today / rolling_30d - 1) * 100. Null when no historical data. */
  delta30dPct: number | null;
  /** "rising" | "falling" | "stable" (based on delta_7d_pct ±10%). */
  signal: "rising" | "falling" | "stable";
  /** Number of items in this category. */
  itemCount: number;
  /** Top-3 items with positive % price change. */
  topRising: ContentPulseMover[];
  /** Top-3 items with negative % price change. */
  topFalling: ContentPulseMover[];
  /** iter 95 (Q13): 0-100 composite overheat score. Higher = more overheated.
   *  0 when insufficient data. */
  overheatIndex: number;
  /** iter 95 (Q13): "hot" (volume spiking AND prices dropping) | "warm" (only one) | "cool". */
  overheatSignal: "hot" | "warm" | "cool";
  /** iter 95 (Q13): today_volume / rolling_7d. Null when rolling_7d is 0 or today_volume is 0. */
  volumeSpikeRatio: number | null;
  /** iter 95 (Q13): mean per-item % price change over price_logs.
   *  Null when no items have ≥2 price points. */
  priceChangePct: number | null;
}

/** Response for GET /api/flipper/content-pulse (F3/F4, iter 75 + iter 76). */
export interface ContentPulseResponse {
  league: string;
  /** Per-category pulse data, sorted by |delta_7d_pct| desc. */
  categories: ContentPulseCategory[];
  /** Whether any category had items in the snapshot. */
  dataAvailable: boolean;
  /** ISO 8601 timestamp of data fetch. */
  fetchedAt: string;
}

// ============================================================================
// Speculation (F5, iter 77)
// ============================================================================

/** A single (date, price) point in the mini-sparkline rendered per signal.
 *  Backend (Pydantic) shape: SpeculationPriceHistoryPoint. */
export interface SpeculationPriceHistoryPoint {
  /** ISO 8601 timestamp of the price observation. */
  date: string;
  /** Price in base currency at this timestamp. */
  price: number;
}

/** Signal type — BUY (z < -1.5), SELL (z > +1.5), HOLD (|z| ≤ 1.5). */
export type SpeculationSignalType = "BUY" | "SELL" | "HOLD";

/** Horizon hint — expected mean-reversion window.
 *  Mapped to localized strings in the frontend. */
export type SpeculationHorizonHint = "short" | "medium" | "long" | "unknown";

/** A single BUY/SELL/HOLD signal for one currency.
 *  Backend (Pydantic) shape: SpeculationSignalData. */
export interface SpeculationSignal {
  /** Item API identifier (e.g. "circle-coin", "breachstone"). */
  apiId: string;
  /** Display name (EN) — backend returns `text` field, proxy camelCases. */
  text: string;
  /** League mechanic category (e.g. "ritual", "breach"). Empty if unknown. */
  category: string;
  /** Current price in base currency. */
  currentPrice: number;
  /** Mean of historical prices in the lookback window. */
  mean: number;
  /** Population std-dev of historical prices in the lookback window. */
  std: number;
  /** Z-score of currentPrice relative to the historical distribution. */
  zScore: number;
  /** Percentile (0..100) of currentPrice within the historical range. Null when not computable. */
  percentile: number | null;
  /** "BUY" | "SELL" | "HOLD". */
  signal: SpeculationSignalType;
  /** Expected mean-reversion horizon code (mapped to localized string in UI). */
  horizonHint: SpeculationHorizonHint;
  /** Number of valid price points used for stats. */
  sampleSize: number;
  /** Up to 14 most-recent price points (oldest-first) for a mini-sparkline. */
  priceHistoryShort: SpeculationPriceHistoryPoint[];
}

/** Response for GET /api/flipper/speculation (F5, iter 77). */
export interface SpeculationResponse {
  league: string;
  /** Per-item signals, sorted by |zScore| desc. */
  signals: SpeculationSignal[];
  /** Whether any item had enough price history to compute a signal. */
  dataAvailable: boolean;
  /** ISO 8601 timestamp of data fetch. */
  fetchedAt: string;
  /** Lookback window in days used for the z-score / percentile baseline. */
  days: number;
}

// ============================================================================
// Circuit Patterns (F7 / P8, iter 97 — frontend UI)
// Pure function: backend/economy/circuit_patterns.py (iter 96, 75 tests).
// ============================================================================

/** Trajectory archetype — see docs/MARKET_PLAYBOOK.md §P8 for the rationale. */
export type CircuitTrajectory =
  | "EXPONENTIAL_GROWTH"
  | "LINEAR_GROWTH"
  | "PEAK_THEN_DECLINE"
  | "MEAN_REVERTING"
  | "VOLATILE"
  | "DECLINING"
  | "STABLE";

/** Recommended action — derived from the trajectory archetype. */
export type CircuitRecommendedAction =
  | "HOLD_FOR_GROWTH"
  | "SELL_NOW"
  | "AVOID"
  | "WATCH"
  | "NEUTRAL";

/** A single currency's trajectory classification + recommended action.
 *  Backend (Pydantic) shape: CircuitPatternData.
 *  Field names are camelCase after flipper-proxy transformKeys(). */
export interface CircuitPattern {
  /** Item API identifier (e.g. "chaos-orb", "exalted"). */
  apiId: string;
  /** Display name (EN) — backend returns `text` field, proxy camelCases. */
  text: string;
  /** League mechanic category slug (e.g. "ritual", "breach"). Empty if unknown. */
  category: string;
  /** Trajectory archetype — one of CircuitTrajectory. */
  trajectory: CircuitTrajectory;
  /** % change from first to last price in the lookback window. */
  totalChangePct: number;
  /** Slope × 100, normalised by mean price — percent-per-day change. */
  recentSlopePctPerDay: number;
  /** Coefficient of variation (std / mean) over the window. */
  volatilityCv: number;
  /** Goodness-of-fit of the linear regression (0..1). 0 = no linear trend. */
  rSquared: number;
  /** For PEAK_THEN_DECLINE: days between the highest-price point and the
   *  last point. Null for other archetypes. 0 means the peak IS the last point. */
  daysSincePeak: number | null;
  /** Actionable recommendation derived from the trajectory. */
  recommendedAction: CircuitRecommendedAction;
  /** Number of valid price points in the lookback window. */
  sampleSize: number;
  /** Most recent price in base currency. */
  currentPrice: number;
  /** Up to 14 most-recent price points (oldest-first) for the mini-sparkline.
   *  Empty when fewer than 2 points are in the window. */
  priceHistoryShort: SpeculationPriceHistoryPoint[];
}

/** Response for GET /api/flipper/circuit-patterns (F7, iter 97). */
export interface CircuitPatternsResponse {
  league: string;
  /** Per-currency classifications, sorted by |totalChangePct| desc. */
  patterns: CircuitPattern[];
  /** Whether any currency had enough price_logs (≥ MIN_SAMPLE_SIZE) to classify. */
  dataAvailable: boolean;
  /** ISO 8601 timestamp of data fetch. */
  fetchedAt: string;
  /** Lookback window in days used for the classification. */
  days: number;
}

// ============================================================================
// Intraday Patterns (P4, iter 98 — frontend UI)
// Pure function: backend/economy/intraday_patterns.py
// ============================================================================

/** Per-hour aggregation for a single currency (UTC hour 0..23).
 *  Backend (Pydantic) shape: IntradayHourlyStat.
 *  Field names are camelCase after flipper-proxy transformKeys(). */
export interface IntradayHourlyStat {
  /** UTC hour of day (0..23). */
  hour: number;
  /** Mean price for this hour over the lookback window. Null when count=0. */
  mean: number | null;
  /** Population std of prices for this hour. Null when count=0. */
  std: number | null;
  /** Number of price_logs in this hour (0 when no data). */
  count: number;
}

/** A single currency's time-of-day (UTC hour) price pattern.
 *  Backend (Pydantic) shape: IntradayPatternData. */
export interface IntradayPattern {
  /** Item API identifier (e.g. "chaos-orb", "exalted"). */
  apiId: string;
  /** Display name (EN) — backend returns `text` field, proxy camelCases. */
  text: string;
  /** League mechanic category slug (e.g. "ritual", "breach"). Empty if unknown. */
  category: string;
  /** Always 24 entries (one per UTC hour 0..23, ascending). Hours with no
   *  data have mean=null, std=null, count=0. */
  hourlyStats: IntradayHourlyStat[];
  /** UTC hour with the LOWEST mean price (best hour to BUY). Null when no data. */
  buyWindowHour: number | null;
  /** UTC hour with the HIGHEST mean price (best hour to SELL). Null when no data. */
  sellWindowHour: number | null;
  /** Mean price at the buy window hour. Null when buyWindowHour is null. */
  buyWindowMean: number | null;
  /** Mean price at the sell window hour. Null when sellWindowHour is null. */
  sellWindowMean: number | null;
  /** Mean of ALL price points across all hours (NOT mean of hourly means). */
  overallMean: number;
  /** |sellWindowMean - buyWindowMean| / overallMean * 100. 0 = no variation. */
  intradayRangePct: number;
  /** True when intradayRangePct >= 10% (SIGNIFICANT_RANGE_PCT). */
  hasSignificantPattern: boolean;
  /** Total number of price_logs in the lookback window (across all 24 hours). */
  sampleSize: number;
  /** Most recent price in base currency. */
  currentPrice: number;
}

/** Response for GET /api/flipper/intraday-patterns (P4, iter 98). */
export interface IntradayPatternsResponse {
  league: string;
  /** Per-currency intraday patterns, sorted by intradayRangePct desc. */
  patterns: IntradayPattern[];
  /** Whether any currency had enough price_logs (≥ MIN_SAMPLE_SIZE AND
   *  ≥ MIN_HOURS_COVERED distinct hours) to aggregate. */
  dataAvailable: boolean;
  /** ISO 8601 timestamp of data fetch. */
  fetchedAt: string;
  /** Lookback window in days used for the aggregation. */
  days: number;
}

// ============================================================================
// Weekly Patterns (P5, iter 99 — frontend UI)
// Pure function: backend/economy/weekly_patterns.py
// ============================================================================

/** Per-weekday aggregation for a single currency (ISO weekday 1=Mon..7=Sun).
 *  Backend (Pydantic) shape: WeeklyDailyStat.
 *  Field names are camelCase after flipper-proxy transformKeys(). */
export interface WeeklyDailyStat {
  /** ISO weekday (1=Mon, 2=Tue, ..., 7=Sun). */
  weekday: number;
  /** Mean price for this weekday over the lookback window. Null when count=0. */
  mean: number | null;
  /** Population std of prices for this weekday. Null when count=0. */
  std: number | null;
  /** Number of price_logs on this weekday (0 when no data). */
  count: number;
}

/** A single currency's weekday (Mon-Sun) price pattern.
 *  Backend (Pydantic) shape: WeeklyPatternData. */
export interface WeeklyPattern {
  /** Item API identifier (e.g. "chaos-orb", "exalted"). */
  apiId: string;
  /** Display name (EN) — backend returns `text` field, proxy camelCases. */
  text: string;
  /** League mechanic category slug (e.g. "ritual", "breach"). Empty if unknown. */
  category: string;
  /** Always 7 entries (one per ISO weekday 1..7, Mon..Sun, ascending). Days
   *  with no data have mean=null, std=null, count=0. */
  dailyStats: WeeklyDailyStat[];
  /** ISO weekday with the LOWEST mean price (best day to BUY). Null when no data. */
  buyWindowDay: number | null;
  /** ISO weekday with the HIGHEST mean price (best day to SELL). Null when no data. */
  sellWindowDay: number | null;
  /** Mean price at the buy window day. Null when buyWindowDay is null. */
  buyWindowMean: number | null;
  /** Mean price at the sell window day. Null when sellWindowDay is null. */
  sellWindowMean: number | null;
  /** Mean of ALL price points across all weekdays (NOT mean of daily means). */
  overallMean: number;
  /** |sellWindowMean - buyWindowMean| / overallMean * 100. 0 = no variation. */
  weeklyRangePct: number;
  /** Signed % difference: (weekend_mean - weekday_mean) / overall_mean * 100.
   *  Positive = weekends are MORE expensive (sell on weekend).
   *  Negative = weekdays are MORE expensive (sell on weekday).
   *  0 = no difference or insufficient data on one side. */
  weekdayDeltaPct: number;
  /** True when weeklyRangePct >= 10% (SIGNIFICANT_RANGE_PCT). */
  hasSignificantPattern: boolean;
  /** Total number of price_logs in the lookback window (across all 7 weekdays). */
  sampleSize: number;
  /** Most recent price in base currency. */
  currentPrice: number;
}

/** Response for GET /api/flipper/weekly-patterns (P5, iter 99). */
export interface WeeklyPatternsResponse {
  league: string;
  /** Per-currency weekly patterns, sorted by weeklyRangePct desc. */
  patterns: WeeklyPattern[];
  /** Whether any currency had enough price_logs (≥ MIN_SAMPLE_SIZE AND
   *  ≥ MIN_DAYS_COVERED distinct weekdays) to aggregate. */
  dataAvailable: boolean;
  /** ISO 8601 timestamp of data fetch. */
  fetchedAt: string;
  /** Lookback window in weeks used for the aggregation. */
  weeks: number;
}

// ============================================================================
// Leveling Uniques Lifecycle (P3, iter 100 — frontend UI)
// Pure function: backend/economy/leveling_uniques.py
// ============================================================================

/** Lifecycle stage identifiers for a leveling unique.
 *  - PRE_PEAK:  days_since_reference < peak_day (prices rising toward peak)
 *  - AT_PEAK:   peak_day ≤ days ≤ peak_day + 1 (peak demand window)
 *  - POST_PEAK: days > peak_day + 1 (prices crashing)
 *
 *  Backend emits these as the `current_lifecycle_stage` field (string). */
export type LevelingUniqueStage = "PRE_PEAK" | "AT_PEAK" | "POST_PEAK";

/** User-facing recommendation identifiers.
 *  - BUY_OR_HOLD:   PRE_PEAK — prices still rising, OK to buy or hold existing
 *  - SELL_NOW:      AT_PEAK  — peak demand, list now for max return
 *  - AVOID_BUYING:  POST_PEAK — prices crashing, only buy for personal use
 *
 *  Backend emits these as the `recommendation` field (string). */
export type LevelingUniqueRecommendation =
  | "BUY_OR_HOLD"
  | "SELL_NOW"
  | "AVOID_BUYING";

/** A single leveling unique with its current lifecycle stage.
 *  Backend (Pydantic) shape: LevelingUniqueData.
 *  Field names are camelCase after flipper-proxy transformKeys(). */
export interface LevelingUnique {
  /** Stable slug (e.g. "polcirkeln-sapphire-ring") — for tests + future metric linkage. */
  id: string;
  /** Display name (EN, matches in-game name). */
  name: string;
  /** Optional POE2Scout category slug for future cross-reference. Empty string if priced as item. */
  category: string;
  /** League day on which the unique's price historically peaks (Day 1 = launch). Typically 2. */
  peakDay: number;
  /** Typical peak price in Exalted Orbs. */
  peakPriceExalted: number;
  /** Typical % decline from peak by Day 7+ (POST_PEAK_FLOOR_DAY). Range [0, 100]. */
  decayPct: number;
  /** Price pattern identifier. Always "SPIKE_THEN_CRASH" for iter 100. */
  pattern: string;
  /** Current lifecycle stage: PRE_PEAK | AT_PEAK | POST_PEAK. */
  currentLifecycleStage: LevelingUniqueStage;
  /** User-facing action: BUY_OR_HOLD | SELL_NOW | AVOID_BUYING. */
  recommendation: LevelingUniqueRecommendation;
  /** Heuristic estimated price in Exalted Orbs (NOT a live market price).
   *  Computed via piecewise-linear interpolation. The widget tooltip
   *  explicitly states this is a planning heuristic. */
  estimatedCurrentPriceExalted: number;
  /** Days until the unique hits its peak.
   *  Positive = days to wait. 0 = currently in AT_PEAK window.
   *  Negative = days since peak window ended (POST_PEAK). */
  daysUntilPeak: number;
  /** Short description of why this is a leveling unique. Localized via ?lang=. */
  notes: string;
}

/** Response for GET /api/flipper/leveling-uniques (P3, iter 100). */
export interface LevelingUniquesResponse {
  /** League name. */
  league: string;
  /** Current league phase: "early" | "mid" | "late" | "unknown". */
  phase: string;
  /** Days since league start or last major patch. */
  daysSinceReference: number;
  /** Alias for daysSinceReference — current league day. Same value, used for display. */
  currentDay: number;
  /** Reference currency for the phase (e.g. "exalted" for EARLY). Empty if unknown. */
  referenceCurrency: string;
  /** Static leveling-uniques table with per-item lifecycle stage + recommendation. */
  uniques: LevelingUnique[];
  /** Always true — the table is hardcoded and always available.
   *  False only on exception (PhaseDetector construction failure). */
  dataAvailable: boolean;
  /** ISO 8601 timestamp of data fetch. */
  fetchedAt: string;
}

// ============================================================================
// Speculation backtest (F5 follow-up, iter 80 — frontend UI)
// ============================================================================

/** A single realised trade from the backtest.
 *  Backend (Pydantic) shape: SpeculationBacktestTradeData.
 *  Field names are camelCase after flipper-proxy transformKeys(). */
export interface SpeculationBacktestTrade {
  /** Item API identifier. */
  apiId: string;
  /** Display name (EN). */
  text: string;
  /** League mechanic category (e.g. "ritual", "breach"). Empty if unknown. */
  category: string;
  /** Signal at entry: "BUY" (z<-1.5) | "SELL" (z>+1.5). HOLD signals never produce trades. */
  signal: SpeculationSignalType;
  /** Price at entry (nearest price log to t_eval within 24h tolerance). */
  entryPrice: number;
  /** ISO 8601 timestamp of the entry price log. */
  entryDate: string;
  /** Price at exit (nearest price log to t_eval+holding_days within 24h tolerance). */
  exitPrice: number;
  /** ISO 8601 timestamp of the exit price log. */
  exitDate: string;
  /** Realised return in %. BUY: (exit-entry)/entry*100. SELL: (entry-exit)/entry*100. Positive = profit. */
  returnPct: number;
  /** Z-score of entryPrice vs the lookback window. Null when std=0. */
  zScoreAtEntry: number | null;
  /** Number of price points in the lookback window used to compute the z-score. */
  sampleSizeAtEntry: number;
}

/** Aggregate stats for a single signal type (BUY / SELL / overall).
 *  Backend (Pydantic) shape: SpeculationBacktestStatsBlock. */
export interface SpeculationBacktestStatsBlock {
  /** Number of trades in this block. */
  count: number;
  /** Win rate in % (returns > 0). 0.0 when count=0. */
  winRate: number;
  /** Mean return_pct. 0.0 when count=0. */
  meanReturnPct: number;
  /** Median return_pct. 0.0 when count=0. */
  medianReturnPct: number;
  /** Max return_pct observed. 0.0 when count=0. */
  bestReturnPct: number;
  /** Min return_pct observed. 0.0 when count=0. */
  worstReturnPct: number;
}

/** Response for GET /api/flipper/speculation/backtest (F5 follow-up, iter 80).
 *  Backend (Pydantic) shape: SpeculationBacktestResponse. */
export interface SpeculationBacktestResponse {
  /** League name. */
  league: string;
  /** Per-item realised trades, sorted by |returnPct| desc. Capped by `limit`. */
  trades: SpeculationBacktestTrade[];
  /** Counts per signal type: { BUY: N, SELL: N, HOLD: N }. HOLD signals did not produce trades. */
  signalBreakdown: Record<"BUY" | "SELL" | "HOLD", number>;
  /** Items with both entry+exit prices AND an actionable signal (BUY or SELL). */
  evaluatedCount: number;
  /** Items with an actionable signal but no exit price within tolerance (holding period extends past last price log). */
  unevaluatedCount: number;
  /** Aggregate stats for BUY trades only. */
  buyStats: SpeculationBacktestStatsBlock;
  /** Aggregate stats for SELL trades only. */
  sellStats: SpeculationBacktestStatsBlock;
  /** Aggregate stats across all BUY+SELL trades. */
  overallStats: SpeculationBacktestStatsBlock;
  /** Whether any item in the snapshot had price_logs to backtest against. */
  dataAvailable: boolean;
  /** ISO 8601 timestamp of backtest run. */
  fetchedAt: string;
  /** Days before `now` at which the signal was evaluated (entry timestamp = now - eval_days_ago). */
  evalDaysAgo: number;
  /** Holding period in days (exit timestamp = entry + holding_days). */
  holdingDays: number;
  /** Z-score baseline window in days (window = [entry-lookback_days, entry)). */
  lookbackDays: number;
}

// ============================================================================
// Phase-aware Hints (F6, iter 78)
// ============================================================================

/** A single phase-aware hint — advisory context, NOT a trade signal.
 *  Backend (Pydantic) shape: PhaseHintData.
 *
 *  iter 110 (P9): optional live-price fields. When the backend has a
 *  DataSnapshot available, hints with a non-empty `trackedCurrency` are
 *  enriched with `currentPrice` / `changePctWeek` / `changePctMonth` /
 *  `momentum` / `recommendation`. When no snapshot is available (or the
 *  hint is untracked), these fields are null. */
export interface PhaseHint {
  /** Stable slug (e.g. "mid-skill-gems-18-20") — for tests + future metric linkage. */
  id: string;
  /** Short label for the hint. */
  title: string;
  /** One-sentence explanation of the pattern. */
  detail: string;
  /** What the user should do (imperative). */
  action: string;
  /** Optional POE2Scout category slug for future cross-reference. Empty string if none. */
  category: string;
  /** iter 110: api_id of the currency this hint tracks for live-price binding (e.g. "exalted"). Empty string = untracked hint. */
  trackedCurrency: string;
  /** iter 110: current price of trackedCurrency in base currency (Exalted). Null when no snapshot or untracked. */
  currentPrice: number | null;
  /** iter 110: signed % change over ~7d. Null when <7d history or untracked. */
  changePctWeek: number | null;
  /** iter 110: signed % change over ~30d. Null when <30d history or untracked. */
  changePctMonth: number | null;
  /** iter 110: "UP" (≥+5%) | "DOWN" (≤-5%) | "FLAT" | null. Derived from changePctWeek. */
  momentum: "UP" | "DOWN" | "FLAT" | null;
  /** iter 110: phase-aware recommendation. Null when momentum is null. */
  recommendation:
    | "BUY_OPPORTUNITY"
    | "HOLD"
    | "WATCH"
    | "SELL_INTO_STRENGTH"
    | "SELL_NOW"
    | "NEUTRAL"
    | null;
}

/** Response for GET /api/flipper/phase-hints (F6, iter 78). */
export interface PhaseHintsResponse {
  /** League name. */
  league: string;
  /** Current league phase: "early" | "mid" | "late" | "unknown". */
  phase: string;
  /** Human-readable phase label, e.g. "Early League". */
  phaseLabel: string;
  /** Days since league start or last major patch. */
  daysSinceReference: number;
  /** Reference currency for the phase (e.g. "exalted" for EARLY, "divine" for MID/LATE). Empty if unknown. */
  referenceCurrency: string;
  /** 1-2 sentence overview of the current phase. */
  phaseSummary: string;
  /** Phase-relevant advisory hints (hardcoded table, no live metrics). */
  hints: PhaseHint[];
  /** Always true — the hint table is hardcoded and always available. False only on exception. */
  dataAvailable: boolean;
  /** ISO 8601 timestamp of data fetch. */
  fetchedAt: string;
}

// Types previously in poe2api.ts — now consolidated here

export interface ExchangeSnapshot {
  pairs: ExchangePair[];
  referenceCurrency: string;
  timestamp: string;
  volume: number;
  marketCap: number;
}

/** OHLCV candle for multi-timeframe charts (1H/4H/1W aggregation).
 *  Previously in poe2api.ts — moved here to satisfy I4 (all types in types.ts). */
export interface OHLCVCandle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ============================================================================
// P1-3: Currency Tier types
// ============================================================================

/** P1-3: Currency tier classification */
export interface CurrencyTier {
  apiId: string;
  tier: number;
  tierLabel: string;
  relativePrice: number;
  tierAnchor: string;
}

/** P1-3: Tiers API response */
export interface TiersResponse {
  tiers: CurrencyTier[];
  boundaries: {
    t0Min: number;
    t1Min: number;
    t2Min: number;
    t3Min: number;
    t4Min: number;
  };
  dataAvailable: boolean;
}

// ============================================================================
// P1-5: Historical Benchmark types
// ============================================================================

/** P1-5: Historical price benchmark */
export interface HistoricalBenchmark {
  low30d: number;
  high30d: number;
  rangePosition: number;   // 0 = bottom, 1 = peak
  percentile30d: number;   // 0-100
  currentVsAvg: number;    // negative = below average
}

/** P1-5: Benchmarks API response */
export interface BenchmarksResponse {
  currencyApiId: string;
  currentPrice: number;
  benchmark: HistoricalBenchmark | null;
  days: number;
  dataAvailable: boolean;
}

// ============================================================================
// Flipper proxy error types
// ============================================================================

/** Error type discriminant returned by the flipper proxy (503/502/422 responses) */
export type FlipperErrorType =
  | "backend_offline"
  | "backend_timeout"
  | "backend_connection_reset"
  | "backend_insufficient_data"
  | "insufficient_data"
  | "server_error"
  | "upstream_error";

/**
 * Custom error thrown by `fetchApi` when a flipper endpoint returns 503.
 * Carries the `error_type` field so UI code can distinguish:
 *   - "backend_offline"         → backend process not running (connection refused)
 *   - "backend_insufficient_data" → backend running but lacks enough data
 */
export class FlipperApiError extends Error {
  /** HTTP status code (typically 503) */
  public readonly status: number;
  /** Discriminant: "backend_offline" or "backend_insufficient_data" or "upstream_error" */
  public readonly errorType: FlipperErrorType | undefined;
  /** Raw detail string from the backend (if any) */
  public readonly detail: string | undefined;
  /** Actionable hint from the backend (Fix 11 — POE2-FIX-SPEC) */
  public readonly hint: string | undefined;

  constructor(status: number, body: string) {
    super(`API ${status}: ${body}`);
    this.name = "FlipperApiError";
    this.status = status;

    // Try to parse the JSON body for structured fields
    try {
      const parsed = JSON.parse(body);
      this.errorType = parsed.errorType ?? parsed.error_type;
      this.detail = parsed.detail ?? parsed.error;
      this.hint = parsed.hint;
    } catch {
      // Body was not JSON — leave errorType undefined
    }

    // Classify common status codes when error_type not in response body
    if (!this.errorType) {
      if (status === 503) this.errorType = "backend_offline";
      else if (status === 502) this.errorType = "upstream_error";
      else if (status === 422) this.errorType = "insufficient_data";
      else if (status === 404) this.errorType = "insufficient_data";
      else if (status >= 500) this.errorType = "server_error";
    }
  }
}

/**
 * Inspect an unknown error thrown by a flipper query and return the
 * `FlipperErrorType` if it was a `FlipperApiError`, or `undefined` otherwise.
 */
export function getFlipperErrorType(error: unknown): FlipperErrorType | undefined {
  if (error instanceof FlipperApiError) {
    return error.errorType;
  }
  // Fallback: try to parse the error message for the error_type field
  if (error instanceof Error) {
    const match = error.message.match(/"error_type"\s*:\s*"(\w+)"/);
    if (match) return match[1] as FlipperErrorType;
  }
  return undefined;
}

// ============================================================================
// Fetch helper (through proxy routes) — CLIENT-SIDE ONLY
// ============================================================================
export async function fetchApi<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(path, window.location.origin);
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v) url.searchParams.set(k, v);
    });
  }
  const res = await fetch(url.toString());
  if (!res.ok) {
    let detail = "";
    let hint = "";
    let errorType: string | undefined;
    try {
      const body = await res.json();
      detail = body.error || body.detail || "";
      hint = body.hint || "";
      errorType = body.errorType ?? body.error_type;  // flipper-proxy sets this explicitly (may be camelCase after transform)
    } catch {
      // Body was not JSON
    }

    // If error_type wasn't provided by the proxy, infer from status code
    if (!errorType) {
      if (res.status === 503) errorType = "backend_offline";
      else if (res.status === 502) errorType = "upstream_error";
      else if (res.status === 422) errorType = "insufficient_data";
      else if (res.status >= 500) errorType = "server_error";
    }

    const err = new FlipperApiError(res.status, JSON.stringify({
      error: detail || res.statusText,
      hint,
      error_type: errorType,
    }));
    throw err;
  }
  return res.json() as Promise<T>;
}

// ============================================================================
// Format helpers
// ============================================================================
export function fmt(n: number | null | undefined, digits = 2): string {
  if (n == null) return "—";
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 1 });
  if (n >= 1) return n.toFixed(digits);
  // Adaptive precision for small prices (e.g. 0.000875 Exa):
  // 0.1–0.99 → 3 digits, 0.01–0.099 → 4 digits, 0.001–0.0099 → 5 digits, etc.
  // This ensures significant digits are visible instead of showing "0.00".
  const absN = Math.abs(n);
  if (absN === 0) return "0";
  const magnitude = Math.floor(Math.log10(absN));          // e.g. -3 for 0.000875
  const decimalPlaces = Math.max(digits, digits + 1 - magnitude); // e.g. 2+1-(-3)=6
  return n.toFixed(Math.min(decimalPlaces, 8));             // cap at 8 decimal places
}

export function fmtChange(pct: number | null | undefined): { text: string; color: string } {
  if (pct == null) return { text: "—", color: "text-muted-foreground" };
  const sign = pct > 0 ? "+" : "";
  const color = pct > 0 ? "text-emerald-400" : pct < 0 ? "text-red-400" : "text-muted-foreground";
  return { text: `${sign}${pct.toFixed(1)}%`, color };
}

/** Format a fractional value (0–1) as a percentage string, e.g. 0.4567 → "45.67%" */
export function fmtPct(n: number | null | undefined, digits = 2): string {
  if (n == null) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

/** Format a volume number with locale-aware thousands separators */
export function fmtVol(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US");
}

// ============================================================================
// Step 5: Currency Optimizer types
// ============================================================================

/** Response from GET /api/flipper/optimizer/path */
export interface OptimizerPathResponse {
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

/** Response from GET /api/flipper/optimizer/matrix */
export interface OptimizerMatrixResponse {
  currencies: string[];
  matrix: (number | null)[][];
  size: number;
  dataAvailable: boolean;
  fetchedAt: string;
}

// ============================================================================
// Step 7: League Analyst types
// ============================================================================

/** Currency trend data */
export interface CurrencyTrend {
  apiId: string;
  currentPrice: number;
  change24hPct: number | null;
  direction: "up" | "down" | "stable" | "unknown";
}

/** Detected price anomaly */
export interface PriceAnomaly {
  apiId: string;
  zScore: number;
  direction: "spike_up" | "spike_down";
  currentPrice: number;
  changePct: number | null;
}

/** Auto-generated league fact */
export interface LeagueFact {
  type: "trend" | "anomaly" | "market";
  icon: string;
  text: string;
  severity: "info" | "warning";
  /** iter 88: stable template identifier — when present, frontend formats the
   * fact text via `t("analystFact<TemplateIdCamelCase>", params)` instead of
   * rendering `text` directly. Backward-compatible — old responses without
   * `templateId` fall back to `text`. */
  templateId?: string;
  /** iter 88: template parameters (apiId, pct, count, totalCurrencies,
   * totalPairs, stableCount). Shape depends on `templateId`. */
  params?: Record<string, string | number>;
}

/** Response from GET /api/flipper/analyst/summary */
export interface AnalystSummaryResponse {
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

// ============================================================================
// §11: Cross-Currency Arbitrage & Optimal Payment types
// ============================================================================

/** Result of comparing an item's price across multiple payment currencies.
 *  See currency-optimal.ts for the computation logic. */
export interface OptimalPaymentResult {
  bestCurrencyId: string;
  worstCurrencyId: string;
  bestAnchorPrice: number;
  worstAnchorPrice: number;
  savingsAnchor: number;
  savingsPct: number;
  options: PaymentOption[];
}

/** A single payment option for an item in a specific currency */
export interface PaymentOption {
  currencyId: string;
  currencyName: string;
  priceInCurrency: number;
  effectiveAnchorPrice: number;
  premiumPct: number;
}

/** A detected cross-rate flip opportunity */
export interface CrossRateFlip {
  buyCurrencyId: string;
  sellCurrencyId: string;
  fairRate: number;
  marketRate: number;
  deviationPct: number;
  direction: "buy_sell_with_buy" | "buy_buy_with_sell";
  estimatedProfitPct: number;
  volume: number;
}

/** Response from GET /api/flipper/optimal-currency
 *  Backend keys use "currencyFrom_currencyTo" format (not pair.id).
 *  Frontend must remap to pair.id for component lookups. */
export interface OptimalCurrencyResponse {
  league: string;
  anchorId: string;
  /** Key: "currencyFrom_currencyTo", Value: OptimalPaymentResult */
  optimalPaymentByPair: Record<string, OptimalPaymentResult>;
  crossRateFlips: CrossRateFlip[];
  dataAvailable: boolean;
  fetchedAt: string;
}

// ============================================================================
// §12: Liquid Chain — vendor reforge conversion chain profitability
// ============================================================================

/** One step in a vendor reforge conversion chain (e.g. 3 Diluted Liquid Ire → 1 Diluted Liquid Guilt).
 *  Backend serializes with snake_case keys; proxy transforms to camelCase. */
export interface LiquidChainStep {
  apiId: string;
  nameEn: string;
  nameRu: string;
  ratio: number;
  price: number;
  inputCost: number;
  outputValue: number;
  profit: number;
  profitPct: number;
}

/** Cumulative profit/loss from reforging from step `fromIndex` to step `toIndex`. */
export interface LiquidChainCumulativePath {
  fromIndex: number;
  toIndex: number;
  totalInputCost: number;
  totalOutputValue: number;
  cumulativeRatio: number;
  profit: number;
  profitPct: number;
}

/** Complete analysis result for a single liquid chain (e.g. delirium_liquids). */
export interface LiquidChainResult {
  chainName: string;
  category: string;
  steps: LiquidChainStep[];
  cumulativePaths: LiquidChainCumulativePath[];
  bestStep: number | null;
  worstStep: number | null;
  dataAvailable: boolean;
  stepsWithData: number;
  totalSteps: number;
}

/** Response from GET /api/liquid-chain/analysis */
export interface LiquidChainAnalysisResponse {
  chains: LiquidChainResult[];
  dataAvailable: boolean;
  fetchedAt: string;
  message?: string;
}

/** Response from GET /api/liquid-chain/opportunities */
export interface LiquidChainOpportunitiesResponse {
  chains: Array<{
    chainName: string;
    category: string;
    profitableSteps: LiquidChainStep[];
    profitableCumulativePaths: LiquidChainCumulativePath[];
    bestStep: number | null;
    worstStep: number | null;
    dataAvailable: boolean;
    stepsWithData: number;
    totalSteps: number;
  }>;
  dataAvailable: boolean;
  fetchedAt: string;
  message?: string;
}

// ============================================================================
// Mirror/Divine Arbitrage Detector (P7, iter 108)
// ============================================================================

/** Signal emitted by the Mirror:Divine arb detector. */
export type MirrorDivineArbSignal =
  | "SELL_MIRROR_BUY_DIVINE" // z >= +1.5 — Mirror overvalued vs Div
  | "SELL_DIVINE_BUY_MIRROR" // z <= -1.5 — Mirror undervalued vs Div
  | "NEUTRAL"; // rate within normal range

/** Recommended action from the Mirror:Divine arb detector. */
export type MirrorDivineArbAction =
  | "EXECUTE_ARB" // actionable AND |z| >= 1.5 — execute swap-then-swap-back now
  | "WATCH" // actionable AND |z| in [1.0, 1.5) — watch for escalation
  | "HOLD"; // not actionable OR |z| < 1.0

/** A single point in the Mirror:Divine rate time-series (UI sparkline). */
export interface MirrorDivineArbRatePoint {
  date: string; // ISO 8601 timestamp
  rate: number; // mirror_price / divine_price (Div per Mirror)
}

/** Response from GET /api/flipper/mirror-divine-arb.
 *  Single-object response (Mirror:Divine is one market, not a per-currency list). */
export interface MirrorDivineArbResponse {
  league: string;
  mirrorCurrency: string; // default "mirror"
  divineCurrency: string; // default "divine"
  currentRate: number | null; // most recent rate (Div per Mirror)
  meanRate: number | null; // historical mean over the window
  stdRate: number | null; // sample std (ddof=1) over the window
  minRate: number | null;
  maxRate: number | null;
  zScore: number | null; // (current - mean) / std; null when std == 0
  deviationPct: number | null; // signed (current - mean) / mean * 100
  profitPotentialPerMirrorDiv: number | null; // |current - mean| in Div per Mirror
  signal: MirrorDivineArbSignal;
  isActionable: boolean; // profit_potential >= 100 Div
  recommendedAction: MirrorDivineArbAction;
  sampleSize: number; // number of rate points in the window
  priceHistoryShort: MirrorDivineArbRatePoint[]; // up to 14 most-recent points
  dataAvailable: boolean;
  fetchedAt: string; // ISO 8601
  days: number; // lookback window echoed for client cache keys
}

// ============================================================================
// Export helpers (CSV/JSON)
// ============================================================================
export function exportToCsv(data: Record<string, unknown>[], filename: string) {
  if (!data.length) return;
  const headers = Object.keys(data[0]);
  const csvRows = [
    headers.join(","),
    ...data.map((row) =>
      headers
        .map((h) => {
          const val = row[h];
          const str = val == null ? "" : String(val);
          return `"${str.replace(/"/g, '""')}"`;
        })
        .join(",")
    ),
  ];
  const blob = new Blob([csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
  downloadBlob(blob, `${filename}.csv`);
}

export function exportToJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  downloadBlob(blob, `${filename}.json`);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
