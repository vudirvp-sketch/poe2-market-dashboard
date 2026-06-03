// ============================================================================
// Tests for arbitrage subcomponents extracted in ШАГ 3 refactoring:
//   - arbitrage-helpers.ts (pure functions)
//   - arbitrage-flipper-flips.tsx
//   - arbitrage-flipper-triangular.tsx
// ============================================================================

import { describe, it, expect, vi } from "@jest/globals";
import { screen } from "@testing-library/react";
import React, { Suspense } from "react";

import {
  estimateSlippage,
  applyFee,
  estimateSpreadFromVolume,
  findArbitrageCycles,
  MAX_CYCLE_LEN,
  MAX_REALISTIC_PROFIT_PCT,
} from "@/components/dashboard/arbitrage-helpers";
import type { ExchangePair } from "@/lib/types";
import { renderWithProviders } from "./test-utils";

// ---------------------------------------------------------------------------
// estimateSlippage
// ---------------------------------------------------------------------------
describe("estimateSlippage", () => {
  it("returns 1 (100%) for zero volume", () => {
    expect(estimateSlippage(100, 0, 10)).toBe(1);
  });

  it("returns approximately base slippage for tradeSize << volume", () => {
    const result = estimateSlippage(1, 100_000, 10);
    expect(result).toBeCloseTo(0.001003, 4);
  });

  it("increases slippage when tradeSize approaches volume", () => {
    const small = estimateSlippage(100, 10_000, 10);
    const large = estimateSlippage(5_000, 10_000, 10);
    expect(large).toBeGreaterThan(small);
  });
});

// ---------------------------------------------------------------------------
// applyFee
// ---------------------------------------------------------------------------
describe("applyFee", () => {
  it("returns same rate for 0 bps fee", () => {
    expect(applyFee(1.5, 0)).toBe(1.5);
  });

  it("deducts fee correctly for 100 bps (1%)", () => {
    expect(applyFee(1.0, 100)).toBeCloseTo(0.99, 6);
  });

  it("deducts fee correctly for 10 bps", () => {
    expect(applyFee(2.0, 10)).toBeCloseTo(1.998, 6);
  });
});

// ---------------------------------------------------------------------------
// estimateSpreadFromVolume
// ---------------------------------------------------------------------------
describe("estimateSpreadFromVolume", () => {
  it("returns 0.08 (8%) for zero volume", () => {
    expect(estimateSpreadFromVolume(0)).toBe(0.08);
  });

  it("decreases spread as volume increases", () => {
    const low = estimateSpreadFromVolume(100);
    const high = estimateSpreadFromVolume(100_000);
    expect(high).toBeLessThan(low);
  });

  it("clamps spread to [0.01, 0.15]", () => {
    const veryHigh = estimateSpreadFromVolume(1_000_000_000);
    expect(veryHigh).toBeGreaterThanOrEqual(0.01);
    expect(veryHigh).toBeLessThanOrEqual(0.15);
  });
});

// ---------------------------------------------------------------------------
// findArbitrageCycles
// ---------------------------------------------------------------------------
describe("findArbitrageCycles", () => {
  function makePair(
    c1Id: string, c2Id: string, c1Rel: number, c2Rel: number, volume: number,
  ): ExchangePair {
    return {
      id: `${c1Id}-${c2Id}`,
      currency1Id: c1Id, currency1Name: c1Id, currency1IconUrl: null, currency1ItemId: 1,
      currency2Id: c2Id, currency2Name: c2Id, currency2IconUrl: null, currency2ItemId: 2,
      price: c1Rel / c2Rel, relativePrice: c1Rel, currency2RelativePrice: c2Rel,
      volume, change: null, changePercent: null, sevenDayChange: null, sevenDayChangePercent: null, history: null,
    };
  }

  it("returns empty array when no pairs provided", () => {
    expect(findArbitrageCycles([], 100, 0, 10, 10, 0)).toEqual([]);
  });

  it("returns empty array when pairs have insufficient volume", () => {
    const pairs = [makePair("A", "B", 1, 2, 5)];
    expect(findArbitrageCycles(pairs, 100, 0, 10, 10, 0)).toEqual([]);
  });

  it("respects MAX_CYCLE_LEN constant", () => {
    expect(MAX_CYCLE_LEN).toBe(5);
  });

  it("respects MAX_REALISTIC_PROFIT_PCT constant", () => {
    expect(MAX_REALISTIC_PROFIT_PCT).toBe(10);
  });

  it("finds no cycles in a simple 2-currency market", () => {
    const pairs = [makePair("A", "B", 1, 2, 10_000)];
    const result = findArbitrageCycles(pairs, 100, 0, 10, 10, 0);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ArbitrageFlipperFlips component
// ---------------------------------------------------------------------------
describe("ArbitrageFlipperFlips", () => {
  // Lazy-load component to avoid heavy import
  const ArbitrageFlipperFlipsLazy = React.lazy(
    () => import("@/components/dashboard/arbitrage-flipper-flips").then((m) => ({ default: m.ArbitrageFlipperFlips })),
  );

  it("shows backend_offline error when backendOnline is false", () => {
    renderWithProviders(
      <Suspense fallback={<div>Loading...</div>}>
        <ArbitrageFlipperFlipsLazy
          flipsData={undefined}
          flipsError={false}
          flipsErrorObj={null}
          backendOnline={false}
          onRetry={vi.fn()}
        />
      </Suspense>,
    );
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("shows collecting data message when dataAvailable is false", () => {
    renderWithProviders(
      <Suspense fallback={<div>Loading...</div>}>
        <ArbitrageFlipperFlipsLazy
          flipsData={{
            league: "vaal", total: 0, opportunities: [],
            eventStatus: { anyActive: false, affectedCurrencies: [], summary: null },
            fetchedAt: new Date().toISOString(), dataAvailable: false,
          }}
          flipsError={false}
          flipsErrorObj={null}
          backendOnline={true}
          onRetry={vi.fn()}
        />
      </Suspense>,
    );
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("renders flip opportunities table when data is available", () => {
    renderWithProviders(
      <Suspense fallback={<div>Loading...</div>}>
        <ArbitrageFlipperFlipsLazy
          flipsData={{
            league: "vaal", total: 1,
            opportunities: [{
              currency: "divine/exalted", score: 0.85, spread: 0.03,
              volume24h: 5000, momentum: 0.01, volatility: 0.05, cluster: "SAFE",
            }],
            eventStatus: { anyActive: false, affectedCurrencies: [], summary: null },
            fetchedAt: new Date().toISOString(), dataAvailable: true,
          }}
          flipsError={false}
          flipsErrorObj={null}
          backendOnline={true}
          onRetry={vi.fn()}
        />
      </Suspense>,
    );
    expect(screen.getByText("divine/exalted")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// ArbitrageFlipperTriangular component
// ---------------------------------------------------------------------------
describe("ArbitrageFlipperTriangular", () => {
  const ArbitrageFlipperTriangularLazy = React.lazy(
    () => import("@/components/dashboard/arbitrage-flipper-triangular").then((m) => ({ default: m.ArbitrageFlipperTriangular })),
  );

  it("shows backend_offline error when backendOnline is false", () => {
    renderWithProviders(
      <Suspense fallback={<div>Loading...</div>}>
        <ArbitrageFlipperTriangularLazy
          triData={undefined}
          triError={false}
          triErrorObj={null}
          backendOnline={false}
          onRetry={vi.fn()}
        />
      </Suspense>,
    );
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("shows collecting data message when dataAvailable is false", () => {
    renderWithProviders(
      <Suspense fallback={<div>Loading...</div>}>
        <ArbitrageFlipperTriangularLazy
          triData={{
            league: "vaal", total: 0, opportunities: [],
            fetchedAt: new Date().toISOString(), dataAvailable: false,
          }}
          triError={false}
          triErrorObj={null}
          backendOnline={true}
          onRetry={vi.fn()}
        />
      </Suspense>,
    );
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("renders triangular cycles table when opportunities exist", () => {
    renderWithProviders(
      <Suspense fallback={<div>Loading...</div>}>
        <ArbitrageFlipperTriangularLazy
          triData={{
            league: "vaal", total: 1,
            opportunities: [{
              cycle: ["divine", "exalted", "chaos", "divine"],
              netProfitPct: 2.5, stepRates: [0.5, 10, 0.2],
              totalVolume: 5000, confidence: 0.75,
            }],
            fetchedAt: new Date().toISOString(), dataAvailable: true,
          }}
          triError={false}
          triErrorObj={null}
          backendOnline={true}
          onRetry={vi.fn()}
        />
      </Suspense>,
    );
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByText("divine")).toBeTruthy();
  });

  it("shows upstream unreachable error when upstreamDegraded is true", () => {
    renderWithProviders(
      <Suspense fallback={<div>Loading...</div>}>
        <ArbitrageFlipperTriangularLazy
          triData={undefined}
          triError={false}
          triErrorObj={null}
          backendOnline={true}
          upstreamDegraded={true}
          onRetry={vi.fn()}
        />
      </Suspense>,
    );
    expect(screen.getByRole("alert")).toBeTruthy();
  });
});
