"""
Pricing helpers — unified transitive price computation and historical lookup.

P0-5 (iter 57): Previously there were THREE different implementations of the
same concept ("price of every currency in the base currency"):

  1. `backend/api/data_snapshot.py:_compute_transitive_prices` — BFS,
     O(V+E). Correct for chains of arbitrary depth.
  2. `backend/scheduler.py:collect_price_snapshot` — 5-iteration
     relaxation, O(5*E). Silently misses currencies whose shortest path
     from the base currency is >5 hops. With ~600 currencies this is a
     real correctness bug, not a theoretical concern.
  3. `backend/api/routes_arbitrage.py:get_triangular_arbitrage` — only
     forwarded the (already-computed) `prices_in_base` to
     `find_triangular_arbitrage`, where it was a DEAD parameter.

This module exposes:

  - `compute_transitive_prices(prices_in_base, rates, base)` — single BFS
    implementation. Mutates `prices_in_base` in place. Used by
    `data_snapshot.py` and `scheduler.py`.

  - `find_price_24h_ago(history_with_timestamps, max_drift_hours)` — moved
    here from `routes_arbitrage.py` so that both `routes_arbitrage.py`
    (flip clustering) and `routes_analyst.py` (analyst 24h change) import
    the same canonical helper. Previously `routes_analyst.py` imported
    `_find_price_24h_ago` from `routes_arbitrage.py` — a circular-ish
    dependency that broke layering (`economy/` should not depend on
    `api/`).

  - `compute_zscore(prices, current)` — F5 (iter 77). Returns the
    z-score of `current` relative to the mean / std of `prices`. Used by
    `backend/economy/speculation.py:compute_speculation_signals` to power
    BUY/SELL/HOLD signals on the Speculation tab.

  - `compute_percentile(prices, current)` — F5 (iter 77). Returns the
    percentile (0..100) of `current` within `prices` using linear
    interpolation. Companion to `compute_zscore`: percentile is more
    robust to non-normal distributions (typical for game-economy prices,
    which are heavy-tailed).

The BFS here matches the previously-existing implementation in
`data_snapshot.py` byte-for-byte (the correct one). The 5-iteration
relaxation in `scheduler.py` is removed entirely.
"""

from __future__ import annotations

import math
from collections import deque
from datetime import datetime, timedelta, timezone
from typing import Mapping, MutableMapping, Sequence


# ---------------------------------------------------------------------------
# Transitive price calculation (BFS, O(V+E))
# ---------------------------------------------------------------------------

def compute_transitive_prices(
    prices_in_base: MutableMapping[str, float],
    rates: Mapping[str, "object"],
    base: str,
) -> None:
    """BFS to find prices for currencies not directly paired with the base.

    Mutates `prices_in_base` in place — every newly-reachable currency gets
    a price entry. Currencies already in `prices_in_base` keep their
    existing (direct) price; transitive prices are only filled in for
    currencies that have no direct rate.

    The BFS uses the FIRST path found to compute transitive prices. This
    is not guaranteed to be the highest-volume or most accurate path.
    For currencies with many indirect paths, the transitive price may
    differ from the most accurate estimate. This is acceptable for tier
    classification and portfolio weighting, but should be noted for
    precision-critical uses.

    Args:
        prices_in_base: Mutable mapping seeded with ``{base: 1.0}`` and
            any direct rates from the base currency. New entries are
            added as the BFS discovers reachable currencies.
        rates: Mapping from arbitrary key → object with
            ``currency_from``, ``currency_to``, ``raw_rate`` attributes
            (e.g. ``ExchangeRate``). The keys are not iterated directly;
            only the values are.
        base: The base currency (numeraire). Must already be present in
            ``prices_in_base`` with price 1.0.

    Why BFS and not iterative relaxation?
        A fixed-iteration relaxation (e.g. 5 passes) silently misses
        currencies whose shortest path from the base exceeds the
        iteration count. With ~600 currencies and a sparse pair graph
        (most currencies pair only with a handful of hubs), 5-hop
        chains are real. BFS visits every reachable node exactly once,
        so depth is no longer a correctness concern.
    """
    known = set(prices_in_base.keys()) | {base}
    queue = deque(known)

    while queue:
        current = queue.popleft()
        # base currency has price 1.0 by convention
        current_price = prices_in_base.get(current, 1.0)

        for key, rate in rates.items():
            if rate.raw_rate <= 0:
                continue

            # Can we price a new currency through 'current'?
            if rate.currency_from == current and rate.currency_to not in prices_in_base:
                # 1 current = raw_rate units of currency_to
                # 1 currency_to = (1/raw_rate) units of current
                # price_of_currency_to_in_base = current_price / raw_rate
                prices_in_base[rate.currency_to] = current_price / rate.raw_rate
                queue.append(rate.currency_to)

            elif rate.currency_to == current and rate.currency_from not in prices_in_base:
                # 1 currency_from = raw_rate units of current
                # price_of_currency_from_in_base = current_price * raw_rate
                prices_in_base[rate.currency_from] = current_price * rate.raw_rate
                queue.append(rate.currency_from)


# ---------------------------------------------------------------------------
# Historical price lookup — 24h-ago price with drift tolerance
# ---------------------------------------------------------------------------

def find_price_24h_ago(
    history_with_timestamps: list[tuple[datetime, float]],
    max_drift_hours: float = 6.0,
) -> float | None:
    """Find the price point closest to 24 hours ago.

    Walks `history_with_timestamps` and picks the point whose timestamp
    is closest to (now - 24h). If the closest point is further than
    `max_drift_hours` from the target, returns None — the caller should
    then treat the 24h-change as unknown rather than fabricate a value
    from an unrelated point.

    Args:
        history_with_timestamps: list of ``(timestamp_utc, price)``
            tuples, sorted ascending. Timezone-naive timestamps are
            treated as UTC for comparison.
        max_drift_hours: Maximum allowed time drift in hours (default
            6h). A point at, say, 18h ago or 30h ago is accepted; a
            point at 12h ago or 36h ago is rejected if no closer point
            exists.

    Returns:
        The price ~24h ago, or None if no data within ±max_drift of
        target.
    """
    if not history_with_timestamps:
        return None

    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    max_drift = timedelta(hours=max_drift_hours)

    closest: float | None = None
    closest_diff: timedelta | None = None

    for ts, price in history_with_timestamps:
        # Ensure timezone-aware comparison
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        diff = abs(ts - cutoff)
        if closest_diff is None or diff < closest_diff:
            closest = price
            closest_diff = diff

    if closest_diff is not None and closest_diff > max_drift:
        return None  # No point within ±max_drift of 24h ago

    return closest


# ---------------------------------------------------------------------------
# Z-score + percentile (F5, iter 77) — Speculation signals
# ---------------------------------------------------------------------------
#
# These helpers power the Speculation tab (PRODUCT_VISION §3.2). The idea:
#   - For each item, take the last N days of price_logs.
#   - Compute mean / std of those prices.
#   - z-score = (current_price - mean) / std
#   - If z < -1.5  → BUY signal (price is unusually low; expected to revert up)
#   - If z > +1.5  → SELL signal (price is unusually high; expected to revert down)
#   - Else         → HOLD
#
# Companion: percentile — more robust to heavy-tailed distributions, which
# game-economy prices often are. We expose both because the Speculation tab
# renders z-score (the cleaner statistical signal) AND percentile (the more
# intuitive "this item is cheaper than 95% of its 30-day range").
#
# Why population std (ddof=0), not sample std (ddof=1)?
#   The N-day price series is treated as the full population of interest
#   (the "normal range" we're comparing the current price against), not a
#   sample drawn from a larger distribution. Using population std also
#   gives a non-zero denominator with as few as 2 points (sample std with
#   ddof=1 needs ≥3 points to avoid div-by-zero). For N=30+ this choice
#   doesn't materially change the z-score.

def compute_zscore(
    prices: Sequence[float],
    current: float,
) -> float | None:
    """Return the z-score of `current` relative to `prices`.

    Args:
        prices: Sequence of historical price observations. Negative / NaN /
            None entries are skipped. At least 2 valid points are required
            (1 point → std=0 → undefined z-score).
        current: The current price to score.

    Returns:
        z = (current - mean) / std, or None when:
          - fewer than 2 valid prices are provided
          - std is 0 (all prices identical)
          - mean or current is non-finite

    Examples:
        >>> compute_zscore([1.0, 2.0, 3.0, 4.0, 5.0], 5.0)
        1.4142135...   # (5 - 3) / sqrt(2.0)
        >>> compute_zscore([1.0, 1.0, 1.0], 1.0) is None
        True            # std=0
        >>> compute_zscore([], 1.0) is None
        True            # empty
    """
    if not math.isfinite(current):
        return None

    valid = [p for p in prices if p is not None and isinstance(p, (int, float)) and math.isfinite(float(p))]
    if len(valid) < 2:
        return None

    n = len(valid)
    mean = sum(valid) / n
    variance = sum((p - mean) ** 2 for p in valid) / n  # population variance
    if variance <= 0:
        return None
    std = math.sqrt(variance)
    if std <= 0:
        return None

    return (current - mean) / std


def compute_percentile(
    prices: Sequence[float],
    current: float,
) -> float | None:
    """Return the percentile (0..100) of `current` within `prices`.

    Uses linear interpolation between adjacent ranks (matches numpy's
    default `linear` method, also the default in pandas and R).

    Args:
        prices: Historical price observations.
        current: The value whose percentile to compute.

    Returns:
        A float in [0, 100], or None when:
          - `prices` is empty
          - `current` is non-finite
    """
    if not math.isfinite(current):
        return None

    valid = [p for p in prices if p is not None and isinstance(p, (int, float)) and math.isfinite(float(p))]
    if not valid:
        return None

    sorted_prices = sorted(valid)
    n = len(sorted_prices)

    # Linear interpolation: find rank r in [0, n-1] where current would slot in
    if current <= sorted_prices[0]:
        return 0.0
    if current >= sorted_prices[-1]:
        return 100.0

    # Find insertion point — current is strictly between two known prices
    lo = 0
    hi = n - 1
    # Binary search for the largest index i such that sorted_prices[i] <= current
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if sorted_prices[mid] <= current:
            lo = mid
        else:
            hi = mid - 1

    # sorted_prices[lo] <= current < sorted_prices[lo+1]
    lower = sorted_prices[lo]
    upper = sorted_prices[lo + 1]
    if upper == lower:
        # Tie — use lo's rank directly
        rank = float(lo)
    else:
        frac = (current - lower) / (upper - lower)
        rank = lo + frac

    # Map rank [0, n-1] → percentile [0, 100] using the "lower" convention
    # (matches numpy default 'linear': pct = rank / (n-1) * 100 for n>1,
    # 0 for n==1).
    if n == 1:
        return 0.0
    return (rank / (n - 1)) * 100.0
