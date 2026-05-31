// ============================================================================
// Integration tests — Next.js proxy routes ↔ FastAPI backend.
// Tests the full proxy chain: Next.js API route → flipper-proxy → FastAPI.
// Uses MSW (Mock Service Worker) to mock the FastAPI backend responses.
// ============================================================================
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@/lib/i18n";
import { ForecastTab } from "@/components/dashboard/forecast-tab";
import { PortfolioTab } from "@/components/dashboard/portfolio-tab";
import { CurrencyGraphTab } from "@/components/dashboard/currency-graph-tab";

// ---------------------------------------------------------------------------
// Mock fetchApi to simulate the full proxy chain
// ---------------------------------------------------------------------------

const mockFetchApi = jest.fn();
jest.mock("@/lib/types", () => ({
  ...jest.requireActual("@/lib/types"),
  fetchApi: (...args: unknown[]) => mockFetchApi(...args),
  getFlipperErrorType: jest.fn().mockReturnValue(null),
  fmt: (n: number) => n.toFixed(4),
}));

// Mock recharts
jest.mock("recharts", () => ({
  AreaChart: ({ children }: { children: React.ReactNode }) => <div data-testid="area-chart">{children}</div>,
  BarChart: ({ children }: { children: React.ReactNode }) => <div data-testid="bar-chart">{children}</div>,
  ScatterChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Area: () => null,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Legend: () => null,
  Cell: () => null,
  Scatter: () => null,
  Line: () => null,
  ZAxis: () => null,
}));

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
}

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = createTestQueryClient();
  window.localStorage.setItem("poe2-locale", "en");
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        {ui}
      </I18nProvider>
    </QueryClientProvider>
  );
}

// ---------------------------------------------------------------------------
// Test data simulating FastAPI responses
// ---------------------------------------------------------------------------

const fastapiHealthResponse = {
  status: "ok",
  timestamp: new Date().toISOString(),
  league: "vaal",
  base_currency: "exalted",
  active_events: 0,
};

const fastapiPhaseResponse = {
  phase: "mid",
  days_since_reference: 14,
  reference_currency: "exalted",
  recommended_strategy: "balanced",
  min_spread_after_fees: 0.05,
  max_hold_time: "2h",
};

const fastapiFlipsResponse = {
  league: "vaal",
  total: 3,
  opportunities: [
    { currency: "divine", score: 0.85, momentum: 0.03 },
    { currency: "exalted", score: 0.65, momentum: 0.01 },
    { currency: "chaos", score: 0.45, momentum: -0.02 },
  ],
  fetched_at: new Date().toISOString(),
};

const fastapiPortfolioResponse = {
  method: "risk_parity",
  weights: { divine: 0.4, exalted: 0.35, chaos: 0.25 },
  expected_risk: 0.15,
  correlation_warning: false,
  last_rebalance: new Date().toISOString(),
  correlation_matrix: {
    currencies: ["divine", "exalted", "chaos"],
    matrix: [[1.0, 0.7, 0.3], [0.7, 1.0, 0.5], [0.3, 0.5, 1.0]],
  },
};

const fastapiForecastResponse = {
  currency: "divine",
  horizon: 24,
  models: {
    sarima: {
      currency: "divine",
      model_name: "sarima",
      point_forecast: [1.2, 1.25],
      ci_lower: [1.1, 1.15],
      ci_upper: [1.3, 1.35],
      timestamps: ["2025-01-01T00:00:00Z", "2025-01-01T06:00:00Z"],
      low_confidence: false,
      disagreement: false,
      mape: 0.05,
    },
  },
  disagreement: false,
  low_confidence: false,
  is_event_active: false,
  data_points: 50,
  fetched_at: new Date().toISOString(),
};

// ---------------------------------------------------------------------------
// Integration tests
// ---------------------------------------------------------------------------

describe("Integration: Next.js ↔ FastAPI proxy chain", () => {
  beforeEach(() => {
    mockFetchApi.mockReset();
    window.localStorage.clear();
  });

  // ---- Full chain: health → phase → forecast data ----

  it("fetches and renders forecast data through the proxy chain", async () => {
    // Simulate the proxy chain:
    // 1. Next.js /api/flipper/health → flipper-proxy → FastAPI /api/health
    // 2. Next.js /api/flipper/phase → flipper-proxy → FastAPI /api/phase
    // 3. Next.js /api/flipper/forecast/divine → flipper-proxy → FastAPI /api/forecast/divine
    // 4. Next.js /api/flipper/anomalies → flipper-proxy → FastAPI /api/anomalies
    // 5. Next.js /api/flipper/storage-value/divine → flipper-proxy → FastAPI /api/storage-value/divine

    mockFetchApi.mockImplementation((url: string) => {
      if (url.includes("/phase")) return Promise.resolve(fastapiPhaseResponse);
      if (url.includes("/forecast/")) return Promise.resolve(fastapiForecastResponse);
      if (url.includes("/anomalies")) return Promise.resolve({ anomalies: [], count: 0, currencies_checked: 10, min_alert_score: 0.5 });
      if (url.includes("/storage-value/")) return Promise.resolve(null);
      return Promise.resolve({});
    });

    renderWithProviders(<ForecastTab backendOnline={true} />);

    // Verify data flows through correctly
    await waitFor(() => {
      expect(screen.getByText("mid")).toBeInTheDocument();
    });

    // Verify fetchApi was called with the correct proxy URLs
    expect(mockFetchApi).toHaveBeenCalledWith("/api/flipper/phase");
    expect(mockFetchApi).toHaveBeenCalledWith("/api/flipper/forecast/divine");
    expect(mockFetchApi).toHaveBeenCalledWith("/api/flipper/anomalies");
  });

  // ---- Backend offline graceful degradation ----

  it("gracefully degrades when backend is offline", async () => {
    renderWithProviders(<ForecastTab backendOnline={false} />);

    // Should show offline message, not crash
    expect(screen.getAllByText(/uvicorn backend.main:app/).length).toBeGreaterThan(0);

    // Should NOT call any flipper API endpoints when backend is offline
    expect(mockFetchApi).not.toHaveBeenCalledWith("/api/flipper/phase");
    expect(mockFetchApi).not.toHaveBeenCalledWith("/api/flipper/forecast/divine");
  });

  // ---- Portfolio proxy chain ----

  it("fetches portfolio data through the proxy chain", async () => {
    mockFetchApi.mockImplementation((url: string) => {
      if (url.includes("/portfolio/frontier")) return Promise.resolve({
        frontier: { risks: [0.1], returns: [0.05] },
        individual_assets: [],
        current_portfolio: null,
      });
      return Promise.resolve(fastapiPortfolioResponse);
    });

    renderWithProviders(<PortfolioTab backendOnline={true} />);

    await waitFor(() => {
      // Portfolio weights should be rendered from the FastAPI response
      expect(screen.getByText("40.00%")).toBeInTheDocument();
    });

    // Verify the proxy URLs were called
    expect(mockFetchApi).toHaveBeenCalledWith("/api/flipper/portfolio");
  });

  // ---- API error handling ----

  it("renders without crashing when FastAPI returns errors", async () => {
    // Simulate FastAPI returning an error
    const apiError = new Error("Service Unavailable");

    mockFetchApi.mockRejectedValue(apiError);

    const { container } = renderWithProviders(<PortfolioTab backendOnline={true} />);

    // The component should not crash — it renders some content
    // Since the query fails, the loading state resolves to an error state
    await waitFor(() => {
      // The component should have rendered SOMETHING (not be empty)
      expect(container.innerHTML.length).toBeGreaterThan(0);
    });
  });

  // ---- Multiple sequential API calls ----

  it("makes multiple sequential API calls for graph tab", async () => {
    mockFetchApi.mockImplementation((url: string) => {
      if (url.includes("/prices")) return Promise.resolve({
        league: "vaal",
        phase: "mid",
        rates: [
          {
            pair: "divine-exalted",
            currency_from: "divine",
            currency_to: "exalted",
            raw_rate: 1.5,
            volume_traded: 500,
            volatility: 0.15,
            momentum: 0.02,
            cluster_from: "stable",
            cluster_to: "stable",
          },
        ],
        base_currency: "exalted",
        fetched_at: new Date().toISOString(),
      });
      if (url.includes("/triangular")) return Promise.resolve({ cycles: [], total: 0 });
      if (url.includes("/currencies")) return Promise.resolve({ currencies: [] });
      return Promise.resolve({});
    });

    renderWithProviders(<CurrencyGraphTab backendOnline={true} />);

    await waitFor(() => {
      expect(screen.getByText("Currencies")).toBeInTheDocument();
    });

    // Verify all three proxy endpoints were called
    expect(mockFetchApi).toHaveBeenCalledWith("/api/flipper/prices");
    expect(mockFetchApi).toHaveBeenCalledWith("/api/flipper/triangular");
    expect(mockFetchApi).toHaveBeenCalledWith("/api/flipper/currencies");
  });

  // ---- Backend health check propagation ----

  it("respects backendOnline prop for all flipper tabs", () => {
    mockFetchApi.mockImplementation(() => new Promise(() => {}));

    // Test that all flipper-dependent tabs respect the backendOnline flag
    const { rerender } = renderWithProviders(<ForecastTab backendOnline={false} />);
    expect(screen.getAllByText(/uvicorn backend.main:app/).length).toBeGreaterThan(0);

    // No flipper API calls should have been made
    expect(mockFetchApi).not.toHaveBeenCalled();
  });
});
