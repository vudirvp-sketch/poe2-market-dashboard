"""
Content Pulse — daily turnover per league mechanic + 7d/30d rolling averages.

Implements PRODUCT_VISION.md §3.5 (F3). For each league mechanic category
(Ritual, Breach, Delirium, Ultimatum, Expedition, Abyss, Incursion, ...)
computes:

- today_volume   — sum of current Quantity across all items in the category
                   (today's "trade throughput" proxy).
- rolling_7d     — mean daily volume over the last 7 days (from price_logs).
- rolling_30d    — mean daily volume over the last 30 days.
- delta_7d_pct   — (today_volume / rolling_7d - 1) * 100
- delta_30d_pct  — (today_volume / rolling_30d - 1) * 100
- signal         — "rising" | "falling" | "stable" based on delta_7d_pct
- top_rising     — top-3 items in the category whose 7d price trend is up
                   (filtered to items with at least 2 price points).
- top_falling    — top-3 items in the category whose 7d price trend is down.

The category list comes from config.league.currency_categories. Categories
that are NOT trade-mechanic categories (e.g. "currency", "fragments") are
still computed — the frontend can choose to filter them out, but the backend
returns everything so the same endpoint serves multiple UIs.

This module is pure-function: it takes a DataSnapshot + AppConfig and returns
a dict. The route handler (routes_content_pulse.py) is a thin wrapper that
calls this function and shapes the response. This separation makes the logic
testable without spinning up FastAPI.

Design notes
------------
- We use `Quantity` from price_logs as the per-day volume proxy (matches what
  POE2Scout reports as "CurrentQuantity" on the ByCategory endpoint).
- When price_logs are sparse (only a few days), rolling_7d / rolling_30d fall
  back to whatever is available — no NaN. We always return a number, even if
  it's just today_volume.
- `signal` thresholds: rising = delta_7d_pct > +10, falling = < -10, else stable.
  Tunable via constants below.
- `top_rising` / `top_falling` are sorted by absolute % change, descending.
  Only items with at least 2 price points are considered (need a slope).
"""

from __future__ import annotations

import logging
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

from backend.api.data_snapshot import DataSnapshot

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Tunable constants — kept here rather than in config.yaml because they are
# analysis thresholds, not deployment parameters. If they need to become
# per-deployment configurable, move them to a new `content_pulse:` block in
# config.yaml and add a Pydantic model in backend/config.py.
# ---------------------------------------------------------------------------

SIGNAL_RISING_THRESHOLD_PCT = 10.0   # delta_7d_pct > +10  → rising
SIGNAL_FALLING_THRESHOLD_PCT = -10.0  # delta_7d_pct < -10  → falling

TOP_N_PER_CATEGORY = 3  # how many rising / falling items to keep per category


def _bucketize_price_logs(
    price_logs: list[dict],
) -> dict[str, float]:
    """Aggregate raw price_logs (list of {Time, Price, Quantity}) by day.

    Returns a dict {YYYY-MM-DD: total_quantity_for_that_day}.
    Days with no trades are simply absent from the dict (caller fills gaps
    with 0 if needed).
    """
    by_day: dict[str, float] = defaultdict(float)
    for log in price_logs:
        time_val = log.get("Time") or log.get("time")
        qty = log.get("Quantity") or log.get("quantity") or 0
        if time_val is None:
            continue
        # Normalize to YYYY-MM-DD (truncate time component if present)
        if isinstance(time_val, str):
            day_key = time_val[:10]  # "2026-06-08T00:00:00" → "2026-06-08"
        elif isinstance(time_val, datetime):
            day_key = time_val.strftime("%Y-%m-%d")
        else:
            continue
        try:
            by_day[day_key] += float(qty)
        except (TypeError, ValueError):
            continue
    return dict(by_day)


def _rolling_mean(
    daily_volumes: dict[str, float],
    days: int,
    today: datetime,
) -> float:
    """Compute the mean daily volume over the last `days` days (inclusive of today).

    Missing days count as 0 (no trades = 0 volume). Returns 0.0 if the dict
    is empty or all days are missing.
    """
    if not daily_volumes:
        return 0.0
    total = 0.0
    for offset in range(days):
        day = (today - timedelta(days=offset)).strftime("%Y-%m-%d")
        total += daily_volumes.get(day, 0.0)
    return total / days


def _price_trend_pct(price_logs: list[dict]) -> float | None:
    """Compute % change between first and last price in `price_logs`.

    Returns None if there are fewer than 2 points or the first price is 0.
    The list is assumed to be time-sorted ascending (oldest first); if not,
    we sort by Time defensively.
    """
    if not price_logs or len(price_logs) < 2:
        return None
    try:
        sorted_logs = sorted(
            price_logs,
            key=lambda x: x.get("Time") or x.get("time") or "",
        )
        first = sorted_logs[0].get("Price") or sorted_logs[0].get("price")
        last = sorted_logs[-1].get("Price") or sorted_logs[-1].get("price")
        if first is None or last is None:
            return None
        first_f = float(first)
        last_f = float(last)
        if first_f <= 0:
            return None
        return ((last_f - first_f) / first_f) * 100.0
    except (TypeError, ValueError, KeyError):
        return None


def _signal_from_delta(delta_7d_pct: float | None) -> str:
    """Map a 7d delta percentage to a signal string."""
    if delta_7d_pct is None:
        return "stable"
    if delta_7d_pct > SIGNAL_RISING_THRESHOLD_PCT:
        return "rising"
    if delta_7d_pct < SIGNAL_FALLING_THRESHOLD_PCT:
        return "falling"
    return "stable"


def _category_today_volume(currencies_in_category: list[dict]) -> float:
    """Sum CurrentQuantity across all items in a category."""
    total = 0.0
    for curr in currencies_in_category:
        # Try several field name variants — POE2Scout uses PascalCase in the
        # raw API response, but the snapshot lowercases the api_id key only.
        qty = (
            curr.get("CurrentQuantity")
            or curr.get("current_quantity")
            or curr.get("Quantity")
            or 0
        )
        try:
            total += float(qty)
        except (TypeError, ValueError):
            continue
    return total


def _category_daily_volumes(
    currencies_in_category: list[dict],
) -> dict[str, float]:
    """Aggregate per-day total Quantity across all items in a category.

    Returns {YYYY-MM-DD: total_quantity}. Each item's PriceLogs are
    bucketized by day, then summed across items.
    """
    by_day: dict[str, float] = defaultdict(float)
    for curr in currencies_in_category:
        logs = curr.get("PriceLogs") or curr.get("price_logs") or []
        if not logs:
            continue
        item_by_day = _bucketize_price_logs(logs)
        for day, qty in item_by_day.items():
            by_day[day] += qty
    return dict(by_day)


def _top_movers(
    currencies_in_category: list[dict],
    rising: bool,
) -> list[dict]:
    """Return top-N items by % price change (rising or falling).

    `rising=True` → items with positive % change, sorted descending.
    `rising=False` → items with negative % change, sorted ascending (most
    negative first).
    """
    candidates: list[dict] = []
    for curr in currencies_in_category:
        api_id = curr.get("ApiId") or curr.get("api_id") or ""
        if not api_id:
            continue
        logs = curr.get("PriceLogs") or curr.get("price_logs") or []
        trend = _price_trend_pct(logs)
        if trend is None:
            continue
        if rising and trend <= 0:
            continue
        if not rising and trend >= 0:
            continue
        candidates.append({
            "api_id": api_id,
            "text": curr.get("Text") or curr.get("text") or api_id,
            "trend_pct": round(trend, 2),
            "current_price": float(
                curr.get("CurrentPrice")
                or curr.get("current_price")
                or 0
            ),
        })
    # Sort: rising → descending by trend_pct; falling → ascending
    candidates.sort(key=lambda x: x["trend_pct"], reverse=rising)
    return candidates[:TOP_N_PER_CATEGORY]


def compute_content_pulse(
    snapshot: DataSnapshot,
    config,
    now: datetime | None = None,
) -> dict:
    """Compute the content pulse for all configured categories.

    Args:
        snapshot: DataSnapshot from get_snapshot() — must have `.currencies`
            (dict[api_id_lower, raw_dict]) and `.fetched_at`.
        config: AppConfig — uses `.league.currency_categories` for the list.
        now: Optional override for "today" (for tests). Defaults to UTC now.

    Returns:
        Dict with shape:
            {
                "league": str,
                "categories": [
                    {
                        "category": "ritual",
                        "today_volume": 12345.0,
                        "rolling_7d": 11000.0,
                        "rolling_30d": 12000.0,
                        "delta_7d_pct": 12.27,
                        "delta_30d_pct": 2.88,
                        "signal": "rising",
                        "item_count": 27,
                        "top_rising": [...],
                        "top_falling": [...],
                    },
                    ...
                ],
                "data_available": bool,
                "fetched_at": str (ISO 8601),
            }
    """
    today = now or datetime.now(timezone.utc)
    categories_config = config.league.currency_categories

    # Group currencies by category_api_id. snapshot.currencies values are the
    # raw ByCategory dicts, each of which has "CategoryApiId" (PascalCase)
    # or "category_api_id" (snake_case) depending on whether the snapshot
    # was built from raw API responses or transformed.
    by_category: dict[str, list[dict]] = defaultdict(list)
    for curr in snapshot.currencies.values():
        cat = (
            curr.get("CategoryApiId")
            or curr.get("category_api_id")
            or ""
        )
        if cat:
            by_category[cat].append(curr)

    categories_result: list[dict] = []
    any_data = False

    for category in categories_config:
        items = by_category.get(category, [])
        if not items:
            # Category is configured but has no items in the snapshot.
            # Still emit a row so the UI can render "0 items / no data".
            categories_result.append({
                "category": category,
                "today_volume": 0.0,
                "rolling_7d": 0.0,
                "rolling_30d": 0.0,
                "delta_7d_pct": None,
                "delta_30d_pct": None,
                "signal": "stable",
                "item_count": 0,
                "top_rising": [],
                "top_falling": [],
            })
            continue

        any_data = True

        today_volume = _category_today_volume(items)
        daily_volumes = _category_daily_volumes(items)
        rolling_7d = _rolling_mean(daily_volumes, 7, today)
        rolling_30d = _rolling_mean(daily_volumes, 30, today)

        delta_7d_pct: float | None
        if rolling_7d > 0:
            delta_7d_pct = round(((today_volume / rolling_7d) - 1) * 100, 2)
        else:
            # No historical data to compare against — can't compute a delta.
            delta_7d_pct = None

        delta_30d_pct: float | None
        if rolling_30d > 0:
            delta_30d_pct = round(((today_volume / rolling_30d) - 1) * 100, 2)
        else:
            delta_30d_pct = None

        signal = _signal_from_delta(delta_7d_pct)

        categories_result.append({
            "category": category,
            "today_volume": round(today_volume, 2),
            "rolling_7d": round(rolling_7d, 2),
            "rolling_30d": round(rolling_30d, 2),
            "delta_7d_pct": delta_7d_pct,
            "delta_30d_pct": delta_30d_pct,
            "signal": signal,
            "item_count": len(items),
            "top_rising": _top_movers(items, rising=True),
            "top_falling": _top_movers(items, rising=False),
        })

    # Sort categories: most volatile first (largest |delta_7d_pct|).
    # Categories with None delta go to the end (treated as abs=0).
    def _sort_key(c: dict) -> float:
        d = c.get("delta_7d_pct")
        return abs(d) if d is not None else 0.0
    categories_result.sort(key=_sort_key, reverse=True)

    return {
        "league": config.league.league_name,
        "categories": categories_result,
        "data_available": any_data,
        "fetched_at": today.isoformat(),
    }
