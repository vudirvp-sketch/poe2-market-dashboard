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
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
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
