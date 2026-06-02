// ============================================================================
// Candlestick Chart — P3-8
//
// Custom candlestick chart component since Recharts doesn't support
// candlestick charts natively. Renders OHLCV data with SVG rectangles
// for candle bodies and lines for wicks.
//
// Also supports SMA/EMA/RSI overlays (P3-1).
// ============================================================================
"use client";

import { useMemo, memo, useState } from "react";
import {
  CandlestickChart as CandlestickIcon,
  TrendingUp,
  Activity,
  ChevronDown,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { fmt } from "@/lib/types";
import {
  computeSMA,
  computeEMA,
  computeRSI,
} from "@/lib/technical-indicators";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OHLCVData {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface CandlestickChartProps {
  data: OHLCVData[];
  /** Currency pair name for display */
  title?: string;
  /** Show volume bars below the chart */
  showVolume?: boolean;
  /** Available overlay indicators */
  overlays?: Array<"sma20" | "ema12" | "ema26" | "rsi14">;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface CandleRender {
  x: number;
  bodyY: number;
  bodyHeight: number;
  wickTopY: number;
  wickBottomY: number;
  isGreen: boolean;
  open: number;
  close: number;
  high: number;
  low: number;
  time: string;
  volume: number;
  volumeHeight: number;
}

function computeCandleRenders(
  data: OHLCVData[],
  width: number,
  chartHeight: number,
  volumeHeight: number,
  padding: { top: number; right: number; bottom: number; left: number },
): CandleRender[] {
  if (data.length === 0) return [];

  const allHighs = data.map((d) => d.high);
  const allLows = data.map((d) => d.low);
  const maxPrice = Math.max(...allHighs);
  const minPrice = Math.min(...allLows);
  const priceRange = maxPrice - minPrice || 1;

  const maxVolume = Math.max(...data.map((d) => d.volume)) || 1;

  const drawWidth = width - padding.left - padding.right;
  const drawHeight = chartHeight - padding.top - padding.bottom;
  const candleWidth = Math.max(2, (drawWidth / data.length) * 0.7);
  const gap = drawWidth / data.length;

  return data.map((d, i) => {
    const x = padding.left + i * gap + gap / 2;
    const isGreen = d.close >= d.open;

    const bodyTop = isGreen ? d.close : d.open;
    const bodyBottom = isGreen ? d.open : d.close;

    const priceToY = (price: number) =>
      padding.top + drawHeight * (1 - (price - minPrice) / priceRange);

    return {
      x,
      bodyY: priceToY(bodyTop),
      bodyHeight: Math.max(1, priceToY(bodyBottom) - priceToY(bodyTop)),
      wickTopY: priceToY(d.high),
      wickBottomY: priceToY(d.low),
      isGreen,
      open: d.open,
      close: d.close,
      high: d.high,
      low: d.low,
      time: d.time,
      volume: d.volume,
      volumeHeight: (d.volume / maxVolume) * volumeHeight,
    };
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const CandlestickChart = memo(function CandlestickChart({
  data,
  title = "Candlestick Chart",
  showVolume = true,
  overlays = ["sma20", "ema12"],
}: CandlestickChartProps) {
  const { t } = useI18n();
  const [activeOverlays, setActiveOverlays] = useState<Set<string>>(
    new Set(overlays),
  );
  const [hoveredCandle, setHoveredCandle] = useState<number | null>(null);

  const toggleOverlay = (name: string) => {
    setActiveOverlays((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  // Compute overlay indicators
  const closes = useMemo(() => data.map((d) => d.close), [data]);
  const sma20 = useMemo(() => computeSMA(closes, 20), [closes]);
  const ema12 = useMemo(() => computeEMA(closes, 12), [closes]);
  const ema26 = useMemo(() => computeEMA(closes, 26), [closes]);
  const rsi14 = useMemo(() => computeRSI(closes, 14), [closes]);

  // Chart dimensions
  const width = 800;
  const chartHeight = 300;
  const volumeHeight = 60;
  const padding = { top: 20, right: 60, bottom: 30, left: 10 };

  const candleRenders = useMemo(
    () => computeCandleRenders(data, width, chartHeight, volumeHeight, padding),
    [data, width, chartHeight, volumeHeight],
  );

  // Compute overlay line points
  const overlayLines = useMemo(() => {
    if (candleRenders.length === 0) return {};

    const allHighs = data.map((d) => d.high);
    const allLows = data.map((d) => d.low);
    const maxPrice = Math.max(...allHighs);
    const minPrice = Math.min(...allLows);
    const priceRange = maxPrice - minPrice || 1;
    const drawHeight = chartHeight - padding.top - padding.bottom;
    const drawWidth = width - padding.left - padding.right;
    const gap = drawWidth / data.length;

    const priceToY = (price: number) =>
      padding.top + drawHeight * (1 - (price - minPrice) / priceRange);

    const toPoints = (values: (number | null)[]) =>
      values
        .map((v, i) => {
          if (v === null) return null;
          const x = padding.left + i * gap + gap / 2;
          return `${x},${priceToY(v)}`;
        })
        .filter((v): v is string => v !== null)
        .join(" ");

    return {
      sma20: activeOverlays.has("sma20") ? toPoints(sma20) : null,
      ema12: activeOverlays.has("ema12") ? toPoints(ema12) : null,
      ema26: activeOverlays.has("ema26") ? toPoints(ema26) : null,
    };
  }, [candleRenders, data, sma20, ema12, ema26, activeOverlays, chartHeight, width]);

  // Price axis ticks
  const priceAxisTicks = useMemo(() => {
    if (data.length === 0) return [];
    const allHighs = data.map((d) => d.high);
    const allLows = data.map((d) => d.low);
    const maxPrice = Math.max(...allHighs);
    const minPrice = Math.min(...allLows);
    const priceRange = maxPrice - minPrice || 1;
    const drawHeight = chartHeight - padding.top - padding.bottom;

    const ticks: { y: number; label: string }[] = [];
    const tickCount = 5;
    for (let i = 0; i <= tickCount; i++) {
      const price = minPrice + (priceRange * i) / tickCount;
      const y = padding.top + drawHeight * (1 - i / tickCount);
      ticks.push({ y, label: fmt(price) });
    }
    return ticks;
  }, [data, chartHeight]);

  // RSI chart (separate mini-chart)
  const rsiLinePoints = useMemo(() => {
    if (!activeOverlays.has("rsi14") || rsi14.length === 0) return null;
    const rsiHeight = 80;
    const rsiWidth = width - padding.left - padding.right;
    const gap = rsiWidth / data.length;

    return rsi14
      .map((v, i) => {
        if (v === null) return null;
        const x = padding.left + i * gap + gap / 2;
        const y = rsiHeight * (1 - v / 100);
        return `${x},${y}`;
      })
      .filter((v): v is string => v !== null)
      .join(" ");
  }, [rsi14, data, width, activeOverlays]);

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
            <CandlestickIcon className="h-4 w-4" aria-hidden="true" />
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0">
          <p className="text-sm text-muted-foreground text-center py-6">
            No OHLCV data available for candlestick chart
          </p>
        </CardContent>
      </Card>
    );
  }

  const hoveredData = hoveredCandle !== null ? data[hoveredCandle] : null;

  return (
    <Card>
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
            <CandlestickIcon className="h-4 w-4" aria-hidden="true" />
            {title}
          </CardTitle>
          {/* Overlay toggles */}
          <div className="flex items-center gap-1">
            <Button
              variant={activeOverlays.has("sma20") ? "default" : "outline"}
              size="sm"
              className="h-6 text-[10px] px-2"
              onClick={() => toggleOverlay("sma20")}
            >
              SMA 20
            </Button>
            <Button
              variant={activeOverlays.has("ema12") ? "default" : "outline"}
              size="sm"
              className="h-6 text-[10px] px-2"
              onClick={() => toggleOverlay("ema12")}
            >
              EMA 12
            </Button>
            <Button
              variant={activeOverlays.has("ema26") ? "default" : "outline"}
              size="sm"
              className="h-6 text-[10px] px-2"
              onClick={() => toggleOverlay("ema26")}
            >
              EMA 26
            </Button>
            <Button
              variant={activeOverlays.has("rsi14") ? "default" : "outline"}
              size="sm"
              className="h-6 text-[10px] px-2"
              onClick={() => toggleOverlay("rsi14")}
            >
              RSI 14
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0">
        {/* Hover info */}
        {hoveredData && (
          <div className="flex flex-wrap items-center gap-3 mb-2 text-xs">
            <span className="text-muted-foreground">{hoveredData.time}</span>
            <span>O: <span className="font-mono">{fmt(hoveredData.open)}</span></span>
            <span>H: <span className="font-mono">{fmt(hoveredData.high)}</span></span>
            <span>L: <span className="font-mono">{fmt(hoveredData.low)}</span></span>
            <span>C: <span className="font-mono font-bold">{fmt(hoveredData.close)}</span></span>
            <span>Vol: <span className="font-mono">{hoveredData.volume.toLocaleString()}</span></span>
          </div>
        )}

        {/* Main candlestick SVG */}
        <div className="overflow-x-auto">
          <svg
            width={width}
            height={chartHeight + (showVolume ? volumeHeight : 0)}
            viewBox={`0 0 ${width} ${chartHeight + (showVolume ? volumeHeight : 0)}`}
            className="w-full"
          >
            {/* Price grid lines */}
            {priceAxisTicks.map((tick, i) => (
              <g key={i}>
                <line
                  x1={padding.left}
                  y1={tick.y}
                  x2={width - padding.right}
                  y2={tick.y}
                  stroke="currentColor"
                  strokeOpacity={0.1}
                  strokeDasharray="3,3"
                />
                <text
                  x={width - padding.right + 5}
                  y={tick.y + 4}
                  fill="currentColor"
                  fontSize={10}
                  className="text-muted-foreground"
                >
                  {tick.label}
                </text>
              </g>
            ))}

            {/* Volume bars */}
            {showVolume &&
              candleRenders.map((c, i) => (
                <rect
                  key={`vol-${i}`}
                  x={c.x - 3}
                  y={chartHeight + volumeHeight - c.volumeHeight}
                  width={6}
                  height={c.volumeHeight}
                  fill={c.isGreen ? "#10b981" : "#ef4444"}
                  opacity={0.3}
                />
              ))}

            {/* Candlesticks */}
            {candleRenders.map((c, i) => (
              <g
                key={`candle-${i}`}
                onMouseEnter={() => setHoveredCandle(i)}
                onMouseLeave={() => setHoveredCandle(null)}
                className="cursor-crosshair"
              >
                {/* Wick */}
                <line
                  x1={c.x}
                  y1={c.wickTopY}
                  x2={c.x}
                  y2={c.wickBottomY}
                  stroke={c.isGreen ? "#10b981" : "#ef4444"}
                  strokeWidth={1}
                />
                {/* Body */}
                <rect
                  x={c.x - 3}
                  y={c.bodyY}
                  width={6}
                  height={Math.max(1, c.bodyHeight)}
                  fill={c.isGreen ? "#10b981" : "#ef4444"}
                  stroke={c.isGreen ? "#059669" : "#dc2626"}
                  strokeWidth={0.5}
                  opacity={i === hoveredCandle ? 1 : 0.85}
                />
              </g>
            ))}

            {/* Overlay lines */}
            {overlayLines.sma20 && (
              <polyline
                points={overlayLines.sma20}
                fill="none"
                stroke="#f59e0b"
                strokeWidth={1.5}
                opacity={0.8}
              />
            )}
            {overlayLines.ema12 && (
              <polyline
                points={overlayLines.ema12}
                fill="none"
                stroke="#8b5cf6"
                strokeWidth={1.5}
                opacity={0.8}
              />
            )}
            {overlayLines.ema26 && (
              <polyline
                points={overlayLines.ema26}
                fill="none"
                stroke="#06b6d4"
                strokeWidth={1.5}
                opacity={0.8}
              />
            )}
          </svg>

          {/* RSI sub-chart */}
          {activeOverlays.has("rsi14") && rsiLinePoints && (
            <div className="mt-2">
              <div className="text-[10px] text-muted-foreground mb-1 flex items-center gap-2">
                <Activity className="h-3 w-3" aria-hidden="true" />
                RSI (14)
                {/* Current RSI value */}
                {rsi14.filter((v) => v !== null).length > 0 && (
                  <Badge
                    variant="outline"
                    className={`text-[9px] px-1 py-0 ${
                      (() => {
                        const lastRSI = rsi14.filter((v) => v !== null).pop()!;
                        return lastRSI >= 70
                          ? "border-red-500/50 text-red-600 dark:text-red-400"
                          : lastRSI <= 30
                          ? "border-emerald-500/50 text-emerald-600 dark:text-emerald-400"
                          : "border-muted-foreground/30 text-muted-foreground";
                      })()
                    }`}
                  >
                    {rsi14.filter((v) => v !== null).pop()!.toFixed(1)}
                  </Badge>
                )}
              </div>
              <svg
                width={width}
                height={80}
                viewBox={`0 0 ${width} 80`}
                className="w-full"
              >
                {/* Overbought/oversold zones */}
                <rect x={padding.left} y={0} width={width - padding.left - padding.right} height={80 * 0.3} fill="#ef4444" opacity={0.05} />
                <rect x={padding.left} y={80 * 0.7} width={width - padding.left - padding.right} height={80 * 0.3} fill="#10b981" opacity={0.05} />
                {/* RSI 70 and 30 lines */}
                <line x1={padding.left} y1={80 * 0.3} x2={width - padding.right} y2={80 * 0.3} stroke="#ef4444" strokeOpacity={0.3} strokeDasharray="4,4" />
                <line x1={padding.left} y1={80 * 0.7} x2={width - padding.right} y2={80 * 0.7} stroke="#10b981" strokeOpacity={0.3} strokeDasharray="4,4" />
                <line x1={padding.left} y1={80 * 0.5} x2={width - padding.right} y2={80 * 0.5} stroke="currentColor" strokeOpacity={0.1} strokeDasharray="2,2" />
                {/* Labels */}
                <text x={width - padding.right + 5} y={80 * 0.3 + 4} fill="#ef4444" fontSize={9}>70</text>
                <text x={width - padding.right + 5} y={80 * 0.5 + 4} fill="currentColor" fontSize={9} className="text-muted-foreground">50</text>
                <text x={width - padding.right + 5} y={80 * 0.7 + 4} fill="#10b981" fontSize={9}>30</text>
                {/* RSI line */}
                <polyline
                  points={rsiLinePoints}
                  fill="none"
                  stroke="#a855f7"
                  strokeWidth={1.5}
                />
              </svg>
            </div>
          )}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-3 mt-2 text-[10px] text-muted-foreground">
          {activeOverlays.has("sma20") && (
            <span className="flex items-center gap-1">
              <span className="w-3 h-0.5 bg-amber-500 inline-block" /> SMA 20
            </span>
          )}
          {activeOverlays.has("ema12") && (
            <span className="flex items-center gap-1">
              <span className="w-3 h-0.5 bg-violet-500 inline-block" /> EMA 12
            </span>
          )}
          {activeOverlays.has("ema26") && (
            <span className="flex items-center gap-1">
              <span className="w-3 h-0.5 bg-cyan-500 inline-block" /> EMA 26
            </span>
          )}
          {activeOverlays.has("rsi14") && (
            <span className="flex items-center gap-1">
              <span className="w-3 h-0.5 bg-purple-500 inline-block" /> RSI 14
            </span>
          )}
          <span className="flex items-center gap-1">
            <span className="w-3 h-0.5 bg-emerald-500 inline-block" /> Bullish
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-0.5 bg-red-500 inline-block" /> Bearish
          </span>
        </div>
      </CardContent>
    </Card>
  );
});
