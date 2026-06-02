// ============================================================================
// Watchlist Tab (§2.6 — Enhanced)
//
// Features:
// - Table of favorited exchange pairs with "P&L" and "Added" date columns
// - Sort options: by name, by price, by change, by P&L, by date added
// - Group toggle: Gainers / Losers / All
// - Sharp movements alert for items with >10% change
// - Search/filter within watchlist
// - Empty state when no favorites
// - Synced with Exchange favorites in localStorage
// ============================================================================
"use client";

import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Star,
  Inbox,
  Zap,
  TrendingUp,
  TrendingDown,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Coins,
  Search,
  X,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { WatchlistSkeleton } from "./skeletons";
import { EmptyState } from "./empty-state";
import { Sparkline } from "./sparkline";
import { fmt, fmtChange, fetchApi } from "@/lib/types";
import type { ExchangePair } from "@/lib/types";
import { useDashboardStore } from "@/lib/store";
import { formatPrice } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

// ============================================================================
// Types
// ============================================================================

type SortField = "pair" | "rate" | "change" | "pnl" | "added";
type SortDirection = "asc" | "desc";
type GroupFilter = "all" | "gainers" | "losers";

interface WatchlistTabProps {
  realm: string;
  league: string;
  onPairClick: (pair: ExchangePair) => void;
}

// ============================================================================
// Volume formatting helper
// ============================================================================

function fmtVolume(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

// ============================================================================
// Watchlist Tab Component
// ============================================================================

export function WatchlistTab({ realm, league, onPairClick }: WatchlistTabProps) {
  const { t } = useI18n();
  const {
    uiState,
    toggleExchangeFavorite,
    getWatchlistEntry,
  } = useDashboardStore();

  const favorites = uiState.exchange.favorites;
  const watchlist = uiState.watchlist;

  // Local state
  const [sortField, setSortField] = useState<SortField>("added");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [groupFilter, setGroupFilter] = useState<GroupFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Fetch exchange pairs for the league
  const { data: exchangeData, isLoading } = useQuery({
    queryKey: ["exchange", realm, league],
    queryFn: () =>
      fetchApi<ExchangePair[]>("/api/poe2/exchange", {
        realm,
        league,
        action: "pairs",
        snapshot: "true",
      }),
    enabled: !!league && favorites.length > 0,
    staleTime: 60_000,
    retry: 2,
  });

  // Filter exchange pairs to only favorited ones
  const favoritePairs = useMemo(() => {
    if (!exchangeData) return [];
    return exchangeData.filter((p) => favorites.includes(p.id));
  }, [exchangeData, favorites]);

  // Apply search filter
  const searchedPairs = useMemo(() => {
    if (!searchQuery) return favoritePairs;
    const q = searchQuery.toLowerCase();
    return favoritePairs.filter(
      (p) =>
        p.currency1Name.toLowerCase().includes(q) ||
        p.currency2Name.toLowerCase().includes(q)
    );
  }, [favoritePairs, searchQuery]);

  // Apply group filter
  const filteredPairs = useMemo(() => {
    if (groupFilter === "gainers") {
      return searchedPairs.filter((p) => (p.changePercent ?? 0) > 0);
    }
    if (groupFilter === "losers") {
      return searchedPairs.filter((p) => (p.changePercent ?? 0) < 0);
    }
    return searchedPairs;
  }, [searchedPairs, groupFilter]);

  // Sort pairs
  const sortedPairs = useMemo(() => {
    const sorted = [...filteredPairs];
    const dir = sortDirection === "asc" ? 1 : -1;

    sorted.sort((a, b) => {
      switch (sortField) {
        case "pair":
          return dir * a.currency1Name.localeCompare(b.currency1Name);
        case "rate":
          return dir * ((a.relativePrice ?? 0) - (b.relativePrice ?? 0));
        case "change": {
          const aChg = a.changePercent ?? -Infinity;
          const bChg = b.changePercent ?? -Infinity;
          return dir * (aChg - bChg);
        }
        case "pnl": {
          const aPnl = a.changePercent ?? -Infinity;
          const bPnl = b.changePercent ?? -Infinity;
          return dir * (aPnl - bPnl);
        }
        case "added": {
          // Sort by date added to watchlist
          const aEntry = watchlist.find((w) => w.id === a.id);
          const bEntry = watchlist.find((w) => w.id === b.id);
          const aDate = aEntry?.addedAt ? new Date(aEntry.addedAt).getTime() : 0;
          const bDate = bEntry?.addedAt ? new Date(bEntry.addedAt).getTime() : 0;
          return dir * (aDate - bDate);
        }
        default:
          return 0;
      }
    });
    return sorted;
  }, [filteredPairs, sortField, sortDirection, watchlist]);

  // Sharp movements: items with >10% change
  const sharpMovements = useMemo(() => {
    return favoritePairs.filter(
      (p) => p.changePercent != null && Math.abs(p.changePercent) > 10
    );
  }, [favoritePairs]);

  // Sort toggle handler
  const handleSort = useCallback(
    (field: SortField) => {
      if (sortField === field) {
        setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      } else {
        setSortField(field);
        setSortDirection(field === "pair" ? "asc" : "desc");
      }
    },
    [sortField]
  );

  // Render sort indicator
  const SortIndicator = ({ field }: { field: SortField }) => {
    if (sortField !== field) {
      return <ArrowUpDown className="h-3 w-3 ml-1 text-muted-foreground/40" aria-hidden="true" />;
    }
    return sortDirection === "asc" ? (
      <ArrowUp className="h-3 w-3 ml-1 text-primary" aria-hidden="true" />
    ) : (
      <ArrowDown className="h-3 w-3 ml-1 text-primary" aria-hidden="true" />
    );
  };

  // Format date added
  const formatDateAdded = (pairId: string): string => {
    const entry = getWatchlistEntry(pairId);
    if (!entry) return "—";
    try {
      return new Date(entry.addedAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
    } catch {
      return "—";
    }
  };

  // Empty state
  if (favorites.length === 0) {
    return (
      <EmptyState
        kind="noFavorites"
        message={t("noFavorites") ?? "No favorites yet"}
        suggestion={t("noFavoritesDesc") ?? "Click the star icon on any item to add it to your watchlist"}
      />
    );
  }

  if (isLoading) {
    return <WatchlistSkeleton count={6} />;
  }

  if (favoritePairs.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        message={t("favoritedNotFound") ?? "Favorited items not found in current league"}
        suggestion={t("favoritedNotFoundDesc") ?? "Try switching leagues or add new favorites"}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Sharp movements alert */}
      {sharpMovements.length > 0 && (
        <Card className="border-amber-500/50 bg-amber-500/5">
          <CardContent className="py-3 px-4">
            <div className="flex items-start gap-2">
              <Zap className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
                  {t("sharpMovements") ?? "Sharp Movements"}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {sharpMovements.map((p) => {
                    const chg = fmtChange(p.changePercent);
                    return (
                      <span key={p.id} className="inline-flex items-center gap-1 mr-2">
                        <span className="font-medium">{p.currency1Name}/{p.currency2Name}</span>
                        <span className={chg.color}>{chg.text}</span>
                      </span>
                    );
                  })}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Toolbar: group filter + search */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Group filter chips */}
        <div className="flex items-center gap-1.5" role="group" aria-label="Watchlist group filter">
          <Badge
            variant={groupFilter === "all" ? "default" : "outline"}
            className="cursor-pointer"
            onClick={() => setGroupFilter("all")}
            role="button"
            aria-pressed={groupFilter === "all"}
            tabIndex={0}
          >
            {t("all") ?? "All"}
          </Badge>
          <Badge
            variant={groupFilter === "gainers" ? "default" : "outline"}
            className="cursor-pointer"
            onClick={() => setGroupFilter("gainers")}
            role="button"
            aria-pressed={groupFilter === "gainers"}
            tabIndex={0}
          >
            <TrendingUp className="h-3 w-3 mr-1" aria-hidden="true" />
            {t("topGainers") ?? "Gainers"}
          </Badge>
          <Badge
            variant={groupFilter === "losers" ? "default" : "outline"}
            className="cursor-pointer"
            onClick={() => setGroupFilter("losers")}
            role="button"
            aria-pressed={groupFilter === "losers"}
            tabIndex={0}
          >
            <TrendingDown className="h-3 w-3 mr-1" aria-hidden="true" />
            {t("topLosers") ?? "Losers"}
          </Badge>
        </div>

        {/* Search within watchlist */}
        <div className="relative min-w-[150px] max-w-[250px]">
          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          <Input
            placeholder={t("searchWatchlist") ?? "Search watchlist..."}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 h-7 text-xs"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-1.5"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
            </button>
          )}
        </div>
      </div>

      {/* Watchlist table */}
      {sortedPairs.length === 0 ? (
        <EmptyState
          kind="noResults"
          message={t("noWatchlistMatches") ?? "No items match your filters"}
          suggestion={t("noWatchlistMatchesDesc") ?? "Try adjusting your search or group filter."}
        />
      ) : (
        <div className="rounded-md border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" role="table">
              <thead>
                <tr className="border-b border-border bg-muted/80">
                  {/* Star */}
                  <th className="w-10 px-2 py-2.5 text-center" scope="col">
                    <Star className="h-3.5 w-3.5 text-muted-foreground mx-auto" aria-hidden="true" />
                  </th>
                  {/* Pair */}
                  <th
                    className="px-3 py-2.5 text-left font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors"
                    scope="col"
                    onClick={() => handleSort("pair")}
                  >
                    <span className="inline-flex items-center">
                      {t("pair") ?? "Pair"}
                      <SortIndicator field="pair" />
                    </span>
                  </th>
                  {/* Rate */}
                  <th
                    className="px-3 py-2.5 text-right font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors"
                    scope="col"
                    onClick={() => handleSort("rate")}
                  >
                    <span className="inline-flex items-center justify-end">
                      {t("rate") ?? "Rate"}
                      <SortIndicator field="rate" />
                    </span>
                  </th>
                  {/* Change */}
                  <th
                    className="px-3 py-2.5 text-right font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors"
                    scope="col"
                    onClick={() => handleSort("change")}
                  >
                    <span className="inline-flex items-center justify-end">
                      {t("change") ?? "Change"}
                      <SortIndicator field="change" />
                    </span>
                  </th>
                  {/* Volume */}
                  <th className="px-3 py-2.5 text-right font-medium text-muted-foreground" scope="col">
                    {t("volume") ?? "Volume"}
                  </th>
                  {/* P&L */}
                  <th
                    className="px-3 py-2.5 text-right font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors"
                    scope="col"
                    onClick={() => handleSort("pnl")}
                  >
                    <span className="inline-flex items-center justify-end">
                      {t("pnl") ?? "P&L"}
                      <SortIndicator field="pnl" />
                    </span>
                  </th>
                  {/* Added date */}
                  <th
                    className="px-3 py-2.5 text-right font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors"
                    scope="col"
                    onClick={() => handleSort("added")}
                  >
                    <span className="inline-flex items-center justify-end">
                      {t("added") ?? "Added"}
                      <SortIndicator field="added" />
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedPairs.map((pair) => {
                  const chg = fmtChange(pair.changePercent);
                  const isFav = favorites.includes(pair.id);
                  const sparklineColor =
                    pair.changePercent != null
                      ? pair.changePercent >= 0
                        ? "#22c55e"
                        : "#ef4444"
                      : "#888888";

                  return (
                    <tr
                      key={pair.id}
                      className="border-b border-border/50 hover:bg-muted/50 transition-colors cursor-pointer group"
                      onClick={() => onPairClick(pair)}
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onPairClick(pair);
                        }
                      }}
                    >
                      {/* Favorite star */}
                      <td className="px-2 py-2 text-center">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleExchangeFavorite(pair.id);
                          }}
                          className="p-0.5 hover:scale-110 transition-transform"
                          aria-label={isFav ? t("removeFromFavorites") ?? "Remove from favorites" : t("addToFavorites") ?? "Add to favorites"}
                        >
                          <Star
                            className={`h-4 w-4 ${
                              isFav
                                ? "fill-amber-400 text-amber-400"
                                : "text-muted-foreground/40 hover:text-amber-400"
                            }`}
                            aria-hidden="true"
                          />
                        </button>
                      </td>
                      {/* Pair */}
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          {pair.currency1IconUrl ? (
                            <img src={pair.currency1IconUrl} alt="" className="w-8 h-8 object-contain" />
                          ) : (
                            <Coins className="w-8 h-8 text-muted-foreground" aria-hidden="true" />
                          )}
                          <span className="font-medium text-sm truncate max-w-[100px]">
                            {pair.currency1Name}
                          </span>
                          <span className="text-muted-foreground text-xs">/</span>
                          {pair.currency2IconUrl ? (
                            <img src={pair.currency2IconUrl} alt="" className="w-8 h-8 object-contain" />
                          ) : (
                            <Coins className="w-8 h-8 text-muted-foreground" aria-hidden="true" />
                          )}
                          <span className="font-medium text-sm truncate max-w-[100px]">
                            {pair.currency2Name}
                          </span>
                        </div>
                      </td>
                      {/* Rate */}
                      <td className="px-3 py-2 text-right">
                        <span className="text-xl font-bold font-mono">
                          {formatPrice(pair.relativePrice, uiState.baseCurrencyText, uiState.baseCurrencyApiId)}
                        </span>
                      </td>
                      {/* Change */}
                      <td className="px-3 py-2 text-right">
                        <span className={`text-xs font-medium ${chg.color}`}>
                          {chg.text}
                        </span>
                      </td>
                      {/* Volume */}
                      <td className="px-3 py-2 text-right">
                        <span className="text-sm text-muted-foreground font-mono">
                          {fmtVolume(pair.volume)}
                        </span>
                      </td>
                      {/* P&L */}
                      <td className="px-3 py-2 text-right">
                        <span className={`text-xs font-semibold font-mono ${chg.color}`}>
                          {fmtChange(pair.changePercent).text}
                        </span>
                      </td>
                      {/* Added date */}
                      <td className="px-3 py-2 text-right">
                        <span className="text-xs text-muted-foreground">
                          {formatDateAdded(pair.id)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
