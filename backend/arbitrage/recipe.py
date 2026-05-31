"""
Recipe Arbitrage — vendor recipe profit calculation.

Simplified: gold/commission fees are EXCLUDED from all calculations.

Formula (simplified — gold fees excluded):
    input_cost = sum(price(I_i) * quantity(I_i) for i in 1..k)
    output_value = price(O) * quantity(O)
    profit = output_value - input_cost
    profit_pct = profit / input_cost * 100
"""

from __future__ import annotations

import logging
from typing import Optional

from backend.models.currency import RecipeOpportunity

logger = logging.getLogger(__name__)


def compute_recipe_profit(
    recipe: dict,
    prices: dict[str, float],
) -> RecipeOpportunity | None:
    """Compute the profitability of a vendor recipe.

    Simplified: gold/commission fees are EXCLUDED.
    Only raw market prices are used for input cost and output value.

    Args:
        recipe: Recipe definition from config.yaml
        prices: Dict mapping currency api_id to price in Chaos Orbs

    Returns:
        RecipeOpportunity if profitable, None otherwise
    """
    inputs = recipe.get("inputs", [])
    output = recipe.get("output", {})
    name = recipe.get("name", "Unnamed Recipe")

    if not inputs or not output:
        logger.warning("Recipe '%s' has no inputs or output", name)
        return None

    # Input cost = sum of price * quantity (no gold fee)
    input_cost = 0.0
    for inp in inputs:
        item = inp.get("item", "")
        qty = inp.get("quantity", 1)
        price = prices.get(item, 0.0)
        input_cost += price * qty

    # Output value = price * quantity (no gold fee)
    output_item = output.get("item", "")
    output_qty = output.get("quantity", 1)
    output_price = prices.get(output_item, 0.0)
    output_value = output_price * output_qty

    # Profit calculation
    profit = output_value - input_cost
    profit_pct = (profit / input_cost * 100) if input_cost > 0 else 0.0

    return RecipeOpportunity(
        name=name,
        inputs=inputs,
        output=output,
        input_cost_chaos=input_cost,
        output_value_chaos=output_value,
        profit_chaos=profit,
        profit_pct=profit_pct,
    )


def find_profitable_recipes(
    recipes: list[dict],
    prices: dict[str, float],
    min_profit_pct: float = 0.0,
) -> list[RecipeOpportunity]:
    """Find all profitable vendor recipes.

    Args:
        recipes: List of recipe definitions from config.yaml
        prices: Dict mapping currency api_id to price in Chaos Orbs
        min_profit_pct: Minimum profit percentage to report

    Returns:
        List of profitable RecipeOpportunity objects
    """
    profitable = []

    for recipe in recipes:
        result = compute_recipe_profit(recipe, prices)
        if result is not None and result.profit_pct > min_profit_pct:
            profitable.append(result)

    # Sort by profit percentage (descending)
    profitable.sort(key=lambda r: r.profit_pct, reverse=True)
    return profitable
