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
  priceChaos: number | null;
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
  priceChaos: number;
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

/** Scored flip opportunity from GET /api/flipper/flips */
export interface FlipOpportunity {
  currency: string;
  score: number;
  /** Raw spread (ask - bid) / mid_price — no fees deducted */
  spread: number;
  /** @deprecated Use spread instead. Kept for backward compat. */
  spread_after_fees: number;
  volume_24h: number;
  momentum: number;
  volatility: number;
  cluster: string;
  bid: number;
  ask: number;
  mid_price: number;
  /** P1-1: Quantized analysis (integer-aware spread) */
  quantized_analysis?: QuantizedAnalysis;
  /** P1-3: Tier distance between the two currencies */
  tier_distance?: number;
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
  any_active: boolean;
  affected_currencies: string[];
  summary: Record<string, unknown> | null;
}

/** Gold fee warning embedded in FlipsResponse and TriangularResponse */
export interface FeeWarning {
  gold_fees_excluded: boolean;
  message: string;
}

/** Response shape from GET /api/flipper/flips */
export interface FlipsResponse {
  league: string;
  total: number;
  opportunities: FlipOpportunity[];
  event_status: FlipEventStatus;
  fetched_at: string;
  /** true when backend has not accumulated enough data yet */
  data_available?: boolean;
  /** Warning about gold fees being excluded from calculations */
  fee_warning?: FeeWarning;
}

/** Triangular arbitrage cycle from GET /api/flipper/triangular */
export interface TriangularCycle {
  cycle: string[];
  net_profit_pct: number;
  step_rates: number[];
  total_volume: number;
  confidence: number;
  /** P1-2: Minimum starting capital for integer-profitable cycle */
  min_starting_amount?: number;
  /** P1-2: Profit validated via integer simulation */
  quantized_profit_pct?: number;
  /** P1-2: Original float profit (for reference) */
  continuous_profit_pct?: number;
  /** P1-2: Amounts at each step for min_start */
  integer_simulation?: number[];
}

/** Response shape from GET /api/flipper/triangular */
export interface CrossRateWarning {
  suspicious_triples_count: number;
  affected_currencies: string[];
  message: string;
}

export interface TriangularResponse {
  league: string;
  total: number;
  opportunities: TriangularCycle[];
  fetched_at: string;
  /** true when backend has not accumulated enough data yet */
  data_available?: boolean;
  /** Warning about gold fees being excluded from calculations */
  fee_warning?: FeeWarning;
  /** Warning about cross-rate inconsistencies causing false positives */
  cross_rate_warning?: CrossRateWarning | null;
}

/** Response shape from GET /api/flipper/health */
export interface FlipperHealthResponse {
  status: "ok" | "degraded" | "error" | "offline";
  provider: "reachable" | "unreachable";
  timestamp: string;
  league?: string;
  base_currency?: string;
  active_events?: number;
  cache_entries?: number;
  snapshot?: {
    snapshot_valid: boolean;
    snapshot_stale: boolean;
    snapshot_age_seconds: number | null;
    snapshot_ttl_seconds: number;
    exchange_rates_count: number;
    currencies_count: number;
    price_histories_count: number;
    fetched_at: string | null;
  };
  daily_stats_cache?: {
    size: number;
    max: number;
    stale_entries: number;
    ttl_seconds: number;
  };
}

/** Response shape from GET /api/flipper/phase */
export interface FlipperPhaseResponse {
  phase: string;
  days_since_ref: number;
  league: string;
}

/** Response shape from GET /api/flipper/portfolio */
export interface PortfolioData {
  method: "risk_parity" | "min_variance";
  weights: Record<string, number>;
  expected_risk: number;
  correlation_warning: boolean;
  last_rebalance: string | null;
}

/** Summary shape from GET /api/flipper/events?active_only=true (count only) */
export interface FlipperEventsSummary {
  events: { event_id: string }[];
  total: number;
}

// Types previously in poe2api.ts — now consolidated here

export interface ExchangeSnapshot {
  pairs: ExchangePair[];
  referenceCurrency: string;
  timestamp: string;
  volume: number;
  marketCap: number;
}

export interface LandingSplashInfo {
  topItems: PoeItem[];
  topCurrencies: PoeItem[];
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
      this.errorType = parsed.error_type;
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
      errorType = body.error_type;  // flipper-proxy sets this explicitly
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
