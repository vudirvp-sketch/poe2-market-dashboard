// ============================================================================
// Integration Tests — Store Rehydration with localStorage
// Verifies that Zustand store correctly loads persisted data from
// localStorage when rehydrate() is called, simulating the real
// StoreRehydrator component behavior.
// ============================================================================
import { useDashboardStore } from "@/lib/store";
import { renderWithProviders, screen, act } from "./test-utils";

// ---------------------------------------------------------------------------
// Helper component that reads store state
// ---------------------------------------------------------------------------
function StoreStateReader() {
  const favorites = useDashboardStore((s) => s.favorites);
  const alerts = useDashboardStore((s) => s.alerts);
  const pairComparisonIds = useDashboardStore((s) => s.pairComparisonIds);
  const hydrated = useDashboardStore((s) => s._hydrated);

  return (
    <div>
      <span data-testid="hydrated">{String(hydrated)}</span>
      <span data-testid="favorites-count">{favorites.length}</span>
      <span data-testid="favorites">{favorites.join(",")}</span>
      <span data-testid="alerts-count">{alerts.length}</span>
      <span data-testid="pairs-count">{pairComparisonIds.length}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Store rehydration integration", () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    const store = useDashboardStore.getState();
    store.favorites = [];
    store.comparisonIds = [];
    store.pairComparisonIds = [];
    store.alerts = [];
    store._hydrated = false;
  });

  describe("empty localStorage", () => {
    it("starts with empty state before rehydration", () => {
      renderWithProviders(<StoreStateReader />);

      expect(screen.getByTestId("hydrated")).toHaveTextContent("false");
      expect(screen.getByTestId("favorites-count")).toHaveTextContent("0");
      expect(screen.getByTestId("alerts-count")).toHaveTextContent("0");
    });

    it("rehydrates with empty arrays when localStorage has no data", async () => {
      renderWithProviders(<StoreStateReader />);

      // Manually trigger rehydration (simulates StoreRehydrator's useEffect)
      act(() => {
        useDashboardStore.getState().rehydrate();
      });

      expect(screen.getByTestId("hydrated")).toHaveTextContent("true");
      expect(screen.getByTestId("favorites-count")).toHaveTextContent("0");
      expect(screen.getByTestId("alerts-count")).toHaveTextContent("0");
    });
  });

  describe("pre-seeded localStorage — favorites", () => {
    it("loads favorites from localStorage on rehydrate", () => {
      // Pre-seed localStorage with favorites
      window.localStorage.setItem(
        "poe2-favorites",
        JSON.stringify(["chaos-orb", "divine-orb", "exalted-orb"])
      );

      renderWithProviders(<StoreStateReader />);

      act(() => {
        useDashboardStore.getState().rehydrate();
      });

      expect(screen.getByTestId("hydrated")).toHaveTextContent("true");
      expect(screen.getByTestId("favorites-count")).toHaveTextContent("3");
      expect(screen.getByTestId("favorites")).toHaveTextContent(
        "chaos-orb,divine-orb,exalted-orb"
      );
    });
  });

  describe("pre-seeded localStorage — price alerts", () => {
    it("loads price alerts from localStorage on rehydrate", () => {
      const testAlerts = [
        {
          itemId: "chaos-orb",
          itemName: "Chaos Orb",
          condition: "above" as const,
          threshold: 150,
          enabled: true,
        },
        {
          itemId: "divine-orb",
          itemName: "Divine Orb",
          condition: "below" as const,
          threshold: 50,
          enabled: false,
        },
      ];
      window.localStorage.setItem(
        "poe2-alerts",
        JSON.stringify(testAlerts)
      );

      renderWithProviders(<StoreStateReader />);

      act(() => {
        useDashboardStore.getState().rehydrate();
      });

      expect(screen.getByTestId("hydrated")).toHaveTextContent("true");
      expect(screen.getByTestId("alerts-count")).toHaveTextContent("2");
    });
  });

  describe("pre-seeded localStorage — pair comparisons", () => {
    it("loads pair comparisons from localStorage on rehydrate", () => {
      const testPairs = [
        {
          currency1Id: "chaos",
          currency2Id: "divine",
          label: "Chaos / Divine",
        },
      ];
      window.localStorage.setItem(
        "poe2-pair-comparison",
        JSON.stringify(testPairs)
      );

      renderWithProviders(<StoreStateReader />);

      act(() => {
        useDashboardStore.getState().rehydrate();
      });

      expect(screen.getByTestId("hydrated")).toHaveTextContent("true");
      expect(screen.getByTestId("pairs-count")).toHaveTextContent("1");
    });
  });

  describe("corrupted localStorage data", () => {
    it("falls back gracefully when localStorage has invalid JSON", () => {
      window.localStorage.setItem("poe2-favorites", "not-valid-json{{{");

      renderWithProviders(<StoreStateReader />);

      act(() => {
        useDashboardStore.getState().rehydrate();
      });

      // Should not crash — falls back to empty array
      expect(screen.getByTestId("hydrated")).toHaveTextContent("true");
      expect(screen.getByTestId("favorites-count")).toHaveTextContent("0");
    });
  });

  describe("persistence after store operations", () => {
    it("persists new favorites to localStorage", () => {
      renderWithProviders(<StoreStateReader />);

      act(() => {
        useDashboardStore.getState().addFavorite("mirror-of-kalandra");
      });

      // Verify localStorage was updated
      const stored = JSON.parse(
        window.localStorage.getItem("poe2-favorites") ?? "[]"
      );
      expect(stored).toContain("mirror-of-kalandra");
    });

    it("persists new alerts to localStorage", () => {
      renderWithProviders(<StoreStateReader />);

      act(() => {
        useDashboardStore.getState().addAlert({
          itemId: "chaos-orb",
          itemName: "Chaos Orb",
          condition: "above",
          threshold: 200,
          enabled: true,
        });
      });

      const stored = JSON.parse(
        window.localStorage.getItem("poe2-alerts") ?? "[]"
      );
      expect(stored).toHaveLength(1);
      expect(stored[0].itemId).toBe("chaos-orb");
    });
  });
});
