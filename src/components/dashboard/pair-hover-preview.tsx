// ============================================================================
// Pair Hover Preview — Lazy-loads a sparkline for an exchange pair on hover.
// Fix 4.15: Instead of fetching history for ALL pairs upfront (slow), we
// show pairs immediately with basic info and load a mini chart on hover.
// ============================================================================
"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkline } from "@/components/dashboard/sparkline";
import { fetchApi } from "@/lib/types";
import type { ExchangePairHistoryPoint } from "@/lib/types";

interface PairHoverPreviewProps {
  /** The pair's numeric ItemIds for the history API */
  currency1ItemId: number;
  currency2ItemId: number;
  /** Current realm */
  realm: string;
  /** Current league */
  league: string;
}

/**
 * Renders a tiny sparkline that is fetched ONLY when the user hovers
 * over the parent ExchangePairCard. The query is cached by React Query
 * so re-hovering the same pair is instant.
 */
export function PairHoverPreview({
  currency1ItemId,
  currency2ItemId,
  realm,
  league,
}: PairHoverPreviewProps) {
  const [hovered, setHovered] = useState(false);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce hover: only trigger query after 150ms of sustained hover
  // to avoid firing requests while the user is scrolling past cards.
  const handleMouseEnter = useCallback(() => {
    hoverTimeoutRef.current = setTimeout(() => setHovered(true), 150);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    setHovered(false);
  }, []);

  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
    };
  }, []);

  const { data: pairHistory } = useQuery<ExchangePairHistoryPoint[]>({
    queryKey: ["pairHoverHistory", realm, league, currency1ItemId, currency2ItemId],
    queryFn: () =>
      fetchApi<ExchangePairHistoryPoint[]>("/api/poe2/currencies", {
        realm,
        league,
        action: "pairHistory",
        id1: String(currency1ItemId),
        id2: String(currency2ItemId),
        limit: "48", // Last 48 hours for a small sparkline
      }),
    enabled: hovered,
    staleTime: 120_000, // Cache for 2 minutes
    retry: 0, // Don't retry on hover — it's a non-critical preview
  });

  // Extract prices for sparkline
  const sparklineData = pairHistory?.map((p) => p.relativePrice) ?? [];

  // Determine sparkline color based on trend
  const sparklineColor =
    sparklineData.length >= 2 && sparklineData[sparklineData.length - 1] >= sparklineData[0]
      ? "#22c55e" // emerald-500 for up
      : "#ef4444"; // red-500 for down

  return (
    <div
      className="mt-1.5 h-7 flex items-center justify-center"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {sparklineData.length >= 2 ? (
        <Sparkline data={sparklineData} color={sparklineColor} width={120} height={24} />
      ) : hovered ? (
        <span className="text-[10px] text-muted-foreground animate-pulse">
          Loading...
        </span>
      ) : (
        <span className="text-[10px] text-muted-foreground/50">
          Hover for chart
        </span>
      )}
    </div>
  );
}
