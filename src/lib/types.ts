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
  currency2Id: string;
  currency2Name: string;
  currency2IconUrl: string | null;
  price: number;
  relativePrice: number;
  volume: number;
  change: number | null;
  changePercent: number | null;
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

/** Response shape from GET /api/flipper/health */
export interface FlipperHealthResponse {
  status: "ok" | "degraded" | "error";
  provider: "reachable" | "unreachable";
  timestamp: string;
  league?: string;
  base_currency?: string;
  active_events?: number;
  cache_entries?: number;
}

/** Response shape from GET /api/flipper/phase */
export interface FlipperPhaseResponse {
  phase: string;
  days_since_ref: number;
  league: string;
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
}

export interface LandingSplashInfo {
  topItems: PoeItem[];
  topCurrencies: PoeItem[];
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
  return n.toFixed(digits);
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
