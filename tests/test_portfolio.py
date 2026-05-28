"""
Tests for portfolio.py — Risk Parity, Minimum Variance with Ledoit-Wolf,
and Correlation Shock Detection.

From PoE2_Flipper_Implementation_Spec.md §10 / §5.5:
    Tests: test_portfolio.py (verify weights sum to 1, risk parity property)

From PoE2_Flipper_Canonical_Formulas.md §10:
    All formulas must match the canonical reference.

Test categories:
1. Risk Parity weights — simplified and full (with correlations)
2. Minimum Variance weights — with and without Ledoit-Wolf shrinkage
3. Correlation Shock Detection
4. Annualized Portfolio Volatility
5. PortfolioOptimizer high-level interface
6. Edge cases
"""

import numpy as np
import pytest
from datetime import datetime, timezone

from backend.arbitrage.portfolio import (
    risk_parity_weights,
    risk_parity_weights_simplified,
    min_variance_weights,
    detect_correlation_shock,
    annualized_portfolio_volatility,
    PortfolioOptimizer,
    compute_efficient_frontier,
    compute_efficient_frontier_chart_data,
)
from backend.models.currency import PortfolioAllocation
from backend.config import AppConfig, PortfolioConfig


# ===========================================================================
# Helper: synthetic data generators
# ===========================================================================

def _make_cov_matrix(volatilities: list[float], correlations: list[list[float]] | None = None) -> np.ndarray:
    """Build a covariance matrix from volatilities and correlations.

    If correlations is None, uses identity (uncorrelated).
    """
    n = len(volatilities)
    vols = np.array(volatilities)

    if correlations is None:
        corr = np.eye(n)
    else:
        corr = np.array(correlations)

    # Cov = diag(vol) @ corr @ diag(vol)
    D = np.diag(vols)
    cov = D @ corr @ D
    return cov


def _make_log_returns(n_periods: int, cov_matrix: np.ndarray, seed: int = 42) -> np.ndarray:
    """Generate synthetic log-returns from a multivariate normal."""
    rng = np.random.RandomState(seed)
    n_assets = cov_matrix.shape[0]
    return rng.multivariate_normal(np.zeros(n_assets), cov_matrix, size=n_periods)


# ===========================================================================
# 1. Risk Parity — Simplified
# ===========================================================================

class TestRiskParitySimplified:
    """Test the simplified risk parity formula (uncorrelated assets).

    From §10.1:
        w_i = (1 / volatility_i) / sum(1 / volatility_j for j in all assets)

    Verification (§10.5):
        2 assets, σ_A = 0.02, σ_B = 0.04, correlation = 0
        w_A = (1/0.02) / (1/0.02 + 1/0.04) = 50 / 75 = 0.667
        w_B = (1/0.04) / 75 = 0.333
        risk_contrib_A = w_A^2 * σ_A^2 = 0.667^2 * 0.0004 = 0.000178
        risk_contrib_B = w_B^2 * σ_B^2 = 0.333^2 * 0.0016 = 0.000178
        Equal risk contributions ✓
    """

    def test_two_assets_uncorrelated(self):
        """Verify simplified risk parity with 2 uncorrelated assets (§10.5)."""
        vols = np.array([0.02, 0.04])
        weights = risk_parity_weights_simplified(vols)

        # Weights should sum to 1
        np.testing.assert_almost_equal(np.sum(weights), 1.0, decimal=6)

        # Expected: w_A ≈ 0.667, w_B ≈ 0.333
        np.testing.assert_almost_equal(weights[0], 0.667, decimal=2)
        np.testing.assert_almost_equal(weights[1], 0.333, decimal=2)

    def test_equal_volatility_equal_weights(self):
        """If all assets have equal volatility, weights should be equal."""
        vols = np.array([0.05, 0.05, 0.05])
        weights = risk_parity_weights_simplified(vols)

        np.testing.assert_almost_equal(np.sum(weights), 1.0, decimal=6)
        np.testing.assert_almost_equal(weights[0], weights[1], decimal=6)
        np.testing.assert_almost_equal(weights[1], weights[2], decimal=6)
        np.testing.assert_almost_equal(weights[0], 1.0 / 3, decimal=6)

    def test_three_assets_different_vols(self):
        """With 3 assets of different volatilities, low-vol gets more weight."""
        vols = np.array([0.01, 0.05, 0.10])
        weights = risk_parity_weights_simplified(vols)

        np.testing.assert_almost_equal(np.sum(weights), 1.0, decimal=6)
        # Lower volatility → higher weight
        assert weights[0] > weights[1] > weights[2]

    def test_zero_volatility_handling(self):
        """Assets with zero volatility should not cause division by zero."""
        vols = np.array([0.0, 0.05])
        weights = risk_parity_weights_simplified(vols)

        # Should not crash
        np.testing.assert_almost_equal(np.sum(weights), 1.0, decimal=6)
        # Zero-vol asset should get the highest weight
        assert weights[0] > weights[1]


# ===========================================================================
# 2. Risk Parity — Full (with correlations)
# ===========================================================================

class TestRiskParityFull:
    """Test the full risk parity optimization with correlations.

    From §10.1:
        risk_contribution_i = w_i * (Σ @ w)_i / sqrt(w^T @ Σ @ w)
        For risk parity: risk_contribution_i = risk_contribution_j for all i, j
    """

    def test_weights_sum_to_one(self):
        """Risk parity weights must sum to 1."""
        cov = _make_cov_matrix([0.02, 0.04, 0.06])
        weights = risk_parity_weights(cov)

        np.testing.assert_almost_equal(np.sum(weights), 1.0, decimal=4)

    def test_all_weights_positive(self):
        """All risk parity weights must be positive (long-only portfolio)."""
        cov = _make_cov_matrix([0.02, 0.04, 0.06])
        weights = risk_parity_weights(cov)

        assert np.all(weights >= 0.01 - 1e-6)  # minimum 1% bound

    def test_risk_parity_property(self):
        """Verify that risk contributions are approximately equal.

        This is the core property of risk parity.
        """
        cov = _make_cov_matrix([0.02, 0.04, 0.06])
        weights = risk_parity_weights(cov)

        # Compute risk contributions
        marginal_risk = cov @ weights
        risk_contrib = weights * marginal_risk

        # All risk contributions should be approximately equal
        mean_rc = np.mean(risk_contrib)
        for rc in risk_contrib:
            np.testing.assert_almost_equal(rc, mean_rc, decimal=4)

    def test_risk_parity_with_correlations(self):
        """Risk parity with correlated assets should still produce equal risk contributions."""
        corr = [
            [1.0, 0.5, 0.3],
            [0.5, 1.0, 0.2],
            [0.3, 0.2, 1.0],
        ]
        cov = _make_cov_matrix([0.02, 0.04, 0.06], corr)
        weights = risk_parity_weights(cov)

        np.testing.assert_almost_equal(np.sum(weights), 1.0, decimal=4)

        # Verify risk parity property
        marginal_risk = cov @ weights
        risk_contrib = weights * marginal_risk
        mean_rc = np.mean(risk_contrib)
        for rc in risk_contrib:
            np.testing.assert_almost_equal(rc, mean_rc, decimal=3)

    def test_single_asset(self):
        """With a single asset, weight should be 1.0."""
        cov = np.array([[0.04]])
        weights = risk_parity_weights(cov)
        np.testing.assert_almost_equal(weights[0], 1.0, decimal=6)

    def test_empty_matrix(self):
        """Empty covariance matrix should return empty weights."""
        cov = np.array([]).reshape(0, 0)
        weights = risk_parity_weights(cov)
        assert len(weights) == 0

    def test_verification_example(self):
        """Verify against the §10.5 example: 2 assets, σ_A=0.02, σ_B=0.04, corr=0."""
        cov = _make_cov_matrix([0.02, 0.04])  # uncorrelated
        weights = risk_parity_weights(cov)

        # Weights should sum to 1
        np.testing.assert_almost_equal(np.sum(weights), 1.0, decimal=4)

        # Risk contributions should be equal
        marginal_risk = cov @ weights
        risk_contrib = weights * marginal_risk
        np.testing.assert_almost_equal(risk_contrib[0], risk_contrib[1], decimal=4)


# ===========================================================================
# 3. Minimum Variance
# ===========================================================================

class TestMinVariance:
    """Test minimum variance portfolio with Ledoit-Wolf shrinkage.

    From §10.2:
        Minimizes portfolio variance = w^T * Σ * w.
        Uses Ledoit-Wolf shrinkage for robust covariance estimation.
    """

    def test_weights_sum_to_one(self):
        """Min-variance weights must sum to 1."""
        rng = np.random.RandomState(42)
        log_returns = rng.randn(100, 3) * np.array([0.01, 0.03, 0.05])
        weights, cov = min_variance_weights(log_returns, use_ledoit_wolf=True)

        np.testing.assert_almost_equal(np.sum(weights), 1.0, decimal=4)

    def test_all_weights_positive(self):
        """All min-variance weights must be positive (long-only)."""
        rng = np.random.RandomState(42)
        log_returns = rng.randn(100, 3) * np.array([0.01, 0.03, 0.05])
        weights, cov = min_variance_weights(log_returns, use_ledoit_wolf=True)

        assert np.all(weights >= 0.01 - 1e-6)

    def test_ledoit_wolf_shrinkage(self):
        """Verify Ledoit-Wolf shrinkage is applied (covariance should be well-conditioned)."""
        rng = np.random.RandomState(42)
        # Few observations relative to assets → shrinkage helps
        log_returns = rng.randn(20, 5) * 0.02
        weights, cov = min_variance_weights(log_returns, use_ledoit_wolf=True)

        # Covariance should be positive definite
        eigenvalues = np.linalg.eigvalsh(cov)
        assert np.all(eigenvalues > 0)

        # Weights should still sum to 1
        np.testing.assert_almost_equal(np.sum(weights), 1.0, decimal=4)

    def test_without_ledoit_wolf(self):
        """Min-variance without Ledoit-Wolf uses sample covariance."""
        rng = np.random.RandomState(42)
        log_returns = rng.randn(100, 3) * np.array([0.01, 0.03, 0.05])
        weights, cov = min_variance_weights(log_returns, use_ledoit_wolf=False)

        np.testing.assert_almost_equal(np.sum(weights), 1.0, decimal=4)

    def test_low_vol_asset_gets_higher_weight(self):
        """Min-variance should assign more weight to lower-volatility assets."""
        rng = np.random.RandomState(42)
        # Asset 0: very low vol, Asset 1: medium, Asset 2: high
        log_returns = rng.randn(200, 3) * np.array([0.005, 0.03, 0.08])
        weights, cov = min_variance_weights(log_returns, use_ledoit_wolf=True)

        # Lowest vol asset should get highest weight
        assert weights[0] > weights[2]

    def test_single_asset(self):
        """With a single asset, weight should be 1.0."""
        rng = np.random.RandomState(42)
        log_returns = rng.randn(50, 1) * 0.02
        weights, cov = min_variance_weights(log_returns)

        np.testing.assert_almost_equal(weights[0], 1.0, decimal=6)


# ===========================================================================
# 4. Correlation Shock Detection
# ===========================================================================

class TestCorrelationShock:
    """Test correlation shock detection.

    From §10.3:
        If average pairwise correlation increases by >50% compared to
        the previous week, emit a warning.
    """

    def test_no_shock(self):
        """No shock when correlations are stable."""
        corr_prev = np.array([
            [1.0, 0.3, 0.2],
            [0.3, 1.0, 0.4],
            [0.2, 0.4, 1.0],
        ])
        corr_curr = np.array([
            [1.0, 0.35, 0.25],
            [0.35, 1.0, 0.45],
            [0.25, 0.45, 1.0],
        ])

        # Small increase → no shock
        assert not detect_correlation_shock(corr_curr, corr_prev, threshold=0.5)

    def test_shock_detected(self):
        """Shock detected when correlations spike by >50%."""
        corr_prev = np.array([
            [1.0, 0.2, 0.1],
            [0.2, 1.0, 0.15],
            [0.1, 0.15, 1.0],
        ])
        # Average off-diagonal prev ≈ 0.15
        # Average off-diagonal curr ≈ 0.45 → 200% increase
        corr_curr = np.array([
            [1.0, 0.5, 0.4],
            [0.5, 1.0, 0.45],
            [0.4, 0.45, 1.0],
        ])

        assert detect_correlation_shock(corr_curr, corr_prev, threshold=0.5)

    def test_previous_negative_correlation(self):
        """When previous avg correlation ≤ 0, shock if current > 0.3."""
        corr_prev = np.array([
            [1.0, -0.1, -0.2],
            [-0.1, 1.0, -0.15],
            [-0.2, -0.15, 1.0],
        ])
        corr_curr = np.array([
            [1.0, 0.5, 0.4],
            [0.5, 1.0, 0.45],
            [0.4, 0.45, 1.0],
        ])

        # avg_previous < 0, avg_current > 0.3 → shock
        assert detect_correlation_shock(corr_curr, corr_prev, threshold=0.5)

    def test_previous_negative_no_shock(self):
        """When previous avg ≤ 0 and current ≤ 0.3, no shock."""
        corr_prev = np.array([
            [1.0, -0.1, -0.2],
            [-0.1, 1.0, -0.15],
            [-0.2, -0.15, 1.0],
        ])
        corr_curr = np.array([
            [1.0, 0.1, 0.05],
            [0.1, 1.0, 0.1],
            [0.05, 0.1, 1.0],
        ])

        # avg_previous < 0, avg_current ≈ 0.083 < 0.3 → no shock
        assert not detect_correlation_shock(corr_curr, corr_prev, threshold=0.5)

    def test_single_asset(self):
        """With a single asset, no shock detection possible."""
        corr_prev = np.array([[1.0]])
        corr_curr = np.array([[1.0]])

        assert not detect_correlation_shock(corr_curr, corr_prev)

    def test_threshold_boundary(self):
        """Test exactly at the threshold boundary."""
        corr_prev = np.array([
            [1.0, 0.2],
            [0.2, 1.0],
        ])
        # avg_prev = 0.2, avg_curr = 0.31 → increase = 55% > 50%
        corr_curr = np.array([
            [1.0, 0.31],
            [0.31, 1.0],
        ])

        assert detect_correlation_shock(corr_curr, corr_prev, threshold=0.5)

        # avg_curr = 0.29 → increase = 45% < 50%
        corr_curr_no = np.array([
            [1.0, 0.29],
            [0.29, 1.0],
        ])

        assert not detect_correlation_shock(corr_curr_no, corr_prev, threshold=0.5)


# ===========================================================================
# 5. Annualized Portfolio Volatility
# ===========================================================================

class TestAnnualizedVolatility:
    """Test annualized portfolio volatility computation.

    From §10.4:
        portfolio_vol_daily = sqrt(w^T @ Σ @ w)
        portfolio_vol_annual = portfolio_vol_daily * sqrt(periods_per_year)
    """

    def test_basic_computation(self):
        """Verify annualization factor is applied correctly."""
        weights = np.array([0.5, 0.5])
        cov = np.array([[0.01, 0.0], [0.0, 0.04]])
        # Daily vol = sqrt(0.5^2 * 0.01 + 0.5^2 * 0.04) = sqrt(0.0025 + 0.01) = sqrt(0.0125) ≈ 0.1118
        # Annual vol = 0.1118 * sqrt(365) ≈ 2.136

        annual_vol = annualized_portfolio_volatility(weights, cov, periods_per_year=365)

        expected_daily = np.sqrt(0.5**2 * 0.01 + 0.5**2 * 0.04)
        expected_annual = expected_daily * np.sqrt(365)

        np.testing.assert_almost_equal(annual_vol, expected_annual, decimal=4)

    def test_zero_variance(self):
        """Portfolio with zero variance should have zero annualized vol."""
        weights = np.array([1.0])
        cov = np.array([[0.0]])

        vol = annualized_portfolio_volatility(weights, cov, periods_per_year=365)
        np.testing.assert_almost_equal(vol, 0.0, decimal=6)


# ===========================================================================
# 6. PortfolioOptimizer — High-Level Interface
# ===========================================================================

class TestPortfolioOptimizer:
    """Test the high-level PortfolioOptimizer class."""

    @pytest.fixture
    def config(self):
        """Create a test config with risk_parity method."""
        return AppConfig(
            portfolio=PortfolioConfig(
                method="risk_parity",
                correlation_shock_threshold=0.5,
                correlation_shock_position_reduction=0.5,
                ledoit_wolf_shrinkage=True,
                rebalance_interval_hours=24,
            )
        )

    @pytest.fixture
    def config_min_var(self):
        """Create a test config with min_variance method."""
        return AppConfig(
            portfolio=PortfolioConfig(
                method="min_variance",
                correlation_shock_threshold=0.5,
                correlation_shock_position_reduction=0.5,
                ledoit_wolf_shrinkage=True,
                rebalance_interval_hours=24,
            )
        )

    def test_risk_parity_optimization(self, config):
        """Risk parity optimization produces valid allocation."""
        optimizer = PortfolioOptimizer(config)
        rng = np.random.RandomState(42)
        log_returns = rng.randn(100, 3) * np.array([0.01, 0.03, 0.05])

        allocation = optimizer.optimize(
            currency_names=["exalted", "chaos", "divine"],
            log_returns=log_returns,
        )

        assert isinstance(allocation, PortfolioAllocation)
        assert allocation.method == "risk_parity"
        assert len(allocation.weights) == 3
        assert "exalted" in allocation.weights
        assert "chaos" in allocation.weights
        assert "divine" in allocation.weights

        # Weights sum to ~1
        total = sum(allocation.weights.values())
        np.testing.assert_almost_equal(total, 1.0, decimal=4)

        # All weights positive
        assert all(w >= 0.0 for w in allocation.weights.values())

    def test_min_variance_optimization(self, config_min_var):
        """Min-variance optimization produces valid allocation."""
        optimizer = PortfolioOptimizer(config_min_var)
        rng = np.random.RandomState(42)
        log_returns = rng.randn(100, 3) * np.array([0.01, 0.03, 0.05])

        allocation = optimizer.optimize(
            currency_names=["exalted", "chaos", "divine"],
            log_returns=log_returns,
        )

        assert isinstance(allocation, PortfolioAllocation)
        assert allocation.method == "min_variance"
        assert len(allocation.weights) == 3

        total = sum(allocation.weights.values())
        np.testing.assert_almost_equal(total, 1.0, decimal=4)

    def test_with_correlation_shock(self, config):
        """Correlation shock reduces position sizes."""
        optimizer = PortfolioOptimizer(config)
        rng = np.random.RandomState(42)
        log_returns = rng.randn(100, 3) * np.array([0.01, 0.03, 0.05])

        # Previous period: low correlation
        corr_prev = np.array([
            [1.0, 0.1, 0.1],
            [0.1, 1.0, 0.1],
            [0.1, 0.1, 1.0],
        ])

        # Current: high correlation (should trigger shock)
        # Generate returns that have high correlation
        rng2 = np.random.RandomState(123)
        base = rng2.randn(100, 1) * 0.03
        noise = rng2.randn(100, 3) * 0.005
        log_returns_shock = base + noise  # high correlation

        allocation = optimizer.optimize(
            currency_names=["exalted", "chaos", "divine"],
            log_returns=log_returns_shock,
            previous_corr=corr_prev,
        )

        # Should detect correlation shock
        assert allocation.correlation_warning is True

    def test_empty_data(self, config):
        """Empty data should return empty allocation."""
        optimizer = PortfolioOptimizer(config)

        allocation = optimizer.optimize(
            currency_names=[],
            log_returns=np.array([]),
        )

        assert isinstance(allocation, PortfolioAllocation)
        assert allocation.weights == {}
        assert allocation.expected_risk == 0.0

    def test_unknown_method_fallback(self):
        """Unknown method should fall back to risk_parity."""
        config = AppConfig(
            portfolio=PortfolioConfig(method="unknown_method")
        )
        optimizer = PortfolioOptimizer(config)
        rng = np.random.RandomState(42)
        log_returns = rng.randn(100, 3) * 0.02

        allocation = optimizer.optimize(
            currency_names=["a", "b", "c"],
            log_returns=log_returns,
        )

        # Should fall back to risk_parity
        assert allocation.method == "risk_parity"

    def test_last_rebalance_set(self, config):
        """Allocation should have a last_rebalance timestamp."""
        optimizer = PortfolioOptimizer(config)
        rng = np.random.RandomState(42)
        log_returns = rng.randn(100, 3) * 0.02

        allocation = optimizer.optimize(
            currency_names=["a", "b", "c"],
            log_returns=log_returns,
        )

        assert allocation.last_rebalance is not None
        assert isinstance(allocation.last_rebalance, datetime)


# ===========================================================================
# 7. Edge Cases
# ===========================================================================

class TestEdgeCases:
    """Test edge cases and boundary conditions."""

    def test_identical_assets(self):
        """Identical volatility assets should get equal weights in risk parity."""
        cov = _make_cov_matrix([0.05, 0.05, 0.05])
        weights = risk_parity_weights(cov)

        # Should be approximately equal
        np.testing.assert_almost_equal(np.sum(weights), 1.0, decimal=4)
        np.testing.assert_almost_equal(weights[0], 1.0 / 3, decimal=2)
        np.testing.assert_almost_equal(weights[1], 1.0 / 3, decimal=2)
        np.testing.assert_almost_equal(weights[2], 1.0 / 3, decimal=2)

    def test_very_high_volatility_difference(self):
        """Extreme volatility difference should still produce valid weights."""
        cov = _make_cov_matrix([0.001, 0.5])
        weights = risk_parity_weights(cov)

        np.testing.assert_almost_equal(np.sum(weights), 1.0, decimal=4)
        assert np.all(weights >= 0.0)

    def test_min_variance_with_few_observations(self):
        """Ledoit-Wolf should handle few observations gracefully."""
        rng = np.random.RandomState(42)
        # 10 observations, 5 assets — challenging for sample covariance
        log_returns = rng.randn(10, 5) * 0.02

        weights, cov = min_variance_weights(log_returns, use_ledoit_wolf=True)

        # Weights should sum to 1
        np.testing.assert_almost_equal(np.sum(weights), 1.0, decimal=4)
        # All weights should be positive
        assert np.all(weights >= 0.01 - 1e-4)

    def test_perfectly_correlated_assets(self):
        """With perfectly correlated assets, risk parity should still work."""
        corr = [[1.0, 1.0], [1.0, 1.0]]
        cov = _make_cov_matrix([0.02, 0.04], corr)
        weights = risk_parity_weights(cov)

        np.testing.assert_almost_equal(np.sum(weights), 1.0, decimal=4)
        assert np.all(weights >= 0.0)

    def test_two_assets_risk_parity_verification(self):
        """Detailed verification: 2 assets with known risk parity property.

        From §10.5 verification:
            σ_A = 0.02, σ_B = 0.04, correlation = 0
            w_A = 2/3, w_B = 1/3
            risk_contrib_A = w_A^2 * σ_A^2 = (4/9) * 0.0004 = 0.000178
            risk_contrib_B = w_B^2 * σ_B^2 = (1/9) * 0.0016 = 0.000178
        """
        cov = _make_cov_matrix([0.02, 0.04])
        weights = risk_parity_weights(cov)

        # Verify weights are close to 2/3 and 1/3
        np.testing.assert_almost_equal(weights[0], 2 / 3, decimal=2)
        np.testing.assert_almost_equal(weights[1], 1 / 3, decimal=2)

        # Verify equal risk contributions
        marginal = cov @ weights
        risk_contrib = weights * marginal
        np.testing.assert_almost_equal(risk_contrib[0], risk_contrib[1], decimal=4)


# ===========================================================================
# 8. Efficient Frontier (Spec Section 5)
# ===========================================================================

class TestEfficientFrontier:
    """Test efficient frontier computation.

    From PoE2_Flipper_Implementation_Spec.md §5.6:
        - Test that frontier returns are monotonically increasing
        - Test that frontier risks are convex (parabolic shape)
        - Test that current portfolio lies on or below the frontier
        - Test with 3 assets + known covariance
    """

    def test_basic_frontier_computation(self):
        """Efficient frontier should produce valid points with 3 assets."""
        rng = np.random.RandomState(42)
        log_returns = rng.randn(100, 3) * np.array([0.01, 0.03, 0.05])

        frontier_ret, frontier_risk, frontier_weights = compute_efficient_frontier(
            log_returns, n_points=20
        )

        # Should have at least some points
        assert len(frontier_ret) > 0
        assert len(frontier_risk) == len(frontier_ret)
        assert len(frontier_weights) == len(frontier_ret)

    def test_returns_monotonically_increasing(self):
        """Frontier returns should be monotonically increasing."""
        rng = np.random.RandomState(42)
        log_returns = rng.randn(100, 3) * np.array([0.01, 0.03, 0.05])

        frontier_ret, frontier_risk, _ = compute_efficient_frontier(
            log_returns, n_points=20
        )

        if len(frontier_ret) > 1:
            # Returns should be non-decreasing (they are by construction from linspace)
            for i in range(1, len(frontier_ret)):
                assert frontier_ret[i] >= frontier_ret[i - 1] - 1e-10

    def test_weights_sum_to_one(self):
        """All frontier portfolio weights should sum to 1."""
        rng = np.random.RandomState(42)
        log_returns = rng.randn(100, 3) * np.array([0.01, 0.03, 0.05])

        _, _, frontier_weights = compute_efficient_frontier(
            log_returns, n_points=20
        )

        for w in frontier_weights:
            np.testing.assert_almost_equal(np.sum(w), 1.0, decimal=4)

    def test_all_weights_positive(self):
        """All frontier weights should be positive (long-only)."""
        rng = np.random.RandomState(42)
        log_returns = rng.randn(100, 3) * np.array([0.01, 0.03, 0.05])

        _, _, frontier_weights = compute_efficient_frontier(
            log_returns, n_points=20
        )

        for w in frontier_weights:
            assert np.all(w >= 0.01 - 1e-6)

    def test_current_portfolio_below_or_on_frontier(self):
        """Current portfolio should lie on or below the efficient frontier."""
        rng = np.random.RandomState(42)
        log_returns = rng.randn(100, 3) * np.array([0.01, 0.03, 0.05])

        # Equal-weight portfolio
        current_weights = np.ones(3) / 3

        chart_data = compute_efficient_frontier_chart_data(
            log_returns=log_returns,
            current_weights=current_weights,
            currency_names=["a", "b", "c"],
            n_points=20,
            periods_per_year=365,
        )

        # Current portfolio should exist
        current_port = chart_data["current_portfolio"]
        assert current_port["risk"] > 0

        # Current portfolio return should be <= max frontier return
        frontier = chart_data["frontier"]
        if frontier["returns"]:
            assert current_port["return"] <= max(frontier["returns"]) + 1e-6

    def test_chart_data_structure(self):
        """compute_efficient_frontier_chart_data should return correct structure."""
        rng = np.random.RandomState(42)
        log_returns = rng.randn(100, 3) * np.array([0.01, 0.03, 0.05])

        chart_data = compute_efficient_frontier_chart_data(
            log_returns=log_returns,
            currency_names=["exalted", "chaos", "divine"],
            n_points=20,
        )

        assert "frontier" in chart_data
        assert "current_portfolio" in chart_data
        assert "individual_assets" in chart_data
        assert "returns" in chart_data["frontier"]
        assert "risks" in chart_data["frontier"]

        # Individual assets should have 3 entries
        assert len(chart_data["individual_assets"]) == 3
        for asset in chart_data["individual_assets"]:
            assert "name" in asset
            assert "return" in asset
            assert "risk" in asset
            assert "weight" in asset

    def test_empty_data(self):
        """Empty log-returns should return empty frontier."""
        frontier_ret, frontier_risk, frontier_weights = compute_efficient_frontier(
            np.array([]), n_points=10
        )
        assert len(frontier_ret) == 0

    def test_single_asset(self):
        """Single asset should return empty frontier (need >= 2 assets)."""
        rng = np.random.RandomState(42)
        log_returns = rng.randn(100, 1) * 0.02

        frontier_ret, frontier_risk, frontier_weights = compute_efficient_frontier(
            log_returns, n_points=10
        )
        assert len(frontier_ret) == 0
