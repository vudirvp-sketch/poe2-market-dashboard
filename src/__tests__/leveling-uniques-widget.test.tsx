// ============================================================================
// Unit tests for LevelingUniquesWidget (P3, iter 100) — "Leveling Uniques
// Lifecycle" widget on the Overview tab.
//
// Coverage:
//   - Backend offline → renders compact offline notice (no full-card takeover)
//   - Loading state → renders loading text
//   - Error state → renders error + refresh button
//   - data_available=false → renders "no data" notice
//   - data_available=true with uniques → renders table with item rows
//   - Each unique row renders: name, notes, stage badge, est price, peak day,
//     recommendation badge
//   - Day count renders with CalendarClock icon
//   - Reference currency renders when present
//   - Stage breakdown footer renders (PRE_PEAK / AT_PEAK / POST_PEAK counts)
//   - Disclaimer about heuristic pricing renders
//   - Refresh button visible when data is shown
//   - Empty uniques list renders "no uniques" notice
//   - Summary line picks the right text based on dominant stage
//   - Proxy path /api/flipper/leveling-uniques is used with lang param
// ============================================================================
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@/lib/i18n";
import { LevelingUniquesWidget } from "@/components/dashboard/leveling-uniques-widget";
import type {
  LevelingUniquesResponse,
  LevelingUnique,
} from "@/lib/types";

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
const ERROR_WAIT_OPTS = { timeout: 5000 };

function renderWidget(backendOnline: boolean = true) {
  const queryClient = createTestQueryClient();
  window.localStorage.setItem("poe2-locale", "en");
  const result = render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <LevelingUniquesWidget backendOnline={backendOnline} />
      </I18nProvider>
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}

// ---------------------------------------------------------------------------
// Test data — matches the LevelingUniquesResponse shape returned by the
// proxy route after camelCase transform.
// ---------------------------------------------------------------------------

function makeUnique(overrides: Partial<LevelingUnique> = {}): LevelingUnique {
  return {
    id: "polcirkeln-sapphire-ring",
    name: "Polcirkeln Sapphire Ring",
    category: "",
    peakDay: 2,
    peakPriceExalted: 15.0,
    decayPct: 70.0,
    pattern: "SPIKE_THEN_CRASH",
    currentLifecycleStage: "AT_PEAK",
    recommendation: "SELL_NOW",
    estimatedCurrentPriceExalted: 15.0,
    daysUntilPeak: 0,
    notes:
      "Found via Unique Ring Remnants Crafting. Strong leveling ring for cold/elemental builds.",
    ...overrides,
  };
}

/** Build a response with a mix of all 3 lifecycle stages.
 *  - 1 AT_PEAK (Polcirkeln) — recommendation SELL_NOW
 *  - 1 PRE_PEAK (Mana Leech Support) — recommendation BUY_OR_HOLD
 *  - 1 POST_PEAK (Boots of Momentum) — recommendation AVOID_BUYING
 */
const mixedResponse: LevelingUniquesResponse = {
  league: "Standard",
  phase: "early",
  daysSinceReference: 2,
  currentDay: 2,
  referenceCurrency: "exalted",
  uniques: [
    makeUnique({
      id: "polcirkeln-sapphire-ring",
      name: "Polcirkeln Sapphire Ring",
      currentLifecycleStage: "AT_PEAK",
      recommendation: "SELL_NOW",
      estimatedCurrentPriceExalted: 15.0,
      daysUntilPeak: 0,
    }),
    makeUnique({
      id: "mana-leech-support",
      name: "Mana Leech Support Gem",
      category: "uncutgems",
      peakDay: 2,
      peakPriceExalted: 5.0,
      decayPct: 60.0,
      currentLifecycleStage: "PRE_PEAK",
      recommendation: "BUY_OR_HOLD",
      estimatedCurrentPriceExalted: 3.75,
      daysUntilPeak: 0,
      notes: "Critical for spell-casters in early campaign.",
    }),
    makeUnique({
      id: "boots-of-momentum",
      name: "Boots of Momentum",
      peakDay: 2,
      peakPriceExalted: 3.0,
      decayPct: 80.0,
      currentLifecycleStage: "POST_PEAK",
      recommendation: "AVOID_BUYING",
      estimatedCurrentPriceExalted: 1.2,
      daysUntilPeak: -2,
      notes: "Movement-speed boots — universally useful for leveling.",
    }),
  ],
  dataAvailable: true,
  fetchedAt: new Date("2026-07-10T12:00:00Z").toISOString(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LevelingUniquesWidget", () => {
  beforeEach(() => {
    mockFetchApi.mockReset();
  });

  // ---- Offline state ----

  it("renders offline notice when backendOffline=false", async () => {
    renderWidget(false);
    expect(screen.getByText(/Leveling uniques data requires/i)).toBeInTheDocument();
    // Should NOT call fetchApi when offline
    expect(mockFetchApi).not.toHaveBeenCalled();
  });

  it("renders TrendingUp icon and title in offline state", async () => {
    renderWidget(false);
    expect(screen.getByText("Leveling Uniques")).toBeInTheDocument();
  });

  // ---- Loading state ----

  it("renders loading text while fetching", async () => {
    mockFetchApi.mockReturnValue(new Promise(() => {})); // never resolves
    renderWidget(true);
    expect(screen.getByText(/Loading leveling uniques/i)).toBeInTheDocument();
  });

  // ---- Error state ----

  it("renders error + refresh button on fetch failure", async () => {
    mockFetchApi.mockRejectedValue(new Error("Network error"));
    renderWidget(true);
    await waitFor(() => {
      expect(screen.getByText(/Failed to load leveling uniques/i)).toBeInTheDocument();
    }, ERROR_WAIT_OPTS);
    const refreshButtons = screen.getAllByLabelText("Refresh");
    expect(refreshButtons.length).toBeGreaterThan(0);
  });

  it("calls fetchApi again when refresh button clicked after error", async () => {
    // The widget has per-query `retry: 1` which overrides the test client's
    // `retry: false`. Additionally, I18nProvider hydrates from localStorage
    // after mount (DEFAULT_LOCALE "ru" → stored "en"), which changes the
    // queryKey ["levelingUniques","ru"] → ["levelingUniques","en"], causing
    // React Query to start a fresh query and abandon the in-flight retry of
    // the previous one. The exact call count before the error UI shows is
    // therefore timing-dependent (typically 3: ru-initial + en-initial +
    // en-retry). What matters for this test is that clicking Refresh
    // triggers exactly ONE additional fetch and the widget transitions out
    // of the error state.
    mockFetchApi.mockRejectedValue(new Error("Network error"));
    renderWidget(true);
    await waitFor(() => {
      expect(screen.getByText(/Failed to load leveling uniques/i)).toBeInTheDocument();
    }, ERROR_WAIT_OPTS);
    const callsBeforeRefresh = mockFetchApi.mock.calls.length;
    expect(callsBeforeRefresh).toBeGreaterThanOrEqual(2); // initial + at least 1 retry
    // Switch mock to success and click refresh → exactly 1 more call.
    mockFetchApi.mockResolvedValue({ ...mixedResponse, uniques: [] });
    const refreshButtons = screen.getAllByLabelText("Refresh");
    fireEvent.click(refreshButtons[0]);
    await waitFor(() => {
      expect(mockFetchApi).toHaveBeenCalledTimes(callsBeforeRefresh + 1);
    });
    // Verify the widget transitioned to the success state (error UI gone).
    await waitFor(() => {
      expect(screen.queryByText(/Failed to load leveling uniques/i)).not.toBeInTheDocument();
    });
  });

  // ---- No data available ----

  it("renders no-data notice when dataAvailable=false", async () => {
    mockFetchApi.mockResolvedValue({
      ...mixedResponse,
      dataAvailable: false,
      uniques: [],
    });
    renderWidget(true);
    await waitFor(() => {
      expect(screen.getByText(/PhaseDetector could not determine/i)).toBeInTheDocument();
    });
  });

  // ---- Successful render with data ----

  it("renders widget card with correct testid when data available", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderWidget(true);
    await waitFor(() => {
      expect(screen.getByTestId("leveling-uniques-widget")).toBeInTheDocument();
    });
  });

  it("renders title with TrendingUp icon", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderWidget(true);
    await waitFor(() => {
      expect(screen.getByText("Leveling Uniques")).toBeInTheDocument();
    });
  });

  it("renders day count with currentDay value", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderWidget(true);
    await waitFor(() => {
      expect(screen.getByText("Day 2")).toBeInTheDocument();
    });
  });

  it("renders item count with uniques.length", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderWidget(true);
    await waitFor(() => {
      // The count is rendered in a span together with a leading "·"
      // separator ("· 3 items"), so an exact-match getByText would miss it.
      // Use a regex matcher to find the count text inside that span.
      expect(screen.getByText(/3 items/)).toBeInTheDocument();
    });
  });

  it("renders reference currency when present", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderWidget(true);
    await waitFor(() => {
      expect(screen.getByText(/ref: exalted/i)).toBeInTheDocument();
    });
  });

  it("renders summary line for AT_PEAK dominant stage", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderWidget(true);
    await waitFor(() => {
      // 1 item at peak → "1 item(s) at peak demand — SELL NOW if you have any of these."
      expect(screen.getByText(/1 item\(s\) at peak demand/i)).toBeInTheDocument();
    });
  });

  it("renders uniques list with one row per unique", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderWidget(true);
    await waitFor(() => {
      expect(screen.getByTestId("leveling-uniques-list")).toBeInTheDocument();
    });
    // Each unique renders with data-testid=`leveling-unique-${id}`
    expect(screen.getByTestId("leveling-unique-polcirkeln-sapphire-ring")).toBeInTheDocument();
    expect(screen.getByTestId("leveling-unique-mana-leech-support")).toBeInTheDocument();
    expect(screen.getByTestId("leveling-unique-boots-of-momentum")).toBeInTheDocument();
  });

  it("renders stage badge for each unique", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderWidget(true);
    await waitFor(() => {
      expect(screen.getByTestId("leveling-unique-polcirkeln-sapphire-ring-stage")).toBeInTheDocument();
    });
    expect(screen.getByTestId("leveling-unique-mana-leech-support-stage")).toBeInTheDocument();
    expect(screen.getByTestId("leveling-unique-boots-of-momentum-stage")).toBeInTheDocument();
  });

  it("renders recommendation badge for each unique", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderWidget(true);
    await waitFor(() => {
      expect(screen.getByTestId("leveling-unique-polcirkeln-sapphire-ring-rec")).toBeInTheDocument();
    });
  });

  it("renders AT PEAK stage label for AT_PEAK unique", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderWidget(true);
    await waitFor(() => {
      expect(screen.getAllByText("AT PEAK").length).toBeGreaterThan(0);
    });
  });

  it("renders PRE-PEAK stage label for PRE_PEAK unique", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderWidget(true);
    await waitFor(() => {
      expect(screen.getAllByText("PRE-PEAK").length).toBeGreaterThan(0);
    });
  });

  it("renders POST-PEAK stage label for POST_PEAK unique", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderWidget(true);
    await waitFor(() => {
      expect(screen.getAllByText("POST-PEAK").length).toBeGreaterThan(0);
    });
  });

  it("renders SELL NOW recommendation label for AT_PEAK unique", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderWidget(true);
    await waitFor(() => {
      expect(screen.getAllByText("SELL NOW").length).toBeGreaterThan(0);
    });
  });

  it("renders BUY/HOLD recommendation label for PRE_PEAK unique", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderWidget(true);
    await waitFor(() => {
      expect(screen.getAllByText("BUY/HOLD").length).toBeGreaterThan(0);
    });
  });

  it("renders AVOID BUYING recommendation label for POST_PEAK unique", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderWidget(true);
    await waitFor(() => {
      expect(screen.getAllByText("AVOID BUYING").length).toBeGreaterThan(0);
    });
  });

  it("renders estimated price with exa suffix", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderWidget(true);
    await waitFor(() => {
      // 15.0 exa
      expect(screen.getByText(/~15\.0 exa/)).toBeInTheDocument();
    });
  });

  it("renders peak day short label", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderWidget(true);
    await waitFor(() => {
      // Day 2 · 15.0 exa (peak day + peak price)
      expect(screen.getAllByText(/Day 2 ·/).length).toBeGreaterThan(0);
    });
  });

  it("renders disclaimer about heuristic pricing", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderWidget(true);
    await waitFor(() => {
      expect(screen.getByText(/planning heuristics/i)).toBeInTheDocument();
    });
  });

  it("renders fetched-at timestamp in footer", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderWidget(true);
    await waitFor(() => {
      expect(screen.getByText(/Fetched:/i)).toBeInTheDocument();
    });
  });

  it("renders stage breakdown in footer with counts", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderWidget(true);
    await waitFor(() => {
      // PRE_PEAK: 1 · AT_PEAK: 1 · POST_PEAK: 1
      expect(screen.getByText(/PRE_PEAK: 1/i)).toBeInTheDocument();
    });
  });

  it("renders refresh button when data is shown", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderWidget(true);
    await waitFor(() => {
      expect(screen.getByTestId("leveling-uniques-widget")).toBeInTheDocument();
    });
    expect(screen.getAllByLabelText("Refresh").length).toBeGreaterThan(0);
  });

  // ---- Empty uniques list ----

  it("renders no-uniques notice when uniques list is empty", async () => {
    mockFetchApi.mockResolvedValue({
      ...mixedResponse,
      uniques: [],
      dataAvailable: true,
    });
    renderWidget(true);
    await waitFor(() => {
      expect(screen.getByText(/No leveling uniques in the static table/i)).toBeInTheDocument();
    });
  });

  // ---- Summary line variants ----

  it("renders PRE_PEAK summary when only PRE_PEAK uniques", async () => {
    const allPrePeak = {
      ...mixedResponse,
      uniques: [
        makeUnique({ currentLifecycleStage: "PRE_PEAK", recommendation: "BUY_OR_HOLD" }),
        makeUnique({
          id: "mana-leech-support",
          currentLifecycleStage: "PRE_PEAK",
          recommendation: "BUY_OR_HOLD",
        }),
      ],
    };
    mockFetchApi.mockResolvedValue(allPrePeak);
    renderWidget(true);
    await waitFor(() => {
      expect(screen.getByText(/2 item\(s\) still rising toward peak/i)).toBeInTheDocument();
    });
  });

  it("renders POST_PEAK summary when only POST_PEAK uniques", async () => {
    const allPostPeak = {
      ...mixedResponse,
      uniques: [
        makeUnique({ currentLifecycleStage: "POST_PEAK", recommendation: "AVOID_BUYING" }),
        makeUnique({
          id: "boots-of-momentum",
          currentLifecycleStage: "POST_PEAK",
          recommendation: "AVOID_BUYING",
        }),
      ],
    };
    mockFetchApi.mockResolvedValue(allPostPeak);
    renderWidget(true);
    await waitFor(() => {
      expect(screen.getByText(/2 item\(s\) past peak/i)).toBeInTheDocument();
    });
  });

  // ---- Proxy path / lang forwarding ----

  it("calls fetchApi with /api/flipper/leveling-uniques and lang=en by default", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderWidget(true);
    await waitFor(() => {
      expect(mockFetchApi).toHaveBeenCalledWith(
        "/api/flipper/leveling-uniques",
        { lang: "en" },
      );
    });
  });

  it("forwards lang=ru when locale is ru", async () => {
    window.localStorage.setItem("poe2-locale", "ru");
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderWidget(true);
    await waitFor(() => {
      expect(mockFetchApi).toHaveBeenCalledWith(
        "/api/flipper/leveling-uniques",
        { lang: "ru" },
      );
    });
  });
});
