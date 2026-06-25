// ============================================================================
// useRealmsAndLeagues — Realm/league selection + realms/leagues queries
// ============================================================================
//
// Stage 2 of the useDashboardData hook extraction (iter 82, deferred from
// P2-1). See STATUS.md "Technical-debt backlog" for the staged plan.
//
// This hook owns the realm + league selection state AND the two read-only
// queries that populate the Header dropdowns:
//   1. /api/poe2/realms  → realms (list of available realms)
//   2. /api/poe2/leagues → leagues (list of leagues for the current realm)
//
// It also derives `effectiveLeague` — the league name that downstream data
// queries should actually use:
//   - If the user has explicitly selected a league that exists in `leagues`,
//     use that.
//   - Otherwise, fall back to the league flagged `active` in the API response.
//   - Otherwise, fall back to the first league in the list.
//   - Otherwise, empty string (signals "no league yet" to consumers).
//
// State ownership — the hook owns `realm` and `league` so it can guarantee
// the auto-select useEffect fires whenever `leagues` arrives. The store
// (Zustand `useDashboardStore`) still receives league-persistence calls via
// the `persistLeague` action — same coupling as before, just centralized
// here instead of in dashboard-page.tsx.
//
// `setRealm` clears the league — this matches the previous inline behaviour
// at the call site (`setRealm(v); setLeague("")`). Centralizing it inside
// the hook means the parent doesn't have to remember to do it.
//
// Future stages (NOT in this hook):
//   - Stage 3: derived memos (exchangePairs filter, optimalPayment merge,
//              optimalPaymentByDisplayName, currencyCategories, …)
// ============================================================================

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchApi } from "@/lib/types";
import type { Realm, League } from "@/lib/types";
import { QUERY_KEYS } from "@/components/providers";
import { useDashboardStore } from "@/lib/store";

export interface UseRealmsAndLeaguesResult {
  /** Currently selected realm (default "poe2"). */
  realm: string;
  /**
   * Set the realm. Also clears the league — matches the previous inline
   * behaviour (`setRealm(v); setLeague("")`).
   */
  setRealm: (v: string) => void;
  /** Currently selected league (may be empty until auto-select runs). */
  league: string;
  /**
   * Set the league. Persists to the Zustand store via `persistLeague` so
   * the selection survives reloads.
   */
  setLeague: (newLeague: string) => void;
  /** Available realms from /api/poe2/realms (undefined while loading). */
  realms?: Realm[];
  /** True while the realms query is in flight. */
  realmsLoading: boolean;
  /** Available leagues for the current realm (undefined while loading). */
  leagues?: League[];
  /** True while the leagues query is in flight. */
  leaguesLoading: boolean;
  /**
   * The league name downstream queries should use. Falls back to the
   * active league, then the first league, then "" (no league).
   */
  effectiveLeague: string;
}

/**
 * Realm/league selection + the two queries that populate the Header
 * dropdowns. Owns the `realm` and `league` state so the auto-select
 * effect can fire when `leagues` arrives.
 */
export function useRealmsAndLeagues(): UseRealmsAndLeaguesResult {
  // --- Selection state ---
  // Default realm is "poe2" to match API URL path segment.
  const [realm, setRealmState] = useState("poe2");
  const [league, setLeagueLocal] = useState("");

  // Persist league selection to the Zustand store so it survives reloads.
  // The store also re-hydrates `uiState.league` from localStorage on mount,
  // but the source of truth for the current session lives in this hook's
  // useState — the store is for cross-session persistence only.
  const { setLeague: persistLeague } = useDashboardStore();

  // --- Realms query (no enabled gate — always fetches on mount) ---
  const { data: realms, isLoading: realmsLoading } = useQuery({
    queryKey: [QUERY_KEYS.realms],
    queryFn: () => fetchApi<Realm[]>("/api/poe2/realms"),
  });

  // --- Leagues query (gated on realm — realm is always set, but kept
  // explicit to match the original behaviour) ---
  const { data: leagues, isLoading: leaguesLoading } = useQuery({
    queryKey: [QUERY_KEYS.leagues, realm],
    queryFn: () => {
      // Fix 5.4: Pass defaultLeagueValue from realms data to avoid
      // a redundant /Realms request inside getLeagues()
      const defaultLeague = realms?.find(
        (r) => r.name === realm || (realm === "poe2" && r.name === "poe2")
      )?.defaultLeague;
      return fetchApi<League[]>("/api/poe2/leagues", {
        realm,
        ...(defaultLeague ? { defaultLeagueValue: defaultLeague } : {}),
      });
    },
    enabled: !!realm,
  });

  // Compute the effective league: user selection > active league > first league
  const effectiveLeague = useMemo(() => {
    if (league && leagues?.some((l) => l.name === league)) return league;
    const active = leagues?.find((l) => l.active);
    return active?.name || leagues?.[0]?.name || "";
  }, [league, leagues]);

  // --- Wrapper: setRealm also clears the league (matches prior behaviour) ---
  const setRealm = useCallback((v: string) => {
    setRealmState(v);
    setLeagueLocal("");
  }, []);

  // --- Wrapper: setLeague persists to the store as well as local state ---
  const setLeague = useCallback(
    (newLeague: string) => {
      setLeagueLocal(newLeague);
      persistLeague(newLeague);
    },
    [persistLeague]
  );

  // FIX: Auto-select the first league when leagues load and no league is
  // explicitly selected. Without this the Radix Select stays empty because
  // `value=""` is invalid, and the "Select a realm and league" placeholder
  // never goes away even though effectiveLeague resolves to a name.
  useEffect(() => {
    if (!league && leagues && leagues.length > 0) {
      const autoLeague =
        leagues.find((l) => l.active)?.name || leagues[0].name;
      if (autoLeague) {
        setLeague(autoLeague);
      }
    }
  }, [league, leagues, setLeague]);

  return {
    realm,
    setRealm,
    league,
    setLeague,
    realms,
    realmsLoading,
    leagues,
    leaguesLoading,
    effectiveLeague,
  };
}
