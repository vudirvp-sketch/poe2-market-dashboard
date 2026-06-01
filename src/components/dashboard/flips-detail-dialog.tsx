// ============================================================================
// Flips Detail Dialog — Detailed view for a single flip opportunity
// Shows score, spread, fees, momentum, volatility, cluster, prices,
// volume, and storage value decision.
// ============================================================================
"use client";

import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n";
import { fmt } from "@/lib/types";
import { formatPrice } from "@/lib/utils";
import { useDashboardStore } from "@/lib/store";
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

  return (
    <div className="space-y-4">
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
