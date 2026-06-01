// ============================================================================
// Skeleton Loaders — Shimmer placeholders for professional loading states
// ============================================================================
"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

// ============================================================================
// Currency Card Skeleton
// ============================================================================
export function CurrencyCardSkeleton() {
  return (
    <Card className="relative">
      <CardHeader className="pb-2 pt-3 px-3">
        <div className="flex items-start gap-2">
          <Skeleton className="w-8 h-8 rounded shrink-0" />
          <div className="flex-1 min-w-0">
            <Skeleton className="h-4 w-24 mb-1" />
            <Skeleton className="h-3 w-16" />
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-3 pb-3 pt-0">
        <div className="flex items-end justify-between">
          <div>
            <Skeleton className="h-6 w-16 mb-1" />
            <Skeleton className="h-3 w-12" />
          </div>
          <Skeleton className="h-7 w-20 rounded" />
        </div>
        <Skeleton className="h-3 w-16 mt-2" />
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Currency Grid Skeleton
// ============================================================================
export function CurrencyGridSkeleton({ count = 10 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
      {Array.from({ length: count }).map((_, i) => (
        <CurrencyCardSkeleton key={i} />
      ))}
    </div>
  );
}

// ============================================================================
// Unique Table Row Skeleton
// ============================================================================
export function UniqueTableSkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <div className="rounded-md border border-border overflow-hidden">
      {/* Header */}
      <div className="border-b border-border bg-muted/80">
        <div className="flex items-center py-2 px-3 gap-4">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-16 ml-auto" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-10" />
          <Skeleton className="h-4 w-14" />
          <Skeleton className="h-4 w-20" />
        </div>
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center py-2 px-3 gap-4 border-b border-border/50"
        >
          <Skeleton className="h-4 w-4 rounded-full shrink-0" />
          <Skeleton className="h-6 w-6 rounded shrink-0" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-20 ml-1" />
          <Skeleton className="h-4 w-14 ml-auto" />
          <Skeleton className="h-4 w-14" />
          <Skeleton className="h-4 w-10" />
          <Skeleton className="h-4 w-14" />
          <Skeleton className="h-5 w-20 rounded" />
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// Exchange Pair Card Skeleton
// ============================================================================
export function ExchangePairCardSkeleton() {
  return (
    <Card>
      <CardContent className="py-3 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-5 rounded-full" />
            <Skeleton className="h-4 w-20" />
          </div>
          <Skeleton className="h-4 w-4 rounded" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-5 w-5 rounded-full" />
          </div>
        </div>
        <div className="flex items-center justify-between mt-2">
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-3 w-12" />
          </div>
          <Skeleton className="h-3 w-16" />
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Exchange Grid Skeleton
// ============================================================================
export function ExchangeGridSkeleton({ count = 9 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
      {Array.from({ length: count }).map((_, i) => (
        <ExchangePairCardSkeleton key={i} />
      ))}
    </div>
  );
}

// ============================================================================
// Exchange Table Row Skeleton (§1.1 + §1.5)
// ============================================================================
export function ExchangeTableSkeleton({ rows = 15 }: { rows?: number }) {
  return (
    <div className="rounded-md border border-border overflow-hidden">
      {/* Header */}
      <div className="border-b border-border bg-muted/80">
        <div className="flex items-center py-2 px-3 gap-4">
          <Skeleton className="h-4 w-4 rounded-full shrink-0" />
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-14 ml-auto" />
          <Skeleton className="h-4 w-14" />
          <Skeleton className="h-4 w-14" />
          <Skeleton className="h-4 w-20" />
        </div>
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center py-2 px-3 gap-4 border-b border-border/50"
        >
          <Skeleton className="h-4 w-4 rounded-full shrink-0" />
          <div className="flex items-center gap-1.5">
            <Skeleton className="h-5 w-5 rounded shrink-0" />
            <Skeleton className="h-4 w-20" />
            <span className="text-muted-foreground text-xs">/</span>
            <Skeleton className="h-5 w-5 rounded shrink-0" />
            <Skeleton className="h-4 w-20" />
          </div>
          <Skeleton className="h-5 w-14 ml-auto" />
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-6 w-20 rounded" />
          <Skeleton className="h-4 w-4 rounded shrink-0" />
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// Market Overview Skeleton
// ============================================================================
export function MarketOverviewSkeleton() {
  return (
    <div className="space-y-6">
      {/* §2.1: Stats row — 4 KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="py-4 px-4">
              <div className="flex items-center gap-2">
                <Skeleton className="h-5 w-5 rounded" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="h-8 w-20 mt-1" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Volume chart */}
      <Card>
        <CardHeader className="pb-2">
          <Skeleton className="h-4 w-48" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[250px] w-full rounded-lg" />
        </CardContent>
      </Card>

      {/* Top Movers */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <Skeleton className="h-4 w-28" />
            </CardHeader>
            <CardContent className="space-y-2">
              {Array.from({ length: 5 }).map((_, j) => (
                <div key={j} className="flex items-center justify-between py-1">
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-3 w-4" />
                    <Skeleton className="h-4 w-4 rounded" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                  <Skeleton className="h-3 w-14" />
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Arbitrage Skeleton
// ============================================================================
export function ArbitrageSkeleton() {
  return (
    <div className="space-y-6">
      {/* Stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="py-4 px-4">
              <div className="flex items-center gap-2">
                <Skeleton className="h-5 w-5 rounded" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="h-8 w-16 mt-1" />
            </CardContent>
          </Card>
        ))}
      </div>
      {/* Table skeleton */}
      <Skeleton className="h-[300px] w-full rounded-lg" />
    </div>
  );
}

// ============================================================================
// Watchlist Skeleton
// ============================================================================
export function WatchlistSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
      {Array.from({ length: count }).map((_, i) => (
        <CurrencyCardSkeleton key={i} />
      ))}
    </div>
  );
}

// ============================================================================
// Chart Skeleton — for dialog chart loading states
// ============================================================================
export function ChartSkeleton({ height = 250 }: { height?: number }) {
  return (
    <div className="space-y-3">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="w-full rounded-lg" style={{ height }} />
    </div>
  );
}

// ============================================================================
// Dialog Content Skeleton — for detail/comparison dialog loading
// ============================================================================
export function DialogContentSkeleton() {
  return (
    <div className="space-y-4 py-4">
      <div className="flex items-center gap-2">
        <Skeleton className="h-10 w-10 rounded" />
        <div className="flex-1">
          <Skeleton className="h-5 w-40 mb-1" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Skeleton className="h-16 rounded-lg" />
        <Skeleton className="h-16 rounded-lg" />
        <Skeleton className="h-16 rounded-lg" />
      </div>
      <ChartSkeleton height={250} />
    </div>
  );
}

// ============================================================================
// Flips Tab Skeleton — §1.5: matches the flips tab layout (status card,
// summary stats row, filters row, opportunities table)
// ============================================================================
export function FlipsSkeleton() {
  return (
    <div className="space-y-4">
      {/* Backend status indicator */}
      <div className="flex items-center gap-1.5">
        <Skeleton className="h-2.5 w-2.5 rounded-full" />
        <Skeleton className="h-3 w-24" />
      </div>

      {/* Summary stats row — 4 cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="pb-2 pt-4 px-4">
              <Skeleton className="h-3 w-24" />
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0">
              <Skeleton className="h-8 w-16" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters row */}
      <div className="flex flex-wrap items-center gap-3">
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-8 w-40" />
      </div>

      {/* Opportunities table */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <Skeleton className="h-4 w-40" />
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0">
          {/* Table header */}
          <div className="grid grid-cols-[1.5fr_60px_80px_70px_70px_80px_30px] gap-1.5 py-2 px-2 border-b border-border">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-10 mx-auto" />
            <Skeleton className="h-3 w-12 ml-auto" />
            <Skeleton className="h-3 w-14 ml-auto" />
            <Skeleton className="h-3 w-12 ml-auto" />
            <Skeleton className="h-3 w-10 mx-auto" />
            <Skeleton className="h-3 w-3" />
          </div>
          {/* Table rows */}
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="grid grid-cols-[1.5fr_60px_80px_70px_70px_80px_30px] gap-1.5 py-2 px-2 border-b border-border/50"
            >
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-10 mx-auto" />
              <Skeleton className="h-4 w-12 ml-auto" />
              <Skeleton className="h-4 w-10 ml-auto" />
              <Skeleton className="h-4 w-12 ml-auto" />
              <Skeleton className="h-5 w-14 rounded mx-auto" />
              <Skeleton className="h-3 w-3" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
// Forecast Tab Skeleton — §1.5: matches forecast tab layout (currency
// selector, price chart, storage value, anomaly alerts)
// ============================================================================
export function ForecastSkeleton() {
  return (
    <div className="space-y-6">
      {/* Currency selector + live mode */}
      <div className="flex items-center gap-3">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="py-4 px-4">
              <Skeleton className="h-3 w-20 mb-2" />
              <Skeleton className="h-7 w-24" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Price chart */}
      <Card>
        <CardHeader className="pb-2">
          <Skeleton className="h-4 w-40" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[300px] w-full rounded-lg" />
        </CardContent>
      </Card>

      {/* Storage value + Anomalies */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <Skeleton className="h-4 w-36" />
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-40" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <Skeleton className="h-4 w-32" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-20 w-full" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ============================================================================
// Portfolio Tab Skeleton — §1.5
// ============================================================================
export function PortfolioSkeleton() {
  return (
    <div className="space-y-6">
      {/* Stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="py-4 px-4">
              <Skeleton className="h-3 w-24 mb-2" />
              <Skeleton className="h-7 w-20" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Weights table + Correlation matrix */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <Skeleton className="h-4 w-36" />
          </CardHeader>
          <CardContent>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-border/50">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <Skeleton className="h-4 w-40" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-[200px] w-full rounded" />
          </CardContent>
        </Card>
      </div>

      {/* Efficient frontier chart */}
      <Card>
        <CardHeader className="pb-2">
          <Skeleton className="h-4 w-40" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[250px] w-full rounded-lg" />
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
// Currency Graph Tab Skeleton — §1.5
// ============================================================================
export function CurrencyGraphSkeleton() {
  return (
    <div className="space-y-4">
      {/* Controls row */}
      <div className="flex items-center gap-3">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-9 w-24" />
      </div>

      {/* Graph area */}
      <Card>
        <CardContent className="py-4">
          <Skeleton className="h-[500px] w-full rounded-lg" />
        </CardContent>
      </Card>
    </div>
  );
}
