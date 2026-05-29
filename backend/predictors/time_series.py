"""
Time Series Forecasting for PoE2 Currency Markets.

From PoE2_Flipper_Implementation_Spec.md §4.1:
All time series models operate on log-prices (not raw prices).
The prediction is converted back to price space only at the final output step.

Models:
1. SARIMA — auto_arima with ADF test for stationarity
2. Holt-Winters — exponential smoothing (short-horizon secondary opinion)
3. LightGBM — primary short-horizon model with feature engineering

Model Agreement:
- When SARIMA and LightGBM diverge >20%, flag disagreement=True
- The "official" forecast on the main dashboard is LightGBM (primary)

Event Flag Behavior:
- SARIMA: labeled low_confidence=True when event active
- Holt-Winters: disabled entirely when event active
- LightGBM: includes is_event_active feature

AGENTS MUST NOT invent their own formulas.
All math must be copied from PoE2_Flipper_Canonical_Formulas.md §11.
"""

from __future__ import annotations

import logging
import warnings
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from typing import Optional

import numpy as np
import pandas as pd

from backend.config import AppConfig, ForecastingConfig, get_settings
from backend.models.currency import ForecastResult

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# §11. ADF Test for Stationarity
# ---------------------------------------------------------------------------

def check_stationarity(
    series: np.ndarray,
    significance: float = 0.05,
) -> tuple[bool, float, int]:
    """Check stationarity using ADF test.

    From PoE2_Flipper_Canonical_Formulas.md §11:
        Returns: (is_stationary, p_value, recommended_d)

    If the series is non-stationary, difference it and test again.
    d=0 if stationary, d=1 if first difference is stationary,
    d=2 if second difference is stationary (warn: may be unsuitable).

    Edge case: a constant series (all values identical) is trivially
    stationary with d=0. statsmodels adfuller raises ValueError for
    constant input, so we handle it explicitly.
    """
    from statsmodels.tsa.stattools import adfuller

    # Handle constant series: ADF test raises ValueError for constant input.
    # A constant series is trivially stationary (no unit root possible).
    if np.max(series) == np.min(series):
        return True, 0.0, 0

    try:
        result = adfuller(series, autolag='AIC')
    except ValueError:
        # Catch any other ValueError from ADF (e.g., degenerate input)
        logger.warning("ADF test raised ValueError; treating series as stationary with d=0.")
        return True, 0.0, 0

    p_value = result[1]

    if p_value <= significance:
        return True, p_value, 0

    # Difference once and test again
    diff1 = np.diff(series)

    # Check if first difference is constant
    if np.max(diff1) == np.min(diff1):
        return False, p_value, 1

    try:
        result1 = adfuller(diff1, autolag='AIC')
    except ValueError:
        return False, p_value, 1

    p1 = result1[1]
    if p1 <= significance:
        return False, p_value, 1

    # Difference twice
    diff2 = np.diff(diff1)

    # Check if second difference is constant
    if len(diff2) == 0 or np.max(diff2) == np.min(diff2):
        return False, p_value, 2

    try:
        result2 = adfuller(diff2, autolag='AIC')
    except ValueError:
        return False, p_value, 2

    p2 = result2[1]
    if p2 <= significance:
        return False, p_value, 2

    # Warn: data may be unsuitable
    logger.warning(
        "Series still non-stationary after d=2 (p=%.4f). Using d=2 as best effort.",
        p2,
    )
    return False, p_value, 2


# ---------------------------------------------------------------------------
# Seasonal Period Detection
# ---------------------------------------------------------------------------

def detect_seasonal_period(
    timestamps: list[datetime] | None = None,
    n_observations: int = 0,
) -> int:
    """Auto-detect seasonal period from data frequency.

    From spec §4.1:
        - Seasonal period: 168 (weekly, if hourly data) or 7 (if daily data).
        - Auto-detect from data frequency.

    Strategy:
        - If timestamps provided, compute median time delta and classify.
        - If only n_observations given, use heuristic based on count.
        - Default to 7 (daily) if unclear.
    """
    if timestamps and len(timestamps) >= 2:
        # Compute median time delta between consecutive observations
        deltas = []
        for i in range(1, len(timestamps)):
            dt = timestamps[i] - timestamps[i - 1]
            deltas.append(dt.total_seconds())

        if deltas:
            median_delta = np.median(deltas)
            # Classify: < 2 hours = hourly, > 12 hours = daily
            if median_delta < 7200:  # less than 2 hours
                return 168  # weekly (168 hours)
            elif median_delta > 43200:  # more than 12 hours
                return 7  # weekly (7 days)
            else:
                return 7  # default to daily

    # Heuristic: if we have many observations, assume hourly
    if n_observations > 200:
        return 168  # weekly for hourly data
    return 7  # default: weekly for daily data


# ---------------------------------------------------------------------------
# 1. SARIMA Forecast (§4.1)
# ---------------------------------------------------------------------------

def forecast_sarima(
    log_prices: np.ndarray,
    horizon: int = 24,
    seasonal_period: int | None = None,
    timestamps: list[datetime] | None = None,
    is_event_active: bool = False,
) -> ForecastResult | None:
    """SARIMA forecast with auto_arima.

    From spec §4.1:
        - Seasonal period: auto-detect from data frequency.
        - Before fitting: ADF test. If p-value > 0.05, d=1; if still non-stationary, d=2.
        - Order (p,d,q) and seasonal order (P,D,Q,s): auto-selected via
          pmdarima.auto_arima with stepwise=True, max_p=3, max_q=3, max_P=2, max_Q=2.
        - Forecast horizon: configurable, default 24h.
        - Confidence interval: 95%.
        - Event flag behavior: labeled low_confidence=True when event active.

    All computations in log-price space; convert back to price space at output.
    """
    try:
        import pmdarima as pm
    except ImportError:
        logger.warning("pmdarima not installed. SARIMA forecast unavailable.")
        return None

    if len(log_prices) < 10:
        logger.warning("SARIMA: insufficient data (%d points, need >= 10).", len(log_prices))
        return None

    # Auto-detect seasonal period
    if seasonal_period is None:
        seasonal_period = detect_seasonal_period(timestamps, len(log_prices))

    # ADF test for stationarity (§11)
    is_stationary, p_value, recommended_d = check_stationarity(log_prices)

    # Ensure seasonal period doesn't exceed data length
    if seasonal_period >= len(log_prices):
        seasonal_period = max(2, len(log_prices) // 2)

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")

            model = pm.auto_arima(
                log_prices,
                start_p=0, start_q=0,
                max_p=3, max_q=3,
                d=recommended_d,
                start_P=0, start_Q=0,
                max_P=2, max_Q=2,
                seasonal=True,
                m=seasonal_period,
                stepwise=True,
                suppress_warnings=True,
                error_action='warn',
                trace=False,
            )

            # Forecast with 95% CI
            forecast, conf_int = model.predict(
                n_periods=horizon,
                return_conf_int=True,
                alpha=0.05,  # 95% CI
            )

        # forecast and conf_int are in log-price space — convert to price space
        point_forecast = np.exp(forecast).tolist()
        ci_lower = np.exp(conf_int[:, 0]).tolist()
        ci_upper = np.exp(conf_int[:, 1]).tolist()

        # Generate timestamps for the forecast horizon
        now = datetime.now(timezone.utc)
        if timestamps and len(timestamps) > 0:
            # Use the last timestamp as the starting point
            last_ts = timestamps[-1]
            if last_ts.tzinfo is None:
                last_ts = last_ts.replace(tzinfo=timezone.utc)
            # Estimate frequency from data
            if len(timestamps) >= 2:
                median_delta = np.median([
                    (timestamps[i] - timestamps[i - 1]).total_seconds()
                    for i in range(1, len(timestamps))
                ])
                freq_seconds = max(median_delta, 3600)  # at least 1 hour
            else:
                freq_seconds = 3600
        else:
            last_ts = now
            freq_seconds = 3600  # default: hourly

        forecast_timestamps = [
            last_ts + timedelta(seconds=freq_seconds * (i + 1))
            for i in range(horizon)
        ]

        return ForecastResult(
            currency="",  # filled by caller
            model_name="sarima",
            point_forecast=point_forecast,
            ci_lower=ci_lower,
            ci_upper=ci_upper,
            timestamps=forecast_timestamps,
            low_confidence=is_event_active,  # §4.1: labeled when event active
            disagreement=False,  # set by caller after comparing with LightGBM
            mape=None,
        )

    except Exception as e:
        logger.warning("SARIMA forecast failed: %s", e)
        return None


# ---------------------------------------------------------------------------
# 2. Holt-Winters Forecast (§4.1)
# ---------------------------------------------------------------------------

def forecast_holt_winters(
    log_prices: np.ndarray,
    horizon: int = 24,
    seasonal_period: int | None = None,
    timestamps: list[datetime] | None = None,
    is_event_active: bool = False,
) -> ForecastResult | None:
    """Holt-Winters exponential smoothing forecast.

    From spec §4.1:
        - Used only for short-horizon (24-48h) forecasts as secondary opinion.
        - Exponential smoothing with trend and seasonality.
        - statsmodels.tsa.holtwinters.ExponentialSmoothing with
          trend='add', seasonal='add', seasonal_periods=same as SARIMA.
        - Event flag behavior: When event flag is active, Holt-Winters is
          disabled entirely. Return no forecast.

    All computations in log-price space; convert back to price space at output.
    """
    # §4.1: "When an event flag is active, Holt-Winters is disabled entirely."
    if is_event_active:
        logger.info("Holt-Winters suspended due to market event.")
        return None

    if len(log_prices) < 10:
        logger.warning("Holt-Winters: insufficient data (%d points, need >= 10).", len(log_prices))
        return None

    # Auto-detect seasonal period
    if seasonal_period is None:
        seasonal_period = detect_seasonal_period(timestamps, len(log_prices))

    # Ensure we have enough data for the seasonal period
    if seasonal_period >= len(log_prices):
        seasonal_period = max(2, len(log_prices) // 2)

    try:
        from statsmodels.tsa.holtwinters import ExponentialSmoothing

        with warnings.catch_warnings():
            warnings.simplefilter("ignore")

            model = ExponentialSmoothing(
                log_prices,
                trend='add',
                seasonal='add',
                seasonal_periods=seasonal_period,
                initialization_method="estimated",
            )
            fitted = model.fit()

            # Forecast with 95% CI
            # statsmodels ExponentialSmoothing doesn't provide CI directly,
            # so we estimate CI from residuals
            forecast_log = fitted.forecast(horizon)

            # Estimate prediction interval from residual std
            residuals = fitted.resid
            residual_std = float(np.std(residuals, ddof=1))

            # Approximate 95% CI: forecast ± 1.96 * residual_std * sqrt(h)
            # This is a simplified CI; for a more accurate one, we'd need
            # simulation-based methods.
            ci_multiplier = 1.96  # 95% CI for normal distribution
            ci_lower_log = forecast_log - ci_multiplier * residual_std * np.sqrt(np.arange(1, horizon + 1))
            ci_upper_log = forecast_log + ci_multiplier * residual_std * np.sqrt(np.arange(1, horizon + 1))

        # Convert to price space
        point_forecast = np.exp(forecast_log).tolist()
        ci_lower = np.exp(ci_lower_log).tolist()
        ci_upper = np.exp(ci_upper_log).tolist()

        # Generate timestamps
        now = datetime.now(timezone.utc)
        if timestamps and len(timestamps) > 0:
            last_ts = timestamps[-1]
            if last_ts.tzinfo is None:
                last_ts = last_ts.replace(tzinfo=timezone.utc)
            if len(timestamps) >= 2:
                median_delta = np.median([
                    (timestamps[i] - timestamps[i - 1]).total_seconds()
                    for i in range(1, len(timestamps))
                ])
                freq_seconds = max(median_delta, 3600)
            else:
                freq_seconds = 3600
        else:
            last_ts = now
            freq_seconds = 3600

        forecast_timestamps = [
            last_ts + timedelta(seconds=freq_seconds * (i + 1))
            for i in range(horizon)
        ]

        return ForecastResult(
            currency="",  # filled by caller
            model_name="holt_winters",
            point_forecast=point_forecast,
            ci_lower=ci_lower,
            ci_upper=ci_upper,
            timestamps=forecast_timestamps,
            low_confidence=is_event_active,
            disagreement=False,
            mape=None,
        )

    except Exception as e:
        logger.warning("Holt-Winters forecast failed: %s", e)
        return None


# ---------------------------------------------------------------------------
# 3. LightGBM Forecast (§4.1)
# ---------------------------------------------------------------------------

@dataclass
class LightGBMFeatureConfig:
    """Configuration for LightGBM feature engineering.

    From spec §4.1:
        Features (all required unless marked optional):
        - Price lag features: log_price_lag_1, log_price_lag_3, log_price_lag_6,
          log_price_lag_12, log_price_lag_24
        - Volume lag features: log_volume_lag_1, log_volume_lag_24
        - Rolling statistics: rolling_mean_6, rolling_std_6,
          rolling_mean_24, rolling_std_24
        - Calendar: hour_of_day, day_of_week
        - Event indicator: is_event_active (binary)
        - (Optional) player_count — only if data source available

        Target: log_price_next (next period's log-price)

        Training: rolling window of last 14 days.
        Retrain every 6 hours or when MAPE > 15%.

        Prediction output: point forecast + 95% CI estimated via quantile
        regression (LightGBM with objective='quantile' for alpha=0.05 and
        alpha=0.95 as separate models).
    """
    price_lags: list[int] = field(default_factory=lambda: [1, 3, 6, 12, 24])
    volume_lags: list[int] = field(default_factory=lambda: [1, 24])
    rolling_windows: list[int] = field(default_factory=lambda: [6, 24])
    use_calendar: bool = True
    use_event_indicator: bool = True


def build_features(
    log_prices: np.ndarray,
    volumes: np.ndarray | None = None,
    timestamps: list[datetime] | None = None,
    is_event_active: bool = False,
    config: LightGBMFeatureConfig | None = None,
) -> pd.DataFrame:
    """Build feature matrix for LightGBM from log-price series.

    Args:
        log_prices: Array of log-prices (oldest to newest)
        volumes: Optional array of volume data (same length as log_prices)
        timestamps: Optional list of timestamps for calendar features
        is_event_active: Whether an event flag is currently active
        config: Feature engineering configuration

    Returns:
        DataFrame with feature columns and 'log_price_next' target column.
        Rows with NaN values due to lagging are NOT dropped — the caller
        should handle this (e.g., dropna before training).
    """
    cfg = config or LightGBMFeatureConfig()
    n = len(log_prices)
    df = pd.DataFrame()
    df['log_price'] = log_prices

    # Price lag features
    for lag in cfg.price_lags:
        if lag < n:
            df[f'log_price_lag_{lag}'] = df['log_price'].shift(lag)

    # Volume lag features (if volume data available)
    if volumes is not None and len(volumes) == n:
        log_volumes = np.log1p(np.maximum(volumes, 0))  # log1p to handle zeros
        df['log_volume'] = log_volumes
        for lag in cfg.volume_lags:
            if lag < n:
                df[f'log_volume_lag_{lag}'] = df['log_volume'].shift(lag)

    # Rolling statistics
    for window in cfg.rolling_windows:
        if window < n:
            df[f'rolling_mean_{window}'] = df['log_price'].rolling(window=window).mean()
            df[f'rolling_std_{window}'] = df['log_price'].rolling(window=window).std()

    # Calendar features
    if cfg.use_calendar and timestamps and len(timestamps) == n:
        df['hour_of_day'] = [ts.hour for ts in timestamps]
        df['day_of_week'] = [ts.weekday() for ts in timestamps]

    # Event indicator
    if cfg.use_event_indicator:
        df['is_event_active'] = int(is_event_active)

    # Target: next period's log-price
    df['log_price_next'] = df['log_price'].shift(-1)

    return df


def compute_mape(actual: np.ndarray, predicted: np.ndarray) -> float:
    """Compute Mean Absolute Percentage Error.

    Returns MAPE as a fraction (e.g., 0.15 = 15%).
    """
    mask = actual != 0
    if not np.any(mask):
        return float('inf')
    return float(np.mean(np.abs((actual[mask] - predicted[mask]) / actual[mask])))


class LightGBMForecaster:
    """LightGBM-based forecaster with quantile regression for CI.

    From spec §4.1:
        - Primary short-horizon forecasting model.
        - Training: rolling window of last 14 days.
        - Retrain every 6 hours or when MAPE > 15%.
        - Prediction: point forecast + 95% CI via quantile regression
          (LightGBM with objective='quantile' for alpha=0.05 and
          alpha=0.95 as separate models).
    """

    def __init__(
        self,
        config: AppConfig | None = None,
        feature_config: LightGBMFeatureConfig | None = None,
        model_store=None,  # ModelStore instance (Phase 2, Spec §7.5)
    ):
        cfg = config or get_settings()
        self._fc_cfg = cfg.forecasting
        self._feature_config = feature_config or LightGBMFeatureConfig()
        self._currency: str = ""  # set by caller or from model_store loading

        self._model_median = None  # point forecast model
        self._model_lower = None   # 5th percentile model
        self._model_upper = None   # 95th percentile model

        self._last_trained_at: datetime | None = None
        self._training_mape: float | None = None
        self._retraining_triggered: bool = False

        # Phase 2 (Spec §7.5): Model persistence via ModelStore
        self._model_store = model_store
        if self._model_store is None:
            try:
                from backend.predictors.model_store import get_model_store
                self._model_store = get_model_store()
            except ImportError:
                self._model_store = None

    @property
    def last_trained_at(self) -> datetime | None:
        return self._last_trained_at

    @property
    def training_mape(self) -> float | None:
        return self._training_mape

    @property
    def retraining_triggered(self) -> bool:
        return self._retraining_triggered

    def _should_retrain(self, current_time: datetime | None = None) -> bool:
        """Check if retraining is needed based on time or MAPE trigger."""
        if self._model_median is None:
            return True  # never trained

        now = current_time or datetime.now(timezone.utc)
        if self._last_trained_at is None:
            return True

        hours_since_train = (now - self._last_trained_at).total_seconds() / 3600
        if hours_since_train >= self._fc_cfg.lightgbm_retrain_interval_hours:
            return True

        # MAPE trigger
        if self._training_mape is not None and self._training_mape > self._fc_cfg.lightgbm_mape_trigger:
            self._retraining_triggered = True
            return True

        return False

    def train(
        self,
        log_prices: np.ndarray,
        volumes: np.ndarray | None = None,
        timestamps: list[datetime] | None = None,
        is_event_active: bool = False,
    ) -> None:
        """Train the LightGBM models (median, lower, upper quantiles).

        From spec §4.1:
            Training: rolling window of last 14 days.
            Target: log_price_next (next period's log-price)
        """
        try:
            import lightgbm as lgb
        except ImportError:
            logger.warning("lightgbm not installed. LightGBM forecast unavailable.")
            return

        # Minimum data points for training.
        # Lowered from 30 to 15 so that DailyStatsHistory with reduced data
        # (e.g. 5-9 days for new currencies) can still produce a forecast
        # with simplified features.
        min_points = getattr(self._fc_cfg, 'lightgbm_min_data_points', 15)
        if len(log_prices) < min_points:
            logger.warning(
                "LightGBM: insufficient data for training (%d points, need >= %d).",
                len(log_prices), min_points,
            )
            return

        # When data is sparse (< 30 points), use a simplified feature config
        # that only includes small lags to avoid dropping too many rows via NaN.
        effective_config = self._feature_config
        if len(log_prices) < 30:
            effective_config = LightGBMFeatureConfig(
                price_lags=[lag for lag in self._feature_config.price_lags if lag < len(log_prices) // 2],
                volume_lags=[lag for lag in self._feature_config.volume_lags if lag < len(log_prices) // 2],
                rolling_windows=[w for w in self._feature_config.rolling_windows if w < len(log_prices) // 2],
                use_calendar=self._feature_config.use_calendar,
                use_event_indicator=self._feature_config.use_event_indicator,
            )
            logger.info(
                "LightGBM: using simplified features for %d points (lags=%s, windows=%s)",
                len(log_prices),
                effective_config.price_lags,
                effective_config.rolling_windows,
            )

        # Build features
        df = build_features(log_prices, volumes, timestamps, is_event_active, effective_config)

        # Drop rows with NaN (due to lagging)
        df = df.dropna()

        if len(df) < 10:
            logger.warning("LightGBM: insufficient clean data after feature building (%d rows).", len(df))
            return

        # Split features and target
        target_col = 'log_price_next'
        feature_cols = [c for c in df.columns if c not in ('log_price', 'log_price_next', 'log_volume')]

        X = df[feature_cols].values
        y = df[target_col].values

        # Common training parameters
        common_params = {
            'n_estimators': 100,
            'learning_rate': 0.05,
            'num_leaves': 31,
            'min_child_samples': 5,
            'subsample': 0.8,
            'colsample_bytree': 0.8,
            'random_state': 42,
            'verbose': -1,
        }

        # Train median (point forecast) model
        self._model_median = lgb.LGBMRegressor(
            objective='regression',
            **common_params,
        )
        self._model_median.fit(X, y)

        # Train lower quantile (5th percentile) model
        self._model_lower = lgb.LGBMRegressor(
            objective='quantile',
            alpha=0.05,
            **common_params,
        )
        self._model_lower.fit(X, y)

        # Train upper quantile (95th percentile) model
        self._model_upper = lgb.LGBMRegressor(
            objective='quantile',
            alpha=0.95,
            **common_params,
        )
        self._model_upper.fit(X, y)

        # Compute training MAPE on the last portion of data
        y_pred = self._model_median.predict(X)
        self._training_mape = compute_mape(y, y_pred)
        self._last_trained_at = datetime.now(timezone.utc)

        # Phase 2 (Spec §7.5): Persist trained models to ModelStore
        if self._model_store is not None and self._currency:
            for model_type, model_obj in [
                ("median", self._model_median),
                ("lower", self._model_lower),
                ("upper", self._model_upper),
            ]:
                self._model_store.register_in_memory(
                    self._currency, model_type, model_obj,
                    {
                        "trained_at": self._last_trained_at.isoformat(),
                        "mape": self._training_mape if model_type == "median" else None,
                        "n_samples": len(df),
                        "n_features": X.shape[1],
                    },
                )

        logger.info(
            "LightGBM trained: %d samples, MAPE=%.4f",
            len(df), self._training_mape,
        )

    def predict(
        self,
        log_prices: np.ndarray,
        horizon: int = 24,
        volumes: np.ndarray | None = None,
        timestamps: list[datetime] | None = None,
        is_event_active: bool = False,
        current_time: datetime | None = None,
    ) -> ForecastResult | None:
        """Generate forecast using trained LightGBM models.

        Uses iterative prediction: each prediction feeds back as a lag
        for the next step.

        Args:
            log_prices: Historical log-prices (oldest to newest)
            horizon: Number of periods to forecast
            volumes: Optional volume data
            timestamps: Optional timestamps for calendar features
            is_event_active: Whether event flag is active
            current_time: Current time (for retraining check)

        Returns:
            ForecastResult with point forecast and 95% CI in price space,
            or None if prediction fails.
        """
        if self._should_retrain(current_time):
            self.train(log_prices, volumes, timestamps, is_event_active)

        if self._model_median is None:
            # Phase 2 (Spec §7.5): Try loading from ModelStore
            if self._model_store is not None and self._currency:
                loaded = self._model_store.load_all_models_for_currency(self._currency)
                self._model_median, median_meta = loaded.get("median", (None, None))
                self._model_lower, _ = loaded.get("lower", (None, None))
                self._model_upper, _ = loaded.get("upper", (None, None))
                if self._model_median is not None and median_meta:
                    self._last_trained_at = datetime.fromisoformat(
                        median_meta.get("trained_at", "")
                    ) if median_meta.get("trained_at") else None
                    self._training_mape = median_meta.get("mape")
                    logger.info(
                        "LightGBM: loaded persisted model for %s (trained: %s, MAPE: %s)",
                        self._currency, self._last_trained_at, self._training_mape,
                    )

        if self._model_median is None:
            logger.warning("LightGBM: no trained model available.")
            return None

        try:
            import lightgbm as lgb
        except ImportError:
            return None

        # Iterative forecasting
        working_prices = list(log_prices)
        working_volumes = list(volumes) if volumes is not None else None
        working_timestamps = list(timestamps) if timestamps is not None else None

        point_forecasts = []
        ci_lowers = []
        ci_uppers = []

        for step in range(horizon):
            # Build features from the working series
            working_array = np.array(working_prices)
            df = build_features(
                working_array,
                np.array(working_volumes) if working_volumes is not None else None,
                working_timestamps,
                is_event_active,
                self._feature_config,
            )

            # Take only the last row (most recent)
            last_row = df.iloc[[-1]].dropna(axis=1, how='any')

            if len(last_row) == 0:
                logger.warning("LightGBM: could not build features for step %d.", step)
                break

            feature_cols = [c for c in last_row.columns if c not in ('log_price', 'log_price_next', 'log_volume')]
            X = last_row[feature_cols].values

            # Predict
            pred_median = float(self._model_median.predict(X)[0])
            pred_lower = float(self._model_lower.predict(X)[0])
            pred_upper = float(self._model_upper.predict(X)[0])

            point_forecasts.append(np.exp(pred_median))
            ci_lowers.append(np.exp(pred_lower))
            ci_uppers.append(np.exp(pred_upper))

            # Feed prediction back into working series for next step
            working_prices.append(pred_median)
            if working_volumes is not None:
                working_volumes.append(working_volumes[-1])  # use last known volume
            if working_timestamps is not None:
                # Extrapolate timestamp
                if len(working_timestamps) >= 2:
                    delta = working_timestamps[-1] - working_timestamps[-2]
                    working_timestamps.append(working_timestamps[-1] + delta)
                else:
                    working_timestamps.append(working_timestamps[-1] + timedelta(hours=1))

        if not point_forecasts:
            return None

        # Generate forecast timestamps
        now = datetime.now(timezone.utc)
        if timestamps and len(timestamps) > 0:
            last_ts = timestamps[-1]
            if last_ts.tzinfo is None:
                last_ts = last_ts.replace(tzinfo=timezone.utc)
            if len(timestamps) >= 2:
                median_delta = np.median([
                    (timestamps[i] - timestamps[i - 1]).total_seconds()
                    for i in range(1, len(timestamps))
                ])
                freq_seconds = max(median_delta, 3600)
            else:
                freq_seconds = 3600
        else:
            last_ts = now
            freq_seconds = 3600

        forecast_timestamps = [
            last_ts + timedelta(seconds=freq_seconds * (i + 1))
            for i in range(len(point_forecasts))
        ]

        return ForecastResult(
            currency="",  # filled by caller
            model_name="lightgbm",
            point_forecast=point_forecasts,
            ci_lower=ci_lowers,
            ci_upper=ci_uppers,
            timestamps=forecast_timestamps,
            low_confidence=is_event_active,
            disagreement=False,  # set by caller
            mape=self._training_mape,
        )


# ---------------------------------------------------------------------------
# 4. Model Agreement Check (§4.1)
# ---------------------------------------------------------------------------

def check_model_agreement(
    sarima_forecast: ForecastResult | None,
    lightgbm_forecast: ForecastResult | None,
    divergence_threshold: float = 0.20,
) -> bool:
    """Check if SARIMA and LightGBM forecasts diverge by more than threshold.

    From spec §4.1:
        When SARIMA and LightGBM forecasts diverge by >20% (relative
        difference of point forecasts), flag the forecast as
        disagreement=True.

    Compares the mean of the point forecasts from both models.
    Returns True if disagreement detected.
    """
    if sarima_forecast is None or lightgbm_forecast is None:
        return False  # can't compare if one is missing

    sarima_mean = float(np.mean(sarima_forecast.point_forecast))
    lightgbm_mean = float(np.mean(lightgbm_forecast.point_forecast))

    if sarima_mean == 0 and lightgbm_mean == 0:
        return False

    # Relative difference
    denominator = max(abs(sarima_mean), abs(lightgbm_mean))
    if denominator == 0:
        return False

    relative_diff = abs(sarima_mean - lightgbm_mean) / denominator

    return relative_diff > divergence_threshold


# ---------------------------------------------------------------------------
# 5. STL Decomposition (§4.4, for display in Forecast tab)
# ---------------------------------------------------------------------------

@dataclass
class STLDecomposition:
    """STL decomposition result for display purposes."""
    trend: list[float]
    seasonal: list[float]
    residual: list[float]
    timestamps: list[datetime]
    seasonal_period: int


def compute_stl_decomposition(
    price_series: np.ndarray,
    seasonal_period: int = 7,
    timestamps: list[datetime] | None = None,
) -> STLDecomposition | None:
    """Compute STL decomposition for display in the Forecast tab.

    From spec §7.5:
        STL decomposition sub-charts (trend, seasonal, residual) in a
        collapsible section.

    From §4.4:
        from statsmodels.tsa.seasonal import STL
        result = STL(price_series, period=seasonal_period).fit()
    """
    min_length = max(2 * seasonal_period, seasonal_period + 1)
    if len(price_series) < min_length:
        logger.warning(
            "STL decomposition: insufficient data (%d points, need >= %d).",
            len(price_series), min_length,
        )
        return None

    try:
        from statsmodels.tsa.seasonal import STL

        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            result = STL(price_series, period=seasonal_period).fit()

        # Build timestamps if not provided
        if timestamps is None:
            now = datetime.now(timezone.utc)
            timestamps = [now - timedelta(hours=i) for i in range(len(price_series) - 1, -1, -1)]

        return STLDecomposition(
            trend=result.trend.tolist(),
            seasonal=result.seasonal.tolist(),
            residual=result.resid.tolist(),
            timestamps=timestamps,
            seasonal_period=seasonal_period,
        )

    except Exception as e:
        logger.warning("STL decomposition failed: %s", e)
        return None


# ---------------------------------------------------------------------------
# 6. Unified Forecast Interface
# ---------------------------------------------------------------------------

class ForecastEngine:
    """Unified interface for running all forecasting models.

    Orchestrates SARIMA, Holt-Winters, and LightGBM forecasts,
    checks model agreement, and returns results.
    """

    def __init__(self, config: AppConfig | None = None):
        self._config = config or get_settings()
        self._fc_cfg = self._config.forecasting
        self._lgbm = LightGBMForecaster(self._config)

    def forecast(
        self,
        currency: str,
        price_series: np.ndarray,
        volumes: np.ndarray | None = None,
        timestamps: list[datetime] | None = None,
        is_event_active: bool = False,
        seasonal_period: int | None = None,
    ) -> dict[str, ForecastResult]:
        """Run all available forecasting models and return results.

        Args:
            currency: Currency api_id
            price_series: Array of historical prices (oldest to newest)
            volumes: Optional volume data
            timestamps: Optional timestamps
            is_event_active: Whether an event flag is active
            seasonal_period: Seasonal period for STL/SARIMA (auto-detect if None)

        Returns:
            Dict mapping model_name to ForecastResult.
            Keys: 'sarima', 'holt_winters', 'lightgbm'
            Values may be None if a model fails or is disabled.
        """
        # Convert to log-prices (§4.1: "All time series models operate on log-prices")
        prices_safe = np.maximum(price_series, 1e-10)  # avoid log(0)
        log_prices = np.log(prices_safe)

        # Auto-detect seasonal period
        if seasonal_period is None:
            seasonal_period = detect_seasonal_period(timestamps, len(log_prices))

        horizon = self._fc_cfg.forecast_horizon_hours

        results: dict[str, ForecastResult | None] = {}

        # --- SARIMA ---
        sarima_result = forecast_sarima(
            log_prices=log_prices,
            horizon=horizon,
            seasonal_period=seasonal_period,
            timestamps=timestamps,
            is_event_active=is_event_active,
        )
        if sarima_result is not None:
            sarima_result.currency = currency
        results['sarima'] = sarima_result

        # --- Holt-Winters ---
        hw_result = forecast_holt_winters(
            log_prices=log_prices,
            horizon=horizon,
            seasonal_period=seasonal_period,
            timestamps=timestamps,
            is_event_active=is_event_active,
        )
        if hw_result is not None:
            hw_result.currency = currency
        results['holt_winters'] = hw_result

        # --- LightGBM ---
        lgbm_result = self._lgbm.predict(
            log_prices=log_prices,
            horizon=horizon,
            volumes=volumes,
            timestamps=timestamps,
            is_event_active=is_event_active,
        )
        if lgbm_result is not None:
            lgbm_result.currency = currency
        results['lightgbm'] = lgbm_result

        # --- Model Agreement Check ---
        disagreement = check_model_agreement(
            results.get('sarima'),
            results.get('lightgbm'),
        )

        if disagreement:
            logger.info(
                "Forecast disagreement detected for %s: SARIMA vs LightGBM diverge >20%%.",
                currency,
            )
            # Set disagreement flag on both results
            for key in ('sarima', 'lightgbm'):
                if results[key] is not None:
                    results[key].disagreement = True

        # Filter out None values
        return {k: v for k, v in results.items() if v is not None}

    def get_stl_decomposition(
        self,
        price_series: np.ndarray,
        seasonal_period: int = 7,
        timestamps: list[datetime] | None = None,
    ) -> STLDecomposition | None:
        """Compute STL decomposition for display in the Forecast tab."""
        return compute_stl_decomposition(price_series, seasonal_period, timestamps)
