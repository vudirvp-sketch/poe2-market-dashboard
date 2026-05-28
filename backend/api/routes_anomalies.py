"""
API routes for anomaly detection.

Phase 2 (Spec Section 6): Exposes the already-implemented AnomalyDetector
via a REST endpoint, enabling the frontend forecast tab to display anomaly alerts.

Endpoints:
    GET /api/anomalies — detect anomalies across all currencies or a specific one
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

import numpy as np

from fastapi import APIRouter, HTTPException, Query

from backend.config import get_settings
from backend.data.providers.poe2scout import Poe2ScoutProvider
from backend.predictors.anomaly import AnomalyDetector

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/anomalies", tags=["anomalies"])


@router.get("")
async def get_anomalies(
    currency: str | None = Query(default=None, description="Specific currency API ID, or None for all"),
    min_alert_score: float = Query(default=0.4, ge=0.0, le=1.0, description="Minimum alert score to include"),
):
    """Detect anomalies across all currencies or a specific one.

    Uses cached historical data from Poe2ScoutProvider and the existing
    AnomalyDetector ensemble (5 indicators: Z-score, MACD, RSI, STL, momentum).

    Args:
        currency: Optional currency API ID to check. If None, checks all monitored currencies.
        min_alert_score: Minimum alert score to include in results (default 0.4).
    """
    config = get_settings()

    # Get provider
    from backend.api.routes_prices import _get_provider
    provider = _get_provider()

    # Determine which currencies to check
    if currency:
        currencies = [currency]
    else:
        # Get all currencies from exchange rates
        rates = await provider.get_exchange_rates(config.league.league_name)
        currency_set = set()
        for key, rate in rates.items():
            currency_set.add(rate.currency_from)
            currency_set.add(rate.currency_to)
        currencies = list(currency_set)

    # Run anomaly detection for each currency
    detector = AnomalyDetector(config=config)
    alerts = []

    for curr in currencies:
        try:
            history = await provider.get_historical_prices(curr, days=7)
            if len(history) < 30:
                continue

            prices = np.array([p.price for p in history])
            alert = detector.detect(currency=curr, price_series=prices)

            if alert is not None and alert.alert_score >= min_alert_score:
                alerts.append({
                    "currency": alert.currency,
                    "alert_score": round(alert.alert_score, 4),
                    "triggered_indicators": alert.triggered_indicators,
                    "direction": alert.direction,
                    "is_confirmed": alert.is_confirmed,
                    "timestamp": alert.timestamp.isoformat() if hasattr(alert.timestamp, 'isoformat') else str(alert.timestamp),
                })
        except Exception as e:
            logger.debug("Anomaly detection failed for %s: %s", curr, e)
            continue

    return {
        "anomalies": alerts,
        "count": len(alerts),
        "currencies_checked": len(currencies),
        "min_alert_score": min_alert_score,
    }
