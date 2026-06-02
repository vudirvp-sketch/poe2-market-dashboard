"""
API routes for storage value computation (Hold/Sell Decision).

Phase 2 (Spec Section 9): Endpoint for computing projected value
and hold/sell decision for a currency using the formulas from
PoE2_Flipper_Canonical_Formulas.md Section 6.

Endpoints:
    GET /api/storage-value/{currency} — projected value and hold/sell decision
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

import numpy as np
from fastapi import APIRouter, HTTPException, Query

from backend.config import get_settings
from backend.economy.momentum import PriceMomentumTracker
from backend.predictors.storage_value import project_value

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["storage-value"])


@router.get("/storage-value/{currency}")
async def get_storage_value(
    currency: str,
    horizon_hours: int = Query(default=24, ge=1, le=168, description="Projection horizon in hours"),
    quantity: float = Query(default=1.0, ge=0.001, le=1_000_000, description="Number of units held"),
):
    """Compute projected value and hold/sell decision for a currency.

    Uses the canonical formulas from PoE2_Flipper_Canonical_Formulas.md Section 6:
    - Price projection: current_price * min(exp(momentum * horizon_hours), cap)
    - Risk discount: exp(-volatility * z * sqrt(horizon_hours))
    - Liquidity adjustment: (0.9 + liq_factor * 0.1)
    - Decision: BUY/HOLD, SELL/CONVERT, or NEUTRAL

    Note: The projection is capped at 1 + 0.10*sqrt(horizon_hours) to prevent
    unrealistic extrapolation from noisy momentum estimates.

    Args:
        currency: Currency API ID (e.g. "divine", "chaos")
        horizon_hours: How far ahead to project (1-168 hours, default 24)
    """
    config = get_settings()

    try:
        # OPTIMIZATION: Use DataSnapshot for price histories instead of
        # individual get_historical_prices() calls.
        from backend.api.data_snapshot import get_snapshot
        snapshot = await get_snapshot()

        history = snapshot.price_histories.get(currency.lower(), [])

        if not history:
            return {
                "currency": currency,
                "current_price": 0,
                "projected_price": 0,
                "risk_discount": 0,
                "adjusted_price": 0,
                "net_value_after_fees": 0,
                "ratio": 0,
                "decision": "NEUTRAL",
                "inputs": {},
                "data_available": False,
            }

        # Compute momentum and volatility
        # MEDIUM-4: Use a fixed window size with graceful degradation for short histories
        FIXED_MOMENTUM_WINDOW = 24
        tracker = PriceMomentumTracker(
            window_size=min(FIXED_MOMENTUM_WINDOW, max(2, len(history))),
            history=[p.price for p in history],
        )
        for point in history:
            tracker.update(point.price)
        metrics = tracker.compute()

        # Current price
        current_price = history[-1].price
        if current_price <= 0:
            return {
                "currency": currency,
                "current_price": 0,
                "projected_price": 0,
                "risk_discount": 0,
                "adjusted_price": 0,
                "net_value_after_fees": 0,
                "ratio": 0,
                "decision": "NEUTRAL",
                "inputs": {},
                "data_available": False,
            }

        # Liquidity score from volume
        volumes = [p.volume for p in history if p.volume > 0]
        total_volume = sum(volumes) if volumes else 0
        liquidity_score = np.log1p(total_volume) if total_volume > 0 else 0.0

        # Compute storage value
        result = project_value(
            current_price=current_price,
            log_momentum=metrics.momentum,
            volatility=metrics.volatility,
            liquidity_score=liquidity_score,
            horizon_hours=horizon_hours,
            significance_level=config.forecasting.significance_level,
            currency=currency,
            liquidity_normalization=config.storage_value.liquidity_normalization,
            buy_threshold=config.storage_value.buy_threshold,
            sell_threshold=config.storage_value.sell_threshold,
            acceleration=metrics.acceleration,  # FIX: use acceleration from MomentumResult
        )

        return {
            "currency": result.currency,
            "quantity": quantity,
            # Per-unit values (same as before for backward compatibility)
            "current_price": result.current_price,
            "projected_price": round(result.projected_price, 6),
            "risk_discount": round(result.risk_discount, 6),
            "adjusted_price": round(result.adjusted_price, 6),
            "net_value_after_fees": round(result.net_value_after_fees, 6),
            "ratio": round(result.ratio, 6),
            "decision": result.decision.value,
            "data_available": True,
            # Total values for the entire holdings (LOW-1)
            "total_current_value": round(result.current_price * quantity, 6),
            "total_projected_value": round(result.projected_price * quantity, 6),
            "total_net_value_after_fees": round(result.net_value_after_fees * quantity, 6),
            "inputs": {
                "momentum": round(metrics.momentum, 6),
                "volatility": round(metrics.volatility, 6),
                "acceleration": round(metrics.acceleration, 6),
                "liquidity_score": round(liquidity_score, 4),
                "horizon_hours": horizon_hours,
                "significance_level": config.forecasting.significance_level,
            },
        }
    except Exception as e:
        logger.error("Storage value computation failed for %s: %s", currency, e)
        return {
            "currency": currency,
            "current_price": 0,
            "projected_price": 0,
            "risk_discount": 0,
            "adjusted_price": 0,
            "net_value_after_fees": 0,
            "ratio": 0,
            "decision": "NEUTRAL",
            "inputs": {},
            "data_available": False,
        }
