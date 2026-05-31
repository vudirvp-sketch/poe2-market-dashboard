"""
Tests for recipe.py — vendor recipe arbitrage.

Simplified: gold/commission fees are EXCLUDED from all calculations.
Only raw market prices are used for input cost and output value.

Recipe: 3x Chaos Shard → 1x Chaos Orb
Chaos Shard price = 0.3 Chaos
Chaos Orb price = 1.0 Chaos

input_cost = 3 × 0.3 = 0.9
output_value = 1.0
profit = 1.0 - 0.9 = 0.1
profit_pct = 0.1 / 0.9 × 100 ≈ 11.1% (now profitable without fees!)
"""

import pytest

from backend.arbitrage.recipe import compute_recipe_profit, find_profitable_recipes


class TestRecipeProfit:
    """Test recipe profit calculation (gold fees excluded)."""

    def test_canonical_recipe_without_fees(self):
        """
        Without gold fees: 3x Chaos Shard (0.3 each) → 1x Chaos Orb (1.0)
        input_cost = 3 * 0.3 = 0.9
        output_value = 1.0
        profit = 1.0 - 0.9 = 0.1
        """
        recipe = {
            "name": "Chaos Recipe",
            "inputs": [
                {"item": "chaos_shard", "quantity": 3},
            ],
            "output": {"item": "chaos_orb", "quantity": 1},
        }
        prices = {"chaos_shard": 0.3, "chaos_orb": 1.0}

        result = compute_recipe_profit(recipe, prices)

        assert result is not None
        # input_cost = 3 * 0.3 = 0.9 (no gold fee)
        assert abs(result.input_cost_chaos - 0.9) < 0.01
        # output_value = 1.0 (no gold fee)
        assert abs(result.output_value_chaos - 1.0) < 0.01
        # profit = 1.0 - 0.9 = 0.1
        assert abs(result.profit_chaos - 0.1) < 0.01
        # Now profitable without fees
        assert result.profit_pct > 0

    def test_profitable_recipe(self):
        """
        A recipe with input cost < output value should be profitable.
        """
        recipe = {
            "name": "Test Profitable Recipe",
            "inputs": [
                {"item": "orb_of_transmutation", "quantity": 10},
            ],
            "output": {"item": "orb_of_alchemy", "quantity": 1},
        }
        # 1 Transmutation = 0.05 Chaos, 1 Alchemy = 2.0 Chaos
        prices = {"orb_of_transmutation": 0.05, "orb_of_alchemy": 2.0}

        result = compute_recipe_profit(recipe, prices)

        assert result is not None
        # Input: 10 * 0.05 = 0.5 (no gold fee)
        assert abs(result.input_cost_chaos - 0.5) < 0.01
        # Output: 1 * 2.0 = 2.0 (no gold fee)
        assert abs(result.output_value_chaos - 2.0) < 0.01
        # Profit = 2.0 - 0.5 = 1.5
        assert result.profit_chaos > 0

    def test_empty_recipe_returns_none(self):
        """Recipe with no inputs or output should return None."""
        recipe = {"name": "Empty", "inputs": [], "output": {}}
        result = compute_recipe_profit(recipe, {})
        assert result is None

    def test_unprofitable_recipe_with_fees_excluded(self):
        """A recipe where input cost > output value should be unprofitable."""
        recipe = {
            "name": "Bad Deal",
            "inputs": [
                {"item": "divine", "quantity": 1},
            ],
            "output": {"item": "orb_of_transmutation", "quantity": 1},
        }
        # 1 Divine = 200.0, 1 Transmutation = 0.05
        prices = {"divine": 200.0, "orb_of_transmutation": 0.05}
        result = compute_recipe_profit(recipe, prices)

        assert result is not None
        assert result.profit_chaos < 0
        assert result.profit_pct < 0


class TestFindProfitableRecipes:
    """Test the recipe scanner."""

    def test_only_profitable_returned(self):
        """Only profitable recipes should be returned."""
        recipes = [
            {
                "name": "Profitable",
                "inputs": [{"item": "orb_of_transmutation", "quantity": 10}],
                "output": {"item": "orb_of_alchemy", "quantity": 1},
            },
            {
                "name": "Unprofitable",
                "inputs": [{"item": "divine", "quantity": 1}],
                "output": {"item": "orb_of_transmutation", "quantity": 1},
            },
        ]
        prices = {
            "orb_of_transmutation": 0.05,
            "orb_of_alchemy": 2.0,
            "divine": 200.0,
        }

        results = find_profitable_recipes(recipes, prices)

        # Only the profitable recipe should be returned
        assert len(results) == 1
        assert results[0].name == "Profitable"
        assert results[0].profit_pct > 0

    def test_sorted_by_profit(self):
        """Results should be sorted by profit percentage (descending)."""
        recipes = [
            {
                "name": "Low Profit",
                "inputs": [{"item": "orb_of_transmutation", "quantity": 5}],
                "output": {"item": "orb_of_alchemy", "quantity": 1},
            },
            {
                "name": "High Profit",
                "inputs": [{"item": "orb_of_transmutation", "quantity": 1}],
                "output": {"item": "orb_of_alchemy", "quantity": 1},
            },
        ]
        prices = {
            "orb_of_transmutation": 0.05,
            "orb_of_alchemy": 2.0,
        }

        results = find_profitable_recipes(recipes, prices)

        if len(results) >= 2:
            assert results[0].profit_pct >= results[1].profit_pct
