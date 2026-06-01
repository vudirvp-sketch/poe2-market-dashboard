// ============================================================================
// Currency Pair Detail Dialog (Priority 2.2)
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
import { ArrowLeftRight, Activity } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { fmt, fetchApi } from "@/lib/types";
import type { ExchangePair, ExchangePairHistoryPoint } from "@/lib/types";
import { useMemo } from "react";
import { useI18n } from "@/lib/i18n";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { ChartSkeleton } from "./skeletons";
import { EmptyState } from "./empty-state";

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
  const { data: pairHistory, isLoading } = useQuery({
    queryKey: ["pairHistory", realm, league, pair?.currency1ItemId, pair?.currency2ItemId],
    queryFn: () =>
      fetchApi<ExchangePairHistoryPoint[]>("/api/poe2/currencies", {
        realm,
        league,
        action: "pairHistory",
        // Use numeric ItemIds — the CurrencyPairHistory API expects integers, not ApiId strings
        id1: String(pair!.currency1ItemId),
        id2: String(pair!.currency2ItemId),
        limit: "168",
      }),
    enabled: !!pair && open,
  });

  // Stats
  const stats = useMemo(() => {
    if (!pairHistory || pairHistory.length === 0) return null;
    const prices = pairHistory.map((p) => p.relativePrice);
    const vols = pairHistory.map((p) => p.volume);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    const spread = max - min;
    return { min, max, avg, spread, totalVolume: vols.reduce((a, b) => a + b, 0) };
  }, [pairHistory]);

  if (!pair) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowLeftRight className="h-5 w-5 text-primary" />
            {pair.currency1Name} / {pair.currency2Name}
          </DialogTitle>
        </DialogHeader>

        {/* Stats row */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-2">
            <div className="rounded-lg bg-muted/50 p-2">
              <p className="text-[10px] text-muted-foreground">{t("current")}</p>
              <p className="text-sm font-bold font-mono">{fmt(pair.relativePrice)}</p>
            </div>
            <div className="rounded-lg bg-muted/50 p-2">
              <p className="text-[10px] text-muted-foreground">{t("min")}</p>
              <p className="text-sm font-bold font-mono">{fmt(stats.min)}</p>
            </div>
            <div className="rounded-lg bg-muted/50 p-2">
              <p className="text-[10px] text-muted-foreground">{t("max")}</p>
              <p className="text-sm font-bold font-mono">{fmt(stats.max)}</p>
            </div>
            <div className="rounded-lg bg-muted/50 p-2">
              <p className="text-[10px] text-muted-foreground">{t("average")}</p>
              <p className="text-sm font-bold font-mono">{fmt(stats.avg)}</p>
            </div>
            <div className="rounded-lg bg-muted/50 p-2">
              <p className="text-[10px] text-muted-foreground">{t("spread")}</p>
              <p className="text-sm font-bold font-mono">{fmt(stats.spread)}</p>
            </div>
          </div>
        )}

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
      </DialogContent>
    </Dialog>
  );
}
