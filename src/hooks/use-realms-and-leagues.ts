// ============================================================================
// useRealmsAndLeagues — Realm/league selection + realms/leagues queries
// ============================================================================
//
// iter 122 (KI-24 set-state-in-effect): PERSISTENCE-MODEL REDESIGN.
//
// PREVIOUS MODEL (broken): this hook owned `league` as a local `useState("")`
// AND mirrored every change into the Zustand store via `persistLeague`. The
// store's `uiState.league` was persisted to localStorage but NEVER READ BACK
// on mount — local `league` always started as `""`. An auto-select `useEffect`
// fired whenever `league === ""` and `leagues` arrived, calling `setLeague`
// (which wrote to BOTH local state AND the store). This meant every reload
// overwrote the user's previously-persisted league with the API's
// auto-detected "active" league — silently losing the user's selection.
//
// NEW MODEL (single source of truth): `league` is read directly from the
// Zustand store (`uiState.league`). No local copy. The `effectiveLeague`
// memo (unchanged) derives the league downstream queries should actually
// use: user selection (if valid for the current realm) > active > first > "".
// A small "normalize" effect syncs `effectiveLeague` back into the store
// when the persisted league is invalid (empty or not in the current
// `leagues` list) — this keeps downstream hooks on OTHER routes
// (use-currency-items, use-unique-items, use-exchange-pairs — all read
// `uiState.league` directly) supplied with a valid league. The normalize
// effect calls `persistLeague` (a Zustand store action), NOT React's
// `setState`, so the `react-hooks/set-state-in-effect` rule does NOT fire.
//
// Why this is safe:
//   - Header.tsx uses `effectiveLeague` for the dropdown value (line 286:
//     `leagueSelectValue = effectiveLeague || "__none__"`), NOT the `league`
//     prop. So removing local `league` does not change dropdown rendering.
//   - `effectiveLeague` already implemented the correct fallback without an
//     effect; the auto-select effect was redundant for dropdown display.
//   - The `league` prop passed to Header is declared in `HeaderProps` but
//     never destructured — it is dead. Returning `uiState.league` here is
//     backward-compatible.
//
// State ownership:
//   - `realm` — local `useState("poe2")` (not persisted; "poe2" is the only
//     realm the API supports today).
//   - `league` — Zustand `uiState.league` (persisted to localStorage via
//     the store's `setLeague` action, rehydrated on mount by
//     `StoreRehydrator`).
//
// `setRealm` clears the persisted league (`persistLeague("")`) — matches the
// previous inline behaviour (`setRealm(v); setLeague("")`) and ensures
// `effectiveLeague` re-derives for the new realm's leagues.
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
   * Set the realm. Also clears the persisted league — matches the previous
   * inline behaviour (`setRealm(v); setLeague("")`).
   */
  setRealm: (v: string) => void;
  /**
   * Currently persisted league (from `uiState.league`). May be `""`, the
   * default `"runes"`, or a value that doesn't exist in the current realm's
   * `leagues` list — consumers should prefer `effectiveLeague`.
   */
  league: string;
  /**
   * Set the league. Persists to the Zustand store via `setLeague` so the
   * selection survives reloads. (iter 122: no longer updates local state —
   * the store IS the source of truth.)
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
 * dropdowns. `realm` is local state; `league` is read from the Zustand
 * store (single source of truth, persisted across sessions).
 */
export function useRealmsAndLeagues(): UseRealmsAndLeaguesResult {
  // --- Selection state ---
  // Default realm is "poe2" to match API URL path segment.
  const [realm, setRealmState] = useState("poe2");

  // iter 122: `league` is read directly from the Zustand store — single
  // source of truth. The store rehydrates `uiState.league` from localStorage
  // on mount (via `StoreRehydrator`), so the user's previous selection is
  // preserved across reloads. Selecting just the `league` string (not the
  // whole `uiState` object) ensures this hook only re-renders when the
  // league actually changes.
  const league = useDashboardStore((s) => s.uiState.league);
  const persistLeague = useDashboardStore((s) => s.setLeague);

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

  // --- Wrapper: setRealm also clears the persisted league (matches prior
  // behaviour: `setRealm(v); setLeague("")`). The cleared league is then
  // re-normalized by the effect below once the new realm's leagues arrive. ---
  const setRealm = useCallback((v: string) => {
    setRealmState(v);
    persistLeague("");
  }, [persistLeague]);

  // --- Wrapper: setLeague persists to the store (single source of truth). ---
  const setLeague = useCallback(
    (newLeague: string) => {
      persistLeague(newLeague);
    },
    [persistLeague]
  );

  // --- Normalize persisted league (iter 122). ---
  // If `uiState.league` is empty OR not present in the current realm's
  // `leagues` list, replace it with `effectiveLeague` (the active/first
  // fallback). This keeps downstream hooks on OTHER routes
  // (use-currency-items, use-unique-items, use-exchange-pairs — all read
  // `uiState.league` directly) supplied with a valid league, matching the
  // pre-iter-122 behaviour where the auto-select effect populated the store.
  //
  // This effect calls `persistLeague` (a Zustand store action — an EXTERNAL
  // store mutation), NOT React's `setState`. The `react-hooks/set-state-in-
  // effect` rule fires on `useState`/`useReducer` dispatchers, not on
  // Zustand's `set`. Verified: dashboard-page.tsx:382 calls `setBaseCurrency`
  // (Zustand) in an effect without triggering the rule, while line 387
  // `setReferenceCurrency` (React useState) in the same effect DOES trigger.
  //
  // Guard against infinite loops: once `persisted === effectiveLeague`, the
  // condition `effectiveLeague !== persisted` is false and no further
  // `persistLeague` call is made.
  useEffect(() => {
    if (!leagues || leagues.length === 0) return; // wait for leagues to arrive
    if (!effectiveLeague) return; // nothing to normalize to
    const isValid =
      !!league && leagues.some((l) => l.name === league);
    if (!isValid && effectiveLeague !== league) {
      persistLeague(effectiveLeague);
    }
  }, [leagues, effectiveLeague, league, persistLeague]);

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
