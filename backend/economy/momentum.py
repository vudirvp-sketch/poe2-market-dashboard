"""
Price Momentum Tracker.

From PoE2_Flipper_Canonical_Formulas.md §2:

All calculations use log-returns. Never use raw price differences.

The tracker maintains a rolling window of prices and computes:
- momentum: mean of log-returns over the window
- volatility: standard deviation of log-returns (ddof=1)
- acceleration: change in momentum over the last m periods

Window size is configurable (default: 24 periods).
"""

from __future__ import annotations

import numpy as np

from backend.models.currency import MomentumResult


class PriceMomentumTracker:
    """Tracks price momentum, volatility, and acceleration using log-returns.

    All formulas are from PoE2_Flipper_Canonical_Formulas.md §2.
    AGENTS MUST NOT invent their own formulas.
    """

    def __init__(self, window_size: int = 24, history: list | None = None, min_volatility: float = 0.001):
        """
        Args:
            window_size: Number of price points in the rolling window.
                         The tracker keeps window_size + 1 prices to compute
                         window_size log-returns.
            history: Optional price history list. If provided, window_size
                     is scaled to the available data (minimum 2).
            min_volatility: Minimum volatility floor to prevent zero volatility
                            (default: 0.001 = 0.1%). Was 0.01 (1%) which
                            inflated stable currency volatility.
        """
        self.min_volatility = min_volatility
        # MEDIUM-2: Scale window to available data, with a minimum of 2
        if history is not None and len(history) > 0:
            self.window_size = min(window_size, max(2, len(history)))
        else:
            self.window_size = max(2, window_size)
        self.prices: list[float] = []

    def update(self, new_price: float) -> None:
        """Add a new price to the tracker, maintaining the rolling window.

        From §2.5 pseudocode:
            self.prices.append(new_price)
            if len(self.prices) > self.window_size + 1:
                self.prices = self.prices[-(self.window_size + 1):]
        """
        self.prices.append(new_price)
        if len(self.prices) > self.window_size + 1:
            self.prices = self.prices[-(self.window_size + 1):]

    def compute(self) -> MomentumResult:
        """Compute momentum, volatility, and acceleration.

        From §2.5 pseudocode — copied verbatim from Canonical Formulas.
        """
        if len(self.prices) < 2:
            return MomentumResult(
                momentum=0.0,
                volatility=0.0,
                acceleration=0.0,
            )

        # §2.1: log_returns[i] = ln(P[i+1] / P[i])
        log_returns = np.diff(np.log(self.prices))

        # §2.2: momentum = mean(log_returns)
        momentum = float(np.mean(log_returns))

        # §2.3: volatility = std(log_returns, ddof=1)
        volatility = float(np.std(log_returns, ddof=1)) if len(log_returns) > 1 else 0.0

        # MEDIUM-2: Minimum volatility estimate — prevent zero volatility
        # with insufficient data points, which degrades momentum-assisted model.
        # FIX: Lowered from 0.01 (1%) to 0.001 (0.1%). The old 1% floor
        # systematically inflated volatility for stable currencies, causing:
        #   - storage_value.py: risk_discount too low (0.92 vs 0.99 for vol=0.001)
        #   - scorer.py: vol_penalty too aggressive for stable pairs
        #   - All flip scores for stable currencies were depressed
        min_volatility = self.min_volatility
        volatility = max(volatility, min_volatility)

        # §2.4: acceleration with m = max(1, floor(len(log_returns) / 4))
        m = max(1, len(log_returns) // 4)
        if len(log_returns) > m:
            acceleration = float((log_returns[-1] - log_returns[-m]) / m)
        else:
            acceleration = 0.0

        return MomentumResult(
            momentum=momentum,
            volatility=volatility,
            acceleration=acceleration,
        )

    def reset(self) -> None:
        """Clear all stored prices."""
        self.prices = []

    @property
    def num_prices(self) -> int:
        """Return the current number of stored prices."""
        return len(self.prices)

    def compute_log_returns(self) -> np.ndarray:
        """Return the log-returns array for external use (e.g., anomaly detection)."""
        if len(self.prices) < 2:
            return np.array([])
        return np.diff(np.log(self.prices))
