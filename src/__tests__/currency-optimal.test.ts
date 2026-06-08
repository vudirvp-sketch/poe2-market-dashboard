// ============================================================================
// Unit tests for lib/currency-optimal.ts
//
// Tests for:
//   - ITEM_CATEGORIES set
//   - isItemCategory() helper
//   - selectAnchor()
//   - effectiveAnchorPrice()
//   - findOptimalPayment()
//   - detectCrossRateFlips()
//   - buildRelativePriceMap()
//   - crossRate()
// ============================================================================

import {
  ITEM_CATEGORIES,
  isItemCategory,
  selectAnchor,
  effectiveAnchorPrice,
  findOptimalPayment,
  detectCrossRateFlips,
  buildRelativePriceMap,
  crossRate,
  ANCHOR_CURRENCIES,
  type AnchorCurrency,
} from "@/lib/currency-optimal";
import type { ExchangePair } from "@/lib/types";

// ============================================================================
// 1. ITEM_CATEGORIES — set contents
// ============================================================================

describe("ITEM_CATEGORIES", () => {
  it("contains ritual category", () => {
    expect(ITEM_CATEGORIES.has("ritual")).toBe(true);
  });

  it("contains ultimatum category", () => {
    expect(ITEM_CATEGORIES.has("ultimatum")).toBe(true);
  });

  it("contains idol category", () => {
    expect(ITEM_CATEGORIES.has("idol")).toBe(true);
  });

  it("contains vaultkeys category", () => {
    expect(ITEM_CATEGORIES.has("vaultkeys")).toBe(true);
  });

  it("contains delirium category", () => {
    expect(ITEM_CATEGORIES.has("delirium")).toBe(true);
  });

  it("does not contain currency category", () => {
    expect(ITEM_CATEGORIES.has("currency")).toBe(false);
  });

  it("does not contain fragments category", () => {
    expect(ITEM_CATEGORIES.has("fragments")).toBe(false);
  });

  it("has exactly 5 categories", () => {
    expect(ITEM_CATEGORIES.size).toBe(5);
  });
});

// ============================================================================
// 2. isItemCategory — helper function
// ============================================================================

describe("isItemCategory", () => {
  it("returns true for ritual", () => {
    expect(isItemCategory("ritual")).toBe(true);
  });

  it("returns true for ultimatum", () => {
    expect(isItemCategory("ultimatum")).toBe(true);
  });

  it("returns true for idol", () => {
    expect(isItemCategory("idol")).toBe(true);
  });

  it("returns true for vaultkeys", () => {
    expect(isItemCategory("vaultkeys")).toBe(true);
  });

  it("returns true for delirium", () => {
    expect(isItemCategory("delirium")).toBe(true);
  });

  it("returns false for currency", () => {
    expect(isItemCategory("currency")).toBe(false);
  });

  it("returns false for unknown category", () => {
    expect(isItemCategory("unknown_cat")).toBe(false);
  });

  it("returns false for null", () => {
    expect(isItemCategory(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isItemCategory(undefined)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isItemCategory("")).toBe(false);
  });
});

// ============================================================================
// 3. selectAnchor — anchor currency selection
// ============================================================================

describe("selectAnchor", () => {
  it("prefers mirror when available", () => {
    const prices = new Map([
      ["mirror", 15000],
      ["divine", 150],
      ["exalted", 1],
      ["chaos", 0.1],
    ]);
    expect(selectAnchor(prices)).toBe("mirror");
  });

  it("prefers divine when mirror is absent", () => {
    const prices = new Map([
      ["divine", 150],
      ["exalted", 1],
    ]);
    expect(selectAnchor(prices)).toBe("divine");
  });

  it("returns exalted as ultimate fallback", () => {
    expect(selectAnchor(new Map())).toBe("exalted");
  });
});

// ============================================================================
// 4. effectiveAnchorPrice — computation
// ============================================================================

describe("effectiveAnchorPrice", () => {
  it("computes correct effective price", () => {
    // 3 Divine at relPrice 150, anchor (Exalted) relPrice 1
    // effective = 3 * (150/1) = 450
    expect(effectiveAnchorPrice(3.0, 150.0, 1.0)).toBeCloseTo(450.0);
  });

  it("returns Infinity for zero anchor price", () => {
    expect(effectiveAnchorPrice(1.0, 150.0, 0)).toBe(Infinity);
  });

  it("returns Infinity for zero currency price", () => {
    expect(effectiveAnchorPrice(1.0, 0, 1.0)).toBe(Infinity);
  });
});

// ============================================================================
// 5. findOptimalPayment — item-aware scenarios
// ============================================================================

describe("findOptimalPayment", () => {
  it("finds cheapest payment for ritual omen", () => {
    const options = [
      {
        currencyId: "exalted",
        currencyName: "Exalted Orb",
        priceInCurrency: 0.5,
        relativePrice: 1.0,
      },
      {
        currencyId: "chaos",
        currencyName: "Chaos Orb",
        priceInCurrency: 8.0,
        relativePrice: 0.1,
      },
    ];
    const result = findOptimalPayment(options, 1.0);
    expect(result).not.toBeNull();
    expect(result!.bestCurrencyId).toBe("exalted");
    expect(result!.worstCurrencyId).toBe("chaos");
    expect(result!.savingsPct).toBeGreaterThan(0);
  });

  it("returns null for single option", () => {
    const options = [
      {
        currencyId: "exalted",
        currencyName: "Exalted Orb",
        priceInCurrency: 1.0,
        relativePrice: 1.0,
      },
    ];
    expect(findOptimalPayment(options, 1.0)).toBeNull();
  });

  it("detects divine premium on items", () => {
    const options = [
      {
        currencyId: "exalted",
        currencyName: "Exalted Orb",
        priceInCurrency: 1.0,
        relativePrice: 1.0,
      },
      {
        currencyId: "divine",
        currencyName: "Divine Orb",
        priceInCurrency: 0.008,
        relativePrice: 150.0,
      },
    ];
    const result = findOptimalPayment(options, 1.0);
    expect(result).not.toBeNull();
    expect(result!.bestCurrencyId).toBe("exalted");
  });
});

// ============================================================================
// 6. buildRelativePriceMap — utility
// ============================================================================

describe("buildRelativePriceMap", () => {
  it("builds map from exchange pairs", () => {
    const pairs: ExchangePair[] = [
      {
        id: "p1",
        currency1Id: "exalted",
        currency1Name: "Exalted Orb",
        currency1IconUrl: null,
        currency1ItemId: 1,
        currency1CategoryApiId: "currency",
        currency2Id: "chaos",
        currency2Name: "Chaos Orb",
        currency2IconUrl: null,
        currency2ItemId: 2,
        currency2CategoryApiId: "currency",
        price: 10,
        relativePrice: 1.0,
        currency2RelativePrice: 0.1,
        volume: 5000,
        change: null,
        changePercent: null,
        sevenDayChange: null,
        sevenDayChangePercent: null,
        history: null,
      },
    ];
    const map = buildRelativePriceMap(pairs);
    expect(map.get("exalted")).toBe(1.0);
    expect(map.get("chaos")).toBe(0.1);
  });
});

// ============================================================================
// 7. crossRate — utility
// ============================================================================

describe("crossRate", () => {
  it("computes cross rate between two currencies", () => {
    expect(crossRate(1.0, 0.1)).toBeCloseTo(10.0);
  });

  it("returns null for null inputs", () => {
    expect(crossRate(null, 0.1)).toBeNull();
    expect(crossRate(1.0, null)).toBeNull();
  });

  it("returns null for zero denominator", () => {
    expect(crossRate(1.0, 0)).toBeNull();
  });
});
