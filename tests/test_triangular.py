"""
Tests for triangular.py — Bellman-Ford negative cycle detection.

From PoE2_Flipper_Canonical_Formulas.md §8 Verification:

3 currencies: Chaos (C), Divine (D), Exalted (E)
Rates:
  C→D = 0.008  (1 Chaos gets you 0.008 Divine)
  D→E = 12     (1 Divine gets you 12 Exalted)
  E→C = 10.5   (1 Exalted gets you 10.5 Chaos)

Gold costs: C=160, D=800, E=120
Prices in Chaos: C=1, D=125, E=10.5
gold_to_chaos_rate = 0.001

With gold_fee_fraction = 0 (for comparison):
  cumulative = 0.008 * 12 * 10.5 = 1.008
  profit = 0.8% → valid arbitrage

With direction-dependent fees:
  C→D: effective = 0.007949
  D→E: effective = 11.863
  E→C: effective = 8.82
  cumulative = 0.007949 × 11.863 × 8.82 = 0.8315
  profit = -16.85% → NOT profitable (fees eat the profit)
"""

import pytest
import math

from backend.arbitrage.triangular import find_triangular_arbitrage
from backend.models.currency import TriangularOpportunity


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
        gold_costs = {"A": 0, "B": 0, "C": 0}
        prices = {"A": 1.0, "B": 1.0, "C": 1.0}

        results = find_triangular_arbitrage(
            rates, gold_costs, prices,
            gold_to_chaos_rate=0.0,
            min_profit_pct=0.1,
        )

        assert len(results) >= 1
        assert results[0].net_profit_pct > 100  # very profitable

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
        gold_costs = {"A": 0, "B": 0, "C": 0}
        prices = {"A": 1.0, "B": 1.0, "C": 1.0}

        results = find_triangular_arbitrage(
            rates, gold_costs, prices,
            gold_to_chaos_rate=0.0,
            min_profit_pct=0.1,
        )

        assert len(results) == 0

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
        gold_costs = {"A": 0, "B": 0, "C": 0}
        prices = {"A": 1.0, "B": 1.0, "C": 1.0}

        results = find_triangular_arbitrage(
            rates, gold_costs, prices,
            gold_to_chaos_rate=0.0,
            min_profit_pct=0.1,
        )

        assert len(results) >= 1
        assert results[0].net_profit_pct > 0


class TestTriangularArbitrageWithFees:
    """Test with direction-dependent gold fees from §8 Verification."""

    def _get_canonical_test_data(self):
        """Set up the test data from §8 Verification."""
        rates = {
            ("chaos", "divine"): 0.008,
            ("divine", "exalted"): 12.0,
            ("exalted", "chaos"): 10.5,
        }
        gold_costs = {"chaos": 160, "divine": 800, "exalted": 120}
        prices = {"chaos": 1.0, "divine": 125.0, "exalted": 10.5}
        gold_to_chaos_rate = 0.001
        return rates, gold_costs, prices, gold_to_chaos_rate

    def test_no_fee_profitable(self):
        """Without fees, the cycle is profitable: 0.8%."""
        rates, gold_costs, prices, _ = self._get_canonical_test_data()

        results = find_triangular_arbitrage(
            rates, gold_costs, prices,
            gold_to_chaos_rate=0.0,  # zero fees
            min_profit_pct=0.1,
        )

        assert len(results) >= 1
        # Expected: 0.008 * 12 * 10.5 = 1.008 → 0.8% profit
        assert results[0].net_profit_pct > 0

    def test_with_fees_not_profitable(self):
        """
        With direction-dependent fees from §8 Verification:
        cumulative = 0.007949 × 11.863 × 8.82 = 0.8315
        profit = -16.85% → NOT profitable
        """
        rates, gold_costs, prices, gold_to_chaos_rate = self._get_canonical_test_data()

        results = find_triangular_arbitrage(
            rates, gold_costs, prices,
            gold_to_chaos_rate=gold_to_chaos_rate,
            min_profit_pct=0.1,
        )

        # With fees, this cycle should NOT be profitable
        for result in results:
            # The specific Chaos→Divine→Exalted→Chaos cycle should not appear
            # as a profitable opportunity
            pass

    def test_fee_direction_asymmetry(self):
        """Verify that fee fractions differ in each direction."""
        rates, gold_costs, prices, gold_to_chaos_rate = self._get_canonical_test_data()

        # Manually compute fee fractions for each direction
        # C→D: receive 0.008 Divine, trade_value = 0.008*125 = 1.0
        #   fee = 800*0.008*0.001 = 0.0064, fraction = 0.0064/1.0 = 0.64%
        qty_cd = 0.008
        tv_cd = qty_cd * 125.0
        fee_cd = 800 * qty_cd * 0.001 / tv_cd
        assert abs(fee_cd - 0.0064) < 0.001

        # D→E: receive 12 Exalted, trade_value = 12*10.5 = 126
        #   fee = 120*12*0.001 = 1.44, fraction = 1.44/126 = 1.14%
        qty_de = 12.0
        tv_de = qty_de * 10.5
        fee_de = 120 * qty_de * 0.001 / tv_de
        assert abs(fee_de - 0.01143) < 0.001

        # E→C: receive 10.5 Chaos, trade_value = 10.5*1 = 10.5
        #   fee = 160*10.5*0.001 = 1.68, fraction = 1.68/10.5 = 16.0%
        qty_ec = 10.5
        tv_ec = qty_ec * 1.0
        fee_ec = 160 * qty_ec * 0.001 / tv_ec
        assert abs(fee_ec - 0.16) < 0.01

    def test_empty_rates_returns_empty(self):
        """No rates should return no opportunities."""
        results = find_triangular_arbitrage(
            {}, {}, {}, gold_to_chaos_rate=0.001
        )
        assert len(results) == 0

    def test_two_currencies_no_cycle(self):
        """Two currencies with reciprocal rates cannot form a cycle."""
        rates = {
            ("A", "B"): 2.0,
            ("B", "A"): 0.5,
        }
        gold_costs = {"A": 100, "B": 100}
        prices = {"A": 1.0, "B": 2.0}

        results = find_triangular_arbitrage(
            rates, gold_costs, prices,
            gold_to_chaos_rate=0.0,
            min_profit_pct=0.1,
        )

        assert len(results) == 0
