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
    # CORS proxy URL for backend — when poe2scout.com is blocked in the
    # backend's network, set this to a Cloudflare Worker URL so the
    # Poe2ScoutProvider can route requests through the proxy.
    # Example: "https://poe2scout-proxy.your-account.workers.dev/api"
    # Can also be set via POE2SCOUT_CORS_PROXY_URL env var (takes precedence).
    cors_proxy_url: str = ""
    # Enable automatic fallback to CORS proxy when primary URL fails.
    # When True, _request() will retry through cors_proxy_url on
    # connection errors (not on 4xx/5xx responses from the API itself).
    cors_proxy_fallback_enabled: bool = True
    cache_ttl_prices_minutes: float = 5
    cache_ttl_history_hours: int = 24
    cache_ttl_metadata_hours: int = 1
    rate_limit_per_second: float = 1.0
    historical_retention_days: int = 90


class LeagueConfig(BaseModel):
    league_name: str = "runes"  # Override in config.yaml when league changes
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
        "verisium", "vaal",  # Runes of Aldur league categories
    ])

    @property
    def league_start_datetime(self) -> datetime:
        return datetime.fromisoformat(self.league_start_date.replace("Z", "+00:00"))


class FeesConfig(BaseModel):
    """Fees configuration — currently unused after gold fee removal.
    Kept as a placeholder for future fee models if needed."""
    pass


class FiltersConfig(BaseModel):
    min_volume_24h: int = 200  # RAISED from 50 to 200: more aggressive low-liquidity filtering
    max_volatility: float = 0.4
    max_spread: float = 0.15  # Max allowed spread for quick filter
    exclude_volatile_illiquid: bool = False


class ScoringConfig(BaseModel):
    momentum_negative_threshold: float = -0.01
    volatility_reference: float = 0.05
    phase_multiplier_early: float = 1.2
    phase_multiplier_mid: float = 1.0
    phase_multiplier_late: float = 0.9
    # FIX: Added flashback and event multipliers for league type support
    flashback_multiplier: float = 1.5
    event_multiplier: float = 2.0


class ForecastingConfig(BaseModel):
    sarima_seasonal_period: int | None = None  # None = auto-detect
    lightgbm_retrain_interval_hours: int = 6
    lightgbm_mape_trigger: float = 0.15
    lightgbm_min_data_points: int = 15  # Minimum points for LightGBM training (lowered from 30 for reduced data)
    forecast_horizon_hours: int = 24
    significance_level: float = 0.05  # alpha — confidence = 1 - alpha = 0.95


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


class TierBoundaryConfig(BaseModel):
    """Tier boundary thresholds based on RelativePrice ONLY.
    Do NOT hardcode currency names — different leagues have different RelativePrice values."""
    t0_min: float = 50.0
    t1_min: float = 10.0
    t2_min: float = 1.0
    t3_min: float = 0.1
    t4_min: float = 0.01


class TierConfig(BaseModel):
    boundaries: TierBoundaryConfig = TierBoundaryConfig()


class QuantizationConfig(BaseModel):
    default_lot_sizes: list[int] = [1, 5, 10, 50, 100]
    max_lot_search: int = 10000
    brick_resistance_weight: float = 0.2


class BenchmarksConfig(BaseModel):
    lookback_days: int = 30
    include_league_lifetime: bool = True


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
    # P1-3: Tier classification config
    tiers: TierConfig = TierConfig()
    # P1-1: Quantization config
    quantization: QuantizationConfig = QuantizationConfig()
    # P1-5: Historical benchmarks config
    benchmarks: BenchmarksConfig = BenchmarksConfig()


def load_config_from_yaml(yaml_path: str | Path) -> AppConfig:
    """Load configuration from a YAML file, using defaults for missing keys.

    Environment variable overrides (take precedence over config.yaml):
      POE2SCOUT_BASE_URL    — overrides data.poe2scout_base_url
      POE2SCOUT_CORS_PROXY_URL — overrides data.cors_proxy_url
    """
    import os

    path = Path(yaml_path)
    if path.exists():
        with open(path, "r", encoding="utf-8") as f:
            raw = yaml.safe_load(f) or {}
    else:
        raw = {}

    # Apply environment variable overrides
    env_base_url = os.environ.get("POE2SCOUT_BASE_URL")
    if env_base_url:
        raw.setdefault("data", {})["poe2scout_base_url"] = env_base_url.rstrip("/")

    env_cors_proxy = os.environ.get("POE2SCOUT_CORS_PROXY_URL")
    if env_cors_proxy:
        raw.setdefault("data", {})["cors_proxy_url"] = env_cors_proxy.rstrip("/")

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
