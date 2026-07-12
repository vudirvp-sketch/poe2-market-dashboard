"""
Daily Stats persistence helper (TD-5, iter 131).

Implements the pure-function transformers that sit between the POE2Scout
``DailyStatsHistory`` provider response and the ``daily_stats`` SQLite
table. The persisted rows let a future backtest use canonical daily
OHLCV candles (more accurate than the 5-min ``price_snapshots``
aggregation) without re-hitting the API on every request.

Design doc: ``docs/design/TD-3-4-5-9-persistence-gaps-design.md`` §4
(Option B schema) + §5.2 (lazy fetch + background refresh) + §6.3
(backfill) + §9 Phase 4 (file-by-file plan).

What this module computes
-------------------------
Three pure helpers, no I/O:

1. ``transform_daily_stats(provider_response, league, item_id, api_id)``
   — converts the raw POE2Scout ``DailyStatsHistory`` dict (PascalCase
   keys: ``Time``, ``Open``, ``High``, ...) into a ``list[dict]`` of rows
   ready for ``HistoricalStore.write_daily_stats_batch``. The caller
   supplies ``league`` / ``item_id`` / ``api_id`` because the provider
   response does not echo them (the endpoint is keyed by ``item_id`` in
   the URL path). Keeps the helper I/O-free + unit-testable.

2. ``is_daily_stats_fresh(latest_date_str, now=None)`` — returns True
   when the latest persisted row's date is today or yesterday (UTC).
   Used by the route's lazy-fetch fallback to decide whether to serve
   from SQLite or fetch from POE2Scout. "Yesterday" is allowed because
   POE2Scout publishes the current UTC day's candle only after the day
   rolls over — a row from yesterday is the freshest possible during
   most of the current day.

3. ``pick_top_items_by_volume(snapshot, n)`` — returns the top-N
   ``(item_id, api_id)`` pairs ranked by per-currency 24h volume
   (summed across all exchange pairs involving that currency).
   Used by the scheduler's ``refresh_daily_stats`` background task to
   pick which items to refresh each hour (design doc §5.2 strategy 2).

The three-layer persistence pattern (STATUS.md "Three-layer persistence
pattern") is adapted for TD-5: the write happens in TWO places (the
route's lazy-fetch fallback + the scheduler's background refresh), NOT
inside ``SnapshotManager._refresh()``. This is because daily OHLCV is
DAILY cadence + expensive (1 HTTP call per item), so it must NOT run on
the 5-min snapshot path. The pure helper here is the shared transformer
that both write paths call.

Open questions (design doc §10)
-------------------------------
- Q3 (item_id vs api_id primary key): default is to persist BOTH
  (``item_id`` is the POE2Scout primary key; ``api_id`` is added for
  cross-joining with ``price_snapshots``). ``api_id`` may be NULL for
  items not in the current snapshot — the route can still serve them by
  ``item_id``.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from backend.api.data_snapshot import DataSnapshot

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Tunable constants
# ---------------------------------------------------------------------------

DEFAULT_TOP_N_ITEMS: int = 50
"""Default N for pick_top_items_by_volume. Matches SchedulerConfig default."""

_FRESHNESS_GRACE_DAYS: int = 1
"""How many days back a daily_stats row counts as "fresh".

0 = must be today (strict — fails for most of the day before POE2Scout
publishes today's candle).
1 = today or yesterday (lenient — the recommended default; yesterday's
candle is the freshest possible during the current UTC day until
POE2Scout publishes today's).
"""


# ---------------------------------------------------------------------------
# 1. transform_daily_stats — provider response → persistence rows
# ---------------------------------------------------------------------------

def transform_daily_stats(
    provider_response: dict | None,
    league: str,
    item_id: int,
    api_id: str | None,
) -> list[dict]:
    """Transform a POE2Scout DailyStatsHistory response into persistence rows.

    The provider returns a dict shaped like::

        {
            "DailyStats": [
                {"Time": "2026-05-01", "Open": 220.0, "High": 225.0,
                 "Low": 218.0, "Close": 222.0, "Average": 221.5,
                 "Volume": 5000},
                ...
            ],
            "HasMore": false,
            "BaseCurrencyApiId": "exalted",
            "BaseCurrencyText": "Exalted Orb",
        }

    This function extracts the ``DailyStats`` array and maps each entry
    to a dict with the keys expected by
    ``HistoricalStore.write_daily_stats_batch``: ``date``, ``item_id``,
    ``api_id``, ``open``, ``high``, ``low``, ``close``, ``average``,
    ``volume``.

    The function never raises — a malformed response (None, missing
    ``DailyStats`` key, non-list value, unparseable entries) logs a
    debug message and returns an empty list. This matches the design
    doc §5.1 invariant: persistence MUST NOT block the caller (the
    route's lazy-fetch or the scheduler's background refresh).

    Args:
        provider_response: The raw dict returned by
            ``Poe2ScoutProvider.get_daily_stats()``. May be None (provider
            returned None — e.g. 404 for an unknown item_id).
        league: League name (echoed back into each row — the provider
            response does not include it).
        item_id: POE2Scout numeric ItemId (echoed back — the provider
            response does not include it).
        api_id: lowercase api_id for cross-joining with price_snapshots.
            May be None when the item is not in the current snapshot.
            Echoed back into each row.

    Returns:
        List of dicts suitable for ``write_daily_stats_batch``. Empty
        when ``provider_response`` is None, has no ``DailyStats`` key,
        or ``DailyStats`` is empty / not a list.
    """
    if not provider_response:
        return []

    raw_stats = provider_response.get("DailyStats")
    if not raw_stats or not isinstance(raw_stats, list):
        return []

    rows: list[dict] = []
    for entry in raw_stats:
        if not isinstance(entry, dict):
            continue

        # POE2Scout uses PascalCase keys ("Time", "Open", ...). Accept
        # both PascalCase and lowercase defensively — the DailyStatsPoint
        # pydantic model in schemas.py uses alias_generator, but this
        # helper stays I/O-free by not relying on pydantic validation
        # (which would reject malformed entries; we want to skip them
        # silently instead).
        date = entry.get("Time") or entry.get("time") or ""
        if not date:
            continue

        rows.append({
            "date": str(date),
            "item_id": int(item_id),
            "api_id": api_id,
            "open": _safe_float(entry.get("Open") or entry.get("open")),
            "high": _safe_float(entry.get("High") or entry.get("high")),
            "low": _safe_float(entry.get("Low") or entry.get("low")),
            "close": _safe_float(entry.get("Close") or entry.get("close")),
            "average": _safe_float(entry.get("Average") or entry.get("average")),
            "volume": _safe_float(entry.get("Volume") or entry.get("volume")),
        })

    if rows:
        logger.debug(
            "transform_daily_stats: %d rows for item_id=%d api_id=%s league=%s",
            len(rows), item_id, api_id, league,
        )

    return rows


def _safe_float(value: Any) -> float | None:
    """Convert a value to float, returning None on failure.

    POE2Scout occasionally returns null for OHLCV fields when a day had
    no trades. We preserve None rather than coercing to 0.0 so the
    persisted row accurately reflects "no data for this day".
    """
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------------------
# 2. is_daily_stats_fresh — lazy-fetch freshness check
# ---------------------------------------------------------------------------

def is_daily_stats_fresh(
    latest_date_str: str | None,
    *,
    now: datetime | None = None,
    grace_days: int = _FRESHNESS_GRACE_DAYS,
) -> bool:
    """Return True when the latest persisted daily_stats row is fresh enough.

    "Fresh enough" = the latest row's date is within ``grace_days`` of
    today (UTC). Default ``grace_days=1`` means today or yesterday —
    this is the recommended setting because POE2Scout publishes the
    current UTC day's candle only after the day rolls over, so during
    most of the current day yesterday's candle is the freshest possible.

    Args:
        latest_date_str: The latest ``date`` (YYYY-MM-DD) persisted for
            the item, as returned by
            ``HistoricalStore.read_daily_stats_latest_date``. None when
            no rows exist → returns False (not fresh, must fetch).
        now: Override for "now" (UTC). Defaults to
            ``datetime.now(timezone.utc)``. Used in tests for
            deterministic behavior.
        grace_days: How many days back counts as fresh. Default 1
            (today + yesterday). 0 = today only (strict).

    Returns:
        True when ``latest_date_str`` parses as a date and is within
        ``grace_days`` days of today. False when ``latest_date_str`` is
        None, unparseable, or older than the grace window.
    """
    if not latest_date_str:
        return False

    try:
        latest = datetime.strptime(latest_date_str, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return False

    today = (now or datetime.now(timezone.utc)).date()
    age_days = (today - latest).days
    return 0 <= age_days <= grace_days


# ---------------------------------------------------------------------------
# 3. pick_top_items_by_volume — scheduler background-refresh item picker
# ---------------------------------------------------------------------------

def pick_top_items_by_volume(
    snapshot: DataSnapshot,
    n: int = DEFAULT_TOP_N_ITEMS,
) -> list[tuple[int, str]]:
    """Return the top-N ``(item_id, api_id)`` pairs by 24h trade volume.

    For each currency appearing in ``snapshot.exchange_rates``, sum the
    ``volume_traded`` across all pairs involving that currency (as either
    ``currency_from`` or ``currency_to``). Rank descending, take the
    top-N, and look up each currency's ``item_id`` from
    ``snapshot.currency_metadata`` (matching by ``api_id``).

    Items with no ``item_id`` (item_id == 0) are skipped — they cannot
    be queried via the POE2Scout DailyStatsHistory endpoint (which
    takes a numeric ItemId in the URL path).

    Args:
        snapshot: The current DataSnapshot (built by SnapshotManager).
        n: Maximum number of items to return. Default 50. n <= 0 returns
            an empty list.

    Returns:
        List of ``(item_id, api_id)`` tuples, highest-volume first.
        ``api_id`` is the original-case api_id from currency_metadata
        (NOT lowercased — matches the convention used by
        ``exchange_rates`` keys). Empty when the snapshot has no
        exchange rates or no currency_metadata.
    """
    if n <= 0:
        return []

    rates = snapshot.exchange_rates
    if not rates:
        return []

    # Sum volume_traded per currency (as both from + to).
    volume_by_currency: dict[str, float] = {}
    for _key, rate in rates.items():
        vol = float(rate.volume_traded) if rate.volume_traded else 0.0
        if rate.currency_from:
            volume_by_currency[rate.currency_from] = (
                volume_by_currency.get(rate.currency_from, 0.0) + vol
            )
        if rate.currency_to:
            volume_by_currency[rate.currency_to] = (
                volume_by_currency.get(rate.currency_to, 0.0) + vol
            )

    if not volume_by_currency:
        return []

    # Build api_id → (item_id, original-case api_id) lookup from
    # currency_metadata. The metadata stores original-case api_id; the
    # volume_by_currency keys are also original-case (from exchange_rates).
    # Match directly first, then case-insensitively as a fallback.
    meta_by_api_id: dict[str, tuple[int, str]] = {}
    meta_by_api_id_lower: dict[str, tuple[int, str]] = {}
    for meta in snapshot.currency_metadata:
        if not meta.api_id or not meta.item_id:
            continue
        entry = (int(meta.item_id), meta.api_id)
        meta_by_api_id[meta.api_id] = entry
        meta_by_api_id_lower[meta.api_id.lower()] = entry

    # Rank currencies by volume descending, resolve to item_id, take top-N.
    ranked = sorted(
        volume_by_currency.items(),
        key=lambda kv: kv[1],
        reverse=True,
    )

    result: list[tuple[int, str]] = []
    seen_item_ids: set[int] = set()
    for api_id, _vol in ranked:
        entry = meta_by_api_id.get(api_id) or meta_by_api_id_lower.get(api_id.lower())
        if entry is None:
            continue
        item_id, orig_api_id = entry
        if item_id <= 0 or item_id in seen_item_ids:
            continue
        result.append((item_id, orig_api_id))
        seen_item_ids.add(item_id)
        if len(result) >= n:
            break

    return result
