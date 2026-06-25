// ============================================================================
// Storage Value Tab — Hold/Sell decision per currency (F2, iter 74).
//
// Wraps the existing FastAPI endpoint GET /api/v1/storage-value/{currency}
// (proxied at /api/flipper/storage-value/[currency]) and renders a compact
// decision card plus the projection breakdown from the canonical §6 formulas:
//
//   projected = current_price * min(exp(momentum * h), 1 + 0.10*sqrt(h))
//   risk_discount = exp(-volatility * z * sqrt(h))
//   adjusted = projected * risk_discount * (0.9 + liq_factor * 0.1)
//   net_value = adjusted  (gold/commission fees EXCLUDED — simplified mode)
//   ratio = net_value / current_price
//   decision: BUY_HOLD  if ratio > 1.03
//             SELL_CONVERT if ratio < 0.97
//             NEUTRAL otherwise
//
// UI:
//   ┌────────────────────────────────────────────────────────────────────┐
//   │  [Currency select]  [Horizon h]  [Quantity]  [Compute] [Refresh]   │
//   ├──────────────────────┬─────────────────────────────────────────────┤
//   │  Decision card       │  Projection breakdown                       │
//   │  (BUY/HOLD | NEUTRAL │  (current, projected, risk discount,        │
//   │   | SELL/CONVERT)    │   adjusted, net, ratio)                     │
//   │  + hint              │                                             │
//   ├──────────────────────┴─────────────────────────────────────────────┤
//   │  Holdings totals (current / projected / net * quantity)             │
//   ├────────────────────────────────────────────────────────────────────┤
//   │  Inputs (momentum, volatility, acceleration, liquidity, α)         │
//   └────────────────────────────────────────────────────────────────────┘
//
// Graceful degradation:
//   - backendOffline → offline card with start-backend hint
//   - data_available=false → "no price history yet" notice
//   - other fetch errors → error card
// ============================================================================

"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  RefreshCw,
  Gem,
  TrendingUp,
  TrendingDown,
  Minus,
  Calculator,
  Info,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import {
  fetchApi,
  fmt,
  getFlipperErrorType,
  type StorageValueResponse,
} from "@/lib/types";
import { FlipperBackendStatusCard } from "./flipper-backend-status-card";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface StorageValueTabProps {
  /** Whether the FastAPI analytics backend is reachable (dashboard-level check). */
  backendOnline: boolean;
  /** Optional: list of currency api_ids to populate the picker. If absent, a small
   *  hardcoded fallback list is used (the user can still type any api_id in the
   *  Input field — the picker is a convenience, not a constraint). */
  currencies?: string[];
}

// ---------------------------------------------------------------------------
// Default currency list — covers the canonical value-storage currencies the
// PRODUCT_VISION calls out (Mirror, Hinekora, Divine, Exalted, Chaos) plus a
// few common mid-tier ones. The dashboard parent can override via `currencies`
// prop once a real currencies list is loaded.
// ---------------------------------------------------------------------------

const DEFAULT_CURRENCIES = [
  "divine",
  "exalted",
  "chaos",
  "mirror",
  "hinekoras-lock",
  "vaal",
  "alch",
  "chance",
  "regal",
  "annul",
  "gcp",
  "chance-shard",
  "exalted-shard",
  "divine-shard",
];

// ---------------------------------------------------------------------------
// Decision → color/label/icon mapping
// ---------------------------------------------------------------------------

type Decision = "BUY_HOLD" | "SELL_CONVERT" | "NEUTRAL";

function normalizeDecision(raw: string | undefined): Decision {
  // Backend returns enum string values like "BUY_HOLD" / "SELL_CONVERT" / "NEUTRAL".
  // The offline fallback in the proxy route returns "HOLD" — treat it as NEUTRAL.
  if (raw === "BUY_HOLD") return "BUY_HOLD";
  if (raw === "SELL_CONVERT") return "SELL_CONVERT";
  return "NEUTRAL";
}

function decisionBadgeClass(d: Decision): string {
  switch (d) {
    case "BUY_HOLD":
      return "border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10";
    case "SELL_CONVERT":
      return "border-red-500/50 text-red-600 dark:text-red-400 bg-red-500/10";
    default:
      return "border-amber-500/50 text-amber-600 dark:text-amber-400 bg-amber-500/10";
  }
}

function decisionIcon(d: Decision) {
  switch (d) {
    case "BUY_HOLD":
      return <TrendingUp className="h-5 w-5 text-emerald-500" aria-hidden="true" />;
    case "SELL_CONVERT":
      return <TrendingDown className="h-5 w-5 text-red-500" aria-hidden="true" />;
    default:
      return <Minus className="h-5 w-5 text-amber-500" aria-hidden="true" />;
  }
}

// ---------------------------------------------------------------------------
// Horizon presets — kept short so the picker is keyboard-friendly.
// 1h, 6h, 24h (default), 48h, 168h (1 week).
// ---------------------------------------------------------------------------

const HORIZON_PRESETS = [1, 6, 24, 48, 168];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StorageValueTab({ backendOnline, currencies }: StorageValueTabProps) {
  const { t } = useI18n();

  // ---- Local input state ----
  const [currencyInput, setCurrencyInput] = useState<string>("divine");
  const [horizon, setHorizon] = useState<number>(24);
  const [quantity, setQuantity] = useState<number>(1);
  // Trigger key — bump to force refetch on "Compute" click
  const [computeNonce, setComputeNonce] = useState<number>(0);

  const pickerOptions = useMemo(
    () => (currencies && currencies.length > 0 ? currencies : DEFAULT_CURRENCIES),
    [currencies],
  );

  // ---- Query ----
  // The endpoint accepts query params: horizon_hours, quantity.
  // We use computeNonce in the queryKey so the "Compute" button forces a refetch
  // even when the inputs haven't changed (useful for stale data).
  const { data, isLoading, isError, error, refetch } = useQuery<StorageValueResponse>({
    queryKey: ["storageValue", currencyInput, horizon, quantity, computeNonce],
    queryFn: () =>
      fetchApi<StorageValueResponse>(
        `/api/flipper/storage-value/${encodeURIComponent(currencyInput)}`,
        {
          horizon_hours: String(horizon),
          quantity: String(quantity),
        },
      ),
    enabled: backendOnline && currencyInput.length > 0,
    staleTime: 30_000,
    retry: 1,
  });

  const insufficientData =
    isError && getFlipperErrorType(error) === "backend_insufficient_data";

  const decision = normalizeDecision(data?.decision);
  const dataAvailable = data?.dataAvailable ?? false;

  // ---- Helpers ----
  const pct = (n: number) => {
    if (!Number.isFinite(n)) return "—";
    const v = n * 100;
    return `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
  };

  const ratioPct = data ? (data.ratio - 1) * 100 : 0;

  // ---- Render: backend offline ----
  if (!backendOnline) {
    return (
      <div className="space-y-6">
        <FlipperBackendStatusCard
          backendOnline={false}
          onRefresh={() => refetch()}
        />
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Gem className="h-5 w-5" aria-hidden="true" />
              {t("storageValueOfflineTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {t("storageValueOfflineDesc")}
          </CardContent>
        </Card>
      </div>
    );
  }

  // ---- Main render ----
  return (
    <div className="space-y-6">
      {/* Backend status card (online / degraded / insufficient) */}
      <FlipperBackendStatusCard
        backendOnline={backendOnline}
        insufficientData={insufficientData}
        fetchedAt={null}
        dataAvailable={dataAvailable}
        onRefresh={() => refetch()}
      />

      {/* ================================================================ */}
      {/* Input controls                                                   */}
      {/* ================================================================ */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Calculator className="h-5 w-5" aria-hidden="true" />
            {t("storageValueTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            {/* Currency picker + free-text input */}
            <div className="flex flex-col gap-1.5 min-w-[180px]">
              <label htmlFor="sv-currency" className="text-xs text-muted-foreground">
                {t("storageValueCurrencyLabel")}
              </label>
              <div className="flex gap-2">
                <Select
                  value={pickerOptions.includes(currencyInput) ? currencyInput : "__custom"}
                  onValueChange={(v) => {
                    if (v !== "__custom") setCurrencyInput(v);
                  }}
                >
                  <SelectTrigger id="sv-currency" className="w-[160px]">
                    <SelectValue placeholder={t("storageValueCurrencyLabel")} />
                  </SelectTrigger>
                  <SelectContent>
                    {pickerOptions.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                    {!pickerOptions.includes(currencyInput) && (
                      <SelectItem value="__custom">{currencyInput}</SelectItem>
                    )}
                  </SelectContent>
                </Select>
                <Input
                  type="text"
                  value={currencyInput}
                  onChange={(e) => setCurrencyInput(e.target.value)}
                  className="w-[140px]"
                  aria-label={t("storageValueCurrencyLabel")}
                  placeholder="api_id"
                />
              </div>
            </div>

            {/* Horizon picker */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="sv-horizon" className="text-xs text-muted-foreground">
                {t("storageValueHorizonLabel")}
              </label>
              <Select
                value={String(horizon)}
                onValueChange={(v) => setHorizon(Number(v))}
              >
                <SelectTrigger id="sv-horizon" className="w-[120px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HORIZON_PRESETS.map((h) => (
                    <SelectItem key={h} value={String(h)}>
                      {h}h
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Quantity */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="sv-quantity" className="text-xs text-muted-foreground">
                {t("storageValueQuantityLabel")}
              </label>
              <Input
                id="sv-quantity"
                type="number"
                min={0.001}
                step={1}
                value={quantity}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v) && v > 0) setQuantity(v);
                }}
                className="w-[120px]"
              />
            </div>

            <Button
              variant="default"
              size="sm"
              className="h-9 gap-1.5"
              onClick={() => {
                setComputeNonce((n) => n + 1);
                refetch();
              }}
              disabled={isLoading || !currencyInput}
            >
              <Calculator className="h-3.5 w-3.5" aria-hidden="true" />
              {t("storageValueCompute")}
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5"
              onClick={() => refetch()}
              disabled={isLoading}
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              {t("storageValueRefresh")}
            </Button>
          </div>

          {/* Subtitle / explanation */}
          <p className="mt-4 text-xs text-muted-foreground leading-relaxed">
            {t("storageValueSubtitle", { 0: currencyInput, 1: horizon })}
          </p>
        </CardContent>
      </Card>

      {/* ================================================================ */}
      {/* Loading state                                                    */}
      {/* ================================================================ */}
      {isLoading && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground flex items-center gap-2">
            <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
            {t("storageValueLoading")}
          </CardContent>
        </Card>
      )}

      {/* ================================================================ */}
      {/* Error state (not insufficient-data, not offline)                 */}
      {/* ================================================================ */}
      {isError && !insufficientData && !isLoading && (
        <Card className="border-red-500/30 bg-red-500/5" role="alert">
          <CardContent className="p-4 text-sm text-red-600 dark:text-red-400 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
            <span>{t("storageValueError")}</span>
          </CardContent>
        </Card>
      )}

      {/* ================================================================ */}
      {/* No data state — backend reachable but no price history           */}
      {/* ================================================================ */}
      {data && !dataAvailable && !isLoading && (
        <Card className="border-sky-500/30 bg-sky-500/5">
          <CardContent className="p-4 text-sm text-muted-foreground flex items-start gap-2">
            <Info className="h-4 w-4 mt-0.5 shrink-0 text-sky-500" aria-hidden="true" />
            <span>{t("storageValueNoData", { 0: currencyInput })}</span>
          </CardContent>
        </Card>
      )}

      {/* ================================================================ */}
      {/* Result — Decision + Projection breakdown                         */}
      {/* ================================================================ */}
      {data && dataAvailable && !isLoading && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* ---- Decision card ---- */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Gem className="h-5 w-5" aria-hidden="true" />
                  {t("storageValueDecisionTitle")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-3 mb-3">
                  {decisionIcon(decision)}
                  <Badge
                    variant="outline"
                    className={`text-sm font-semibold px-3 py-1 ${decisionBadgeClass(decision)}`}
                  >
                    {decision === "BUY_HOLD" && t("storageValueDecisionBuyHold")}
                    {decision === "SELL_CONVERT" && t("storageValueDecisionSellConvert")}
                    {decision === "NEUTRAL" && t("storageValueDecisionNeutral")}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {decision === "BUY_HOLD" && t("storageValueDecisionBuyHoldHint")}
                  {decision === "SELL_CONVERT" && t("storageValueDecisionSellConvertHint")}
                  {decision === "NEUTRAL" && t("storageValueDecisionNeutralHint")}
                </p>
                {/* Ratio vs current price */}
                <div className="mt-4 pt-4 border-t">
                  <div className="flex items-baseline justify-between">
                    <span className="text-xs text-muted-foreground">
                      {t("storageValueRatio")}
                    </span>
                    <span
                      className={`text-lg font-bold font-mono ${
                        ratioPct > 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : ratioPct < 0
                          ? "text-red-600 dark:text-red-400"
                          : "text-muted-foreground"
                      }`}
                    >
                      {pct(ratioPct / 100)}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* ---- Projection breakdown ---- */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <TrendingUp className="h-5 w-5" aria-hidden="true" />
                  {t("storageValueMetricsTitle")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="space-y-2.5">
                  <MetricRow
                    label={t("storageValueCurrentPrice")}
                    value={fmt(data.currentPrice)}
                  />
                  <MetricRow
                    label={t("storageValueProjectedPrice")}
                    value={fmt(data.projectedPrice)}
                    delta={
                      data.currentPrice > 0
                        ? (data.projectedPrice - data.currentPrice) / data.currentPrice
                        : 0
                    }
                  />
                  <MetricRow
                    label={t("storageValueRiskDiscount")}
                    value={data.riskDiscount.toFixed(4)}
                    hint={`× ${data.riskDiscount.toFixed(4)}`}
                  />
                  <MetricRow
                    label={t("storageValueAdjustedPrice")}
                    value={fmt(data.adjustedPrice)}
                  />
                  <MetricRow
                    label={t("storageValueNetValue")}
                    value={fmt(data.netValue)}
                    emphasize
                  />
                </dl>
              </CardContent>
            </Card>
          </div>

          {/* ========================================================== */}
          {/* Holdings totals (per-unit values × quantity)              */}
          {/* ========================================================== */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Calculator className="h-5 w-5" aria-hidden="true" />
                {t("storageValueTotalsTitle")} ({currencyInput} × {quantity})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <TotalCell
                  label={t("storageValueTotalCurrent")}
                  value={fmt((data.totalCurrentValue ?? data.currentPrice * quantity))}
                />
                <TotalCell
                  label={t("storageValueTotalProjected")}
                  value={fmt(
                    data.totalProjectedValue ?? data.projectedPrice * quantity,
                  )}
                />
                <TotalCell
                  label={t("storageValueTotalNet")}
                  value={fmt(data.totalNetValue ?? data.netValue * quantity)}
                  emphasize
                />
              </dl>
            </CardContent>
          </Card>

          {/* ========================================================== */}
          {/* Inputs panel                                               */}
          {/* ========================================================== */}
          {data.inputs && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Info className="h-5 w-5" aria-hidden="true" />
                  {t("storageValueInputsTitle")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
                  <InputCell
                    label={t("storageValueMomentum")}
                    value={data.inputs.momentum.toFixed(6)}
                  />
                  <InputCell
                    label={t("storageValueVolatility")}
                    value={data.inputs.volatility.toFixed(6)}
                  />
                  <InputCell
                    label={t("storageValueAcceleration")}
                    value={data.inputs.acceleration.toFixed(6)}
                  />
                  <InputCell
                    label={t("storageValueLiquidity")}
                    value={data.inputs.liquidityScore.toFixed(4)}
                  />
                  <InputCell
                    label={t("storageValueHorizonLabel")}
                    value={`${data.inputs.horizonHours}h`}
                  />
                  <InputCell
                    label={t("storageValueSignificance")}
                    value={data.inputs.significanceLevel.toFixed(2)}
                  />
                </dl>
              </CardContent>
            </Card>
          )}

          {/* ========================================================== */}
          {/* Storage-value reference reminder                          */}
          {/* ========================================================== */}
          <Card className="border-muted">
            <CardContent className="p-3 text-xs text-muted-foreground">
              <span className="font-medium">{t("storageValueMirrorCompare")}</span>
              {" · "}
              <span className="font-medium">{t("storageValueHinekoraCompare")}</span>
              {" — "}
              {t("storageValueSubtitle", { 0: currencyInput, 1: horizon })}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small subcomponents
// ---------------------------------------------------------------------------

function MetricRow({
  label,
  value,
  delta,
  hint,
  emphasize,
}: {
  label: string;
  value: string;
  delta?: number;
  hint?: string;
  emphasize?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="flex items-baseline gap-2">
        {delta !== undefined && Number.isFinite(delta) && (
          <span
            className={`text-xs font-mono ${
              delta > 0
                ? "text-emerald-600 dark:text-emerald-400"
                : delta < 0
                ? "text-red-600 dark:text-red-400"
                : "text-muted-foreground"
            }`}
          >
            {delta > 0 ? "+" : ""}
            {(delta * 100).toFixed(2)}%
          </span>
        )}
        <span
          className={`font-mono ${emphasize ? "text-base font-bold" : "text-sm"}`}
        >
          {value}
        </span>
        {hint && (
          <span className="text-[10px] text-muted-foreground font-mono">
            {hint}
          </span>
        )}
      </dd>
    </div>
  );
}

function TotalCell({
  label,
  value,
  emphasize,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <div className="p-3 rounded-lg border bg-muted/20">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div
        className={`font-mono ${emphasize ? "text-lg font-bold text-foreground" : "text-base"}`}
      >
        {value}
      </div>
    </div>
  );
}

function InputCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-2.5 rounded-lg border bg-muted/10">
      <div className="text-[10px] text-muted-foreground mb-0.5 leading-tight">
        {label}
      </div>
      <div className="text-sm font-mono">{value}</div>
    </div>
  );
}
