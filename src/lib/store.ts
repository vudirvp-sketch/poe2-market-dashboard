// ============================================================================
// PoE2 Market Dashboard — Zustand Store (Favorites + Comparison + Alerts)
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
}

// ---------- localStorage helpers ----------
function loadFavorites(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem("poe2-favorites");
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveFavorites(ids: string[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem("poe2-favorites", JSON.stringify(ids));
  } catch {
    // ignore
  }
}

function loadAlerts(): PriceAlert[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem("poe2-alerts");
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveAlerts(alerts: PriceAlert[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem("poe2-alerts", JSON.stringify(alerts));
  } catch {
    // ignore
  }
}

function loadPairComparison(): PairComparisonId[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem("poe2-pair-comparison");
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function savePairComparison(pairs: PairComparisonId[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem("poe2-pair-comparison", JSON.stringify(pairs));
  } catch {
    // ignore
  }
}

export const useDashboardStore = create<DashboardStore>((set, get) => ({
  favorites: loadFavorites(),

  addFavorite: (id) => {
    const favs = get().favorites;
    if (!favs.includes(id)) {
      const next = [...favs, id];
      set({ favorites: next });
      saveFavorites(next);
    }
  },

  removeFavorite: (id) => {
    const next = get().favorites.filter((f) => f !== id);
    set({ favorites: next });
    saveFavorites(next);
  },

  isFavorite: (id) => get().favorites.includes(id),

  toggleFavorite: (id) => {
    const favs = get().favorites;
    if (favs.includes(id)) {
      const next = favs.filter((f) => f !== id);
      set({ favorites: next });
      saveFavorites(next);
    } else {
      const next = [...favs, id];
      set({ favorites: next });
      saveFavorites(next);
    }
  },

  comparisonIds: [],

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
  pairComparisonIds: loadPairComparison(),

  addPairToComparison: (pair) => {
    const pairs = get().pairComparisonIds;
    const key = `${pair.currency1Id}_${pair.currency2Id}`;
    const exists = pairs.some(
      (p) => `${p.currency1Id}_${p.currency2Id}` === key
    );
    if (!exists && pairs.length < 4) {
      const next = [...pairs, pair];
      set({ pairComparisonIds: next });
      savePairComparison(next);
    }
  },

  removePairFromComparison: (key) => {
    const next = get().pairComparisonIds.filter(
      (p) => `${p.currency1Id}_${p.currency2Id}` !== key
    );
    set({ pairComparisonIds: next });
    savePairComparison(next);
  },

  clearPairComparison: () => {
    set({ pairComparisonIds: [] });
    savePairComparison([]);
  },

  // ---- Price Alerts ----
  alerts: loadAlerts(),

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
    saveAlerts(next);
  },

  removeAlert: (itemId) => {
    const next = get().alerts.filter((a) => a.itemId !== itemId);
    set({ alerts: next });
    saveAlerts(next);
  },

  updateAlert: (itemId, updates) => {
    const next = get().alerts.map((a) =>
      a.itemId === itemId ? { ...a, ...updates } : a
    );
    set({ alerts: next });
    saveAlerts(next);
  },

  getAlertsForItem: (itemId) => get().alerts.filter((a) => a.itemId === itemId),
}));
