// ============================================================================
// Currency Card component (React.memo + Compare button + Prefetch on hover)
// WCAG 2.1 AA: role, tabIndex, aria-hidden on decorative icons, keyboard nav
//
// P1-5: Added liquidity dot + range position gauge
// P2-4: Added liquidity score indicator
// ============================================================================
"use client";

import { memo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Coins, Star, GitCompare, Droplets } from "lucide-react";
import { Sparkline } from "./sparkline";
import { fmt, fmtChange, fetchApi } from "@/lib/types";
import type { PoeItem, PoeItemHistoryPoint, BenchmarksResponse } from "@/lib/types";
import { useDashboardStore } from "@/lib/store";
import { useI18n } from "@/lib/i18n";
import { useQueryClient } from "@tanstack/react-query";
import { formatPrice, computeLiquidityScore } from "@/lib/utils";
import { useDisplayPrice } from "@/hooks/use-display-price";
import type { ExchangePair } from "@/lib/types";
import { getCurrencyDisplayName } from "@/lib/currency-names";

interface CurrencyCardProps {
  item: PoeItem;
  onClick: (item: PoeItem) => void;
  realm?: string;
  league?: string;
  referenceCurrency?: string;
  /** §3.5: Whether this card is highlighted from search result navigation */
  highlighted?: boolean;
  /** P0-2 Step 2B: Exchange pairs for client-side price conversion fallback */
  exchangePairs?: ExchangePair[];
}

export const CurrencyCard = memo(function CurrencyCard({
  item,
  onClick,
  realm,
  league,
  referenceCurrency,
  highlighted,
  exchangePairs,
}: CurrencyCardProps) {
  const { t, locale } = useI18n();
  const chg = fmtChange(item.changePercent);
  const sparkData =
    item.history?.map((h) => h.relativePrice ?? h.chaosEquivalentRate ?? 0) || [];
  const { isFavorite, toggleFavorite, isInComparison, addToComparison, removeFromComparison, uiState } =
    useDashboardStore();

  // P0-2 Step 2B: Client-side price conversion fallback.
  // When exchangePairs is provided and the user's reference currency differs
  // from the base, useDisplayPrice converts the price client-side.
  // P0: When adaptive mode is active, useDisplayPrice auto-selects the best unit per card.
  // If exchangePairs is not provided (default), falls back to formatPrice()
  // which uses the API-recalculated price (Step 2A).
  const effectiveBaseCurrencyId = uiState.baseCurrencyApiId === "_adaptive" ? "exalted" : uiState.baseCurrencyApiId;
  const effectiveTargetCurrencyId = referenceCurrency || uiState.baseCurrencyApiId;
  const { displayPrice, currencyLabel, wasConverted } = useDisplayPrice({
    priceInBase: item.relativePrice ?? item.chaosEquivalentRate,
    baseCurrencyApiId: effectiveBaseCurrencyId,
    targetCurrencyApiId: effectiveTargetCurrencyId,
    exchangePairs,
  });
  const fav = isFavorite(item.id);
  const inComparison = isInComparison(item.id);
  const queryClient = useQueryClient();

  // P1-5: Fetch benchmark data for range position gauge (lightweight, cached)
  const { data: benchmarkData } = useQuery<BenchmarksResponse>({
    queryKey: ["benchmark", item.apiId],
    queryFn: () => fetchApi<BenchmarksResponse>(`/api/flipper/benchmarks/${item.apiId}`),
    enabled: !!item.apiId,
    staleTime: 120_000, // 2 min cache
    retry: 0,
  });
  const benchmark = benchmarkData?.benchmark;

  // P2-4: Compute liquidity score from volume data
  // FIX: Previous version passed item.volume as both volumeTraded and highestStock,
  // which always produced ~1.0. Now uses a fixed reference scale (10000) so that
  // volume=100 → ~0.46, volume=1000 → ~0.77, volume=10000 → ~1.0
  const liquidityScore = item.volume != null && item.volume > 0
    ? computeLiquidityScore(item.volume, 10000)
    : null;

  // Prefetch detail history on hover
  const handleMouseEnter = useCallback(() => {
    if (!realm || !league) return;
    queryClient.prefetchQuery({
      queryKey: ["itemHistory", realm, league, item.id, referenceCurrency],
      queryFn: () =>
        fetchApi<PoeItemHistoryPoint[]>("/api/poe2/items", {
          realm,
          league,
          action: "history",
          itemId: item.id,
          logCount: "168",
          referenceCurrency: referenceCurrency || "",
        }),
    });
  }, [queryClient, realm, league, item.id, referenceCurrency]);

  const handleCompareClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (inComparison) {
        removeFromComparison(item.id);
      } else {
        addToComparison(item.id);
      }
    },
    [inComparison, addToComparison, removeFromComparison, item.id]
  );

  return (
    <Card
      ref={highlighted ? (el => { el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }) : undefined}
      className={`cursor-pointer hover:border-primary/50 transition-colors group relative ${highlighted ? 'search-highlight' : ''}`}
      onClick={() => onClick(item)}
      onMouseEnter={handleMouseEnter}
      role="listitem"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick(item);
        }
      }}
    >
      {/* Star (favorite) button */}
      <button
        className="absolute top-2 right-8 z-10 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={(e) => {
          e.stopPropagation();
          toggleFavorite(item.id);
        }}
        aria-label={fav ? t("removeFromFavorites") : t("addToFavorites")}
      >
        <Star
          className={`h-4 w-4 ${
            fav
              ? "fill-yellow-400 text-yellow-400"
              : "text-muted-foreground hover:text-yellow-400"
          }`}
          aria-hidden="true"
        />
      </button>

      {/* Compare button */}
      <button
        className={`absolute top-2 right-2 z-10 ${
          inComparison ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        } transition-opacity`}
        onClick={handleCompareClick}
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

      <CardHeader className="pb-2 pt-3 px-3">
        <div className="flex items-start gap-2">
          {item.iconUrl ? (
            <img
              src={item.iconUrl}
              alt=""
              className="w-8 h-8 object-contain shrink-0"
            />
          ) : (
            <Coins className="w-8 h-8 text-muted-foreground shrink-0" aria-hidden="true" />
          )}
          <div className="flex-1 min-w-0">
            <CardTitle className="text-sm font-semibold truncate">
              {getCurrencyDisplayName(item.apiId || item.id, locale) || item.name}
            </CardTitle>
            <p className="text-xs text-muted-foreground truncate">
              {item.type}
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-3 pb-3 pt-0">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xl font-bold">  {/* §1.6: text-xl for prices */}
              {wasConverted
                ? `${fmt(displayPrice ?? 0, 2)} ${currencyLabel}`
                : formatPrice(item.relativePrice ?? item.chaosEquivalentRate, uiState.baseCurrencyText, uiState.baseCurrencyApiId)
              }
            </p>
            <p className={`text-xs font-medium ${chg.color}`}>{chg.text}</p>
          </div>
          <Sparkline
            data={sparkData}
            color={
              item.changePercent && item.changePercent >= 0
                ? "#34d399"
                : "#f87171"
            }
          />
        </div>
        {/* P1-5: Range Position Gauge — horizontal bar showing where current price
            sits in its 30-day range. Only shown when benchmark data is available. */}
        {benchmark && (
          <div className="mt-2">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-0.5">
              <span>{t("range30d")}</span>
              <span>{(benchmark.rangePosition * 100).toFixed(0)}%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden" role="meter" aria-valuenow={benchmark.rangePosition * 100} aria-valuemin={0} aria-valuemax={100} aria-label={t("range30dAriaLabel")}>
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${Math.max(2, benchmark.rangePosition * 100)}%`,
                  backgroundColor:
                    benchmark.rangePosition >= 0.8 ? "#f87171" :
                    benchmark.rangePosition >= 0.5 ? "#fbbf24" :
                    "#34d399",
                }}
              />
            </div>
            <div className="flex justify-between text-[9px] text-muted-foreground mt-0.5">
              <span>{fmt(benchmark.low30d)}</span>
              <span>{fmt(benchmark.high30d)}</span>
            </div>
          </div>
        )}
        <div className="flex items-center gap-2 mt-1">
          {item.volume != null && (
            <p className="text-xs text-muted-foreground">
              {t("vol")}: {(item.volume ?? 0).toLocaleString()}
            </p>
          )}
          {/* P2-4: Liquidity indicator dot */}
          {liquidityScore != null && (
            <span className="flex items-center gap-0.5" title={t("liquidityScoreTooltip", { "0": (liquidityScore * 100).toFixed(0) })}>
              <Droplets
                className={`h-3 w-3 ${
                  liquidityScore >= 0.7
                    ? "text-blue-500"
                    : liquidityScore >= 0.4
                    ? "text-blue-400/70"
                    : "text-blue-300/50"
                }`}
                aria-hidden="true"
              />
            </span>
          )}
        </div>
        {item.lowConfidence && (
          <Badge
            variant="outline"
            className="mt-1 text-[10px] px-1 py-0"
          >
            {t("lowConfidence")}
          </Badge>
        )}
      </CardContent>
    </Card>
  );
});
