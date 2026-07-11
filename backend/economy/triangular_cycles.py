"""
Triangular Cycles persistence helper (TD-3, iter 129).

Implements the snapshot → cycles → persistence pipeline that
``routes_arbitrage.py:get_triangular_arbitrage`` has been computing on
demand per request, but as a **pure helper** that the
``SnapshotManager._refresh()`` flow can call to persist detected cycles
into the new ``triangular_cycles`` SQLite table. The persisted rows let a
future backtest model per-cycle profit / executable_estimate / confidence
evolution over time (TD-3 backtest window).

Design doc: ``docs/design/TD-3-4-5-9-persistence-gaps-design.md`` §4
(Option B schema) + §5.1 (write path) + §9 Phase 3 (file-by-file plan)
+ §10 Q1 (open question — default: persist only profitable cycles).

What this module computes
-------------------------
Given a ``DataSnapshot`` + ``AppConfig``:

1. Build ``rates_for_bf`` and ``pair_volumes`` from
   ``snapshot.exchange_rates`` (mirrors ``routes_arbitrage.py:829-848``
   verbatim).
2. Call ``find_triangular_arbitrage()`` with the default
   ``min_profit_pct=1.0`` and ``cross_rate_threshold_pct=7.0`` (matches
   the live ``/api/v1/arbitrage/triangular`` route so the persisted
   cycles are a strict subset of what the route returns).
3. For each detected cycle, emit a dict with:

- ``cycle_key``            — sorted unique currencies joined with ``->``
                            (e.g. ``"divine->exalted->mirror"``).
                            Collapses the same cycle in different
                            rotations to one key (design doc §4.3 +
                            §8.4). NOT directional — A→B→C→A and
                            A→C→B→A share the same key.
- ``cycle_currencies``     — JSON array of the cycle traversal order
                            (closing node stripped). Example:
                            ``'["exalted","divine","mirror"]'``. Lets a
                            future analyst recover the exact rotation
                            that was profitable.
- ``raw_profit_pct``       — Bellman-Ford continuous profit (float),
                            BEFORE integer quantization. Matches
                            ``TriangularOpportunity.continuous_profit_pct``.
- ``executable_estimate``  — min profitable starting amount (int),
                            from binary search. 0 when the integer
                            simulation could not find a profitable
                            start.
- ``executable_profit``    — final amount after integer simulation
                            (int). Profit = executable_profit -
                            executable_estimate.
- ``confidence``           — ``_compute_confidence()`` score (0..1),
                            based on data freshness + volume + cycle
                            length.
- ``snapshot_age_sec``     — seconds between snapshot.fetched_at and
                            now (for staleness filtering). 0 when
                            fetched_at is missing.

This module is pure-function: it takes a ``DataSnapshot`` + ``AppConfig``
and returns a ``list[dict]``. The snapshot manager
(``data_snapshot.py:SnapshotManager._refresh``) calls it and writes the
result via ``HistoricalStore.write_triangular_cycles_batch``. The route
handler (``routes_arbitrage.py:get_triangular_arbitrage_history``) reads
back via ``HistoricalStore.read_triangular_cycles`` — it does NOT call
this module directly.

Open questions (design doc §10)
-------------------------------
- Q1 (None-profit cycles): default is to persist only profitable cycles
  (matches the existing ``find_triangular_arbitrage`` filter at
  ``min_profit_pct=1.0``). If a future iter needs hit-rate analysis,
  lower ``min_profit_pct`` to 0.0 here and the table will start
  capturing failures too.
- Q4 (cadence): same 5-min bucket as market_spreads. If the live
  ``/triangular`` route is called more frequently than 5 min, some
  short-lived cycles will be missed by the persistence path — but the
  live route still serves them from pipeline_cache.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

from backend.api.data_snapshot import DataSnapshot
from backend.arbitrage.triangular import find_triangular_arbitrage
from backend.config import AppConfig

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Tunable constants — kept here rather than in config.yaml because they
# mirror the live /triangular route's hardcoded defaults (see
# routes_arbitrage.py:794 + 867). If the route's defaults change, update
# these to keep parity.
# ---------------------------------------------------------------------------

DEFAULT_MIN_PROFIT_PCT: float = 1.0
"""Matches ``routes_arbitrage.py:794`` default ``Query(1.0, ...)``."""

DEFAULT_CROSS_RATE_THRESHOLD_PCT: float = 7.0
"""Matches ``routes_arbitrage.py:867`` hardcoded ``cross_rate_threshold_pct=7.0``."""


def _build_cycle_key(cycle: list[str]) -> str:
    """Build a sorted-unique cycle key for dedup/grouping.

    Per design doc §4.3: "Sorted JSON array joined with ``->``. Example:
    ``divine->exalted->mirror`` (alphabetical sort). This makes the same
    cycle in different rotations (A→B→C vs A→C→B) collapse to the same
    key — important for backtest grouping."

    The input ``cycle`` may include the closing node (e.g.
    ``["A","B","C","A"]``); we deduplicate via ``set()`` so the closer
    doesn't double-count.
    """
    unique_currencies = sorted(set(cycle))
    return "->".join(unique_currencies)


def _strip_closing_node(cycle: list[str]) -> list[str]:
    """Strip the duplicate closing node if present.

    ``find_triangular_arbitrage`` returns cycles like
    ``["chaos","divine","exalted","chaos"]`` (the last element repeats
    the first to "close" the cycle visually). For the persisted
    ``cycle_currencies`` JSON we want only the unique traversal order
    (``["chaos","divine","exalted"]``) so a future analyst can recover
    the rotation without parsing the closer.
    """
    if len(cycle) > 1 and cycle[0] == cycle[-1]:
        return cycle[:-1]
    return list(cycle)


def _safe_snapshot_age_sec(snapshot_time: datetime | None) -> int:
    """Compute snapshot age in seconds, defensive against naive datetime.

    Returns 0 when ``snapshot_time`` is None (no fetched_at on the
    snapshot — rare but possible during early init).

    Naive datetimes (``tzinfo is None``) are interpreted as system local
    time and converted to UTC via ``astimezone(timezone.utc)``. This
    matches Python's standard semantics for naive datetimes and correctly
    handles the most common source — ``datetime.now()`` without tz, which
    returns local time. Using ``replace(tzinfo=timezone.utc)`` instead
    would just relabel the wall-clock value as UTC without converting,
    producing a future timestamp in non-UTC timezones and clamping the
    age to 0 (see KI-26).
    """
    if snapshot_time is None:
        return 0
    now = datetime.now(timezone.utc)
    if snapshot_time.tzinfo is None:
        snapshot_time = snapshot_time.astimezone(timezone.utc)
    return max(0, int((now - snapshot_time).total_seconds()))


async def compute_triangular_cycles(
    snapshot: DataSnapshot,
    config: AppConfig,
    *,
    min_profit_pct: float = DEFAULT_MIN_PROFIT_PCT,
    cross_rate_threshold_pct: float = DEFAULT_CROSS_RATE_THRESHOLD_PCT,
) -> list[dict]:
    """Compute triangular arbitrage cycles for persistence.

    Iterates over ``snapshot.exchange_rates`` to build the rates_dict +
    pair_volumes (mirrors ``routes_arbitrage.py:829-848`` verbatim), then
    calls ``find_triangular_arbitrage()`` to detect cycles. Returns a
    list of dicts suitable for ``HistoricalStore.write_triangular_cycles_batch``.

    The function never raises — a failure in ``find_triangular_arbitrage``
    (including its 90s timeout) logs a warning and returns an empty list.
    This matches the design doc §5.1 invariant: persistence MUST NOT
    block the snapshot publish.

    Args:
        snapshot: The current DataSnapshot (built by SnapshotManager._refresh).
        config: AppConfig (currently unused — reserved for future
            ``triangular.min_profit_pct`` / ``cross_rate_threshold_pct``
            config keys. Defaults are hardcoded to match the live route
            so persisted cycles are a strict subset of what the route
            returns).
        min_profit_pct: Minimum profit % to report (default 1.0, matches
            ``routes_arbitrage.py:794``).
        cross_rate_threshold_pct: Cross-rate divergence threshold
            (default 7.0, matches ``routes_arbitrage.py:867``).

    Returns:
        List of dicts with keys: ``cycle_key``, ``cycle_currencies``,
        ``raw_profit_pct``, ``executable_estimate``, ``executable_profit``,
        ``confidence``, ``snapshot_age_sec``. Empty when no cycles are
        detected or when the snapshot has no exchange rates.
    """
    rates = snapshot.exchange_rates
    if not rates:
        return []

    # Build rates_dict + pair_volumes (mirrors routes_arbitrage.py:829-848)
    rates_for_bf: dict[tuple[str, str], float] = {}
    pair_volumes: dict[tuple[str, str], float] = {}
    for _key, rate in rates.items():
        rates_for_bf[(rate.currency_from, rate.currency_to)] = rate.raw_rate
        pair_volumes[(rate.currency_from, rate.currency_to)] = (
            float(rate.volume_traded) if rate.volume_traded else 0.0
        )

    snapshot_time = snapshot.fetched_at or datetime.now(timezone.utc)

    try:
        result = await find_triangular_arbitrage(
            rates=rates_for_bf,
            min_profit_pct=min_profit_pct,
            pair_volumes=pair_volumes,
            snapshot_time=snapshot_time,
            cross_rate_threshold_pct=cross_rate_threshold_pct,
        )
    except Exception as e:
        logger.warning(
            "TD-3: find_triangular_arbitrage failed during snapshot "
            "refresh (non-fatal, returning empty cycles list): %s", e,
        )
        return []

    opportunities = result.opportunities
    if not opportunities:
        return []

    snapshot_age_sec = _safe_snapshot_age_sec(snapshot_time)

    cycles: list[dict] = []
    for opp in opportunities:
        cycle = opp.cycle
        if not cycle:
            continue

        # executable_profit = final amount after integer simulation.
        # integer_simulation is the list of amounts at each step, with
        # the final element being the closing amount. When the
        # simulation didn't run (min_starting_amount == 0), default to 0.
        if opp.integer_simulation and len(opp.integer_simulation) > 0:
            executable_profit = int(opp.integer_simulation[-1])
        else:
            executable_profit = 0

        cycles.append({
            "cycle_key": _build_cycle_key(cycle),
            "cycle_currencies": json.dumps(_strip_closing_node(cycle)),
            "raw_profit_pct": float(opp.continuous_profit_pct),
            "executable_estimate": int(opp.min_starting_amount),
            "executable_profit": executable_profit,
            "confidence": float(opp.confidence),
            "snapshot_age_sec": int(snapshot_age_sec),
        })

    if cycles:
        logger.debug(
            "compute_triangular_cycles: %d cycles detected (min_profit_pct=%.2f, "
            "cross_rate_threshold=%.1f%%)",
            len(cycles), min_profit_pct, cross_rate_threshold_pct,
        )

    return cycles
