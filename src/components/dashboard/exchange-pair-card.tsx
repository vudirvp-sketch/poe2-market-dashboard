// ============================================================================
// Exchange Pair Card (React.memo)
// WCAG 2.1 AA: aria-hidden on decorative icons, role, keyboard nav
// ============================================================================
"use client";

import { memo, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Coins, ArrowLeftRight, GitCompare } from "lucide-react";
import { fmt, fmtChange } from "@/lib/types";
import type { ExchangePair } from "@/lib/types";
import { useDashboardStore } from "@/lib/store";
import { useI18n } from "@/lib/i18n";
import { PairHoverPreview } from "./pair-hover-preview";

interface ExchangePairCardProps {
  pair: ExchangePair;
  onClick: (pair: ExchangePair) => void;
  /** Current realm — needed for lazy-loaded hover preview (Fix 4.15) */
  realm?: string;
  /** Current league — needed for lazy-loaded hover preview (Fix 4.15) */
  league?: string;
  /** When true, show the hover-triggered sparkline preview (Fix 4.15) */
  showHoverPreview?: boolean;
}

export const ExchangePairCard = memo(function ExchangePairCard({
  pair,
  onClick,
  realm,
  league,
  showHoverPreview = false,
}: ExchangePairCardProps) {
  const { t } = useI18n();
  const chg = fmtChange(pair.changePercent);
  const { pairComparisonIds, addPairToComparison, removePairFromComparison } =
    useDashboardStore();
  const pairKey = `${pair.currency1Id}_${pair.currency2Id}`;
  const inComparison = pairComparisonIds.some(
    (p) => `${p.currency1Id}_${p.currency2Id}` === pairKey
  );

  const handleCompareClick = useCallback(
    (e: React.MouseEvent) => {
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
    },
    [inComparison, addPairToComparison, removePairFromComparison, pairKey, pair]
  );

  return (
    <Card
      className="hover:border-primary/50 transition-colors cursor-pointer group relative"
      onClick={() => onClick(pair)}
      role="listitem"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick(pair);
        }
      }}
    >
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

      <CardContent className="py-3 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {pair.currency1IconUrl ? (
              <img
                src={pair.currency1IconUrl}
                alt=""
                className="w-8 h-8 object-contain"  /* §1.6: 32x32px icons */
              />
            ) : (
              <Coins className="w-8 h-8 text-muted-foreground" aria-hidden="true" />
            )}
            <span className="font-medium text-sm">{pair.currency1Name}</span>
          </div>
          <ArrowLeftRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{pair.currency2Name}</span>
            {pair.currency2IconUrl ? (
              <img
                src={pair.currency2IconUrl}
                alt=""
                className="w-8 h-8 object-contain"  /* §1.6: 32x32px icons */
              />
            ) : (
              <Coins className="w-8 h-8 text-muted-foreground" aria-hidden="true" />
            )}
          </div>
        </div>
        <div className="flex items-center justify-between mt-2">
          <div>
            <span className="text-xl font-bold font-mono">  {/* §1.6: text-xl for prices */}
              {fmt(pair.relativePrice)}
            </span>
            <span className={`ml-2 text-xs font-medium ${chg.color}`}>
              {chg.text}
            </span>
          </div>
          <span className="text-xs text-muted-foreground">
            {t("vol")}: {pair.volume?.toLocaleString() ?? "\u2014"}
          </span>
        </div>

        {/* Fix 4.15: Lazy sparkline on hover */}
        {showHoverPreview && realm && league && (
          <PairHoverPreview
            currency1ItemId={pair.currency1ItemId}
            currency2ItemId={pair.currency2ItemId}
            realm={realm}
            league={league}
          />
        )}
      </CardContent>
    </Card>
  );
});
