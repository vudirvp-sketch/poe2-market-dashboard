// ============================================================================
// Unit tests for PhaseHintsWidget (F6, iter 78) — "League Phase Hints".
//
// Coverage:
//   - Backend offline → renders compact offline notice (no full-card takeover)
//   - Loading state → renders loading text
//   - Error state → renders error + refresh button
//   - data_available=false → renders "no data" notice
//   - data_available=true with hints → renders hint list with title/detail/action
//   - Each hint renders its bullet, title, detail, action with "Action:" label
//   - Phase badge renders with correct phase label (Early/Mid/Late/Unknown)
//   - Day count renders with CalendarClock icon
//   - Reference currency renders when present
//   - Hint count + fetched-at footer renders
//   - Refresh button visible when data is shown
//   - Empty hints list renders "no hints" notice
//   - Proxy path /api/flipper/phase-hints is used
// ============================================================================
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@/lib/i18n";
import { PhaseHintsWidget } from "@/components/dashboard/phase-hints-widget";
import type { PhaseHintsResponse, PhaseHint } from "@/lib/types";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetchApi = jest.fn();
jest.mock("@/lib/types", () => ({
  ...jest.requireActual("@/lib/types"),
  fetchApi: (...args: unknown[]) => mockFetchApi(...args),
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

// React Query v5: per-query `retry: 1` in the widget overrides the client default.
// For error-state tests we use a longer waitFor timeout to allow the single
// retry to settle before asserting the error branch.
const ERROR_WAIT_OPTS = { timeout: 5000 };

function renderWidget(backendOnline: boolean = true) {
  const queryClient = createTestQueryClient();
  window.localStorage.setItem("poe2-locale", "en");
  const result = render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <PhaseHintsWidget backendOnline={backendOnline} />
      </I18nProvider>
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}

// ---------------------------------------------------------------------------
// Test data — matches the PhaseHintsResponse shape returned by the proxy
// route after camelCase transform.
// ---------------------------------------------------------------------------

function makeHint(overrides: Partial<PhaseHint> = {}): PhaseHint {
  return {
    id: "mid-skill-gems-18-20",
    title: "Skill gems 18-20 lvl — demand rising",
    detail:
      "Builds are stabilizing and players are min-maxing — demand for high-level skill gems typically peaks in MID phase.",
    action: "List 18-20 lvl gems at market; check z-score in Speculation tab.",
    category: "uncutgems",
    // iter 110: live-price fields default to null/empty (static-only hint)
    trackedCurrency: "",
    currentPrice: null,
    changePctWeek: null,
    changePctMonth: null,
    momentum: null,
    recommendation: null,
    ...overrides,
  };
}

const mixedResponse: PhaseHintsResponse = {
  league: "Standard",
  phase: "mid",
  phaseLabel: "Mid League",
  daysSinceReference: 25,
  referenceCurrency: "divine",
  phaseSummary:
    "Weeks 3-6. Liquidity deepens, spreads tighten. Best window for triangular arbitrage and scaling into high-level skill gems.",
  hints: [
    makeHint({ id: "mid-skill-gems-18-20", title: "Skill gems 18-20 lvl — demand rising" }),
    makeHint({
      id: "mid-temporalis-rising",
      title: "Temporalis price rising",
      detail:
        "First wave of dedicated farmers reaches endgame — Temporalis prices typically climb through MID phase as supply tightens.",
      action: "Hold Temporalis if you have it; do not sell into weakness yet.",
      category: "",
    }),
    makeHint({
      id: "mid-triangular-arb",
      title: "Triangular arbitrage window",
      detail:
        "Mid-league has the deepest liquidity across all currency tiers — spreads are tight enough for triangular arb to be profitable after fees.",
      action: "Check the Arbitrage → Triangular tab for 3-hop cycles.",
      category: "currency",
    }),
    makeHint({
      id: "mid-breach-ritual-equilibrium",
      title: "Breach / Ritual catalysts in equilibrium",
      detail:
        "Mechanic popularity is balanced — neither Breach nor Ritual catalysts are scarce. Prices track overall inflation.",
      action: "Watch Content Pulse for the first sign of volume divergence.",
      category: "breach",
    }),
  ],
  dataAvailable: true,
  fetchedAt: new Date("2026-06-25T12:00:00Z").toISOString(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PhaseHintsWidget", () => {
  beforeEach(() => {
    mockFetchApi.mockReset();
  });

  // ---- Backend offline ----
  it("renders offline notice when backend is offline", async () => {
    renderWidget(false);
    // Widget should not call fetchApi when backend is offline
    expect(mockFetchApi).not.toHaveBeenCalled();
    expect(
      await screen.findByText("Phase hints require the analytics backend."),
    ).toBeInTheDocument();
  });

  it("renders the widget title when backend is offline", async () => {
    renderWidget(false);
    expect(await screen.findByText("League Phase Hints")).toBeInTheDocument();
  });

  // ---- Loading ----
  it("renders loading text while fetching", async () => {
    mockFetchApi.mockReturnValue(new Promise(() => {})); // never resolves
    renderWidget(true);
    expect(await screen.findByText("Loading phase hints...")).toBeInTheDocument();
  });

  // ---- Error ----
  it("renders error message and refresh button on fetch failure", async () => {
    mockFetchApi.mockRejectedValue(new Error("network error"));
    renderWidget(true);
    expect(
      await screen.findByText(
        "Failed to load phase hints. The backend may be experiencing issues.",
        {},
        ERROR_WAIT_OPTS,
      ),
    ).toBeInTheDocument();
    // Refresh button should be present
    const refreshButtons = screen.getAllByLabelText("Refresh");
    expect(refreshButtons.length).toBeGreaterThan(0);
  });

  it("re-fetches when refresh button is clicked after error", async () => {
    // Widget has retry: 1, so initial rejection triggers a retry → 2 calls
    // before the error state is shown. Then refresh → 3 calls.
    //
    // iter 87: The widget now forwards a `lang` query param. On mount the
    // default locale ("ru") triggers fetch 1 + retry = 2 calls. After
    // hydration the stored "en" locale changes the queryKey and triggers
    // fetch 3 + retry = 2 more calls (total 4). Then refresh → 5 calls.
    // To keep the test deterministic we just assert the count grows after
    // the refresh click (≥1 new call) instead of pinning the exact number.
    mockFetchApi.mockRejectedValue(new Error("network error"));
    renderWidget(true);

    // Wait for the error state (initial fetch + retry + hydration-refetch)
    await screen.findByText(
      "Failed to load phase hints. The backend may be experiencing issues.",
      {},
      ERROR_WAIT_OPTS,
    );
    const callsBeforeRefresh = mockFetchApi.mock.calls.length;
    expect(callsBeforeRefresh).toBeGreaterThanOrEqual(2);

    // Click refresh — should trigger another fetch attempt
    mockFetchApi.mockResolvedValue(mixedResponse);
    const refreshButtons = screen.getAllByLabelText("Refresh");
    fireEvent.click(refreshButtons[0]);

    await waitFor(() => {
      expect(mockFetchApi.mock.calls.length).toBeGreaterThan(callsBeforeRefresh);
    });
  });

  // ---- No data ----
  it("renders no-data notice when data_available is false", async () => {
    mockFetchApi.mockResolvedValue({
      ...mixedResponse,
      dataAvailable: false,
      hints: [],
      phase: "unknown",
      phaseLabel: "Unknown Phase",
    });
    renderWidget(true);
    expect(
      await screen.findByText(
        "Phase hints are not available — the PhaseDetector could not determine the current league phase.",
      ),
    ).toBeInTheDocument();
  });

  // ---- Main render: hints list ----
  it("renders the widget title and phase summary when data is available", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderWidget(true);
    expect(await screen.findByText("League Phase Hints")).toBeInTheDocument();
    expect(
      await screen.findByText(
        "Weeks 3-6. Liquidity deepens, spreads tighten. Best window for triangular arbitrage and scaling into high-level skill gems.",
      ),
    ).toBeInTheDocument();
  });

  it("renders the phase badge with the correct label", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderWidget(true);
    expect(await screen.findByText("Mid League")).toBeInTheDocument();
  });

  it("renders the day count with the days_since_reference value", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderWidget(true);
    expect(await screen.findByText("Day 25")).toBeInTheDocument();
  });

  it("renders the reference currency when present", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderWidget(true);
    // The reference currency label is part of a span that includes the
    // translated prefix (e.g. "ref: divine"). Use substring match.
    expect(
      await screen.findByText(/ref:\s*divine/),
    ).toBeInTheDocument();
  });

  it("renders all hints with their titles", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderWidget(true);
    expect(
      await screen.findByText("Skill gems 18-20 lvl — demand rising"),
    ).toBeInTheDocument();
    expect(await screen.findByText("Temporalis price rising")).toBeInTheDocument();
    expect(await screen.findByText("Triangular arbitrage window")).toBeInTheDocument();
    expect(
      await screen.findByText("Breach / Ritual catalysts in equilibrium"),
    ).toBeInTheDocument();
  });

  it("renders hint details (one-sentence explanations)", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderWidget(true);
    expect(
      await screen.findByText(
        "Builds are stabilizing and players are min-maxing — demand for high-level skill gems typically peaks in MID phase.",
      ),
    ).toBeInTheDocument();
  });

  it("renders hint actions with 'Action:' label", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderWidget(true);
    expect(
      await screen.findByText("List 18-20 lvl gems at market; check z-score in Speculation tab."),
    ).toBeInTheDocument();
    // Multiple "Action:" labels (one per hint). The label is in a span with
    // trailing ": " so use substring match.
    const actionLabels = screen.getAllByText(/Action/);
    expect(actionLabels.length).toBe(4);
  });

  it("renders a bullet character for each hint", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    const { container } = renderWidget(true);
    // Wait for hints to render
    await screen.findByText("Skill gems 18-20 lvl — demand rising");
    const bullets = container.querySelectorAll('[data-testid^="phase-hint-"][data-testid$="-bullet"]');
    expect(bullets.length).toBe(4);
  });

  it("renders the hint count in the footer", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderWidget(true);
    // Wait for the hints to render first (ensures footer is also rendered)
    await screen.findByText("Skill gems 18-20 lvl — demand rising");
    // The hint count is in the same <p> as the fetched-at timestamp, so use
    // substring match.
    expect(screen.getByText(/4 hints/)).toBeInTheDocument();
  });

  it("renders the fetched-at timestamp in the footer", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderWidget(true);
    // The footer renders "Fetched: {date}" — we just check the prefix
    const footer = await screen.findByText(/Fetched:/);
    expect(footer).toBeInTheDocument();
  });

  it("renders the refresh button when data is shown", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderWidget(true);
    // Wait for data to render
    await screen.findByText("Skill gems 18-20 lvl — demand rising");
    const refreshButtons = screen.getAllByLabelText("Refresh");
    expect(refreshButtons.length).toBeGreaterThan(0);
  });

  // ---- Empty hints list ----
  it("renders 'no hints' notice when data is available but hints list is empty", async () => {
    mockFetchApi.mockResolvedValue({
      ...mixedResponse,
      hints: [],
    });
    renderWidget(true);
    expect(
      await screen.findByText("No advisory hints for the current phase."),
    ).toBeInTheDocument();
  });

  // ---- Phase variants ----
  it("renders Early League badge for phase=early", async () => {
    mockFetchApi.mockResolvedValue({
      ...mixedResponse,
      phase: "early",
      phaseLabel: "Early League",
    });
    renderWidget(true);
    expect(await screen.findByText("Early League")).toBeInTheDocument();
  });

  it("renders Late League badge for phase=late", async () => {
    mockFetchApi.mockResolvedValue({
      ...mixedResponse,
      phase: "late",
      phaseLabel: "Late League",
    });
    renderWidget(true);
    expect(await screen.findByText("Late League")).toBeInTheDocument();
  });

  it("renders Unknown Phase badge when phase is unknown", async () => {
    mockFetchApi.mockResolvedValue({
      ...mixedResponse,
      phase: "unknown",
      phaseLabel: "Unknown Phase",
    });
    renderWidget(true);
    expect(await screen.findByText("Unknown Phase")).toBeInTheDocument();
  });

  // ---- Proxy path ----
  it("uses the /api/flipper/phase-hints proxy path", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderWidget(true);
    await screen.findByText("Skill gems 18-20 lvl — demand rising");
    // iter 87: the widget now forwards a `lang` query param to the proxy
    // so the backend can return the locale-appropriate hint table. The
    // first render uses the default locale ("ru"), then after hydration
    // the stored "en" locale triggers a refetch with `lang=en`.
    expect(mockFetchApi).toHaveBeenCalledWith(
      "/api/flipper/phase-hints",
      expect.objectContaining({ lang: expect.stringMatching(/^(ru|en)$/) }),
    );
  });

  // ---- Hint data-testid ----
  it("renders each hint with a stable data-testid using its id", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    const { container } = renderWidget(true);
    await screen.findByText("Skill gems 18-20 lvl — demand rising");
    expect(container.querySelector('[data-testid="phase-hint-mid-skill-gems-18-20"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="phase-hint-mid-temporalis-rising"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="phase-hint-mid-triangular-arb"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="phase-hint-mid-breach-ritual-equilibrium"]')).toBeTruthy();
  });

  // ---- Main container data-testid ----
  it("renders the main widget container with data-testid", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    const { container } = renderWidget(true);
    await screen.findByText("Skill gems 18-20 lvl — demand rising");
    expect(container.querySelector('[data-testid="phase-hints-widget"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="phase-hints-list"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="phase-hints-phase-badge"]')).toBeTruthy();
  });

  // ---- Refresh click triggers refetch ----
  it("triggers a refetch when refresh button is clicked", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderWidget(true);
    await screen.findByText("Skill gems 18-20 lvl — demand rising");
    // iter 87: the widget now forwards a `lang` query param to the proxy.
    // On mount the default locale ("ru") triggers one fetch, then after
    // hydration the stored "en" locale triggers a second fetch — so we
    // expect 2 calls before the user clicks refresh.
    expect(mockFetchApi).toHaveBeenCalledTimes(2);

    const refreshButtons = screen.getAllByLabelText("Refresh");
    fireEvent.click(refreshButtons[0]);

    await waitFor(() => {
      expect(mockFetchApi).toHaveBeenCalledTimes(3);
    });
  });

  // ---- No reference currency ----
  it("does not render reference currency line when it is empty", async () => {
    mockFetchApi.mockResolvedValue({
      ...mixedResponse,
      referenceCurrency: "",
    });
    renderWidget(true);
    await screen.findByText("Skill gems 18-20 lvl — demand rising");
    expect(screen.queryByText(/ref:/)).not.toBeInTheDocument();
  });

  // ===========================================================================
  // iter 110 — Live-price section rendering (P9 Phase-aware Investment Advisor)
  // ===========================================================================

  describe("iter 110 — live-price section", () => {
    const livePriceResponse: PhaseHintsResponse = {
      ...mixedResponse,
      hints: [
        makeHint({
          id: "mid-triangular-arb",
          title: "Triangular arbitrage window",
          trackedCurrency: "divine",
          currentPrice: 115.5,
          changePctWeek: 12.3,
          changePctMonth: 25.7,
          momentum: "UP",
          recommendation: "HOLD",
        }),
        makeHint({
          id: "mid-skill-gems-18-20",
          // untracked hint — live-price section should NOT render
          trackedCurrency: "",
          currentPrice: null,
          changePctWeek: null,
          momentum: null,
          recommendation: null,
        }),
      ],
    };

    it("renders live-price section when hint has trackedCurrency + currentPrice", async () => {
      mockFetchApi.mockResolvedValue(livePriceResponse);
      const { container } = renderWidget(true);
      await screen.findByText("Triangular arbitrage window");
      const livePriceSection = container.querySelector(
        '[data-testid="phase-hint-mid-triangular-arb-live-price"]',
      );
      expect(livePriceSection).toBeTruthy();
    });

    it("does NOT render live-price section when hint is untracked", async () => {
      mockFetchApi.mockResolvedValue(livePriceResponse);
      const { container } = renderWidget(true);
      await screen.findByText("Triangular arbitrage window");
      const livePriceSection = container.querySelector(
        '[data-testid="phase-hint-mid-skill-gems-18-20-live-price"]',
      );
      expect(livePriceSection).toBeNull();
    });

    it("renders current price with the tracked currency label", async () => {
      mockFetchApi.mockResolvedValue(livePriceResponse);
      const { container } = renderWidget(true);
      await screen.findByText("Triangular arbitrage window");
      const priceEl = container.querySelector(
        '[data-testid="phase-hint-mid-triangular-arb-current-price"]',
      );
      expect(priceEl).toBeTruthy();
      expect(priceEl?.textContent).toBe("115.50");
    });

    it("renders 7d change with + sign for positive values", async () => {
      mockFetchApi.mockResolvedValue(livePriceResponse);
      const { container } = renderWidget(true);
      await screen.findByText("Triangular arbitrage window");
      const changeEl = container.querySelector(
        '[data-testid="phase-hint-mid-triangular-arb-change-week"]',
      );
      expect(changeEl).toBeTruthy();
      expect(changeEl?.textContent).toBe("+12.3%");
    });

    it("renders 30d change when present", async () => {
      mockFetchApi.mockResolvedValue(livePriceResponse);
      const { container } = renderWidget(true);
      await screen.findByText("Triangular arbitrage window");
      const changeEl = container.querySelector(
        '[data-testid="phase-hint-mid-triangular-arb-change-month"]',
      );
      expect(changeEl).toBeTruthy();
      expect(changeEl?.textContent).toBe("+25.7%");
    });

    it("renders momentum badge with UP label", async () => {
      mockFetchApi.mockResolvedValue(livePriceResponse);
      const { container } = renderWidget(true);
      await screen.findByText("Triangular arbitrage window");
      const momentumBadge = container.querySelector(
        '[data-testid="phase-hint-mid-triangular-arb-momentum"]',
      );
      expect(momentumBadge).toBeTruthy();
      expect(momentumBadge?.textContent).toContain("Rising");
    });

    it("renders recommendation badge with HOLD label", async () => {
      mockFetchApi.mockResolvedValue(livePriceResponse);
      const { container } = renderWidget(true);
      await screen.findByText("Triangular arbitrage window");
      const recBadge = container.querySelector(
        '[data-testid="phase-hint-mid-triangular-arb-recommendation"]',
      );
      expect(recBadge).toBeTruthy();
      expect(recBadge?.textContent).toContain("HOLD");
    });

    it("renders negative 7d change with - sign and red color", async () => {
      const fallingResponse: PhaseHintsResponse = {
        ...mixedResponse,
        phase: "early",
        hints: [
          makeHint({
            id: "early-quick-flips",
            title: "Quick flips on Chaos / Exalted",
            trackedCurrency: "exalted",
            currentPrice: 80.0,
            changePctWeek: -15.2,
            changePctMonth: -10.0,
            momentum: "DOWN",
            recommendation: "BUY_OPPORTUNITY",
          }),
        ],
      };
      mockFetchApi.mockResolvedValue(fallingResponse);
      const { container } = renderWidget(true);
      await screen.findByText("Quick flips on Chaos / Exalted");
      const changeEl = container.querySelector(
        '[data-testid="phase-hint-early-quick-flips-change-week"]',
      ) as HTMLElement | null;
      expect(changeEl).toBeTruthy();
      expect(changeEl?.textContent).toBe("-15.2%");
      // Red color class for negative change
      expect(changeEl?.className).toContain("red");
    });

    it("renders BUY_OPPORTUNITY recommendation for EARLY + DOWN", async () => {
      const fallingResponse: PhaseHintsResponse = {
        ...mixedResponse,
        phase: "early",
        hints: [
          makeHint({
            id: "early-quick-flips",
            title: "Quick flips on Chaos / Exalted",
            trackedCurrency: "exalted",
            currentPrice: 80.0,
            changePctWeek: -15.0,
            momentum: "DOWN",
            recommendation: "BUY_OPPORTUNITY",
          }),
        ],
      };
      mockFetchApi.mockResolvedValue(fallingResponse);
      const { container } = renderWidget(true);
      await screen.findByText("Quick flips on Chaos / Exalted");
      const recBadge = container.querySelector(
        '[data-testid="phase-hint-early-quick-flips-recommendation"]',
      );
      expect(recBadge).toBeTruthy();
      expect(recBadge?.textContent).toContain("BUY");
    });

    it("renders SELL_INTO_STRENGTH recommendation for LATE + UP", async () => {
      const lateResponse: PhaseHintsResponse = {
        ...mixedResponse,
        phase: "late",
        hints: [
          makeHint({
            id: "late-portfolio-hold",
            title: "Portfolio holding (risk parity)",
            trackedCurrency: "divine",
            currentPrice: 150.0,
            changePctWeek: 8.5,
            momentum: "UP",
            recommendation: "SELL_INTO_STRENGTH",
          }),
        ],
      };
      mockFetchApi.mockResolvedValue(lateResponse);
      const { container } = renderWidget(true);
      await screen.findByText("Portfolio holding (risk parity)");
      const recBadge = container.querySelector(
        '[data-testid="phase-hint-late-portfolio-hold-recommendation"]',
      );
      expect(recBadge).toBeTruthy();
      expect(recBadge?.textContent).toContain("SELL");
    });

    it("renders FLAT momentum badge when change is small", async () => {
      const flatResponse: PhaseHintsResponse = {
        ...mixedResponse,
        hints: [
          makeHint({
            id: "mid-triangular-arb",
            title: "Triangular arbitrage window",
            trackedCurrency: "divine",
            currentPrice: 100.0,
            changePctWeek: 2.1,
            momentum: "FLAT",
            recommendation: "NEUTRAL",
          }),
        ],
      };
      mockFetchApi.mockResolvedValue(flatResponse);
      const { container } = renderWidget(true);
      await screen.findByText("Triangular arbitrage window");
      const momentumBadge = container.querySelector(
        '[data-testid="phase-hint-mid-triangular-arb-momentum"]',
      );
      expect(momentumBadge).toBeTruthy();
      expect(momentumBadge?.textContent).toContain("Stable");
    });

    it("does NOT render live-price section when currentPrice is null but trackedCurrency is set", async () => {
      const noDataResponse: PhaseHintsResponse = {
        ...mixedResponse,
        hints: [
          makeHint({
            id: "mid-triangular-arb",
            title: "Triangular arbitrage window",
            trackedCurrency: "divine",
            // currentPrice is null — no snapshot data
            currentPrice: null,
            changePctWeek: null,
            momentum: null,
            recommendation: null,
          }),
        ],
      };
      mockFetchApi.mockResolvedValue(noDataResponse);
      const { container } = renderWidget(true);
      await screen.findByText("Triangular arbitrage window");
      const livePriceSection = container.querySelector(
        '[data-testid="phase-hint-mid-triangular-arb-live-price"]',
      );
      expect(livePriceSection).toBeNull();
    });
  });
});
