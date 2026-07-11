// ============================================================================
// Unit tests for the Gold Map ROI Calculator (P10 Phase 1 MVP, iter 127).
//
// Coverage:
//   - Pure functions (computeRoi, pickBestCycleEndingInDiv, goldRateAgeDays,
//     loadInputsFromLocalStorage, saveInputsToLocalStorage, defaultInputs,
//     recommendationBadgeClass, recommendationLabelKey)
//   - Edge cases: map_cost=0 (free map), gold_amount=0, no cycles,
//     stale gold rate, invalid gold_per_div bounds
//   - Recommendation thresholds (49% → MARGINAL, 50% → FARM, 149% → FARM,
//     150% → STRONG_FARM)
//   - localStorage persistence round-trip
// ============================================================================
import {
  computeRoi,
  pickBestCycleEndingInDiv,
  goldRateAgeDays,
  loadInputsFromLocalStorage,
  saveInputsToLocalStorage,
  defaultInputs,
  recommendationLabelKey,
  recommendationBadgeClass,
  DEFAULT_GOLD_AMOUNT,
  DEFAULT_MAP_COST,
  DEFAULT_GOLD_PER_DIV,
  ROI_THRESHOLD_MARGINAL,
  ROI_THRESHOLD_STRONG,
  GOLD_RATE_STALENESS_DAYS,
  type GoldMapRoiInputs,
} from "@/components/dashboard/gold-map-roi-calculator";
import type { TriangularCycle } from "@/lib/types";

// ---------------------------------------------------------------------------
// Helper: build a TriangularCycle
// ---------------------------------------------------------------------------

function makeCycle(overrides: Partial<TriangularCycle> = {}): TriangularCycle {
  return {
    cycle: ["divine", "exalted", "mirror", "divine"],
    netProfitPct: 5.0,
    stepRates: [0.5, 2.0, 0.4],
    totalVolume: 1000,
    confidence: 0.9,
    minStartingAmount: 1,
    quantizedProfitPct: 4.5,
    continuousProfitPct: 5.0,
    integerSimulation: [1, 2, 5, 1],
    ...overrides,
  };
}

function makeInputs(overrides: Partial<GoldMapRoiInputs> = {}): GoldMapRoiInputs {
  return {
    goldAmount: DEFAULT_GOLD_AMOUNT,
    mapCost: DEFAULT_MAP_COST,
    goldPerDiv: DEFAULT_GOLD_PER_DIV,
    goldPerDivTimestamp: Date.now(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// defaultInputs
// ---------------------------------------------------------------------------

describe("defaultInputs", () => {
  it("returns the documented defaults", () => {
    const now = 1_000_000;
    const inputs = defaultInputs(now);
    expect(inputs.goldAmount).toBe(500_000);
    expect(inputs.mapCost).toBe(2.0);
    expect(inputs.goldPerDiv).toBe(100_000);
    expect(inputs.goldPerDivTimestamp).toBe(now);
  });

  it("uses Date.now() when no argument supplied", () => {
    const before = Date.now();
    const inputs = defaultInputs();
    const after = Date.now();
    expect(inputs.goldPerDivTimestamp).toBeGreaterThanOrEqual(before);
    expect(inputs.goldPerDivTimestamp).toBeLessThanOrEqual(after);
  });
});

// ---------------------------------------------------------------------------
// goldRateAgeDays
// ---------------------------------------------------------------------------

describe("goldRateAgeDays", () => {
  it("returns 0 for a timestamp set just now", () => {
    const now = Date.now();
    expect(goldRateAgeDays(now, now)).toBe(0);
  });

  it("returns the integer number of days between timestamp and now", () => {
    const now = new Date("2026-07-11T12:00:00Z").getTime();
    const threeDaysAgo = now - 3 * 24 * 60 * 60 * 1000;
    expect(goldRateAgeDays(threeDaysAgo, now)).toBe(3);
  });

  it("floors fractional days (e.g. 6.99d → 6)", () => {
    const now = new Date("2026-07-11T12:00:00Z").getTime();
    const almostSevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000 - 1);
    expect(goldRateAgeDays(almostSevenDaysAgo, now)).toBe(6);
  });

  it("returns 0 (never negative) for a future timestamp", () => {
    const now = Date.now();
    const future = now + 60_000;
    expect(goldRateAgeDays(future, now)).toBe(0);
  });

  it("GOLD_RATE_STALENESS_DAYS is 7", () => {
    expect(GOLD_RATE_STALENESS_DAYS).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// pickBestCycleEndingInDiv
// ---------------------------------------------------------------------------

describe("pickBestCycleEndingInDiv", () => {
  it("returns null when opportunities is undefined", () => {
    expect(pickBestCycleEndingInDiv(undefined)).toBeNull();
  });

  it("returns null when opportunities is empty", () => {
    expect(pickBestCycleEndingInDiv([])).toBeNull();
  });

  it("returns null when no cycle starts with 'divine'", () => {
    const opps = [
      makeCycle({ cycle: ["exalted", "mirror", "chaos", "exalted"], netProfitPct: 10 }),
    ];
    expect(pickBestCycleEndingInDiv(opps)).toBeNull();
  });

  it("returns the only div-cycle when one is present", () => {
    const divCycle = makeCycle({ netProfitPct: 3.0 });
    const opps = [
      makeCycle({ cycle: ["exalted", "mirror", "chaos", "exalted"], netProfitPct: 10 }),
      divCycle,
    ];
    expect(pickBestCycleEndingInDiv(opps)).toBe(divCycle);
  });

  it("returns the div-cycle with highest netProfitPct when multiple exist", () => {
    const low = makeCycle({ cycle: ["divine", "exalted", "mirror", "divine"], netProfitPct: 2.0 });
    const high = makeCycle({ cycle: ["divine", "chaos", "mirror", "divine"], netProfitPct: 8.5 });
    const mid = makeCycle({ cycle: ["divine", "exalted", "chaos", "divine"], netProfitPct: 5.0 });
    expect(pickBestCycleEndingInDiv([low, high, mid])).toBe(high);
  });

  it("treats undefined netProfitPct as 0 during sort", () => {
    // Cycle with undefined profit should be ranked lower than one with >0.
    const noProfit = makeCycle({ netProfitPct: undefined as unknown as number });
    const withProfit = makeCycle({ netProfitPct: 1.0 });
    expect(pickBestCycleEndingInDiv([noProfit, withProfit])).toBe(withProfit);
  });
});

// ---------------------------------------------------------------------------
// computeRoi — basic formula
// ---------------------------------------------------------------------------

describe("computeRoi — basic formula", () => {
  it("computes gold_in_div = goldAmount / goldPerDiv", () => {
    const inputs = makeInputs({ goldAmount: 500_000, goldPerDiv: 100_000 });
    const result = computeRoi(inputs, []);
    expect(result.goldInDiv).toBe(5);
  });

  it("applies multiplier 1 + netProfitPct/100 when a div cycle exists", () => {
    const inputs = makeInputs({ goldAmount: 500_000, goldPerDiv: 100_000, mapCost: 2.0 });
    // gold_in_div = 5, multiplier = 1 + 8/100 = 1.08, final = 5.4, expected = 5.4 - 2 = 3.4
    const cycle = makeCycle({ netProfitPct: 8.0 });
    const result = computeRoi(inputs, [cycle]);
    expect(result.multiplier).toBeCloseTo(1.08, 6);
    expect(result.finalDiv).toBeCloseTo(5.4, 6);
    expect(result.expectedDiv).toBeCloseTo(3.4, 6);
  });

  it("roi_pct = (expected_div / map_cost) * 100 when map_cost > 0", () => {
    const inputs = makeInputs({ goldAmount: 500_000, goldPerDiv: 100_000, mapCost: 2.0 });
    const cycle = makeCycle({ netProfitPct: 8.0 });
    const result = computeRoi(inputs, [cycle]);
    // expected_div = 3.4, map_cost = 2 → roi_pct = 170
    expect(result.roiPct).toBeCloseTo(170, 6);
  });

  it("uses multiplier = 1 when no div cycle exists", () => {
    const inputs = makeInputs({ goldAmount: 500_000, goldPerDiv: 100_000, mapCost: 2.0 });
    const result = computeRoi(inputs, []);
    expect(result.multiplier).toBe(1);
    expect(result.bestCycle).toBeNull();
    expect(result.finalDiv).toBeCloseTo(5, 6);
    expect(result.expectedDiv).toBeCloseTo(3, 6);
  });

  it("uses multiplier = 1 when opportunities is undefined", () => {
    const inputs = makeInputs({ goldAmount: 500_000, goldPerDiv: 100_000, mapCost: 2.0 });
    const result = computeRoi(inputs, undefined);
    expect(result.multiplier).toBe(1);
    expect(result.bestCycle).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// computeRoi — edge cases
// ---------------------------------------------------------------------------

describe("computeRoi — edge cases", () => {
  it("returns roi_pct = Infinity when map_cost = 0 (free map)", () => {
    const inputs = makeInputs({ goldAmount: 500_000, goldPerDiv: 100_000, mapCost: 0 });
    const result = computeRoi(inputs, []);
    expect(result.roiPct).toBe(Infinity);
    // expected_div should be positive → STRONG_FARM.
    expect(result.recommendation).toBe("STRONG_FARM");
  });

  it("returns AVOID when expected_div <= 0", () => {
    const inputs = makeInputs({ goldAmount: 100_000, goldPerDiv: 100_000, mapCost: 5.0 });
    // gold_in_div = 1, multiplier = 1 (no cycle), final = 1, expected = 1 - 5 = -4
    const result = computeRoi(inputs, []);
    expect(result.expectedDiv).toBeLessThanOrEqual(0);
    expect(result.recommendation).toBe("AVOID");
  });

  it("returns gold_in_div = 0 when gold_amount = 0", () => {
    const inputs = makeInputs({ goldAmount: 0, goldPerDiv: 100_000, mapCost: 2.0 });
    const result = computeRoi(inputs, []);
    expect(result.goldInDiv).toBe(0);
    expect(result.expectedDiv).toBe(-2);
    expect(result.recommendation).toBe("AVOID");
  });

  it("returns gold_in_div = 0 when gold_per_div = 0 (avoids div-by-zero)", () => {
    const inputs = makeInputs({ goldAmount: 500_000, goldPerDiv: 0, mapCost: 2.0 });
    const result = computeRoi(inputs, []);
    expect(result.goldInDiv).toBe(0);
  });

  it("marks belowMinStart=true when gold_in_div < minStartingAmount", () => {
    // gold_in_div = 5, min_starting_amount = 10 → below minimum.
    const inputs = makeInputs({ goldAmount: 500_000, goldPerDiv: 100_000 });
    const cycle = makeCycle({ minStartingAmount: 10, netProfitPct: 5.0 });
    const result = computeRoi(inputs, [cycle]);
    expect(result.belowMinStart).toBe(true);
  });

  it("marks belowMinStart=false when gold_in_div >= minStartingAmount", () => {
    const inputs = makeInputs({ goldAmount: 500_000, goldPerDiv: 100_000 });
    // gold_in_div = 5 → need min_starting_amount <= 5.
    const cycle = makeCycle({ minStartingAmount: 5, netProfitPct: 5.0 });
    const result = computeRoi(inputs, [cycle]);
    expect(result.belowMinStart).toBe(false);
  });

  it("marks belowMinStart=false when minStartingAmount is undefined", () => {
    const inputs = makeInputs();
    const cycle = makeCycle({ minStartingAmount: undefined as unknown as number });
    const result = computeRoi(inputs, [cycle]);
    expect(result.belowMinStart).toBe(false);
  });

  it("marks belowMinStart=false when no cycle exists", () => {
    const inputs = makeInputs();
    const result = computeRoi(inputs, []);
    expect(result.belowMinStart).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computeRoi — recommendation thresholds
// ---------------------------------------------------------------------------

describe("computeRoi — recommendation thresholds", () => {
  // Thresholds: <50 = MARGINAL, [50, 150) = FARM, >=150 = STRONG_FARM.
  it("returns MARGINAL for ROI 49% (just below 50% threshold)", () => {
    expect(ROI_THRESHOLD_MARGINAL).toBe(50);
    // gold_in_div = 2.98, no cycle → final = 2.98, map_cost = 2 → roi = 49%
    const inputs = makeInputs({ goldAmount: 298_000, goldPerDiv: 100_000, mapCost: 2.0 });
    const result = computeRoi(inputs, []);
    expect(result.roiPct).toBeCloseTo(49, 6);
    expect(result.recommendation).toBe("MARGINAL");
  });

  it("returns FARM for ROI 50% (at threshold)", () => {
    // gold_in_div = 3, no cycle → final = 3, map_cost = 2 → roi = 50%
    const inputs = makeInputs({ goldAmount: 300_000, goldPerDiv: 100_000, mapCost: 2.0 });
    const result = computeRoi(inputs, []);
    expect(result.roiPct).toBeCloseTo(50, 6);
    expect(result.recommendation).toBe("FARM");
  });

  it("returns FARM for ROI 149% (just below STRONG threshold)", () => {
    // gold_in_div = 4.98, no cycle → final = 4.98, map_cost = 2 → roi = 149%
    const inputs = makeInputs({ goldAmount: 498_000, goldPerDiv: 100_000, mapCost: 2.0 });
    const result = computeRoi(inputs, []);
    expect(result.roiPct).toBeCloseTo(149, 6);
    expect(result.recommendation).toBe("FARM");
  });

  it("returns STRONG_FARM for ROI 150% (at STRONG threshold)", () => {
    expect(ROI_THRESHOLD_STRONG).toBe(150);
    // gold_in_div = 5, no cycle → final = 5, map_cost = 2 → roi = 150%
    const inputs = makeInputs({ goldAmount: 500_000, goldPerDiv: 100_000, mapCost: 2.0 });
    const result = computeRoi(inputs, []);
    expect(result.roiPct).toBeCloseTo(150, 6);
    expect(result.recommendation).toBe("STRONG_FARM");
  });
});

// ---------------------------------------------------------------------------
// Recommendation UI helpers
// ---------------------------------------------------------------------------

describe("recommendationLabelKey", () => {
  it("returns the right i18n key per recommendation", () => {
    expect(recommendationLabelKey("AVOID")).toBe("goldMapRecommendationAvoid");
    expect(recommendationLabelKey("MARGINAL")).toBe("goldMapRecommendationMarginal");
    expect(recommendationLabelKey("FARM")).toBe("goldMapRecommendationFarm");
    expect(recommendationLabelKey("STRONG_FARM")).toBe("goldMapRecommendationStrongFarm");
  });
});

describe("recommendationBadgeClass", () => {
  it("AVOID → red border", () => {
    expect(recommendationBadgeClass("AVOID")).toContain("red-500");
  });

  it("MARGINAL → amber border", () => {
    expect(recommendationBadgeClass("MARGINAL")).toContain("amber-500");
  });

  it("FARM → emerald border", () => {
    expect(recommendationBadgeClass("FARM")).toContain("emerald-500");
  });

  it("STRONG_FARM → emerald border", () => {
    expect(recommendationBadgeClass("STRONG_FARM")).toContain("emerald-500");
  });
});

// ---------------------------------------------------------------------------
// localStorage persistence
// ---------------------------------------------------------------------------

describe("localStorage persistence", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("saveInputsToLocalStorage writes a JSON blob under poe2-gold-map-roi-inputs", () => {
    const inputs = makeInputs({ goldAmount: 750_000 });
    saveInputsToLocalStorage(inputs);
    const raw = window.localStorage.getItem("poe2-gold-map-roi-inputs");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.goldAmount).toBe(750_000);
    expect(parsed.mapCost).toBe(DEFAULT_MAP_COST);
    expect(parsed.goldPerDiv).toBe(DEFAULT_GOLD_PER_DIV);
    expect(typeof parsed.goldPerDivTimestamp).toBe("number");
  });

  it("loadInputsFromLocalStorage returns null when no entry exists", () => {
    expect(loadInputsFromLocalStorage()).toBeNull();
  });

  it("loadInputsFromLocalStorage round-trips a saved inputs object", () => {
    const inputs = makeInputs({ goldAmount: 999_999, mapCost: 1.5, goldPerDiv: 75_000 });
    saveInputsToLocalStorage(inputs);
    const loaded = loadInputsFromLocalStorage();
    expect(loaded).not.toBeNull();
    expect(loaded!.goldAmount).toBe(999_999);
    expect(loaded!.mapCost).toBe(1.5);
    expect(loaded!.goldPerDiv).toBe(75_000);
    expect(loaded!.goldPerDivTimestamp).toBe(inputs.goldPerDivTimestamp);
  });

  it("loadInputsFromLocalStorage returns null when JSON is corrupt", () => {
    window.localStorage.setItem("poe2-gold-map-roi-inputs", "not-json");
    expect(loadInputsFromLocalStorage()).toBeNull();
  });

  it("loadInputsFromLocalStorage returns null when fields are missing", () => {
    window.localStorage.setItem(
      "poe2-gold-map-roi-inputs",
      JSON.stringify({ goldAmount: 100, mapCost: 1 }), // missing goldPerDiv + timestamp
    );
    expect(loadInputsFromLocalStorage()).toBeNull();
  });

  it("loadInputsFromLocalStorage returns null when field types are wrong", () => {
    window.localStorage.setItem(
      "poe2-gold-map-roi-inputs",
      JSON.stringify({
        goldAmount: "100", // string, not number
        mapCost: 1,
        goldPerDiv: 100,
        goldPerDivTimestamp: Date.now(),
      }),
    );
    expect(loadInputsFromLocalStorage()).toBeNull();
  });

  it("saveInputsToLocalStorage does not throw when localStorage is full", () => {
    // Mock setItem to throw — the helper should swallow the error.
    const original = window.localStorage.setItem;
    window.localStorage.setItem = jest.fn(() => {
      throw new DOMException("quota exceeded");
    });
    expect(() => saveInputsToLocalStorage(makeInputs())).not.toThrow();
    window.localStorage.setItem = original;
  });
});
