"""
Gold fee calculation engine for PoE2 Currency Exchange.

Step 3: RE-ENABLED — Gold fee accounting is now active in all scoring,
arbitrage, and flip scanner calculations. Without gold fees, every "profit"
number was fictional — in reality, most "profitable" flips lose money after
gold costs.

CRITICAL: The gold fee in PoE2 is NOT a percentage of trade value.
It is a FIXED PER-UNIT cost in gold coins, where each currency item type
has its own gold cost.

Formula (from PoE2_Flipper_Canonical_Formulas.md §3):
    gold_fee = gold_cost_per_unit[currency_you_RECEIVE] × quantity_you_RECEIVE

Key mechanics:
1. Fee is based ONLY on what you RECEIVE ("I want" side), not what you give.
2. BOTH parties in a trade pay gold fees (each based on what they receive).
3. Converting a high-value currency into many low-value ones is expensive.
4. Converting many low-value currencies into one high-value one is cheap.

For use in arbitrage calculations, the gold fee is converted to a
chaos-equivalent fraction of trade value:
    gold_fee_in_chaos = gold_fee × gold_to_chaos_rate
    gold_fee_fraction = gold_fee_in_chaos / trade_value_in_chaos
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional

from backend.economy.gold_cost_table import get_gold_cost_per_unit, normalize_api_id

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Core fee calculation functions
# ---------------------------------------------------------------------------

def compute_gold_fee(
    currency_received: str,
    quantity_received: float,
    fallback_cost: int = 200,
) -> float:
    """Compute the gold fee for receiving a given quantity of a currency.

    Args:
        currency_received: API ID of the currency you receive (e.g., "divine", "exalted")
        quantity_received: How many units you receive
        fallback_cost: Default per-unit cost for unknown currencies

    Returns:
        Total gold fee in gold coins
    """
    per_unit = get_gold_cost_per_unit(currency_received, fallback=fallback_cost)
    return per_unit * quantity_received


def compute_gold_fee_fraction(
    currency_received: str,
    quantity_received: float,
    gold_to_chaos_rate: float,
    trade_value_in_chaos: float,
    fallback_cost: int = 200,
) -> float:
    """Compute the gold fee as a fraction of trade value in Chaos terms.

    This is the key metric for arbitrage calculations.

    Args:
        currency_received: API ID of the currency you receive
        quantity_received: How many units you receive
        gold_to_chaos_rate: How many Chaos Orbs one gold coin is worth
        trade_value_in_chaos: Total trade value in Chaos Orbs
        fallback_cost: Default per-unit cost for unknown currencies

    Returns:
        Fee as a fraction of trade value (e.g., 0.05 = 5%)

    Raises:
        ValueError: If trade_value_in_chaos <= 0
    """
    if trade_value_in_chaos <= 0:
        raise ValueError(
            f"trade_value_in_chaos must be positive, got {trade_value_in_chaos}"
        )

    gold_fee = compute_gold_fee(currency_received, quantity_received, fallback_cost)
    gold_fee_in_chaos = gold_fee * gold_to_chaos_rate
    return gold_fee_in_chaos / trade_value_in_chaos


def compute_effective_rate(
    raw_rate: float,
    currency_from: str,
    currency_to: str,
    gold_to_chaos_rate: float,
    price_to_in_chaos: float,
    fallback_cost: int = 200,
) -> tuple[float, float]:
    """Compute the effective exchange rate after gold fees for a directed trade.

    For a trade from currency A to currency B (you give A, receive B):
        effective_rate(A→B) = raw_rate(A→B) × (1 - gold_fee_fraction(A→B))

    CRITICAL: The fee fraction is DIRECTION-DEPENDENT.
    effective_rate(A→B) ≠ effective_rate(B→A) even if
    raw_rate(A→B) = 1/raw_rate(B→A), because the gold costs of A and B differ.

    Args:
        raw_rate: How many units of `to` per 1 unit of `from`
        currency_from: API ID of the currency you give
        currency_to: API ID of the currency you receive
        gold_to_chaos_rate: Chaos value of 1 gold coin
        price_to_in_chaos: Price of the received currency in Chaos
        fallback_cost: Default per-unit cost for unknown currencies

    Returns:
        Tuple of (effective_rate, fee_fraction)
    """
    # For 1 unit of `from`, you receive `raw_rate` units of `to`
    quantity_received = raw_rate
    trade_value_in_chaos = quantity_received * price_to_in_chaos

    if trade_value_in_chaos <= 0:
        return 0.0, 0.0

    fee_fraction = compute_gold_fee_fraction(
        currency_to, quantity_received,
        gold_to_chaos_rate, trade_value_in_chaos,
        fallback_cost,
    )

    effective = raw_rate * (1.0 - fee_fraction)
    return effective, fee_fraction


# ---------------------------------------------------------------------------
# Higher-level helpers
# ---------------------------------------------------------------------------

@dataclass
class FeeBreakdown:
    """Detailed breakdown of gold fees for a trade."""
    currency_received: str
    quantity_received: float
    gold_cost_per_unit: int
    gold_fee_total: float          # in gold coins
    gold_to_chaos_rate: float
    gold_fee_in_chaos: float       # fee converted to Chaos
    trade_value_in_chaos: float
    fee_fraction: float            # fee as fraction of trade value
    is_fallback_cost: bool         # True if using fallback per-unit cost


def compute_fee_breakdown(
    currency_received: str,
    quantity_received: float,
    gold_to_chaos_rate: float,
    trade_value_in_chaos: float,
    fallback_cost: int = 200,
) -> FeeBreakdown:
    """Compute a detailed fee breakdown for a trade.

    Useful for displaying in the UI alongside profit figures.
    """
    from backend.economy.gold_cost_table import GOLD_COST_PER_UNIT

    canonical = normalize_api_id(currency_received)
    is_fallback = canonical not in GOLD_COST_PER_UNIT
    per_unit = get_gold_cost_per_unit(currency_received, fallback=fallback_cost)

    gold_fee_total = per_unit * quantity_received
    gold_fee_in_chaos = gold_fee_total * gold_to_chaos_rate

    fee_fraction = 0.0
    if trade_value_in_chaos > 0:
        fee_fraction = gold_fee_in_chaos / trade_value_in_chaos

    return FeeBreakdown(
        currency_received=currency_received,
        quantity_received=quantity_received,
        gold_cost_per_unit=per_unit,
        gold_fee_total=gold_fee_total,
        gold_to_chaos_rate=gold_to_chaos_rate,
        gold_fee_in_chaos=gold_fee_in_chaos,
        trade_value_in_chaos=trade_value_in_chaos,
        fee_fraction=fee_fraction,
        is_fallback_cost=is_fallback,
    )


def compute_trade_pair_fees(
    currency_from: str,
    currency_to: str,
    raw_rate_forward: float,
    gold_to_chaos_rate: float,
    price_from_in_chaos: float,
    price_to_in_chaos: float,
    fallback_cost: int = 200,
) -> dict:
    """Compute fee information for both directions of a currency pair.

    Returns a dict with 'forward' and 'reverse' keys, each containing
    a FeeBreakdown. This demonstrates the fee asymmetry.
    """
    # Forward: A → B (receive B)
    qty_forward = raw_rate_forward
    trade_value_forward = qty_forward * price_to_in_chaos

    forward_breakdown = compute_fee_breakdown(
        currency_to, qty_forward,
        gold_to_chaos_rate,
        max(trade_value_forward, 1e-10),
        fallback_cost,
    )
    # Fix trade_value if it was essentially zero
    forward_breakdown.trade_value_in_chaos = trade_value_forward
    if trade_value_forward > 0:
        forward_breakdown.fee_fraction = forward_breakdown.gold_fee_in_chaos / trade_value_forward

    # Reverse: B → A (receive A)
    raw_rate_reverse = 1.0 / raw_rate_forward if raw_rate_forward > 0 else 0
    qty_reverse = raw_rate_reverse
    trade_value_reverse = qty_reverse * price_from_in_chaos

    reverse_breakdown = compute_fee_breakdown(
        currency_from, qty_reverse,
        gold_to_chaos_rate,
        max(trade_value_reverse, 1e-10),
        fallback_cost,
    )
    reverse_breakdown.trade_value_in_chaos = trade_value_reverse
    if trade_value_reverse > 0:
        reverse_breakdown.fee_fraction = reverse_breakdown.gold_fee_in_chaos / trade_value_reverse

    return {
        "forward": forward_breakdown,
        "reverse": reverse_breakdown,
    }
