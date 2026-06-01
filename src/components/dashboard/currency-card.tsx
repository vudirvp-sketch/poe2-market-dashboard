// ============================================================================
// Currency Card component (React.memo + Compare button + Prefetch on hover)
// WCAG 2.1 AA: role, tabIndex, aria-hidden on decorative icons, keyboard nav
// ============================================================================
"use client";

import { memo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Coins, Star, GitCompare } from "lucide-react";
import { Sparkline } from "./sparkline";
import { fmt, fmtChange, fetchApi } from "@/lib/types";
import type { PoeItem, PoeItemHistoryPoint } from "@/lib/types";
import { useDashboardStore } from "@/lib/store";
import { useI18n } from "@/lib/i18n";
import { useQueryClient } from "@tanstack/react-query";
import { formatPrice } from "@/lib/utils";

interface CurrencyCardProps {
  item: PoeItem;
  onClick: (item: PoeItem) => void;
  realm?: string;
  league?: string;
  referenceCurrency?: string;
  /** §3.5: Whether this card is highlighted from search result navigation */
  highlighted?: boolean;
}

export const CurrencyCard = memo(function CurrencyCard({
  item,
  onClick,
  realm,
  league,
  referenceCurrency,
  highlighted,
}: CurrencyCardProps) {
  const { t } = useI18n();
  const chg = fmtChange(item.changePercent);
  const sparkData =
    item.history?.map((h) => h.relativePrice ?? h.priceChaos ?? 0) || [];
  const { isFavorite, toggleFavorite, isInComparison, addToComparison, removeFromComparison, uiState } =
    useDashboardStore();
  const fav = isFavorite(item.id);
  const inComparison = isInComparison(item.id);
  const queryClient = useQueryClient();

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
              {item.name}
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
              {formatPrice(item.relativePrice ?? item.priceChaos, uiState.baseCurrencyText, uiState.baseCurrencyApiId)}
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
        {item.volume != null && (
          <p className="text-xs text-muted-foreground mt-1">
            {t("vol")}: {item.volume.toLocaleString()}
          </p>
        )}
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
