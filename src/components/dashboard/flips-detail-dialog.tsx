// ============================================================================
// Flips Detail Dialog — Detailed view for a single flip opportunity
// Shows score, spread, fees, momentum, volatility, cluster, prices,
// volume, and storage value decision.
//
// P1-1/P1-3: Added quantized analysis panel (Q-Spread table, Brick Risk, Tier)
// ============================================================================
"use client";

import React from "react";
import { TrendingUp, TrendingDown, Minus, AlertTriangle, Shield, Boxes } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n";
import { fmt } from "@/lib/types";
import { formatPrice } from "@/lib/utils";
import { useDashboardStore } from "@/lib/store";
import { isFlipDataSuspicious } from "@/lib/flipper-helpers";
import {
  type FlipOpportunity,
  type StorageValueResponse,
  scoreColor,
  clusterBadgeClass,
  clusterLabel,
  decisionBadgeClass,
} from "./flips-helpers";

function momentumIconLocal(momentum: number) {
  if (momentum > 0.001) return <TrendingUp className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />;
  if (momentum < -0.001) return <TrendingDown className="h-3.5 w-3.5 text-red-500" aria-hidden="true" />;
  return <Minus className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />;
}

interface FlipsDetailDialogProps {
  selectedFlip: FlipOpportunity;
  storageData: StorageValueResponse | undefined;
}

export function FlipsDetailDialog({ selectedFlip, storageData }: FlipsDetailDialogProps) {
  const { t } = useI18n();
  const { uiState } = useDashboardStore();
  const suspicious = isFlipDataSuspicious(selectedFlip);

  return (
    <div className="space-y-4">
      {/* §0.4: Data quality warning — shown when flip data looks suspicious */}
      {suspicious && (
        <div className="flex items-center gap-2 p-3 rounded-lg border border-amber-500/30 bg-amber-500/5">
          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" aria-hidden="true" />
          <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
            {t("flipsDataQualityWarning")}
          </span>
        </div>
      )}

      {/* Score & Spread */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">{t("flipperScore")}</p>
          <p className={`text-lg font-bold ${scoreColor(selectedFlip.score)}`}>
            {(selectedFlip.score * 100).toFixed(1)}%
          </p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">{t("flipperSpread")}</p>
          <p className="text-lg font-bold font-mono">
            {((selectedFlip.spread ?? selectedFlip.spread_after_fees) * 100).toFixed(2)}%
          </p>
        </div>
      </div>

      {/* Momentum, Volatility, Cluster */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground mb-1">{t("flipperMomentum")}</p>
          <div className="flex items-center gap-1.5">
            {momentumIconLocal(selectedFlip.momentum)}
            <span className="font-mono text-sm font-medium">
              {selectedFlip.momentum >= 0 ? "+" : ""}
              {(selectedFlip.momentum * 100).toFixed(2)}%
            </span>
          </div>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground mb-1">{t("flipperVolatility")}</p>
          <p className="font-mono text-sm font-medium">
            {selectedFlip.volatility.toFixed(4)}
          </p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground mb-1">{t("flipperCluster")}</p>
          <Badge
            variant="outline"
            className={`text-xs px-2 py-0.5 font-semibold ${clusterBadgeClass(selectedFlip.cluster)}`}
          >
            {clusterLabel(selectedFlip.cluster, t)}
          </Badge>
        </div>
      </div>

      {/* Prices: Bid / Ask / Mid */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">{t("flipsBid")}</p>
          <p className="text-lg font-bold font-mono">{fmt(selectedFlip.bid)}</p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">{t("flipsAsk")}</p>
          <p className="text-lg font-bold font-mono">{fmt(selectedFlip.ask)}</p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">{t("flipsMid")}</p>
          <p className="text-lg font-bold font-mono">{fmt(selectedFlip.mid_price)}</p>
        </div>
      </div>

      {/* Volume */}
      <div className="rounded-lg border p-3">
        <p className="text-xs text-muted-foreground">{t("flipperVolume")} (24h)</p>
        <p className="text-lg font-bold font-mono">{selectedFlip.volume_24h.toLocaleString()}</p>
      </div>

      {/* P1-1: Quantized Analysis Panel */}
      {selectedFlip.quantized_analysis && (
        <div className="rounded-lg border p-3 space-y-3">
          <h4 className="text-xs font-semibold flex items-center gap-1.5">
            <Boxes className="h-3.5 w-3.5" aria-hidden="true" />
            {t("quantizedAnalysisTitle")}
          </h4>
          
          {/* Key quantized metrics */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <p className="text-[10px] text-muted-foreground">{t("qSpreadDetail")}</p>
              <p className={`text-sm font-mono font-medium ${selectedFlip.quantized_analysis.optimalLotProfitPct > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>
                {selectedFlip.quantized_analysis.optimalLotProfitPct.toFixed(2)}%
              </p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground">{t("minLotDetail")}</p>
              <p className="text-sm font-mono font-medium">
                {selectedFlip.quantized_analysis.minProfitableLot > 0
                  ? `×${selectedFlip.quantized_analysis.minProfitableLot}`
                  : t("quantizedNoProfit")}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <Shield
                className={`h-4 w-4 ${
                  selectedFlip.quantized_analysis.brickResistance >= 0.5
                    ? "text-emerald-500"
                    : selectedFlip.quantized_analysis.brickResistance >= 0.2
                    ? "text-amber-500"
                    : "text-red-500"
                }`}
                aria-hidden="true"
              />
              <div>
                <p className="text-[10px] text-muted-foreground">{t("brickRiskDetail")}</p>
                <p className="text-sm font-mono font-medium">{(selectedFlip.quantized_analysis.brickResistance * 100).toFixed(0)}/100</p>
              </div>
            </div>
          </div>

          {/* Recommended ratio */}
          <div className="text-xs text-muted-foreground">
            {t("recommendedRatio")}: <span className="font-mono font-medium">{selectedFlip.quantized_analysis.recommendedRatio[0]}:{selectedFlip.quantized_analysis.recommendedRatio[1]}</span>
          </div>

          {/* Q-Spreads table by lot size */}
          <div className="text-[10px]">
            <p className="text-muted-foreground mb-1 font-medium">{t("qSpreadByLotSize")}</p>
            <div className="grid grid-cols-[50px_60px_60px_60px] gap-1">
              <span className="text-muted-foreground">{t("lotSizeCol")}</span>
              <span className="text-muted-foreground">{t("costCol")}</span>
              <span className="text-muted-foreground">{t("revenueCol")}</span>
              <span className="text-muted-foreground">{t("profitCol")}</span>
              {Object.entries(selectedFlip.quantized_analysis.qSpreads)
                .sort(([a], [b]) => Number(a) - Number(b))
                .map(([lotSize, qs]) => (
                  <React.Fragment key={lotSize}>
                    <span className="font-mono">×{lotSize}</span>
                    <span className="font-mono">{qs.actualCost}</span>
                    <span className="font-mono">{qs.actualRevenue}</span>
                    <span className={`font-mono ${qs.netProfit > 0 ? "text-emerald-600 dark:text-emerald-400" : qs.netProfit < 0 ? "text-red-500" : ""}`}>
                      {qs.netProfit > 0 ? "+" : ""}{qs.netProfit} ({qs.grossProfitPct.toFixed(1)}%)
                    </span>
                  </React.Fragment>
                ))}
            </div>
          </div>

          {/* Theoretical vs Quantized comparison */}
          <div className="text-xs text-muted-foreground border-t pt-2">
            {t("theoreticalSpread")}: <span className="font-mono">{(selectedFlip.quantized_analysis.theoreticalSpread * 100).toFixed(2)}%</span>
            {selectedFlip.quantized_analysis.theoreticalSpread > 0 && selectedFlip.quantized_analysis.optimalLotProfitPct <= 0 && (
              <span className="ml-2 text-amber-600 dark:text-amber-400">{t("quantizedLossWarning")}</span>
            )}
          </div>
        </div>
      )}

      {/* P1-3: Tier Distance indicator */}
      {selectedFlip.tier_distance != null && selectedFlip.tier_distance > 0 && (
        <div className="rounded-lg border p-3">
          <div className="flex items-center gap-2">
            <Shield className={`h-4 w-4 ${
              selectedFlip.tier_distance >= 3
                ? "text-red-500"
                : selectedFlip.tier_distance >= 2
                ? "text-amber-500"
                : "text-muted-foreground"
            }`} aria-hidden="true" />
            <span className="text-xs font-medium">{t("tierDistanceDetail", { "0": selectedFlip.tier_distance })}</span>
          </div>
          {selectedFlip.tier_distance >= 3 && (
            <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1">
              {t("tierDistanceWarning")}
            </p>
          )}
        </div>
      )}

      {/* Storage Value Decision */}
      {storageData && (
        <div className="rounded-lg border p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">
              {t("forecastStorageValue", { "0": selectedFlip.currency.split("/")[0] })}
            </p>
            {storageData.quantity > 1 && (
              <span className="text-xs text-muted-foreground">
                {t("storageValueQuantity", { "0": storageData.quantity })}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium">{t("forecastDecision")}:</span>
            <Badge
              variant="outline"
              className={`text-sm px-3 py-1 font-semibold ${decisionBadgeClass(storageData.decision)}`}
            >
              {storageData.decision === "BUY" || storageData.decision === "HOLD" ? (
                <TrendingUp className="h-4 w-4 mr-1 inline" aria-hidden="true" />
              ) : storageData.decision === "SELL" || storageData.decision === "CONVERT" ? (
                <TrendingDown className="h-4 w-4 mr-1 inline" aria-hidden="true" />
              ) : null}
              {storageData.decision}
            </Badge>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <span className="text-muted-foreground">
              {t("forecastRatio")}: <span className="font-mono font-medium">{formatPrice(storageData.ratio, uiState.baseCurrencyText, uiState.baseCurrencyApiId, { digits: 4 })}</span>
            </span>
            <span className="text-muted-foreground">
              {t("forecastNetAfterFees")}: <span className="font-mono font-medium">{formatPrice(storageData.net_value_after_fees, uiState.baseCurrencyText, uiState.baseCurrencyApiId, { digits: 4 })}</span>
            </span>
          </div>
          {/* Total values for entire holdings (when quantity > 1) */}
          {storageData.quantity > 1 && storageData.total_current_value > 0 && (
            <div className="grid grid-cols-3 gap-2 text-xs border-t pt-2 mt-1">
              <span className="text-muted-foreground">
                {t("storageValueTotalCurrent")}: <span className="font-mono font-medium">{fmt(storageData.total_current_value)}</span>
              </span>
              <span className="text-muted-foreground">
                {t("storageValueTotalProjected")}: <span className="font-mono font-medium">{fmt(storageData.total_projected_value)}</span>
              </span>
              <span className="text-muted-foreground">
                {t("storageValueTotalNet")}: <span className="font-mono font-medium">{fmt(storageData.total_net_value_after_fees)}</span>
              </span>
            </div>
          )}
          {!storageData.data_available && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
              {t("storageValueDataUnavailable")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
