"""
WebSocket routes for live-updating data.

Endpoints:
    WS /v1/ws/storage-value/{currency}  — pushes StorageValueResult every N seconds
    WS /v1/ws/forecast/{currency}       — pushes ForecastResponse every N seconds
    WS /v1/ws/anomalies                 — pushes anomaly alerts every N seconds
    WS /v1/ws/flips                     — pushes flip scoring updates every N seconds
    WS /v1/ws/events                    — pushes event creation/deactivation notifications

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

router = APIRouter(prefix="/v1", tags=["websocket"])

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

PUSH_INTERVAL_SECONDS = 30  # how often to push updates
HEARTBEAT_INTERVAL_SECONDS = 15  # how often to send heartbeats


# ---------------------------------------------------------------------------
# Helper: build storage value data (reuses existing logic)
# ---------------------------------------------------------------------------

async def _compute_storage_value(currency: str, horizon_hours: int = 24, quantity: float = 1.0) -> dict | None:
    """Compute storage value using DataSnapshot instead of individual API calls.

    OPTIMIZATION: Uses DataSnapshot for price histories — no extra API calls.
    Previously this called cache.get_or_fetch() which triggered individual
    get_historical_prices() calls per currency (15+ ByCategory requests).
    """
    try:
        from backend.api.data_snapshot import get_snapshot
        from backend.economy.momentum import PriceMomentumTracker
        from backend.predictors.storage_value import project_value
        import numpy as np

        config = get_settings()
        snapshot = await get_snapshot()

        history = snapshot.price_histories.get(currency.lower(), [])

        if not history:
            return None
        # MEDIUM-4: Use a fixed window size with graceful degradation for short histories
        FIXED_MOMENTUM_WINDOW = 24
        tracker = PriceMomentumTracker(
            window_size=min(FIXED_MOMENTUM_WINDOW, max(2, len(history))),
            history=[p.price for p in history],
        )
        for point in history:
            tracker.update(point.price)
        metrics = tracker.compute()

        current_price = history[-1].price
        if current_price <= 0:
            return None

        volumes = [p.volume for p in history if p.volume > 0]
        total_volume = sum(volumes) if volumes else 0
        liquidity_score = np.log1p(total_volume) if total_volume > 0 else 0.0

        result = project_value(
            current_price=current_price,
            log_momentum=metrics.momentum,
            volatility=metrics.volatility,
            acceleration=metrics.acceleration,
            liquidity_score=liquidity_score,
            horizon_hours=horizon_hours,
            significance_level=config.forecasting.significance_level,
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
            "net_value": round(result.net_value, 6),
            "ratio": round(result.ratio, 6),
            "decision": result.decision.value,
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
        logger.error("WS: storage value computation failed for %s: %s", currency, e)
        return None


# ---------------------------------------------------------------------------
# Helper: build forecast data (reuses existing logic)
# ---------------------------------------------------------------------------

async def _compute_forecast(currency: str, horizon: int = 24) -> dict | None:
    """Compute forecast using DataSnapshot instead of individual API calls.

    OPTIMIZATION: Uses DataSnapshot for price histories and metadata — no
    extra API calls needed. Previously this called cache.get_or_fetch() which
    triggered individual get_historical_prices() + get_currency_metadata() +
    get_daily_stats() per currency (15+ ByCategory requests each time).

    DailyStatsHistory is still fetched individually when needed (it's not
    part of the snapshot), but this is a lightweight single-item request.
    """
    try:
        from backend.api.shared import get_provider, get_forecast_engine
        from backend.api.data_snapshot import get_snapshot
        from backend.data.daily_stats_cache import get_daily_stats_cache
        from backend.economy.events import get_event_manager
        from backend.data.schemas import DailyStatsResponse
        from backend.models.currency import PricePoint
        import numpy as np

        config = get_settings()
        provider = get_provider()
        ds_cache = get_daily_stats_cache()
        event_manager = get_event_manager(config)

        is_event_active = event_manager.is_event_active(currency)

        # Use DataSnapshot for price histories (0 additional API calls)
        snapshot = await get_snapshot()

        price_points = snapshot.price_histories.get(currency.lower(), [])

        # Try DailyStatsHistory for richer data (single lightweight request)
        daily_stats_data: dict | None = None
        try:
            # Use snapshot's metadata instead of calling get_currency_metadata()
            for ci in snapshot.currency_metadata:
                if ci.api_id.lower() == currency.lower() and ci.item_id:
                    ds_result = await ds_cache.get_or_fetch(
                        provider.get_daily_stats,
                        config.league.league_name,
                        ci.item_id,
                        30,
                    )
                    daily_stats_data = ds_result.value
                    break
        except Exception:
            pass

        if not price_points:
            return None

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


# ---------------------------------------------------------------------------
# Helper: compute anomalies (reuses routes_anomalies logic)
# ---------------------------------------------------------------------------

async def _compute_anomalies(min_alert_score: float = 0.4) -> dict | None:
    """Compute anomaly detection across all currencies using DataSnapshot.

    OPTIMIZATION: Uses DataSnapshot instead of calling provider methods
    directly. Previously this called get_exchange_rates() +
    get_historical_prices() per currency — 15+ ByCategory requests each
    time the WebSocket pushed an update. Now it uses the shared snapshot
    (0 additional API calls).
    """
    try:
        from backend.api.data_snapshot import get_snapshot
        from backend.predictors.anomaly import AnomalyDetector
        import numpy as np

        config = get_settings()
        snapshot = await get_snapshot()

        # Get currencies from snapshot's exchange rates
        currency_set = set()
        for key, rate in snapshot.exchange_rates.items():
            currency_set.add(rate.currency_from)
            currency_set.add(rate.currency_to)
        currencies = list(currency_set)

        detector = AnomalyDetector(config=config)
        alerts = []

        for curr in currencies:
            try:
                # Use snapshot's price histories (0 additional API calls)
                history = snapshot.price_histories.get(curr.lower(), [])
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
            except Exception:
                continue

        return {
            "anomalies": alerts,
            "count": len(alerts),
            "currencies_checked": len(currencies),
            "min_alert_score": min_alert_score,
            "data_available": True,
        }
    except Exception as e:
        logger.error("WS: anomaly computation failed: %s", e)
        return None


# ---------------------------------------------------------------------------
# Helper: compute flips (reuses routes_arbitrage logic)
# ---------------------------------------------------------------------------

async def _compute_flips(min_score: float = 0.0, min_volume: int = 0, limit: int = 50) -> dict | None:
    """Compute flip opportunities using the same logic as the REST endpoint."""
    try:
        from backend.api.routes_arbitrage import _build_flip_opportunities
        from backend.economy.events import get_event_manager

        config = get_settings()
        event_manager = get_event_manager(config)

        opportunities = await _build_flip_opportunities(config)
        filtered = [
            o for o in opportunities
            if o.score >= min_score and o.volume_24h >= min_volume
        ]
        filtered = filtered[:limit]

        return {
            "league": config.league.league_name,
            "total": len(filtered),
            "opportunities": [
                {
                    "currency": o.currency,
                    "score": round(o.score, 4),
                    "spread_after_fees": round(o.spread_after_fees, 6),
                    "volume_24h": o.volume_24h,
                    "momentum": round(o.momentum, 6),
                    "volatility": round(o.volatility, 6),
                    "cluster": o.cluster.value,
                    "bid": round(o.bid, 6),
                    "ask": round(o.ask, 6),
                    "mid_price": round(o.mid_price, 6),
                }
                for o in filtered
            ],
            "event_status": {
                "any_active": event_manager.is_event_active(),
                "affected_currencies": list(event_manager.get_affected_currencies()),
                "summary": event_manager.get_active_event_summary(),
            },
            "data_available": True,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as e:
        logger.error("WS: flips computation failed: %s", e)
        return None


# ---------------------------------------------------------------------------
# Helper: compute events status
# ---------------------------------------------------------------------------

async def _compute_events() -> dict | None:
    """Get current events status."""
    try:
        from backend.economy.events import get_event_manager
        from backend.data.historical import get_historical_store

        config = get_settings()
        event_manager = get_event_manager(config)

        summary = event_manager.get_active_event_summary()
        affected = list(event_manager.get_affected_currencies())
        any_active = event_manager.is_event_active()

        # Get recent events from SQLite for full list
        events_list = []
        try:
            historical_store = get_historical_store(config)
            events = await historical_store.get_events(active_only=False, limit=10)
            for ev in events:
                events_list.append({
                    "event_id": ev.get("event_id", ""),
                    "event_type": ev.get("event_type", ""),
                    "description": ev.get("description", ""),
                    "is_active": ev.get("is_active", False),
                    "affected_currencies": ev.get("affected_currencies", []),
                    "created_at": ev.get("created_at", ""),
                    "expires_at": ev.get("expires_at", ""),
                })
        except Exception:
            pass

        return {
            "any_active": any_active,
            "affected_currencies": affected,
            "summary": summary,
            "recent_events": events_list,
            "data_available": True,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as e:
        logger.error("WS: events computation failed: %s", e)
        return None


# ---------------------------------------------------------------------------
# WebSocket endpoint: Anomalies
# ---------------------------------------------------------------------------

@router.websocket("/ws/anomalies")
async def ws_anomalies(websocket: WebSocket):
    """WebSocket endpoint that pushes anomaly detection updates.

    Query params:
        min_alert_score: Minimum alert score to include (default 0.4)

    Messages sent:
        {"type": "update", "data": {...}, "timestamp": "..."}
        {"type": "heartbeat"}
        {"type": "error", "message": "..."}
    """
    await websocket.accept()
    logger.info("WS /ws/anomalies: client connected")

    min_alert_score = 0.4
    if websocket.query_params.get("min_alert_score"):
        try:
            min_alert_score = max(0.0, min(1.0, float(websocket.query_params["min_alert_score"])))
        except (ValueError, TypeError):
            pass

    push_task = asyncio.create_task(
        _push_loop(websocket, "anomalies", "all",
                   lambda: _compute_anomalies(min_alert_score))
    )
    hb_task = asyncio.create_task(_heartbeat_loop(websocket))

    try:
        while True:
            data = await websocket.receive_text()
            if data == "close":
                break
    except WebSocketDisconnect:
        logger.info("WS /ws/anomalies: client disconnected")
    except Exception as e:
        logger.warning("WS /ws/anomalies: connection error: %s", e)
    finally:
        push_task.cancel()
        hb_task.cancel()
        try:
            await websocket.close()
        except Exception:
            pass


# ---------------------------------------------------------------------------
# WebSocket endpoint: Flips
# ---------------------------------------------------------------------------

@router.websocket("/ws/flips")
async def ws_flips(websocket: WebSocket):
    """WebSocket endpoint that pushes flip scoring updates.

    Query params:
        min_score: Minimum score filter (default 0.0)
        min_volume: Minimum 24h volume filter (default 0)
        limit: Max results (default 50)

    Messages sent:
        {"type": "update", "data": {...}, "timestamp": "..."}
        {"type": "heartbeat"}
        {"type": "error", "message": "..."}
    """
    await websocket.accept()
    logger.info("WS /ws/flips: client connected")

    min_score = 0.0
    min_volume = 0
    limit = 50
    try:
        if websocket.query_params.get("min_score"):
            min_score = max(0.0, min(1.0, float(websocket.query_params["min_score"])))
        if websocket.query_params.get("min_volume"):
            min_volume = max(0, int(websocket.query_params["min_volume"]))
        if websocket.query_params.get("limit"):
            limit = max(1, min(200, int(websocket.query_params["limit"])))
    except (ValueError, TypeError):
        pass

    push_task = asyncio.create_task(
        _push_loop(websocket, "flips", "all",
                   lambda: _compute_flips(min_score, min_volume, limit))
    )
    hb_task = asyncio.create_task(_heartbeat_loop(websocket))

    try:
        while True:
            data = await websocket.receive_text()
            if data == "close":
                break
    except WebSocketDisconnect:
        logger.info("WS /ws/flips: client disconnected")
    except Exception as e:
        logger.warning("WS /ws/flips: connection error: %s", e)
    finally:
        push_task.cancel()
        hb_task.cancel()
        try:
            await websocket.close()
        except Exception:
            pass


# ---------------------------------------------------------------------------
# WebSocket endpoint: Events
# ---------------------------------------------------------------------------

@router.websocket("/ws/events")
async def ws_events(websocket: WebSocket):
    """WebSocket endpoint that pushes event notifications.

    Pushes updates when events are created or deactivated,
    as well as periodic summaries of active events.

    Messages sent:
        {"type": "update", "data": {...}, "timestamp": "..."}
        {"type": "heartbeat"}
        {"type": "error", "message": "..."}
    """
    await websocket.accept()
    logger.info("WS /ws/events: client connected")

    push_task = asyncio.create_task(
        _push_loop(websocket, "events", "all",
                   lambda: _compute_events())
    )
    hb_task = asyncio.create_task(_heartbeat_loop(websocket))

    try:
        while True:
            data = await websocket.receive_text()
            if data == "close":
                break
    except WebSocketDisconnect:
        logger.info("WS /ws/events: client disconnected")
    except Exception as e:
        logger.warning("WS /ws/events: connection error: %s", e)
    finally:
        push_task.cancel()
        hb_task.cancel()
        try:
            await websocket.close()
        except Exception:
            pass
