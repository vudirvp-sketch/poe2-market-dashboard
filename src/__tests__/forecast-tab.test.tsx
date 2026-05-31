// ============================================================================
// Unit tests for ForecastTab — Price forecasts, anomaly detection,
// storage value decisions. Tests rendering with backend online/offline,
// currency selection, and data display states.
// ============================================================================
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@/lib/i18n";
import { ForecastTab } from "@/components/dashboard/forecast-tab";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetchApi = jest.fn();
jest.mock("@/lib/types", () => ({
  ...jest.requireActual("@/lib/types"),
  fetchApi: (...args: unknown[]) => mockFetchApi(...args),
}));

// Mock recharts to avoid rendering issues in jsdom
jest.mock("recharts", () => ({
  AreaChart: ({ children }: { children: React.ReactNode }) => <div data-testid="area-chart">{children}</div>,
  Area: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Legend: () => null,
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

function renderForecastTab(backendOnline: boolean = true) {
  const queryClient = createTestQueryClient();
  // Set locale to English for consistent test assertions
  window.localStorage.setItem("poe2-locale", "en");

  const result = render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <ForecastTab backendOnline={backendOnline} />
      </I18nProvider>
    </QueryClientProvider>
  );
  return { ...result, queryClient };
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const mockPhaseData = {
  phase: "mid",
  days_since_reference: 14,
  reference_currency: "exalted",
  recommended_strategy: "balanced",
  min_spread_after_fees: 0.05,
  max_hold_time: "2h",
};

const mockForecastData = {
  currency: "divine",
  horizon: 24,
  models: {
    sarima: {
      currency: "divine",
      model_name: "sarima",
      point_forecast: [1.2, 1.25, 1.3, 1.28],
      ci_lower: [1.1, 1.15, 1.2, 1.18],
      ci_upper: [1.3, 1.35, 1.4, 1.38],
      timestamps: [
        "2025-01-01T00:00:00Z",
        "2025-01-01T06:00:00Z",
        "2025-01-01T12:00:00Z",
        "2025-01-01T18:00:00Z",
      ],
      low_confidence: false,
      disagreement: false,
      mape: 0.05,
    },
  },
  disagreement: false,
  low_confidence: false,
  is_event_active: false,
  data_points: 50,
  fetched_at: "2025-01-01T00:00:00Z",
};

const mockAnomaliesData = {
  anomalies: [
    {
      currency: "chaos",
      alert_score: 0.8,
      triggered_indicators: ["rsi", "macd"],
      direction: "up",
      is_confirmed: true,
      timestamp: "2025-01-01T00:00:00Z",
    },
  ],
  count: 1,
  currencies_checked: 10,
  min_alert_score: 0.5,
};

const mockStorageData = {
  currency: "divine",
  current_price: 1.5,
  projected_price: 1.65,
  risk_discount: 0.05,
  adjusted_price: 1.57,
  net_value_after_fees: 1.48,
  ratio: 1.05,
  decision: "HOLD",
  inputs: {
    momentum: 0.02,
    volatility: 0.15,
    acceleration: 0.01,
    liquidity_score: 0.8,
    gold_fee_fraction: 0.02,
    horizon_hours: 24,
    confidence_level: 0.95,
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ForecastTab", () => {
  beforeEach(() => {
    mockFetchApi.mockReset();
    window.localStorage.clear();
  });

  // ---- Backend offline ----

  it("renders backend offline message when backend is offline", () => {
    renderForecastTab(false);
    // Should show the offline card with uvicorn command (may appear multiple times)
    expect(screen.getAllByText(/uvicorn backend.main:app/).length).toBeGreaterThan(0);
  });

  it("shows offline status indicator when backend is offline", () => {
    renderForecastTab(false);
    // The component shows its own inline offline message (not FlipperBackendStatusCard)
    expect(screen.getByText(/Backend offline/i)).toBeInTheDocument();
  });

  // ---- Backend online with data ----

  it("renders phase info when backend is online", async () => {
    mockFetchApi.mockImplementation((url: string) => {
      if (url.includes("/phase")) return Promise.resolve(mockPhaseData);
      if (url.includes("/forecast/")) return Promise.resolve(mockForecastData);
      if (url.includes("/anomalies")) return Promise.resolve(mockAnomaliesData);
      if (url.includes("/storage-value/")) return Promise.resolve(mockStorageData);
      return Promise.resolve({});
    });

    renderForecastTab(true);

    // Phase info should be displayed
    await waitFor(() => {
      expect(screen.getByText("mid")).toBeInTheDocument();
    });
  });

  it("renders forecast title with selected currency", async () => {
    mockFetchApi.mockImplementation((url: string) => {
      if (url.includes("/phase")) return Promise.resolve(mockPhaseData);
      if (url.includes("/forecast/")) return Promise.resolve(mockForecastData);
      if (url.includes("/anomalies")) return Promise.resolve(mockAnomaliesData);
      if (url.includes("/storage-value/")) return Promise.resolve(mockStorageData);
      return Promise.resolve({});
    });

    renderForecastTab(true);

    await waitFor(() => {
      expect(screen.getByText(/Price Forecast for/i)).toBeInTheDocument();
    });
  });

  // ---- Loading states ----

  it("shows loading skeleton while data is being fetched", () => {
    mockFetchApi.mockImplementation(() => new Promise(() => {})); // Never resolves

    renderForecastTab(true);

    const skeletons = document.querySelectorAll('[class*="animate-pulse"]');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  // ---- Empty data ----

  it("shows no-data state when forecast returns empty models", async () => {
    mockFetchApi.mockImplementation((url: string) => {
      if (url.includes("/phase")) return Promise.resolve(mockPhaseData);
      if (url.includes("/forecast/")) return Promise.resolve({
        ...mockForecastData,
        models: {},
      });
      if (url.includes("/anomalies")) return Promise.resolve({ anomalies: [], count: 0, currencies_checked: 0, min_alert_score: 0.5 });
      if (url.includes("/storage-value/")) return Promise.resolve(null);
      return Promise.resolve({});
    });

    renderForecastTab(true);

    // Wait for the chart area to show no-data state (backend online, no chart data)
    // The no-data state shows an AlertTriangle icon + message
    await waitFor(() => {
      // Check for the data_points count from forecast response (which is "50 data points" text)
      // or the "data points" text in the chart header
      const noDataState = document.querySelector(".text-center.py-10");
      expect(noDataState).toBeTruthy();
    });
  });

  // ---- No anomalies ----

  it("shows stable market message when no anomalies detected", async () => {
    mockFetchApi.mockImplementation((url: string) => {
      if (url.includes("/phase")) return Promise.resolve(mockPhaseData);
      if (url.includes("/forecast/")) return Promise.resolve(mockForecastData);
      if (url.includes("/anomalies")) return Promise.resolve({ anomalies: [], count: 0, currencies_checked: 10, min_alert_score: 0.5 });
      if (url.includes("/storage-value/")) return Promise.resolve(mockStorageData);
      return Promise.resolve({});
    });

    renderForecastTab(true);

    await waitFor(() => {
      expect(screen.getByText(/No anomalies detected/i)).toBeInTheDocument();
    });
  });

  // ---- Storage value decision ----

  it("displays HOLD decision with appropriate styling", async () => {
    mockFetchApi.mockImplementation((url: string) => {
      if (url.includes("/phase")) return Promise.resolve(mockPhaseData);
      if (url.includes("/forecast/")) return Promise.resolve(mockForecastData);
      if (url.includes("/anomalies")) return Promise.resolve({ anomalies: [], count: 0, currencies_checked: 10, min_alert_score: 0.5 });
      if (url.includes("/storage-value/")) return Promise.resolve({ ...mockStorageData, decision: "HOLD" });
      return Promise.resolve({});
    });

    renderForecastTab(true);

    await waitFor(() => {
      expect(screen.getByText("HOLD")).toBeInTheDocument();
    });
  });

  it("displays SELL decision with appropriate styling", async () => {
    mockFetchApi.mockImplementation((url: string) => {
      if (url.includes("/phase")) return Promise.resolve(mockPhaseData);
      if (url.includes("/forecast/")) return Promise.resolve(mockForecastData);
      if (url.includes("/anomalies")) return Promise.resolve({ anomalies: [], count: 0, currencies_checked: 10, min_alert_score: 0.5 });
      if (url.includes("/storage-value/")) return Promise.resolve({ ...mockStorageData, decision: "SELL" });
      return Promise.resolve({});
    });

    renderForecastTab(true);

    await waitFor(() => {
      expect(screen.getByText("SELL")).toBeInTheDocument();
    });
  });

  // ---- Model flags ----

  it("shows disagreement badge when models disagree", async () => {
    mockFetchApi.mockImplementation((url: string) => {
      if (url.includes("/phase")) return Promise.resolve(mockPhaseData);
      if (url.includes("/forecast/")) return Promise.resolve({ ...mockForecastData, disagreement: true });
      if (url.includes("/anomalies")) return Promise.resolve({ anomalies: [], count: 0, currencies_checked: 10, min_alert_score: 0.5 });
      if (url.includes("/storage-value/")) return Promise.resolve(mockStorageData);
      return Promise.resolve({});
    });

    renderForecastTab(true);

    await waitFor(() => {
      expect(screen.getByText("Model Disagreement")).toBeInTheDocument();
    });
  });

  it("shows low confidence badge when forecast is low confidence", async () => {
    mockFetchApi.mockImplementation((url: string) => {
      if (url.includes("/phase")) return Promise.resolve(mockPhaseData);
      if (url.includes("/forecast/")) return Promise.resolve({ ...mockForecastData, low_confidence: true });
      if (url.includes("/anomalies")) return Promise.resolve({ anomalies: [], count: 0, currencies_checked: 10, min_alert_score: 0.5 });
      if (url.includes("/storage-value/")) return Promise.resolve(mockStorageData);
      return Promise.resolve({});
    });

    renderForecastTab(true);

    await waitFor(() => {
      expect(screen.getByText("Low Confidence")).toBeInTheDocument();
    });
  });

  // ---- Anomaly details ----

  it("renders anomaly details with currency name", async () => {
    mockFetchApi.mockImplementation((url: string) => {
      if (url.includes("/phase")) return Promise.resolve(mockPhaseData);
      if (url.includes("/forecast/")) return Promise.resolve(mockForecastData);
      if (url.includes("/anomalies")) return Promise.resolve(mockAnomaliesData);
      if (url.includes("/storage-value/")) return Promise.resolve(mockStorageData);
      return Promise.resolve({});
    });

    renderForecastTab(true);

    await waitFor(() => {
      expect(screen.getByText("chaos")).toBeInTheDocument();
    });
  });

  it("renders confirmed badge on confirmed anomaly", async () => {
    mockFetchApi.mockImplementation((url: string) => {
      if (url.includes("/phase")) return Promise.resolve(mockPhaseData);
      if (url.includes("/forecast/")) return Promise.resolve(mockForecastData);
      if (url.includes("/anomalies")) return Promise.resolve(mockAnomaliesData);
      if (url.includes("/storage-value/")) return Promise.resolve(mockStorageData);
      return Promise.resolve({});
    });

    renderForecastTab(true);

    await waitFor(() => {
      expect(screen.getByText("Confirmed")).toBeInTheDocument();
    });
  });

  // ---- Currency selector ----

  it("renders currency selector combobox", () => {
    mockFetchApi.mockImplementation(() => new Promise(() => {}));
    renderForecastTab(true);

    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  // ---- Refresh button ----

  it("renders refresh button when backend is online", () => {
    mockFetchApi.mockImplementation(() => new Promise(() => {}));
    renderForecastTab(true);

    expect(screen.getByLabelText(/Refresh data/i)).toBeInTheDocument();
  });

  it("does not render refresh button when backend is offline", () => {
    renderForecastTab(false);

    expect(screen.queryByLabelText(/Refresh data/i)).not.toBeInTheDocument();
  });

  // ---- Error handling ----

  it("renders forecast chart card even when forecast fetch fails", async () => {
    mockFetchApi.mockImplementation((url: string) => {
      if (url.includes("/phase")) return Promise.resolve(mockPhaseData);
      if (url.includes("/forecast/")) return Promise.reject(new Error("Network error"));
      if (url.includes("/anomalies")) return Promise.resolve({ anomalies: [], count: 0, currencies_checked: 0, min_alert_score: 0.5 });
      if (url.includes("/storage-value/")) return Promise.resolve(null);
      return Promise.resolve({});
    });

    renderForecastTab(true);

    // When forecast fails, the chart card still renders but shows an error message
    // Check for the forecast title card (which always renders regardless of error)
    await waitFor(() => {
      // The phase data should have loaded successfully
      expect(screen.getByText("mid")).toBeInTheDocument();
    });

    // The chart card should exist (even if it shows an error state inside)
    const chartCards = document.querySelectorAll('[data-slot="card"]');
    expect(chartCards.length).toBeGreaterThan(0);
  });

  // ---- Storage value inputs ----

  it("renders storage value input metrics", async () => {
    mockFetchApi.mockImplementation((url: string) => {
      if (url.includes("/phase")) return Promise.resolve(mockPhaseData);
      if (url.includes("/forecast/")) return Promise.resolve(mockForecastData);
      if (url.includes("/anomalies")) return Promise.resolve({ anomalies: [], count: 0, currencies_checked: 10, min_alert_score: 0.5 });
      if (url.includes("/storage-value/")) return Promise.resolve(mockStorageData);
      return Promise.resolve({});
    });

    renderForecastTab(true);

    await waitFor(() => {
      expect(screen.getByText(/Momentum/i)).toBeInTheDocument();
      expect(screen.getByText(/Volatility/i)).toBeInTheDocument();
    });
  });
});
