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
  currency2Id: string;
  currency2Name: string;
  currency2IconUrl: string | null;
  /** Numeric ItemId — required for the CurrencyPairHistory API endpoint */
  currency2ItemId: number;
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

/** Gold fee warning embedded in FlipsResponse and TriangularResponse */
export interface FeeWarning {
  goldFeesExcluded: boolean;
  message: string;
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
  /** Warning about gold fees being excluded from calculations */
  feeWarning?: FeeWarning;
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
  /** Warning about gold fees being excluded from calculations */
  feeWarning?: FeeWarning;
  /** Warning about cross-rate inconsistencies causing false positives */
  crossRateWarning?: CrossRateWarning | null;
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
  inputs?: StorageValueInputs;
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
