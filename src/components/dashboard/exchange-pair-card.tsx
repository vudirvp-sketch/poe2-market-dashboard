// ============================================================================
// Exchange Pair Card (React.memo)
// ============================================================================
"use client";

import { memo, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Coins, ArrowLeftRight, GitCompare } from "lucide-react";
import { fmt, fmtChange } from "@/lib/types";
import type { ExchangePair } from "@/lib/types";
import { useDashboardStore } from "@/lib/store";
import { useI18n } from "@/lib/i18n";

interface ExchangePairCardProps {
  pair: ExchangePair;
  onClick: (pair: ExchangePair) => void;
}

export const ExchangePairCard = memo(function ExchangePairCard({
  pair,
  onClick,
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
    >
      {/* Compare button */}
      <button
        className={`absolute top-2 right-2 z-10 ${
          inComparison ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        } transition-opacity`}
        onClick={handleCompareClick}
        title={inComparison ? t("removeFromComparison") : t("addToComparison")}
      >
        <GitCompare
          className={`h-4 w-4 ${
            inComparison
              ? "text-primary"
              : "text-muted-foreground hover:text-primary"
          }`}
        />
      </button>

      <CardContent className="py-3 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {pair.currency1IconUrl ? (
              <img
                src={pair.currency1IconUrl}
                alt=""
                className="w-5 h-5 object-contain"
              />
            ) : (
              <Coins className="w-5 h-5 text-muted-foreground" />
            )}
            <span className="font-medium text-sm">{pair.currency1Name}</span>
          </div>
          <ArrowLeftRight className="h-4 w-4 text-muted-foreground" />
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{pair.currency2Name}</span>
            {pair.currency2IconUrl ? (
              <img
                src={pair.currency2IconUrl}
                alt=""
                className="w-5 h-5 object-contain"
              />
            ) : (
              <Coins className="w-5 h-5 text-muted-foreground" />
            )}
          </div>
        </div>
        <div className="flex items-center justify-between mt-2">
          <div>
            <span className="text-lg font-bold font-mono">
              {fmt(pair.relativePrice)}
            </span>
            <span className={`ml-2 text-xs font-medium ${chg.color}`}>
              {chg.text}
            </span>
          </div>
          <span className="text-xs text-muted-foreground">
            {t("vol")}: {pair.volume?.toLocaleString() ?? "—"}
          </span>
        </div>
      </CardContent>
    </Card>
  );
});
