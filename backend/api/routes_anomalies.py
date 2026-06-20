"""
API routes for anomaly detection.

Phase 2 (Spec Section 6): Exposes the already-implemented AnomalyDetector
via a REST endpoint, enabling the frontend forecast tab to display anomaly alerts.

Endpoints:
    GET /api/v1/anomalies — detect anomalies across all currencies or a specific one

PERFORMANCE: Anomaly detection (5 indicators per currency, including STL
decomposition) is CPU-bound. The computation is offloaded to ProcessPoolExecutor
to prevent blocking the asyncio event loop, which would cause health check
timeouts and circuit breaker cascade failures.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

import numpy as np

from fastapi import APIRouter, HTTPException, Query

from backend.config import get_settings
from backend.api.data_snapshot import get_snapshot
from backend.predictors.anomaly import AnomalyDetector
from backend.api.response_models import AnomaliesResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/anomalies", tags=["anomalies"])

# Singleton AnomalyDetector — reuse across requests to avoid re-initialization overhead
_detector: AnomalyDetector | None = None

# Timeout for anomaly detection in executor (seconds).
# STL decomposition for 600+ currencies can take 20-30s.
_EXECUTOR_TIMEOUT = 45.0


def _get_detector() -> AnomalyDetector:
    """Return the shared AnomalyDetector instance (lazy singleton)."""
    global _detector
    if _detector is None:
        _detector = AnomalyDetector(config=get_settings())
    return _detector


def _detect_anomalies_sync(
    currency_price_arrays: dict[str, np.ndarray],
    min_alert_score: float,
) -> list[dict]:
    """CPU-bound anomaly detection — runs in executor process.

    Receives only plain numpy arrays (picklable) instead of the full
    DataSnapshot, which reduces pickle payload size significantly.

    Args:
        currency_price_arrays: Dict mapping currency_id → numpy array of prices.
            Only currencies with >= 30 data points are included.
        min_alert_score: Minimum alert score to include in results.

    Returns:
        List of anomaly alert dicts (plain dicts — picklable).
    """
    detector = _get_detector()
    alerts = []

    for curr, prices in currency_price_arrays.items():
        try:
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

    return alerts


@router.get("", response_model=AnomaliesResponse)
async def get_anomalies(
    currency: str | None = Query(default=None, description="Specific currency API ID, or None for all"),
    min_alert_score: float = Query(default=0.4, ge=0.0, le=1.0, description="Minimum alert score to include"),
):
    """Detect anomalies across all currencies or a specific one.

    Uses cached historical data from Poe2ScoutProvider and the existing
    AnomalyDetector ensemble (5 indicators: Z-score, MACD, RSI, STL, momentum).

    PERFORMANCE: The CPU-bound computation is offloaded to ProcessPoolExecutor
    via loop.run_in_executor() with asyncio.wait_for(timeout=45s) to prevent
    indefinite blocking. This ensures health check endpoints remain responsive
    during heavy computation, preventing circuit breaker cascade failures.

    Args:
        currency: Optional currency API ID to check. If None, checks all monitored currencies.
        min_alert_score: Minimum alert score to include in results (default 0.4).
    """
    try:
        config = get_settings()

        # Get unified data snapshot (single coordinated API pass)
        snapshot = await get_snapshot()

        # Determine which currencies to check and pre-extract price arrays
        currency_price_arrays: dict[str, np.ndarray] = {}

        if currency:
            history = snapshot.price_histories.get(currency.lower(), [])
            if len(history) >= 30:
                currency_price_arrays[currency] = np.array([p.price for p in history])
        else:
            # Extract price arrays from snapshot — only currencies with enough data
            for api_id_lower, points in snapshot.price_histories.items():
                if len(points) < 30:
                    continue
                # Use original-case api_id for output
                curr = snapshot.get_currency(api_id_lower)
                orig_id = curr.get("api_id", api_id_lower) if curr else api_id_lower
                currency_price_arrays[orig_id] = np.array([p.price for p in points])

        if not currency_price_arrays:
            return {
                "anomalies": [],
                "count": 0,
                "currencies_checked": len(currency_price_arrays),
                "min_alert_score": min_alert_score,
                "data_available": False,
            }

        # Check pipeline cache for previously computed anomalies.
        # Skip caching for single-currency queries (cache key includes currency).
        from backend.data.unified_cache import get_pipeline_cache
        pipeline_cache = get_pipeline_cache()
        cache_key = f"anomalies_{currency or 'all'}_{min_alert_score}"
        cached = pipeline_cache.get(cache_key)
        if cached is not None and not cached.stale:
            return cached.value

        # Offload CPU-bound anomaly detection to ProcessPoolExecutor
        # P2-13: use `get_process_pool()` so the pool is re-created if a
        # prior `lifespan` teardown (e.g. from a TestClient test) shut it
        # down.
        loop = asyncio.get_running_loop()
        executor = None
        try:
            from backend.main import get_process_pool
            executor = get_process_pool()
        except (ImportError, AttributeError):
            pass

        try:
            alerts = await asyncio.wait_for(
                loop.run_in_executor(
                    executor,
                    _detect_anomalies_sync,
                    currency_price_arrays,
                    min_alert_score,
                ),
                timeout=_EXECUTOR_TIMEOUT,
            )
        except asyncio.TimeoutError:
            logger.error(
                "Anomaly detection timed out after %.0fs — returning empty result",
                _EXECUTOR_TIMEOUT,
            )
            return {
                "anomalies": [],
                "count": 0,
                "currencies_checked": len(currency_price_arrays),
                "min_alert_score": min_alert_score,
                "data_available": False,
            }

        result = {
            "anomalies": alerts,
            "count": len(alerts),
            "currencies_checked": len(currency_price_arrays),
            "min_alert_score": min_alert_score,
            "data_available": True,
        }

        # Cache the result for subsequent requests (TTL = snapshot TTL)
        pipeline_cache.put(cache_key, result)

        return result
    except Exception as e:
        logger.error("Anomaly detection handler failed: %s", e)
        return {"anomalies": [], "count": 0, "currencies_checked": 0, "min_alert_score": 0.5, "data_available": False}
