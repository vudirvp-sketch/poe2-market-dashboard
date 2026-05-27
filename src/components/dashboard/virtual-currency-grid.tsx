// ============================================================================
// Virtualized Currency Grid — Renders currency cards with virtualization
// for leagues with 100+ currencies. Uses @tanstack/react-virtual.
// ============================================================================
"use client";

import { useRef, useCallback, memo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Coins, Star, GitCompare } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sparkline } from "./sparkline";
import { fmt, fmtChange, fetchApi } from "@/lib/types";
import type { PoeItem, PoeItemHistoryPoint } from "@/lib/types";
import { useDashboardStore } from "@/lib/store";
import { useQueryClient } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VirtualCurrencyGridProps {
  items: PoeItem[];
  onItemClick: (item: PoeItem) => void;
  realm?: string;
  league?: string;
  referenceCurrency?: string;
}

// Card height estimate (for virtualizer)
const CARD_HEIGHT = 160;
// Gap between cards
const GAP = 12;

// ---------------------------------------------------------------------------
// Inner Card Component (memoized for virtual list performance)
// ---------------------------------------------------------------------------

const VirtualCurrencyCard = memo(function VirtualCurrencyCard({
  item,
  onClick,
  realm,
  league,
  referenceCurrency,
}: {
  item: PoeItem;
  onClick: (item: PoeItem) => void;
  realm?: string;
  league?: string;
  referenceCurrency?: string;
}) {
  const chg = fmtChange(item.changePercent);
  const sparkData =
    item.history?.map((h) => h.relativePrice ?? h.priceChaos ?? 0) || [];
  const { isFavorite, toggleFavorite, isInComparison, addToComparison, removeFromComparison } =
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
      className="cursor-pointer hover:border-primary/50 transition-colors group relative"
      onClick={() => onClick(item)}
      onMouseEnter={handleMouseEnter}
    >
      {/* Star (favorite) button */}
      <button
        className="absolute top-2 right-8 z-10 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={(e) => {
          e.stopPropagation();
          toggleFavorite(item.id);
        }}
        aria-label={fav ? "Remove from favorites" : "Add to favorites"}
      >
        <Star
          className={`h-4 w-4 ${
            fav
              ? "fill-yellow-400 text-yellow-400"
              : "text-muted-foreground hover:text-yellow-400"
          }`}
        />
      </button>

      {/* Compare button */}
      <button
        className={`absolute top-2 right-2 z-10 ${
          inComparison ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        } transition-opacity`}
        onClick={handleCompareClick}
        aria-label={inComparison ? "Remove from comparison" : "Add to comparison"}
      >
        <GitCompare
          className={`h-4 w-4 ${
            inComparison
              ? "text-primary"
              : "text-muted-foreground hover:text-primary"
          }`}
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
            <Coins className="w-8 h-8 text-muted-foreground shrink-0" />
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
            <p className="text-lg font-bold">
              {fmt(item.relativePrice ?? item.priceChaos)}
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
            Vol: {item.volume.toLocaleString()}
          </p>
        )}
        {item.lowConfidence && (
          <Badge
            variant="outline"
            className="mt-1 text-[10px] px-1 py-0"
          >
            Low Confidence
          </Badge>
        )}
      </CardContent>
    </Card>
  );
});

// ---------------------------------------------------------------------------
// Main Virtualized Grid Component
// ---------------------------------------------------------------------------

export function VirtualCurrencyGrid({
  items,
  onItemClick,
  realm,
  league,
  referenceCurrency,
}: VirtualCurrencyGridProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  // Calculate the number of columns based on container width
  // We'll use CSS grid and let the virtualizer handle row-level rendering
  const COLUMN_MIN_WIDTH = 220; // minimum card width in px

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => CARD_HEIGHT + GAP,
    overscan: 5,
  });

  return (
    <div
      ref={parentRef}
      className="overflow-auto"
      style={{ maxHeight: "75vh" }}
      role="list"
      aria-label="Currency items grid"
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(auto-fill, minmax(${COLUMN_MIN_WIDTH}px, 1fr))`,
            gap: `${GAP}px`,
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
          }}
        >
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const item = items[virtualItem.index];
            return (
              <div
                key={item.id}
                style={{
                  transform: `translateY(${virtualItem.start - virtualItem.index * (CARD_HEIGHT + GAP) + virtualItem.index * (CARD_HEIGHT + GAP)}px)`,
                  height: `${CARD_HEIGHT}px`,
                }}
                role="listitem"
              >
                <VirtualCurrencyCard
                  item={item}
                  onClick={onItemClick}
                  realm={realm}
                  league={league}
                  referenceCurrency={referenceCurrency}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
