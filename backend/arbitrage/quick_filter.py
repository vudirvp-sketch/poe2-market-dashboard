"""
Quick Filter — pre-filtering arbitrage opportunities before scoring.

Applied before any scoring. Opportunities that fail any criterion are removed entirely.

Filter criteria (all configurable):
1. Volume floor: volume_24h < config.min_volume (default 50)
2. Max spread: spread > config.max_spread (default 0.15)
3. Volatility cap: volatility > config.max_volatility (default 0.4)
4. Cluster-based exclusion: volatile_illiquid cluster excluded if configured
"""

from __future__ import annotations

import logging

from backend.config import AppConfig, get_settings
from backend.models.currency import ClusterLabel, FlipOpportunity, LeaguePhase

logger = logging.getLogger(__name__)


def quick_filter(
    opportunity: FlipOpportunity,
    phase: LeaguePhase,
    config: AppConfig | None = None,
    # Deprecated: gold_fee_fraction is no longer used. Kept for API
    # compatibility with callers that still pass it positionally.
    gold_fee_fraction: float = 0.0,
) -> bool:
    """Determine if an opportunity passes the quick filter.

    Returns True if the opportunity should be kept, False if it should be removed.

    Args:
        opportunity: The flip opportunity to evaluate
        phase: Current league phase
        config: Application configuration (uses defaults if None)
        gold_fee_fraction: DEPRECATED — no longer used. The max spread
            threshold is now a fixed configurable value (config.filters.max_spread).
    """
    cfg = config or get_settings()

    # 1. Volume floor
    if opportunity.volume_24h < cfg.filters.min_volume_24h:
        logger.debug(
            "Filtered out %s: volume %.0f < min %d",
            opportunity.currency, opportunity.volume_24h, cfg.filters.min_volume_24h,
        )
        return False

    # 2. Max spread — fixed configurable threshold
    # Previously: max_allowed_spread = 2 * gold_fee_fraction + 0.05
    # Since gold_fee_fraction is now always 0, the formula simplified to a
    # fixed constant. The new default (0.15 = 15%) gives comparable filtering
    # to the old formula with a typical 5% gold fee (0.10 + 0.05).
    if opportunity.mid_price <= 0:
        return False

    spread = (opportunity.ask - opportunity.bid) / opportunity.mid_price
    max_allowed_spread = cfg.filters.max_spread

    if spread > max_allowed_spread:
        logger.debug(
            "Filtered out %s: spread %.4f > max %.4f",
            opportunity.currency, spread, max_allowed_spread,
        )
        return False

    # 3. Volatility cap
    if opportunity.volatility > cfg.filters.max_volatility:
        logger.debug(
            "Filtered out %s: volatility %.4f > max %.4f",
            opportunity.currency, opportunity.volatility, cfg.filters.max_volatility,
        )
        return False

    # 4. Cluster-based exclusion
    if opportunity.cluster == ClusterLabel.VOLATILE_ILLIQUID and cfg.filters.exclude_volatile_illiquid:
        logger.debug(
            "Filtered out %s: volatile_illiquid cluster excluded",
            opportunity.currency,
        )
        return False

    return True
