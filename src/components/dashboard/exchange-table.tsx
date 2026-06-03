// ============================================================================
// Exchange Table Component (§1.1: Table-First Layout)
//
// Displays exchange pairs in a sortable data table with columns:
// Pair, Rate, Change, Volume, Trend (sparkline).
// Default sort: volume descending.
// Integrates with PersistedUIState for viewMode, sortField, sortDirection.
// ============================================================================
"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import {
  Coins,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Star,
  GitCompare,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { fmt, fmtChange, fetchApi } from "@/lib/types";
import type { ExchangePair, ExchangePairHistoryPoint } from "@/lib/types";
import { useDashboardStore } from "@/lib/store";
import { formatPrice, getCurrencyShortName } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { Sparkline } from "./sparkline";
import { PairHoverPreview } from "./pair-hover-preview";

// ============================================================================
// Types
// ============================================================================

type SortField = "pair" | "rate" | "change" | "change7d" | "volume" | "trend";

interface ExchangeTableProps {
  pairs: ExchangePair[];
  onPairClick: (pair: ExchangePair) => void;
  realm: string;
  league: string;
  /** §3.2: Index of the row to highlight via keyboard navigation */
  highlightedRowIndex?: number | null;
  /** §3.5: Pair ID to highlight and scroll to from search result */
  highlightedItemId?: string | null;
}

// ============================================================================
// Volume formatting helper (K/M suffixes)
// ============================================================================

function fmtVolume(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

// ============================================================================
// Exchange Table
// ============================================================================

export function ExchangeTable({ pairs, onPairClick, realm, league, highlightedRowIndex, highlightedItemId }: ExchangeTableProps) {
  const { t } = useI18n();
  const {
    uiState,
    setExchangeSort,
    toggleExchangeFavorite,
    pairComparisonIds,
    addPairToComparison,
    removePairFromComparison,
  } = useDashboardStore();

  const sortField = uiState.exchange.sortField as SortField;
  const sortDirection = uiState.exchange.sortDirection;
  const favorites = uiState.exchange.favorites;

  // §2.4: Compute max volume for volume color indication
  const maxVolume = useMemo(
    () => Math.max(...pairs.map((p) => p.volume), 1),
    [pairs]
  );

  // --- Sorting ---
  const sortedPairs = useMemo(() => {
    const sorted = [...pairs];
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
        case "change7d": {
          const aChg7d = a.sevenDayChangePercent ?? -Infinity;
          const bChg7d = b.sevenDayChangePercent ?? -Infinity;
          return dir * (aChg7d - bChg7d);
        }
        case "volume":
          return dir * (a.volume - b.volume);
        case "trend": {
          // Sort by changePercent for trend column
          const aChg2 = a.changePercent ?? -Infinity;
          const bChg2 = b.changePercent ?? -Infinity;
          return dir * (aChg2 - bChg2);
        }
        default:
          return dir * (a.volume - b.volume);
      }
    });
    return sorted;
  }, [pairs, sortField, sortDirection]);

  // §3.2: Scroll highlighted row into view
  useEffect(() => {
    if (highlightedRowIndex != null && highlightedRowIndex >= 0) {
      const table = document.querySelector('[data-slot="exchange-table"]');
      const rows = table?.querySelectorAll("tbody tr");
      rows?.[highlightedRowIndex]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [highlightedRowIndex]);

  // §3.5: Scroll highlighted item into view from search
  useEffect(() => {
    if (highlightedItemId) {
      const el = document.querySelector(`[data-pair-id="${highlightedItemId}"]`);
      el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [highlightedItemId]);

  // --- Sort toggle handler ---
  const handleSort = useCallback(
    (field: SortField) => {
      if (sortField === field) {
        // Toggle direction
        setExchangeSort(field, sortDirection === "asc" ? "desc" : "asc");
      } else {
        // Default to desc for volume and change, asc for pair name
        const defaultDir = field === "pair" ? "asc" : "desc";
        setExchangeSort(field, defaultDir);
      }
    },
    [sortField, sortDirection, setExchangeSort]
  );

  // --- Render sort indicator ---
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

  return (
    <div className="rounded-md border border-border overflow-hidden" data-slot="exchange-table">
      <div className="overflow-x-auto">
        <table className="w-full text-sm" role="table">
          <thead>
            <tr className="border-b border-border bg-muted/80">
              {/* Star/Favorite column */}
              <th className="w-10 px-2 py-2.5 text-center" scope="col">
                <Star className="h-3.5 w-3.5 text-muted-foreground mx-auto" aria-hidden="true" />
              </th>
              {/* Pair */}
              <th
                className="px-3 py-2.5 text-left font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors"
                scope="col"
                aria-sort={sortField === "pair" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
                onClick={() => handleSort("pair")}
              >
                <span className="inline-flex items-center">
                  {t("pair")}
                  <SortIndicator field="pair" />
                </span>
              </th>
              {/* Rate */}
              <th
                className="px-3 py-2.5 text-right font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors"
                scope="col"
                aria-sort={sortField === "rate" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
                onClick={() => handleSort("rate")}
              >
                <span className="inline-flex items-center justify-end">
                  {t("rate")} ({getCurrencyShortName(uiState.baseCurrencyText, uiState.baseCurrencyApiId)})
                  <SortIndicator field="rate" />
                </span>
              </th>
              {/* Change */}
              <th
                className="px-3 py-2.5 text-right font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors"
                scope="col"
                aria-sort={sortField === "change" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
                onClick={() => handleSort("change")}
              >
                <span className="inline-flex items-center justify-end">
                  {t("change")}
                  <SortIndicator field="change" />
                </span>
              </th>
              {/* 7d Change */}
              <th
                className="px-3 py-2.5 text-right font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors"
                scope="col"
                aria-sort={sortField === "change7d" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
                onClick={() => handleSort("change7d")}
              >
                <span className="inline-flex items-center justify-end">
                  {t("change7d")}
                  <SortIndicator field="change7d" />
                </span>
              </th>
              {/* Volume */}
              <th
                className="px-3 py-2.5 text-right font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors"
                scope="col"
                aria-sort={sortField === "volume" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
                onClick={() => handleSort("volume")}
              >
                <span className="inline-flex items-center justify-end">
                  {t("volume")}
                  <SortIndicator field="volume" />
                </span>
              </th>
              {/* Trend */}
              <th
                className="px-3 py-2.5 text-center font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors"
                scope="col"
                aria-sort={sortField === "trend" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
                onClick={() => handleSort("trend")}
              >
                <span className="inline-flex items-center justify-center">
                  {t("trend")}
                  <SortIndicator field="trend" />
                </span>
              </th>
              {/* Compare */}
              <th className="w-10 px-2 py-2.5 text-center" scope="col">
                <GitCompare className="h-3.5 w-3.5 text-muted-foreground mx-auto" aria-hidden="true" />
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedPairs.map((pair, index) => {
              const chg = fmtChange(pair.changePercent);
              const chg7d = fmtChange(pair.sevenDayChangePercent);
              const isFav = favorites.includes(pair.id);
              const pairKey = `${pair.currency1Id}_${pair.currency2Id}`;
              const inComparison = pairComparisonIds.some(
                (p) => `${p.currency1Id}_${p.currency2Id}` === pairKey
              );
              // Sparkline color based on change direction
              const sparklineColor =
                pair.changePercent != null
                  ? pair.changePercent >= 0
                    ? "#22c55e"
                    : "#ef4444"
                  : "#888888";

              // §2.4: Volume color indication — background opacity proportional to volume rank
              const volumeRank = pair.volume / maxVolume;
              const volumeBgStyle = {
                '--vol-opacity': volumeRank.toFixed(3),
              } as React.CSSProperties;

              return (
                <tr
                  key={pair.id}
                  className={`border-b border-border/50 hover:bg-muted/50 transition-colors cursor-pointer group volume-indicator-row ${
                    index === highlightedRowIndex
                      ? "bg-accent/80 ring-2 ring-inset ring-primary/40"
                      : ""
                  } ${
                    highlightedItemId === pair.id ? 'search-highlight' : ''
                  }`}
                  style={volumeBgStyle}
                  data-pair-id={pair.id}
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
                      aria-label={isFav ? t("removeFromFavorites") : t("addToFavorites")}
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
                  {/* Pair name with icons */}
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      {pair.currency1IconUrl ? (
                        <img
                          src={pair.currency1IconUrl}
                          alt=""
                          className="w-8 h-8 object-contain"  /* §1.6: 32x32px icons */
                        />
                      ) : (
                        <Coins className="w-8 h-8 text-muted-foreground" aria-hidden="true" />
                      )}
                      <span className="font-medium text-sm truncate max-w-[120px]">
                        {pair.currency1Name}
                      </span>
                      <span className="text-muted-foreground text-xs">/</span>
                      {pair.currency2IconUrl ? (
                        <img
                          src={pair.currency2IconUrl}
                          alt=""
                          className="w-8 h-8 object-contain"  /* §1.6: 32x32px icons */
                        />
                      ) : (
                        <Coins className="w-8 h-8 text-muted-foreground" aria-hidden="true" />
                      )}
                      <span className="font-medium text-sm truncate max-w-[120px]">
                        {pair.currency2Name}
                      </span>
                    </div>
                  </td>
                  {/* Rate — cross-rate: how many currency2 per 1 unit of currency1 */}
                  <td className="px-3 py-2 text-right">
                    <span className="text-xl font-bold font-mono">
                      {formatPrice(
                        pair.relativePrice && pair.currency2RelativePrice && pair.currency2RelativePrice > 0
                          ? pair.relativePrice / pair.currency2RelativePrice
                          : pair.relativePrice ?? 0,
                        uiState.baseCurrencyText,
                        uiState.baseCurrencyApiId,
                      )}
                    </span>
                  </td>
                  {/* Change */}
                  <td className="px-3 py-2 text-right">
                    <span className={`text-xs font-medium ${chg.color}`}>
                      {chg.text}
                    </span>
                  </td>
                  {/* 7d Change */}
                  <td className="px-3 py-2 text-right">
                    <span className={`text-xs font-medium ${chg7d.color}`}>
                      {chg7d.text}
                    </span>
                  </td>
                  {/* Volume */}
                  <td className="px-3 py-2 text-right">
                    <span className="text-sm text-muted-foreground font-mono">
                      {fmtVolume(pair.volume)}
                    </span>
                  </td>
                  {/* Trend sparkline */}
                  <td className="px-3 py-2 text-center">
                    <InlineSparkline
                      pair={pair}
                      realm={realm}
                      league={league}
                      sparklineColor={sparklineColor}
                    />
                  </td>
                  {/* Compare button */}
                  <td className="px-2 py-2 text-center">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (inComparison) {
                          removePairFromComparison(pairKey);
                        } else {
                          addPairToComparison({
                            currency1Id: pair.currency1Id,
                            currency2Id: pair.currency2Id,
                            currency1ItemId: pair.currency1ItemId,
                            currency2ItemId: pair.currency2ItemId,
                            label: `${pair.currency1Name} / ${pair.currency2Name}`,
                          });
                        }
                      }}
                      className={`p-0.5 transition-opacity ${
                        inComparison ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                      }`}
                      aria-label={inComparison ? t("removeFromComparison") : t("addToComparison")}
                    >
                      <GitCompare
                        className={`h-4 w-4 ${
                          inComparison
                            ? "text-primary"
                            : "text-muted-foreground hover:text-primary"
                        }`}
                        aria-hidden="true"
                      />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================================
// Inline Sparkline for Exchange Table rows
// Uses history data if available from the pair, otherwise shows a hover-to-load preview
// ============================================================================

interface InlineSparklineProps {
  pair: ExchangePair;
  realm: string;
  league: string;
  sparklineColor: string;
}

function InlineSparkline({ pair, realm, league, sparklineColor }: InlineSparklineProps) {
  // If the pair already has history data, use it directly
  const historyPrices = pair.history?.map((h) => h.relativePrice);

  if (historyPrices && historyPrices.length >= 2) {
    return <Sparkline data={historyPrices} color={sparklineColor} width={80} height={28} />;
  }

  // Otherwise, render the hover-to-load preview inline
  return (
    <TableSparklinePreview
      currency1ItemId={pair.currency1ItemId}
      currency2ItemId={pair.currency2ItemId}
      realm={realm}
      league={league}
      sparklineColor={sparklineColor}
    />
  );
}

// ============================================================================
// Table-specific Sparkline Preview (compact version of PairHoverPreview)
// ============================================================================

interface TableSparklinePreviewProps {
  currency1ItemId: number;
  currency2ItemId: number;
  realm: string;
  league: string;
  sparklineColor: string;
}

function TableSparklinePreview({
  currency1ItemId,
  currency2ItemId,
  realm,
  league,
  sparklineColor,
}: TableSparklinePreviewProps) {
  const [hovered, setHovered] = useState(false);
  const { data: pairHistory } = useQuery<ExchangePairHistoryPoint[]>({
    queryKey: ["pairHoverHistory", realm, league, currency1ItemId, currency2ItemId],
    queryFn: () =>
      fetchApi<ExchangePairHistoryPoint[]>("/api/poe2/currencies", {
        realm,
        league,
        action: "pairHistory",
        id1: String(currency1ItemId),
        id2: String(currency2ItemId),
        limit: "48",
      }),
    enabled: hovered,
    staleTime: 120_000,
    retry: 0,
  });

  const sparklineData = pairHistory?.map((p) => p.relativePrice) ?? [];

  return (
    <div
      className="h-7 w-20 flex items-center justify-center"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {sparklineData.length >= 2 ? (
        <Sparkline data={sparklineData} color={sparklineColor} width={80} height={28} />
      ) : hovered ? (
        <span className="text-[10px] text-muted-foreground animate-pulse">…</span>
      ) : (
        <span className="text-muted-foreground text-xs">—</span>
      )}
    </div>
  );
}


