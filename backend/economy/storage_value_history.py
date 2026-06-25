"""
Storage Value History — time-series of price(currency) / price(mirror)
and price(currency) / price(hinekora) ratios.

F2 follow-up (iter 75). Builds a time-aligned series from the snapshot's
price_histories (which come from POE2Scout ByCategory `price_logs`). For
each timestamp in the currency's history, we find the nearest mirror /
hinekora price point (within a tolerance window) and compute the ratio.

The result feeds the historical chart in the Storage Value tab.

Design notes
------------
- Mirror and Hinekora are the two "store-of-value" reference currencies
  called out in PRODUCT_VISION.md §3.3. Their api_ids are `mirror` and
  `hinekoras-lock` respectively (see backend/data/currency_names.json).
- Tolerance: 24h. If the nearest mirror price point is more than 24h away
  from the currency's timestamp, we emit the point with `mirror_price=None`
  and `ratio_mirror=None` rather than skipping it — this keeps the chart
  x-axis continuous.
- If mirror / hinekora have no history at all (e.g. mirror isn't traded in
  the current league), all points have None ratios — the frontend should
  hide the corresponding line.
- `days` parameter limits the lookback window (default 30, max 90 to match
  historical_retention_days).
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from backend.api.data_snapshot import DataSnapshot

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

DEFAULT_MIRROR_API_ID = "mirror"
DEFAULT_HINEKORA_API_ID = "hinekoras-lock"
NEAREST_NEIGHBOR_TOLERANCE_HOURS = 24
MAX_DAYS = 90


def _find_nearest_price(
    target_ts: datetime,
    history: list,
    tolerance_hours: float = NEAREST_NEIGHBOR_TOLERANCE_HOURS,
) -> tuple[float | None, datetime | None]:
    """Find the price closest to `target_ts` in `history`.

    Args:
        target_ts: The timestamp to match.
        history: List of PricePoint objects (with `.timestamp` and `.price`).
        tolerance_hours: Max acceptable distance in hours. Points farther
            than this are treated as missing.

    Returns:
        (price, matched_timestamp) — both None if no point within tolerance.
    """
    if not history:
        return None, None

    best_price: float | None = None
    best_ts: datetime | None = None
    best_delta = timedelta.max

    tolerance = timedelta(hours=tolerance_hours)

    for point in history:
        try:
            delta = abs(point.timestamp - target_ts)
        except (TypeError, AttributeError):
            continue
        if delta < best_delta:
            best_delta = delta
            best_price = point.price
            best_ts = point.timestamp

    if best_delta > tolerance:
        return None, None
    return best_price, best_ts


def compute_storage_value_history(
    snapshot: DataSnapshot,
    currency: str,
    *,
    mirror_api_id: str = DEFAULT_MIRROR_API_ID,
    hinekora_api_id: str = DEFAULT_HINEKORA_API_ID,
    days: int = 30,
    now: datetime | None = None,
) -> dict:
    """Compute the time-series of currency/mirror and currency/hinekora ratios.

    Args:
        snapshot: DataSnapshot with `.price_histories` (dict[api_id_lower, list[PricePoint]]).
        currency: Currency API ID to compute ratios for (e.g. "divine").
        mirror_api_id: Reference currency for the "store of value" denominator.
            Defaults to "mirror" (Mirror of Kalandra).
        hinekora_api_id: Second reference currency. Defaults to "hinekoras-lock".
        days: Lookback window in days. Points older than this are excluded.
        now: Optional override for "today" (for tests). Defaults to UTC now.

    Returns:
        Dict with shape:
            {
                "currency": "divine",
                "mirror_currency": "mirror",
                "hinekora_currency": "hinekoras-lock",
                "points": [
                    {
                        "timestamp": "2026-06-08T00:00:00+00:00",
                        "price": 100.5,
                        "mirror_price": 50000.0 | None,
                        "hinekora_price": 5000.0 | None,
                        "ratio_mirror": 0.00201 | None,
                        "ratio_hinekora": 0.0201 | None,
                    },
                    ...
                ],
                "data_available": bool,
                "fetched_at": "2026-06-08T12:00:00+00:00",
            }
    """
    today = now or datetime.now(timezone.utc)
    cutoff = today - timedelta(days=min(days, MAX_DAYS))

    currency_lower = currency.lower()
    mirror_lower = mirror_api_id.lower()
    hinekora_lower = hinekora_api_id.lower()

    curr_history = snapshot.price_histories.get(currency_lower, [])
    mirror_history = snapshot.price_histories.get(mirror_lower, [])
    hinekora_history = snapshot.price_histories.get(hinekora_lower, [])

    # If the requested currency has no history at all, return empty.
    if not curr_history:
        return {
            "currency": currency,
            "mirror_currency": mirror_api_id,
            "hinekora_currency": hinekora_api_id,
            "points": [],
            "data_available": False,
            "fetched_at": today.isoformat(),
        }

    points: list[dict] = []
    for point in curr_history:
        try:
            ts = point.timestamp
            price = point.price
        except (TypeError, AttributeError):
            continue

        # Skip points older than the cutoff
        if ts < cutoff:
            continue
        # Skip points in the future (shouldn't happen, but defensive)
        if ts > today + timedelta(hours=1):
            continue

        # Find nearest mirror / hinekora prices
        mirror_price, _ = _find_nearest_price(ts, mirror_history)
        hinekora_price, _ = _find_nearest_price(ts, hinekora_history)

        ratio_mirror = (
            round(price / mirror_price, 8)
            if mirror_price and mirror_price > 0
            else None
        )
        ratio_hinekora = (
            round(price / hinekora_price, 8)
            if hinekora_price and hinekora_price > 0
            else None
        )

        points.append({
            "timestamp": ts.isoformat(),
            "price": round(float(price), 6),
            "mirror_price": round(float(mirror_price), 6) if mirror_price is not None else None,
            "hinekora_price": round(float(hinekora_price), 6) if hinekora_price is not None else None,
            "ratio_mirror": ratio_mirror,
            "ratio_hinekora": ratio_hinekora,
        })

    # Sort by timestamp ascending (in case input is unsorted)
    points.sort(key=lambda p: p["timestamp"])

    return {
        "currency": currency,
        "mirror_currency": mirror_api_id,
        "hinekora_currency": hinekora_api_id,
        "points": points,
        "data_available": len(points) > 0,
        "fetched_at": today.isoformat(),
    }
