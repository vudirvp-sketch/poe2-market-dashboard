// ============================================================================
// PoE2 Scout API — TypeScript types + fetch functions + in-memory cache
// Base URL: https://poe2scout.com/api
// ============================================================================

const BASE_URL = "https://poe2scout.com/api";

// ---------- Simple in-memory cache (60s TTL) ----------
const cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL = 60_000; // 60 seconds

async function cachedFetch<T>(url: string): Promise<T> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.ts < CACHE_TTL) {
    return hit.data as T;
  }
  const res = await fetch(url, { next: { revalidate: 60 } });
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${res.statusText} — ${url}`);
  }
  const data = (await res.json()) as T;
  cache.set(url, { data, ts: Date.now() });
  return data;
}

// ===================== TYPES =====================

// Realms
export interface Realm {
  name: string;
  displayName: string;
}

// Leagues
export interface League {
  name: string;
  displayName: string;
  startAt: string | null;
  endAt: string | null;
  active: boolean;
}

// Item (unique or currency)
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

// Category
export interface ItemCategory {
  name: string;
  displayName: string;
  count: number;
}

// Exchange pair
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

// Paginated response
export interface PaginatedResponse<T> {
  items: T[];
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
}

// Exchange snapshot
export interface ExchangeSnapshot {
  pairs: ExchangePair[];
  referenceCurrency: string;
  timestamp: string;
}

// Landing splash info
export interface LandingSplashInfo {
  topItems: PoeItem[];
  topCurrencies: PoeItem[];
}

// Snapshot history point (for market overview)
export interface SnapshotHistoryPoint {
  timestamp: string;
  totalVolume: number;
  totalMarketCap: number;
  itemCount: number;
}

// Reference currency
export interface ReferenceCurrency {
  apiId: string;
  text: string;
  iconUrl: string | null;
  relativePrice: number;
}

// ===================== API FUNCTIONS =====================

// --- Realms ---
export async function getRealms(): Promise<Realm[]> {
  return cachedFetch<Realm[]>(`${BASE_URL}/Realms`);
}

export async function getRealmFilters(realm: string): Promise<unknown> {
  return cachedFetch(`${BASE_URL}/Realms/${realm}/Filters`);
}

export async function getLandingSplashInfo(realm: string): Promise<LandingSplashInfo> {
  return cachedFetch<LandingSplashInfo>(`${BASE_URL}/Realms/${realm}/LandingSplashInfo`);
}

// --- Leagues ---
export async function getLeagues(realm: string): Promise<League[]> {
  return cachedFetch<League[]>(`${BASE_URL}/${realm}/Leagues`);
}

export async function getExchangeSnapshot(realm: string, league: string): Promise<ExchangeSnapshot> {
  return cachedFetch<ExchangeSnapshot>(`${BASE_URL}/${realm}/Leagues/${encodeURIComponent(league)}/ExchangeSnapshot`);
}

export async function getReferenceCurrencies(realm: string, league: string): Promise<ReferenceCurrency[]> {
  return cachedFetch<ReferenceCurrency[]>(`${BASE_URL}/${realm}/Leagues/${encodeURIComponent(league)}/ReferenceCurrencies`);
}

export async function getSnapshotHistory(realm: string, league: string, limit = 24): Promise<SnapshotHistoryPoint[]> {
  return cachedFetch<SnapshotHistoryPoint[]>(`${BASE_URL}/${realm}/Leagues/${encodeURIComponent(league)}/SnapshotHistory?Limit=${limit}`);
}

export async function getSnapshotPairs(realm: string, league: string): Promise<ExchangePair[]> {
  return cachedFetch<ExchangePair[]>(`${BASE_URL}/${realm}/Leagues/${encodeURIComponent(league)}/SnapshotPairs`);
}

// --- Items ---
export async function getItems(realm: string, league: string): Promise<PoeItem[]> {
  return cachedFetch<PoeItem[]>(`${BASE_URL}/${realm}/Leagues/${encodeURIComponent(league)}/Items`);
}

export async function getItemCategories(realm: string, league: string): Promise<ItemCategory[]> {
  return cachedFetch<ItemCategory[]>(`${BASE_URL}/${realm}/Leagues/${encodeURIComponent(league)}/Items/Categories`);
}

export async function getItem(realm: string, league: string, itemId: string): Promise<PoeItem> {
  return cachedFetch<PoeItem>(`${BASE_URL}/${realm}/Leagues/${encodeURIComponent(league)}/Items/${itemId}`);
}

export async function getItemHistory(realm: string, league: string, itemId: string, logCount = 168, referenceCurrency?: string): Promise<PoeItemHistoryPoint[]> {
  let url = `${BASE_URL}/${realm}/Leagues/${encodeURIComponent(league)}/Items/${itemId}/History?LogCount=${logCount}`;
  if (referenceCurrency) url += `&ReferenceCurrency=${encodeURIComponent(referenceCurrency)}`;
  return cachedFetch<PoeItemHistoryPoint[]>(url);
}

export async function getItemDailyStats(realm: string, league: string, itemId: string, dayCount = 30, referenceCurrency?: string): Promise<DailyStat[]> {
  let url = `${BASE_URL}/${realm}/Leagues/${encodeURIComponent(league)}/Items/${itemId}/DailyStatsHistory?DayCount=${dayCount}`;
  if (referenceCurrency) url += `&ReferenceCurrency=${encodeURIComponent(referenceCurrency)}`;
  return cachedFetch<DailyStat[]>(url);
}

// --- Uniques (paginated) ---
export async function getUniquesByCategory(
  realm: string,
  league: string,
  category = "all",
  page = 1,
  perPage = 50,
  search = "",
  referenceCurrency?: string
): Promise<PaginatedResponse<PoeItem>> {
  const params = new URLSearchParams({
    Category: category,
    Page: String(page),
    PerPage: String(perPage),
  });
  if (search) params.set("Search", search);
  if (referenceCurrency) params.set("ReferenceCurrency", referenceCurrency);
  return cachedFetch<PaginatedResponse<PoeItem>>(
    `${BASE_URL}/${realm}/Leagues/${encodeURIComponent(league)}/Uniques/ByCategory?${params}`
  );
}

// --- Currencies ---
export async function getCurrenciesByCategory(
  realm: string,
  league: string,
  category = "all",
  page = 1,
  perPage = 50,
  referenceCurrency?: string
): Promise<PaginatedResponse<PoeItem>> {
  const params = new URLSearchParams({
    Category: category,
    Page: String(page),
    PerPage: String(perPage),
  });
  if (referenceCurrency) params.set("ReferenceCurrency", referenceCurrency);
  return cachedFetch<PaginatedResponse<PoeItem>>(
    `${BASE_URL}/${realm}/Leagues/${encodeURIComponent(league)}/Currencies/ByCategory?${params}`
  );
}

export async function getCurrency(realm: string, league: string, apiId: string): Promise<PoeItem> {
  return cachedFetch<PoeItem>(`${BASE_URL}/${realm}/Leagues/${encodeURIComponent(league)}/Currencies/${apiId}`);
}

export async function getCurrencyPairHistory(
  realm: string,
  league: string,
  id1: string,
  id2: string,
  limit = 168
): Promise<ExchangePairHistoryPoint[]> {
  return cachedFetch<ExchangePairHistoryPoint[]>(
    `${BASE_URL}/${realm}/Leagues/${encodeURIComponent(league)}/Currencies/Pairs/${id1}/${id2}/History?Limit=${limit}`
  );
}

// --- Health ---
export async function getHealth(): Promise<{ status: string }> {
  return cachedFetch<{ status: string }>(`${BASE_URL}/health/live`);
}
