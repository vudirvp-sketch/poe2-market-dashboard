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

Simplified: gold/commission fees are EXCLUDED from all calculations.
Only raw market prices are used for input cost and output value.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query

from backend.config import get_settings
from backend.api.data_snapshot import get_snapshot

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
    routes). Gold/commission fees are EXCLUDED from all calculations.

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

        # Also add by original-case api_id using DataSnapshot.get_currency()
        for api_id_lower in list(snapshot.current_prices.keys()):
            curr = snapshot.get_currency(api_id_lower)
            if curr:
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

            # Calculate input cost (no gold fee)
            input_cost_chaos = 0.0
            missing_prices = False

            for inp in inputs:
                item = inp.get("item", "")
                quantity = inp.get("quantity", 1)
                price = price_lookup.get(item, 0)
                if price <= 0:
                    missing_prices = True
                    break
                input_cost_chaos += price * quantity

            if missing_prices:
                all_results.append({
                    "name": name,
                    "status": "missing_prices",
                    "notes": notes,
                })
                continue

            # Calculate output value (no gold fee)
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

            # Profit calculation (simplified: gold fees excluded)
            profit_chaos = output_value_chaos - input_cost_chaos
            profit_pct = (profit_chaos / input_cost_chaos * 100) if input_cost_chaos > 0 else 0

            result = {
                "name": name,
                "input_cost_chaos": round(input_cost_chaos, 4),
                "output_value_chaos": round(output_value_chaos, 4),
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
