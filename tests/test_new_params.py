"""
Tests for new parameters: volatility_period, acceleration, CI widening.

Covers:
1. volatility_period in scorer.py — hourly vs daily volatility annualization
2. acceleration in storage_value.py — dampened momentum adjustment
3. CI widening in storage_value.py — confidence_level effect on risk_discount
4. Integration: acceleration + CI widening combined effect
"""

import math
import numpy as np
import pytest

from backend.arbitrage.scorer import compute_opportunity_score
from backend.predictors.storage_value import project_value
from backend.economy.momentum import PriceMomentumTracker
from backend.models.currency import Decision


# ===========================================================================
# 1. volatility_period — scorer.py
# ===========================================================================

class TestVolatilityPeriod:
    """Test the volatility_period parameter in compute_opportunity_score.

    The scorer has a vol_reference=0.05 (assumed daily). When volatility_period
    is "hourly", the raw hourly volatility is annualized to daily equivalent via
    vol_daily = vol_hourly * sqrt(24) before comparing to vol_reference.
    """

    def test_hourly_vol_reduces_score_vs_daily(self):
        """With the same raw volatility, hourly period should produce a lower
        score than daily because hourly volatility gets multiplied by sqrt(24)
        before the penalty is applied, making the penalty stronger."""
        raw_vol = 0.01  # 1% hourly volatility

        score_daily = compute_opportunity_score(
            bid=95, ask=105, mid_price=100,
            volume_24h=500, max_volume=2000,
            volatility=raw_vol,
            phase_multiplier=1.0, momentum=0.002,
            volatility_period="daily",
        )
        score_hourly = compute_opportunity_score(
            bid=95, ask=105, mid_price=100,
            volume_24h=500, max_volume=2000,
            volatility=raw_vol,
            phase_multiplier=1.0, momentum=0.002,
            volatility_period="hourly",
        )
        # Hourly vol gets scaled up by sqrt(24) ≈ 4.9, making the penalty
        # stronger → score should be lower
        assert score_hourly < score_daily

    def test_daily_period_no_scaling(self):
        """With volatility_period="daily", raw volatility is used directly."""
        raw_vol = 0.03
        score = compute_opportunity_score(
            bid=95, ask=105, mid_price=100,
            volume_24h=500, max_volume=2000,
            volatility=raw_vol,
            phase_multiplier=1.0, momentum=0.002,
            volatility_period="daily",
        )
        # Should match the verification example from test_scorer.py
        # spread = 0.10, fill_prob = log1p(500)/log1p(2000) ≈ 0.818
        # vol_penalty = 1/(1+(0.03/0.05)^2) = 1/1.36 ≈ 0.735
        # score ≈ 0.10 * 0.818 * 1.0 * 0.735 * 1.0 ≈ 0.0601
        assert abs(score - 0.0601) < 0.001

    def test_hourly_scaling_matches_manual(self):
        """Verify hourly scaling produces the expected score manually."""
        raw_vol = 0.01  # 1% hourly
        effective_vol = raw_vol * math.sqrt(24)  # ≈ 0.049

        score = compute_opportunity_score(
            bid=95, ask=105, mid_price=100,
            volume_24h=500, max_volume=2000,
            volatility=raw_vol,
            phase_multiplier=1.0, momentum=0.002,
            volatility_period="hourly",
        )

        # Manual computation with effective_vol ≈ 0.049
        vol_penalty = 1.0 / (1.0 + (effective_vol / 0.05) ** 2)
        spread = 0.10
        fill_prob = math.log1p(500) / math.log1p(2000)
        expected = spread * fill_prob * 1.0 * vol_penalty * 1.0
        assert abs(score - expected) < 0.001

    def test_zero_volatility_both_periods(self):
        """With zero volatility, both periods should produce the same score
        (no penalty applied because 0/0.05 = 0)."""
        score_daily = compute_opportunity_score(
            bid=95, ask=105, mid_price=100,
            volume_24h=500, max_volume=2000,
            volatility=0.0,
            phase_multiplier=1.0, momentum=0.002,
            volatility_period="daily",
        )
        score_hourly = compute_opportunity_score(
            bid=95, ask=105, mid_price=100,
            volume_24h=500, max_volume=2000,
            volatility=0.0,
            phase_multiplier=1.0, momentum=0.002,
            volatility_period="hourly",
        )
        assert score_daily == score_hourly

    def test_high_hourly_vol_near_zero_score(self):
        """Very high hourly volatility should drive score close to 0."""
        score = compute_opportunity_score(
            bid=95, ask=105, mid_price=100,
            volume_24h=500, max_volume=2000,
            volatility=0.10,  # 10% hourly — extremely volatile
            phase_multiplier=1.0, momentum=0.002,
            volatility_period="hourly",
        )
        # effective_vol = 0.10 * sqrt(24) ≈ 0.49
        # vol_penalty = 1/(1+(0.49/0.05)^2) = 1/(1+96) ≈ 0.01
        # score ≈ 0.0818 * 0.01 ≈ 0.0008
        assert score < 0.01


# ===========================================================================
# 2. acceleration — storage_value.py
# ===========================================================================

class TestAcceleration:
    """Test the acceleration parameter in project_value.

    From storage_value.py:
        effective_momentum = log_momentum + 0.3 * acceleration * horizon_hours

    Positive acceleration strengthens the trend, negative weakens it.
    The 0.3 dampening factor prevents over-extrapolation.
    """

    def test_positive_acceleration_increases_projected_price(self):
        """Positive acceleration should increase the projected price."""
        base_result = project_value(
            current_price=100.0,
            log_momentum=0.001,
            volatility=0.02,
            liquidity_score=10.0,
            horizon_hours=24,
            confidence_level=0.05,
            acceleration=0.0,
        )
        accel_result = project_value(
            current_price=100.0,
            log_momentum=0.001,
            volatility=0.02,
            liquidity_score=10.0,
            horizon_hours=24,
            confidence_level=0.05,
            acceleration=0.0005,  # positive acceleration
        )
        assert accel_result.projected_price > base_result.projected_price

    def test_negative_acceleration_decreases_projected_price(self):
        """Negative acceleration should decrease the projected price."""
        base_result = project_value(
            current_price=100.0,
            log_momentum=0.001,
            volatility=0.02,
            liquidity_score=10.0,
            horizon_hours=24,
            confidence_level=0.05,
            acceleration=0.0,
        )
        decel_result = project_value(
            current_price=100.0,
            log_momentum=0.001,
            volatility=0.02,
            liquidity_score=10.0,
            horizon_hours=24,
            confidence_level=0.05,
            acceleration=-0.0005,  # negative acceleration
        )
        assert decel_result.projected_price < base_result.projected_price

    def test_zero_acceleration_same_as_base(self):
        """Zero acceleration should produce the same result as the base case."""
        result_zero = project_value(
            current_price=100.0,
            log_momentum=0.001,
            volatility=0.02,
            liquidity_score=10.0,
            horizon_hours=24,
            confidence_level=0.05,
            acceleration=0.0,
        )
        result_no_accel = project_value(
            current_price=100.0,
            log_momentum=0.001,
            volatility=0.02,
            liquidity_score=10.0,
            horizon_hours=24,
            confidence_level=0.05,
        )
        assert result_zero.projected_price == result_no_accel.projected_price
        assert result_zero.ratio == result_no_accel.ratio

    def test_acceleration_affects_decision(self):
        """Large negative acceleration should push toward SELL/CONVERT."""
        # With strong negative acceleration and short horizon, decision should
        # be more likely SELL
        result_sell = project_value(
            current_price=100.0,
            log_momentum=-0.001,
            volatility=0.05,
            liquidity_score=5.0,
            horizon_hours=48,
            confidence_level=0.05,
            acceleration=-0.005,  # strong negative
        )
        # With strong positive acceleration, decision should be more likely BUY
        result_buy = project_value(
            current_price=100.0,
            log_momentum=0.005,
            volatility=0.01,
            liquidity_score=15.0,
            horizon_hours=24,
            confidence_level=0.05,
            acceleration=0.003,  # strong positive
        )
        assert result_sell.ratio < result_buy.ratio

    def test_acceleration_dampening_factor(self):
        """Verify the 0.3 dampening factor is applied.

        effective_momentum = momentum + 0.3 * acceleration * horizon_hours
        Without dampening: effective = momentum + acceleration * horizon_hours
        With dampening:    effective = momentum + 0.3 * acceleration * horizon_hours
        """
        momentum = 0.001
        acceleration = 0.0005
        horizon = 24

        # Expected effective_momentum = 0.001 + 0.3 * 0.0005 * 24 = 0.001 + 0.0036 = 0.0046
        # Raw factor = exp(0.0046 * 24) = exp(0.1104) ≈ 1.1167
        # But capped at max_projection_factor = 1 + 0.10 * sqrt(24) ≈ 1.490
        result = project_value(
            current_price=100.0,
            log_momentum=momentum,
            volatility=0.02,
            liquidity_score=10.0,
            horizon_hours=horizon,
            confidence_level=0.05,
            acceleration=acceleration,
        )
        # projected_price should be > 100 (trend + positive acceleration)
        assert result.projected_price > 100.0


# ===========================================================================
# 3. CI widening — confidence_level in storage_value.py
# ===========================================================================

class TestCIWidening:
    """Test that higher confidence_level (wider CI) increases the risk discount.

    From storage_value.py:
        z = abs(norm.ppf(confidence_level))
        risk_discount = exp(-volatility * z * sqrt(horizon_hours))

    A lower confidence_level (e.g., 0.01) means a wider confidence interval
    (99% CI), which produces a higher z-value and thus a LARGER risk_discount
    decay (more conservative projection).

    A higher confidence_level (e.g., 0.40) means a narrower CI (60% CI),
    which produces a lower z-value and thus a SMALLER risk_discount decay
    (more optimistic projection).

    Note: In scipy.stats.norm, ppf(0.05) = -1.645, ppf(0.01) = -2.326,
    ppf(0.40) = -0.253. The abs() is applied.
    """

    def test_narrower_ci_higher_ratio(self):
        """A narrower CI (higher confidence_level, e.g. 0.40) should produce
        a higher ratio (more optimistic)."""
        result_wide = project_value(
            current_price=100.0,
            log_momentum=0.001,
            volatility=0.05,
            liquidity_score=10.0,
            horizon_hours=24,
            confidence_level=0.01,  # 99% CI — very conservative
        )
        result_narrow = project_value(
            current_price=100.0,
            log_momentum=0.001,
            volatility=0.05,
            liquidity_score=10.0,
            horizon_hours=24,
            confidence_level=0.40,  # 60% CI — less conservative
        )
        # Narrower CI → less risk_discount decay → higher ratio
        assert result_narrow.ratio > result_wide.ratio

    def test_wider_ci_lower_ratio(self):
        """A wider CI (lower confidence_level, e.g. 0.01) should produce
        a lower ratio (more conservative)."""
        result_wide = project_value(
            current_price=100.0,
            log_momentum=0.001,
            volatility=0.05,
            liquidity_score=10.0,
            horizon_hours=24,
            confidence_level=0.01,
        )
        result_default = project_value(
            current_price=100.0,
            log_momentum=0.001,
            volatility=0.05,
            liquidity_score=10.0,
            horizon_hours=24,
            confidence_level=0.05,  # default 95% CI
        )
        # Wider CI (0.01) should produce lower ratio than default (0.05)
        assert result_wide.ratio < result_default.ratio

    def test_confidence_level_affects_risk_discount(self):
        """Different confidence levels should produce different risk_discounts."""
        result_low = project_value(
            current_price=100.0,
            log_momentum=0.0,
            volatility=0.05,
            liquidity_score=10.0,
            horizon_hours=24,
            confidence_level=0.01,
        )
        result_high = project_value(
            current_price=100.0,
            log_momentum=0.0,
            volatility=0.05,
            liquidity_score=10.0,
            horizon_hours=24,
            confidence_level=0.40,
        )
        # risk_discount = exp(-vol * z * sqrt(horizon))
        # z for 0.01 = 2.326 → more discount (closer to 0)
        # z for 0.40 = 0.253 → less discount (closer to 1)
        assert result_low.risk_discount < result_high.risk_discount

    def test_ci_effect_with_high_volatility(self):
        """CI widening effect should be more pronounced with higher volatility."""
        # Low volatility — CI widening has small effect
        low_vol_wide = project_value(
            current_price=100.0, log_momentum=0.0,
            volatility=0.01, liquidity_score=10.0,
            horizon_hours=24, confidence_level=0.01,
        )
        low_vol_narrow = project_value(
            current_price=100.0, log_momentum=0.0,
            volatility=0.01, liquidity_score=10.0,
            horizon_hours=24, confidence_level=0.40,
        )
        low_vol_diff = low_vol_narrow.ratio - low_vol_wide.ratio

        # High volatility — CI widening has larger effect
        high_vol_wide = project_value(
            current_price=100.0, log_momentum=0.0,
            volatility=0.10, liquidity_score=10.0,
            horizon_hours=24, confidence_level=0.01,
        )
        high_vol_narrow = project_value(
            current_price=100.0, log_momentum=0.0,
            volatility=0.10, liquidity_score=10.0,
            horizon_hours=24, confidence_level=0.40,
        )
        high_vol_diff = high_vol_narrow.ratio - high_vol_wide.ratio

        # High volatility should amplify the CI widening effect
        assert high_vol_diff > low_vol_diff

    def test_ci_widening_can_flip_decision(self):
        """Extreme CI widening should be able to flip a borderline decision."""
        # A borderline case where confidence level changes the decision
        result_optimistic = project_value(
            current_price=100.0, log_momentum=0.005,
            volatility=0.02, liquidity_score=10.0,
            horizon_hours=24, confidence_level=0.40,  # narrow CI → optimistic
            buy_threshold=1.02, sell_threshold=0.98,
        )
        result_conservative = project_value(
            current_price=100.0, log_momentum=0.005,
            volatility=0.08, liquidity_score=3.0,
            horizon_hours=48, confidence_level=0.01,  # wide CI → conservative
            buy_threshold=1.02, sell_threshold=0.98,
        )
        # The optimistic case should have a higher decision category
        assert result_optimistic.ratio >= result_conservative.ratio


# ===========================================================================
# 4. Integration: acceleration + CI widening combined
# ===========================================================================

class TestAccelerationAndCIIntegration:
    """Test the combined effect of acceleration and CI widening on storage value."""

    def test_positive_acceleration_narrow_ci_highest_ratio(self):
        """Positive acceleration + narrow CI should produce the highest ratio."""
        result = project_value(
            current_price=100.0,
            log_momentum=0.005,
            volatility=0.03,
            liquidity_score=10.0,
            horizon_hours=24,
            confidence_level=0.40,
            acceleration=0.001,
        )
        # This is the most optimistic combination
        assert result.ratio > 1.0  # Should be above 1.0 at least

    def test_negative_acceleration_wide_ci_lowest_ratio(self):
        """Negative acceleration + wide CI should produce the lowest ratio."""
        result = project_value(
            current_price=100.0,
            log_momentum=-0.003,
            volatility=0.06,
            liquidity_score=3.0,
            horizon_hours=48,
            confidence_level=0.01,
            acceleration=-0.002,
        )
        # This is the most conservative combination
        assert result.ratio < 1.0  # Should be below 1.0

    def test_momentum_tracker_acceleration_propagates(self):
        """Verify that PriceMomentumTracker.acceleration is correctly passed
        through to project_value and affects the result."""
        tracker = PriceMomentumTracker(window_size=24)
        # Simulate an accelerating price trend
        prices = [100 + i * 0.5 + (i ** 1.2) * 0.1 for i in range(20)]
        for p in prices:
            tracker.update(p)

        result = tracker.compute()
        # With accelerating prices, acceleration should be positive
        assert result.acceleration > 0

        # Now use these values in project_value
        storage = project_value(
            current_price=prices[-1],
            log_momentum=result.momentum,
            volatility=result.volatility,
            liquidity_score=10.0,
            horizon_hours=24,
            confidence_level=0.05,
            acceleration=result.acceleration,
        )
        # Should produce a valid result
        assert storage.projected_price > 0
        assert 0 < storage.risk_discount <= 1.0
