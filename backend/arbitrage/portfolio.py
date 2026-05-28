"""
Portfolio Construction — Risk Parity and Minimum Variance with Ledoit-Wolf Shrinkage.

From PoE2_Flipper_Canonical_Formulas.md §10:

Two portfolio methods:
1. Risk Parity — each asset contributes equally to total portfolio risk.
   Simplified: w_i = (1/volatility_i) / sum(1/volatility_j)
   Full (accounts for correlations): iterative SLSQP optimization.

2. Minimum Variance — minimizes w^T * Σ * w with Ledoit-Wolf shrinkage
   for robust covariance estimation when observations are few.

3. Correlation Shock Detection — if average pairwise correlation increases
   by >50% compared to the previous week, emit warning and reduce positions.

AGENTS MUST NOT invent their own formulas.
All math must be copied from PoE2_Flipper_Canonical_Formulas.md §10.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

import numpy as np
from scipy.optimize import minimize

from backend.config import AppConfig, PortfolioConfig, get_settings
from backend.models.currency import PortfolioAllocation

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# §5 Efficient Frontier (Spec Section 5)
# ---------------------------------------------------------------------------

def compute_efficient_frontier(
    log_returns: np.ndarray,
    n_points: int = 50,
) -> tuple[np.ndarray, np.ndarray, list[np.ndarray]]:
    """Compute the efficient frontier for a set of assets.

    From PoE2_Flipper_Implementation_Spec.md §5.1:
        For each target return level (from min to max of individual asset returns):
        1. Solve: minimize w^T Σ w  subject to:
           - w^T μ = target_return
           - sum(w) = 1
           - w >= 0.01
        2. Record (target_return, sqrt(w^T Σ w), w)

    Args:
        log_returns: T×N matrix of log-returns (T periods, N assets).
        n_points: Number of points on the frontier (default 50).

    Returns:
        Tuple of (frontier_returns, frontier_risks, frontier_weights).
    """
    if log_returns.size == 0 or log_returns.shape[1] < 2:
        return np.array([]), np.array([]), []

    # Estimate expected returns (simple historical mean)
    mu = np.mean(log_returns, axis=0)

    # Ledoit-Wolf covariance for robust estimation
    try:
        from sklearn.covariance import LedoitWolf
        lw = LedoitWolf().fit(log_returns)
        cov = lw.covariance_
    except Exception:
        cov = np.cov(log_returns, rowvar=False, ddof=1)
        if cov.ndim == 0:
            cov = np.array([[float(cov)]])

    n = len(mu)
    target_returns = np.linspace(float(mu.min()), float(mu.max()), n_points)

    frontier_returns = []
    frontier_risks = []
    frontier_weights = []

    for target in target_returns:
        constraints = [
            {"type": "eq", "fun": lambda w: np.sum(w) - 1.0},
            {"type": "eq", "fun": lambda w, t=target: float(w @ mu - t)},
        ]
        bounds = [(0.01, 1.0)] * n
        w0 = np.ones(n) / n

        result = minimize(
            lambda w: float(w @ cov @ w),
            w0,
            method="SLSQP",
            bounds=bounds,
            constraints=constraints,
            options={"maxiter": 500, "ftol": 1e-10},
        )

        if result.success:
            frontier_returns.append(target)
            frontier_risks.append(float(np.sqrt(result.x @ cov @ result.x)))
            frontier_weights.append(result.x)

    return np.array(frontier_returns), np.array(frontier_risks), frontier_weights


def compute_efficient_frontier_chart_data(
    log_returns: np.ndarray,
    current_weights: np.ndarray | None = None,
    currency_names: list[str] | None = None,
    n_points: int = 50,
    periods_per_year: int = 365,
) -> dict:
    """Compute efficient frontier data suitable for frontend charting.

    From Spec §5.2: Returns dict with:
        - frontier: {returns: [...], risks: [...]}
        - current_portfolio: {return: float, risk: float}
        - individual_assets: [{name, return, risk, weight}, ...]

    Annualization (Spec §5.5):
        Risk axis: daily_vol * sqrt(365)
        Return axis: daily_return * 365

    Args:
        log_returns: T×N matrix of log-returns.
        current_weights: Current portfolio weights (N,). If None, uses equal weights.
        currency_names: Names for each asset.
        n_points: Number of frontier points.
        periods_per_year: For annualization (default 365 for daily).

    Returns:
        Dict with frontier, current_portfolio, individual_assets.
    """
    if log_returns.size == 0 or log_returns.shape[1] < 2:
        return {
            "frontier": {"returns": [], "risks": []},
            "current_portfolio": {"return": 0.0, "risk": 0.0},
            "individual_assets": [],
        }

    # Ensure 2D
    if log_returns.ndim == 1:
        log_returns = log_returns.reshape(-1, 1)

    n = log_returns.shape[1]
    names = currency_names or [f"asset_{i}" for i in range(n)]
    weights = current_weights if current_weights is not None else np.ones(n) / n

    # Compute frontier
    frontier_ret, frontier_risk, _ = compute_efficient_frontier(log_returns, n_points)

    # Annualize frontier values
    ann_factor = np.sqrt(periods_per_year)
    annualized_frontier_returns = frontier_ret * periods_per_year
    annualized_frontier_risks = frontier_risk * ann_factor

    # Compute Ledoit-Wolf covariance for current portfolio metrics
    try:
        from sklearn.covariance import LedoitWolf
        lw = LedoitWolf().fit(log_returns)
        cov = lw.covariance_
    except Exception:
        cov = np.cov(log_returns, rowvar=False, ddof=1)
        if cov.ndim == 0:
            cov = np.array([[float(cov)]])

    mu = np.mean(log_returns, axis=0)

    # Current portfolio metrics (annualized)
    current_return = float(weights @ mu) * periods_per_year
    current_risk = float(np.sqrt(weights @ cov @ weights)) * ann_factor

    # Individual asset metrics (annualized)
    individual_assets = []
    asset_vols = np.sqrt(np.diag(cov))
    for i in range(n):
        individual_assets.append({
            "name": names[i],
            "return": float(mu[i]) * periods_per_year,
            "risk": float(asset_vols[i]) * ann_factor,
            "weight": float(weights[i]),
        })

    return {
        "frontier": {
            "returns": [float(r) for r in annualized_frontier_returns],
            "risks": [float(r) for r in annualized_frontier_risks],
        },
        "current_portfolio": {
            "return": round(current_return, 6),
            "risk": round(current_risk, 6),
        },
        "individual_assets": individual_assets,
    }


# ---------------------------------------------------------------------------
# §10.1 Risk Parity
# ---------------------------------------------------------------------------

def risk_parity_weights(cov_matrix: np.ndarray) -> np.ndarray:
    """Compute risk parity portfolio weights.

    From §10.1:
        risk_contribution_i = w_i * (Σ @ w)_i / sqrt(w^T @ Σ @ w)
        For risk parity: risk_contribution_i = risk_contribution_j for all i, j

    Full implementation (accounts for correlations) using SLSQP.

    Args:
        cov_matrix: N×N covariance matrix of log-returns.

    Returns:
        N×1 weight vector (sums to 1, all positive).
    """
    n = cov_matrix.shape[0]

    if n == 0:
        return np.array([])

    if n == 1:
        return np.array([1.0])

    def risk_parity_objective(w: np.ndarray) -> float:
        port_var = w @ cov_matrix @ w
        marginal_risk = cov_matrix @ w
        risk_contrib = w * marginal_risk
        # Target: all risk contributions equal = port_var / n
        target = port_var / n
        # Minimize sum of squared deviations from target
        return float(np.sum((risk_contrib - target) ** 2))

    # Initial guess: inverse volatility (§10.1 simplified formula)
    vols = np.sqrt(np.diag(cov_matrix))
    # Avoid division by zero for zero-volatility assets
    vols_safe = np.where(vols > 1e-12, vols, 1e-12)
    w0 = (1.0 / vols_safe) / np.sum(1.0 / vols_safe)

    # Constraints: weights sum to 1, all positive
    constraints = {"type": "eq", "fun": lambda w: np.sum(w) - 1.0}
    bounds = [(0.01, 1.0)] * n  # minimum 1% per asset to avoid zero weights

    result = minimize(
        risk_parity_objective,
        w0,
        method="SLSQP",
        bounds=bounds,
        constraints=constraints,
        options={"maxiter": 1000, "ftol": 1e-12},
    )

    if not result.success:
        logger.warning("Risk parity optimization did not converge: %s", result.message)
        # Fall back to simplified inverse-volatility weights
        return w0

    return result.x


def risk_parity_weights_simplified(volatilities: np.ndarray) -> np.ndarray:
    """Compute simplified risk parity weights (uncorrelated assets).

    From §10.1 simplified implementation:
        w_i = (1 / volatility_i) / sum(1 / volatility_j for j in all assets)

    Args:
        volatilities: Array of per-asset volatilities (std of log-returns).

    Returns:
        Weight vector (sums to 1).
    """
    vols_safe = np.where(volatilities > 1e-12, volatilities, 1e-12)
    inv_vols = 1.0 / vols_safe
    return inv_vols / np.sum(inv_vols)


# ---------------------------------------------------------------------------
# §10.2 Minimum Variance Portfolio with Ledoit-Wolf Shrinkage
# ---------------------------------------------------------------------------

def min_variance_weights(
    log_returns: np.ndarray,
    use_ledoit_wolf: bool = True,
) -> tuple[np.ndarray, np.ndarray]:
    """Compute minimum variance portfolio weights.

    From §10.2:
        Minimizes portfolio variance = w^T * Σ * w.
        Uses the sample covariance matrix Σ of log-returns.
        With Ledoit-Wolf shrinkage for stability with few observations.

    Args:
        log_returns: T×N matrix of log-returns (T periods, N assets).
        use_ledoit_wolf: Whether to apply Ledoit-Wolf shrinkage (default True).

    Returns:
        Tuple of (weights, shrunk_cov_matrix).
    """
    if use_ledoit_wolf:
        from sklearn.covariance import LedoitWolf

        lw = LedoitWolf().fit(log_returns)
        cov_matrix = lw.covariance_
    else:
        # Sample covariance with ddof=1 (Bessel's correction)
        cov_matrix = np.cov(log_returns, rowvar=False, ddof=1)
        # Ensure 2D even with single asset
        if cov_matrix.ndim == 0:
            cov_matrix = np.array([[float(cov_matrix)]])

    n = cov_matrix.shape[0]

    if n == 0:
        return np.array([]), cov_matrix

    if n == 1:
        return np.array([1.0]), cov_matrix

    def portfolio_variance(w: np.ndarray) -> float:
        return float(w @ cov_matrix @ w)

    w0 = np.ones(n) / n  # equal weight starting point

    constraints = {"type": "eq", "fun": lambda w: np.sum(w) - 1.0}
    bounds = [(0.01, 1.0)] * n  # minimum 1% per asset

    result = minimize(
        portfolio_variance,
        w0,
        method="SLSQP",
        bounds=bounds,
        constraints=constraints,
        options={"maxiter": 1000, "ftol": 1e-12},
    )

    if not result.success:
        logger.warning(
            "Min-variance optimization did not converge: %s. "
            "Falling back to equal weights.",
            result.message,
        )
        return w0, cov_matrix

    return result.x, cov_matrix


# ---------------------------------------------------------------------------
# §10.3 Correlation Shock Detection
# ---------------------------------------------------------------------------

def detect_correlation_shock(
    current_corr: np.ndarray,
    previous_corr: np.ndarray,
    threshold: float = 0.5,
) -> bool:
    """Detect if average pairwise correlation has spiked.

    From §10.3:
        If the average pairwise correlation of the portfolio assets
        increases by >50% compared to the previous week, emit a warning.

    Args:
        current_corr: N×N correlation matrix (current week).
        previous_corr: N×N correlation matrix (previous week).
        threshold: Fractional increase that triggers warning (default 0.5 = 50%).

    Returns:
        True if correlation shock detected.
    """
    n = current_corr.shape[0]
    if n < 2:
        return False  # can't compute pairwise correlation with <2 assets

    # Average off-diagonal correlation
    mask = ~np.eye(n, dtype=bool)  # exclude diagonal

    avg_current = float(np.mean(current_corr[mask]))
    avg_previous = float(np.mean(previous_corr[mask]))

    if avg_previous <= 0:
        # From §10.3: "if avg_previous <= 0: return avg_current > 0.3"
        return avg_current > 0.3

    increase = (avg_current - avg_previous) / abs(avg_previous)
    return increase > threshold


# ---------------------------------------------------------------------------
# §10.4 Annualized Portfolio Volatility
# ---------------------------------------------------------------------------

def annualized_portfolio_volatility(
    weights: np.ndarray,
    cov_matrix: np.ndarray,
    periods_per_year: int = 365,
) -> float:
    """Compute annualized portfolio volatility.

    From §10.4:
        portfolio_vol_daily = sqrt(w^T @ Σ @ w)
        portfolio_vol_annual = portfolio_vol_daily * sqrt(periods_per_year)

    Args:
        weights: Portfolio weight vector.
        cov_matrix: Covariance matrix (on the same frequency as returns).
        periods_per_year: Number of return periods per year.
            365 for daily returns, 365*24=8760 for hourly returns.

    Returns:
        Annualized portfolio volatility.
    """
    daily_var = float(weights @ cov_matrix @ weights)
    daily_vol = np.sqrt(max(daily_var, 0.0))
    return daily_vol * np.sqrt(periods_per_year)


# ---------------------------------------------------------------------------
# High-level Portfolio Optimizer
# ---------------------------------------------------------------------------

class PortfolioOptimizer:
    """High-level portfolio optimizer that orchestrates risk parity
    or min-variance allocation, correlation shock detection, and
    position size reduction.

    From spec §5.5:
        Two portfolio methods are available; the active method is
        selected by config.

    From spec §7.6 Tab: Portfolio (LATE phase):
        - Bar chart: recommended weights per currency.
        - Portfolio risk metric (annualized volatility).
        - Correlation warning indicator.
        - "Rebalance" button.
    """

    def __init__(self, config: AppConfig | None = None):
        cfg = config or get_settings()
        self._portfolio_cfg = cfg.portfolio

    def optimize(
        self,
        currency_names: list[str],
        log_returns: np.ndarray,
        previous_corr: np.ndarray | None = None,
        periods_per_year: int = 365,
    ) -> PortfolioAllocation:
        """Compute portfolio allocation.

        Args:
            currency_names: List of N currency api_ids.
            log_returns: T×N matrix of log-returns (T periods, N assets).
            previous_corr: N×N correlation matrix from the previous period
                (for correlation shock detection). If None, no shock detection.
            periods_per_year: Number of return periods per year for
                annualization.

        Returns:
            PortfolioAllocation with weights, risk, method, and warnings.
        """
        n = len(currency_names)
        if n == 0 or log_returns.size == 0:
            return PortfolioAllocation(
                weights={},
                expected_risk=0.0,
                method=self._portfolio_cfg.method,
                correlation_warning=False,
                last_rebalance=datetime.now(timezone.utc),
            )

        # Ensure log_returns is 2D
        if log_returns.ndim == 1:
            log_returns = log_returns.reshape(-1, 1)

        method = self._portfolio_cfg.method
        correlation_warning = False

        if method == "risk_parity":
            weights, cov_matrix = self._optimize_risk_parity(log_returns)
        elif method == "min_variance":
            weights, cov_matrix = self._optimize_min_variance(log_returns)
        else:
            logger.warning(
                "Unknown portfolio method '%s'. Falling back to risk_parity.",
                method,
            )
            weights, cov_matrix = self._optimize_risk_parity(log_returns)
            method = "risk_parity"

        # Correlation shock detection (§10.3)
        if previous_corr is not None and previous_corr.shape[0] == n:
            current_corr = np.corrcoef(log_returns, rowvar=False)
            # Ensure 2D for single asset
            if current_corr.ndim == 0:
                current_corr = np.array([[1.0]])

            correlation_warning = detect_correlation_shock(
                current_corr,
                previous_corr,
                threshold=self._portfolio_cfg.correlation_shock_threshold,
            )

            # If shock detected, reduce position sizes
            if correlation_warning:
                reduction = self._portfolio_cfg.correlation_shock_position_reduction
                logger.warning(
                    "Correlation shock detected! Reducing position sizes by %.0f%%.",
                    reduction * 100,
                )
                weights = weights * (1.0 - reduction)
                # Re-normalize so weights sum to 1
                weight_sum = np.sum(weights)
                if weight_sum > 0:
                    weights = weights / weight_sum

        # Compute annualized risk (§10.4)
        expected_risk = annualized_portfolio_volatility(
            weights, cov_matrix, periods_per_year
        )

        # Build weights dict
        weights_dict = {
            name: float(w) for name, w in zip(currency_names, weights)
        }

        return PortfolioAllocation(
            weights=weights_dict,
            expected_risk=expected_risk,
            method=method,
            correlation_warning=correlation_warning,
            last_rebalance=datetime.now(timezone.utc),
        )

    def _optimize_risk_parity(
        self, log_returns: np.ndarray
    ) -> tuple[np.ndarray, np.ndarray]:
        """Run risk parity optimization.

        Returns (weights, covariance_matrix).
        """
        # Compute sample covariance for risk parity
        if log_returns.shape[1] == 1:
            cov_matrix = np.cov(log_returns, rowvar=False, ddof=1)
            if cov_matrix.ndim == 0:
                cov_matrix = np.array([[float(cov_matrix)]])
            return np.array([1.0]), cov_matrix

        cov_matrix = np.cov(log_returns, rowvar=False, ddof=1)
        if cov_matrix.ndim == 0:
            cov_matrix = np.array([[float(cov_matrix)]])

        weights = risk_parity_weights(cov_matrix)
        return weights, cov_matrix

    def _optimize_min_variance(
        self, log_returns: np.ndarray
    ) -> tuple[np.ndarray, np.ndarray]:
        """Run minimum variance optimization with Ledoit-Wolf shrinkage.

        Returns (weights, shrunk_covariance_matrix).
        """
        use_lw = self._portfolio_cfg.ledoit_wolf_shrinkage
        weights, cov_matrix = min_variance_weights(log_returns, use_ledoit_wolf=use_lw)
        return weights, cov_matrix
