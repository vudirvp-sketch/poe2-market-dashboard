// ============================================================================
// PoE2 Scout API — Server-side fetch functions + in-memory cache
// Base URL: https://poe2scout.com/api
//
// NOTE: Type definitions are consolidated in ./types.ts
// This file ONLY contains server-side API fetch functions.
// ============================================================================

import type {
  Realm,
  League,
  PoeItem,
  PoeItemHistoryPoint,
  DailyStat,
  ItemCategory,
  ExchangePair,
  ExchangePairHistoryPoint,
  PaginatedResponse,
  ExchangeSnapshot,
  LandingSplashInfo,
  SnapshotHistoryPoint,
  ReferenceCurrency,
} from "./types";

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
