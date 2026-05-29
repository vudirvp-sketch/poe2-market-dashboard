// ============================================================================
// PoE2 Market Dashboard — Zustand Store (Favorites + Comparison + Alerts)
//
// v0.5 FIX: Deferred localStorage reads to avoid hydration mismatch.
// On SSR and first client render, state starts with empty/default values.
// After mount, a `rehydrate()` call loads from localStorage.
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

  // Hydration
  _hydrated: boolean;
  rehydrate: () => void;
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

export const useDashboardStore = create<DashboardStore>((set, get) => ({
  // Start with empty defaults — prevents hydration mismatch
  favorites: [],
  comparisonIds: [],
  pairComparisonIds: [],
  alerts: [],
  _hydrated: false,

  /**
   * Call this once after mount (in a useEffect) to load persisted data.
   * This avoids hydration mismatches because SSR always renders with empty state.
   */
  rehydrate: () => {
    const favorites = loadFromStorage<string[]>("poe2-favorites", []);
    const pairComparisonIds = loadFromStorage<PairComparisonId[]>("poe2-pair-comparison", []);
    const alerts = loadFromStorage<PriceAlert[]>("poe2-alerts", []);
    set({ favorites, pairComparisonIds, alerts, _hydrated: true });
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
}));
