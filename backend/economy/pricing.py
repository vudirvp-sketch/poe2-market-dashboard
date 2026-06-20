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

The BFS here matches the previously-existing implementation in
`data_snapshot.py` byte-for-byte (the correct one). The 5-iteration
relaxation in `scheduler.py` is removed entirely.
"""

from __future__ import annotations

from collections import deque
from datetime import datetime, timedelta, timezone
from typing import Mapping, MutableMapping


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
