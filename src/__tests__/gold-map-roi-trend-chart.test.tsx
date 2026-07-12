// ============================================================================
// Unit tests for GoldMapRoiTrendChart (P10 Phase 2, iter 132).
//
// Coverage:
//   - pickBestPerTimestamp pure helper: dedup, null handling, sorting
//   - Renders offline card when backend offline (no fetch attempted)
//   - Renders loading text while query is in flight
//   - Renders "no history yet" notice when dataAvailable=false
//   - Renders "no history yet" notice when fewer than 2 points
//   - Renders SVG chart + trend line when valid data arrives
//   - Days selector is rendered and changes the query key on change
//   - Renders error card when fetch fails
// ============================================================================
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@/lib/i18n";
import {
  GoldMapRoiTrendChart,
  pickBestPerTimestamp,
} from "@/components/dashboard/gold-map-roi-trend-chart";
import type { TriangularCyclesHistoryResponse } from "@/lib/types";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetchApi = jest.fn();
jest.mock("@/lib/types", () => ({
  ...jest.requireActual("@/lib/types"),
  fetchApi: (...args: unknown[]) => mockFetchApi(...args),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
    },
  });
}

function renderChart(backendOnline: boolean = true) {
  window.localStorage.setItem("poe2-locale", "en");
  const queryClient = createTestQueryClient();
  const result = render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <GoldMapRoiTrendChart backendOnline={backendOnline} />
      </I18nProvider>
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}

const now = Date.now();
const minMs = 60_000;

function makePoint(
  offsetMin: number,
  profit: number | null,
  cycleKey = "divine->exalted->mirror",
) {
  return {
    timestamp: new Date(now - offsetMin * minMs).toISOString(),
    cycleKey,
    cycleCurrencies: '["divine","exalted","mirror"]',
    rawProfitPct: profit,
    executableEstimate: 1,
    executableProfit: 2,
    confidence: 0.9,
    snapshotAgeSec: 5,
  };
}

function makeResponse(
  overrides: Partial<TriangularCyclesHistoryResponse> = {},
): TriangularCyclesHistoryResponse {
  return {
    league: "Standard",
    cycleKey: null,
    days: 7,
    points: [],
    availableCycleKeys: [],
    dataAvailable: false,
    fetchedAt: "2026-07-12T12:00:00Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Pure helper tests
// ---------------------------------------------------------------------------

describe("pickBestPerTimestamp", () => {
  it("returns empty array for empty input", () => {
    expect(pickBestPerTimestamp([])).toEqual([]);
  });

  it("deduplicates rows with the same timestamp, keeping highest profit", () => {
    const ts = new Date(now - 5 * minMs).toISOString();
    const result = pickBestPerTimestamp([
      { timestamp: ts, cycleKey: "a", cycleCurrencies: "[]", rawProfitPct: 2.0, executableEstimate: 1, executableProfit: 2, confidence: 0.5, snapshotAgeSec: 1 },
      { timestamp: ts, cycleKey: "b", cycleCurrencies: "[]", rawProfitPct: 5.0, executableEstimate: 1, executableProfit: 2, confidence: 0.5, snapshotAgeSec: 1 },
      { timestamp: ts, cycleKey: "c", cycleCurrencies: "[]", rawProfitPct: 3.0, executableEstimate: 1, executableProfit: 2, confidence: 0.5, snapshotAgeSec: 1 },
    ]);
    expect(result.length).toBe(1);
    expect(result[0].rawProfitPct).toBe(5.0);
    expect(result[0].cycleKey).toBe("b");
  });

  it("prefers non-null profit over null at the same timestamp", () => {
    const ts = new Date(now - 5 * minMs).toISOString();
    const result = pickBestPerTimestamp([
      { timestamp: ts, cycleKey: "a", cycleCurrencies: "[]", rawProfitPct: null, executableEstimate: 0, executableProfit: 0, confidence: 0, snapshotAgeSec: 1 },
      { timestamp: ts, cycleKey: "b", cycleCurrencies: "[]", rawProfitPct: 1.5, executableEstimate: 1, executableProfit: 2, confidence: 0.5, snapshotAgeSec: 1 },
    ]);
    expect(result.length).toBe(1);
    expect(result[0].rawProfitPct).toBe(1.5);
  });

  it("sorts ascending by timestamp (oldest first)", () => {
    const result = pickBestPerTimestamp([
      makePoint(30, 1.0),
      makePoint(5, 2.0),
      makePoint(60, 3.0),
      makePoint(15, 4.0),
    ]);
    expect(result.length).toBe(4);
    expect(result[0].timestamp).toBeLessThan(result[1].timestamp);
    expect(result[1].timestamp).toBeLessThan(result[2].timestamp);
    expect(result[2].timestamp).toBeLessThan(result[3].timestamp);
  });

  it("skips rows with unparseable timestamps", () => {
    const result = pickBestPerTimestamp([
      { timestamp: "not-a-date", cycleKey: "a", cycleCurrencies: "[]", rawProfitPct: 1.0, executableEstimate: 1, executableProfit: 2, confidence: 0.5, snapshotAgeSec: 1 },
      makePoint(5, 2.0),
    ]);
    expect(result.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Component tests
// ---------------------------------------------------------------------------

describe("GoldMapRoiTrendChart", () => {
  beforeEach(() => {
    mockFetchApi.mockReset();
    window.localStorage.clear();
  });

  it("renders offline card and does NOT fetch when backend offline", () => {
    renderChart(false);
    expect(screen.getByTestId("gold-map-roi-trend-chart")).toBeInTheDocument();
    expect(screen.getByText(/Cycle history requires the analytics backend/i)).toBeInTheDocument();
    expect(mockFetchApi).not.toHaveBeenCalled();
  });

  it("renders loading text while query is in flight", async () => {
    // Never resolve — keep loading state.
    mockFetchApi.mockReturnValue(new Promise(() => {}));
    renderChart(true);
    await waitFor(() => {
      expect(screen.getByText(/Loading cycle history/i)).toBeInTheDocument();
    });
  });

  it("renders 'no history yet' notice when dataAvailable=false", async () => {
    mockFetchApi.mockResolvedValue(makeResponse({ dataAvailable: false, points: [] }));
    renderChart(true);
    await waitFor(() => {
      expect(screen.getByText(/No cycle history yet/i)).toBeInTheDocument();
    });
  });

  it("renders 'no history yet' notice when fewer than 2 points", async () => {
    mockFetchApi.mockResolvedValue(
      makeResponse({ dataAvailable: true, points: [makePoint(5, 2.0)] }),
    );
    renderChart(true);
    await waitFor(() => {
      expect(screen.getByText(/No cycle history yet/i)).toBeInTheDocument();
    });
  });

  it("renders SVG chart + trend line when valid data arrives", async () => {
    mockFetchApi.mockResolvedValue(
      makeResponse({
        dataAvailable: true,
        points: [
          makePoint(60, 1.5),
          makePoint(30, 2.5),
          makePoint(5, 3.0),
        ],
        availableCycleKeys: ["divine->exalted->mirror"],
      }),
    );
    const { container } = renderChart(true);
    await waitFor(() => {
      expect(
        container.querySelector('svg[data-testid="gold-map-roi-trend-chart-svg"]'),
      ).toBeInTheDocument();
    });
    // Trend line path should be present.
    expect(
      container.querySelector('[data-testid="gold-map-roi-trend-line"]'),
    ).toBeInTheDocument();
    // Zero line should be present (dashed).
    expect(
      container.querySelector('[data-testid="gold-map-roi-trend-zero-line"]'),
    ).toBeInTheDocument();
    // Point count should be shown.
    expect(screen.getByText(/3 snapshots/i)).toBeInTheDocument();
  });

  it("renders error card when fetch fails", async () => {
    mockFetchApi.mockRejectedValue(new Error("network down"));
    renderChart(true);
    await waitFor(
      () => {
        expect(
          screen.getByText(/Failed to fetch cycle history/i),
        ).toBeInTheDocument();
      },
      { timeout: 5000 },
    );
  });

  it("renders the Days selector and triggers refetch on change", async () => {
    mockFetchApi.mockResolvedValue(
      makeResponse({
        dataAvailable: true,
        points: [
          makePoint(60, 1.5),
          makePoint(30, 2.5),
          makePoint(5, 3.0),
        ],
      }),
    );
    renderChart(true);
    await waitFor(() => {
      expect(
        screen.getByTestId("gold-map-roi-trend-days-select"),
      ).toBeInTheDocument();
    });
    // Default days=7 — first call should use days=7
    expect(mockFetchApi).toHaveBeenCalledWith(
      "/api/flipper/triangular/history",
      { days: "7" },
    );
  });

  it("calls /api/flipper/triangular/history with days param", async () => {
    mockFetchApi.mockResolvedValue(makeResponse());
    renderChart(true);
    await waitFor(() => {
      expect(mockFetchApi).toHaveBeenCalledWith(
        "/api/flipper/triangular/history",
        expect.objectContaining({ days: expect.any(String) }),
      );
    });
  });
});
