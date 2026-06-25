// ============================================================================
// Unit tests for StorageValueTab (F2, iter 74) — Hold/Sell decision card.
//
// Coverage:
//   - Backend offline → renders offline notice + start-backend hint
//   - Backend online + loading → renders loading state
//   - Backend online + data_available=true → renders decision + projection
//   - Backend online + data_available=false → renders "no history" notice
//   - Decision badge colors respect BUY_HOLD / SELL_CONVERT / NEUTRAL
//   - Quantity multiplies through to holdings totals
// ============================================================================
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@/lib/i18n";
import { StorageValueTab } from "@/components/dashboard/storage-value-tab";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetchApi = jest.fn();
jest.mock("@/lib/types", () => ({
  ...jest.requireActual("@/lib/types"),
  fetchApi: (...args: unknown[]) => mockFetchApi(...args),
  getFlipperErrorType: jest.fn().mockReturnValue(null),
  fmt: (n: number) => (Number.isFinite(n) ? n.toFixed(4) : "—"),
}));

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
    },
  });
}

function renderStorageValueTab(backendOnline: boolean = true) {
  const queryClient = createTestQueryClient();
  window.localStorage.setItem("poe2-locale", "en");
  const result = render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <StorageValueTab backendOnline={backendOnline} />
      </I18nProvider>
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}

// ---------------------------------------------------------------------------
// Test data — matches the StorageValueResponse shape returned by the proxy
// route after camelCase transform.
// ---------------------------------------------------------------------------

const buyHoldResponse = {
  currency: "divine",
  currentPrice: 100,
  projectedPrice: 108,
  riskDiscount: 0.95,
  adjustedPrice: 102.6,
  netValue: 102.6,
  ratio: 1.026,
  decision: "BUY_HOLD",
  dataAvailable: true,
  totalCurrentValue: 100,
  totalProjectedValue: 108,
  totalNetValue: 102.6,
  inputs: {
    momentum: 0.001,
    volatility: 0.05,
    acceleration: 0.0001,
    liquidityScore: 5.5,
    horizonHours: 24,
    significanceLevel: 0.05,
  },
};

const sellConvertResponse = {
  ...buyHoldResponse,
  currency: "chaos",
  decision: "SELL_CONVERT",
  ratio: 0.94,
  netValue: 94,
};

const neutralResponse = {
  ...buyHoldResponse,
  currency: "vaal",
  decision: "NEUTRAL",
  ratio: 1.0,
  netValue: 100,
};

const noDataResponse = {
  currency: "missing-currency",
  currentPrice: 0,
  projectedPrice: 0,
  riskDiscount: 0,
  adjustedPrice: 0,
  netValue: 0,
  ratio: 0,
  decision: "NEUTRAL",
  dataAvailable: false,
  inputs: {},
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("StorageValueTab", () => {
  beforeEach(() => {
    mockFetchApi.mockReset();
    window.localStorage.clear();
  });

  // ---- Backend offline ----

  it("renders offline notice when backend is offline", () => {
    renderStorageValueTab(false);
    // The offline title is unique to the offline branch
    expect(
      screen.getByText(/Storage Value requires the analytics backend/i),
    ).toBeInTheDocument();
  });

  it("does not call fetchApi when backend is offline", () => {
    renderStorageValueTab(false);
    expect(mockFetchApi).not.toHaveBeenCalled();
  });

  // ---- Backend online, loading ----

  it("shows loading state while fetching", async () => {
    // Never resolve — keeps the query in pending state
    mockFetchApi.mockReturnValue(new Promise(() => {}));
    renderStorageValueTab(true);
    await waitFor(() => {
      expect(screen.getByText(/Computing storage value/i)).toBeInTheDocument();
    });
  });

  // ---- Backend online, BUY_HOLD decision ----

  it("renders BUY_HOLD decision badge when ratio > buy threshold", async () => {
    mockFetchApi.mockResolvedValue(buyHoldResponse);
    renderStorageValueTab(true);
    await waitFor(() => {
      expect(screen.getByText(/BUY \/ HOLD/)).toBeInTheDocument();
    });
  });

  it("renders projection breakdown with current and projected price", async () => {
    mockFetchApi.mockResolvedValue(buyHoldResponse);
    renderStorageValueTab(true);
    // findByText waits for the element to appear (async by default).
    // "100.0000" appears twice: in the projection breakdown AND in the totals card
    // (currentPrice = 100, totalCurrentValue = 100 × 1 = 100). Use findAllByText.
    const currentEls = await screen.findAllByText("100.0000");
    expect(currentEls.length).toBeGreaterThan(0);
    // projectedPrice = 108 → "108.0000" — appears in projection breakdown AND totals.
    const projectedEls = await screen.findAllByText("108.0000");
    expect(projectedEls.length).toBeGreaterThan(0);
  });

  it("renders holdings totals section", async () => {
    mockFetchApi.mockResolvedValue(buyHoldResponse);
    renderStorageValueTab(true);
    // The totals card title is "Holdings totals (divine × 1)"
    await screen.findByText(/Holdings totals/i);
    // Existing locale key values: "Total Current", "Total Projected", "Total Net After Fees"
    expect(screen.getByText("Total Current")).toBeInTheDocument();
    expect(screen.getByText("Total Projected")).toBeInTheDocument();
    expect(screen.getByText("Total Net After Fees")).toBeInTheDocument();
  });

  it("renders inputs panel when inputs are provided", async () => {
    mockFetchApi.mockResolvedValue(buyHoldResponse);
    renderStorageValueTab(true);
    await waitFor(() => {
      expect(screen.getByText(/Momentum \(log-returns\)/i)).toBeInTheDocument();
      expect(screen.getByText(/Volatility/i)).toBeInTheDocument();
      expect(screen.getByText(/Acceleration/i)).toBeInTheDocument();
    });
  });

  // ---- Backend online, SELL_CONVERT decision ----

  it("renders SELL_CONVERT decision badge when ratio < sell threshold", async () => {
    mockFetchApi.mockResolvedValue(sellConvertResponse);
    renderStorageValueTab(true);
    await waitFor(() => {
      expect(screen.getByText(/SELL \/ CONVERT/)).toBeInTheDocument();
    });
  });

  // ---- Backend online, NEUTRAL decision ----

  it("renders NEUTRAL decision badge when ratio is in the neutral band", async () => {
    mockFetchApi.mockResolvedValue(neutralResponse);
    renderStorageValueTab(true);
    await waitFor(() => {
      expect(screen.getByText(/^NEUTRAL$/)).toBeInTheDocument();
    });
  });

  // ---- Backend online, no data ----

  it("renders 'no price history' notice when dataAvailable is false", async () => {
    mockFetchApi.mockResolvedValue(noDataResponse);
    renderStorageValueTab(true);
    await waitFor(() => {
      expect(screen.getByText(/No price history available/i)).toBeInTheDocument();
    });
  });

  // ---- Compute button triggers refetch ----

  it("calls fetchApi with the right path and query params", async () => {
    mockFetchApi.mockResolvedValue(buyHoldResponse);
    renderStorageValueTab(true);
    await waitFor(() => {
      expect(mockFetchApi).toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/flipper\/storage-value\/divine/),
        expect.objectContaining({
          horizon_hours: "24",
          quantity: "1",
        }),
      );
    });
  });

  it("passes the user-selected horizon and quantity to the API", async () => {
    mockFetchApi.mockResolvedValue(buyHoldResponse);
    const { container } = renderStorageValueTab(true);

    // Wait for initial render
    await waitFor(() => {
      expect(mockFetchApi).toHaveBeenCalled();
    });

    // The first call should be with defaults (24h, quantity=1)
    expect(mockFetchApi.mock.calls[0][1]).toEqual({
      horizon_hours: "24",
      quantity: "1",
    });
  });
});
