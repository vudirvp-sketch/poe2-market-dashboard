"""
Tests for storage_value.py — Projected Value and Hold/Sell Decision.

From PoE2_Flipper_Canonical_Formulas.md Section 6.6:
    Verification example with known inputs and expected outputs.

Test categories:
1. Canonical verification example from §6.6
2. Decision boundary tests (BUY/HOLD, SELL/CONVERT, NEUTRAL)
3. Edge cases (zero price, zero volatility, zero liquidity)
"""

import numpy as np
import pytest

from backend.predictors.storage_value import project_value
from backend.models.currency import Decision


# ===========================================================================
# 1. Canonical Verification Example (§6.6)
# ===========================================================================

class TestCanonicalVerification:
    """Verify against the exact example in PoE2_Flipper_Canonical_Formulas.md §6.6.

    Input values:
        current_price = 100
        log_momentum = 0.001 (0.1% per hour)
        volatility = 0.02
        liquidity_score = 8.0
        horizon_hours = 24
        significance_level = 0.05

    Expected (from §6.6, simplified without gold fees):
        projected = 100 * exp(0.001 * 24) = 100 * exp(0.024) ≈ 102.43
        z = abs(norm.ppf(0.05)) = 1.645
        risk_discount = exp(-0.02 * 1.645 * sqrt(24)) = exp(-0.1612) ≈ 0.851
        liq_factor = 8.0/10.0 = 0.8
        adjusted = 102.43 * 0.851 * (0.9 + 0.8*0.1) = 102.43 * 0.851 * 0.98 ≈ 85.39
        net_value = 85.39 (gold fees excluded)
        ratio = 85.39 / 100 = 0.8539 < 0.97 → SELL/CONVERT
    """

    def test_projected_price(self):
        """Projected price should match canonical formula."""
        result = project_value(
            current_price=100.0,
            log_momentum=0.001,
            volatility=0.02,
            liquidity_score=8.0,
            horizon_hours=24,
            significance_level=0.05,
        )
        expected = 100.0 * np.exp(0.001 * 24)  # ≈ 102.43
        np.testing.assert_almost_equal(result.projected_price, expected, decimal=1)

    def test_risk_discount(self):
        """Risk discount should match canonical formula."""
        result = project_value(
            current_price=100.0,
            log_momentum=0.001,
            volatility=0.02,
            liquidity_score=8.0,
            horizon_hours=24,
            significance_level=0.05,
        )
        from scipy.stats import norm
        z = abs(norm.ppf(0.05))
        expected = np.exp(-0.02 * z * np.sqrt(24))  # ≈ 0.851
        np.testing.assert_almost_equal(result.risk_discount, expected, decimal=3)

    def test_adjusted_price(self):
        """Adjusted price should include risk discount and liquidity factor."""
        result = project_value(
            current_price=100.0,
            log_momentum=0.001,
            volatility=0.02,
            liquidity_score=8.0,
            horizon_hours=24,
            significance_level=0.05,
        )
        # liq_factor = 8.0 / 10.0 = 0.8
        # adjusted = projected * risk_discount * (0.9 + 0.8 * 0.1) = projected * risk_discount * 0.98
        liq_factor = 8.0 / 10.0
        expected = result.projected_price * result.risk_discount * (0.9 + liq_factor * 0.1)
        np.testing.assert_almost_equal(result.adjusted_price, expected, decimal=2)

    def test_net_value(self):
        """Net value = adjusted_price (gold fees excluded from all calculations)."""
        result = project_value(
            current_price=100.0,
            log_momentum=0.001,
            volatility=0.02,
            liquidity_score=8.0,
            horizon_hours=24,
            significance_level=0.05,
        )
        # With gold fees excluded: net_value = adjusted_price (no fee deduction)
        np.testing.assert_almost_equal(result.net_value, result.adjusted_price, decimal=2)

    def test_ratio(self):
        """Ratio should be net_value / current_price."""
        result = project_value(
            current_price=100.0,
            log_momentum=0.001,
            volatility=0.02,
            liquidity_score=8.0,
            horizon_hours=24,
            significance_level=0.05,
        )
        np.testing.assert_almost_equal(result.ratio, result.net_value / 100.0, decimal=4)

    def test_decision_sell_convert(self):
        """With high volatility, decision should be SELL/CONVERT."""
        result = project_value(
            current_price=100.0,
            log_momentum=0.001,
            volatility=0.02,
            liquidity_score=8.0,
            horizon_hours=24,
            significance_level=0.05,
        )
        assert result.decision == Decision.SELL_CONVERT


# ===========================================================================
# 2. Decision Boundary Tests
# ===========================================================================

class TestDecisionBoundaries:
    """Test BUY/HOLD, SELL/CONVERT, and NEUTRAL decisions."""

    def test_buy_hold_decision(self):
        """With strong positive momentum and low volatility, should be BUY/HOLD."""
        result = project_value(
            current_price=100.0,
            log_momentum=0.01,  # 1% per hour (very strong)
            volatility=0.001,   # very low volatility
            liquidity_score=9.0,
            horizon_hours=24,
            significance_level=0.05,
        )
        assert result.decision == Decision.BUY_HOLD

    def test_sell_convert_decision(self):
        """With negative momentum or high volatility, should be SELL/CONVERT."""
        result = project_value(
            current_price=100.0,
            log_momentum=-0.005,  # negative momentum
            volatility=0.05,      # high volatility
            liquidity_score=1.0,  # low liquidity
            horizon_hours=24,
            significance_level=0.05,
        )
        assert result.decision == Decision.SELL_CONVERT

    def test_neutral_decision(self):
        """With moderate parameters, should be NEUTRAL."""
        # To get NEUTRAL, ratio must be between 0.97 and 1.03
        # With tiny momentum, 1-hour horizon, and very low volatility:
        # ratio ≈ risk_discount * liq_factor_adjustment
        # We need risk_discount close to 1.0 and liq_factor close to 1.0
        result = project_value(
            current_price=100.0,
            log_momentum=0.0001,  # tiny positive momentum
            volatility=0.001,     # very low volatility
            liquidity_score=8.0,  # high liquidity
            horizon_hours=1,      # short horizon
            significance_level=0.05,
        )
        # Should be NEUTRAL (ratio should be close to 1.0)
        assert 0.97 < result.ratio < 1.03
        assert result.decision == Decision.NEUTRAL


# ===========================================================================
# 3. Edge Cases
# ===========================================================================

class TestEdgeCases:
    """Test edge cases for storage value computation."""

    def test_zero_price(self):
        """Zero current_price should produce ratio=0 and SELL/CONVERT."""
        result = project_value(
            current_price=0.0,
            log_momentum=0.001,
            volatility=0.02,
            liquidity_score=8.0,
            horizon_hours=24,
            significance_level=0.05,
        )
        assert result.ratio == 0.0
        assert result.decision == Decision.SELL_CONVERT

    def test_zero_volatility(self):
        """Zero volatility should give risk_discount=1.0 (no discount)."""
        result = project_value(
            current_price=100.0,
            log_momentum=0.001,
            volatility=0.0,
            liquidity_score=8.0,
            horizon_hours=24,
            significance_level=0.05,
        )
        np.testing.assert_almost_equal(result.risk_discount, 1.0, decimal=6)

    def test_zero_liquidity(self):
        """Zero liquidity should apply maximum discount (0.9 multiplier)."""
        result = project_value(
            current_price=100.0,
            log_momentum=0.0,
            volatility=0.0,
            liquidity_score=0.0,
            horizon_hours=1,
            significance_level=0.05,
        )
        # With zero momentum and volatility: projected = 100, risk_discount = 1.0
        # liq_factor = 0.0, adjusted = 100 * 1.0 * (0.9 + 0) = 90.0
        np.testing.assert_almost_equal(result.adjusted_price, 90.0, decimal=2)

    def test_high_liquidity(self):
        """Liquidity score above normalization should be clamped to 1.0."""
        result = project_value(
            current_price=100.0,
            log_momentum=0.0,
            volatility=0.0,
            liquidity_score=50.0,  # way above normalization of 10.0
            horizon_hours=1,
            significance_level=0.05,
        )
        # liq_factor = min(50/10, 1.0) = 1.0
        # adjusted = 100 * 1.0 * (0.9 + 1.0*0.1) = 100.0
        np.testing.assert_almost_equal(result.adjusted_price, 100.0, decimal=2)

    def test_net_value_equals_adjusted(self):
        """Net value should equal adjusted price (gold fees excluded)."""
        result = project_value(
            current_price=100.0,
            log_momentum=0.0,
            volatility=0.0,
            liquidity_score=10.0,
            horizon_hours=1,
            significance_level=0.05,
        )
        # adjusted = 100 * 1.0 * 1.0 = 100.0
        # net_value = 100.0 (gold fees excluded)
        np.testing.assert_almost_equal(result.net_value, 100.0, decimal=2)
