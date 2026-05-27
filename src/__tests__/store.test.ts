// ============================================================================
// Unit tests for lib/store.ts — Zustand store (favorites, comparison, alerts)
// ============================================================================
// NOTE: In Zustand v5, getState() returns a snapshot. After calling set(),
// you must call getState() again to see updated state. The old reference
// does NOT reflect mutations made via set().
// ============================================================================
import { useDashboardStore } from "@/lib/store";

describe("DashboardStore", () => {
  // Reset store between tests by using Zustand's setState to replace state
  beforeEach(() => {
    useDashboardStore.setState({
      favorites: [],
      comparisonIds: [],
      pairComparisonIds: [],
      alerts: [],
      _hydrated: false,
    });
  });

  describe("Favorites", () => {
    it("adds a favorite", () => {
      useDashboardStore.getState().addFavorite("item-1");
      expect(useDashboardStore.getState().favorites).toContain("item-1");
    });

    it("does not add duplicate favorites", () => {
      useDashboardStore.getState().addFavorite("item-1");
      useDashboardStore.getState().addFavorite("item-1");
      expect(
        useDashboardStore.getState().favorites.filter((f) => f === "item-1")
      ).toHaveLength(1);
    });

    it("removes a favorite", () => {
      useDashboardStore.getState().addFavorite("item-1");
      useDashboardStore.getState().removeFavorite("item-1");
      expect(useDashboardStore.getState().favorites).not.toContain("item-1");
    });

    it("checks if item is favorite", () => {
      expect(useDashboardStore.getState().isFavorite("item-1")).toBe(false);
      useDashboardStore.getState().addFavorite("item-1");
      expect(useDashboardStore.getState().isFavorite("item-1")).toBe(true);
    });

    it("toggles favorite", () => {
      useDashboardStore.getState().toggleFavorite("item-1");
      expect(useDashboardStore.getState().isFavorite("item-1")).toBe(true);
      useDashboardStore.getState().toggleFavorite("item-1");
      expect(useDashboardStore.getState().isFavorite("item-1")).toBe(false);
    });
  });

  describe("Comparison", () => {
    it("adds items to comparison", () => {
      useDashboardStore.getState().addToComparison("item-1");
      useDashboardStore.getState().addToComparison("item-2");
      expect(useDashboardStore.getState().comparisonIds).toEqual([
        "item-1",
        "item-2",
      ]);
    });

    it("limits comparison to 4 items", () => {
      useDashboardStore.getState().addToComparison("item-1");
      useDashboardStore.getState().addToComparison("item-2");
      useDashboardStore.getState().addToComparison("item-3");
      useDashboardStore.getState().addToComparison("item-4");
      useDashboardStore.getState().addToComparison("item-5"); // should be ignored
      expect(useDashboardStore.getState().comparisonIds).toHaveLength(4);
    });

    it("does not add duplicates to comparison", () => {
      useDashboardStore.getState().addToComparison("item-1");
      useDashboardStore.getState().addToComparison("item-1");
      expect(useDashboardStore.getState().comparisonIds).toHaveLength(1);
    });

    it("removes item from comparison", () => {
      useDashboardStore.getState().addToComparison("item-1");
      useDashboardStore.getState().addToComparison("item-2");
      useDashboardStore.getState().removeFromComparison("item-1");
      expect(useDashboardStore.getState().comparisonIds).toEqual(["item-2"]);
    });

    it("clears all comparisons", () => {
      useDashboardStore.getState().addToComparison("item-1");
      useDashboardStore.getState().addToComparison("item-2");
      useDashboardStore.getState().clearComparison();
      expect(useDashboardStore.getState().comparisonIds).toEqual([]);
    });

    it("checks if item is in comparison", () => {
      expect(
        useDashboardStore.getState().isInComparison("item-1")
      ).toBe(false);
      useDashboardStore.getState().addToComparison("item-1");
      expect(useDashboardStore.getState().isInComparison("item-1")).toBe(true);
    });
  });

  describe("Price Alerts", () => {
    it("adds a price alert", () => {
      useDashboardStore.getState().addAlert({
        itemId: "item-1",
        itemName: "Chaos Orb",
        condition: "above",
        threshold: 100,
        enabled: true,
      });
      expect(useDashboardStore.getState().alerts).toHaveLength(1);
      expect(useDashboardStore.getState().alerts[0].itemId).toBe("item-1");
    });

    it("replaces alert for same item+condition", () => {
      useDashboardStore.getState().addAlert({
        itemId: "item-1",
        itemName: "Chaos Orb",
        condition: "above",
        threshold: 100,
        enabled: true,
      });
      useDashboardStore.getState().addAlert({
        itemId: "item-1",
        itemName: "Chaos Orb",
        condition: "above",
        threshold: 200,
        enabled: true,
      });
      expect(useDashboardStore.getState().alerts).toHaveLength(1);
      expect(useDashboardStore.getState().alerts[0].threshold).toBe(200);
    });

    it("allows separate alerts for above and below", () => {
      useDashboardStore.getState().addAlert({
        itemId: "item-1",
        itemName: "Chaos Orb",
        condition: "above",
        threshold: 100,
        enabled: true,
      });
      useDashboardStore.getState().addAlert({
        itemId: "item-1",
        itemName: "Chaos Orb",
        condition: "below",
        threshold: 50,
        enabled: true,
      });
      expect(useDashboardStore.getState().alerts).toHaveLength(2);
    });

    it("removes alerts by itemId", () => {
      useDashboardStore.getState().addAlert({
        itemId: "item-1",
        itemName: "Chaos Orb",
        condition: "above",
        threshold: 100,
        enabled: true,
      });
      useDashboardStore.getState().removeAlert("item-1");
      expect(useDashboardStore.getState().alerts).toHaveLength(0);
    });

    it("updates alert properties", () => {
      useDashboardStore.getState().addAlert({
        itemId: "item-1",
        itemName: "Chaos Orb",
        condition: "above",
        threshold: 100,
        enabled: true,
      });
      useDashboardStore
        .getState()
        .updateAlert("item-1", { enabled: false, threshold: 150 });
      const alert = useDashboardStore.getState().alerts[0];
      expect(alert.enabled).toBe(false);
      expect(alert.threshold).toBe(150);
    });

    it("gets alerts for specific item", () => {
      useDashboardStore.getState().addAlert({
        itemId: "item-1",
        itemName: "Chaos Orb",
        condition: "above",
        threshold: 100,
        enabled: true,
      });
      useDashboardStore.getState().addAlert({
        itemId: "item-2",
        itemName: "Divine Orb",
        condition: "above",
        threshold: 50,
        enabled: true,
      });
      const alerts = useDashboardStore.getState().getAlertsForItem("item-1");
      expect(alerts).toHaveLength(1);
      expect(alerts[0].itemName).toBe("Chaos Orb");
    });
  });

  describe("Pair Comparison", () => {
    it("adds pair to comparison", () => {
      useDashboardStore.getState().addPairToComparison({
        currency1Id: "c1",
        currency2Id: "c2",
        label: "Chaos / Divine",
      });
      expect(useDashboardStore.getState().pairComparisonIds).toHaveLength(1);
    });

    it("does not add duplicate pairs", () => {
      useDashboardStore.getState().addPairToComparison({
        currency1Id: "c1",
        currency2Id: "c2",
        label: "Chaos / Divine",
      });
      useDashboardStore.getState().addPairToComparison({
        currency1Id: "c1",
        currency2Id: "c2",
        label: "Chaos / Divine",
      });
      expect(useDashboardStore.getState().pairComparisonIds).toHaveLength(1);
    });

    it("removes pair from comparison by key", () => {
      useDashboardStore.getState().addPairToComparison({
        currency1Id: "c1",
        currency2Id: "c2",
        label: "Chaos / Divine",
      });
      useDashboardStore.getState().removePairFromComparison("c1_c2");
      expect(useDashboardStore.getState().pairComparisonIds).toHaveLength(0);
    });
  });
});
