"""
API routes for vendor recipe arbitrage.

Phase 2 (Spec Section 8): Exposes the already-implemented RecipeArb
via REST endpoints with default PoE2 vendor recipes from config.

Endpoints:
    GET /api/recipes — check all defined recipes for profitability
    GET /api/recipes/definitions — return all defined recipes

OPTIMIZATION: Uses DataSnapshot instead of calling
get_all_currencies_with_prices() directly. This avoids 15+ redundant
ByCategory API requests on every call — the snapshot shares the same
coordinated data pass as all other routes.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query

from backend.config import get_settings
from backend.api.data_snapshot import get_snapshot
from backend.economy.gold_costs import compute_gold_fee
from backend.economy.gold_cost_table import get_gold_cost_per_unit

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/recipes", tags=["recipes"])


@router.get("/definitions")
async def get_recipe_definitions():
    """Return all defined recipes from config."""
    config = get_settings()
    recipes = config.vendor_recipes or []
    return {
        "recipes": recipes,
        "count": len(recipes),
    }


@router.get("")
async def get_profitable_recipes(
    include_unverified: bool = Query(default=False, description="Include UNVERIFIED recipes"),
):
    """Check all defined recipes for profitability.

    Uses current market prices from DataSnapshot (shared with all other
    routes) and direction-dependent gold fee calculations per
    PoE2_Flipper_Canonical_Formulas.md Section 9.

    Args:
        include_unverified: If True, include recipes marked as UNVERIFIED.
    """
    config = get_settings()
    recipes = config.vendor_recipes or []

    if not recipes:
        return {"profitable_recipes": [], "all_recipes": [], "count": 0, "data_available": False}

    try:
        # Use DataSnapshot instead of calling get_all_currencies_with_prices()
        # directly — avoids 15+ redundant ByCategory API requests.
        snapshot = await get_snapshot()

        # Build price lookup from snapshot's current_prices + prices_in_base
        # current_prices: api_id (lowercase) -> current_price in base currency
        # We need lookup by original-case api_id too, so build both.
        price_lookup: dict[str, float] = {}
        for api_id_lower, cp in snapshot.current_prices.items():
            if cp > 0:
                price_lookup[api_id_lower] = cp

        # Also add by original-case api_id from currencies dict
        for api_id_lower, curr in snapshot.currencies.items():
            orig_id = curr.get("api_id", "")
            if orig_id and orig_id != api_id_lower and api_id_lower in price_lookup:
                price_lookup[orig_id] = price_lookup[api_id_lower]

        # Fall back to prices_in_base for currencies not in current_prices
        for api_id, price in snapshot.prices_in_base.items():
            if api_id not in price_lookup and price > 0:
                price_lookup[api_id] = price
            api_id_lower = api_id.lower()
            if api_id_lower not in price_lookup and price > 0:
                price_lookup[api_id_lower] = price

        gold_to_chaos_rate = config.fees.fixed_gold_to_chaos_rate or 0.001
        gold_cost_dict = {k: v for k, v in [  # Use the gold cost table
            (api_id, get_gold_cost_per_unit(api_id))
            for api_id in price_lookup.keys()
        ] if v > 0}

        profitable = []
        all_results = []

        for recipe in recipes:
            name = recipe.get("name", "Unknown")
            inputs = recipe.get("inputs", [])
            output = recipe.get("output", {})
            notes = recipe.get("notes", "")

            # Skip unverified recipes unless requested
            if "UNVERIFIED" in notes.upper() and not include_unverified:
                continue

            # Calculate input cost
            input_cost_chaos = 0.0
            gold_fee_total = 0.0
            missing_prices = False

            for inp in inputs:
                item = inp.get("item", "")
                quantity = inp.get("quantity", 1)
                price = price_lookup.get(item, 0)
                if price <= 0:
                    missing_prices = True
                    break
                input_cost_chaos += price * quantity
                # Gold fee for buying input
                gold_cost = get_gold_cost_per_unit(item)
                gold_fee_total += gold_cost * quantity

            if missing_prices:
                all_results.append({
                    "name": name,
                    "status": "missing_prices",
                    "notes": notes,
                })
                continue

            # Calculate output value
            output_item = output.get("item", "")
            output_quantity = output.get("quantity", 1)
            output_price = price_lookup.get(output_item, 0)
            if output_price <= 0:
                all_results.append({
                    "name": name,
                    "status": "missing_output_price",
                    "notes": notes,
                })
                continue

            output_value_chaos = output_price * output_quantity
            # Gold fee for selling/receiving output
            output_gold_cost = get_gold_cost_per_unit(output_item)
            gold_fee_total += output_gold_cost * output_quantity

            # Profit calculation (Canonical Formulas Section 9)
            gold_fee_chaos = gold_fee_total * gold_to_chaos_rate
            net_input = input_cost_chaos + gold_fee_chaos  # cost + buying fees
            # Output value minus selling fee
            selling_fee_chaos = output_gold_cost * output_quantity * gold_to_chaos_rate
            net_output = output_value_chaos - selling_fee_chaos

            profit_chaos = net_output - net_input
            profit_pct = (profit_chaos / net_input * 100) if net_input > 0 else 0

            result = {
                "name": name,
                "input_cost_chaos": round(input_cost_chaos, 4),
                "output_value_chaos": round(output_value_chaos, 4),
                "gold_fee_total": gold_fee_total,
                "gold_fee_chaos": round(gold_fee_chaos, 4),
                "profit_chaos": round(profit_chaos, 4),
                "profit_pct": round(profit_pct, 2),
                "is_profitable": profit_chaos > 0,
                "notes": notes,
            }

            all_results.append(result)
            if profit_chaos > 0:
                profitable.append(result)

        return {
            "profitable_recipes": profitable,
            "all_recipes": all_results,
            "count": len(profitable),
            "data_available": True,
        }
    except Exception as e:
        logger.error("Recipe profitability check failed: %s", e)
        return {"profitable_recipes": [], "all_recipes": [], "count": 0, "data_available": False}
