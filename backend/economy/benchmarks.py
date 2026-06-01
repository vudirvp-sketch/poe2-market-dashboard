"""
Historical price benchmarks: 30-day range, range position, percentile.
Data source: POE2Scout DailyStatsHistory (OHLCV per day).
"""
from dataclasses import dataclass
import statistics


@dataclass(frozen=True)
class HistoricalBenchmark:
    low_30d: float         # 30-day low
    high_30d: float        # 30-day high
    range_position: float  # 0.0 = at bottom, 1.0 = at peak
    percentile_30d: float  # 0-100, what % of historical closes are below current
    current_vs_avg: float  # (current - avg) / avg, negative = below average


def compute_benchmarks(
    daily_stats: list[dict],  # [{"close": float, "high": float, "low": float, ...}]
    current_price: float,
) -> HistoricalBenchmark | None:
    """
    Compute historical benchmarks from daily OHLCV data.
    Returns None if insufficient data (< 7 days).
    """
    if len(daily_stats) < 7:
        return None

    closes = [d["close"] for d in daily_stats if d["close"] > 0]
    if not closes:
        return None

    low_30d = min(d["low"] for d in daily_stats if d["low"] > 0)
    high_30d = max(d["high"] for d in daily_stats if d["high"] > 0)

    # Range position: where current price sits in 30d range
    range_width = high_30d - low_30d
    if range_width > 0:
        range_position = (current_price - low_30d) / range_width
    else:
        range_position = 0.5  # Flat market

    # Clamp to [0, 1]
    range_position = max(0.0, min(1.0, range_position))

    # Percentile: what % of daily closes are below current price
    below_count = sum(1 for c in closes if c <= current_price)
    percentile_30d = (below_count / len(closes)) * 100

    # Current vs average
    avg_close = statistics.mean(closes)
    current_vs_avg = (current_price - avg_close) / avg_close if avg_close > 0 else 0.0

    return HistoricalBenchmark(
        low_30d=low_30d,
        high_30d=high_30d,
        range_position=range_position,
        percentile_30d=percentile_30d,
        current_vs_avg=current_vs_avg,
    )
