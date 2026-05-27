// ============================================================================
// Unit tests for lib/poe2api.ts — API functions and caching
// ============================================================================
import {
  Realm,
  League,
  PoeItem,
  ExchangePair,
  ItemCategory,
  PaginatedResponse,
  ReferenceCurrency,
  SnapshotHistoryPoint,
} from "@/lib/poe2api";

describe("API Types", () => {
  it("Realm type compiles with required fields", () => {
    const realm: Realm = {
      name: "pc",
      displayName: "PC",
    };
    expect(realm.name).toBe("pc");
  });

  it("League type compiles with required fields", () => {
    const league: League = {
      name: "Standard",
      displayName: "Standard",
      startAt: null,
      endAt: null,
      active: true,
    };
    expect(league.active).toBe(true);
  });

  it("PoeItem type compiles with all fields", () => {
    const item: PoeItem = {
      id: "1",
      apiId: "api-1",
      name: "Chaos Orb",
      type: "Currency",
      category: "currency",
      iconUrl: null,
      price: 1,
      priceChaos: 1,
      relativePrice: 1,
      change: 0.05,
      changePercent: 5.0,
      volume: 100000,
      sevenDayPriceChange: 0.1,
      sevenDayPriceChangePercent: 10.0,
      history: null,
      dailyStats: null,
      lowConfidence: false,
      listingCount: 500,
      baseType: null,
      links: null,
      variant: null,
      levelRequired: null,
    };
    expect(item.name).toBe("Chaos Orb");
    expect(item.volume).toBe(100000);
  });

  it("ExchangePair type compiles correctly", () => {
    const pair: ExchangePair = {
      id: "pair-1",
      currency1Id: "c1",
      currency1Name: "Chaos Orb",
      currency1IconUrl: null,
      currency2Id: "c2",
      currency2Name: "Divine Orb",
      currency2IconUrl: null,
      price: 0.005,
      relativePrice: 0.005,
      volume: 5000,
      change: -0.001,
      changePercent: -15.0,
      history: null,
    };
    expect(pair.currency1Name).toBe("Chaos Orb");
  });

  it("PaginatedResponse type works generically", () => {
    const response: PaginatedResponse<PoeItem> = {
      items: [],
      page: 1,
      perPage: 50,
      totalItems: 0,
      totalPages: 0,
    };
    expect(response.items).toHaveLength(0);
  });
});
