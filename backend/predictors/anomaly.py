"""
Ensemble Anomaly Detection for PoE2 Currency Markets.

From PoE2_Flipper_Canonical_Formulas.md §4:

Five indicators run in parallel. An anomaly alert requires >=2 indicators
to agree within the same time window (±1 period).

Indicators:
1. Z-score with Bonferroni correction: alpha = 0.01 / N_currencies
2. MACD: standard (12, 26, 9) — signal line crossover
3. RSI: 14-period — thresholds 30/70
4. STL residual: |residual| > 2 * MAD of residuals
5. Momentum/acceleration: sustained direction for >=3 consecutive periods

Each indicator has a weight (default: all equal = 0.2, configurable).
The alert_score is the weighted sum of triggered indicators.
Alert is raised if alert_score >= 0.4 (i.e., >=2 indicators).

Output per currency per timestamp:
    AnomalyAlert(
        currency, timestamp, alert_score, triggered_indicators,
        direction, is_confirmed
    )

AGENTS MUST NOT invent their own formulas.
All math must be copied from PoE2_Flipper_Canonical_Formulas.md §4.
"""

from __future__ import annotations

import logging
import warnings
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

import numpy as np
from scipy.stats import norm

from backend.config import AppConfig, AnomalyConfig, get_settings
from backend.models.currency import AnomalyAlert

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helper: EMA calculation (from §4.2)
# ---------------------------------------------------------------------------

def _compute_ema(series: np.ndarray, span: int) -> np.ndarray:
    """Compute Exponential Moving Average.

    From §4.2:
        EMA[t] = alpha * price[t] + (1 - alpha) * EMA[t-1]
        alpha = 2 / (span + 1)

    EMA initialization: First value = first data point. NOT zero, NOT mean.
    """
    if len(series) == 0:
        return np.array([])

    alpha = 2.0 / (span + 1)
    ema = np.empty_like(series, dtype=float)
    ema[0] = series[0]  # §4.2: "First value = first data point. NOT zero, NOT mean."

    for t in range(1, len(series)):
        ema[t] = alpha * series[t] + (1.0 - alpha) * ema[t - 1]

    return ema


# ---------------------------------------------------------------------------
# Indicator 1: Z-Score with Bonferroni Correction (§4.1)
# ---------------------------------------------------------------------------

def compute_zscore_indicator(
    price: float,
    price_history: np.ndarray,
    n_currencies: int,
    bonferroni_alpha: float = 0.01,
) -> tuple[bool, float, str]:
    """Compute Z-score with Bonferroni correction.

    From §4.1:
        mean_i = mean of P_i over lookback window (default: 24 periods)
        std_i  = std(P_i, ddof=1) over same window
        z_score_i = (P_i(t) - mean_i) / std_i

        bonferroni_alpha = 0.01 / N     # N = number of currencies
        threshold = norm.ppf(1 - bonferroni_alpha / 2)   # two-tailed
        triggered = (|z_score_i| > threshold)

    Returns:
        (triggered, z_score, direction)
        direction is "up" if z_score > 0, "down" if z_score < 0
    """
    if len(price_history) < 2:
        return False, 0.0, "up"

    mean_i = float(np.mean(price_history))
    std_i = float(np.std(price_history, ddof=1))

    if std_i == 0:
        # All prices are identical; no anomaly possible
        return False, 0.0, "up"

    z_score = (price - mean_i) / std_i

    # §4.1: Bonferroni correction
    adjusted_alpha = bonferroni_alpha / max(n_currencies, 1)
    # Two-tailed threshold: norm.ppf(1 - alpha/2)
    threshold = float(norm.ppf(1.0 - adjusted_alpha / 2.0))

    triggered = abs(z_score) > threshold
    direction = "up" if z_score > 0 else "down"

    return triggered, z_score, direction


# ---------------------------------------------------------------------------
# Indicator 2: MACD (§4.2)
# ---------------------------------------------------------------------------

def compute_macd_indicator(
    price_series: np.ndarray,
    fast_period: int = 12,
    slow_period: int = 26,
    signal_period: int = 9,
) -> tuple[bool, str, float, float]:
    """Compute MACD and detect signal line crossover.

    From §4.2:
        EMA_fast  = exponential_moving_average(price_series, span=fast_period)
        EMA_slow  = exponential_moving_average(price_series, span=slow_period)
        MACD_line = EMA_fast - EMA_slow
        Signal_line = exponential_moving_average(MACD_line, span=signal_period)

        triggered = crossover(MACD_line, Signal_line)

    Crossover: MACD_line crosses above Signal_line (bullish) or below (bearish)
    within the current period.

    Returns:
        (triggered, direction, macd_value, signal_value)
    """
    if len(price_series) < slow_period:
        # Not enough data for MACD
        return False, "up", 0.0, 0.0

    ema_fast = _compute_ema(price_series, span=fast_period)
    ema_slow = _compute_ema(price_series, span=slow_period)

    macd_line = ema_fast - ema_slow
    signal_line = _compute_ema(macd_line, span=signal_period)

    # Check for crossover in the latest period
    # Crossover = MACD_line crosses Signal_line
    # If previous: MACD < Signal, current: MACD > Signal → bullish crossover (up)
    # If previous: MACD > Signal, current: MACD < Signal → bearish crossover (down)
    if len(macd_line) < 2:
        return False, "up", float(macd_line[-1]), float(signal_line[-1])

    prev_diff = macd_line[-2] - signal_line[-2]
    curr_diff = macd_line[-1] - signal_line[-1]

    triggered = False
    direction = "up"

    # Bullish crossover: MACD crosses above Signal
    if prev_diff <= 0 and curr_diff > 0:
        triggered = True
        direction = "up"
    # Bearish crossover: MACD crosses below Signal
    elif prev_diff >= 0 and curr_diff < 0:
        triggered = True
        direction = "down"

    return triggered, direction, float(macd_line[-1]), float(signal_line[-1])


# ---------------------------------------------------------------------------
# Indicator 3: RSI (§4.3)
# ---------------------------------------------------------------------------

def compute_rsi_indicator(
    price_series: np.ndarray,
    period: int = 14,
    overbought: int = 70,
    oversold: int = 30,
) -> tuple[bool, float, str]:
    """Compute RSI and check overbought/oversold.

    From §4.3:
        period = 14 (default)
        gains = [max(0, price[i] - price[i-1]) for i in range(1, len(prices))]
        losses = [max(0, price[i-1] - price[i]) for i in range(1, len(prices))]
        avg_gain = mean(gains[-period:])
        avg_loss = mean(losses[-period:])

        if avg_loss == 0:
            RSI = 100
        else:
            RS = avg_gain / avg_loss
            RSI = 100 - (100 / (1 + RS))

        overbought = RSI > 70
        oversold   = RSI < 30
        triggered  = overbought or oversold

    Returns:
        (triggered, rsi_value, direction)
        direction: "up" if overbought, "down" if oversold
    """
    if len(price_series) < 2:
        return False, 50.0, "up"

    # Compute gains and losses (§4.3)
    gains = np.maximum(0, np.diff(price_series))
    losses = np.maximum(0, -np.diff(price_series))

    if len(gains) < period:
        # Not enough data for full RSI period; use what we have
        avg_gain = float(np.mean(gains)) if len(gains) > 0 else 0.0
        avg_loss = float(np.mean(losses)) if len(losses) > 0 else 0.0
    else:
        avg_gain = float(np.mean(gains[-period:]))
        avg_loss = float(np.mean(losses[-period:]))

    # §4.3: Handle division by zero
    if avg_loss == 0 and avg_gain == 0:
        # No price movement at all → neutral RSI
        rsi = 50.0
    elif avg_loss == 0:
        # Only gains, no losses → RSI = 100
        rsi = 100.0
    else:
        rs = avg_gain / avg_loss
        rsi = 100.0 - (100.0 / (1.0 + rs))

    # §4.3: thresholds
    is_overbought = rsi > overbought
    is_oversold = rsi < oversold
    triggered = is_overbought or is_oversold

    if is_overbought:
        direction = "up"
    elif is_oversold:
        direction = "down"
    else:
        direction = "up"  # default; not triggered anyway

    return triggered, rsi, direction


# ---------------------------------------------------------------------------
# Indicator 4: STL Residual Anomaly (§4.4)
# ---------------------------------------------------------------------------

def compute_stl_residual_indicator(
    price_series: np.ndarray,
    seasonal_period: int = 7,
    threshold_mad: int = 2,
) -> tuple[bool, float, str]:
    """Compute STL decomposition and check residual anomaly.

    From §4.4:
        from statsmodels.tsa.seasonal import STL
        result = STL(price_series, period=seasonal_period).fit()
        residuals = result.resid
        MAD = median(|residuals - median(residuals)|)
        triggered = (|residuals[-1]| > threshold_mad * MAD)

    Note: Use MAD instead of std because MAD is robust to outliers.
    This prevents a single extreme value from inflating the threshold
    and hiding itself.

    Returns:
        (triggered, last_residual, direction)
    """
    # STL requires at least 2 * seasonal_period observations
    min_length = max(2 * seasonal_period, seasonal_period + 1)

    if len(price_series) < min_length:
        return False, 0.0, "up"

    # If price series has near-zero variation, STL is meaningless
    price_std = float(np.std(price_series, ddof=1))
    if price_std < 1e-10:
        return False, 0.0, "up"

    try:
        from statsmodels.tsa.seasonal import STL

        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            stl_result = STL(price_series, period=seasonal_period).fit()

        residuals = stl_result.resid

        # §4.4: MAD = median(|residuals - median(residuals)|)
        median_resid = np.median(residuals)
        mad = np.median(np.abs(residuals - median_resid))

        if mad == 0:
            # All residuals are identical (perfectly regular series)
            return False, float(residuals[-1]), "up"

        last_residual = float(residuals[-1])
        triggered = abs(last_residual) > threshold_mad * mad

        direction = "up" if last_residual > 0 else "down"

        return triggered, last_residual, direction

    except Exception as e:
        logger.warning("STL decomposition failed: %s. Skipping STL indicator.", e)
        return False, 0.0, "up"


# ---------------------------------------------------------------------------
# Indicator 5: Sustained Momentum Direction (§4.5)
# ---------------------------------------------------------------------------

def compute_sustained_momentum_indicator(
    price_series: np.ndarray,
    sustained_periods: int = 3,
) -> tuple[bool, str]:
    """Check for sustained momentum direction.

    From §4.5:
        m = config.momentum_sustained_periods   # default: 3

        Check the last m values of log_returns:
        all_positive = all(log_returns[-m:] > 0)
        all_negative = all(log_returns[-m:] < 0)

        triggered = all_positive or all_negative
        direction = "up" if all_positive else "down" if all_negative else None

    Returns:
        (triggered, direction)
    """
    if len(price_series) < sustained_periods + 1:
        return False, "up"

    # §2.1: log_returns[i] = ln(P[i+1] / P[i])
    log_returns = np.diff(np.log(price_series))

    if len(log_returns) < sustained_periods:
        return False, "up"

    recent = log_returns[-sustained_periods:]

    all_positive = bool(np.all(recent > 0))
    all_negative = bool(np.all(recent < 0))

    triggered = all_positive or all_negative

    if all_positive:
        direction = "up"
    elif all_negative:
        direction = "down"
    else:
        direction = "up"  # not triggered; direction irrelevant

    return triggered, direction


# ---------------------------------------------------------------------------
# Ensemble: AnomalyDetector (§4.6)
# ---------------------------------------------------------------------------

@dataclass
class IndicatorResult:
    """Result from a single anomaly indicator."""
    name: str
    triggered: bool
    direction: str
    weight: float
    detail: dict = field(default_factory=dict)  # extra info for debugging/logging


class AnomalyDetector:
    """Ensemble anomaly detector running 5 indicators in parallel.

    From §4.6:
        Each triggered indicator contributes its weight to alert_score.
        Default weights: all equal = 0.2

        alert_score = sum(weight_i for i in triggered_indicators)
        is_confirmed = (alert_score >= threshold)   # default: 0.4

        direction is determined by majority vote of triggered indicators.
    """

    # Indicator names as constants to avoid typos
    ZSCORE = "z_score"
    MACD = "macd"
    RSI = "rsi"
    STL_RESIDUAL = "stl_residual"
    SUSTAINED_MOMENTUM = "sustained_momentum"

    ALL_INDICATORS = [ZSCORE, MACD, RSI, STL_RESIDUAL, SUSTAINED_MOMENTUM]

    def __init__(self, config: AppConfig | None = None):
        cfg = config or get_settings()
        self._anomaly_cfg = cfg.anomaly

        # Default weights: all equal = 0.2 (5 indicators × 0.2 = 1.0)
        self._weights: dict[str, float] = {name: 0.2 for name in self.ALL_INDICATORS}

    @property
    def weights(self) -> dict[str, float]:
        return dict(self._weights)

    @weights.setter
    def weights(self, value: dict[str, float]) -> None:
        """Set custom weights. Must cover all 5 indicators and sum to ~1.0."""
        for name in self.ALL_INDICATORS:
            if name not in value:
                raise ValueError(f"Missing weight for indicator: {name}")
        self._weights = {name: value[name] for name in self.ALL_INDICATORS}

    def detect(
        self,
        currency: str,
        price_series: np.ndarray,
        n_currencies: int = 30,
        timestamp: datetime | None = None,
        current_price: float | None = None,
        seasonal_period: int = 7,
    ) -> AnomalyAlert:
        """Run all 5 anomaly indicators and compute ensemble alert.

        Args:
            currency: Currency identifier (api_id)
            price_series: Array of historical prices (oldest to newest)
            n_currencies: Total number of currencies being monitored
                          (for Bonferroni correction)
            timestamp: Observation timestamp (defaults to now)
            current_price: Current price (defaults to last value in series)
            seasonal_period: Period for STL decomposition (default: 7 for daily data)

        Returns:
            AnomalyAlert with alert_score, triggered indicators, and direction
        """
        ts = timestamp or datetime.now(timezone.utc)
        current = current_price if current_price is not None else (
            float(price_series[-1]) if len(price_series) > 0 else 0.0
        )

        indicator_results: list[IndicatorResult] = []

        # --- Indicator 1: Z-Score with Bonferroni ---
        z_triggered, z_score, z_dir = compute_zscore_indicator(
            price=current,
            price_history=price_series,
            n_currencies=n_currencies,
            bonferroni_alpha=self._anomaly_cfg.bonferroni_alpha,
        )
        indicator_results.append(IndicatorResult(
            name=self.ZSCORE,
            triggered=z_triggered,
            direction=z_dir,
            weight=self._weights[self.ZSCORE],
            detail={"z_score": z_score},
        ))

        # --- Indicator 2: MACD ---
        macd_triggered, macd_dir, macd_val, signal_val = compute_macd_indicator(
            price_series=price_series,
            fast_period=self._anomaly_cfg.macd_fast,
            slow_period=self._anomaly_cfg.macd_slow,
            signal_period=self._anomaly_cfg.macd_signal,
        )
        indicator_results.append(IndicatorResult(
            name=self.MACD,
            triggered=macd_triggered,
            direction=macd_dir,
            weight=self._weights[self.MACD],
            detail={"macd": macd_val, "signal": signal_val},
        ))

        # --- Indicator 3: RSI ---
        rsi_triggered, rsi_val, rsi_dir = compute_rsi_indicator(
            price_series=price_series,
            period=self._anomaly_cfg.rsi_period,
            overbought=self._anomaly_cfg.rsi_overbought,
            oversold=self._anomaly_cfg.rsi_oversold,
        )
        indicator_results.append(IndicatorResult(
            name=self.RSI,
            triggered=rsi_triggered,
            direction=rsi_dir,
            weight=self._weights[self.RSI],
            detail={"rsi": rsi_val},
        ))

        # --- Indicator 4: STL Residual ---
        stl_triggered, stl_residual, stl_dir = compute_stl_residual_indicator(
            price_series=price_series,
            seasonal_period=seasonal_period,
            threshold_mad=self._anomaly_cfg.stl_residual_threshold_mad,
        )
        indicator_results.append(IndicatorResult(
            name=self.STL_RESIDUAL,
            triggered=stl_triggered,
            direction=stl_dir,
            weight=self._weights[self.STL_RESIDUAL],
            detail={"residual": stl_residual},
        ))

        # --- Indicator 5: Sustained Momentum ---
        mom_triggered, mom_dir = compute_sustained_momentum_indicator(
            price_series=price_series,
            sustained_periods=self._anomaly_cfg.momentum_sustained_periods,
        )
        indicator_results.append(IndicatorResult(
            name=self.SUSTAINED_MOMENTUM,
            triggered=mom_triggered,
            direction=mom_dir,
            weight=self._weights[self.SUSTAINED_MOMENTUM],
            detail={},
        ))

        # --- Ensemble Scoring (§4.6) ---
        triggered_indicators = [r.name for r in indicator_results if r.triggered]

        # alert_score = sum(weight_i for i in triggered_indicators)
        alert_score = sum(r.weight for r in indicator_results if r.triggered)

        # Direction: majority vote of triggered indicators
        direction = self._determine_direction(indicator_results)

        # is_confirmed = (alert_score >= threshold)
        is_confirmed = alert_score >= self._anomaly_cfg.alert_score_threshold

        return AnomalyAlert(
            currency=currency,
            timestamp=ts,
            alert_score=round(alert_score, 4),
            triggered_indicators=triggered_indicators,
            direction=direction,
            is_confirmed=is_confirmed,
        )

    @staticmethod
    def _determine_direction(results: list[IndicatorResult]) -> str:
        """Determine direction by majority vote of triggered indicators.

        From §4.6:
            direction is determined by majority vote of triggered indicators:
            - MACD crossover direction
            - RSI direction (overbought=up, oversold=down)
            - Z-score sign (positive=up, negative=down)
            - STL residual sign
            - Momentum direction
        """
        triggered = [r for r in results if r.triggered]

        if not triggered:
            return "up"  # default when nothing triggered

        up_count = sum(1 for r in triggered if r.direction == "up")
        down_count = sum(1 for r in triggered if r.direction == "down")

        return "up" if up_count >= down_count else "down"


# ---------------------------------------------------------------------------
# Batch detection helper
# ---------------------------------------------------------------------------

def detect_anomalies_batch(
    currency_price_series: dict[str, np.ndarray],
    config: AppConfig | None = None,
    seasonal_period: int = 7,
    timestamp: datetime | None = None,
) -> list[AnomalyAlert]:
    """Run anomaly detection across all currencies.

    Args:
        currency_price_series: Dict mapping currency api_id to price array
        config: Application config (uses defaults if None)
        seasonal_period: Period for STL decomposition
        timestamp: Observation timestamp

    Returns:
        List of AnomalyAlert objects, one per currency
    """
    detector = AnomalyDetector(config)
    n_currencies = len(currency_price_series)
    results = []

    for currency, prices in currency_price_series.items():
        alert = detector.detect(
            currency=currency,
            price_series=prices,
            n_currencies=n_currencies,
            timestamp=timestamp,
            seasonal_period=seasonal_period,
        )
        results.append(alert)

    return results
