"""
Verified per-unit gold cost table for PoE2 Currency Exchange.

⚠️ DEPRECATED — This module supports the deprecated gold_costs.py.
See gold_costs.py docstring for details on why gold fees are excluded
from all business logic. This table is kept for potential future use.

---

Source: poe2wiki.net — Currency Exchange Market
(last verified 2025-12-26, patch 0.3.0)

Each entry maps a canonical snake_case api_id to the gold cost per unit.
The POE2Scout API uses `api_id` fields (e.g., "exalted", "divine", "chaos").
A normalization layer maps between the two.

IMPORTANT: This table MUST be kept in sync with the game.
When new currency items are added or gold costs change in a patch,
update this table accordingly.

For items NOT in this table, use config.fees.unknown_item_gold_cost (default: 200).
"""

from __future__ import annotations

import logging
from typing import Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Verified per-unit gold costs (PoE2, patch 0.3.0)
# Source: https://www.poe2wiki.net/wiki/Currency_exchange_market
# ---------------------------------------------------------------------------

GOLD_COST_PER_UNIT: dict[str, int] = {
    # Basic currencies
    "scroll_of_wisdom": 1,
    "transmutation_shard": 4,
    "orb_of_transmutation": 50,
    "regal_shard": 12,
    "regal_orb": 120,
    "exalted_orb": 120,
    "chaos_orb": 160,
    "vaal_orb": 160,
    "orb_of_augmentation": 200,
    "orb_of_alchemy": 200,
    "lesser_jewellers_orb": 200,

    # Mid-tier currencies
    "greater_jewellers_orb": 600,
    "divine_orb": 800,
    "armourers_scrap": 250,
    "blacksmiths_whetstone": 500,
    "arcanists_etcher": 500,
    "glassblowers_bauble": 750,

    # High-tier currencies
    "orb_of_chance": 1000,
    "orb_of_annulment": 1000,
    "artificers_orb": 1000,
    "perfect_jewellers_orb": 1000,
    "gemcutters_prism": 1000,
    "mirror_of_kalandra": 25000,
}

# ---------------------------------------------------------------------------
# API ID mapping: POE2Scout api_id → canonical snake_case key
# ---------------------------------------------------------------------------

API_ID_TO_CANONICAL: dict[str, str] = {
    # Direct mappings from POE2Scout api_ids to our canonical keys
    "exalted": "exalted_orb",
    "divine": "divine_orb",
    "chaos": "chaos_orb",
    "vaal": "vaal_orb",
    "alch": "orb_of_alchemy",
    "alchemy": "orb_of_alchemy",
    "transmute": "orb_of_transmutation",
    "transmutation": "orb_of_transmutation",
    "aug": "orb_of_augmentation",
    "augmentation": "orb_of_augmentation",
    "chance": "orb_of_chance",
    "annul": "orb_of_annulment",
    "annulment": "orb_of_annulment",
    "regal": "regal_orb",
    "gcp": "gemcutters_prism",
    "mirror": "mirror_of_kalandra",
    "wisdom": "scroll_of_wisdom",
    "armourer": "armourers_scrap",
    "armourers": "armourers_scrap",
    "whetstone": "blacksmiths_whetstone",
    "blacksmiths": "blacksmiths_whetstone",
    "glassblowers": "glassblowers_bauble",
    "bauble": "glassblowers_bauble",
    "lesser_jewellers": "lesser_jewellers_orb",
    "greater_jewellers": "greater_jewellers_orb",
    "perfect_jewellers": "perfect_jewellers_orb",
    "artificers": "artificers_orb",
    "arcanists": "arcanists_etcher",
    "etcher": "arcanists_etcher",
    "transmutation_shard": "transmutation_shard",
    "regal_shard": "regal_shard",
}


def normalize_api_id(api_id: str) -> str:
    """Normalize an API ID for gold cost table lookup.

    1. Lowercase
    2. Replace spaces/hyphens with underscores
    3. Remove apostrophes
    4. Check direct API_ID_TO_CANONICAL mapping
    5. Check GOLD_COST_PER_UNIT directly
    """
    normalized = api_id.lower().replace(" ", "_").replace("-", "_").replace("'", "")

    # Check explicit mapping first
    if normalized in API_ID_TO_CANONICAL:
        return API_ID_TO_CANONICAL[normalized]

    # Check if it's already a canonical key
    if normalized in GOLD_COST_PER_UNIT:
        return normalized

    # Try removing "orb_of_" prefix or other common patterns
    # e.g. "exalted_orb" might come as "exalted"
    for suffix in ["_orb", "_shard", "_scrap", "_bauble", "_prism"]:
        candidate = normalized + suffix
        if candidate in GOLD_COST_PER_UNIT:
            return candidate

    return normalized  # return as-is; will be looked up with fallback


def get_gold_cost_per_unit(api_id: str, fallback: int = 200) -> int:
    """Get the per-unit gold cost for a currency.

    Args:
        api_id: The currency's API ID (e.g., "divine", "chaos")
        fallback: Default cost for unknown currencies (from config)

    Returns:
        Gold cost per unit, or fallback if not found.
    """
    canonical = normalize_api_id(api_id)

    if canonical in GOLD_COST_PER_UNIT:
        return GOLD_COST_PER_UNIT[canonical]

    logger.warning(
        "Unknown currency api_id '%s' (normalized: '%s'). "
        "Using fallback gold cost: %d. "
        "Add this currency to gold_cost_table.py if the actual cost is known.",
        api_id, canonical, fallback,
    )
    return fallback


def get_all_gold_costs() -> dict[str, int]:
    """Return the complete gold cost table (canonical keys)."""
    return dict(GOLD_COST_PER_UNIT)


def get_api_id_to_gold_cost() -> dict[str, int]:
    """Return a mapping from common API IDs to gold costs.

    Includes both the canonical keys and the API_ID_TO_CANONICAL aliases.
    """
    result: dict[str, int] = {}
    # Add canonical keys
    for key, cost in GOLD_COST_PER_UNIT.items():
        result[key] = cost
    # Add aliases
    for alias, canonical in API_ID_TO_CANONICAL.items():
        if canonical in GOLD_COST_PER_UNIT:
            result[alias] = GOLD_COST_PER_UNIT[canonical]
    return result
