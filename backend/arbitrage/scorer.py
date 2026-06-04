"""
Opportunity Scoring — expected profit scoring for flip opportunities.

From PoE2_Flipper_Canonical_Formulas.md §7 (raw spread for scoring):

The score is based on one concept with clear financial meaning:
expected profit per trade, scaled by probability of fill.

Formula (raw spread — gold fees are deducted at the route level):
    spread = (ask - bid) / mid_price
    expected_profit = spread * fill_probability
    score = expected_profit * momentum_penalty * vol_penalty * phase_multiplier * tier_penalty
    score = clamp(score, 0.0, 1.0)

Step 3: Gold fee accounting is now handled at the route level
(routes_arbitrage.py), where net_spread = spread - total_fee_fraction.
The scorer still uses raw spread for ranking, but the route filters out
opportunities with net_profit_pct <= 0 after gold fees.

Where:
- spread = (ask - bid) / mid_price  (raw spread, no fee deduction here)
- fill_probability = log1p(volume_24h) / log1p(max_volume)
- momentum_penalty: filter-style (0.5 if very negative, 0.8 if slightly negative, 1.0 if positive)
- vol_penalty = 1.0 / (1.0 + (volatility / vol_reference)^2)
- phase_multiplier: EARLY=1.2, MID=1.0, LATE=0.9
- tier_penalty: 1.0 for same-tier, reduced for cross-tier flips

QUANTIZED SCORING (P1-1):
  The continuous spread can be misleading — PoE2 exchange requires positive
  integers on both sides. A 3% continuous spread can be a loss at lot size 1
  due to ceil()/floor() rounding. The quantized scorer computes the actual
  integer profit at each lot size and uses the effective spread from the
  minimum profitable lot for the final score.
"""

from __future__ import annotations

import math
from fractions import Fraction

import numpy as np

from backend.config import AppConfig, get_settings
from backend.models.currency import (
    LeaguePhase,
    QuantizedSpreadResult,
    QuantizedAnalysis,
)


# Lot sizes to test — must match config.yaml quantization.default_lot_sizes
DEFAULT_LOT_SIZES = [1, 5, 10, 50, 100]
MAX_LOT_SEARCH = 10000


def _scale_factor(mid_price: float) -> int:
    """P2-4: Compute a dynamic per-pair scale factor for integer math stability.

    Target: mid_price * factor ∈ [1000, 1000000] so that ceil/floor
    rounding errors are negligible relative to the spread.

    Overflow protection: factor * mid_price < 2^30 to avoid int32 overflow
    in downstream calculations.

    Examples:
      mid_price=0.001  → factor=10000000, scaled mid=10000 ✓
      mid_price=0.01   → factor=1000000,  scaled mid=10000 ✓
      mid_price=1.0    → factor=10000,    scaled mid=10000 ✓
      mid_price=200    → factor=50,       scaled mid=10000 ✓
      mid_price=0.00001 → factor=1000000000, scaled mid=10000 ✓ (no overflow)
      mid_price=1000000 → factor=1,        scaled mid=1000000 ✓
    """
    if mid_price <= 0:
        return 1
    target = 10000  # Target: mid_price * factor ≈ 10000
    factor = max(1, int(target / mid_price))
    # Overflow protection: factor * mid_price < 2^30
    if factor * mid_price > 2**30:
        factor = int(2**30 / mid_price)
    return factor


def compute_quantized_analysis(
    R_buy: float,
    R_sell: float,
    mid_price: float,
    lot_sizes: list[int] | None = None,
    max_lot_search: int = MAX_LOT_SEARCH,
) -> QuantizedAnalysis:
    """Compute quantized (integer-aware) spread analysis for a currency pair.

    R_buy: rate to BUY currency A with B (you pay B, get A)
    R_sell: rate to SELL currency A for B (you give A, get B)
    mid_price: midpoint price (for theoretical spread reference)

    In PoE2 exchange:
      - You list "Have X of B, Want Y of A" → you pay ceil(N * R_buy) of B
      - You list "Have Y of A, Want X of B" → you receive floor(N * R_sell) of B

    P2-4: Dynamic per-pair scaling for integer math stability.
    Instead of a fixed MIN_LOT_COST, we compute a scale factor that adapts
    to the price magnitude:
      - For cheap currencies (mid_price=0.001): factor = 10000000, scaled mid ≈ 10000
      - For expensive currencies (mid_price=200): factor = 50, scaled mid ≈ 10000
      - For mid-range (mid_price=1.0): factor = 10000, scaled mid ≈ 10000

    The target is to make mid_price * factor ∈ [1000, 1000000] so that
    integer rounding errors are negligible relative to the spread.
    Overflow protection ensures factor * mid_price < 2^30.
    """
    if lot_sizes is None:
        lot_sizes = DEFAULT_LOT_SIZES

    # P2-4: Dynamic per-pair scaling factor
    if mid_price > 0 and R_buy > 0:
        scale = _scale_factor(mid_price)
        R_buy *= scale
        R_sell *= scale
        mid_price *= scale

    theoretical_spread = (R_sell - R_buy) / mid_price if mid_price > 0 else 0.0

    # Compute quantized spread at each standard lot size
    q_spreads: dict[int, QuantizedSpreadResult] = {}
    for N in lot_sizes:
        actual_cost = math.ceil(N * R_buy)
        actual_revenue = math.floor(N * R_sell)
        net_profit = actual_revenue - actual_cost
        gross_profit_pct = (net_profit / actual_cost * 100) if actual_cost > 0 else 0.0
        q_spread = ((actual_revenue / N - actual_cost / N) / mid_price) if mid_price > 0 else 0.0
        q_spreads[N] = QuantizedSpreadResult(
            lot_size=N,
            actual_cost=actual_cost,
            actual_revenue=actual_revenue,
            net_profit=net_profit,
            gross_profit_pct=gross_profit_pct,
            q_spread=q_spread,
        )

    # Find minimal profitable lot by iterative search
    min_profitable_lot = 0
    for N in range(1, max_lot_search + 1):
        if math.floor(N * R_sell) > math.ceil(N * R_buy):
            min_profitable_lot = N
            break

    # Optimal lot profit
    optimal_lot_profit_pct = 0.0
    if min_profitable_lot > 0:
        res = q_spreads.get(min_profitable_lot)
        if res is None:
            # Lot size not in standard set — compute it
            cost = math.ceil(min_profitable_lot * R_buy)
            rev = math.floor(min_profitable_lot * R_sell)
            profit = rev - cost
            optimal_lot_profit_pct = (profit / cost * 100) if cost > 0 else 0.0
        else:
            optimal_lot_profit_pct = res.gross_profit_pct

    # Recommended listing ratio
    if R_sell > 0:
        # Fraction from float may have large denominators;
        # limit_denominator keeps the ratio practical for lot size computation.
        f = Fraction(R_sell).limit_denominator(max_denominator=1000)
        recommended_ratio = (f.numerator, f.denominator)
        brick_resistance = 1.0 / max(f.numerator, f.denominator)
    else:
        recommended_ratio = (0, 1)
        brick_resistance = 0.0

    return QuantizedAnalysis(
        q_spreads=q_spreads,
        min_profitable_lot=min_profitable_lot,
        optimal_lot_profit_pct=optimal_lot_profit_pct,
        recommended_ratio=recommended_ratio,
        brick_resistance=brick_resistance,
        theoretical_spread=theoretical_spread,
    )


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
    tier_penalty_val: float = 1.0,
) -> float:
    """Compute the opportunity score for a flip.

    Simplified formula (gold/commission excluded per project decision):
        spread = (ask - bid) / mid_price
        expected_profit = spread * fill_probability
        score = expected_profit * momentum_penalty * vol_penalty * phase_multiplier * tier_penalty

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
        tier_penalty_val: Tier distance penalty factor (1.0 = same tier, <1.0 for cross-tier)

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
    effective_vol = volatility
    if volatility_period == "hourly":
        effective_vol = volatility * np.sqrt(24)

    vol_penalty = 1.0 / (1.0 + (effective_vol / vol_reference) ** 2)

    # §7.5: Final score (with tier penalty)
    score = expected_profit * momentum_penalty * vol_penalty * phase_multiplier * tier_penalty_val
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
