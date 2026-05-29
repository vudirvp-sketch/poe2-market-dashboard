"""
WebSocket routes for live-updating Storage Value and Forecast data.

Endpoints:
    WS /ws/storage-value/{currency}  — pushes StorageValueResult every N seconds
    WS /ws/forecast/{currency}       — pushes ForecastResponse every N seconds

The server polls the existing computation logic at a configurable interval
(default: 30 seconds) and pushes JSON updates to all connected clients.

Message format (JSON):
    {
        "type": "update",
        "data": { ... },       // the same JSON the REST endpoint returns
        "timestamp": "ISO8601"
    }
    {
        "type": "error",
        "message": "..."
    }
    {
        "type": "heartbeat"
    }
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from backend.config import get_settings

logger = logging.getLogger(__name__)

router = APIRouter(tags=["websocket"])

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

PUSH_INTERVAL_SECONDS = 30  # how often to push updates
HEARTBEAT_INTERVAL_SECONDS = 15  # how often to send heartbeats


# ---------------------------------------------------------------------------
# Helper: build storage value data (reuses existing logic)
# ---------------------------------------------------------------------------

async def _compute_storage_value(currency: str, horizon_hours: int = 24) -> dict | None:
    """Compute storage value using the same logic as the REST endpoint."""
    try:
        from backend.api.routes_storage_value import get_storage_value
        # We can't call the endpoint function directly because it's an async
        # route handler, so we duplicate the core logic here using the shared
        # provider and cache.
        from backend.api.shared import get_provider
        from backend.data.cache import get_cache
        from backend.economy.momentum import PriceMomentumTracker
        from backend.economy.gold_costs import compute_gold_fee_fraction
        from backend.predictors.storage_value import project_value
        import numpy as np

        config = get_settings()
        provider = get_provider()
        cache = get_cache()

        hist_result = await cache.get_or_fetch(
            "history",
            provider.name(),
            "get_historical_prices",
            provider.get_historical_prices,
            currency,
            7,
        )

        if hist_result.value is None or len(hist_result.value) == 0:
            return None

        history = hist_result.value
        tracker = PriceMomentumTracker(window_size=len(history))
        for point in history:
            tracker.update(point.price)
        metrics = tracker.compute()

        current_price = history[-1].price
        if current_price <= 0:
            return None

        volumes = [p.volume for p in history if p.volume > 0]
        total_volume = sum(volumes) if volumes else 0
        liquidity_score = np.log1p(total_volume) if total_volume > 0 else 0.0

        gold_to_chaos_rate = config.fees.fixed_gold_to_chaos_rate or 0.001
        try:
            gold_fee_fraction = compute_gold_fee_fraction(
                currency, 1.0,
                gold_to_chaos_rate,
                current_price,
                config.fees.unknown_item_gold_cost,
            )
        except Exception:
            gold_fee_fraction = 0.0

        result = project_value(
            current_price=current_price,
            log_momentum=metrics.momentum,
            volatility=metrics.volatility,
            liquidity_score=liquidity_score,
            horizon_hours=horizon_hours,
            confidence_level=config.forecasting.confidence_level,
            gold_fee_fraction=gold_fee_fraction,
            currency=currency,
            liquidity_normalization=config.storage_value.liquidity_normalization,
            buy_threshold=config.storage_value.buy_threshold,
            sell_threshold=config.storage_value.sell_threshold,
        )

        return {
            "currency": result.currency,
            "current_price": result.current_price,
            "projected_price": round(result.projected_price, 6),
            "risk_discount": round(result.risk_discount, 6),
            "adjusted_price": round(result.adjusted_price, 6),
            "net_value_after_fees": round(result.net_value_after_fees, 6),
            "ratio": round(result.ratio, 6),
            "decision": result.decision.value,
            "inputs": {
                "momentum": round(metrics.momentum, 6),
                "volatility": round(metrics.volatility, 6),
                "acceleration": round(metrics.acceleration, 6),
                "liquidity_score": round(liquidity_score, 4),
                "gold_fee_fraction": round(gold_fee_fraction, 6),
                "horizon_hours": horizon_hours,
                "confidence_level": config.forecasting.confidence_level,
            },
        }
    except Exception as e:
        logger.error("WS: storage value computation failed for %s: %s", currency, e)
        return None


# ---------------------------------------------------------------------------
# Helper: build forecast data (reuses existing logic)
# ---------------------------------------------------------------------------

async def _compute_forecast(currency: str, horizon: int = 24) -> dict | None:
    """Compute forecast using the same logic as the REST endpoint."""
    try:
        from backend.api.shared import get_provider, get_forecast_engine
        from backend.data.cache import get_cache
        from backend.economy.events import get_event_manager
        from backend.data.schemas import DailyStatsResponse
        from backend.models.currency import PricePoint
        import numpy as np

        config = get_settings()
        provider = get_provider()
        cache = get_cache()
        event_manager = get_event_manager(config)

        is_event_active = event_manager.is_event_active(currency)

        hist_result = await cache.get_or_fetch(
            "history",
            provider.name(),
            "get_historical_prices",
            provider.get_historical_prices,
            currency,
            14,
        )

        # Try DailyStatsHistory for richer data
        daily_stats_data: dict | None = None
        try:
            metadata_result = await cache.get_or_fetch(
                "metadata",
                provider.name(),
                "get_currency_metadata",
                provider.get_currency_metadata,
                config.league.league_name,
            )
            if metadata_result.value:
                for ci in metadata_result.value:
                    if ci.api_id.lower() == currency.lower() and ci.item_id:
                        ds_result = await cache.get_or_fetch(
                            "daily_stats",
                            provider.name(),
                            "get_daily_stats",
                            provider.get_daily_stats,
                            config.league.league_name,
                            ci.item_id,
                            30,
                        )
                        daily_stats_data = ds_result.value
                        break
        except Exception:
            pass

        if hist_result.value is None or len(hist_result.value) == 0:
            return None

        price_points = hist_result.value

        # Use daily stats if available
        daily_stats_prices: list = []
        if daily_stats_data is not None:
            try:
                ds_resp = DailyStatsResponse.model_validate(daily_stats_data)
                for pt in ds_resp.daily_stats:
                    if pt.close and pt.close > 0:
                        try:
                            ts = datetime.fromisoformat(pt.time.replace("Z", "+00:00")) if pt.time else datetime.now(timezone.utc)
                        except (ValueError, TypeError):
                            ts = datetime.now(timezone.utc)
                        daily_stats_prices.append(PricePoint(
                            timestamp=ts,
                            price=pt.close,
                            volume=float(pt.volume) if pt.volume else 0.0,
                        ))
            except Exception:
                pass

        if len(daily_stats_prices) >= 10:
            price_points = daily_stats_prices

        prices = np.array([p.price for p in price_points], dtype=float)
        volumes = np.array([p.volume for p in price_points], dtype=float)
        timestamps = [p.timestamp for p in price_points]

        if len(prices) < 10:
            return None

        engine = get_forecast_engine(config)
        results = engine.forecast(
            currency=currency,
            price_series=prices,
            volumes=volumes,
            timestamps=timestamps,
            is_event_active=is_event_active,
        )

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

        has_disagreement = any(r.disagreement for r in results.values())
        has_low_confidence = any(r.low_confidence for r in results.values())

        return {
            "currency": currency,
            "horizon": horizon,
            "models": forecast_data,
            "disagreement": has_disagreement,
            "low_confidence": has_low_confidence,
            "is_event_active": is_event_active,
            "data_points": len(prices),
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as e:
        logger.error("WS: forecast computation failed for %s: %s", currency, e)
        return None


# ---------------------------------------------------------------------------
# WebSocket endpoint: Storage Value
# ---------------------------------------------------------------------------

@router.websocket("/ws/storage-value/{currency}")
async def ws_storage_value(websocket: WebSocket, currency: str):
    """WebSocket endpoint that pushes storage value updates.

    Query params:
        horizon_hours: Projection horizon (default 24, range 1-168)

    Messages sent:
        {"type": "update", "data": {...}, "timestamp": "..."}
        {"type": "heartbeat"}
        {"type": "error", "message": "..."}
    """
    await websocket.accept()
    logger.info("WS /ws/storage-value/%s: client connected", currency)

    # Read optional query params
    horizon_hours = 24
    if websocket.query_params.get("horizon_hours"):
        try:
            horizon_hours = max(1, min(168, int(websocket.query_params["horizon_hours"])))
        except (ValueError, TypeError):
            pass

    push_task = asyncio.create_task(
        _push_loop(websocket, "storage-value", currency,
                   lambda: _compute_storage_value(currency, horizon_hours))
    )
    hb_task = asyncio.create_task(_heartbeat_loop(websocket))

    try:
        # Keep connection alive — listen for client messages (close, etc.)
        while True:
            # Wait for any message from the client (e.g. close frame)
            data = await websocket.receive_text()
            if data == "close":
                break
    except WebSocketDisconnect:
        logger.info("WS /ws/storage-value/%s: client disconnected", currency)
    except Exception as e:
        logger.warning("WS /ws/storage-value/%s: connection error: %s", currency, e)
    finally:
        push_task.cancel()
        hb_task.cancel()
        try:
            await websocket.close()
        except Exception:
            pass


# ---------------------------------------------------------------------------
# WebSocket endpoint: Forecast
# ---------------------------------------------------------------------------

@router.websocket("/ws/forecast/{currency}")
async def ws_forecast(websocket: WebSocket, currency: str):
    """WebSocket endpoint that pushes forecast updates.

    Query params:
        horizon: Forecast horizon in periods (default 24, range 1-168)

    Messages sent:
        {"type": "update", "data": {...}, "timestamp": "..."}
        {"type": "heartbeat"}
        {"type": "error", "message": "..."}
    """
    await websocket.accept()
    logger.info("WS /ws/forecast/%s: client connected", currency)

    horizon = 24
    if websocket.query_params.get("horizon"):
        try:
            horizon = max(1, min(168, int(websocket.query_params["horizon"])))
        except (ValueError, TypeError):
            pass

    push_task = asyncio.create_task(
        _push_loop(websocket, "forecast", currency,
                   lambda: _compute_forecast(currency, horizon))
    )
    hb_task = asyncio.create_task(_heartbeat_loop(websocket))

    try:
        while True:
            data = await websocket.receive_text()
            if data == "close":
                break
    except WebSocketDisconnect:
        logger.info("WS /ws/forecast/%s: client disconnected", currency)
    except Exception as e:
        logger.warning("WS /ws/forecast/%s: connection error: %s", currency, e)
    finally:
        push_task.cancel()
        hb_task.cancel()
        try:
            await websocket.close()
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Shared async loops
# ---------------------------------------------------------------------------

async def _push_loop(
    websocket: WebSocket,
    endpoint_name: str,
    currency: str,
    compute_fn,
) -> None:
    """Periodically compute and push data to the WebSocket client."""
    while True:
        try:
            data = await compute_fn()
            if data is not None:
                message = {
                    "type": "update",
                    "data": data,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
            else:
                message = {
                    "type": "error",
                    "message": f"No data available for {currency}",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
            await websocket.send_json(message)
        except Exception as e:
            logger.debug("WS %s/%s push error: %s", endpoint_name, currency, e)
            try:
                await websocket.send_json({
                    "type": "error",
                    "message": str(e),
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                })
            except Exception:
                return  # connection likely closed

        await asyncio.sleep(PUSH_INTERVAL_SECONDS)


async def _heartbeat_loop(websocket: WebSocket) -> None:
    """Send periodic heartbeat messages to keep the connection alive."""
    while True:
        try:
            await websocket.send_json({"type": "heartbeat"})
        except Exception:
            return
        await asyncio.sleep(HEARTBEAT_INTERVAL_SECONDS)
