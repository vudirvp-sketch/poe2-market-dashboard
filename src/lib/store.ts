// ============================================================================
// PoE2 Market Dashboard — Zustand Store
//
// Manages: Favorites, Comparison, Alerts, and Persisted UI State (§1.7).
//
// v0.5 FIX: Deferred localStorage reads to avoid hydration mismatch.
// On SSR and first client render, state starts with empty/default values.
// After mount, a `rehydrate()` call loads from localStorage.
//
// v0.6 (§1.7): Added persisted UI state (activeTab, exchange settings, league).
// Debounced save (300ms) to avoid excessive writes. Version field for migration.
// ============================================================================

import { create } from "zustand";

// ---------- Price Alert type ----------
export interface PriceAlert {
  itemId: string;
  itemName: string;
  condition: "above" | "below";
  threshold: number;
  enabled: boolean;
}

// ---------- Pair Comparison IDs ----------
export interface PairComparisonId {
  currency1Id: string;
  currency2Id: string;
  /** Numeric ItemId — required for the CurrencyPairHistory API endpoint */
  currency1ItemId: number;
  currency2ItemId: number;
  label: string; // e.g. "Chaos Orb / Divine Orb"
}

// ---------- Extended Filters (§2.3) ----------
export interface ExchangeExtendedFilters {
  minVolume: number | null;
  maxVolume: number | null;
  minChange: number | null;
  maxChange: number | null;
}

// ---------- Watchlist Added Dates (§2.6) ----------
export interface WatchlistEntry {
  id: string;
  addedAt: string; // ISO timestamp
}

// ---------- Persisted UI State (§1.7 + §2.3 + §2.6) ----------
export interface PersistedUIState {
  /** Schema version for migration support */
  _version: number;
  activeTab: string;
  exchange: {
    viewMode: "table" | "cards";
    sortField: string;
    sortDirection: "asc" | "desc";
    activeFilter: "all" | "topVolume" | "favorites";
    favorites: string[];
    /** §2.3: Extended numeric filters */
    extendedFilters: ExchangeExtendedFilters;
  };
  /** §2.6: Watchlist entries with added dates */
  watchlist: WatchlistEntry[];
  league: string;
  /** §3.5: Global compact/dense mode toggle */
  denseMode: boolean;
  /** Phase 0.2: Base currency API ID (e.g. "exalted") for currency labels */
  baseCurrencyApiId: string | null;
  /** Phase 0.2: Base currency display text (e.g. "Exalted Orb") for currency labels */
  baseCurrencyText: string | null;
}

const DEFAULT_UI_STATE: PersistedUIState = {
  _version: 4,
  activeTab: "exchange",
  exchange: {
    viewMode: "table",
    sortField: "volume",
    sortDirection: "desc",
    activeFilter: "all",
    favorites: [],
    extendedFilters: {
      minVolume: null,
      maxVolume: null,
      minChange: null,
      maxChange: null,
    },
  },
  watchlist: [],
  league: "runes",
  denseMode: false,
  baseCurrencyApiId: null,
  baseCurrencyText: null,
};

const UI_STATE_KEY = "poe2-dashboard-state";

// ---------- Debounced save helper ----------
let _saveTimer: ReturnType<typeof setTimeout> | null = null;
const SAVE_DEBOUNCE_MS = 300;

function debouncedSaveToStorage(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // ignore quota errors
    }
  }, SAVE_DEBOUNCE_MS);
}

// ---------- localStorage helpers ----------
function loadFromStorage<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : fallback;
  } catch {
    return fallback;
  }
}

function saveToStorage(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

/**
 * Validate and migrate persisted UI state.
 * Returns DEFAULT_UI_STATE if the stored state is invalid or corrupted.
 */
function validateUIState(raw: unknown): PersistedUIState {
  if (!raw || typeof raw !== "object") return DEFAULT_UI_STATE;
  const stored = raw as Record<string, unknown>;

  // Version check — support v1, v2, v3, v4 (migrate)
  const version = stored._version;
  if (version !== 1 && version !== 2 && version !== 3 && version !== 4) return DEFAULT_UI_STATE;

  // Validate activeTab
  const validTabs = [
    "overview", "currencies", "uniques", "exchange",
    "arbitrage", "flips", "optimizer", "analyst", "forecast", "portfolio",
    "graph", "watchlist",
  ];
  const activeTab = validTabs.includes(stored.activeTab as string)
    ? (stored.activeTab as string)
    : DEFAULT_UI_STATE.activeTab;

  // Validate exchange sub-object
  const rawExchange = stored.exchange as Record<string, unknown> | undefined;
  // §2.3: Extended filters (migrated from v1 → v2 with defaults)
  const rawExtFilters = rawExchange?.extendedFilters as Record<string, unknown> | undefined;
  const extendedFilters: ExchangeExtendedFilters = {
    minVolume: typeof rawExtFilters?.minVolume === "number" ? rawExtFilters.minVolume : null,
    maxVolume: typeof rawExtFilters?.maxVolume === "number" ? rawExtFilters.maxVolume : null,
    minChange: typeof rawExtFilters?.minChange === "number" ? rawExtFilters.minChange : null,
    maxChange: typeof rawExtFilters?.maxChange === "number" ? rawExtFilters.maxChange : null,
  };

  const exchange = {
    viewMode: rawExchange?.viewMode === "cards" ? "cards" as const : "table" as const,
    sortField: typeof rawExchange?.sortField === "string" ? rawExchange.sortField : DEFAULT_UI_STATE.exchange.sortField,
    sortDirection: rawExchange?.sortDirection === "asc" ? "asc" as const : "desc" as const,
    activeFilter:
      rawExchange?.activeFilter === "topVolume" || rawExchange?.activeFilter === "favorites"
        ? (rawExchange.activeFilter as "topVolume" | "favorites")
        : "all" as const,
    favorites: Array.isArray(rawExchange?.favorites) ? rawExchange.favorites as string[] : [],
    extendedFilters,
  };

  // Validate league
  const league = typeof stored.league === "string" && stored.league
    ? stored.league
    : DEFAULT_UI_STATE.league;

  // §2.6: Watchlist entries with added dates
  const rawWatchlist = stored.watchlist;
  const watchlist: WatchlistEntry[] = Array.isArray(rawWatchlist)
    ? rawWatchlist.filter(
        (w: unknown) => w && typeof (w as Record<string, unknown>).id === "string" && typeof (w as Record<string, unknown>).addedAt === "string"
      ) as WatchlistEntry[]
    : [];

  // Migrate exchange favorites to watchlist entries (v1 → v2)
  if (version === 1 && exchange.favorites.length > 0) {
    const existingIds = new Set(watchlist.map((w) => w.id));
    const migrated = exchange.favorites
      .filter((id) => !existingIds.has(id))
      .map((id) => ({ id, addedAt: new Date().toISOString() }));
    watchlist.push(...migrated);
  }

  // §3.5: Migrate denseMode (v2 → v3 adds denseMode)
  const denseMode = typeof stored.denseMode === "boolean" ? stored.denseMode : false;

  // Phase 0.2: Migrate baseCurrencyApiId/baseCurrencyText (v3 → v4 adds currency fields)
  const baseCurrencyApiId = typeof stored.baseCurrencyApiId === "string" ? stored.baseCurrencyApiId : null;
  const baseCurrencyText = typeof stored.baseCurrencyText === "string" ? stored.baseCurrencyText : null;

  return { _version: 4, activeTab, exchange, watchlist, league, denseMode, baseCurrencyApiId, baseCurrencyText };
}

// ---------- Store Interface ----------
interface DashboardStore {
  // Favorites / Watchlist
  favorites: string[]; // item IDs
  addFavorite: (id: string) => void;
  removeFavorite: (id: string) => void;
  isFavorite: (id: string) => boolean;
  toggleFavorite: (id: string) => void;

  // Comparison (items)
  comparisonIds: string[];
  addToComparison: (id: string) => void;
  removeFromComparison: (id: string) => void;
  clearComparison: () => void;
  isInComparison: (id: string) => boolean;

  // Pair Comparison (exchange pairs)
  pairComparisonIds: PairComparisonId[];
  addPairToComparison: (pair: PairComparisonId) => void;
  removePairFromComparison: (key: string) => void;
  clearPairComparison: () => void;

  // Price Alerts
  alerts: PriceAlert[];
  addAlert: (alert: PriceAlert) => void;
  removeAlert: (itemId: string) => void;
  updateAlert: (itemId: string, updates: Partial<PriceAlert>) => void;
  getAlertsForItem: (itemId: string) => PriceAlert[];

  // Persisted UI State (§1.7)
  uiState: PersistedUIState;
  setActiveTab: (tab: string) => void;
  setExchangeViewMode: (mode: "table" | "cards") => void;
  setExchangeSort: (field: string, direction: "asc" | "desc") => void;
  setExchangeFilter: (filter: "all" | "topVolume" | "favorites") => void;
  toggleExchangeFavorite: (pairId: string) => void;
  setLeague: (league: string) => void;

  // §2.3: Extended Exchange Filters
  setExchangeExtendedFilters: (filters: ExchangeExtendedFilters) => void;
  clearExchangeExtendedFilters: () => void;

  // §2.6: Watchlist with added dates
  getWatchlistEntry: (id: string) => WatchlistEntry | undefined;
  addToWatchlist: (id: string) => void;
  removeFromWatchlist: (id: string) => void;

  // §3.5: Global dense mode
  setDenseMode: (enabled: boolean) => void;

  // Phase 0.2: Base currency for labels
  setBaseCurrency: (apiId: string | null, text: string | null) => void;

  // Hydration
  _hydrated: boolean;
  rehydrate: () => void;
}

export const useDashboardStore = create<DashboardStore>((set, get) => ({
  // Start with empty defaults — prevents hydration mismatch
  favorites: [],
  comparisonIds: [],
  pairComparisonIds: [],
  alerts: [],
  uiState: DEFAULT_UI_STATE,
  _hydrated: false,

  /**
   * Call this once after mount (in a useEffect) to load persisted data.
   * This avoids hydration mismatches because SSR always renders with empty state.
   */
  rehydrate: () => {
    const favorites = loadFromStorage<string[]>("poe2-favorites", []);
    const pairComparisonIds = loadFromStorage<PairComparisonId[]>("poe2-pair-comparison", []);
    const alerts = loadFromStorage<PriceAlert[]>("poe2-alerts", []);
    const rawUIState = loadFromStorage<unknown>(UI_STATE_KEY, null);
    const uiState = validateUIState(rawUIState);

    // Merge exchange favorites from persisted state into the main favorites list
    // so the Favorites chip in Exchange works correctly
    const exchangeFavs = uiState.exchange.favorites;
    const mergedFavorites = [...new Set([...favorites, ...exchangeFavs])];

    set({ favorites: mergedFavorites, pairComparisonIds, alerts, uiState, _hydrated: true });
  },

  addFavorite: (id) => {
    const favs = get().favorites;
    if (!favs.includes(id)) {
      const next = [...favs, id];
      set({ favorites: next });
      saveToStorage("poe2-favorites", next);
    }
  },

  removeFavorite: (id) => {
    const next = get().favorites.filter((f) => f !== id);
    set({ favorites: next });
    saveToStorage("poe2-favorites", next);
  },

  isFavorite: (id) => get().favorites.includes(id),

  toggleFavorite: (id) => {
    const favs = get().favorites;
    if (favs.includes(id)) {
      const next = favs.filter((f) => f !== id);
      set({ favorites: next });
      saveToStorage("poe2-favorites", next);
    } else {
      const next = [...favs, id];
      set({ favorites: next });
      saveToStorage("poe2-favorites", next);
    }
  },

  addToComparison: (id) => {
    const ids = get().comparisonIds;
    if (!ids.includes(id) && ids.length < 4) {
      set({ comparisonIds: [...ids, id] });
    }
  },

  removeFromComparison: (id) => {
    set({ comparisonIds: get().comparisonIds.filter((i) => i !== id) });
  },

  clearComparison: () => set({ comparisonIds: [] }),

  isInComparison: (id) => get().comparisonIds.includes(id),

  // ---- Pair Comparison ----
  addPairToComparison: (pair) => {
    const pairs = get().pairComparisonIds;
    const key = `${pair.currency1Id}_${pair.currency2Id}`;
    const exists = pairs.some(
      (p) => `${p.currency1Id}_${p.currency2Id}` === key
    );
    if (!exists && pairs.length < 4) {
      const next = [...pairs, pair];
      set({ pairComparisonIds: next });
      saveToStorage("poe2-pair-comparison", next);
    }
  },

  removePairFromComparison: (key) => {
    const next = get().pairComparisonIds.filter(
      (p) => `${p.currency1Id}_${p.currency2Id}` !== key
    );
    set({ pairComparisonIds: next });
    saveToStorage("poe2-pair-comparison", next);
  },

  clearPairComparison: () => {
    set({ pairComparisonIds: [] });
    saveToStorage("poe2-pair-comparison", []);
  },

  // ---- Price Alerts ----
  addAlert: (alert) => {
    const alerts = get().alerts;
    // Replace existing alert for same item + condition
    const next = [
      ...alerts.filter(
        (a) => !(a.itemId === alert.itemId && a.condition === alert.condition)
      ),
      alert,
    ];
    set({ alerts: next });
    saveToStorage("poe2-alerts", next);
  },

  removeAlert: (itemId) => {
    const next = get().alerts.filter((a) => a.itemId !== itemId);
    set({ alerts: next });
    saveToStorage("poe2-alerts", next);
  },

  updateAlert: (itemId, updates) => {
    const next = get().alerts.map((a) =>
      a.itemId === itemId ? { ...a, ...updates } : a
    );
    set({ alerts: next });
    saveToStorage("poe2-alerts", next);
  },

  getAlertsForItem: (itemId) => get().alerts.filter((a) => a.itemId === itemId),

  // ---- Persisted UI State (§1.7) ----
  setActiveTab: (tab) => {
    const uiState = { ...get().uiState, activeTab: tab };
    set({ uiState });
    debouncedSaveToStorage(UI_STATE_KEY, uiState);
  },

  setExchangeViewMode: (mode) => {
    const uiState = {
      ...get().uiState,
      exchange: { ...get().uiState.exchange, viewMode: mode },
    };
    set({ uiState });
    debouncedSaveToStorage(UI_STATE_KEY, uiState);
  },

  setExchangeSort: (field, direction) => {
    const uiState = {
      ...get().uiState,
      exchange: { ...get().uiState.exchange, sortField: field, sortDirection: direction },
    };
    set({ uiState });
    debouncedSaveToStorage(UI_STATE_KEY, uiState);
  },

  setExchangeFilter: (filter) => {
    const uiState = {
      ...get().uiState,
      exchange: { ...get().uiState.exchange, activeFilter: filter },
    };
    set({ uiState });
    debouncedSaveToStorage(UI_STATE_KEY, uiState);
  },

  toggleExchangeFavorite: (pairId) => {
    const current = get().uiState.exchange.favorites;
    const isFav = current.includes(pairId);
    const next = isFav
      ? current.filter((id) => id !== pairId)
      : [...current, pairId];

    // §2.6: Sync with watchlist — add/remove watchlist entry too
    const watchlist = isFav
      ? get().uiState.watchlist.filter((w) => w.id !== pairId)
      : [...get().uiState.watchlist, { id: pairId, addedAt: new Date().toISOString() }];

    const uiState = {
      ...get().uiState,
      exchange: { ...get().uiState.exchange, favorites: next },
      watchlist,
    };
    set({ uiState });
    debouncedSaveToStorage(UI_STATE_KEY, uiState);
  },

  setLeague: (league) => {
    const uiState = { ...get().uiState, league };
    set({ uiState });
    debouncedSaveToStorage(UI_STATE_KEY, uiState);
  },

   // ---- §2.3: Extended Exchange Filters ----
  setExchangeExtendedFilters: (filters) => {
    const uiState = {
      ...get().uiState,
      exchange: { ...get().uiState.exchange, extendedFilters: filters },
    };
    set({ uiState });
    debouncedSaveToStorage(UI_STATE_KEY, uiState);
  },

  clearExchangeExtendedFilters: () => {
    const uiState = {
      ...get().uiState,
      exchange: {
        ...get().uiState.exchange,
        extendedFilters: { minVolume: null, maxVolume: null, minChange: null, maxChange: null },
      },
    };
    set({ uiState });
    debouncedSaveToStorage(UI_STATE_KEY, uiState);
  },

  // ---- §2.6: Watchlist with added dates ----
  getWatchlistEntry: (id) => get().uiState.watchlist.find((w) => w.id === id),

  addToWatchlist: (id) => {
    const existing = get().uiState.watchlist;
    if (existing.some((w) => w.id === id)) return; // already in watchlist
    const watchlist = [...existing, { id, addedAt: new Date().toISOString() }];
    const uiState = { ...get().uiState, watchlist };
    set({ uiState });
    debouncedSaveToStorage(UI_STATE_KEY, uiState);
  },

  removeFromWatchlist: (id) => {
    const watchlist = get().uiState.watchlist.filter((w) => w.id !== id);
    const uiState = { ...get().uiState, watchlist };
    set({ uiState });
    debouncedSaveToStorage(UI_STATE_KEY, uiState);
  },

  // ---- §3.5: Global Dense Mode ----
  setDenseMode: (enabled) => {
    const uiState = { ...get().uiState, denseMode: enabled };
    set({ uiState });
    debouncedSaveToStorage(UI_STATE_KEY, uiState);
  },

  // ---- Phase 0.2: Base Currency ----
  setBaseCurrency: (apiId, text) => {
    const uiState = { ...get().uiState, baseCurrencyApiId: apiId, baseCurrencyText: text };
    set({ uiState });
    debouncedSaveToStorage(UI_STATE_KEY, uiState);
  },
}));
