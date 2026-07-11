// ============================================================================
// Unit tests for components/dashboard/flips-helpers.ts — iter 94 additions
// Tests Spread tier classification (Q4) + Trend sparkline derivation (Q5).
// ============================================================================
import {
  classifySpreadTier,
  spreadTierColor,
  deriveTrendSparklineData,
  getTrendSparklineData,
  isTrendSparklineRealData,
  SPREAD_TIER_WIDE_THRESHOLD,
  SPREAD_TIER_MEDIUM_THRESHOLD,
  FLIPS_TREND_SPARKLINE_POINTS,
  FLIPS_TREND_REAL_HISTORY_MIN_POINTS,
} from "@/components/dashboard/flips-helpers";

// ---------------------------------------------------------------------------
// classifySpreadTier
// ---------------------------------------------------------------------------
describe("classifySpreadTier (iter 94 Q4)", () => {
  it("returns 'wide' for spread ≥5%", () => {
    expect(classifySpreadTier(0.05)).toBe("wide");
    expect(classifySpreadTier(0.10)).toBe("wide");
    expect(classifySpreadTier(0.99)).toBe("wide");
  });

  it("returns 'medium' for spread in [2%, 5%)", () => {
    expect(classifySpreadTier(0.02)).toBe("medium");
    expect(classifySpreadTier(0.03)).toBe("medium");
    expect(classifySpreadTier(0.0499)).toBe("medium");
  });

  it("returns 'tight' for spread <2%", () => {
    expect(classifySpreadTier(0.019)).toBe("tight");
    expect(classifySpreadTier(0.001)).toBe("tight");
    expect(classifySpreadTier(0)).toBe("tight");
  });

  it("returns 'tight' for null/undefined spread (defensive)", () => {
    expect(classifySpreadTier(null)).toBe("tight");
    expect(classifySpreadTier(undefined)).toBe("tight");
  });

  it("uses exported thresholds consistently", () => {
    expect(classifySpreadTier(SPREAD_TIER_WIDE_THRESHOLD)).toBe("wide");
    expect(classifySpreadTier(SPREAD_TIER_MEDIUM_THRESHOLD)).toBe("medium");
    // Just below wide threshold
    expect(classifySpreadTier(SPREAD_TIER_WIDE_THRESHOLD - 0.0001)).toBe("medium");
    // Just below medium threshold
    expect(classifySpreadTier(SPREAD_TIER_MEDIUM_THRESHOLD - 0.0001)).toBe("tight");
  });
});

// ---------------------------------------------------------------------------
// spreadTierColor
// ---------------------------------------------------------------------------
describe("spreadTierColor (iter 94 Q4)", () => {
  it("returns emerald color class for 'wide' tier", () => {
    expect(spreadTierColor("wide")).toContain("emerald");
    expect(spreadTierColor("wide")).toContain("font-semibold");
  });

  it("returns amber color class for 'medium' tier", () => {
    expect(spreadTierColor("medium")).toContain("amber");
  });

  it("returns muted color class for 'tight' tier", () => {
    expect(spreadTierColor("tight")).toContain("muted-foreground");
  });
});

// ---------------------------------------------------------------------------
// deriveTrendSparklineData
// ---------------------------------------------------------------------------
describe("deriveTrendSparklineData (iter 94 Q5)", () => {
  it("returns exactly FLIPS_TREND_SPARKLINE_POINTS points", () => {
    const points = deriveTrendSparklineData(0.05, 0.02);
    expect(points).toHaveLength(FLIPS_TREND_SPARKLINE_POINTS);
  });

  it("is deterministic — same inputs always produce same outputs", () => {
    const a = deriveTrendSparklineData(0.05, 0.02);
    const b = deriveTrendSparklineData(0.05, 0.02);
    expect(a).toEqual(b);
  });

  it("with zero momentum + zero volatility, all points are zero (flat line)", () => {
    const points = deriveTrendSparklineData(0, 0);
    expect(points.every((p) => p === 0)).toBe(true);
  });

  it("with positive momentum, last point > first point (upward slope)", () => {
    const points = deriveTrendSparklineData(0.1, 0);
    expect(points[points.length - 1]).toBeGreaterThan(points[0]);
  });

  it("with negative momentum, last point < first point (downward slope)", () => {
    const points = deriveTrendSparklineData(-0.1, 0);
    expect(points[points.length - 1]).toBeLessThan(points[0]);
  });

  it("with zero momentum + non-zero volatility, first and last points are zero", () => {
    // Slope=0 means trend=0; wave multiplier is (1-t) which is 1 at t=0 and 0 at t=1
    // So first point (t=0): 0 + v*sin(0)*(1-0)*0.5 = 0 (sin(0)=0)
    // Last point (t=1): 0 + v*sin(N*PI)*(1-1)*0.5 = 0
    const points = deriveTrendSparklineData(0, 0.1);
    expect(points[0]).toBeCloseTo(0, 10);
    expect(points[points.length - 1]).toBeCloseTo(0, 10);
  });

  it("handles null/undefined inputs gracefully (treats as 0)", () => {
    const a = deriveTrendSparklineData(null, null);
    const b = deriveTrendSparklineData(0, 0);
    expect(a).toEqual(b);

    const c = deriveTrendSparklineData(undefined, undefined);
    expect(c).toEqual(b);
  });

  it("with non-zero volatility, intermediate points deviate from pure slope", () => {
    // With momentum=0, volatility=0.1, intermediate points should be non-zero
    const points = deriveTrendSparklineData(0, 0.1);
    const intermediate = points.slice(1, -1);
    expect(intermediate.some((p) => Math.abs(p) > 0.001)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getTrendSparklineData (TD-9 iter 127) — real price history with fallback
// ---------------------------------------------------------------------------

describe("getTrendSparklineData (TD-9 iter 127)", () => {
  it("returns real price array when priceHistoryShort has ≥ 2 points", () => {
    const result = getTrendSparklineData({
      priceHistoryShort: [
        { date: "2026-07-11T12:00:00Z", price: 1.10 },
        { date: "2026-07-11T12:05:00Z", price: 1.15 },
        { date: "2026-07-11T12:10:00Z", price: 1.20 },
      ],
      momentum: 0.05,
      volatility: 0.02,
    });
    expect(result).toEqual([1.10, 1.15, 1.20]);
  });

  it("falls back to deriveTrendSparklineData when priceHistoryShort is empty", () => {
    const fallback = deriveTrendSparklineData(0.05, 0.02);
    const result = getTrendSparklineData({
      priceHistoryShort: [],
      momentum: 0.05,
      volatility: 0.02,
    });
    expect(result).toEqual(fallback);
    expect(result).toHaveLength(FLIPS_TREND_SPARKLINE_POINTS);
  });

  it("falls back to deriveTrendSparklineData when priceHistoryShort is undefined", () => {
    const fallback = deriveTrendSparklineData(0.05, 0.02);
    const result = getTrendSparklineData({
      momentum: 0.05,
      volatility: 0.02,
    });
    expect(result).toEqual(fallback);
  });

  it("falls back to deriveTrendSparklineData when priceHistoryShort is null", () => {
    const fallback = deriveTrendSparklineData(0.05, 0.02);
    const result = getTrendSparklineData({
      priceHistoryShort: null,
      momentum: 0.05,
      volatility: 0.02,
    });
    expect(result).toEqual(fallback);
  });

  it("falls back when priceHistoryShort has exactly 1 point (below min)", () => {
    const fallback = deriveTrendSparklineData(0.05, 0.02);
    const result = getTrendSparklineData({
      priceHistoryShort: [{ date: "2026-07-11T12:00:00Z", price: 1.10 }],
      momentum: 0.05,
      volatility: 0.02,
    });
    expect(result).toEqual(fallback);
  });

  it("uses real data when priceHistoryShort has exactly 2 points (meets min)", () => {
    const result = getTrendSparklineData({
      priceHistoryShort: [
        { date: "2026-07-11T12:00:00Z", price: 1.10 },
        { date: "2026-07-11T12:05:00Z", price: 1.20 },
      ],
      momentum: 0.05,
      volatility: 0.02,
    });
    expect(result).toEqual([1.10, 1.20]);
  });

  it("FLIPS_TREND_REAL_HISTORY_MIN_POINTS is 2", () => {
    expect(FLIPS_TREND_REAL_HISTORY_MIN_POINTS).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// isTrendSparklineRealData (TD-9 iter 127)
// ---------------------------------------------------------------------------

describe("isTrendSparklineRealData (TD-9 iter 127)", () => {
  it("returns true when priceHistoryShort has ≥ 2 points", () => {
    expect(
      isTrendSparklineRealData({
        priceHistoryShort: [
          { date: "2026-07-11T12:00:00Z", price: 1.10 },
          { date: "2026-07-11T12:05:00Z", price: 1.15 },
        ],
      }),
    ).toBe(true);
  });

  it("returns false when priceHistoryShort is empty", () => {
    expect(
      isTrendSparklineRealData({
        priceHistoryShort: [],
      }),
    ).toBe(false);
  });

  it("returns false when priceHistoryShort is undefined", () => {
    expect(isTrendSparklineRealData({})).toBe(false);
  });

  it("returns false when priceHistoryShort is null", () => {
    expect(
      isTrendSparklineRealData({
        priceHistoryShort: null,
      }),
    ).toBe(false);
  });

  it("returns false when priceHistoryShort has only 1 point", () => {
    expect(
      isTrendSparklineRealData({
        priceHistoryShort: [{ date: "2026-07-11T12:00:00Z", price: 1.10 }],
      }),
    ).toBe(false);
  });
});
