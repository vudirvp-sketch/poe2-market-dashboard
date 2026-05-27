// ============================================================================
// Exchange Pair Card (React.memo)
// ============================================================================
"use client";

import { memo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Coins, ArrowLeftRight } from "lucide-react";
import { fmt, fmtChange } from "@/lib/types";
import type { ExchangePair } from "@/lib/types";

interface ExchangePairCardProps {
  pair: ExchangePair;
  onClick: (pair: ExchangePair) => void;
}

export const ExchangePairCard = memo(function ExchangePairCard({
  pair,
  onClick,
}: ExchangePairCardProps) {
  const chg = fmtChange(pair.changePercent);
  return (
    <Card
      className="hover:border-primary/50 transition-colors cursor-pointer"
      onClick={() => onClick(pair)}
    >
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
            Vol: {pair.volume?.toLocaleString() ?? "—"}
          </span>
        </div>
      </CardContent>
    </Card>
  );
});
