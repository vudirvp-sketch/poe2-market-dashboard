"""
Speculation backtest — measure profitability of z-score BUY/SELL/HOLD signals
on historical price_logs (F5 follow-up, iter 79).

Implements the second half of PRODUCT_VISION.md §3.2:

    «Бэктест на исторических данных прошлой лиги — насколько сигналы были
     прибыльны.»

The strategy under test is the same one that powers the live Speculation
tab (`backend/economy/speculation.py:compute_speculation_signals`):

    1. Look back N days from a reference timestamp.
    2. Compute mean / std of the price observations in that window.
    3. z-score = (price_at_reference - mean) / std.
    4. Map z-score → BUY (z < -1.5) | SELL (z > +1.5) | HOLD.

The backtest re-runs this strategy at a historical "evaluation" timestamp
(`now - eval_days_ago`), then measures the realised return over a forward
holding period (`holding_days`). The realised return is:

    BUY :  (price_exit - price_entry) / price_entry
           (bought low, expect reversion up — profit when price rises)

    SELL:  (price_entry - price_exit) / price_entry
           (sold high / short-sold, expect reversion down — profit when
            price falls; equivalent return for a short position)

    HOLD:  no position taken; excluded from the trade list but counted in
           `signal_breakdown.HOLD`.

Per-trade results plus per-signal aggregates (count, win rate, mean /
median / best / worst return) are returned. The frontend can render these
as a "How reliable were our signals?" panel — separate from the live
Speculation tab so the cost of running a backtest (iterating every item
with enough history) is opt-in.

Design notes
------------
- Reuses `compute_zscore` from `backend/economy/pricing.py` for the
  z-score calculation and `Z_BUY_THRESHOLD` / `Z_SELL_THRESHOLD` /
  `MIN_SAMPLE_SIZE` constants from `backend/economy/speculation.py` —
  guarantees the backtest uses the same thresholds as the live signal.
- Reuses `speculation._extract_prices` to parse PriceLogs into
  (timestamp, price) pairs. Same field-name defence (PascalCase +
  snake_case), same ISO-8601 parsing, same NaN / inf / non-finite
  filtering.
- `entry_price` is the price log nearest to `t_eval = now -
  eval_days_ago` within `TOLERANCE_HOURS` (default 24h). If no log is
  within tolerance, the item is skipped — we can't simulate a trade
  without knowing the entry price.
- `exit_price` is the price log nearest to `t_exit = t_eval +
  holding_days` within `TOLERANCE_HOURS`. If no log is within tolerance,
  the item is counted in `unevaluated_count` (signal was actionable but
  the holding period extends past the last observation — common when
  backtesting recent data).
- The z-score baseline window is `[t_eval - lookback_days, t_eval)` —
  strictly before the entry timestamp, so the entry price itself is NOT
  included in the baseline. This avoids leaking the signal into its own
  computation.
- `lookback_days` defaults to 30 (matches `DEFAULT_DAYS` from
  speculation.py) but is independently configurable — backtesting over
  long horizons may want a longer baseline (60d / 90d) to smooth out
  league-wide price drift.
- `holding_days` defaults to 7 — the same "medium horizon" used by the
  live signal's `horizon_hint`. Theorised mean-reversion time for
  |z|≥1.5 is 3-7 days per the speculation.py docstring.
- Trade list is sorted by `|return_pct|` descending — the most
  impactful (positive OR negative) trades first. The `limit` parameter
  caps the list (default 50) but does NOT affect aggregate stats; those
  are computed over ALL trades, not just the returned slice.
- Returns `data_available=False` when no item has both an entry and an
  exit price (e.g. snapshot not loaded, or no items have enough history
  to span the eval + holding window). The route handler also returns
  `data_available=False` when the snapshot manager has no snapshot —
  matches the pattern in `routes_speculation.py`.
"""

from __future__ import annotations

import logging
import math
import statistics
from datetime import datetime, timedelta, timezone
from typing import Any

from backend.api.data_snapshot import DataSnapshot
from backend.economy.pricing import compute_zscore
from backend.economy.speculation import (
    MIN_SAMPLE_SIZE,
    Z_BUY_THRESHOLD,
    Z_SELL_THRESHOLD,
    _extract_prices,
    _signal_from_zscore,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Tunable constants — kept here (not in config.yaml) for the same reason as
# speculation.py: analysis thresholds, not deployment parameters.
# ---------------------------------------------------------------------------

# How far back from "now" to evaluate the signal. Default 14d = "what would
# the speculation tab have shown 2 weeks ago, and what actually happened
# since?"
DEFAULT_EVAL_DAYS_AGO = 14

# How long to hold the position before measuring the exit price. Default 7d
# matches the "medium horizon" hint from speculation.py.
DEFAULT_HOLDING_DAYS = 7

# Z-score baseline window (days before t_eval). Default 30 matches
# `speculation.DEFAULT_DAYS` so backtest signals match live signals.
DEFAULT_LOOKBACK_DAYS = 30

# Default trade-list size cap. Aggregates are computed over ALL trades —
# this only limits the per-trade list returned.
DEFAULT_LIMIT = 50

# Maximum time drift (hours) between target timestamp and nearest price log.
# 24h matches `storage_value_history.py:_NEAREST_PRICE_TOLERANCE_HOURS`.
TOLERANCE_HOURS = 24


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _find_price_at(
    history: list[tuple[datetime, float]],
    target: datetime,
    tolerance_hours: float = TOLERANCE_HOURS,
) -> tuple[datetime, float] | None:
    """Find the (timestamp, price) nearest to `target` within tolerance.

    Args:
        history: Sorted ascending by timestamp. Timezone-naive timestamps
            are treated as UTC for comparison.
        target: The reference timestamp to match.
        tolerance_hours: Maximum allowed drift in hours. A point at, say,
            18h before target or 30h after is accepted; one at 12h before
            or 36h after is rejected if no closer point exists.

    Returns:
        (timestamp, price) of the closest point, or None if no point is
        within `tolerance_hours` of `target`.
    """
    if not history:
        return None

    if target.tzinfo is None:
        target = target.replace(tzinfo=timezone.utc)

    closest: tuple[datetime, float] | None = None
    closest_diff: timedelta | None = None

    for ts, price in history:
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        diff = abs(ts - target)
        if closest_diff is None or diff < closest_diff:
            closest = (ts, price)
            closest_diff = diff

    if closest_diff is None:
        return None
    if closest_diff > timedelta(hours=tolerance_hours):
        return None
    return closest


def _build_trade_entry(
    api_id: str,
    text: str,
    category: str,
    signal: str,
    entry_price: float,
    entry_ts: datetime,
    exit_price: float,
    exit_ts: datetime,
    z_score: float | None,
    sample_size: int,
) -> dict:
    """Build a single per-item trade record for the response.

    The return sign convention is:
        BUY  → (exit - entry) / entry  (profit when price rises)
        SELL → (entry - exit) / entry  (profit when price falls)
    """
    if entry_price <= 0:
        return_pct = 0.0
    elif signal == "SELL":
        return_pct = (entry_price - exit_price) / entry_price * 100.0
    else:  # BUY
        return_pct = (exit_price - entry_price) / entry_price * 100.0

    return {
        "api_id": api_id,
        "text": text,
        "category": category,
        "signal": signal,
        "entry_price": round(entry_price, 6),
        "entry_date": entry_ts.isoformat(),
        "exit_price": round(exit_price, 6),
        "exit_date": exit_ts.isoformat(),
        "return_pct": round(return_pct, 4),
        "z_score_at_entry": round(z_score, 4) if z_score is not None else None,
        "sample_size_at_entry": sample_size,
    }


def _stats_block(returns: list[float]) -> dict:
    """Compute aggregate stats for a list of return_pct values."""
    if not returns:
        return {
            "count": 0,
            "win_rate": 0.0,
            "mean_return_pct": 0.0,
            "median_return_pct": 0.0,
            "best_return_pct": 0.0,
            "worst_return_pct": 0.0,
        }

    wins = sum(1 for r in returns if r > 0)
    return {
        "count": len(returns),
        "win_rate": round(wins / len(returns) * 100.0, 2),
        "mean_return_pct": round(sum(returns) / len(returns), 4),
        "median_return_pct": round(statistics.median(returns), 4),
        "best_return_pct": round(max(returns), 4),
        "worst_return_pct": round(min(returns), 4),
    }


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def backtest_speculation_signals(
    snapshot: DataSnapshot,
    config: Any,
    *,
    eval_days_ago: int = DEFAULT_EVAL_DAYS_AGO,
    holding_days: int = DEFAULT_HOLDING_DAYS,
    lookback_days: int = DEFAULT_LOOKBACK_DAYS,
    limit: int = DEFAULT_LIMIT,
    signal_filter: str = "ALL",
    now: datetime | None = None,
) -> dict:
    """Backtest the z-score BUY/SELL/HOLD strategy on historical price_logs.

    Args:
        snapshot: DataSnapshot from `get_snapshot()` — must have `.currencies`
            (dict[api_id_lower, raw_dict]).
        config: AppConfig — used for `.league.league_name` only.
        eval_days_ago: When to evaluate the signal, expressed as days before
            `now`. Default 14. Clamped to [1, 365].
        holding_days: How long to hold the position after entry. Default 7.
            Clamped to [1, 90].
        lookback_days: Z-score baseline window length (days before entry
            timestamp). Default 30. Clamped to [1, 90].
        limit: Maximum number of per-item trades to return in the `trades`
            list. Aggregates are computed over ALL trades — this only
            caps the response payload. Default 50. Clamped to [1, 500].
        signal_filter: "ALL" (default) | "BUY" | "SELL" | "HOLD". When not
            "ALL", only trades with that signal are returned in the list.
            Aggregates are computed over the filtered set.
        now: Optional override for "today" (for tests). Defaults to UTC now.

    Returns:
        Dict with shape:
            {
                "league": str,
                "trades": [
                    {
                        "api_id": str,
                        "text": str,
                        "category": str,
                        "signal": "BUY" | "SELL" | "HOLD",
                        "entry_price": float,
                        "entry_date": str (ISO 8601),
                        "exit_price": float,
                        "exit_date": str (ISO 8601),
                        "return_pct": float,
                        "z_score_at_entry": float | None,
                        "sample_size_at_entry": int,
                    },
                    ...
                ],
                "signal_breakdown": {"BUY": int, "SELL": int, "HOLD": int},
                "evaluated_count": int,    # trades with entry+exit AND actionable signal
                "unevaluated_count": int,  # actionable signal but no exit price within tolerance
                "buy_stats": {...},
                "sell_stats": {...},
                "overall_stats": {...},
                "data_available": bool,
                "fetched_at": str (ISO 8601),
                "eval_days_ago": int,
                "holding_days": int,
                "lookback_days": int,
            }
    """
    today = now or datetime.now(timezone.utc)

    # Clamp inputs
    eval_days_ago = max(1, min(365, int(eval_days_ago)))
    holding_days = max(1, min(90, int(holding_days)))
    lookback_days = max(1, min(90, int(lookback_days)))
    limit = max(1, min(500, int(limit)))
    signal_filter = (signal_filter or "ALL").upper()
    if signal_filter not in {"ALL", "BUY", "SELL", "HOLD"}:
        signal_filter = "ALL"

    t_eval = today - timedelta(days=eval_days_ago)
    t_exit = t_eval + timedelta(days=holding_days)

    trades: list[dict] = []
    signal_breakdown = {"BUY": 0, "SELL": 0, "HOLD": 0}
    evaluated_count = 0
    unevaluated_count = 0
    any_data = False

    for curr in snapshot.currencies.values():
        if not isinstance(curr, dict):
            continue

        api_id = curr.get("ApiId") or curr.get("api_id") or ""
        if not api_id:
            continue

        text = curr.get("Text") or curr.get("text") or api_id
        category = curr.get("CategoryApiId") or curr.get("category_api_id") or ""

        price_logs = curr.get("PriceLogs") or curr.get("price_logs") or []
        if not price_logs:
            continue

        any_data = True
        history = _extract_prices(price_logs, today, eval_days_ago + lookback_days + 7)
        # We fetch a window wide enough to cover both the baseline (lookback
        # days before t_eval) and the holding period (holding_days after
        # t_eval). The +7 pad is to avoid off-by-one edge cases at the
        # boundaries.

        # Find entry price (nearest to t_eval within tolerance)
        entry = _find_price_at(history, t_eval)
        if entry is None:
            continue  # No entry price → can't simulate a trade

        entry_ts, entry_price = entry

        # Compute z-score baseline: price_logs STRICTLY BEFORE entry_ts,
        # within [entry_ts - lookback_days, entry_ts)
        baseline_cutoff = entry_ts - timedelta(days=lookback_days)
        baseline_prices = [
            p for ts, p in history
            if ts < entry_ts and ts >= baseline_cutoff
        ]

        if len(baseline_prices) < MIN_SAMPLE_SIZE:
            continue  # Not enough history → skip

        z = compute_zscore(baseline_prices, entry_price)
        signal = _signal_from_zscore(z)
        signal_breakdown[signal] += 1

        if signal == "HOLD":
            continue  # No position taken for HOLD signals

        # Find exit price (nearest to t_exit within tolerance)
        exit_point = _find_price_at(history, t_exit)
        if exit_point is None:
            unevaluated_count += 1
            continue

        exit_ts, exit_price = exit_point

        # Sanity: exit must be after entry (or same timestamp — same price log)
        if exit_ts < entry_ts:
            unevaluated_count += 1
            continue

        evaluated_count += 1
        trades.append(_build_trade_entry(
            api_id=api_id,
            text=text,
            category=category,
            signal=signal,
            entry_price=entry_price,
            entry_ts=entry_ts,
            exit_price=exit_price,
            exit_ts=exit_ts,
            z_score=z,
            sample_size=len(baseline_prices),
        ))

    # Apply signal filter BEFORE computing aggregates — aggregates reflect
    # the filtered set, not the full set. (This matches the live speculation
    # endpoint's behaviour: signal_filter narrows the response.)
    if signal_filter != "ALL":
        trades = [t for t in trades if t["signal"] == signal_filter]

    # Aggregates computed over the full filtered set
    buy_returns = [t["return_pct"] for t in trades if t["signal"] == "BUY"]
    sell_returns = [t["return_pct"] for t in trades if t["signal"] == "SELL"]
    all_returns = buy_returns + sell_returns

    buy_stats = _stats_block(buy_returns)
    sell_stats = _stats_block(sell_returns)
    overall_stats = _stats_block(all_returns)

    # Sort trades by |return_pct| desc — most impactful first
    trades.sort(key=lambda t: abs(t["return_pct"]), reverse=True)

    # Apply limit AFTER sort (so the most impactful trades are kept)
    trades = trades[:limit]

    return {
        "league": config.league.league_name,
        "trades": trades,
        "signal_breakdown": signal_breakdown,
        "evaluated_count": evaluated_count,
        "unevaluated_count": unevaluated_count,
        "buy_stats": buy_stats,
        "sell_stats": sell_stats,
        "overall_stats": overall_stats,
        "data_available": any_data,
        "fetched_at": today.isoformat(),
        "eval_days_ago": eval_days_ago,
        "holding_days": holding_days,
        "lookback_days": lookback_days,
    }
