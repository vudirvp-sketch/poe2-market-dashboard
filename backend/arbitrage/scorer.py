"""
Opportunity Scoring — expected profit scoring for flip opportunities.

From PoE2_Flipper_Canonical_Formulas.md §7 (simplified: gold fees excluded):

The score is based on one concept with clear financial meaning:
expected profit per trade, scaled by probability of fill.

Formula (simplified — gold/commission excluded per project decision):
    spread = (ask - bid) / mid_price
    expected_profit = spread * fill_probability
    score = expected_profit * momentum_penalty * vol_penalty * phase_multiplier
    score = clamp(score, 0.0, 1.0)

Where:
- spread = (ask - bid) / mid_price  (raw spread, no fee deduction)
- fill_probability = log1p(volume_24h) / log1p(max_volume)
- momentum_penalty: filter-style (0.5 if very negative, 0.8 if slightly negative, 1.0 if positive)
- vol_penalty = 1.0 / (1.0 + (volatility / vol_reference)^2)
- phase_multiplier: EARLY=1.2, MID=1.0, LATE=0.9

NOTE: Gold/commission fees have been intentionally excluded from all
calculations to simplify the scoring model and avoid the complexity
of direction-dependent fee asymmetry. The raw spread is used instead
of spread_after_fees.
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
    phase_multiplier: float,
    momentum: float,
    momentum_neg_threshold: float = -0.01,
    vol_reference: float = 0.05,
    volatility_period: str = "daily",
) -> float:
    """Compute the opportunity score for a flip.

    Simplified formula (gold/commission excluded per project decision):
        spread = (ask - bid) / mid_price
        expected_profit = spread * fill_probability
        score = expected_profit * momentum_penalty * vol_penalty * phase_multiplier

    Args:
        bid: Best bid price
        ask: Best ask price
        mid_price: Mid price ((bid + ask) / 2)
        volume_24h: 24-hour trading volume
        max_volume: Maximum volume across all pairs (for normalization)
        volatility: Standard deviation of log-returns
        phase_multiplier: Phase-dependent multiplier (1.2/1.0/0.9)
        momentum: Mean of log-returns
        momentum_neg_threshold: Threshold for strong negative momentum (default: -0.01)
        vol_reference: Reference volatility for penalty (default: 0.05, assumed DAILY)
        volatility_period: Period of the volatility input — "hourly" or "daily".
            If "hourly", volatility is annualized to daily equivalent via
            vol_daily = vol_hourly * sqrt(24) before comparing to vol_reference.
            This fixes the mismatch where vol_reference=0.05 assumes daily
            volatility but PriceMomentumTracker may provide hourly-period values.

    Returns:
        Score between 0.0 and 1.0
    """
    # §7.1: Raw spread (gold fees excluded)
    if mid_price <= 0:
        return 0.0
    spread = (ask - bid) / mid_price
    if spread <= 0:
        return 0.0

    # §7.2: Fill probability
    fill_probability = np.log1p(volume_24h) / np.log1p(max_volume)
    fill_probability = min(fill_probability, 1.0)

    # §7.5: Expected profit
    expected_profit = spread * fill_probability

    # §7.3: Momentum penalty (filter, not additive)
    if momentum < momentum_neg_threshold:
        momentum_penalty = 0.5
    elif momentum < 0:
        momentum_penalty = 0.8
    else:
        momentum_penalty = 1.0

    # §7.4: Volatility penalty — with annualization fix
    # PriceMomentumTracker computes volatility over its window_size (default 24)
    # periods. If the data is hourly, the daily-equivalent volatility is:
    #   vol_daily = vol_hourly * sqrt(24) ≈ vol_hourly * 4.9
    # Without annualization, vol_reference=0.05 (daily) is compared against
    # vol_hourly≈0.003, making the penalty almost zero for hourly data.
    effective_vol = volatility
    if volatility_period == "hourly":
        effective_vol = volatility * np.sqrt(24)

    vol_penalty = 1.0 / (1.0 + (effective_vol / vol_reference) ** 2)

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
