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

// ---------- Persisted UI State (§1.7) ----------
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
  };
  league: string;
}

const DEFAULT_UI_STATE: PersistedUIState = {
  _version: 1,
  activeTab: "exchange",
  exchange: {
    viewMode: "table",
    sortField: "volume",
    sortDirection: "desc",
    activeFilter: "all",
    favorites: [],
  },
  league: "vaal",
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

  // Version check — for now only v1 is supported
  if (stored._version !== 1) return DEFAULT_UI_STATE;

  // Validate activeTab
  const validTabs = [
    "overview", "currencies", "uniques", "exchange",
    "arbitrage", "flips", "forecast", "portfolio",
    "graph", "watchlist",
  ];
  const activeTab = validTabs.includes(stored.activeTab as string)
    ? (stored.activeTab as string)
    : DEFAULT_UI_STATE.activeTab;

  // Validate exchange sub-object
  const rawExchange = stored.exchange as Record<string, unknown> | undefined;
  const exchange = {
    viewMode: rawExchange?.viewMode === "cards" ? "cards" as const : "table" as const,
    sortField: typeof rawExchange?.sortField === "string" ? rawExchange.sortField : DEFAULT_UI_STATE.exchange.sortField,
    sortDirection: rawExchange?.sortDirection === "asc" ? "asc" as const : "desc" as const,
    activeFilter:
      rawExchange?.activeFilter === "topVolume" || rawExchange?.activeFilter === "favorites"
        ? (rawExchange.activeFilter as "topVolume" | "favorites")
        : "all" as const,
    favorites: Array.isArray(rawExchange?.favorites) ? rawExchange.favorites as string[] : [],
  };

  // Validate league
  const league = typeof stored.league === "string" && stored.league
    ? stored.league
    : DEFAULT_UI_STATE.league;

  return { _version: 1, activeTab, exchange, league };
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
    const next = current.includes(pairId)
      ? current.filter((id) => id !== pairId)
      : [...current, pairId];
    const uiState = {
      ...get().uiState,
      exchange: { ...get().uiState.exchange, favorites: next },
    };
    set({ uiState });
    debouncedSaveToStorage(UI_STATE_KEY, uiState);
  },

  setLeague: (league) => {
    const uiState = { ...get().uiState, league };
    set({ uiState });
    debouncedSaveToStorage(UI_STATE_KEY, uiState);
  },
}));
