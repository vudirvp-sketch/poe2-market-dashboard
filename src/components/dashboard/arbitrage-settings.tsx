// ============================================================================
// Arbitrage Settings — Client-side arbitrage settings panel
// Extracted from arbitrage-tab.tsx (ШАГ 3 refactoring)
// ============================================================================
"use client";

import { memo } from "react";
import { Settings, Info } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/lib/i18n";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ArbitrageSettingsProps {
  tradingFeeBps: number;
  setTradingFeeBps: (v: number) => void;
  baseSlippageBps: number;
  setBaseSlippageBps: (v: number) => void;
  tradeSize: number;
  setTradeSize: (v: number) => void;
  minVolume: number;
  setMinVolume: (v: number) => void;
  decayLambda: number;
  setDecayLambda: (v: number) => void;
  showSettings: boolean;
  setShowSettings: (v: boolean | ((prev: boolean) => boolean)) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ArbitrageSettings = memo(function ArbitrageSettings({
  tradingFeeBps,
  setTradingFeeBps,
  baseSlippageBps,
  setBaseSlippageBps,
  tradeSize,
  setTradeSize,
  minVolume,
  setMinVolume,
  decayLambda,
  setDecayLambda,
  showSettings,
  setShowSettings,
}: ArbitrageSettingsProps) {
  const { t } = useI18n();

  return (
    <>
      {/* ---- Settings toggle ---- */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowSettings((v) => !v)}
          aria-expanded={showSettings}
          aria-controls="arbitrage-settings"
        >
          <Settings className="h-4 w-4 mr-1.5" aria-hidden="true" />
          {t("settings")}
        </Button>
        <span className="text-xs text-muted-foreground">
          {t("adjustSettings")}
        </span>
      </div>

      {/* ---- Settings panel ---- */}
      {showSettings && (
        <Card id="arbitrage-settings">
          <CardContent className="p-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Trading Fee */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="arb-fee-bps">
                  {t("tradingFeeBps")}
                </label>
                <p className="text-xs text-muted-foreground">{t("poeNoFees")}</p>
                <Input
                  id="arb-fee-bps"
                  type="number"
                  min={0}
                  max={1000}
                  step={1}
                  value={tradingFeeBps}
                  onChange={(e) => setTradingFeeBps(Number(e.target.value) || 0)}
                />
              </div>

              {/* Base Slippage */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="arb-slip-bps">
                  {t("baseSlippageBps")}
                </label>
                <p className="text-xs text-muted-foreground">{t("baseSlippageDesc")}</p>
                <Input
                  id="arb-slip-bps"
                  type="number"
                  min={0}
                  max={1000}
                  step={1}
                  value={baseSlippageBps}
                  onChange={(e) => setBaseSlippageBps(Number(e.target.value) || 0)}
                />
              </div>

              {/* Trade Size — used as slippage model parameter, not position size */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="arb-trade-size">
                  {t("tradeSizeSlippageModel")}
                </label>
                <p className="text-xs text-muted-foreground">{t("tradeSizeSlippageModelDesc")}</p>
                <Input
                  id="arb-trade-size"
                  type="number"
                  min={1}
                  max={1_000_000}
                  step={1}
                  value={tradeSize}
                  onChange={(e) => setTradeSize(Number(e.target.value) || 1)}
                />
              </div>

              {/* Min Volume */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="arb-min-vol">
                  {t("maxVol")}
                </label>
                <p className="text-xs text-muted-foreground">
                  {t("ofTotal", { "0": "", "1": String(minVolume) })}
                </p>
                <Input
                  id="arb-min-vol"
                  type="number"
                  min={0}
                  max={1_000_000}
                  step={1}
                  value={minVolume}
                  onChange={(e) => setMinVolume(Number(e.target.value) || 0)}
                />
              </div>

              {/* Decay Lambda — Fix 3.1: Marked as non-functional since API
                  doesn't provide per-pair timestamps. The slider has no effect
                  because hoursSinceSnapshot is always 0. */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <label className="text-sm font-medium" htmlFor="arb-decay-lambda">
                    {t("decayLambda")}
                  </label>
                  <span
                    className="relative group"
                    aria-label={t("timeDecayDesc")}
                  >
                    <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" aria-hidden="true" />
                    <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 text-xs bg-popover text-popover-foreground border rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
                      {t("timeDecayDesc")}
                    </span>
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">{t("timeDecayDesc")}</p>
                {/* Fix 3.1: Show that decay is currently inactive */}
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  {t("decayNoEffect")}
                </p>
                <Input
                  id="arb-decay-lambda"
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={decayLambda}
                  onChange={(e) => setDecayLambda(Number(e.target.value) || 0)}
                  disabled
                />
              </div>

              {/* Time Decay Label with tooltip */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <label className="text-sm font-medium">
                    {t("timeDecayLabel")}
                  </label>
                  <span
                    className="relative group"
                    aria-label={t("timeDecayDesc")}
                  >
                    <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" aria-hidden="true" />
                    <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 text-xs bg-popover text-popover-foreground border rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
                      {t("timeDecayDesc")}
                    </span>
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  &lambda; = {decayLambda.toFixed(2)} &mdash; {t("timeDecayDesc")}
                </p>
                <Select
                  value={decayLambda === 0 ? "0" : "custom"}
                  onValueChange={(v) => {
                    if (v === "0") setDecayLambda(0);
                  }}
                  disabled
                >
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">{t("decayOptionNone")}</SelectItem>
                    <SelectItem value="custom">{t("decayOptionCustom")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
});
