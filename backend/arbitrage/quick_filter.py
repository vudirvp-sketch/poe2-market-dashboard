"""
Quick Filter — pre-filtering arbitrage opportunities before scoring.

Applied before any scoring. Opportunities that fail any criterion are removed entirely.

From Implementation Spec §5.1:
Filter criteria (all configurable):
1. Volume floor: volume_24h < config.min_volume (default 50)
2. Max spread as function of fee: spread > 2 * gold_fee_fraction + 0.05
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
    gold_fee_fraction: float,
    config: AppConfig | None = None,
) -> bool:
    """Determine if an opportunity passes the quick filter.

    Returns True if the opportunity should be kept, False if it should be removed.

    Args:
        opportunity: The flip opportunity to evaluate
        phase: Current league phase
        gold_fee_fraction: The direction-dependent gold fee fraction
        config: Application configuration (uses defaults if None)
    """
    cfg = config or get_settings()

    # 1. Volume floor
    if opportunity.volume_24h < cfg.filters.min_volume_24h:
        logger.debug(
            "Filtered out %s: volume %.0f < min %d",
            opportunity.currency, opportunity.volume_24h, cfg.filters.min_volume_24h,
        )
        return False

    # 2. Max spread as function of fee (not a fixed constant)
    # From §5.1: max_allowed_spread = 2 * gold_fee_fraction + 0.05
    if opportunity.mid_price <= 0:
        return False

    spread = (opportunity.ask - opportunity.bid) / opportunity.mid_price
    max_allowed_spread = 2 * gold_fee_fraction + 0.05

    if spread > max_allowed_spread:
        logger.debug(
            "Filtered out %s: spread %.4f > max %.4f (fee_frac=%.4f)",
            opportunity.currency, spread, max_allowed_spread, gold_fee_fraction,
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
