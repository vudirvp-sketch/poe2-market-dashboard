"""
Pydantic Settings that reads config.yaml and exposes a typed configuration object.

Usage:
    from backend.config import get_settings
    settings = get_settings()  # singleton
"""

from __future__ import annotations

import yaml
from pathlib import Path
from functools import lru_cache
from datetime import datetime

from pydantic import BaseModel, Field, field_validator
from pydantic_settings import BaseSettings


# ---------------------------------------------------------------------------
# Nested config models — mirror config.yaml structure exactly
# ---------------------------------------------------------------------------

class DataConfig(BaseModel):
    primary_provider: str = "poe2scout"
    fallback_provider: str = "official"
    poe2scout_base_url: str = "https://api.poe2scout.com/api"
    cache_ttl_prices_minutes: float = 5
    cache_ttl_history_hours: int = 24
    cache_ttl_metadata_hours: int = 1
    rate_limit_per_second: float = 1.0
    historical_retention_days: int = 90


class LeagueConfig(BaseModel):
    league_name: str = "vaal"
    realm: str = "poe2"  # POE2Scout API realm path segment: "poe2" (NOT "poe2/pc")
    league_start_date: str = "2025-01-15T00:00:00Z"
    phase_early_days: int = 7
    phase_mid_days: int = 35
    base_currency: str = "exalted"
    # Known POE2 currency categories for ByCategory pagination
    currency_categories: list[str] = Field(default_factory=lambda: [
        "currency", "fragments", "runes", "essences", "ultimatum",
        "expedition", "ritual", "vaultkeys", "breach", "abyss",
        "uncutgems", "lineagesupportgems", "delirium", "incursion", "idol",
    ])

    @property
    def league_start_datetime(self) -> datetime:
        return datetime.fromisoformat(self.league_start_date.replace("Z", "+00:00"))


class FeesConfig(BaseModel):
    """Fees configuration — currently unused after gold fee removal.
    Kept as a placeholder for future fee models if needed."""
    pass


class FiltersConfig(BaseModel):
    min_volume_24h: int = 50
    max_volatility: float = 0.4
    max_spread: float = 0.15  # Max allowed spread for quick filter
    exclude_volatile_illiquid: bool = False


class ScoringConfig(BaseModel):
    momentum_negative_threshold: float = -0.01
    volatility_reference: float = 0.05
    phase_multiplier_early: float = 1.2
    phase_multiplier_mid: float = 1.0
    phase_multiplier_late: float = 0.9


class ForecastingConfig(BaseModel):
    sarima_seasonal_period: int | None = None  # None = auto-detect
    lightgbm_retrain_interval_hours: int = 6
    lightgbm_mape_trigger: float = 0.15
    lightgbm_min_data_points: int = 15  # Minimum points for LightGBM training (lowered from 30 for reduced data)
    forecast_horizon_hours: int = 24
    confidence_level: float = 0.05


class AnomalyConfig(BaseModel):
    bonferroni_alpha: float = 0.01
    alert_score_threshold: float = 0.4
    rsi_period: int = 14
    rsi_overbought: int = 70
    rsi_oversold: int = 30
    macd_fast: int = 12
    macd_slow: int = 26
    macd_signal: int = 9
    stl_residual_threshold_mad: int = 2
    momentum_sustained_periods: int = 3


class ClusteringConfig(BaseModel):
    n_clusters: int = 3
    recluster_interval_hours: int = 1


class PortfolioConfig(BaseModel):
    method: str = "risk_parity"  # "risk_parity" or "min_variance"
    correlation_shock_threshold: float = 0.5
    correlation_shock_position_reduction: float = 0.5
    ledoit_wolf_shrinkage: bool = True
    rebalance_interval_hours: int = 24


class EventsConfig(BaseModel):
    default_expiry_hours: int = 48
    event_score_penalty: float = 0.5


class SchedulerConfig(BaseModel):
    """Configuration for the background data scheduler (Phase 2, Spec Section 7)."""
    enabled: bool = True
    price_snapshot_interval_minutes: int = 30
    reclustering_interval_hours: int = 1
    model_retrain_interval_hours: int = 6
    model_persistence_interval_minutes: int = 30
    event_pruning_interval_minutes: int = 15


class StorageValueConfig(BaseModel):
    buy_threshold: float = 1.03
    sell_threshold: float = 0.97
    liquidity_normalization: float = 10.0


class AppConfig(BaseModel):
    """Root configuration model matching config.yaml structure."""
    data: DataConfig = DataConfig()
    league: LeagueConfig = LeagueConfig()
    fees: FeesConfig = FeesConfig()
    filters: FiltersConfig = FiltersConfig()
    scoring: ScoringConfig = ScoringConfig()
    forecasting: ForecastingConfig = ForecastingConfig()
    anomaly: AnomalyConfig = AnomalyConfig()
    clustering: ClusteringConfig = ClusteringConfig()
    portfolio: PortfolioConfig = PortfolioConfig()
    events: EventsConfig = EventsConfig()
    storage_value: StorageValueConfig = StorageValueConfig()
    scheduler: SchedulerConfig = SchedulerConfig()
    vendor_recipes: list[dict] = []


def load_config_from_yaml(yaml_path: str | Path) -> AppConfig:
    """Load configuration from a YAML file, using defaults for missing keys."""
    path = Path(yaml_path)
    if path.exists():
        with open(path, "r", encoding="utf-8") as f:
            raw = yaml.safe_load(f) or {}
    else:
        raw = {}
    return AppConfig(**raw)


# ---------------------------------------------------------------------------
# Singleton accessor
# ---------------------------------------------------------------------------

_CONFIG_YAML_PATH = Path(__file__).resolve().parent.parent / "config.yaml"


@lru_cache(maxsize=1)
def get_settings() -> AppConfig:
    """Return the application configuration (cached singleton).

    Reads from config.yaml in the project root. If the file is missing,
    all defaults from the Pydantic models are used.
    """
    return load_config_from_yaml(_CONFIG_YAML_PATH)
