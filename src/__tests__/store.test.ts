// ============================================================================
// Unit tests for lib/store.ts — Zustand store (favorites, comparison, alerts)
// ============================================================================
import { useDashboardStore } from "@/lib/store";

describe("DashboardStore", () => {
  // Reset store between tests
  beforeEach(() => {
    const store = useDashboardStore.getState();
    store.favorites = [];
    store.comparisonIds = [];
    store.pairComparisonIds = [];
    store.alerts = [];
  });

  describe("Favorites", () => {
    it("adds a favorite", () => {
      const store = useDashboardStore.getState();
      store.addFavorite("item-1");
      expect(store.favorites).toContain("item-1");
    });

    it("does not add duplicate favorites", () => {
      const store = useDashboardStore.getState();
      store.addFavorite("item-1");
      store.addFavorite("item-1");
      expect(store.favorites.filter((f) => f === "item-1")).toHaveLength(1);
    });

    it("removes a favorite", () => {
      const store = useDashboardStore.getState();
      store.addFavorite("item-1");
      store.removeFavorite("item-1");
      expect(store.favorites).not.toContain("item-1");
    });

    it("checks if item is favorite", () => {
      const store = useDashboardStore.getState();
      expect(store.isFavorite("item-1")).toBe(false);
      store.addFavorite("item-1");
      expect(store.isFavorite("item-1")).toBe(true);
    });

    it("toggles favorite", () => {
      const store = useDashboardStore.getState();
      store.toggleFavorite("item-1");
      expect(store.isFavorite("item-1")).toBe(true);
      store.toggleFavorite("item-1");
      expect(store.isFavorite("item-1")).toBe(false);
    });
  });

  describe("Comparison", () => {
    it("adds items to comparison", () => {
      const store = useDashboardStore.getState();
      store.addToComparison("item-1");
      store.addToComparison("item-2");
      expect(store.comparisonIds).toEqual(["item-1", "item-2"]);
    });

    it("limits comparison to 4 items", () => {
      const store = useDashboardStore.getState();
      store.addToComparison("item-1");
      store.addToComparison("item-2");
      store.addToComparison("item-3");
      store.addToComparison("item-4");
      store.addToComparison("item-5"); // should be ignored
      expect(store.comparisonIds).toHaveLength(4);
    });

    it("does not add duplicates to comparison", () => {
      const store = useDashboardStore.getState();
      store.addToComparison("item-1");
      store.addToComparison("item-1");
      expect(store.comparisonIds).toHaveLength(1);
    });

    it("removes item from comparison", () => {
      const store = useDashboardStore.getState();
      store.addToComparison("item-1");
      store.addToComparison("item-2");
      store.removeFromComparison("item-1");
      expect(store.comparisonIds).toEqual(["item-2"]);
    });

    it("clears all comparisons", () => {
      const store = useDashboardStore.getState();
      store.addToComparison("item-1");
      store.addToComparison("item-2");
      store.clearComparison();
      expect(store.comparisonIds).toEqual([]);
    });

    it("checks if item is in comparison", () => {
      const store = useDashboardStore.getState();
      expect(store.isInComparison("item-1")).toBe(false);
      store.addToComparison("item-1");
      expect(store.isInComparison("item-1")).toBe(true);
    });
  });

  describe("Price Alerts", () => {
    it("adds a price alert", () => {
      const store = useDashboardStore.getState();
      store.addAlert({
        itemId: "item-1",
        itemName: "Chaos Orb",
        condition: "above",
        threshold: 100,
        enabled: true,
      });
      expect(store.alerts).toHaveLength(1);
      expect(store.alerts[0].itemId).toBe("item-1");
    });

    it("replaces alert for same item+condition", () => {
      const store = useDashboardStore.getState();
      store.addAlert({
        itemId: "item-1",
        itemName: "Chaos Orb",
        condition: "above",
        threshold: 100,
        enabled: true,
      });
      store.addAlert({
        itemId: "item-1",
        itemName: "Chaos Orb",
        condition: "above",
        threshold: 200,
        enabled: true,
      });
      expect(store.alerts).toHaveLength(1);
      expect(store.alerts[0].threshold).toBe(200);
    });

    it("allows separate alerts for above and below", () => {
      const store = useDashboardStore.getState();
      store.addAlert({
        itemId: "item-1",
        itemName: "Chaos Orb",
        condition: "above",
        threshold: 100,
        enabled: true,
      });
      store.addAlert({
        itemId: "item-1",
        itemName: "Chaos Orb",
        condition: "below",
        threshold: 50,
        enabled: true,
      });
      expect(store.alerts).toHaveLength(2);
    });

    it("removes alerts by itemId", () => {
      const store = useDashboardStore.getState();
      store.addAlert({
        itemId: "item-1",
        itemName: "Chaos Orb",
        condition: "above",
        threshold: 100,
        enabled: true,
      });
      store.removeAlert("item-1");
      expect(store.alerts).toHaveLength(0);
    });

    it("updates alert properties", () => {
      const store = useDashboardStore.getState();
      store.addAlert({
        itemId: "item-1",
        itemName: "Chaos Orb",
        condition: "above",
        threshold: 100,
        enabled: true,
      });
      store.updateAlert("item-1", { enabled: false, threshold: 150 });
      expect(store.alerts[0].enabled).toBe(false);
      expect(store.alerts[0].threshold).toBe(150);
    });

    it("gets alerts for specific item", () => {
      const store = useDashboardStore.getState();
      store.addAlert({
        itemId: "item-1",
        itemName: "Chaos Orb",
        condition: "above",
        threshold: 100,
        enabled: true,
      });
      store.addAlert({
        itemId: "item-2",
        itemName: "Divine Orb",
        condition: "above",
        threshold: 50,
        enabled: true,
      });
      const alerts = store.getAlertsForItem("item-1");
      expect(alerts).toHaveLength(1);
      expect(alerts[0].itemName).toBe("Chaos Orb");
    });
  });

  describe("Pair Comparison", () => {
    it("adds pair to comparison", () => {
      const store = useDashboardStore.getState();
      store.addPairToComparison({
        currency1Id: "c1",
        currency2Id: "c2",
        label: "Chaos / Divine",
      });
      expect(store.pairComparisonIds).toHaveLength(1);
    });

    it("does not add duplicate pairs", () => {
      const store = useDashboardStore.getState();
      store.addPairToComparison({
        currency1Id: "c1",
        currency2Id: "c2",
        label: "Chaos / Divine",
      });
      store.addPairToComparison({
        currency1Id: "c1",
        currency2Id: "c2",
        label: "Chaos / Divine",
      });
      expect(store.pairComparisonIds).toHaveLength(1);
    });

    it("removes pair from comparison by key", () => {
      const store = useDashboardStore.getState();
      store.addPairToComparison({
        currency1Id: "c1",
        currency2Id: "c2",
        label: "Chaos / Divine",
      });
      store.removePairFromComparison("c1_c2");
      expect(store.pairComparisonIds).toHaveLength(0);
    });
  });
});
