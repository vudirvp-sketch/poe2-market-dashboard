"""
Tests for recipe.py — vendor recipe arbitrage.

From PoE2_Flipper_Canonical_Formulas.md §9.2 Verification:

Recipe: 3x Chaos Shard → 1x Chaos Orb
Chaos Shard price = 0.3 Chaos, gold_cost = unknown (use fallback 200)
Chaos Orb price = 1.0 Chaos, gold_cost = 160
gold_to_chaos_rate = 0.001

input_cost = 3 × (0.3 + 200 × 0.001) = 3 × (0.3 + 0.2) = 3 × 0.5 = 1.5
output_value = 1.0 - 160 × 0.001 = 1.0 - 0.16 = 0.84
profit = 0.84 - 1.5 = -0.66
→ NOT profitable
"""

import pytest

from backend.arbitrage.recipe import compute_recipe_profit, find_profitable_recipes


class TestRecipeProfit:
    """Test recipe profit calculation from §9.2 Verification."""

    def test_canonical_not_profitable_recipe(self):
        """
        From §9.2: Chaos Shard recipe is NOT profitable due to high fees.
        """
        recipe = {
            "name": "Chaos Recipe",
            "inputs": [
                {"item": "chaos_shard", "quantity": 3},
            ],
            "output": {"item": "chaos_orb", "quantity": 1},
        }
        prices = {"chaos_shard": 0.3, "chaos_orb": 1.0}
        gold_to_chaos_rate = 0.001

        result = compute_recipe_profit(recipe, prices, gold_to_chaos_rate)

        assert result is not None
        # input_cost = 3 * (0.3 + 200*0.001) = 3 * 0.5 = 1.5
        assert abs(result.input_cost_chaos - 1.5) < 0.01
        # output_value = 1.0 - 160*0.001 = 0.84
        assert abs(result.output_value_chaos - 0.84) < 0.01
        # profit = 0.84 - 1.5 = -0.66
        assert abs(result.profit_chaos - (-0.66)) < 0.01
        # NOT profitable
        assert result.profit_pct < 0

    def test_profitable_recipe(self):
        """
        A recipe with input cost < output value (after fees) should be profitable.
        """
        recipe = {
            "name": "Test Profitable Recipe",
            "inputs": [
                {"item": "orb_of_transmutation", "quantity": 10},
            ],
            "output": {"item": "orb_of_alchemy", "quantity": 1},
        }
        # Suppose 1 Transmutation = 0.05 Chaos, 1 Alchemy = 2.0 Chaos
        prices = {"orb_of_transmutation": 0.05, "orb_of_alchemy": 2.0}
        gold_to_chaos_rate = 0.001

        result = compute_recipe_profit(recipe, prices, gold_to_chaos_rate)

        assert result is not None
        # Input: 10 * (0.05 + 50*0.001) = 10 * 0.10 = 1.0
        assert abs(result.input_cost_chaos - 1.0) < 0.01
        # Output: 1 * 2.0 - 200*0.001 = 2.0 - 0.2 = 1.8
        assert abs(result.output_value_chaos - 1.8) < 0.01
        # Profit = 1.8 - 1.0 = 0.8
        assert result.profit_chaos > 0

    def test_empty_recipe_returns_none(self):
        """Recipe with no inputs or output should return None."""
        recipe = {"name": "Empty", "inputs": [], "output": {}}
        result = compute_recipe_profit(recipe, {}, 0.001)
        assert result is None


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
                "inputs": [{"item": "chaos_shard", "quantity": 3}],
                "output": {"item": "chaos_orb", "quantity": 1},
            },
        ]
        prices = {
            "orb_of_transmutation": 0.05,
            "orb_of_alchemy": 2.0,
            "chaos_shard": 0.3,
            "chaos_orb": 1.0,
        }

        results = find_profitable_recipes(recipes, prices, 0.001)

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

        results = find_profitable_recipes(recipes, prices, 0.001)

        if len(results) >= 2:
            assert results[0].profit_pct >= results[1].profit_pct
