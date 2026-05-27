// ============================================================================
// PoE2 Market Dashboard — Zustand Store (Favorites + Comparison)
// ============================================================================
import { create } from "zustand";

interface DashboardStore {
  // Favorites / Watchlist
  favorites: string[]; // item IDs
  addFavorite: (id: string) => void;
  removeFavorite: (id: string) => void;
  isFavorite: (id: string) => boolean;
  toggleFavorite: (id: string) => void;

  // Comparison
  comparisonIds: string[];
  addToComparison: (id: string) => void;
  removeFromComparison: (id: string) => void;
  clearComparison: () => void;
  isInComparison: (id: string) => boolean;
}

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
}));
