// ============================================================================
// Virtualized Currency Grid — Renders currency cards with virtualization
// for leagues with 100+ currencies. Uses @tanstack/react-virtual.
// Task 6.12: Responsive columns via ResizeObserver (was hardcoded before).
// ============================================================================
"use client";

import { useRef, useCallback, memo, useState, useEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Coins, Star, GitCompare } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sparkline } from "./sparkline";
import { fmt, fmtChange, fetchApi } from "@/lib/types";
import { formatPrice } from "@/lib/utils";
import type { PoeItem, PoeItemHistoryPoint, ExchangePair } from "@/lib/types";
import { useDisplayPrice } from "@/hooks/use-display-price";
import { useDashboardStore } from "@/lib/store";
import { useI18n } from "@/lib/i18n";
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
  /** P0-2 Step 2B: Exchange pairs for client-side price conversion fallback */
  exchangePairs?: ExchangePair[];
}

// Card height estimate (for virtualizer)
const CARD_HEIGHT = 160;
// Gap between cards
const GAP = 12;
// Minimum card width in px for responsive column calculation
const MIN_CARD_WIDTH = 280;

// ---------------------------------------------------------------------------
// Inner Card Component (memoized for virtual list performance)
// ---------------------------------------------------------------------------

const VirtualCurrencyCard = memo(function VirtualCurrencyCard({
  item,
  onClick,
  realm,
  league,
  referenceCurrency,
  exchangePairsForConversion,
}: {
  item: PoeItem;
  onClick: (item: PoeItem) => void;
  realm?: string;
  league?: string;
  referenceCurrency?: string;
  exchangePairsForConversion?: ExchangePair[];
}) {
  const { t } = useI18n();
  const chg = fmtChange(item.changePercent);
  const sparkData =
    item.history?.map((h) => h.relativePrice ?? h.chaosEquivalentRate ?? 0) || [];
  const { isFavorite, toggleFavorite, isInComparison, addToComparison, removeFromComparison, uiState } =
    useDashboardStore();

  // P0-2 Step 2B: Client-side price conversion fallback
  // P0: When adaptive mode is active, useDisplayPrice auto-selects the best unit per card
  const effectiveBaseCurrencyId = uiState.baseCurrencyApiId === "_adaptive" ? "exalted" : uiState.baseCurrencyApiId;
  const effectiveTargetCurrencyId = referenceCurrency || uiState.baseCurrencyApiId;
  const { displayPrice, currencyLabel, wasConverted } = useDisplayPrice({
    priceInBase: item.relativePrice ?? item.chaosEquivalentRate,
    baseCurrencyApiId: effectiveBaseCurrencyId,
    targetCurrencyApiId: effectiveTargetCurrencyId,
    exchangePairs: exchangePairsForConversion,
  });
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
      role="gridcell"
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
            <p className="text-lg font-bold">
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

// ---------------------------------------------------------------------------
// Main Virtualized Grid Component — with responsive columns (Task 6.12)
// ---------------------------------------------------------------------------

export function VirtualCurrencyGrid({
  items,
  onItemClick,
  realm,
  league,
  referenceCurrency,
  exchangePairs,
}: VirtualCurrencyGridProps) {
  const { t } = useI18n();
  const parentRef = useRef<HTMLDivElement>(null);

  // Responsive column count based on container width via ResizeObserver
  const [columns, setColumns] = useState(4);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateColumns = (width: number) => {
      setColumns(Math.max(1, Math.floor(width / MIN_CARD_WIDTH)));
    };

    // Initial measurement
    updateColumns(el.clientWidth);

    const observer = new ResizeObserver((entries) => {
      const width = entries[0].contentRect.width;
      updateColumns(width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Calculate the number of rows (each row has `columns` cards)
  const rowCount = Math.ceil(items.length / columns);

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => CARD_HEIGHT + GAP,
    overscan: 5,
  });

  // Keyboard navigation: arrow keys to move focus between grid cells
  const handleGridKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const gridcells = containerRef.current?.querySelectorAll('[role="gridcell"]');
      if (!gridcells || !gridcells.length) return;

      const currentIdx = Array.from(gridcells).indexOf(target);
      if (currentIdx === -1) return;

      let nextIdx = -1;
      if (e.key === "ArrowRight") nextIdx = currentIdx + 1;
      else if (e.key === "ArrowLeft") nextIdx = currentIdx - 1;
      else if (e.key === "ArrowDown") nextIdx = currentIdx + columns;
      else if (e.key === "ArrowUp") nextIdx = currentIdx - columns;

      if (nextIdx >= 0 && nextIdx < gridcells.length) {
        e.preventDefault();
        (gridcells[nextIdx] as HTMLElement).focus();
      }
    },
    [columns]
  );

  return (
    <div
      ref={parentRef}
      className="overflow-auto"
      style={{ maxHeight: "75vh" }}
    >
      <div
        ref={containerRef}
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
        role="grid"
        aria-label={t("ariaCurrencyItemsGrid")}
        onKeyDown={handleGridKeyDown}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const startIdx = virtualRow.index * columns;
          const rowItems = items.slice(startIdx, startIdx + columns);

          return (
            <div
              key={virtualRow.index}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
                display: "grid",
                gridTemplateColumns: `repeat(${columns}, 1fr)`,
                gap: `${GAP}px`,
              }}
              role="row"
            >
              {rowItems.map((item) => (
                <VirtualCurrencyCard
                  key={item.id}
                  item={item}
                  onClick={onItemClick}
                  realm={realm}
                  league={league}
                  referenceCurrency={referenceCurrency}
                  exchangePairsForConversion={exchangePairs}
                />
              ))}
              {/* Fill empty cells in the last row to maintain consistent grid */}
              {rowItems.length < columns &&
                Array.from({ length: columns - rowItems.length }).map((_, i) => (
                  <div key={`empty-${i}`} role="gridcell" />
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
