"""
Speculation — per-item z-score + BUY/SELL/HOLD signals (F5, iter 77).

Implements PRODUCT_VISION.md §3.2. For each currency in the snapshot:

1. Take the last `days` (default 30) of price_logs.
2. Compute mean / std of those prices.
3. z-score = (current_price - mean) / std  (via `compute_zscore`).
4. percentile = 0..100 of current_price within the historical range
   (via `compute_percentile`).
5. Map z-score to a signal:
       z < -1.5  → BUY  (price is unusually low; expected to revert up)
       z > +1.5  → SELL (price is unusually high; expected to revert down)
       else      → HOLD

The output is a sorted list (most extreme |z| first) of items that have
enough historical data to compute a z-score (≥2 valid price points).

This module is pure-function: it takes a DataSnapshot + AppConfig and returns
a dict. The route handler (routes_speculation.py) is a thin wrapper. Same
separation pattern as `content_pulse.py` and `storage_value_history.py`.

Design notes
------------
- The function iterates `snapshot.currencies.values()` once per item,
  filtering out entries with no `price_logs` or `current_price`. We use
  `.get("PriceLogs")` (PascalCase) first, then fall back to `.get("price_logs")`
  (snake_case) to match the same defensive pattern used in `content_pulse.py`.
- The historical window is bounded by `days` (default 30). Older points are
  dropped. We don't extrapolate forward — only the actual price_logs observed
  in the window contribute to mean / std.
- `horizon_hint` is a short localized-text-agnostic code ("short" | "medium"
  | "long") that the frontend can map to a localized string. Short = within
  a few days (high |z| → fast reversion), medium = within a week, long = >1
  week (low |z|, marginal signal). The frontend decides what to render.
- `price_history_short` returns up to `MAX_HISTORY_POINTS` (default 14) of the
  most recent price points, oldest-first, for an optional mini-sparkline in
  the UI. The full window is used for stats; only the display slice is
  truncated to keep the response payload small.
- Items with identical prices in the window (std=0) get z=None and are
  excluded from the result (signal="HOLD" but no actionable signal — we
  surface them as "not enough volatility" rather than padding the list
  with HOLD rows).
"""

from __future__ import annotations

import logging
import math
from datetime import datetime, timedelta, timezone
from typing import Any

from backend.api.data_snapshot import DataSnapshot
from backend.economy.pricing import compute_percentile, compute_zscore

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Tunable constants — kept here rather than in config.yaml because they are
# analysis thresholds, not deployment parameters. (Same convention as
# content_pulse.py.) If they need to become per-deployment configurable,
# move them to a new `speculation:` block in config.yaml + a Pydantic model
# in backend/config.py.
# ---------------------------------------------------------------------------

# z-score thresholds for BUY / SELL signals.
# |z| < 1.0  → HOLD (no actionable signal)
# 1.0 ≤ |z| < 1.5  → HOLD (weak signal — too noisy)
# |z| ≥ 1.5  → BUY (z < -1.5) or SELL (z > +1.5)
Z_BUY_THRESHOLD = -1.5     # z < this → BUY
Z_SELL_THRESHOLD = 1.5     # z > this → SELL

# How many recent price points to return in `price_history_short` (mini-sparkline).
MAX_HISTORY_POINTS = 14

# Minimum number of valid price points required to compute a signal.
# Below this, we can't trust the mean / std estimate.
MIN_SAMPLE_SIZE = 2

# Default lookback window in days.
DEFAULT_DAYS = 30

# Default maximum number of signals to return.
DEFAULT_LIMIT = 50


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _extract_prices(
    price_logs: list[dict],
    now: datetime,
    days: int,
) -> list[tuple[datetime, float]]:
    """Filter price_logs to the last `days` days and return (timestamp, price) pairs.

    Skips entries with missing / non-finite `Price` or `Time`. Timestamps
    may be ISO strings or datetime objects (matches what the POE2Scout
    provider produces in `poe2scout.py:get_all_currencies_with_prices`).
    """
    if not price_logs:
        return []

    cutoff = now - timedelta(days=days)
    out: list[tuple[datetime, float]] = []

    for log in price_logs:
        if not isinstance(log, dict):
            continue
        # Time field — try both casings
        time_val = log.get("Time") or log.get("time")
        price_val = log.get("Price") or log.get("price")
        if time_val is None or price_val is None:
            continue

        # Parse time
        if isinstance(time_val, str):
            try:
                # ISO 8601 string. `datetime.fromisoformat` handles
                # "2026-06-08T00:00:00" and "2026-06-08T00:00:00+00:00".
                ts = datetime.fromisoformat(time_val.replace("Z", "+00:00"))
            except (ValueError, TypeError):
                continue
        elif isinstance(time_val, datetime):
            ts = time_val
        else:
            continue

        # Normalize timezone: naive → UTC
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)

        if ts < cutoff:
            continue

        # Parse price
        try:
            price = float(price_val)
        except (TypeError, ValueError):
            continue
        if not math.isfinite(price):
            continue

        out.append((ts, price))

    # Sort ascending by timestamp so the latest entries are at the end
    out.sort(key=lambda x: x[0])
    return out


def _signal_from_zscore(z: float | None) -> str:
    """Map a z-score to a BUY / SELL / HOLD signal string."""
    if z is None:
        return "HOLD"
    if z < Z_BUY_THRESHOLD:
        return "BUY"
    if z > Z_SELL_THRESHOLD:
        return "SELL"
    return "HOLD"


def _horizon_hint(z: float | None) -> str:
    """Short code describing expected mean-reversion horizon.

    The frontend maps this to a localized string. Larger |z| → faster
    expected reversion (a sharp dislocation tends to correct quicker
    than a slow drift).
    """
    if z is None:
        return "unknown"
    az = abs(z)
    if az >= 2.5:
        return "short"   # 1-3 days
    if az >= 1.5:
        return "medium"  # 3-7 days
    return "long"        # >1 week, or HOLD


def _build_signal_entry(
    api_id: str,
    text: str,
    category: str,
    current_price: float,
    history: list[tuple[datetime, float]],
) -> dict | None:
    """Build a single signal dict from per-item data.

    Returns None when the item doesn't have enough history to compute a
    signal (caller should skip).
    """
    prices = [p for _, p in history]
    if len(prices) < MIN_SAMPLE_SIZE:
        return None
    if not math.isfinite(current_price) or current_price <= 0:
        return None

    z = compute_zscore(prices, current_price)
    pct = compute_percentile(prices, current_price)

    if z is None:
        # std=0 (all prices identical) — no volatility, no actionable signal
        return None

    n = len(prices)
    mean = sum(prices) / n
    variance = sum((p - mean) ** 2 for p in prices) / n  # population variance
    std = math.sqrt(variance) if variance > 0 else 0.0

    # Compact history slice for the mini-sparkline. Keep the most recent
    # MAX_HISTORY_POINTS entries, oldest first (so the chart renders left→right).
    history_slice = history[-MAX_HISTORY_POINTS:]
    price_history_short = [
        {"date": ts.isoformat(), "price": price}
        for ts, price in history_slice
    ]

    return {
        "api_id": api_id,
        "text": text,
        "category": category,
        "current_price": round(current_price, 6),
        "mean": round(mean, 6),
        "std": round(std, 6),
        "z_score": round(z, 4),
        "percentile": round(pct, 2) if pct is not None else None,
        "signal": _signal_from_zscore(z),
        "horizon_hint": _horizon_hint(z),
        "sample_size": n,
        "price_history_short": price_history_short,
    }


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def compute_speculation_signals(
    snapshot: DataSnapshot,
    config: Any,
    *,
    days: int = DEFAULT_DAYS,
    limit: int = DEFAULT_LIMIT,
    signal_filter: str = "ALL",
    now: datetime | None = None,
) -> dict:
    """Compute BUY / SELL / HOLD signals for every item with enough price history.

    Args:
        snapshot: DataSnapshot from get_snapshot() — must have `.currencies`
            (dict[api_id_lower, raw_dict]).
        config: AppConfig — used for `.league.league_name` only.
        days: Lookback window in days (default 30). Clamped to [1, 90].
        limit: Maximum number of signals to return (default 50). Clamped to
            [1, 500].
        signal_filter: "ALL" (default) | "BUY" | "SELL" | "HOLD". When not
            "ALL", only items with that signal are returned. The sort order
            is preserved (most extreme |z| first).
        now: Optional override for "today" (for tests). Defaults to UTC now.

    Returns:
        Dict with shape:
            {
                "league": str,
                "signals": [
                    {
                        "api_id": str,
                        "text": str,
                        "category": str,
                        "current_price": float,
                        "mean": float,
                        "std": float,
                        "z_score": float,
                        "percentile": float | None,
                        "signal": "BUY" | "SELL" | "HOLD",
                        "horizon_hint": "short" | "medium" | "long" | "unknown",
                        "sample_size": int,
                        "price_history_short": list[{"date": str, "price": float}],
                    },
                    ...
                ],
                "data_available": bool,
                "fetched_at": str (ISO 8601),
                "days": int,
            }
    """
    today = now or datetime.now(timezone.utc)

    # Clamp inputs
    days = max(1, min(90, int(days)))
    limit = max(1, min(500, int(limit)))
    signal_filter = (signal_filter or "ALL").upper()
    if signal_filter not in {"ALL", "BUY", "SELL", "HOLD"}:
        signal_filter = "ALL"

    signals: list[dict] = []
    any_data = False

    for curr in snapshot.currencies.values():
        if not isinstance(curr, dict):
            continue

        api_id = curr.get("ApiId") or curr.get("api_id") or ""
        if not api_id:
            continue

        text = curr.get("Text") or curr.get("text") or api_id
        category = curr.get("CategoryApiId") or curr.get("category_api_id") or ""

        # Current price — try several field name variants
        current_price_raw = (
            curr.get("CurrentPrice")
            or curr.get("current_price")
            or 0
        )
        try:
            current_price = float(current_price_raw)
        except (TypeError, ValueError):
            continue

        price_logs = curr.get("PriceLogs") or curr.get("price_logs") or []
        if not price_logs:
            continue

        history = _extract_prices(price_logs, today, days)
        if len(history) < MIN_SAMPLE_SIZE:
            continue

        any_data = True
        entry = _build_signal_entry(
            api_id=api_id,
            text=text,
            category=category,
            current_price=current_price,
            history=history,
        )
        if entry is None:
            continue
        signals.append(entry)

    # Sort: most extreme |z| first (BUY and SELL signals are both interesting
    # when they're far from 0). HOLD signals — if any survive the
    # signal_filter="ALL" request — sort last by |z| ascending.
    signals.sort(key=lambda s: abs(s["z_score"]), reverse=True)

    # Apply signal filter AFTER sort so the order is preserved
    if signal_filter != "ALL":
        signals = [s for s in signals if s["signal"] == signal_filter]

    # Apply limit
    signals = signals[:limit]

    return {
        "league": config.league.league_name,
        "signals": signals,
        "data_available": any_data,
        "fetched_at": today.isoformat(),
        "days": days,
    }
