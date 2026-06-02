"""
Tests for triangular arbitrage detection.

NOTE: Gold fee calculations were removed from the triangular arbitrage
module. References to gold fees below are HISTORICAL and test the
fee-free logic only.

From PoE2_Flipper_Canonical_Formulas.md §8 Verification:

3 currencies: Chaos (C), Divine (D), Exalted (E)
Rates:
  C→D = 0.008  (1 Chaos gets you 0.008 Divine)
  D→E = 12     (1 Divine gets you 12 Exalted)
  E→C = 10.5   (1 Exalted gets you 10.5 Chaos)

Gold costs: C=160, D=800, E=120  (HISTORICAL — gold fees removed)
Prices in Chaos: C=1, D=125, E=10.5
gold_to_chaos_rate = 0.001       (HISTORICAL — gold fees removed)

With gold_fee_fraction = 0 (for comparison):
  cumulative = 0.008 * 12 * 10.5 = 1.008
  profit = 0.8% → valid arbitrage

With direction-dependent fees (HISTORICAL):
  C→D: effective = 0.007949
  D→E: effective = 11.863
  E→C: effective = 8.82
  cumulative = 0.007949 × 11.863 × 8.82 = 0.8315
  profit = -16.85% → NOT profitable (fees eat the profit)

IMPORTANT: find_triangular_arbitrage() applies MIN_EDGE_VOLUME=200 filtering.
All tests MUST provide pair_volumes >= 200 for edges that should be considered,
otherwise edges are filtered out and no cycles are detected.
"""

import pytest
import math

from backend.arbitrage.triangular import find_triangular_arbitrage
from backend.models.currency import TriangularOpportunity


# Default volume for test edges — must be >= MIN_EDGE_VOLUME (200)
# so that edges are not filtered out by the volume filter (§6b).
_HIGH_VOLUME = 500


class TestTriangularArbitrageNoFees:
    """Test with zero fees to verify basic cycle detection."""

    def test_simple_profitable_cycle_no_fees(self):
        """
        A→B = 2, B→C = 2, C→A = 2
        cumulative = 2 * 2 * 2 = 8 → 700% profit
        """
        rates = {
            ("A", "B"): 2.0,
            ("B", "C"): 2.0,
            ("C", "A"): 2.0,
        }
        prices = {"A": 1.0, "B": 1.0, "C": 1.0}
        volumes = {
            ("A", "B"): _HIGH_VOLUME,
            ("B", "C"): _HIGH_VOLUME,
            ("C", "A"): _HIGH_VOLUME,
        }

        results = find_triangular_arbitrage(
            rates, prices,
            min_profit_pct=0.1,
            pair_volumes=volumes,
        )

        assert len(results.opportunities) >= 1
        assert results.opportunities[0].net_profit_pct > 100  # very profitable

    def test_no_cycle_no_profit(self):
        """
        A→B = 0.5, B→C = 0.5, C→A = 0.5
        cumulative = 0.5 * 0.5 * 0.5 = 0.125 → not profitable
        """
        rates = {
            ("A", "B"): 0.5,
            ("B", "C"): 0.5,
            ("C", "A"): 0.5,
        }
        prices = {"A": 1.0, "B": 1.0, "C": 1.0}
        volumes = {
            ("A", "B"): _HIGH_VOLUME,
            ("B", "C"): _HIGH_VOLUME,
            ("C", "A"): _HIGH_VOLUME,
        }

        results = find_triangular_arbitrage(
            rates, prices,
            min_profit_pct=0.1,
            pair_volumes=volumes,
        )

        assert len(results.opportunities) == 0

    def test_marginal_profitable_cycle(self):
        """
        A→B = 1.1, B→C = 1.0, C→A = 1.0
        cumulative = 1.1 * 1.0 * 1.0 = 1.1 → 10% profit
        """
        rates = {
            ("A", "B"): 1.1,
            ("B", "C"): 1.0,
            ("C", "A"): 1.0,
        }
        prices = {"A": 1.0, "B": 1.0, "C": 1.0}
        volumes = {
            ("A", "B"): _HIGH_VOLUME,
            ("B", "C"): _HIGH_VOLUME,
            ("C", "A"): _HIGH_VOLUME,
        }

        results = find_triangular_arbitrage(
            rates, prices,
            min_profit_pct=0.1,
            pair_volumes=volumes,
        )

        assert len(results.opportunities) >= 1
        assert results.opportunities[0].net_profit_pct > 0


class TestTriangularArbitrageCanonical:
    """Test with data inspired by §8 Verification, adjusted for the spread model.

    The original §8 canonical data (0.8% profit) is too small to overcome the
    spread model applied in find_triangular_arbitrage() — the spread costs ~2-3%
    across a 3-edge cycle. We use higher-margin rates while keeping the same
    currency structure (chaos/divine/exalted) to preserve the test's intent.
    """

    def _get_canonical_test_data(self):
        """Set up test data with profitable rates that survive the spread model.

        With these rates:
          chaos→divine = 0.01, divine→exalted = 12.0, exalted→chaos = 10.5
          cumulative = 0.01 * 12.0 * 10.5 = 1.26 → 26% raw profit

        After spread (~2.8% per edge at volume 500):
          effective cumulative ≈ 1.26 * 0.986^3 ≈ 1.21 → still profitable
        """
        rates = {
            ("chaos", "divine"): 0.01,
            ("divine", "exalted"): 12.0,
            ("exalted", "chaos"): 10.5,
        }
        prices = {"chaos": 1.0, "divine": 100.0, "exalted": 10.5}
        volumes = {
            ("chaos", "divine"): _HIGH_VOLUME,
            ("divine", "exalted"): _HIGH_VOLUME,
            ("exalted", "chaos"): _HIGH_VOLUME,
        }
        return rates, prices, volumes

    def test_no_fee_profitable(self):
        """Without fees, the cycle is profitable after spread deduction."""
        rates, prices, volumes = self._get_canonical_test_data()

        results = find_triangular_arbitrage(
            rates, prices,
            min_profit_pct=0.1,
            pair_volumes=volumes,
        )

        assert len(results.opportunities) >= 1
        # Raw profit: 0.01 * 12 * 10.5 = 1.26 → 26%
        assert results.opportunities[0].net_profit_pct > 0

    def test_empty_rates_returns_empty(self):
        """No rates should return no opportunities."""
        results = find_triangular_arbitrage(
            {}, {},
        )
        assert len(results.opportunities) == 0

    def test_two_currencies_no_cycle(self):
        """Two currencies with reciprocal rates cannot form a cycle."""
        rates = {
            ("A", "B"): 2.0,
            ("B", "A"): 0.5,
        }
        prices = {"A": 1.0, "B": 2.0}
        volumes = {
            ("A", "B"): _HIGH_VOLUME,
            ("B", "A"): _HIGH_VOLUME,
        }

        results = find_triangular_arbitrage(
            rates, prices,
            min_profit_pct=0.1,
            pair_volumes=volumes,
        )

        assert len(results.opportunities) == 0


class TestProductionDefaultThreshold:
    """Verify detection works with the production default min_profit_pct=1.0."""

    def test_with_production_default_threshold(self):
        """Verify detection works with the production default min_profit_pct=1.0.

        Uses rates designed so that:
        1. Raw profit > 1% (passes min_profit_pct filter)
        2. Cross-rate divergence < 5% (avoids suspicious triple filtering)
        3. Effective rates (after spread) still create a negative cycle in Bellman-Ford

        With A→B = B→C = C→A = 1.015:
          cumulative = 1.015^3 ≈ 1.0457 → 4.57% raw profit
          Cross-rate divergence ≈ 4.57% < 5% threshold
        """
        rates = {
            ("A", "B"): 1.015, ("B", "A"): 1 / 1.015,
            ("B", "C"): 1.015, ("C", "B"): 1 / 1.015,
            ("C", "A"): 1.015, ("A", "C"): 1 / 1.015,
        }
        prices = {"A": 1.0, "B": 1.015, "C": 1.030}
        # Provide volumes so edges pass the MIN_EDGE_VOLUME=200 filter
        volumes = {
            ("A", "B"): _HIGH_VOLUME, ("B", "A"): _HIGH_VOLUME,
            ("B", "C"): _HIGH_VOLUME, ("C", "B"): _HIGH_VOLUME,
            ("C", "A"): _HIGH_VOLUME, ("A", "C"): _HIGH_VOLUME,
        }
        result = find_triangular_arbitrage(
            rates,
            prices,
            min_profit_pct=1.0,  # production default
            pair_volumes=volumes,
        )
        # Should find the profitable cycle
        assert len(result.opportunities) >= 1
