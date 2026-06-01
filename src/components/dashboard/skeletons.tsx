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
