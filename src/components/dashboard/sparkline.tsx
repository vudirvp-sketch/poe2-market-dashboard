// ============================================================================
// Sparkline component (tiny inline chart)
// §1.3: Supports optional subtle fill below the line (opacity 0.1-0.2)
// P0: Uses cubic bezier <path> for smooth curves + trend-colored fill
// ============================================================================
"use client";

interface SparklineProps {
  data: number[];
  color: string;
  width?: number;
  height?: number;
  /** Whether to show a subtle fill below the line (default: true) */
  showFill?: boolean;
}

/**
 * Convert data points to SVG coordinates.
 * Returns array of [x, y] tuples.
 */
function dataToPoints(data: number[], width: number, height: number): [number, number][] {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  return data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * height;
    return [x, y] as [number, number];
  });
}

/**
 * Build a smooth cubic bezier SVG path from a set of points.
 * Uses Catmull-Rom to Bezier conversion for natural-looking curves
 * that pass through every data point (no overshoot).
 *
 * Algorithm:
 * - For each segment (P[i] → P[i+1]), compute Bezier control points
 *   using the Catmull-Rom tangent formula:
 *     CP1 = P[i] + (P[i+1] - P[i-1]) / 6
 *     CP2 = P[i+1] - (P[i+2] - P[i]) / 6
 * - For the first and last segments, duplicate the endpoint to
 *   synthesize a phantom neighbor.
 */
function buildBezierPath(points: [number, number][]): string {
  if (points.length < 2) return "";
  if (points.length === 2) {
    // Straight line for 2 points
    return `M${points[0][0]},${points[0][1]} L${points[1][0]},${points[1][1]}`;
  }

  const segments: string[] = [];
  segments.push(`M${points[0][0]},${points[0][1]}`);

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]; // clamp to first point
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)]; // clamp to last point

    // Catmull-Rom to Bezier: tension = 1/6 (standard Catmull-Rom)
    const tension = 1 / 6;
    const cp1x = p1[0] + (p2[0] - p0[0]) * tension;
    const cp1y = p1[1] + (p2[1] - p0[1]) * tension;
    const cp2x = p2[0] - (p3[0] - p1[0]) * tension;
    const cp2y = p2[1] - (p3[1] - p1[1]) * tension;

    segments.push(`C${cp1x},${cp1y} ${cp2x},${cp2y} ${p2[0]},${p2[1]}`);
  }

  return segments.join(" ");
}

/**
 * Build the fill area path: bezier curve on top, straight line closing at bottom.
 */
function buildFillPath(points: [number, number][], width: number, height: number): string {
  const bezier = buildBezierPath(points);
  // Close the path: line to bottom-right, line to bottom-left, close
  return `${bezier} L${width},${height} L0,${height} Z`;
}

/**
 * Determine trend direction from data.
 * Compares last third vs first third average.
 * Returns "up", "down", or "flat".
 */
function getTrend(data: number[]): "up" | "down" | "flat" {
  if (data.length < 4) return "flat";
  const third = Math.max(1, Math.floor(data.length / 3));
  const firstAvg = data.slice(0, third).reduce((s, v) => s + v, 0) / third;
  const lastAvg = data.slice(-third).reduce((s, v) => s + v, 0) / third;
  const diff = lastAvg - firstAvg;
  const threshold = (Math.max(...data) - Math.min(...data)) * 0.05 || 0.01;
  if (diff > threshold) return "up";
  if (diff < -threshold) return "down";
  return "flat";
}

/**
 * Get trend-appropriate colors.
 * Falls back to the provided `color` prop if trend is flat.
 */
function getTrendColors(
  trend: "up" | "down" | "flat",
  fallbackColor: string,
): { line: string; fill: string } {
  if (trend === "up") return { line: "#22c55e", fill: "#22c55e" };   // emerald-500
  if (trend === "down") return { line: "#ef4444", fill: "#ef4444" }; // red-500
  return { line: fallbackColor, fill: fallbackColor };
}

export function Sparkline({ data, color, width = 80, height = 28, showFill = true }: SparklineProps) {
  if (!data || data.length < 2)
    return <span className="text-muted-foreground text-xs">—</span>;

  const points = dataToPoints(data, width, height);
  const trend = getTrend(data);
  const colors = getTrendColors(trend, color);

  const linePath = buildBezierPath(points);
  const fillPath = showFill ? buildFillPath(points, width, height) : undefined;

  return (
    <svg width={width} height={height} className="inline-block">
      {showFill && fillPath && (
        <path
          d={fillPath}
          fill={colors.fill}
          opacity={0.15}
        />
      )}
      <path
        d={linePath}
        fill="none"
        stroke={colors.line}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
