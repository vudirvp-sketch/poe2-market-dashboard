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
from backend.api.data_snapshot import get_snapshot
from backend.api.shared import get_forecast_engine as _get_forecast_engine
from backend.economy.events import get_event_manager, EventManager
from backend.models.currency import ForecastResult

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/forecast", tags=["forecast"])


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/{currency}")
async def get_forecast(
    currency: str,
    horizon: int = Query(24, ge=1, le=168, description="Forecast horizon in periods"),
    is_event_active: bool | None = Query(
        None,
        description="Override: whether an event flag is active. "
                    "If not provided, auto-detected from EventManager.",
    ),
):
    """Return price forecasts from all available models for a currency.

    Models: SARIMA, Holt-Winters, LightGBM.
    Includes 95% confidence intervals and model agreement check.

    Event effects (Milestone 9):
    - SARIMA: low_confidence=True when event active
    - Holt-Winters: disabled when event active
    - LightGBM: is_event_active feature set to True
    - If is_event_active query param is not provided, auto-detected
      from the EventManager based on whether this currency is affected.
    """
    config = get_settings()
    event_manager = get_event_manager(config)

    # Auto-detect event status if not explicitly provided
    if is_event_active is None:
        is_event_active = event_manager.is_event_active(currency)

    try:
        # OPTIMIZATION: Use DataSnapshot for price histories instead of
        # individual get_historical_prices() calls. The snapshot already
        # contains price_logs from ByCategory — no extra API calls needed.
        snapshot = await get_snapshot()

        # Get price history from snapshot
        price_points = snapshot.get_price_history(currency)

        # Also try DailyStatsHistory for richer OHLCV data
        # (DailyStats is NOT in DataSnapshot, so we use the dedicated
        # DailyStatsCache — replaces the old DataCache daily_stats tier.)
        daily_stats_data: dict | None = None
        daily_stats_stale = False
        try:
            # Look up item_id from snapshot metadata
            for ci in snapshot.currency_metadata:
                if ci.api_id.lower() == currency.lower() and ci.item_id:
                    from backend.api.shared import get_provider as _get_prov
                    from backend.data.daily_stats_cache import get_daily_stats_cache
                    _provider = _get_prov()
                    _ds_cache = get_daily_stats_cache()
                    ds_result = await _ds_cache.get_or_fetch(
                        _provider.get_daily_stats,
                        config.league.league_name,
                        ci.item_id,
                        30,
                    )
                    daily_stats_data = ds_result.value
                    daily_stats_stale = ds_result.stale
                    if daily_stats_stale:
                        logger.info(
                            "Using stale DailyStats for %s forecast (upstream may be degraded)",
                            currency,
                        )
                    break
        except Exception as e:
            logger.debug("DailyStatsHistory lookup failed for %s: %s", currency, e)

        if not price_points:
            raise HTTPException(
                status_code=404,
                detail=f"No historical data available for currency: {currency}",
            )

        # If DailyStatsHistory is available, use it as a supplementary data
        # source.  Daily OHLCV provides a cleaner, more regular signal than
        # raw price logs, which is especially beneficial for LightGBM feature
        # engineering with daily data.
        daily_stats_prices: list = []
        if daily_stats_data is not None:
            try:
                from backend.data.schemas import DailyStatsResponse
                ds_resp = DailyStatsResponse.model_validate(daily_stats_data)
                from datetime import datetime as _dt, timezone as _tz
                for pt in ds_resp.daily_stats:
                    if pt.close and pt.close > 0:
                        try:
                            ts = _dt.fromisoformat(pt.time.replace("Z", "+00:00")) if pt.time else _dt.now(_tz.utc)
                        except (ValueError, TypeError):
                            ts = _dt.now(_tz.utc)
                        from backend.models.currency import PricePoint
                        daily_stats_prices.append(PricePoint(
                            timestamp=ts,
                            price=pt.close,
                            volume=float(pt.volume) if pt.volume else 0.0,
                        ))
            except Exception as e:
                logger.debug("Failed to parse DailyStatsHistory for %s: %s", currency, e)

        # Prefer daily stats for forecasting if enough points are available,
        # otherwise fall back to raw price logs.
        if len(daily_stats_prices) >= 10:
            price_points = daily_stats_prices
            logger.info(
                "Using DailyStatsHistory (%d points) for %s forecast",
                len(daily_stats_prices), currency,
            )

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

        # Note: Holt-Winters is automatically disabled when event is active
        # (handled inside ForecastEngine), so it simply won't appear in results

        return {
            "currency": currency,
            "horizon": horizon,
            "models": forecast_data,
            "disagreement": has_disagreement,
            "low_confidence": has_low_confidence,
            "is_event_active": is_event_active,
            "data_points": len(prices),
            "data_available": True,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Forecast handler failed for %s: %s", currency, e)
        return {
            "currency": currency,
            "horizon": horizon,
            "models": {},
            "disagreement": False,
            "low_confidence": False,
            "is_event_active": is_event_active,
            "data_points": 0,
            "data_available": False,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }


@router.get("/{currency}/stl")
async def get_stl_decomposition(
    currency: str,
    seasonal_period: int = Query(7, ge=2, le=52, description="Seasonal period"),
):
    """Return STL decomposition (trend, seasonal, residual) for a currency.

    Useful for visualizing the components of the price series.

    OPTIMIZATION: Uses DataSnapshot for price histories instead of
    cache.get_or_fetch("history", ...) which would call
    get_historical_prices() per currency (N API calls).
    The snapshot already contains price_logs from ByCategory.
    """
    config = get_settings()

    # Use DataSnapshot instead of cache.get_or_fetch("history", ...)
    snapshot = await get_snapshot()
    price_points = snapshot.get_price_history(currency)

    if not price_points:
        raise HTTPException(
            status_code=404,
            detail=f"No historical data available for currency: {currency}",
        )

    import numpy as np

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
