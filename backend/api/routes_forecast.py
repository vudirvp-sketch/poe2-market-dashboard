"""
API routes for price forecasting.

Endpoints:
    GET /api/forecast/{currency}  — price forecast from all available models
    GET /api/forecast/{currency}/stl — STL decomposition for a currency
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from backend.config import get_settings, AppConfig
from backend.data.cache import get_cache
from backend.data.providers.poe2scout import Poe2ScoutProvider
from backend.predictors.time_series import ForecastEngine
from backend.models.currency import ForecastResult

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/forecast", tags=["forecast"])

# ---------------------------------------------------------------------------
# Shared singletons
# ---------------------------------------------------------------------------

_provider: Poe2ScoutProvider | None = None
_forecast_engine: ForecastEngine | None = None


def _get_provider() -> Poe2ScoutProvider:
    global _provider
    if _provider is None:
        _provider = Poe2ScoutProvider()
    return _provider


def _get_forecast_engine(config: AppConfig | None = None) -> ForecastEngine:
    global _forecast_engine
    if _forecast_engine is None or config is not None:
        _forecast_engine = ForecastEngine(config)
    return _forecast_engine


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/{currency}")
async def get_forecast(
    currency: str,
    horizon: int = Query(24, ge=1, le=168, description="Forecast horizon in periods"),
    is_event_active: bool = Query(False, description="Whether an event flag is active"),
):
    """Return price forecasts from all available models for a currency.

    Models: SARIMA, Holt-Winters, LightGBM.
    Includes 95% confidence intervals and model agreement check.
    """
    config = get_settings()
    provider = _get_provider()
    cache = get_cache()

    # Fetch historical price data for this currency
    hist_result = await cache.get_or_fetch(
        "history",
        provider.name(),
        "get_historical_prices",
        provider.get_historical_prices,
        currency,
        14,  # 14 days of history
    )

    if hist_result.value is None or len(hist_result.value) == 0:
        raise HTTPException(
            status_code=404,
            detail=f"No historical data available for currency: {currency}",
        )

    price_points = hist_result.value

    # Extract prices and timestamps
    import numpy as np

    prices = np.array([p.price for p in price_points], dtype=float)
    volumes = np.array([p.volume for p in price_points], dtype=float)
    timestamps = [p.timestamp for p in price_points]

    if len(prices) < 10:
        raise HTTPException(
            status_code=422,
            detail=f"Insufficient historical data for {currency} ({len(prices)} points, need >= 10)",
        )

    # Run forecasts
    engine = _get_forecast_engine(config)
    results = engine.forecast(
        currency=currency,
        price_series=prices,
        volumes=volumes,
        timestamps=timestamps,
        is_event_active=is_event_active,
    )

    # Format response
    forecast_data = {}
    for model_name, result in results.items():
        forecast_data[model_name] = {
            "currency": result.currency,
            "model_name": result.model_name,
            "point_forecast": [round(v, 6) for v in result.point_forecast],
            "ci_lower": [round(v, 6) for v in result.ci_lower],
            "ci_upper": [round(v, 6) for v in result.ci_upper],
            "timestamps": [ts.isoformat() for ts in result.timestamps],
            "low_confidence": result.low_confidence,
            "disagreement": result.disagreement,
            "mape": round(result.mape, 6) if result.mape is not None else None,
        }

    # Determine overall status
    has_disagreement = any(r.disagreement for r in results.values())
    has_low_confidence = any(r.low_confidence for r in results.values())

    return {
        "currency": currency,
        "horizon": horizon,
        "models": forecast_data,
        "disagreement": has_disagreement,
        "low_confidence": has_low_confidence,
        "data_points": len(prices),
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/{currency}/stl")
async def get_stl_decomposition(
    currency: str,
    seasonal_period: int = Query(7, ge=2, le=52, description="Seasonal period"),
):
    """Return STL decomposition (trend, seasonal, residual) for a currency.

    Useful for visualizing the components of the price series.
    """
    config = get_settings()
    provider = _get_provider()
    cache = get_cache()

    hist_result = await cache.get_or_fetch(
        "history",
        provider.name(),
        "get_historical_prices",
        provider.get_historical_prices,
        currency,
        14,
    )

    if hist_result.value is None or len(hist_result.value) == 0:
        raise HTTPException(
            status_code=404,
            detail=f"No historical data available for currency: {currency}",
        )

    import numpy as np

    price_points = hist_result.value
    prices = np.array([p.price for p in price_points], dtype=float)
    timestamps = [p.timestamp for p in price_points]

    engine = _get_forecast_engine(config)
    stl_result = engine.get_stl_decomposition(
        price_series=prices,
        seasonal_period=seasonal_period,
        timestamps=timestamps,
    )

    if stl_result is None:
        raise HTTPException(
            status_code=422,
            detail=f"STL decomposition failed for {currency}. "
                   f"Need at least {2 * seasonal_period} data points.",
        )

    return {
        "currency": currency,
        "seasonal_period": stl_result.seasonal_period,
        "trend": [round(v, 6) for v in stl_result.trend],
        "seasonal": [round(v, 6) for v in stl_result.seasonal],
        "residual": [round(v, 6) for v in stl_result.residual],
        "timestamps": [ts.isoformat() for ts in stl_result.timestamps],
        "data_points": len(prices),
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }
