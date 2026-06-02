// ============================================================================
// Currency Pair Detail Dialog (Priority 2.2 → §3.4 Enhanced)
// ============================================================================
"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { ArrowLeftRight, Activity, Coins } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { fmt, fmtChange, fetchApi } from "@/lib/types";
import type { ExchangePair, ExchangePairHistoryPoint } from "@/lib/types";
import { formatPrice } from "@/lib/utils";
import { useDashboardStore } from "@/lib/store";
import { useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { ChartSkeleton } from "./skeletons";
import { EmptyState } from "./empty-state";
import { CandlestickChart, type OHLCVData } from "./candlestick-chart";

const TIME_RANGE_LIMITS: Record<"7d" | "30d" | "90d", string> = {
  "7d": "168",
  "30d": "720",
  "90d": "2160",
};

interface PairDetailDialogProps {
  pair: ExchangePair | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  realm: string;
  league: string;
}

export function PairDetailDialog({
  pair,
  open,
  onOpenChange,
  realm,
  league,
}: PairDetailDialogProps) {
  const { t } = useI18n();
  const reducedMotion = useReducedMotion();
  const { uiState } = useDashboardStore();
  const [timeRange, setTimeRange] = useState<"7d" | "30d" | "90d">("7d");

  const { data: pairHistory, isLoading } = useQuery({
    queryKey: [
      "pairHistory",
      realm,
      league,
      pair?.currency1ItemId,
      pair?.currency2ItemId,
      timeRange,
    ],
    queryFn: () =>
      fetchApi<ExchangePairHistoryPoint[]>("/api/poe2/currencies", {
        realm,
        league,
        action: "pairHistory",
        // Use numeric ItemIds — the CurrencyPairHistory API expects integers, not ApiId strings
        id1: String(pair!.currency1ItemId),
        id2: String(pair!.currency2ItemId),
        limit: TIME_RANGE_LIMITS[timeRange],
      }),
    enabled: !!pair && open,
  });

  // P3-8: Fetch daily OHLCV stats for candlestick chart
  const { data: dailyStatsData } = useQuery({
    queryKey: [
      "pairDailyStats",
      realm,
      league,
      pair?.currency1ItemId,
      pair?.currency2ItemId,
    ],
    queryFn: () =>
      fetchApi<Array<{ Date: string; Open: number; High: number; Low: number; Close: number; Volume: number }>>(
        "/api/poe2/currencies",
        {
          realm,
          league,
          action: "dailyStats",
          // Use the first currency's ItemId for daily stats
          itemId: String(pair!.currency1ItemId),
          limit: "60",
        }
      ),
    enabled: !!pair && open,
    staleTime: 120_000,
    retry: 1,
  });

  // Convert daily stats to OHLCV data for the CandlestickChart component
  const ohlcvData = useMemo((): OHLCVData[] => {
    if (!dailyStatsData || !Array.isArray(dailyStatsData)) return [];
    return dailyStatsData
      .filter((d) => d.Close > 0 && Number.isFinite(d.Close))
      .map((d) => ({
        time: d.Date?.slice(0, 10) ?? "",
        open: d.Open ?? d.Close,
        high: d.High ?? d.Close,
        low: d.Low ?? d.Close,
        close: d.Close,
        volume: d.Volume ?? 0,
      }));
  }, [dailyStatsData]);

  // Overall stats (from the loaded history period)
  const stats = useMemo(() => {
    if (!pairHistory || pairHistory.length === 0) return null;
    // Filter out zero prices — the first snapshot hour often has RelativePrice=0
    // (no trades yet in a new league), which would skew min/avg/spread.
    // Also filter out NaN/Infinity values that can appear from malformed API data.
    const prices = pairHistory
      .map((p) => p.relativePrice)
      .filter((p) => p > 0 && Number.isFinite(p));
    if (prices.length === 0) return null;
    const vols = pairHistory.map((p) => p.volume).filter((v) => Number.isFinite(v));
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    const spread = max - min;
    return { min, max, avg, spread, totalVolume: vols.reduce((a, b) => a + b, 0) };
  }, [pairHistory]);

  // 24h stats — last 24 data points (hourly data → 24 points = 24h)
  const stats24h = useMemo(() => {
    if (!pairHistory || pairHistory.length === 0) return null;
    const last24 = pairHistory.slice(-24);
    if (last24.length === 0) return null;
    const prices = last24
      .map((p) => p.relativePrice)
      .filter((p) => p > 0 && Number.isFinite(p));
    if (prices.length === 0) return null;
    return {
      high: Math.max(...prices),
      low: Math.min(...prices),
    };
  }, [pairHistory]);

  // 7d stats — last 168 data points (hourly data → 168 points = 7d)
  const stats7d = useMemo(() => {
    if (!pairHistory || pairHistory.length === 0) return null;
    const last168 = pairHistory.slice(-168);
    if (last168.length === 0) return null;
    const prices = last168
      .map((p) => p.relativePrice)
      .filter((p) => p > 0 && Number.isFinite(p));
    if (prices.length === 0) return null;
    return {
      high: Math.max(...prices),
      low: Math.min(...prices),
    };
  }, [pairHistory]);

  if (!pair) return null;

  const changeIndicator = fmtChange(pair.changePercent);
  const change7dIndicator = fmtChange(pair.sevenDayChangePercent);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowLeftRight className="h-5 w-5 text-primary" />
            {/* Currency pair icons */}
            {pair.currency1IconUrl ? (
              <img
                src={pair.currency1IconUrl}
                alt={pair.currency1Name}
                width={32}
                height={32}
                className="rounded-sm"
              />
            ) : (
              <Coins className="h-8 w-8 text-muted-foreground" />
            )}
            <span className="text-muted-foreground">/</span>
            {pair.currency2IconUrl ? (
              <img
                src={pair.currency2IconUrl}
                alt={pair.currency2Name}
                width={32}
                height={32}
                className="rounded-sm"
              />
            ) : (
              <Coins className="h-8 w-8 text-muted-foreground" />
            )}
            {pair.currency1Name} / {pair.currency2Name}
          </DialogTitle>
        </DialogHeader>

        {/* Stats grid */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 mt-2">
            <div className="rounded-lg bg-muted/50 p-2">
              <p className="text-[10px] text-muted-foreground">{t("current")}</p>
              <p className="text-sm font-bold font-mono">
                {formatPrice(pair.relativePrice, uiState.baseCurrencyText, uiState.baseCurrencyApiId)}{" "}
                <span className={`text-xs font-semibold ${changeIndicator.color}`}>
                  {changeIndicator.text}
                </span>
              </p>
              {pair.sevenDayChangePercent !== null && (
                <p className={`text-[10px] font-semibold ${change7dIndicator.color}`}>
                  7d: {change7dIndicator.text}
                </p>
              )}
            </div>
            <div className="rounded-lg bg-muted/50 p-2">
              <p className="text-[10px] text-muted-foreground">{t("min")}</p>
              <p className="text-sm font-bold font-mono">{formatPrice(stats.min, uiState.baseCurrencyText, uiState.baseCurrencyApiId)}</p>
            </div>
            <div className="rounded-lg bg-muted/50 p-2">
              <p className="text-[10px] text-muted-foreground">{t("max")}</p>
              <p className="text-sm font-bold font-mono">{formatPrice(stats.max, uiState.baseCurrencyText, uiState.baseCurrencyApiId)}</p>
            </div>
            <div className="rounded-lg bg-muted/50 p-2">
              <p className="text-[10px] text-muted-foreground">{t("average")}</p>
              <p className="text-sm font-bold font-mono">{formatPrice(stats.avg, uiState.baseCurrencyText, uiState.baseCurrencyApiId)}</p>
            </div>
            <div className="rounded-lg bg-muted/50 p-2">
              <p className="text-[10px] text-muted-foreground">{t("spread")}</p>
              <p className="text-sm font-bold font-mono">{formatPrice(stats.spread, uiState.baseCurrencyText, uiState.baseCurrencyApiId)}</p>
            </div>
            <div className="rounded-lg bg-muted/50 p-2">
              <p className="text-[10px] text-muted-foreground">{t("avgVolume")}</p>
              <p className="text-sm font-bold font-mono">
                {stats.totalVolume > 0 && pairHistory
                  ? fmt(stats.totalVolume / pairHistory.length)
                  : "\u2014"}
              </p>
            </div>
            {/* 24h High / Low */}
            {stats24h && (
              <>
                <div className="rounded-lg bg-muted/50 p-2">
                  <p className="text-[10px] text-muted-foreground">{t("high24h")}</p>
                  <p className="text-sm font-bold font-mono text-emerald-400">
                    {formatPrice(stats24h.high, uiState.baseCurrencyText, uiState.baseCurrencyApiId)}
                  </p>
                </div>
                <div className="rounded-lg bg-muted/50 p-2">
                  <p className="text-[10px] text-muted-foreground">{t("low24h")}</p>
                  <p className="text-sm font-bold font-mono text-red-400">
                    {formatPrice(stats24h.low, uiState.baseCurrencyText, uiState.baseCurrencyApiId)}
                  </p>
                </div>
              </>
            )}
            {/* 7d High / Low — show for all time ranges when we have enough data */}
            {stats7d && (
              <>
                <div className="rounded-lg bg-muted/50 p-2">
                  <p className="text-[10px] text-muted-foreground">{t("high7d")}</p>
                  <p className="text-sm font-bold font-mono text-emerald-400">
                    {formatPrice(stats7d.high, uiState.baseCurrencyText, uiState.baseCurrencyApiId)}
                  </p>
                </div>
                <div className="rounded-lg bg-muted/50 p-2">
                  <p className="text-[10px] text-muted-foreground">{t("low7d")}</p>
                  <p className="text-sm font-bold font-mono text-red-400">
                    {formatPrice(stats7d.low, uiState.baseCurrencyText, uiState.baseCurrencyApiId)}
                  </p>
                </div>
              </>
            )}
          </div>
        )}

        {/* Time range toggle */}
        <div className="flex items-center gap-1 mt-2">
          {(["7d", "30d", "90d"] as const).map((range) => (
            <Button
              key={range}
              variant={timeRange === range ? "default" : "outline"}
              size="sm"
              onClick={() => setTimeRange(range)}
              className="h-7 px-3 text-xs"
            >
              {t(`timeRange${range}` as "timeRange7d" | "timeRange30d" | "timeRange90d")}
            </Button>
          ))}
        </div>

        {/* Price history chart */}
        {isLoading ? (
          <ChartSkeleton height={250} />
        ) : pairHistory && pairHistory.length > 1 ? (
          <div className="mt-4 space-y-4">
            <div>
              <h4 className="text-sm font-medium mb-2 flex items-center gap-1">
                <ArrowLeftRight className="h-4 w-4" /> {t("relativePriceOverTime")}
              </h4>
              <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={pairHistory}>
                    <defs>
                      <linearGradient id="pairGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="timestamp"
                      tick={{ fontSize: 10 }}
                      tickFormatter={(v: string) =>
                        new Date(v).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })
                      }
                    />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => fmt(v, 2)} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "8px",
                        fontSize: "12px",
                      }}
                      labelFormatter={(v: string) => new Date(v).toLocaleString()}
                      formatter={(value: number) => [fmt(value), t("priceLabel")]}
                    />
                    <Area
                      type="monotone"
                      dataKey="relativePrice"
                      stroke="#f59e0b"
                      fill="url(#pairGrad)"
                      strokeWidth={2}
                      isAnimationActive={!reducedMotion}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div>
              <h4 className="text-sm font-medium mb-2 flex items-center gap-1">
                <Activity className="h-4 w-4" /> {t("volume")}
              </h4>
              <div className="h-[100px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={pairHistory}>
                    <XAxis dataKey="timestamp" tick={false} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "8px",
                        fontSize: "12px",
                      }}
                    />
                    <Bar dataKey="volume" fill="#6366f1" radius={[2, 2, 0, 0]} isAnimationActive={!reducedMotion} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        ) : (
          <EmptyState
            kind="noResults"
            message={t("noPairHistory")}
          />
        )}

        {/* P3-8: Candlestick Chart with SMA/EMA/RSI overlays */}
        {ohlcvData.length > 0 && (
          <div className="mt-4">
            <CandlestickChart
              data={ohlcvData}
              title={`${pair.currency1Name}/${pair.currency2Name} — Daily Candlestick`}
              showVolume={true}
              overlays={["sma20", "ema12", "rsi14"]}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
