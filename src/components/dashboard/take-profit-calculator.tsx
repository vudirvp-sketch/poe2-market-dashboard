// ============================================================================
// Take-Profit Calculator — P2-3: Forecast CI & Take-Profit
//
// Given a forecast response (with CI bounds), compute:
//   - Take-profit levels based on confidence intervals
//   - Stop-loss levels based on CI lower bounds
//   - Risk/reward ratio
// ============================================================================
"use client";

import { useMemo, memo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  Target,
  ShieldAlert,
  Scale,
  TrendingUp,
  TrendingDown,
  Percent,
  Coins,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { formatPrice } from "@/lib/utils";
import { useDashboardStore } from "@/lib/store";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ForecastModel {
  currency: string;
  modelName: string;
  pointForecast: number[];
  ciLower: number[];
  ciUpper: number[];
  timestamps: string[];
  lowConfidence: boolean;
  disagreement: boolean;
  mape: number | null;
}

interface TakeProfitCalculatorProps {
  /** The forecast response models */
  models: Record<string, ForecastModel>;
  /** Current price of the selected currency */
  currentPrice: number;
  /** Currency API ID for display */
  currencyId: string;
  /** Base currency text for formatting */
  baseCurrencyText?: string | null;
  /** Base currency API ID for formatting */
  baseCurrencyApiId?: string | null;
}

// ---------------------------------------------------------------------------
// Computation helpers
// ---------------------------------------------------------------------------

interface TakeProfitLevel {
  label: string;
  price: number;
  changePct: number;
  confidence: string; // "High" | "Medium" | "Low"
  type: "tp" | "sl";
}

function computeLevels(
  currentPrice: number,
  models: Record<string, ForecastModel>,
  positionSize: number,
): { takeProfitLevels: TakeProfitLevel[]; stopLossLevels: TakeProfitLevel[]; riskRewardRatio: number | null } {
  // Use the primary model (first one) for level computation
  const modelNames = Object.keys(models);
  if (modelNames.length === 0 || currentPrice <= 0) {
    return { takeProfitLevels: [], stopLossLevels: [], riskRewardRatio: null };
  }

  const primary = models[modelNames[0]];
  const lastIdx = primary.pointForecast.length - 1;
  if (lastIdx < 0) {
    return { takeProfitLevels: [], stopLossLevels: [], riskRewardRatio: null };
  }

  // Extract final forecast values
  const finalPointForecast = primary.pointForecast[lastIdx];
  const finalCiUpper = primary.ciUpper[lastIdx];
  const finalCiLower = primary.ciLower[lastIdx];

  // If multiple models, also compute ensemble bounds
  let ensembleUpper = finalCiUpper;
  let ensembleLower = finalCiLower;
  let ensemblePoint = finalPointForecast;

  if (modelNames.length > 1) {
    const allUppers = modelNames.map((n) => models[n].ciUpper[lastIdx] ?? 0).filter((v) => v > 0);
    const allLowers = modelNames.map((n) => models[n].ciLower[lastIdx] ?? 0).filter((v) => v > 0);
    const allPoints = modelNames.map((n) => models[n].pointForecast[lastIdx] ?? 0).filter((v) => v > 0);

    if (allUppers.length > 0) ensembleUpper = Math.max(...allUppers);
    if (allLowers.length > 0) ensembleLower = Math.min(...allLowers);
    if (allPoints.length > 0) ensemblePoint = allPoints.reduce((a, b) => a + b, 0) / allPoints.length;
  }

  // Take-profit levels
  const takeProfitLevels: TakeProfitLevel[] = [
    {
      label: "TP1 (Conservative)",
      price: finalPointForecast,
      changePct: ((finalPointForecast - currentPrice) / currentPrice) * 100,
      confidence: "Medium",
      type: "tp",
    },
    {
      label: "TP2 (Optimistic)",
      price: ensembleUpper,
      changePct: ((ensembleUpper - currentPrice) / currentPrice) * 100,
      confidence: modelNames.length > 1 ? "Low" : "Medium",
      type: "tp",
    },
    {
      label: "TP3 (Aggressive)",
      price: ensembleUpper * 1.05, // 5% above CI upper
      changePct: ((ensembleUpper * 1.05 - currentPrice) / currentPrice) * 100,
      confidence: "Low",
      type: "tp",
    },
  ];

  // Stop-loss levels
  const stopLossLevels: TakeProfitLevel[] = [
    {
      label: "SL1 (Conservative)",
      price: finalCiLower,
      changePct: ((finalCiLower - currentPrice) / currentPrice) * 100,
      confidence: "Medium",
      type: "sl",
    },
    {
      label: "SL2 (Pessimistic)",
      price: ensembleLower,
      changePct: ((ensembleLower - currentPrice) / currentPrice) * 100,
      confidence: modelNames.length > 1 ? "Low" : "Medium",
      type: "sl",
    },
    {
      label: "SL3 (Aggressive)",
      price: ensembleLower * 0.95, // 5% below CI lower
      changePct: ((ensembleLower * 0.95 - currentPrice) / currentPrice) * 100,
      confidence: "Low",
      type: "sl",
    },
  ];

  // Risk/Reward ratio using TP1 and SL1
  const reward = Math.abs(takeProfitLevels[0].price - currentPrice);
  const risk = Math.abs(currentPrice - stopLossLevels[0].price);
  const riskRewardRatio = risk > 0 ? reward / risk : null;

  return { takeProfitLevels, stopLossLevels, riskRewardRatio };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const TakeProfitCalculator = memo(function TakeProfitCalculator({
  models,
  currentPrice,
  currencyId,
  baseCurrencyText,
  baseCurrencyApiId,
}: TakeProfitCalculatorProps) {
  const { t } = useI18n();
  const { uiState } = useDashboardStore();

  const [positionSize, setPositionSize] = useState(100);
  const [positionDirection, setPositionDirection] = useState<"long" | "short">("long");

  const { takeProfitLevels, stopLossLevels, riskRewardRatio } = useMemo(
    () => computeLevels(currentPrice, models, positionSize),
    [currentPrice, models, positionSize],
  );

  // Compute P&L for each level based on position size and direction
  const computePnl = (price: number) => {
    if (currentPrice <= 0) return 0;
    const priceChange = positionDirection === "long"
      ? price - currentPrice
      : currentPrice - price;
    return priceChange * positionSize;
  };

  return (
    <Card>
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
          <Target className="h-4 w-4" aria-hidden="true" />
          Take-Profit & Stop-Loss Calculator
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Based on forecast confidence intervals for {currencyId}
        </p>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0 space-y-4">
        {/* Position inputs */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="tp-position-size">
              Position Size
            </label>
            <Input
              id="tp-position-size"
              type="number"
              min={1}
              max={1_000_000}
              step={1}
              value={positionSize}
              onChange={(e) => setPositionSize(Number(e.target.value) || 1)}
              className="w-24 h-8 text-xs"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="tp-direction">
              {t("takeProfitDirection")}
            </label>
            <Select
              value={positionDirection}
              onValueChange={(v) => setPositionDirection(v as "long" | "short")}
            >
              <SelectTrigger id="tp-direction" className="w-[100px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="long">{t("takeProfitLong")}</SelectItem>
                <SelectItem value="short">{t("takeProfitShort")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Risk/Reward summary */}
        {riskRewardRatio !== null && (
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Scale className="h-3 w-3" aria-hidden="true" />
                Risk/Reward
              </p>
              <p className={`text-lg font-bold font-mono ${
                riskRewardRatio >= 2
                  ? "text-emerald-600 dark:text-emerald-400"
                  : riskRewardRatio >= 1
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-red-600 dark:text-red-400"
              }`}>
                1:{riskRewardRatio.toFixed(2)}
              </p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Coins className="h-3 w-3" aria-hidden="true" />
                Entry Price
              </p>
              <p className="text-lg font-bold font-mono">
                {formatPrice(currentPrice, baseCurrencyText, baseCurrencyApiId, { digits: 4 })}
              </p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Percent className="h-3 w-3" aria-hidden="true" />
                Position Value
              </p>
              <p className="text-lg font-bold font-mono">
                {formatPrice(currentPrice * positionSize, baseCurrencyText, baseCurrencyApiId, { digits: 2 })}
              </p>
            </div>
          </div>
        )}

        {/* Take-profit levels */}
        <div>
          <h4 className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
            <TrendingUp className="h-3 w-3 text-emerald-500" aria-hidden="true" />
            Take-Profit Levels
          </h4>
          <div className="space-y-1">
            {takeProfitLevels.map((level) => {
              const pnl = computePnl(level.price);
              return (
                <div
                  key={level.label}
                  className="flex items-center justify-between py-1.5 px-3 rounded border border-emerald-500/20 bg-emerald-500/5"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium">{level.label}</span>
                    <Badge
                      variant="outline"
                      className={`text-[9px] px-1 py-0 ${
                        level.confidence === "High"
                          ? "border-emerald-500/50 text-emerald-600 dark:text-emerald-400"
                          : level.confidence === "Medium"
                          ? "border-amber-500/50 text-amber-600 dark:text-amber-400"
                          : "border-red-500/50 text-red-600 dark:text-red-400"
                      }`}
                    >
                      {level.confidence}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono font-medium">
                      {formatPrice(level.price, baseCurrencyText, baseCurrencyApiId, { digits: 4 })}
                    </span>
                    <span className="text-xs font-mono text-emerald-600 dark:text-emerald-400">
                      {level.changePct >= 0 ? "+" : ""}{level.changePct.toFixed(1)}%
                    </span>
                    <span className={`text-xs font-mono font-bold ${pnl >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                      {pnl >= 0 ? "+" : ""}{formatPrice(pnl, baseCurrencyText, baseCurrencyApiId, { digits: 2 })}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Stop-loss levels */}
        <div>
          <h4 className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
            <ShieldAlert className="h-3 w-3 text-red-500" aria-hidden="true" />
            Stop-Loss Levels
          </h4>
          <div className="space-y-1">
            {stopLossLevels.map((level) => {
              const pnl = computePnl(level.price);
              return (
                <div
                  key={level.label}
                  className="flex items-center justify-between py-1.5 px-3 rounded border border-red-500/20 bg-red-500/5"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium">{level.label}</span>
                    <Badge
                      variant="outline"
                      className={`text-[9px] px-1 py-0 ${
                        level.confidence === "High"
                          ? "border-emerald-500/50 text-emerald-600 dark:text-emerald-400"
                          : level.confidence === "Medium"
                          ? "border-amber-500/50 text-amber-600 dark:text-amber-400"
                          : "border-red-500/50 text-red-600 dark:text-red-400"
                      }`}
                    >
                      {level.confidence}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono font-medium">
                      {formatPrice(level.price, baseCurrencyText, baseCurrencyApiId, { digits: 4 })}
                    </span>
                    <span className="text-xs font-mono text-red-600 dark:text-red-400">
                      {level.changePct >= 0 ? "+" : ""}{level.changePct.toFixed(1)}%
                    </span>
                    <span className={`text-xs font-mono font-bold ${pnl >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                      {pnl >= 0 ? "+" : ""}{formatPrice(pnl, baseCurrencyText, baseCurrencyApiId, { digits: 2 })}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
});
