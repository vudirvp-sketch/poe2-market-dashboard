// ============================================================================
// Arbitrage Client Table — Client-side arbitrage cycle results display
// Extracted from arbitrage-tab.tsx (ШАГ 3 refactoring)
// ============================================================================
"use client";

import { memo, useMemo } from "react";
import { AlertTriangle, ArrowRight, TrendingUp, Search, Layers, BarChart3 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n";
import type { ExchangePair } from "@/lib/types";
import type { ArbitrageCycle } from "./arbitrage-helpers";
import { MAX_CYCLE_LEN } from "./arbitrage-helpers";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ArbitrageClientTableProps {
  pairs: ExchangePair[] | undefined;
  cycles: ArbitrageCycle[];
  minVolume: number;
  baseSlippageBps: number;
  tradingFeeBps: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ArbitrageClientTable = memo(function ArbitrageClientTable({
  pairs,
  cycles,
  minVolume,
  baseSlippageBps,
  tradingFeeBps,
}: ArbitrageClientTableProps) {
  const { t } = useI18n();

  // Count unique currencies in graph
  const uniqueTokens = useMemo(() => {
    if (!pairs) return 0;
    const ids = new Set<string>();
    for (const p of pairs) {
      ids.add(p.currency1Id);
      ids.add(p.currency2Id);
    }
    return ids.size;
  }, [pairs]);

  // Pairs that pass the volume filter
  const scannedCount = useMemo(() => {
    if (!pairs) return 0;
    return pairs.filter((p) => (p.volume ?? 0) >= minVolume).length;
  }, [pairs, minVolume]);

  // Deduplicate cycles by route signature
  const uniqueCycles = useMemo(() => {
    const seen = new Set<string>();
    return cycles.filter((c) => {
      const sig = [...c.route].sort().join("-");
      if (seen.has(sig)) return false;
      seen.add(sig);
      return true;
    });
  }, [cycles]);

  return (
    <>
      {/* ---- Stats row ---- */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <Search className="h-3.5 w-3.5" aria-hidden="true" />
              {t("scannedPairs")}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0">
            <p className="text-2xl font-bold">{scannedCount}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t("ofTotal", { "0": String(pairs?.length ?? 0), "1": String(minVolume) })}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5" aria-hidden="true" />
              {t("currencies")}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0">
            <p className="text-2xl font-bold">{uniqueTokens}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t("uniqueTokensInGraph")}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />
              {t("opportunitiesFound")}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0">
            <p className="text-2xl font-bold">{uniqueCycles.length}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t("cyclesWithPositiveNetProfit")}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ---- Opportunities table ---- */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
            <BarChart3 className="h-4 w-4" aria-hidden="true" />
            {t("arbitrageOpportunities")}
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            {t(
              "showingTopOpportunities",
              {
                "0": String(uniqueCycles.length),
                "1": String(MAX_CYCLE_LEN),
                "2": String(minVolume),
                "3": String(baseSlippageBps),
                "4": String(tradingFeeBps),
              },
            )}
          </p>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0">
          {uniqueCycles.length === 0 ? (
            <div className="text-center py-10">
              <AlertTriangle className="h-10 w-10 text-muted-foreground mx-auto mb-3" aria-hidden="true" />
              <p className="font-medium">{t("noArbitrage")}</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
                {t("noArbitrageDesc")}
              </p>
            </div>
          ) : (
            <div className="space-y-0" role="table" aria-label={t("arbitrageOpportunities")}>
              {/* Table header — §8: profit shown as %, not absolute */}
              <div className="grid grid-cols-[1fr_50px_75px_75px_70px_75px_80px_90px] gap-2 py-2 px-2 text-xs font-medium text-muted-foreground border-b border-border sticky top-0 bg-card z-10" role="row">
                <span role="columnheader">{t("route")}</span>
                <span className="text-center" role="columnheader">{t("len")}</span>
                <span className="text-right" role="columnheader">{t("netProfitPct")}</span>
                <span className="text-right" role="columnheader">{t("grossPct")}</span>
                <span className="text-right" role="columnheader">{t("spreadPct")}</span>
                <span className="text-right" role="columnheader">{t("slippage")}</span>
                <span className="text-center" role="columnheader">{t("confidence")}</span>
                <span className="text-right" role="columnheader">{t("maxVol")}</span>
              </div>

              {/* Table body */}
              <div className="max-h-96 overflow-y-auto" role="rowgroup">
                {uniqueCycles.map((cycle, idx) => {
                  const routeNames = cycle.route.map(
                    (id) => cycle.edges.find((e) => e.from === id)?.fromName ?? id,
                  );
                  const startName =
                    cycle.edges[0]?.fromName ?? routeNames[0];
                  routeNames.push(startName);

                  return (
                    <div
                      key={idx}
                      className="grid grid-cols-[1fr_50px_75px_75px_70px_75px_80px_90px] gap-2 py-2 px-2 text-sm border-b border-border/50 hover:bg-muted/20 transition-colors items-center"
                      role="row"
                    >
                      <div className="flex items-center gap-1 flex-wrap min-w-0" role="cell">
                        {routeNames.map((name, i) => (
                          <span key={i} className="flex items-center gap-1">
                            <span className="truncate text-xs font-medium">
                              {name}
                            </span>
                            {i < routeNames.length - 1 && (
                              <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" aria-hidden="true" />
                            )}
                          </span>
                        ))}
                      </div>

                      <span className="text-center text-xs text-muted-foreground font-mono" role="cell">
                        {cycle.edges.length}
                      </span>

                      <span className="text-right font-mono text-xs font-semibold text-emerald-600 dark:text-emerald-400" role="cell">
                        +{cycle.netProfitPct.toFixed(2)}%
                      </span>

                      <span className="text-right font-mono text-xs text-muted-foreground" role="cell">
                        {cycle.grossProfitPct.toFixed(2)}%
                      </span>

                      <span className="text-right font-mono text-xs text-muted-foreground" role="cell">
                        {cycle.totalSpreadPct.toFixed(2)}%
                      </span>

                      <span className="text-right font-mono text-xs text-muted-foreground" role="cell">
                        {(cycle.slippage * 100).toFixed(2)}%
                      </span>

                      <span className="flex justify-center" role="cell">
                        <Badge
                          variant="outline"
                          className={`text-[10px] px-1.5 py-0 font-semibold ${
                            cycle.confidence >= 0.7
                              ? "border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
                              : cycle.confidence >= 0.3
                              ? "border-amber-500/50 text-amber-600 dark:text-amber-400 bg-amber-500/10"
                              : "border-red-500/50 text-red-600 dark:text-red-400 bg-red-500/10"
                          }`}
                        >
                          {cycle.confidence >= 0.7
                            ? t("confidenceHigh")
                            : cycle.confidence >= 0.3
                            ? t("confidenceMedium")
                            : t("confidenceLow")}
                        </Badge>
                      </span>

                      <span className="text-right font-mono text-xs text-muted-foreground" role="cell">
                        {isFinite(cycle.maxVolume) ? cycle.maxVolume.toLocaleString() : "\u221E"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
});
