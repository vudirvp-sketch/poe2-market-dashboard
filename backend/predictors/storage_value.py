"""
Storage Value Computation — Projected Value and Hold/Sell Decision.

From PoE2_Flipper_Canonical_Formulas.md Section 6:
- Price projection: current_price * exp(log_momentum * horizon_hours)
- Risk discount: exp(-volatility * z * sqrt(horizon_hours))
- Liquidity adjustment: (0.9 + liq_factor * 0.1)
- After fees: adjusted * (1 - gold_fee_fraction)
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
    confidence_level: float,
    gold_fee_fraction: float,
    currency: str = "",
    liquidity_normalization: float = 10.0,
    buy_threshold: float = 1.03,
    sell_threshold: float = 0.97,
) -> StorageValueResult:
    """Compute projected value and hold/sell decision for a currency.

    Implements the exact formulas from PoE2_Flipper_Canonical_Formulas.md Section 6.

    Args:
        current_price: Current price of the currency in base currency (e.g. Exalted)
        log_momentum: Mean of log-returns from PriceMomentumTracker
        volatility: Std of log-returns (ddof=1) from PriceMomentumTracker
        liquidity_score: Liquidity score for the currency (e.g. log1p(volume))
        horizon_hours: How far ahead to project (in hours)
        confidence_level: VaR confidence level (e.g. 0.05 for 95% one-sided CI)
        gold_fee_fraction: Fee fraction for selling the currency
        currency: Currency API ID (for the result object)
        liquidity_normalization: Normalization divisor for liquidity (default 10.0)
        buy_threshold: Ratio above which decision is BUY/HOLD (default 1.03)
        sell_threshold: Ratio below which decision is SELL/CONVERT (default 0.97)

    Returns:
        StorageValueResult with projected_price, risk_discount, adjusted_price,
        net_value_after_fees, ratio, and decision.
    """
    # Step 1: Price projection (Canonical Formulas Section 6.1)
    projected = current_price * np.exp(log_momentum * horizon_hours)

    # Step 2: Risk discount (Canonical Formulas Section 6.2)
    # z = abs(norm.ppf(confidence_level))
    # For confidence_level=0.05: z = 1.645
    z = abs(norm.ppf(confidence_level))
    risk_discount = np.exp(-volatility * z * np.sqrt(horizon_hours))

    # Step 3: Liquidity adjustment (Canonical Formulas Section 6.3)
    liq_factor = min(liquidity_score / liquidity_normalization, 1.0)
    adjusted = projected * risk_discount * (0.9 + liq_factor * 0.1)

    # Step 4: After fees (Canonical Formulas Section 6.4)
    net_value = adjusted * (1 - gold_fee_fraction)

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
