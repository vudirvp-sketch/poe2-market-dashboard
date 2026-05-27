// ============================================================================
// Watchlist Tab (Priority 3.1)
// ============================================================================
"use client";

import { useQuery } from "@tanstack/react-query";
import { Star, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sparkline } from "./sparkline";
import { fmt, fmtChange, fetchApi } from "@/lib/types";
import type { PoeItem } from "@/lib/types";
import { useDashboardStore } from "@/lib/store";
import { useI18n } from "@/lib/i18n";

interface WatchlistTabProps {
  realm: string;
  league: string;
  onItemClick: (item: PoeItem) => void;
}

export function WatchlistTab({ realm, league, onItemClick }: WatchlistTabProps) {
  const { t } = useI18n();
  const { favorites, removeFavorite, isFavorite } = useDashboardStore();

  // Fetch all items and filter client-side by favorites
  const { data: allItems, isLoading } = useQuery({
    queryKey: ["allItems", realm, league],
    queryFn: () => fetchApi<PoeItem[]>("/api/poe2/items", { realm, league }),
    enabled: !!league && favorites.length > 0,
  });

  const watchedItems = allItems?.filter((i) => isFavorite(i.id)) ?? [];

  if (favorites.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <Star className="h-12 w-12 mb-4" />
        <p className="text-lg mb-1">{t("noFavorites")}</p>
        <p className="text-sm">{t("noFavoritesDesc")}</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (watchedItems.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <Star className="h-12 w-12 mb-4" />
        <p className="text-lg mb-1">{t("favoritedNotFound")}</p>
        <p className="text-sm">{t("favoritedNotFoundDesc")}</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
      {watchedItems.map((item) => {
        const chg = fmtChange(item.changePercent);
        const sparkData =
          item.history?.map((h) => h.relativePrice ?? h.priceChaos ?? 0) || [];
        return (
          <Card
            key={item.id}
            className="cursor-pointer hover:border-primary/50 transition-colors relative group"
            onClick={() => onItemClick(item)}
          >
            <button
              className="absolute top-2 right-2 z-10"
              onClick={(e) => {
                e.stopPropagation();
                removeFavorite(item.id);
              }}
            >
              <Star className="h-4 w-4 fill-yellow-400 text-yellow-400 hover:text-red-400" />
            </button>
            <CardContent className="py-3 px-3">
              <div className="flex items-start gap-2 mb-2">
                {item.iconUrl ? (
                  <img
                    src={item.iconUrl}
                    alt=""
                    className="w-8 h-8 object-contain shrink-0"
                  />
                ) : (
                  <Star className="w-8 h-8 text-muted-foreground shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{item.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {item.type || item.category}
                  </p>
                </div>
              </div>
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-lg font-bold">
                    {fmt(item.relativePrice ?? item.priceChaos)}
                  </p>
                  <p className={`text-xs font-medium ${chg.color}`}>
                    {chg.text}
                  </p>
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
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
