// ============================================================================
// Unit tests for hooks/use-realms-and-leagues.ts
//
// Covers the iter-122 KI-24 persistence-model redesign:
//   - `league` is read from the Zustand store (`uiState.league`), NOT local
//     useState. The user's persisted selection survives reloads.
//   - The auto-select `useEffect` was REMOVED — `effectiveLeague` (memo)
//     handles the fallback (user selection > active > first).
//   - A "normalize" effect syncs `effectiveLeague` back into the store when
//     the persisted league is invalid (empty or not in the current realm's
//     leagues list). This effect calls Zustand `set` (external store
//     mutation), NOT React `setState`, so the `set-state-in-effect` rule
//     does not fire.
//
// Pre-iter-122 regression being guarded against: the old auto-select effect
// initialized local `league` to `""` on every mount and then overwrote
// `uiState.league` with the API's auto-detected active league, silently
// LOSING the user's previously-persisted selection on every reload.
// ============================================================================

import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode } from "react";
import { useRealmsAndLeagues } from "@/hooks/use-realms-and-leagues";
import { useDashboardStore } from "@/lib/store";
import type { League, Realm } from "@/lib/types";

// ---------------------------------------------------------------------------
// Mock global.fetch — fetchApi() ultimately calls window.fetch(url)
// ---------------------------------------------------------------------------

const fetchMock = jest.fn() as jest.Mock;
global.fetch = fetchMock as unknown as typeof fetch;

function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Headers(),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_REALMS: Realm[] = [
  { name: "poe2", displayName: "PoE2", defaultLeague: "Standard" },
];

// Leagues include both "Standard" (active) and "Hardcore" (inactive) so we
// can distinguish "user persisted Hardcore" from "auto-detected Standard".
function makeLeagues(): League[] {
  return [
    { name: "Standard", displayName: "Standard", startAt: null, endAt: null, active: true },
    { name: "Hardcore", displayName: "Hardcore", startAt: null, endAt: null, active: false },
  ];
}

// Route fetch calls by URL pathname.
function installFetchRoute(leagues: League[] = makeLeagues()) {
  fetchMock.mockImplementation((url: string) => {
    const u = new URL(url, "http://localhost");
    if (u.pathname === "/api/poe2/realms") {
      return Promise.resolve(mockResponse(200, MOCK_REALMS));
    }
    if (u.pathname === "/api/poe2/leagues") {
      return Promise.resolve(mockResponse(200, leagues));
    }
    return Promise.resolve(mockResponse(404, { error: "not found" }));
  });
}

// ---------------------------------------------------------------------------
// Helpers: build a persisted UI state JSON for localStorage seeding
// ---------------------------------------------------------------------------

const UI_STATE_KEY = "poe2-dashboard-state";

function seedPersistedLeague(league: string) {
  const uiState = {
    _version: 5,
    activeTab: "overview",
    exchange: {
      viewMode: "table",
      sortField: "volume",
      sortDirection: "desc",
      activeFilter: "all",
      favorites: [],
      extendedFilters: { minVolume: null, maxVolume: null, minChange: null, maxChange: null },
    },
    watchlist: [],
    league,
    denseMode: false,
    baseCurrencyApiId: null,
    baseCurrencyText: null,
  };
  window.localStorage.setItem(UI_STATE_KEY, JSON.stringify(uiState));
}

// ---------------------------------------------------------------------------
// Wrapper for renderHook — provides QueryClientProvider (the hook uses
// useQuery). No I18nProvider needed (the hook doesn't read i18n).
// ---------------------------------------------------------------------------

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useRealmsAndLeagues — iter-122 persistence-model redesign", () => {
  beforeEach(() => {
    // localStorage is cleared by jest.setup.ts beforeEach. Also reset the
    // store explicitly so uiState/_hydrated don't leak from prior tests.
    useDashboardStore.setState({
      favorites: [],
      comparisonIds: [],
      pairComparisonIds: [],
      alerts: [],
      uiState: {
        _version: 5,
        activeTab: "overview",
        exchange: {
          viewMode: "table",
          sortField: "volume",
          sortDirection: "desc",
          activeFilter: "all",
          favorites: [],
          extendedFilters: { minVolume: null, maxVolume: null, minChange: null, maxChange: null },
        },
        watchlist: [],
        league: "runes",
        denseMode: false,
        baseCurrencyApiId: null,
        baseCurrencyText: null,
      },
      _hydrated: false,
    });
    fetchMock.mockReset();
    installFetchRoute();
  });

  it("preserves the user's persisted league across rehydrate (NOT overwritten by auto-detected active)", async () => {
    // Pre-iter-122 regression: the auto-select effect would overwrite
    // "Hardcore" with "Standard" (the active league) on every mount.
    seedPersistedLeague("Hardcore");

    const { result } = renderHook(() => useRealmsAndLeagues(), {
      wrapper: createWrapper(),
    });

    // Simulate StoreRehydrator's useEffect — loads "Hardcore" from localStorage.
    act(() => {
      useDashboardStore.getState().rehydrate();
    });

    // Wait for the leagues query to resolve + the normalize effect to run.
    await waitFor(() => {
      expect(result.current.leagues).toBeDefined();
      expect(result.current.leagues!.length).toBeGreaterThan(0);
    });
    // Allow the normalize effect to settle (it runs after the render where
    // `leagues` first becomes defined).
    await waitFor(() => {
      expect(result.current.league).toBe("Hardcore");
    });

    // effectiveLeague should also be "Hardcore" (it's in the leagues list).
    expect(result.current.effectiveLeague).toBe("Hardcore");

    // The store should still have "Hardcore" (NOT overwritten with "Standard").
    expect(useDashboardStore.getState().uiState.league).toBe("Hardcore");
  });

  it("normalizes an invalid persisted league to the active league (keeps downstream hooks supplied)", async () => {
    // "Nonexistent" is not in the leagues list → normalize effect should
    // replace it with "Standard" (the active league).
    seedPersistedLeague("Nonexistent");

    const { result } = renderHook(() => useRealmsAndLeagues(), {
      wrapper: createWrapper(),
    });

    act(() => {
      useDashboardStore.getState().rehydrate();
    });

    await waitFor(() => {
      expect(result.current.leagues).toBeDefined();
    });
    // After normalize, the store should hold "Standard" (the active fallback).
    await waitFor(() => {
      expect(useDashboardStore.getState().uiState.league).toBe("Standard");
    });

    // effectiveLeague is "Standard"; league (read from store) is now "Standard".
    expect(result.current.effectiveLeague).toBe("Standard");
    expect(result.current.league).toBe("Standard");
  });

  it("setRealm clears the persisted league (effectiveLeague re-derives for the new realm)", async () => {
    seedPersistedLeague("Hardcore");

    const { result } = renderHook(() => useRealmsAndLeagues(), {
      wrapper: createWrapper(),
    });

    act(() => {
      useDashboardStore.getState().rehydrate();
    });

    await waitFor(() => {
      expect(result.current.league).toBe("Hardcore");
    });

    // User changes realm → setRealm should clear the persisted league.
    act(() => {
      result.current.setRealm("pc");
    });

    // The store's league should now be "" (cleared by setRealm).
    expect(useDashboardStore.getState().uiState.league).toBe("");
  });
});
