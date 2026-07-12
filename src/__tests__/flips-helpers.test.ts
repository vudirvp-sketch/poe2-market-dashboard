// ============================================================================
// Unit tests for components/dashboard/flips-helpers.ts
// Tests Spread tier classification (Q4) + Trend sparkline real-history path.
// iter 135 removed the synthetic deriveTrendSparklineData fallback — the
// sparkline now returns [] when no real history exists (Sparkline renders —).
// ============================================================================
import {
  classifySpreadTier,
  spreadTierColor,
  getTrendSparklineData,
  isTrendSparklineRealData,
  SPREAD_TIER_WIDE_THRESHOLD,
  SPREAD_TIER_MEDIUM_THRESHOLD,
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
// getTrendSparklineData (TD-9 iter 127 + iter 135 fallback removal)
// iter 135 removed the synthetic deriveTrendSparklineData fallback — the
// function now returns [] when no real history exists (≥ 2 points required).
// The Sparkline component renders an em-dash placeholder for empty arrays.
// ---------------------------------------------------------------------------

describe("getTrendSparklineData (TD-9 iter 127 + iter 135)", () => {
  it("returns real price array when priceHistoryShort has ≥ 2 points", () => {
    const result = getTrendSparklineData({
      priceHistoryShort: [
        { date: "2026-07-11T12:00:00Z", price: 1.10 },
        { date: "2026-07-11T12:05:00Z", price: 1.15 },
        { date: "2026-07-11T12:10:00Z", price: 1.20 },
      ],
    });
    expect(result).toEqual([1.10, 1.15, 1.20]);
  });

  it("returns empty array when priceHistoryShort is empty (no fallback)", () => {
    const result = getTrendSparklineData({
      priceHistoryShort: [],
    });
    expect(result).toEqual([]);
    expect(result).toHaveLength(0);
  });

  it("returns empty array when priceHistoryShort is undefined (no fallback)", () => {
    const result = getTrendSparklineData({});
    expect(result).toEqual([]);
  });

  it("returns empty array when priceHistoryShort is null (no fallback)", () => {
    const result = getTrendSparklineData({
      priceHistoryShort: null,
    });
    expect(result).toEqual([]);
  });

  it("returns empty array when priceHistoryShort has exactly 1 point (below min)", () => {
    const result = getTrendSparklineData({
      priceHistoryShort: [{ date: "2026-07-11T12:00:00Z", price: 1.10 }],
    });
    expect(result).toEqual([]);
  });

  it("uses real data when priceHistoryShort has exactly 2 points (meets min)", () => {
    const result = getTrendSparklineData({
      priceHistoryShort: [
        { date: "2026-07-11T12:00:00Z", price: 1.10 },
        { date: "2026-07-11T12:05:00Z", price: 1.20 },
      ],
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
