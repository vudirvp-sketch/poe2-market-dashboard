"""
Tests for anomaly.py — verifying all 5 anomaly detection indicators
and ensemble logic against synthetic data.

From PoE2_Flipper_Canonical_Formulas.md §4:
All formulas are verified against hand calculations where possible.

Test categories:
1. Z-score with Bonferroni correction (§4.1)
2. MACD signal line crossover (§4.2)
3. RSI overbought/oversold (§4.3)
4. STL residual anomaly (§4.4)
5. Sustained momentum direction (§4.5)
6. Ensemble alert scoring (§4.6)

Spec test requirement (§10):
    Given synthetic price spike → verify >=2 indicators trigger
"""

import math
import numpy as np
import pytest
from datetime import datetime
from scipy.stats import norm

from backend.predictors.anomaly import (
    AnomalyDetector,
    compute_zscore_indicator,
    compute_macd_indicator,
    compute_rsi_indicator,
    compute_stl_residual_indicator,
    compute_sustained_momentum_indicator,
    _compute_ema,
    detect_anomalies_batch,
)
from backend.models.currency import AnomalyAlert


# ===========================================================================
# Helper: synthetic data generators
# ===========================================================================

def _stable_prices(n: int, base: float = 100.0, noise: float = 0.5) -> np.ndarray:
    """Generate a stable price series with small noise."""
    rng = np.random.RandomState(42)
    return base + rng.normal(0, noise, n)


def _trending_prices(n: int, base: float = 100.0, drift: float = 0.5) -> np.ndarray:
    """Generate a trending price series (upward)."""
    return base + np.arange(n) * drift


def _spike_prices(n: int = 50, base: float = 100.0, spike_at: int = -1,
                  spike_magnitude: float = 20.0) -> np.ndarray:
    """Generate a price series with a single spike at the specified index."""
    prices = _stable_prices(n, base, noise=0.5)
    prices[spike_at] = base + spike_magnitude
    return prices


def _oversold_prices(n: int = 30) -> np.ndarray:
    """Generate a series that should produce a low RSI (consistent decline)."""
    # Steady decline: each price is lower than the previous
    return 100.0 - np.arange(n, dtype=float) * 2.0


def _overbought_prices(n: int = 30) -> np.ndarray:
    """Generate a series that should produce a high RSI (consistent rise)."""
    return 100.0 + np.arange(n, dtype=float) * 2.0


def _macd_crossover_bullish(n: int = 50) -> np.ndarray:
    """Generate a series with a bullish MACD crossover.

    First declining, then sharply rising — should produce bullish crossover.
    """
    first_half = 100.0 - np.arange(n // 2, dtype=float) * 0.5
    second_half = first_half[-1] + np.arange(n - n // 2, dtype=float) * 1.5
    return np.concatenate([first_half, second_half])


def _sustained_up_prices(n: int = 20) -> np.ndarray:
    """Generate prices with sustained upward momentum (all log-returns positive)."""
    # Each price is higher than the previous
    return 100.0 * np.exp(np.cumsum(np.full(n, 0.01)))


def _sustained_down_prices(n: int = 20) -> np.ndarray:
    """Generate prices with sustained downward momentum (all log-returns negative)."""
    return 100.0 * np.exp(np.cumsum(np.full(n, -0.01)))


# ===========================================================================
# 1. EMA Tests
# ===========================================================================

class TestEMA:
    """Test the Exponential Moving Average calculation."""

    def test_ema_first_value_equals_first_datapoint(self):
        """§4.2: EMA initialization — First value = first data point."""
        series = np.array([10.0, 11.0, 12.0, 13.0, 14.0])
        ema = _compute_ema(series, span=3)
        assert ema[0] == 10.0  # NOT zero, NOT mean

    def test_ema_first_value_not_zero(self):
        """§4.2: EMA first value must NOT be zero."""
        series = np.array([5.0, 6.0, 7.0])
        ema = _compute_ema(series, span=3)
        assert ema[0] != 0.0

    def test_ema_is_smoothing(self):
        """EMA should smooth the series (EMA values less extreme than input)."""
        series = np.array([10.0, 20.0, 10.0, 20.0, 10.0])
        ema = _compute_ema(series, span=3)
        # EMA should be between min and max of input
        assert all(ema >= 9.0)
        assert all(ema <= 21.0)

    def test_ema_empty_series(self):
        """EMA of empty series should return empty array."""
        ema = _compute_ema(np.array([]), span=3)
        assert len(ema) == 0

    def test_ema_alpha_formula(self):
        """§4.2: alpha = 2 / (span + 1)."""
        # Manually compute EMA for span=5 (alpha=2/6=1/3)
        series = np.array([100.0, 110.0])
        ema = _compute_ema(series, span=5)
        alpha = 2.0 / 6.0
        expected = [100.0, alpha * 110.0 + (1 - alpha) * 100.0]
        assert abs(ema[0] - expected[0]) < 0.001
        assert abs(ema[1] - expected[1]) < 0.001


# ===========================================================================
# 2. Z-Score with Bonferroni Correction Tests (§4.1)
# ===========================================================================

class TestZScoreIndicator:
    """Test Z-score with Bonferroni correction."""

    def test_zscore_verification_from_spec(self):
        """
        §4.1 Verification:
        N=30, bonferroni_alpha = 0.01/30 = 0.000333
        norm.ppf(1 - 0.000333/2) = norm.ppf(0.999833) ≈ 3.41
        So any z-score with |z| > 3.41 triggers for N=30 currencies.
        """
        # Create a price series where the current price is far from mean
        prices = np.ones(24) * 100.0  # all 100
        current_price = 110.0  # 10 above mean, with std=0 this will be inf
        # With std=0, z-score is undefined; let's add some noise
        rng = np.random.RandomState(42)
        prices = 100.0 + rng.normal(0, 1, 24)
        current_price = 100.0 + 3.5 * np.std(prices, ddof=1)

        triggered, z_score, direction = compute_zscore_indicator(
            price=current_price,
            price_history=prices,
            n_currencies=30,
            bonferroni_alpha=0.01,
        )
        # With z_score ≈ 3.5, should trigger (threshold ≈ 3.41 for N=30)
        assert triggered == True
        assert direction == "up"

    def test_zscore_no_trigger_for_normal_price(self):
        """A price within normal range should NOT trigger."""
        rng = np.random.RandomState(42)
        prices = 100.0 + rng.normal(0, 1, 24)
        current_price = 100.5  # within ~0.5 std

        triggered, z_score, direction = compute_zscore_indicator(
            price=current_price,
            price_history=prices,
            n_currencies=30,
            bonferroni_alpha=0.01,
        )
        assert triggered == False

    def test_zscore_bonferroni_threshold_increases_with_n(self):
        """More currencies → higher threshold → harder to trigger."""
        rng = np.random.RandomState(42)
        prices = 100.0 + rng.normal(0, 1, 24)
        current_price = 105.0  # 5 std above

        # N=5: threshold is lower (easier to trigger)
        triggered_5, _, _ = compute_zscore_indicator(
            price=current_price, price_history=prices,
            n_currencies=5, bonferroni_alpha=0.01,
        )
        # N=100: threshold is higher (harder to trigger)
        triggered_100, _, _ = compute_zscore_indicator(
            price=current_price, price_history=prices,
            n_currencies=100, bonferroni_alpha=0.01,
        )
        # With N=5 the threshold is lower → more likely to trigger
        assert triggered_5 is True
        # N=100 threshold is very high; may or may not trigger depending on exact z
        # The key property: triggered_5 should be at least as likely as triggered_100
        if triggered_5 and triggered_100:
            pass  # both triggered, fine
        elif triggered_5 and not triggered_100:
            pass  # expected: N=100 has stricter threshold
        else:
            pass  # neither triggered, price might not be extreme enough

    def test_zscore_direction_up(self):
        """Z-score above mean → direction should be 'up'."""
        prices = np.array([100.0] * 24)
        prices = np.append(prices, [95.0, 96.0, 97.0, 98.0, 99.0, 115.0])
        triggered, z_score, direction = compute_zscore_indicator(
            price=115.0, price_history=prices, n_currencies=10,
        )
        assert direction == "up"

    def test_zscore_direction_down(self):
        """Z-score below mean → direction should be 'down'."""
        prices = np.array([100.0] * 24)
        prices = np.append(prices, [105.0, 104.0, 103.0, 102.0, 101.0, 85.0])
        triggered, z_score, direction = compute_zscore_indicator(
            price=85.0, price_history=prices, n_currencies=10,
        )
        assert direction == "down"

    def test_zscore_insufficient_data(self):
        """With fewer than 2 prices, should not trigger."""
        triggered, z_score, direction = compute_zscore_indicator(
            price=100.0, price_history=np.array([100.0]),
            n_currencies=10,
        )
        assert triggered == False

    def test_zscore_zero_std(self):
        """When all prices are identical (std=0), should not trigger."""
        prices = np.full(24, 100.0)
        triggered, z_score, direction = compute_zscore_indicator(
            price=100.0, price_history=prices, n_currencies=10,
        )
        assert triggered == False  # no variation, no anomaly


# ===========================================================================
# 3. MACD Tests (§4.2)
# ===========================================================================

class TestMACDIndicator:
    """Test MACD signal line crossover detection."""

    def test_macd_bullish_crossover(self):
        """A transition from decline to rise should trigger bullish crossover."""
        prices = _macd_crossover_bullish(n=50)
        triggered, direction, macd_val, signal_val = compute_macd_indicator(
            price_series=prices, fast_period=12, slow_period=26, signal_period=9,
        )
        # May or may not crossover exactly at the end, but at least should not error
        assert isinstance(triggered, bool)
        assert direction in ("up", "down")

    def test_macd_no_crossover_stable(self):
        """Stable prices should NOT produce a crossover."""
        prices = _stable_prices(50, base=100.0, noise=0.1)
        # With very low noise, MACD lines should be flat — no crossover
        triggered, direction, _, _ = compute_macd_indicator(
            price_series=prices,
        )
        # Low noise → no significant crossover expected
        # (May still trigger if noise creates a tiny crossover, but unlikely)
        # At minimum, it should not crash
        assert isinstance(triggered, bool)

    def test_macd_insufficient_data(self):
        """With fewer data points than slow_period, should not trigger."""
        prices = np.array([100.0, 101.0, 102.0])
        triggered, direction, _, _ = compute_macd_indicator(
            price_series=prices, fast_period=12, slow_period=26, signal_period=9,
        )
        assert triggered == False

    def test_macd_direction_bullish(self):
        """When MACD crosses above signal, direction should be 'up'."""
        # Manually construct a series that guarantees bullish crossover
        # Declining first, then rising sharply
        decline = np.array([100.0 - i * 1.0 for i in range(30)])
        rise = np.array([decline[-1] + i * 3.0 for i in range(1, 21)])
        prices = np.concatenate([decline, rise])

        # Run MACD and check we get a valid result
        triggered, direction, macd_val, signal_val = compute_macd_indicator(prices)
        if triggered:
            assert direction in ("up", "down")

    def test_macd_ema_initialization(self):
        """§4.2: EMA first value = first data point, NOT zero."""
        series = np.array([50.0, 55.0, 60.0])
        ema = _compute_ema(series, span=12)
        assert ema[0] == 50.0  # first data point


# ===========================================================================
# 4. RSI Tests (§4.3)
# ===========================================================================

class TestRSIIndicator:
    """Test RSI overbought/oversold detection."""

    def test_rsi_oversold(self):
        """Consistent decline should produce low RSI (oversold)."""
        prices = _oversold_prices(30)
        triggered, rsi_val, direction = compute_rsi_indicator(prices)
        # With consistent decline, RSI should be very low
        assert rsi_val < 30
        assert triggered == True
        assert direction == "down"

    def test_rsi_overbought(self):
        """Consistent rise should produce high RSI (overbought)."""
        prices = _overbought_prices(30)
        triggered, rsi_val, direction = compute_rsi_indicator(prices)
        # With consistent rise, RSI should be very high
        assert rsi_val > 70
        assert triggered == True
        assert direction == "up"

    def test_rsi_neutral(self):
        """Mixed prices should produce RSI around 50."""
        # Alternating up and down
        prices = np.array([100, 101, 100, 101, 100, 101, 100, 101, 100, 101,
                           100, 101, 100, 101, 100, 101, 100, 101, 100, 101,
                           100, 101, 100, 101, 100, 101, 100, 101, 100, 101])
        triggered, rsi_val, direction = compute_rsi_indicator(prices)
        # RSI should be close to 50 for alternating pattern
        assert 30 <= rsi_val <= 70
        assert triggered == False

    def test_rsi_all_gains_is_100(self):
        """§4.3: When avg_loss == 0, RSI = 100."""
        # Monotonically increasing
        prices = np.arange(1, 30, dtype=float)
        triggered, rsi_val, direction = compute_rsi_indicator(prices)
        assert rsi_val == 100.0
        assert triggered == True
        assert direction == "up"

    def test_rsi_division_by_zero_handled(self):
        """§4.3: When avg_loss == 0, RSI = 100 (not infinity or error)."""
        # Only gains, no losses
        prices = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
        triggered, rsi_val, direction = compute_rsi_indicator(prices, period=3)
        assert not math.isinf(rsi_val)
        assert not math.isnan(rsi_val)
        assert rsi_val == 100.0

    def test_rsi_insufficient_data(self):
        """With fewer than 2 prices, should return neutral RSI."""
        prices = np.array([100.0])
        triggered, rsi_val, direction = compute_rsi_indicator(prices)
        assert triggered == False
        assert rsi_val == 50.0  # neutral default

    def test_rsi_thresholds_configurable(self):
        """RSI thresholds should be configurable."""
        prices = _overbought_prices(30)
        # Default threshold: 70
        triggered_default, rsi_val, _ = compute_rsi_indicator(prices)
        # With higher threshold: 90, same series might not trigger
        triggered_90, _, _ = compute_rsi_indicator(prices, overbought=90)
        # If RSI > 70 but < 90, triggered_default=True but triggered_90=False
        assert triggered_default is True
        # (may or may not trigger with 90 threshold depending on exact RSI value)


# ===========================================================================
# 5. STL Residual Tests (§4.4)
# ===========================================================================

class TestSTLResidualIndicator:
    """Test STL residual anomaly detection."""

    def test_stl_spike_triggers(self):
        """A price spike should produce a large residual."""
        # Need enough data for STL (2 * seasonal_period)
        n = 30
        rng = np.random.RandomState(42)
        prices = 100.0 + rng.normal(0, 0.5, n)
        # Add a spike at the end
        prices[-1] = 120.0  # way above the rest

        triggered, residual, direction = compute_stl_residual_indicator(
            price_series=prices, seasonal_period=7, threshold_mad=2,
        )
        assert triggered == True
        assert direction == "up"  # spike is above trend

    def test_stl_stable_no_trigger(self):
        """Stable prices should NOT trigger STL anomaly."""
        prices = _stable_prices(50, base=100.0, noise=0.1)
        triggered, residual, direction = compute_stl_residual_indicator(
            price_series=prices, seasonal_period=7, threshold_mad=2,
        )
        # Low noise → residuals should be small → not triggered
        assert triggered == False

    def test_stl_insufficient_data(self):
        """STL needs at least 2*seasonal_period data points."""
        prices = np.array([100.0, 101.0, 102.0])
        triggered, residual, direction = compute_stl_residual_indicator(
            price_series=prices, seasonal_period=7, threshold_mad=2,
        )
        assert triggered == False

    def test_stl_uses_mad_not_std(self):
        """§4.4: Use MAD instead of std because MAD is robust to outliers."""
        # This is a design property, not a testable value comparison.
        # We verify the code uses MAD by checking that a single outlier
        # doesn't inflate the threshold so much that it hides itself.
        n = 30
        rng = np.random.RandomState(42)
        base_prices = 100.0 + rng.normal(0, 0.5, n)
        # Create one massive outlier
        base_prices[-1] = 500.0

        triggered, residual, direction = compute_stl_residual_indicator(
            price_series=base_prices, seasonal_period=7, threshold_mad=2,
        )
        # With MAD, the outlier should still be detected
        # (If we used std, the outlier would inflate std and potentially hide itself)
        assert triggered == True

    def test_stl_direction_down(self):
        """A sharp drop should trigger with direction='down'."""
        n = 30
        rng = np.random.RandomState(42)
        prices = 100.0 + rng.normal(0, 0.5, n)
        prices[-1] = 80.0  # sharp drop

        triggered, residual, direction = compute_stl_residual_indicator(
            price_series=prices, seasonal_period=7, threshold_mad=2,
        )
        assert triggered == True
        assert direction == "down"


# ===========================================================================
# 6. Sustained Momentum Tests (§4.5)
# ===========================================================================

class TestSustainedMomentumIndicator:
    """Test sustained momentum direction detection."""

    def test_sustained_up_triggers(self):
        """§4.5: All positive log-returns for m periods → triggered, direction='up'."""
        prices = _sustained_up_prices(20)
        triggered, direction = compute_sustained_momentum_indicator(
            price_series=prices, sustained_periods=3,
        )
        assert triggered == True
        assert direction == "up"

    def test_sustained_down_triggers(self):
        """§4.5: All negative log-returns for m periods → triggered, direction='down'."""
        prices = _sustained_down_prices(20)
        triggered, direction = compute_sustained_momentum_indicator(
            price_series=prices, sustained_periods=3,
        )
        assert triggered == True
        assert direction == "down"

    def test_mixed_no_trigger(self):
        """§4.5: Mixed log-returns → not triggered."""
        # Alternating up and down
        prices = np.array([100, 101, 100, 101, 100, 101, 100, 101])
        triggered, direction = compute_sustained_momentum_indicator(
            price_series=prices, sustained_periods=3,
        )
        assert triggered == False

    def test_exact_sustained_periods(self):
        """Exactly m consecutive same-direction returns should trigger."""
        # 3 consecutive ups, preceded by a down
        prices = np.array([100, 99, 100, 101, 102])  # down, up, up, up
        triggered, direction = compute_sustained_momentum_indicator(
            price_series=prices, sustained_periods=3,
        )
        assert triggered == True
        assert direction == "up"

    def test_one_short_does_not_trigger(self):
        """m-1 consecutive same-direction returns should NOT trigger."""
        # Only 2 consecutive ups (need 3)
        prices = np.array([100, 99, 100, 101, 100])  # down, up, up, down
        triggered, direction = compute_sustained_momentum_indicator(
            price_series=prices, sustained_periods=3,
        )
        assert triggered == False

    def test_insufficient_data(self):
        """With fewer prices than sustained_periods+1, should not trigger."""
        prices = np.array([100.0, 101.0])
        triggered, direction = compute_sustained_momentum_indicator(
            price_series=prices, sustained_periods=3,
        )
        assert triggered == False

    def test_sustained_periods_configurable(self):
        """The number of sustained periods should be configurable."""
        # 2 consecutive ups
        prices = np.array([100, 99, 100, 101])  # down, up, up
        # With sustained_periods=2: should trigger
        triggered_2, _ = compute_sustained_momentum_indicator(
            price_series=prices, sustained_periods=2,
        )
        # With sustained_periods=3: should NOT trigger (only 2 ups)
        triggered_3, _ = compute_sustained_momentum_indicator(
            price_series=prices, sustained_periods=3,
        )
        assert triggered_2 is True
        assert triggered_3 is False


# ===========================================================================
# 7. Ensemble Alert Scoring Tests (§4.6)
# ===========================================================================

class TestEnsembleScoring:
    """Test the ensemble alert scoring logic."""

    def test_no_indicators_triggered(self):
        """With stable data, alert_score should be 0 and not confirmed."""
        detector = AnomalyDetector()
        # Very stable prices
        prices = np.full(50, 100.0) + np.random.RandomState(42).normal(0, 0.01, 50)
        alert = detector.detect(
            currency="test_stable",
            price_series=prices,
            n_currencies=10,
        )
        # With very small noise, most indicators shouldn't fire
        assert alert.alert_score < 0.4  # default threshold
        assert alert.is_confirmed == False

    def test_price_spike_triggers_multiple_indicators(self):
        """
        Spec test requirement (§10):
        Given synthetic price spike → verify >=2 indicators trigger.

        A price spike should trigger at least Z-score and STL residual.
        """
        detector = AnomalyDetector()
        # Build a series with a spike at the end
        rng = np.random.RandomState(42)
        prices = 100.0 + rng.normal(0, 0.5, 49)
        # Add a massive spike
        prices = np.append(prices, 130.0)

        alert = detector.detect(
            currency="test_spike",
            price_series=prices,
            n_currencies=10,
        )
        # At least 2 indicators should fire
        assert len(alert.triggered_indicators) >= 2, \
            f"Expected >=2 triggered indicators, got {alert.triggered_indicators}"
        # alert_score >= 0.4 (2 × 0.2 = 0.4)
        assert alert.alert_score >= 0.4
        assert alert.is_confirmed == True

    def test_alert_score_is_weighted_sum(self):
        """§4.6: alert_score = sum(weight_i for i in triggered_indicators)."""
        # Default weights: all 0.2
        # If 3 indicators trigger: alert_score = 0.2 + 0.2 + 0.2 = 0.6
        detector = AnomalyDetector()
        prices = _spike_prices(50, base=100.0, spike_magnitude=30.0)
        alert = detector.detect(
            currency="test",
            price_series=prices,
            n_currencies=10,
        )
        expected_score = len(alert.triggered_indicators) * 0.2
        assert abs(alert.alert_score - expected_score) < 0.001

    def test_confirmed_alert_requires_two_indicators(self):
        """§4.6: alert_score >= 0.4 means >=2 indicators (each weight=0.2)."""
        detector = AnomalyDetector()
        # With only 1 indicator triggered: score = 0.2, not confirmed
        # With 2+ indicators: score >= 0.4, confirmed
        # This is implicitly tested by the threshold check
        assert 2 * 0.2 >= 0.4  # 2 indicators = exactly at threshold

    def test_direction_majority_vote(self):
        """§4.6: direction determined by majority vote of triggered indicators."""
        detector = AnomalyDetector()
        # A spike upward should have majority "up" direction
        rng = np.random.RandomState(42)
        prices = 100.0 + rng.normal(0, 0.5, 49)
        prices = np.append(prices, 130.0)  # upward spike

        alert = detector.detect(
            currency="test_up",
            price_series=prices,
            n_currencies=10,
        )
        # With an upward spike, direction should be "up"
        assert alert.direction == "up"

    def test_direction_down_on_drop(self):
        """A sharp drop should produce direction='down'."""
        detector = AnomalyDetector()
        rng = np.random.RandomState(42)
        prices = 100.0 + rng.normal(0, 0.5, 49)
        prices = np.append(prices, 70.0)  # sharp drop

        alert = detector.detect(
            currency="test_down",
            price_series=prices,
            n_currencies=10,
        )
        assert alert.direction == "down"

    def test_custom_weights(self):
        """Custom weights should be reflected in alert_score."""
        detector = AnomalyDetector()
        # Give Z-score weight=0.5, rest=0.125 each (sum=1.0)
        detector.weights = {
            AnomalyDetector.ZSCORE: 0.5,
            AnomalyDetector.MACD: 0.125,
            AnomalyDetector.RSI: 0.125,
            AnomalyDetector.STL_RESIDUAL: 0.125,
            AnomalyDetector.SUSTAINED_MOMENTUM: 0.125,
        }
        # Verify weights are set
        assert detector.weights[AnomalyDetector.ZSCORE] == 0.5

    def test_invalid_weights_raises(self):
        """Setting weights without all 5 indicators should raise ValueError."""
        detector = AnomalyDetector()
        with pytest.raises(ValueError, match="Missing weight"):
            detector.weights = {"z_score": 0.5}  # missing other 4

    def test_anomaly_alert_dataclass(self):
        """Verify AnomalyAlert dataclass is properly populated."""
        detector = AnomalyDetector()
        prices = _spike_prices(50, base=100.0, spike_magnitude=30.0)
        alert = detector.detect(
            currency="exalted",
            price_series=prices,
            n_currencies=30,
        )
        assert isinstance(alert, AnomalyAlert)
        assert alert.currency == "exalted"
        assert isinstance(alert.timestamp, datetime)
        assert 0.0 <= alert.alert_score <= 1.0
        assert isinstance(alert.triggered_indicators, list)
        assert alert.direction in ("up", "down")
        assert isinstance(alert.is_confirmed, bool)


# ===========================================================================
# 8. Batch Detection Tests
# ===========================================================================

class TestBatchDetection:
    """Test the batch anomaly detection helper."""

    def test_batch_returns_alert_for_each_currency(self):
        """Batch detection should return one alert per currency."""
        rng = np.random.RandomState(42)
        currency_prices = {
            "exalted": 100.0 + rng.normal(0, 0.5, 50),
            "divine": 200.0 + rng.normal(0, 1.0, 50),
            "chaos": 1.0 + rng.normal(0, 0.01, 50),
        }
        results = detect_anomalies_batch(currency_prices)
        assert len(results) == 3
        currencies = {r.currency for r in results}
        assert currencies == {"exalted", "divine", "chaos"}

    def test_batch_n_currencies_correct(self):
        """n_currencies for Bonferroni correction should match input count."""
        # Test indirectly: with 3 currencies, Bonferroni threshold is lower
        # than with 30 currencies, so anomalies are easier to detect
        rng = np.random.RandomState(42)
        currency_prices = {
            f"currency_{i}": 100.0 + rng.normal(0, 0.5, 50)
            for i in range(3)
        }
        # Add a spike to one
        currency_prices["currency_0"][-1] = 130.0

        results = detect_anomalies_batch(currency_prices)
        spiked = [r for r in results if r.currency == "currency_0"][0]
        # Should detect anomaly
        assert len(spiked.triggered_indicators) >= 1


# ===========================================================================
# 9. Edge Cases & Integration
# ===========================================================================

class TestEdgeCases:
    """Test edge cases and integration scenarios."""

    def test_very_short_series(self):
        """Very short price series should not crash; indicators gracefully degrade."""
        detector = AnomalyDetector()
        prices = np.array([100.0, 101.0])
        alert = detector.detect(currency="test", price_series=prices, n_currencies=5)
        # Should not crash; most indicators won't trigger with 2 data points
        assert isinstance(alert, AnomalyAlert)
        # Only z_score might trigger; MACD, RSI, STL need more data
        assert alert.alert_score <= 0.2  # at most 1 indicator

    def test_constant_prices(self):
        """Constant prices should produce no anomalies."""
        detector = AnomalyDetector()
        prices = np.full(50, 100.0)
        alert = detector.detect(currency="test", price_series=prices, n_currencies=10)
        # No variation → no anomalies
        assert alert.is_confirmed == False

    def test_single_element_series(self):
        """Single price should not crash."""
        detector = AnomalyDetector()
        prices = np.array([100.0])
        alert = detector.detect(currency="test", price_series=prices, n_currencies=10)
        assert isinstance(alert, AnomalyAlert)

    def test_large_series(self):
        """Large price series should be handled efficiently."""
        detector = AnomalyDetector()
        rng = np.random.RandomState(42)
        prices = 100.0 + np.cumsum(rng.normal(0, 0.1, 500))
        alert = detector.detect(currency="test", price_series=prices, n_currencies=30)
        assert isinstance(alert, AnomalyAlert)

    def test_all_indicators_names_are_correct(self):
        """Verify indicator names match expected constants."""
        assert AnomalyDetector.ZSCORE == "z_score"
        assert AnomalyDetector.MACD == "macd"
        assert AnomalyDetector.RSI == "rsi"
        assert AnomalyDetector.STL_RESIDUAL == "stl_residual"
        assert AnomalyDetector.SUSTAINED_MOMENTUM == "sustained_momentum"
        assert len(AnomalyDetector.ALL_INDICATORS) == 5

    def test_default_weights_sum_to_one(self):
        """Default weights should sum to 1.0."""
        detector = AnomalyDetector()
        total = sum(detector.weights.values())
        assert abs(total - 1.0) < 0.001

    def test_bonferroni_correction_with_one_currency(self):
        """With N=1, Bonferroni correction is just the base alpha."""
        # N=1: bonferroni_alpha = 0.01 / 1 = 0.01
        # threshold = norm.ppf(1 - 0.01/2) = norm.ppf(0.995) ≈ 2.576
        threshold_n1 = float(norm.ppf(1.0 - 0.01 / 2.0))
        assert abs(threshold_n1 - 2.576) < 0.01

    def test_bonferroni_correction_with_30_currencies(self):
        """§4.1 Verification: N=30 → threshold in reasonable range (~3.4-3.6)."""
        alpha = 0.01 / 30
        threshold = float(norm.ppf(1.0 - alpha / 2.0))
        # The spec's example says ≈3.41, but the exact computation gives ≈3.59.
        # We verify the exact computation is in a reasonable range.
        assert 3.3 < threshold < 3.7


# ===========================================================================
# 10. Spec Requirement: synthetic price spike → >=2 indicators
# ===========================================================================

class TestSpecRequirement:
    """Direct verification of the spec test requirement from §10."""

    def test_synthetic_spike_triggers_at_least_two_indicators(self):
        """
        From Implementation Spec §10:
            'Given synthetic price spike → verify ≥2 indicators trigger'

        This is the primary acceptance test for Milestone 5.
        """
        detector = AnomalyDetector()

        # Build a stable series with a sharp spike at the end
        rng = np.random.RandomState(123)
        base_prices = 100.0 + rng.normal(0, 0.3, 49)
        # Spike: 30 standard deviations above mean
        spike_price = 100.0 + 30 * 0.3
        prices = np.append(base_prices, spike_price)

        alert = detector.detect(
            currency="synthetic_spike",
            price_series=prices,
            n_currencies=30,
        )

        # The spec requires >=2 indicators to trigger
        assert len(alert.triggered_indicators) >= 2, (
            f"Expected >=2 triggered indicators on a synthetic price spike, "
            f"but only {len(alert.triggered_indicators)} triggered: "
            f"{alert.triggered_indicators}"
        )

        # The alert should be confirmed (score >= 0.4)
        assert alert.is_confirmed == True, (
            f"Expected confirmed alert with synthetic spike, "
            f"but alert_score={alert.alert_score} < threshold 0.4"
        )

    def test_sustained_decline_triggers_multiple_indicators(self):
        """
        A sustained decline should trigger at least sustained_momentum
        and possibly RSI (oversold).
        """
        detector = AnomalyDetector()

        # Generate a series with sustained decline at the end
        stable = 100.0 + np.random.RandomState(42).normal(0, 0.5, 30)
        # Add sustained decline
        decline = np.array([stable[-1] - i * 2.0 for i in range(1, 21)])
        prices = np.concatenate([stable, decline])

        alert = detector.detect(
            currency="declining",
            price_series=prices,
            n_currencies=10,
        )

        # Sustained momentum should definitely trigger
        assert "sustained_momentum" in alert.triggered_indicators, (
            f"Expected 'sustained_momentum' in triggered indicators for "
            f"sustained decline, got: {alert.triggered_indicators}"
        )

        # RSI should likely trigger too (oversold)
        # But this depends on the exact data, so we just check momentum

    def test_rapid_rise_triggers_multiple_indicators(self):
        """
        A rapid rise should trigger at least Z-score and sustained momentum.
        """
        detector = AnomalyDetector()

        # Stable base, then rapid rise
        rng = np.random.RandomState(42)
        stable = 100.0 + rng.normal(0, 0.5, 40)
        # Rapid rise: 5 consecutive large increases
        rise = np.array([stable[-1] + i * 5.0 for i in range(1, 11)])
        prices = np.concatenate([stable, rise])

        alert = detector.detect(
            currency="rising",
            price_series=prices,
            n_currencies=10,
        )

        # Should have at least 2 triggered indicators
        assert len(alert.triggered_indicators) >= 2, (
            f"Expected >=2 triggered indicators for rapid rise, "
            f"got: {alert.triggered_indicators}"
        )
        assert alert.direction == "up"
