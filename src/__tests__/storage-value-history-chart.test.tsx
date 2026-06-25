// ============================================================================
// Unit tests for StorageValueHistoryChart (F2 follow-up, iter 75).
//
// Coverage:
//   - Empty points → renders "no history" notice
//   - Loading state → renders loading text
//   - All-null ratios → renders "no reference data" notice
//   - Valid points with mirror ratios → renders SVG + mirror legend
//   - Valid points with hinekora ratios → renders SVG + hinekora legend
//   - Valid points with both → renders both legends
//   - Single point → renders "no history" notice (need ≥2 to draw a line)
// ============================================================================
import React from "react";
import { render, screen } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n";
import {
  StorageValueHistoryChart,
} from "@/components/dashboard/storage-value-history-chart";
import type { StorageValueHistoryPoint } from "@/lib/types";

function renderChart(
  points: StorageValueHistoryPoint[],
  opts: { loading?: boolean; currency?: string } = {},
) {
  window.localStorage.setItem("poe2-locale", "en");
  return render(
    <I18nProvider>
      <StorageValueHistoryChart
        points={points}
        currency={opts.currency ?? "divine"}
        loading={opts.loading ?? false}
      />
    </I18nProvider>,
  );
}

// ---------------------------------------------------------------------------
// Test data — three points spanning 3 days with mirror + hinekora prices
// ---------------------------------------------------------------------------

const now = Date.now();
const dayMs = 86_400_000;

const validPoints: StorageValueHistoryPoint[] = [
  {
    timestamp: new Date(now - 2 * dayMs).toISOString(),
    price: 100,
    mirrorPrice: 50000,
    hinekoraPrice: 5000,
    ratioMirror: 0.002,
    ratioHinekora: 0.02,
  },
  {
    timestamp: new Date(now - 1 * dayMs).toISOString(),
    price: 105,
    mirrorPrice: 51000,
    hinekoraPrice: 5100,
    ratioMirror: 0.00206,
    ratioHinekora: 0.02059,
  },
  {
    timestamp: new Date(now).toISOString(),
    price: 110,
    mirrorPrice: 52000,
    hinekoraPrice: 5200,
    ratioMirror: 0.00212,
    ratioHinekora: 0.02115,
  },
];

const mirrorOnlyPoints: StorageValueHistoryPoint[] = validPoints.map((p) => ({
  ...p,
  hinekoraPrice: null,
  ratioHinekora: null,
}));

const hinekoraOnlyPoints: StorageValueHistoryPoint[] = validPoints.map((p) => ({
  ...p,
  mirrorPrice: null,
  ratioMirror: null,
}));

const allNullRatiosPoints: StorageValueHistoryPoint[] = validPoints.map((p) => ({
  timestamp: p.timestamp,
  price: p.price,
  mirrorPrice: null,
  hinekoraPrice: null,
  ratioMirror: null,
  ratioHinekora: null,
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("StorageValueHistoryChart", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders loading text when loading=true", () => {
    renderChart([], { loading: true });
    expect(screen.getByText(/Loading price history/i)).toBeInTheDocument();
  });

  it("renders 'no history' notice when points is empty", () => {
    renderChart([]);
    // The empty notice mentions the currency name
    expect(screen.getByText(/No price history available for divine/i)).toBeInTheDocument();
  });

  it("renders 'no history' notice when points has a single entry (need ≥2)", () => {
    renderChart([validPoints[0]]);
    expect(screen.getByText(/No price history available for divine/i)).toBeInTheDocument();
  });

  it("renders 'no reference data' notice when all ratios are null", () => {
    renderChart(allNullRatiosPoints);
    expect(
      screen.getByText(/no Mirror or Hinekora trades were recorded/i),
    ).toBeInTheDocument();
  });

  it("renders SVG chart with both legends when both ratios are present", () => {
    const { container } = renderChart(validPoints);
    // SVG element should be present
    const svg = container.querySelector(
      'svg[data-testid="storage-value-history-chart-svg"]',
    );
    expect(svg).toBeInTheDocument();
    // Both legend labels should be present
    expect(screen.getByText(/currency \/ Mirror ratio/i)).toBeInTheDocument();
    expect(screen.getByText(/currency \/ Hinekora ratio/i)).toBeInTheDocument();
    // Point count should be shown
    expect(screen.getByText(/3 points/i)).toBeInTheDocument();
  });

  it("renders only mirror legend when only mirror ratios are present", () => {
    renderChart(mirrorOnlyPoints);
    expect(screen.getByText(/currency \/ Mirror ratio/i)).toBeInTheDocument();
    expect(screen.queryByText(/currency \/ Hinekora ratio/i)).not.toBeInTheDocument();
  });

  it("renders only hinekora legend when only hinekora ratios are present", () => {
    renderChart(hinekoraOnlyPoints);
    expect(screen.queryByText(/currency \/ Mirror ratio/i)).not.toBeInTheDocument();
    expect(screen.getByText(/currency \/ Hinekora ratio/i)).toBeInTheDocument();
  });

  it("renders two <path> elements when both ratios are present", () => {
    const { container } = renderChart(validPoints);
    // Use the data-testid to scope to the chart SVG only (lucide icons also
    // render <svg><path/></svg>, which would inflate the count).
    const svg = container.querySelector(
      'svg[data-testid="storage-value-history-chart-svg"]',
    );
    const paths = svg?.querySelectorAll("path") ?? [];
    expect(paths.length).toBe(2);
  });

  it("renders one <path> element when only one ratio is present", () => {
    const { container } = renderChart(mirrorOnlyPoints);
    const svg = container.querySelector(
      'svg[data-testid="storage-value-history-chart-svg"]',
    );
    const paths = svg?.querySelectorAll("path") ?? [];
    expect(paths.length).toBe(1);
  });

  it("renders the chart title", () => {
    renderChart(validPoints);
    expect(screen.getByText(/Storage Value History/i)).toBeInTheDocument();
  });

  it("uses the currency name in the subtitle", () => {
    renderChart(validPoints, { currency: "chaos" });
    // Subtitle is "chaos vs Mirror / Hinekora over the last 30 days"
    expect(screen.getByText(/chaos vs Mirror \/ Hinekora/i)).toBeInTheDocument();
  });
});
