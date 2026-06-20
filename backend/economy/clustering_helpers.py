"""Shared clustering helpers — deduplicated from routes_prices and routes_arbitrage.

P1-4 (iter 63): Both `routes_prices.py` and `routes_arbitrage.py` had ~80 lines
of near-identical code for preparing clustering data and running CurrencyClusterer.
This module provides:

  - `prepare_clustering_data()` — builds the 4 dicts (cluster_price_histories,
    cluster_volumes, cluster_prices_now, cluster_prices_24h_ago) from exchange
    rates and currency data. Uses `find_price_24h_ago()` for correct 24h-ago
    price lookup (fixes the `prices[0]` bug in routes_prices.py).

  - `run_clustering_sync()` — CPU-bound clustering function designed for
    ProcessPoolExecutor. Takes only picklable data and returns a plain
    string dict (currency_name → cluster_label string).

Cache key convention: Both routes now share a single cache key `"cluster_labels"`.
Previously routes_prices wrote `"price_cluster_labels"` and routes_arbitrage
read `"arbitrage_cluster_labels"` (which nobody wrote to — a cross-cache bug).
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Mapping

from backend.economy.pricing import find_price_24h_ago
from backend.models.currency import ClusterLabel

logger = logging.getLogger(__name__)

# Single shared cache key — both routes read/write the same key.
CLUSTER_LABELS_CACHE_KEY = "cluster_labels"


# ---------------------------------------------------------------------------
# Data preparation
# ---------------------------------------------------------------------------

def prepare_clustering_data(
    rates: Mapping[str, object],
    currencies: Mapping[str, dict],
    prices_in_base: Mapping[str, float],
    price_histories_prices: Mapping[str, list[float]] | None = None,
    price_histories_timestamped: Mapping[str, list[tuple[datetime, float]]] | None = None,
) -> tuple[
    dict[str, list[float]],
    dict[str, float],
    dict[str, float],
    dict[str, float],
]:
    """Build clustering input dicts from exchange rates and currency data.

    This is the shared implementation of what was previously duplicated between
    `routes_prices.py` (lines 203-244) and `routes_arbitrage.py` (lines 175-204).

    Args:
        rates: Mapping from pair key → object with `currency_from`,
            `currency_to`, `volume_traded` attributes (e.g. ExchangeRate).
        currencies: Mapping from api_id_lower → raw currency dict with
            optional keys: `api_id`, `price_logs`.
        prices_in_base: Fallback price mapping for currencies without history.
        price_histories_prices: Optional pre-extracted price histories
            (api_id → [price]). If provided, used instead of extracting from
            `currencies[].price_logs`. This is the pattern used by
            routes_arbitrage (FlipComputeBundle).
        price_histories_timestamped: Optional pre-extracted timestamped
            histories (api_id → [(timestamp, price)]). Used for correct
            24h-ago lookup via `find_price_24h_ago()`. Required for accurate
            24h-ago prices; falls back to history[-2] if absent.

    Returns:
        Tuple of (cluster_price_histories, cluster_volumes,
        cluster_prices_now, cluster_prices_24h_ago).
    """
    cluster_price_histories: dict[str, list[float]] = {}
    cluster_volumes: dict[str, float] = {}
    cluster_prices_now: dict[str, float] = {}
    cluster_prices_24h_ago: dict[str, float] = {}

    # Accumulate currencies from rates and track max volume
    for key, rate in rates.items():
        for curr in (rate.currency_from, rate.currency_to):
            if curr not in cluster_price_histories:
                # Initialize with pre-extracted history or empty
                if price_histories_prices is not None:
                    cluster_price_histories[curr] = list(price_histories_prices.get(curr, []))
                else:
                    cluster_price_histories[curr] = []
                cluster_volumes[curr] = 0.0
                cluster_prices_now[curr] = 0.0
                cluster_prices_24h_ago[curr] = 0.0

        for curr in (rate.currency_from, rate.currency_to):
            vol = float(rate.volume_traded)
            if vol > cluster_volumes.get(curr, 0):
                cluster_volumes[curr] = vol

    if price_histories_prices is not None:
        # routes_arbitrage path — data already extracted into plain dicts.
        for curr, history in cluster_price_histories.items():
            if history:
                cluster_prices_now[curr] = history[-1]
                # Correct 24h-ago lookup using timestamps
                ts_history = (
                    list(price_histories_timestamped.get(curr, []))
                    if price_histories_timestamped is not None
                    else []
                )
                if ts_history:
                    price_24h = find_price_24h_ago(ts_history)
                    if price_24h is not None:
                        cluster_prices_24h_ago[curr] = price_24h
                    else:
                        # Fallback: second-to-last or last price
                        cluster_prices_24h_ago[curr] = (
                            history[-2] if len(history) >= 2 else history[-1]
                        )
                else:
                    # No timestamped data — approximate from price array
                    cluster_prices_24h_ago[curr] = (
                        history[-2] if len(history) >= 2 else history[-1]
                    )
            else:
                cluster_prices_now[curr] = prices_in_base.get(curr, 0)
                cluster_prices_24h_ago[curr] = prices_in_base.get(curr, 0)
    else:
        # routes_prices path — extract from snapshot.currencies price_logs.
        for api_id_lower, curr in currencies.items():
            orig_id = curr.get("api_id", api_id_lower)
            # Match against both the lowercase key and the original-case api_id
            match_id = None
            if orig_id in cluster_price_histories:
                match_id = orig_id
            elif api_id_lower in cluster_price_histories:
                match_id = api_id_lower
            if match_id is None:
                continue
            price_logs = curr.get("price_logs", [])
            if not price_logs:
                continue

            sorted_logs = sorted(
                [l for l in price_logs if l.get("price") is not None and l.get("time") is not None],
                key=lambda l: l["time"],
            )
            prices = [l["price"] for l in sorted_logs]
            if len(prices) < 2:
                continue

            cluster_price_histories[match_id] = prices
            cluster_prices_now[match_id] = prices[-1]

            # Correct 24h-ago lookup using timestamps
            ts_history = [(l["time"], l["price"]) for l in sorted_logs]
            price_24h = find_price_24h_ago(ts_history)
            if price_24h is not None:
                cluster_prices_24h_ago[match_id] = price_24h
            else:
                # Fallback: second-to-last price (better than prices[0])
                cluster_prices_24h_ago[match_id] = prices[-2] if len(prices) >= 2 else prices[-1]

        # Fill remaining prices from prices_in_base fallback
        for curr in cluster_price_histories:
            if cluster_prices_now[curr] == 0:
                cluster_prices_now[curr] = prices_in_base.get(curr, 0)
            if cluster_prices_24h_ago[curr] == 0:
                cluster_prices_24h_ago[curr] = prices_in_base.get(curr, 0)

    return cluster_price_histories, cluster_volumes, cluster_prices_now, cluster_prices_24h_ago


# ---------------------------------------------------------------------------
# CPU-bound clustering — safe for ProcessPoolExecutor
# ---------------------------------------------------------------------------

def run_clustering_sync(
    config,
    cluster_price_histories: dict[str, list[float]],
    cluster_volumes: dict[str, float],
    cluster_prices_now: dict[str, float],
    cluster_prices_24h_ago: dict[str, float],
) -> dict[str, str]:
    """CPU-bound clustering — runs in ProcessPoolExecutor.

    Returns a dict mapping currency_name → cluster_label string.
    This function receives only picklable data (plain dicts, no objects
    holding sqlite3.Connection) so it can safely run in a subprocess.

    Args:
        config: AppConfig instance (or None to use get_settings() defaults).
        cluster_price_histories: Currency → list of historical prices.
        cluster_volumes: Currency → 24h volume.
        cluster_prices_now: Currency → current price.
        cluster_prices_24h_ago: Currency → price ~24h ago.

    Returns:
        Dict mapping currency name → cluster label string
        (e.g. {"divine": "stable", "chaos": "moderate"}).
        Returns empty dict if fewer than 3 currencies.
    """
    from backend.predictors.clustering import CurrencyClusterer

    if len(cluster_price_histories) < 3:
        logger.warning(
            "Only %d currencies for clustering (need >=3), skipping",
            len(cluster_price_histories),
        )
        return {}

    if config is not None:
        clusterer = CurrencyClusterer(config)
    else:
        clusterer = CurrencyClusterer()

    output = clusterer.fit(
        cluster_price_histories, cluster_volumes,
        cluster_prices_now, cluster_prices_24h_ago,
    )
    result = {c.currency: c.cluster.value for c in output.clusters}
    logger.info("Clustering completed: %d currencies assigned", len(result))
    return result
