// ============================================================================
// Integration tests for the GoldMapRoiTab component (P10 Phase 1 MVP, iter 127).
//
// Coverage:
//   - Renders the tab title + subtitle when backend online
//   - Renders offline card when backend offline
//   - Renders error card when the /triangular fetch fails
//   - Renders the calculator (inputs + result card) once data arrives
//   - Passes opportunities through to the calculator
//   - Renders "no cycles yet" notice when dataAvailable=false
//   - Renders fetched-at + cycle count footer when data is available
// ============================================================================
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@/lib/i18n";
import { GoldMapRoiTab } from "@/components/dashboard/gold-map-roi-tab";
import type { TriangularResponse } from "@/lib/types";

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

function renderTab(backendOnline: boolean = true) {
  window.localStorage.setItem("poe2-locale", "en");
  // Pre-seed the gold-map-roi inputs so the calculator has valid initial values.
  window.localStorage.setItem(
    "poe2-gold-map-roi-inputs",
    JSON.stringify({
      goldAmount: 500_000,
      mapCost: 2.0,
      goldPerDiv: 100_000,
      goldPerDivTimestamp: Date.now(),
    }),
  );
  const queryClient = createTestQueryClient();
  const result = render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <GoldMapRoiTab backendOnline={backendOnline} />
      </I18nProvider>
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}

function makeTriangularResponse(
  overrides: Partial<TriangularResponse> = {},
): TriangularResponse {
  return {
    league: "Standard",
    total: 1,
    opportunities: [
      {
        cycle: ["divine", "exalted", "mirror", "divine"],
        netProfitPct: 8.0,
        stepRates: [0.5, 2.0, 0.4],
        totalVolume: 1000,
        confidence: 0.9,
        minStartingAmount: 1,
        quantizedProfitPct: 7.5,
        continuousProfitPct: 8.0,
        integerSimulation: [1, 2, 5, 1],
      },
    ],
    fetchedAt: "2026-07-11T12:00:00Z",
    dataAvailable: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GoldMapRoiTab", () => {
  beforeEach(() => {
    mockFetchApi.mockReset();
    window.localStorage.clear();
  });

  it("renders the offline card when backend is offline", () => {
    renderTab(false);
    expect(screen.getByTestId("gold-map-roi-tab")).toBeInTheDocument();
    // Offline card uses the goldMapTitle text (English locale).
    expect(screen.getByText("ROI Gold Map (Castaway)")).toBeInTheDocument();
    // The calculator inputs should NOT render when offline.
    expect(screen.queryByTestId("gold-map-roi-calculator")).toBeNull();
    expect(screen.queryByTestId("gold-map-gold-amount-input")).toBeNull();
  });

  it("renders the tab title + subtitle when backend online", async () => {
    mockFetchApi.mockResolvedValue(makeTriangularResponse());
    renderTab(true);
    expect(screen.getByTestId("gold-map-roi-tab")).toBeInTheDocument();
    expect(screen.getByText("ROI Gold Map (Castaway)")).toBeInTheDocument();
    expect(
      screen.getByText(/Convert gold → Div via the best 3-way chain/),
    ).toBeInTheDocument();
  });

  it("renders the calculator once data arrives", async () => {
    mockFetchApi.mockResolvedValue(makeTriangularResponse());
    renderTab(true);
    await waitFor(() => {
      expect(screen.getByTestId("gold-map-roi-calculator")).toBeInTheDocument();
    });
    // Three input fields rendered.
    expect(screen.getByTestId("gold-map-gold-amount-input")).toBeInTheDocument();
    expect(screen.getByTestId("gold-map-map-cost-input")).toBeInTheDocument();
    expect(screen.getByTestId("gold-map-gold-per-div-input")).toBeInTheDocument();
    // Result card rendered.
    expect(screen.getByTestId("gold-map-roi-result-card")).toBeInTheDocument();
  });

  it("renders the error card when fetch fails", async () => {
    mockFetchApi.mockRejectedValue(new Error("network down"));
    renderTab(true);
    await waitFor(
      () => {
        expect(
          screen.getByText(/Failed to fetch 3-way cycles/),
        ).toBeInTheDocument();
      },
      { timeout: 5000 },
    );
    // Calculator should NOT render in the error state (tab short-circuits).
    expect(screen.queryByTestId("gold-map-roi-calculator")).toBeNull();
  });

  it("renders 'no cycles yet' notice when dataAvailable=false", async () => {
    mockFetchApi.mockResolvedValue(
      makeTriangularResponse({ dataAvailable: false, opportunities: [], total: 0 }),
    );
    renderTab(true);
    await waitFor(() => {
      expect(
        screen.getByText(/No 3-way cycles available yet/),
      ).toBeInTheDocument();
    });
    // Calculator still renders (so user can see the manual gold→Div step).
    expect(screen.getByTestId("gold-map-roi-calculator")).toBeInTheDocument();
  });

  it("renders the fetched-at footer when data is available", async () => {
    mockFetchApi.mockResolvedValue(makeTriangularResponse());
    renderTab(true);
    await waitFor(() => {
      expect(screen.getByText(/Fetched:/)).toBeInTheDocument();
    });
    expect(screen.getByText(/1 cycles detected/)).toBeInTheDocument();
  });

  it("calls /api/flipper/triangular when backend online", async () => {
    mockFetchApi.mockResolvedValue(makeTriangularResponse());
    renderTab(true);
    await waitFor(() => {
      expect(mockFetchApi).toHaveBeenCalledWith("/api/flipper/triangular");
    });
  });

  it("does NOT call /api/flipper/triangular when backend offline", () => {
    renderTab(false);
    expect(mockFetchApi).not.toHaveBeenCalled();
  });

  it("renders the refresh button when backend online", async () => {
    mockFetchApi.mockResolvedValue(makeTriangularResponse());
    renderTab(true);
    await waitFor(() => {
      expect(screen.getByTestId("gold-map-roi-refresh")).toBeInTheDocument();
    });
  });
});
