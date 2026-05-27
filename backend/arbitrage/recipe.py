"""
Recipe Arbitrage — vendor recipe profit calculation.

From PoE2_Flipper_Canonical_Formulas.md §9:

Pure arithmetic. For each known vendor recipe:
1. Sum the cost of input items (in chaos equivalent, including gold fees for purchasing)
2. Compare to the market price of the output item (minus gold fee for selling)
3. If output_value_after_fee > input_cost_after_fees, profit exists.

Formula (§9.1):
    input_cost = sum(
        price(I_i) * quantity(I_i)
        + gold_cost_per_unit[I_i] * quantity(I_i) * gold_to_chaos_rate
        for i in 1..k
    )
    output_value = price(O) * quantity(O) - gold_cost_per_unit[O] * quantity(O) * gold_to_chaos_rate
    profit = output_value - input_cost
    profit_pct = profit / input_cost * 100
"""

from __future__ import annotations

import logging
from typing import Optional

from backend.economy.gold_cost_table import get_gold_cost_per_unit
from backend.models.currency import RecipeOpportunity

logger = logging.getLogger(__name__)


def compute_recipe_profit(
    recipe: dict,
    prices: dict[str, float],
    gold_to_chaos_rate: float,
    fallback_gold_cost: int = 200,
) -> RecipeOpportunity | None:
    """Compute the profitability of a vendor recipe.

    Args:
        recipe: Recipe definition from config.yaml, e.g.:
            {
                "name": "Chaos Recipe",
                "inputs": [{"item": "chaos_shard", "quantity": 3}],
                "output": {"item": "chaos_orb", "quantity": 1}
            }
        prices: Dict mapping currency api_id to price in Chaos Orbs
        gold_to_chaos_rate: How many Chaos Orbs per 1 gold coin
        fallback_gold_cost: Default per-unit gold cost for unknown currencies

    Returns:
        RecipeOpportunity if profitable, None otherwise
    """
    inputs = recipe.get("inputs", [])
    output = recipe.get("output", {})
    name = recipe.get("name", "Unnamed Recipe")

    if not inputs or not output:
        logger.warning("Recipe '%s' has no inputs or output", name)
        return None

    # §9.1: Input cost = sum of (price + fee) for each input
    input_cost = 0.0
    for inp in inputs:
        item = inp.get("item", "")
        qty = inp.get("quantity", 1)
        price = prices.get(item, 0.0)
        gold_cost = get_gold_cost_per_unit(item, fallback=fallback_gold_cost)
        fee_chaos = gold_cost * qty * gold_to_chaos_rate
        input_cost += price * qty + fee_chaos

    # §9.1: Output value = price - fee for selling
    output_item = output.get("item", "")
    output_qty = output.get("quantity", 1)
    output_price = prices.get(output_item, 0.0)
    output_gold_cost = get_gold_cost_per_unit(output_item, fallback=fallback_gold_cost)
    output_fee_chaos = output_gold_cost * output_qty * gold_to_chaos_rate
    output_value = output_price * output_qty - output_fee_chaos

    # §9.1: Profit calculation
    profit = output_value - input_cost
    profit_pct = (profit / input_cost * 100) if input_cost > 0 else 0.0

    total_gold_fee = 0.0
    for inp in inputs:
        item = inp.get("item", "")
        qty = inp.get("quantity", 1)
        gold_cost = get_gold_cost_per_unit(item, fallback=fallback_gold_cost)
        total_gold_fee += gold_cost * qty
    total_gold_fee += output_gold_cost * output_qty

    return RecipeOpportunity(
        name=name,
        inputs=inputs,
        output=output,
        input_cost_chaos=input_cost,
        output_value_chaos=output_value,
        profit_chaos=profit,
        profit_pct=profit_pct,
        gold_fee_total=total_gold_fee,
    )


def find_profitable_recipes(
    recipes: list[dict],
    prices: dict[str, float],
    gold_to_chaos_rate: float,
    fallback_gold_cost: int = 200,
    min_profit_pct: float = 0.0,
) -> list[RecipeOpportunity]:
    """Find all profitable vendor recipes.

    Args:
        recipes: List of recipe definitions from config.yaml
        prices: Dict mapping currency api_id to price in Chaos Orbs
        gold_to_chaos_rate: Chaos value per gold coin
        fallback_gold_cost: Default per-unit gold cost
        min_profit_pct: Minimum profit percentage to report

    Returns:
        List of profitable RecipeOpportunity objects
    """
    profitable = []

    for recipe in recipes:
        result = compute_recipe_profit(
            recipe, prices, gold_to_chaos_rate, fallback_gold_cost
        )
        if result is not None and result.profit_pct > min_profit_pct:
            profitable.append(result)

    # Sort by profit percentage (descending)
    profitable.sort(key=lambda r: r.profit_pct, reverse=True)
    return profitable
