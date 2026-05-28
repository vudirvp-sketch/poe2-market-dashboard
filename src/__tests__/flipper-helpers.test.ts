// ============================================================================
// Unit tests for lib/flipper-helpers.ts — Pure helper functions for flipper
// components: computeSentiment, scoreColor, profitColor, profitBg,
// classifySentiment
// ============================================================================
import {
  computeSentiment,
  scoreColor,
  profitColor,
  profitBg,
  classifySentiment,
} from "@/lib/flipper-helpers";

// ---------------------------------------------------------------------------
// computeSentiment
// ---------------------------------------------------------------------------
describe("computeSentiment", () => {
  it("returns 0 for empty opportunities", () => {
    expect(computeSentiment([])).toBe(0);
  });

  it("returns the momentum of a single opportunity", () => {
    const result = computeSentiment([{ score: 1, momentum: 0.05 }]);
    expect(result).toBeCloseTo(0.05, 10);
  });

  it("computes score-weighted average of momentums", () => {
    const opportunities = [
      { score: 0.8, momentum: 0.1 },
      { score: 0.2, momentum: -0.2 },
    ];
    // Weighted: (0.8 * 0.1 + 0.2 * -0.2) / (0.8 + 0.2) = (0.08 - 0.04) / 1.0 = 0.04
    const result = computeSentiment(opportunities);
    expect(result).toBeCloseTo(0.04, 10);
  });

  it("treats zero-score opportunities with min weight of 0.01", () => {
    const opportunities = [
      { score: 0, momentum: 0.5 },
      { score: 1, momentum: -0.5 },
    ];
    // Weighted: (0.01 * 0.5 + 1 * -0.5) / (0.01 + 1) = (0.005 - 0.5) / 1.01 ≈ -0.4901
    const result = computeSentiment(opportunities);
    expect(result).toBeCloseTo(-0.4900990099, 4);
  });

  it("handles all-negative momentums (bearish)", () => {
    const opportunities = [
      { score: 0.9, momentum: -0.1 },
      { score: 0.7, momentum: -0.05 },
    ];
    const result = computeSentiment(opportunities);
    expect(result).toBeLessThan(0);
  });

  it("handles all-positive momentums (bullish)", () => {
    const opportunities = [
      { score: 0.9, momentum: 0.1 },
      { score: 0.7, momentum: 0.05 },
    ];
    const result = computeSentiment(opportunities);
    expect(result).toBeGreaterThan(0);
  });

  it("handles mixed momentums near zero", () => {
    const opportunities = [
      { score: 0.5, momentum: 0.001 },
      { score: 0.5, momentum: -0.001 },
    ];
    const result = computeSentiment(opportunities);
    expect(result).toBeCloseTo(0, 10);
  });
});

// ---------------------------------------------------------------------------
// scoreColor
// ---------------------------------------------------------------------------
describe("scoreColor", () => {
  it("returns emerald for high scores (>= 0.7)", () => {
    expect(scoreColor(0.7)).toContain("emerald");
    expect(scoreColor(1.0)).toContain("emerald");
    expect(scoreColor(0.85)).toContain("emerald");
  });

  it("returns amber for medium scores (0.4-0.69)", () => {
    expect(scoreColor(0.4)).toContain("amber");
    expect(scoreColor(0.5)).toContain("amber");
    expect(scoreColor(0.69)).toContain("amber");
  });

  it("returns red for low scores (< 0.4)", () => {
    expect(scoreColor(0.39)).toContain("red");
    expect(scoreColor(0.0)).toContain("red");
    expect(scoreColor(0.1)).toContain("red");
  });

  it("includes dark mode variant in all classes", () => {
    expect(scoreColor(0.8)).toContain("dark:");
    expect(scoreColor(0.5)).toContain("dark:");
    expect(scoreColor(0.2)).toContain("dark:");
  });
});

// ---------------------------------------------------------------------------
// profitColor
// ---------------------------------------------------------------------------
describe("profitColor", () => {
  it("returns emerald for positive profit", () => {
    expect(profitColor(1.5)).toContain("emerald");
    expect(profitColor(0.01)).toContain("emerald");
  });

  it("returns red for negative profit", () => {
    expect(profitColor(-1)).toContain("red");
    expect(profitColor(-0.01)).toContain("red");
  });

  it("returns muted for zero profit", () => {
    expect(profitColor(0)).toBe("text-muted-foreground");
  });

  it("includes dark mode variant for positive and negative", () => {
    expect(profitColor(1)).toContain("dark:");
    expect(profitColor(-1)).toContain("dark:");
  });
});

// ---------------------------------------------------------------------------
// profitBg
// ---------------------------------------------------------------------------
describe("profitBg", () => {
  it("returns emerald classes for profitable recipes", () => {
    expect(profitBg(true)).toContain("emerald");
  });

  it("returns red classes for unprofitable recipes", () => {
    expect(profitBg(false)).toContain("red");
  });
});

// ---------------------------------------------------------------------------
// classifySentiment
// ---------------------------------------------------------------------------
describe("classifySentiment", () => {
  it("classifies strong positive as bullish", () => {
    expect(classifySentiment(0.01)).toBe("bullish");
    expect(classifySentiment(0.1)).toBe("bullish");
    expect(classifySentiment(1)).toBe("bullish");
  });

  it("classifies strong negative as bearish", () => {
    expect(classifySentiment(-0.01)).toBe("bearish");
    expect(classifySentiment(-0.1)).toBe("bearish");
    expect(classifySentiment(-1)).toBe("bearish");
  });

  it("classifies near-zero as neutral", () => {
    expect(classifySentiment(0)).toBe("neutral");
    expect(classifySentiment(0.005)).toBe("neutral");
    expect(classifySentiment(-0.005)).toBe("neutral");
    expect(classifySentiment(0.004)).toBe("neutral");
    expect(classifySentiment(-0.004)).toBe("neutral");
  });

  it("uses boundary value of 0.005", () => {
    // Exactly at the boundary should be neutral (not > 0.005)
    expect(classifySentiment(0.005)).toBe("neutral");
    // Just above the boundary should be bullish
    expect(classifySentiment(0.0051)).toBe("bullish");
    // Just below the negative boundary should be bearish
    expect(classifySentiment(-0.0051)).toBe("bearish");
  });
});
