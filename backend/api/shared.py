"""
Shared singletons for API route modules.

Centralises provider, phase-detector, and forecast-engine instances
so that every route module uses the **same** object instead of
creating its own duplicate.

Usage:
    from backend.api.shared import get_provider, get_phase_detector, get_forecast_engine
"""

from __future__ import annotations

import logging

from backend.config import AppConfig, get_settings
from backend.data.providers.poe2scout import Poe2ScoutProvider
from backend.economy.lifecycle import PhaseDetector
from backend.predictors.time_series import ForecastEngine

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Module-level singletons (lazily initialised)
# ---------------------------------------------------------------------------

_provider: Poe2ScoutProvider | None = None
_phase_detector: PhaseDetector | None = None
_forecast_engine: ForecastEngine | None = None


def get_provider() -> Poe2ScoutProvider:
    """Return the global Poe2ScoutProvider singleton."""
    global _provider
    if _provider is None:
        _provider = Poe2ScoutProvider()
    return _provider


def get_phase_detector() -> PhaseDetector:
    """Return the global PhaseDetector singleton."""
    global _phase_detector
    if _phase_detector is None:
        config = get_settings()
        _phase_detector = PhaseDetector(
            config.league.league_start_datetime, config
        )
    return _phase_detector


def get_forecast_engine(config: AppConfig | None = None) -> ForecastEngine:
    """Return the global ForecastEngine singleton."""
    global _forecast_engine
    if _forecast_engine is None or config is not None:
        _forecast_engine = ForecastEngine(config)
    return _forecast_engine


async def close_shared() -> None:
    """Close shared resources (call on shutdown)."""
    global _provider
    if _provider is not None:
        await _provider.close()
        _provider = None
