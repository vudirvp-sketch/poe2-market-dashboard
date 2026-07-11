"""
Market Spreads persistence helper (TD-4, iter 128).

Implements the per-pair spread computation that ``routes_arbitrage.py`` has
been doing inline since iter 66, but as a **pure function** that the
``SnapshotManager._refresh()`` flow can call to persist spread metrics into
the new ``market_spreads`` SQLite table. The persisted rows let a future
backtest model slippage / spread evolution over time (TD-4 backtest window).

Design doc: ``docs/design/TD-3-4-5-9-persistence-gaps-design.md`` §4 (Option B
schema) + §5.1 (write path) + §9 Phase 2 (file-by-file plan) + §10 Q2
(open question — default: persist only direct pairs, BFS factor = 1.0).

What this module computes
-------------------------
Given a ``DataSnapshot`` + ``AppConfig``, iterate over
``snapshot.exchange_rates`` (direct SnapshotPairs only — no BFS-derived
pairs) and for each pair compute:

- ``pair_key``            — ``f"{currency_from}/{currency_to}"`` (NOT sorted;
                            the spread is directional, A/B ≠ B/A).
- ``raw_rate``            — ``rate.raw_rate`` (how many `to` per 1 `from`).
- ``volume_24h``          — ``rate.volume_traded``.
- ``market_spread``       — ``max(min_market_spread,
                            min(max_market_spread,
                                liquidity_spread + vol_spread))``.
                            ``liquidity_spread`` comes from the same
                            volume/highest_stock piecewise formula as
                            ``routes_arbitrage.py:275-285``.
- ``total_spread``        — ``min(max_total_spread,
                            market_spread * (1 + momentum_factor))``.
- ``momentum_factor``     — ``min(|exp(momentum * 24) - 1|,
                            max_momentum_factor)``. ``0.0`` when fewer
                            than 2 price points or momentum is zero.
- ``bfs_widening_factor`` — always ``1.0`` for direct pairs (design doc
                            §10 Q2 default — persisting BFS-derived pairs
                            would inflate the table 5-10×).

This mirrors the spread block in ``routes_arbitrage.py:268-308`` verbatim.
The duplication is intentional: extracting the spread computation out of
the ProcessPoolExecutor-bound ``_build_flip_opportunities_sync`` would be
a risky refactor of a 1249-line hot path. Keeping the formula in a pure
function here lets the snapshot manager persist spreads without touching
the flip pipeline. If the two formulas ever drift, the
``test_market_spreads.py::TestFormulaParity`` test will catch it.

This module is pure-function: it takes a ``DataSnapshot`` + ``AppConfig``
and returns a ``list[dict]``. The snapshot manager
(``data_snapshot.py:SnapshotManager._refresh``) calls it and writes the
result via ``HistoricalStore.write_market_spreads_batch``. The route
handler (``routes_market_spreads.py``) reads back via
``HistoricalStore.read_market_spreads`` — it does NOT call this module
directly.

Open questions (design doc §10)
-------------------------------
- Q2 (BFS pairs): default is to persist only direct pairs (BFS factor = 1.0).
  If a future iter needs BFS pairs for slippage modeling, extend this module
  to also emit rows with ``bfs_widening_factor > 1.0`` and add a
  ``include_bfs: bool`` parameter.
- Q4 (cadence): the 5-min bucket matches POE2Scout's snapshot cadence
  (assumed). If POE2Scout updates faster than 5 min, we're losing data —
  investigate during Phase 3 implementation.
"""

from __future__ import annotations

import logging
import math
from typing import Any

from backend.api.data_snapshot import DataSnapshot
from backend.config import AppConfig
from backend.economy.momentum import PriceMomentumTracker
from backend.models.currency import PricePoint

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Tunable constants — kept here rather than in config.yaml because they are
# analysis thresholds, not deployment parameters. The actual spread_model
# values come from config.yaml scoring.spread_model (same source as
# routes_arbitrage.py).
# ---------------------------------------------------------------------------

DEFAULT_BFS_WIDENING_FACTOR: float = 1.0
"""For direct pairs (BFS factor = 1.0). See design doc §10 Q2."""

_MOMENTUM_WINDOW_SIZE: int = 24
"""Window size for PriceMomentumTracker (matches routes_arbitrage.py:253)."""


def _compute_liquidity_spread(
    volume: float,
    highest_stock: float,
    spread_model: Any,
) -> float:
    """Compute the liquidity component of the market spread.

    Mirrors ``routes_arbitrage.py:275-285`` verbatim. Three branches:
    (a) volume > 0 AND highest_stock > 0 → ``both`` branch,
    (b) volume > 0 only → ``volume_only`` branch,
    (c) no volume → ``no_volume`` branch.
    """
    if volume > 0 and highest_stock > 0:
        liquidity_score = math.log1p(volume) * math.log1p(highest_stock)
        return spread_model.liquidity_base_spread_both / (
            1.0 + liquidity_score / spread_model.liquidity_score_scale
        )
    if volume > 0:
        return spread_model.liquidity_base_spread_volume_only / (
            1.0 + math.log1p(volume) / spread_model.volume_log_scale
        )
    return spread_model.liquidity_base_spread_no_volume


def _compute_momentum_factor(
    history: list[PricePoint],
    spread_model: Any,
) -> tuple[float, float]:
    """Compute the momentum factor + volatility for a currency.

    Mirrors ``routes_arbitrage.py:247-258, 301-306``. Returns
    ``(momentum_factor, volatility)`` where ``momentum_factor`` is
    ``min(|exp(momentum * 24) - 1|, max_momentum_factor)`` and
    ``volatility`` is the PriceMomentumTracker volatility (used for the
    vol_spread component of market_spread).

    Returns ``(0.0, min_volatility)`` when fewer than 2 price points or
    when momentum is zero — matches routes_arbitrage.py behavior.
    """
    if not history or len(history) < 2:
        # PriceMomentumTracker returns min_volatility when < 2 prices;
        # momentum_24h_raw stays 0.0 (no momentum).
        tracker = PriceMomentumTracker(window_size=_MOMENTUM_WINDOW_SIZE, history=history or [])
        result = tracker.compute()
        return 0.0, result.volatility

    tracker = PriceMomentumTracker(window_size=_MOMENTUM_WINDOW_SIZE, history=history)
    for price_point in history:
        tracker.update(price_point.price)
    result = tracker.compute()

    momentum_24h_raw = 0.0
    if result.momentum != 0:
        momentum_24h_raw = abs(math.exp(result.momentum * 24) - 1)

    momentum_factor = min(momentum_24h_raw, spread_model.max_momentum_factor)
    return momentum_factor, result.volatility


def compute_market_spreads(
    snapshot: DataSnapshot,
    config: AppConfig,
) -> list[dict]:
    """Compute per-pair spread metrics for persistence.

    Iterates over ``snapshot.exchange_rates`` (direct SnapshotPairs only —
    no BFS-derived pairs, per design doc §10 Q2 default). For each pair,
    builds a dict suitable for ``HistoricalStore.write_market_spreads_batch``.

    The function never raises — a failure on one pair (e.g. missing price
    history) logs a debug message and skips that pair. Returns an empty
    list when ``snapshot.exchange_rates`` is empty.

    Args:
        snapshot: The current DataSnapshot (built by SnapshotManager._refresh).
        config: AppConfig (spread_model values read from
            ``config.scoring.spread_model``).

    Returns:
        List of dicts with keys: ``pair_key``, ``currency_from``,
        ``currency_to``, ``raw_rate``, ``volume_24h``, ``market_spread``,
        ``total_spread``, ``momentum_factor``, ``bfs_widening_factor``.
    """
    rates = snapshot.exchange_rates
    if not rates:
        return []

    spread_model = config.scoring.spread_model
    price_histories = snapshot.price_histories

    # Build a lookup that includes both lowercase + original-case api_ids,
    # mirroring routes_arbitrage.py:180-189. Price histories from ByCategory
    # are keyed by lowercase api_id; exchange_rates use the original case.
    history_by_api_id: dict[str, list[PricePoint]] = dict(price_histories)
    for api_id_lower, points in list(price_histories.items()):
        # Try to find the original-case api_id via currencies lookup
        curr = snapshot.currencies.get(api_id_lower)
        if curr:
            orig_id = curr.get("api_id", "")
            if orig_id and orig_id != api_id_lower:
                history_by_api_id.setdefault(orig_id, points)

    spreads: list[dict] = []
    skipped_no_history = 0

    for _key, rate in rates.items():
        currency_from = rate.currency_from
        currency_to = rate.currency_to
        if not currency_from or not currency_to:
            continue

        # Look up price history for currency_from (original-case first,
        # then lowercase fallback — matches routes_arbitrage.py:250-252).
        history = history_by_api_id.get(currency_from)
        if history is None:
            history = history_by_api_id.get(currency_from.lower())
        if history is None:
            skipped_no_history += 1
            # Still emit a row — the spread formula has a no-volume branch
            # that produces a valid (if wider) spread. This matches
            # routes_arbitrage.py which does NOT skip pairs without history.
            history = []

        mid_price = rate.raw_rate
        volume = float(rate.volume_traded)
        highest_stock = float(rate.highest_stock)

        # --- Spread formula (mirrors routes_arbitrage.py:274-308) ---
        liquidity_spread = _compute_liquidity_spread(volume, highest_stock, spread_model)

        momentum_factor, volatility = _compute_momentum_factor(history, spread_model)
        vol_spread = volatility * spread_model.volatility_weight

        market_spread = liquidity_spread + vol_spread
        # Direct pair → BFS factor = 1.0 (no widening). See design doc §10 Q2.
        bfs_widening = DEFAULT_BFS_WIDENING_FACTOR
        market_spread *= bfs_widening
        market_spread = max(
            spread_model.min_market_spread,
            min(spread_model.max_market_spread, market_spread),
        )

        total_spread = market_spread * (1.0 + momentum_factor)
        total_spread = min(total_spread, spread_model.max_total_spread)

        spreads.append({
            "pair_key": f"{currency_from}/{currency_to}",
            "currency_from": currency_from,
            "currency_to": currency_to,
            "raw_rate": float(mid_price),
            "volume_24h": volume,
            "market_spread": float(market_spread),
            "total_spread": float(total_spread),
            "momentum_factor": float(momentum_factor),
            "bfs_widening_factor": float(bfs_widening),
        })

    if skipped_no_history > 0:
        logger.debug(
            "compute_market_spreads: %d/%d pairs had no price history for "
            "currency_from — emitted rows with no-volume branch spread",
            skipped_no_history, len(spreads),
        )

    return spreads
