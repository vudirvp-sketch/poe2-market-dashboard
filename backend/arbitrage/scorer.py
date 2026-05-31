"""
Opportunity Scoring — expected profit scoring for flip opportunities.

From PoE2_Flipper_Canonical_Formulas.md §7:

The score is based on one concept with clear financial meaning:
expected profit per trade after fees, scaled by probability of fill.

Formula (from §7.5):
    expected_profit = spread_after_fees * fill_probability
    score = expected_profit * momentum_penalty * vol_penalty * phase_multiplier
    score = clamp(score, 0.0, 1.0)

Where:
- spread_after_fees = (ask - bid) / mid_price - gold_fee_fraction
- fill_probability = log1p(volume_24h) / log1p(max_volume)
- momentum_penalty: filter-style (0.5 if very negative, 0.8 if slightly negative, 1.0 if positive)
- vol_penalty = 1.0 / (1.0 + (volatility / vol_reference)^2)
- phase_multiplier: EARLY=1.2, MID=1.0, LATE=0.9

NOTE ON score=0 FOR MOST PAIRS:
    In PoE2, gold fees are very high (1–16% of trade value for common currencies
    like Chaos/Divine/Exalted). This means spread_after_fees is almost always
    negative, and the scorer correctly returns 0 — there is genuinely no
    profitable flip after fees.  This is NOT a bug in the formula; it reflects
    real market conditions.  A frontend workaround that recomputes scores
    without proper fee accounting would be misleading to users.
"""

from __future__ import annotations

import numpy as np

from backend.config import AppConfig, get_settings
from backend.models.currency import LeaguePhase


def compute_opportunity_score(
    bid: float,
    ask: float,
    mid_price: float,
    volume_24h: float,
    max_volume: float,
    volatility: float,
    gold_fee_fraction: float,
    phase_multiplier: float,
    momentum: float,
    momentum_neg_threshold: float = -0.01,
    vol_reference: float = 0.05,
) -> float:
    """Compute the opportunity score for a flip.

    From §7.7 Full Function Pseudocode — copied verbatim from Canonical Formulas.

    Args:
        bid: Best bid price
        ask: Best ask price
        mid_price: Mid price ((bid + ask) / 2)
        volume_24h: 24-hour trading volume
        max_volume: Maximum volume across all pairs (for normalization)
        volatility: Standard deviation of log-returns
        gold_fee_fraction: Direction-dependent fee fraction
        phase_multiplier: Phase-dependent multiplier (1.2/1.0/0.9)
        momentum: Mean of log-returns
        momentum_neg_threshold: Threshold for strong negative momentum (default: -0.01)
        vol_reference: Reference volatility for penalty (default: 0.05)

    Returns:
        Score between 0.0 and 1.0
    """
    # §7.1: Spread after fees
    if mid_price <= 0:
        return 0.0
    spread_after_fees = (ask - bid) / mid_price - gold_fee_fraction
    if spread_after_fees <= 0:
        return 0.0

    # §7.2: Fill probability
    fill_probability = np.log1p(volume_24h) / np.log1p(max_volume)
    fill_probability = min(fill_probability, 1.0)

    # §7.5: Expected profit
    expected_profit = spread_after_fees * fill_probability

    # §7.3: Momentum penalty (filter, not additive)
    if momentum < momentum_neg_threshold:
        momentum_penalty = 0.5
    elif momentum < 0:
        momentum_penalty = 0.8
    else:
        momentum_penalty = 1.0

    # §7.4: Volatility penalty
    vol_penalty = 1.0 / (1.0 + (volatility / vol_reference) ** 2)

    # §7.5: Final score
    score = expected_profit * momentum_penalty * vol_penalty * phase_multiplier
    return min(max(score, 0.0), 1.0)


def get_phase_multiplier(phase: LeaguePhase, config: AppConfig | None = None) -> float:
    """Get the phase multiplier for scoring.

    From §7.6:
        EARLY: 1.2
        MID:   1.0
        LATE:  0.9
    """
    cfg = config or get_settings()
    if phase == LeaguePhase.EARLY:
        return cfg.scoring.phase_multiplier_early
    elif phase == LeaguePhase.MID:
        return cfg.scoring.phase_multiplier_mid
    else:  # LATE
        return cfg.scoring.phase_multiplier_late
