"""
Storage Value Computation — Projected Value and Hold/Sell Decision.

Simplified: gold/commission fees are EXCLUDED from all calculations.

From PoE2_Flipper_Canonical_Formulas.md Section 6 (simplified):
- Price projection: current_price * exp(log_momentum * horizon_hours)
- Risk discount: exp(-volatility * z * sqrt(horizon_hours))
- Liquidity adjustment: (0.9 + liq_factor * 0.1)
- Net value = adjusted (no fee deduction)
- Decision: BUY/HOLD if ratio > buy_threshold, SELL/CONVERT if ratio < sell_threshold

Phase 2 (Spec Section 9): Implements the project_value() function and
provides the StorageValueResult-compatible output.
"""

from __future__ import annotations

import numpy as np
from scipy.stats import norm

from backend.models.currency import Decision, StorageValueResult


def project_value(
    current_price: float,
    log_momentum: float,
    volatility: float,
    liquidity_score: float,
    horizon_hours: int,
    significance_level: float,
    currency: str = "",
    liquidity_normalization: float = 10.0,
    buy_threshold: float = 1.03,
    sell_threshold: float = 0.97,
    acceleration: float = 0.0,
) -> StorageValueResult:
    """Compute projected value and hold/sell decision for a currency.

    Simplified: gold/commission fees are EXCLUDED.
    net_value = adjusted_price (no fee deduction).

    Args:
        current_price: Current price of the currency in base currency
        log_momentum: Mean of log-returns from PriceMomentumTracker
        volatility: Std of log-returns (ddof=1) from PriceMomentumTracker
        liquidity_score: Liquidity score for the currency
        horizon_hours: How far ahead to project (in hours)
        significance_level: VaR significance level / alpha (e.g. 0.05 for 95% one-sided CI)
        currency: Currency API ID (for the result object)
        liquidity_normalization: Normalization divisor for liquidity (default 10.0)
        buy_threshold: Ratio above which decision is BUY/HOLD (default 1.03)
        sell_threshold: Ratio below which decision is SELL/CONVERT (default 0.97)
        acceleration: Change in momentum from PriceMomentumTracker.acceleration.
            Adjusts the projection: positive acceleration strengthens the
            trend, negative acceleration weakens it. The adjustment is dampened
            to prevent over-extrapolation from noisy short-term acceleration.

    Returns:
        StorageValueResult with projected_price, risk_discount, adjusted_price,
        net_value_after_fees, ratio, and decision.
    """
    # Step 1: Price projection (Canonical Formulas Section 6.1)
    #
    # Formula: projected = current_price * exp(log_momentum * horizon_hours)
    #
    # FIX: Incorporate acceleration as a dampened adjustment to momentum.
    # If momentum is positive and acceleration is positive, the trend is
    # strengthening — we nudge the projection slightly higher. If momentum
    # is positive but acceleration is negative, the trend is fading — we
    # dampen the projection. The dampening factor of 0.3 prevents
    # over-extrapolation from noisy acceleration estimates.
    #
    # effective_momentum = momentum + 0.3 * acceleration * horizon_hours
    #
    # The 0.3 factor was chosen because acceleration is per-period and
    # can be noisy; giving it full weight would cause wild swings.
    effective_momentum = log_momentum + 0.3 * acceleration * horizon_hours
    #
    # SAFETY CAP: exp(effective_momentum * horizon_hours) can produce absurdly
    # large projections when momentum is noisy (e.g. from a short window).
    # At momentum=0.05/hour, 24h projection ≈ 3.3x price — unrealistic.
    # We cap the projection factor to a horizon-dependent maximum:
    #   max_factor = 1 + 0.10 * sqrt(horizon_hours)
    # This allows 1.49x for 24h, 1.69x for 48h, 2.0x for 168h — still
    # optimistic but bounded. The risk discount and liquidity adjustment
    # further dampen the final value.
    raw_factor = np.exp(effective_momentum * horizon_hours)
    max_projection_factor = 1.0 + 0.10 * np.sqrt(horizon_hours)
    capped_factor = min(raw_factor, max_projection_factor)
    projected = current_price * capped_factor

    # Step 2: Risk discount (Canonical Formulas Section 6.2)
    # z = abs(norm.ppf(significance_level))
    # For significance_level=0.05: z = 1.645
    z = abs(norm.ppf(significance_level))
    risk_discount = np.exp(-volatility * z * np.sqrt(horizon_hours))

    # Step 3: Liquidity adjustment (Canonical Formulas Section 6.3)
    liq_factor = min(liquidity_score / liquidity_normalization, 1.0)
    adjusted = projected * risk_discount * (0.9 + liq_factor * 0.1)

    # Step 4: After fees — SIMPLIFIED: no fee deduction (gold fees excluded)
    net_value = adjusted

    # Step 5: Decision (Canonical Formulas Section 6.5)
    ratio = net_value / current_price if current_price > 0 else 0

    if ratio > buy_threshold:
        decision = Decision.BUY_HOLD
    elif ratio < sell_threshold:
        decision = Decision.SELL_CONVERT
    else:
        decision = Decision.NEUTRAL

    return StorageValueResult(
        currency=currency,
        current_price=current_price,
        projected_price=float(projected),
        risk_discount=float(risk_discount),
        adjusted_price=float(adjusted),
        net_value_after_fees=float(net_value),
        ratio=float(ratio),
        decision=decision,
    )
