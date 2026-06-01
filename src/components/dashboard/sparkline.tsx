// ============================================================================
// Sparkline component (tiny inline chart)
// §1.3: Supports optional subtle fill below the line (opacity 0.1-0.2)
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

export function Sparkline({ data, color, width = 80, height = 28, showFill = true }: SparklineProps) {
  if (!data || data.length < 2)
    return <span className="text-muted-foreground text-xs">—</span>;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data
    .map(
      (v, i) =>
        `${(i / (data.length - 1)) * width},${height - ((v - min) / range) * height}`
    )
    .join(" ");

  // Fill polygon: line points + close at bottom
  const fillPoints = showFill
    ? `0,${height} ${points} ${width},${height}`
    : undefined;

  return (
    <svg width={width} height={height} className="inline-block">
      {showFill && fillPoints && (
        <polygon
          fill={color}
          opacity={0.15}
          points={fillPoints}
        />
      )}
      <polyline
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        points={points}
      />
    </svg>
  );
}
