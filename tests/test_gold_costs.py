"""
Tests for gold_costs.py — verifying fee calculations against known examples.

All test values come from PoE2_Flipper_Canonical_Formulas.md §3.
These tests use synthetic data with known expected outputs.
Never test against live API responses (they change).
"""

import pytest
import math

from backend.economy.gold_costs import (
    compute_gold_fee,
    compute_gold_fee_fraction,
    compute_effective_rate,
    compute_fee_breakdown,
    compute_trade_pair_fees,
)
from backend.economy.gold_cost_table import (
    get_gold_cost_per_unit,
    normalize_api_id,
    GOLD_COST_PER_UNIT,
    API_ID_TO_CANONICAL,
)


# ===========================================================================
# Gold Cost Table Tests
# ===========================================================================

class TestGoldCostTable:
    """Test the gold cost lookup and normalization."""

    def test_known_currencies_have_correct_costs(self):
        """Verify key currencies match the wiki-verified values."""
        assert get_gold_cost_per_unit("exalted") == 120
        assert get_gold_cost_per_unit("divine") == 800
        assert get_gold_cost_per_unit("chaos") == 160
        assert get_gold_cost_per_unit("mirror") == 25000
        assert get_gold_cost_per_unit("orb_of_chance") == 1000
        assert get_gold_cost_per_unit("lesser_jewellers") == 200

    def test_canonical_keys_work_directly(self):
        """Canonical snake_case keys should also work."""
        assert get_gold_cost_per_unit("exalted_orb") == 120
        assert get_gold_cost_per_unit("divine_orb") == 800
        assert get_gold_cost_per_unit("chaos_orb") == 160

    def test_unknown_currency_uses_fallback(self):
        """Unknown currencies should return the fallback value."""
        fallback = 200
        assert get_gold_cost_per_unit("nonexistent_currency_xyz", fallback=fallback) == fallback

    def test_normalize_api_id_basic(self):
        """Test basic normalization."""
        assert normalize_api_id("Exalted") == "exalted_orb"
        assert normalize_api_id("DIVINE") == "divine_orb"
        assert normalize_api_id("chaos") == "chaos_orb"

    def test_normalize_api_id_with_spaces_and_hyphens(self):
        """Spaces and hyphens should be converted to underscores."""
        result = normalize_api_id("Orb of Transmutation")
        # Should be able to look up
        assert get_gold_cost_per_unit(result) == 50

    def test_all_table_entries_are_positive_integers(self):
        """Every entry in the gold cost table should be a positive integer."""
        for key, cost in GOLD_COST_PER_UNIT.items():
            assert isinstance(cost, int), f"{key} has non-int cost: {cost}"
            assert cost > 0, f"{key} has non-positive cost: {cost}"


# ===========================================================================
# Gold Fee Calculation Tests (from Canonical Formulas §3.3, §3.6)
# ===========================================================================

class TestGoldFeeCalculation:
    """Test the core gold fee formula: gold_fee = per_unit × quantity_received."""

    def test_divine_to_exalted_fee(self):
        """
        Trade: 1 Divine Orb → 220 Exalted Orbs
        Buyer receives 220 Exalted Orbs
        gold_fee = 120 × 220 = 26,400 gold

        From Canonical Formulas §3.6 verification.
        """
        fee = compute_gold_fee("exalted", 220)
        assert fee == 120 * 220  # 26,400
        assert fee == 26_400

    def test_exalted_to_divine_fee(self):
        """
        Trade: 220 Exalted Orbs → 1 Divine Orb
        Buyer receives 1 Divine Orb
        gold_fee = 800 × 1 = 800 gold

        From Implementation Spec §3.3.
        """
        fee = compute_gold_fee("divine", 1)
        assert fee == 800

    def test_fee_asymmetry(self):
        """
        Same pair, opposite directions: 24% vs 0.73% fee fraction.
        This asymmetry is the dominant factor in PoE2 arbitrage.

        From Canonical Formulas §3.3.
        """
        gold_to_chaos_rate = 0.001  # 1 gold = 0.001 Chaos

        # Direction 1: 1 Divine → 220 Exalted (receive Exalted)
        # trade_value = 220 × 0.5 = 110 Chaos (assuming 1 Exalted = 0.5 Chaos)
        fee_fraction_forward = compute_gold_fee_fraction(
            "exalted", 220, gold_to_chaos_rate, 110.0
        )
        # gold_fee = 26400, in_chaos = 26.4, fraction = 26.4/110 = 0.24
        assert abs(fee_fraction_forward - 0.24) < 0.001

        # Direction 2: 220 Exalted → 1 Divine (receive Divine)
        # trade_value = 1 × 110 = 110 Chaos (assuming 1 Divine = 110 Chaos)
        fee_fraction_reverse = compute_gold_fee_fraction(
            "divine", 1, gold_to_chaos_rate, 110.0
        )
        # gold_fee = 800, in_chaos = 0.8, fraction = 0.8/110 ≈ 0.00727
        assert abs(fee_fraction_reverse - 0.00727) < 0.001

        # Verify asymmetry: forward >> reverse
        assert fee_fraction_forward > fee_fraction_reverse * 10

    def test_fee_fraction_with_zero_trade_value_raises(self):
        """Fee fraction with zero trade value should raise ValueError."""
        with pytest.raises(ValueError, match="must be positive"):
            compute_gold_fee_fraction("divine", 1, 0.001, 0.0)

    def test_fee_fraction_with_negative_trade_value_raises(self):
        """Fee fraction with negative trade value should raise ValueError."""
        with pytest.raises(ValueError, match="must be positive"):
            compute_gold_fee_fraction("divine", 1, 0.001, -10.0)

    def test_fee_fraction_spec_example(self):
        """
        From Implementation Spec §10 (test requirements):
        Given gold_to_chaos_rate=0.001, trade_value=100 chaos,
        fee=26,400 gold → verify fraction = 26,400×0.001/100 = 0.264 (26.4%)
        """
        fee_fraction = compute_gold_fee_fraction(
            "exalted", 220,  # 220 exalted at 120 gold each = 26400
            0.001,           # gold_to_chaos_rate
            100.0,           # trade_value_in_chaos
        )
        assert abs(fee_fraction - 0.264) < 0.001

    def test_three_divine_to_exalted(self):
        """
        From Canonical Formulas §3.6 verification:
        Convert 3 Divine Orbs to Exalted Orbs
        Rate: 1 Divine ≈ 220 Exalted
        You receive: 3 × 220 = 660 Exalted Orbs
        Gold fee: 660 × 120 = 79,200 gold
        """
        fee = compute_gold_fee("exalted", 660)
        assert fee == 79_200

    def test_divine_to_vaal(self):
        """
        From Canonical Formulas §3.6 verification:
        Convert 1 Divine Orb to Vaal Orbs
        Rate: 1 Divine ≈ 165 Vaal Orbs
        You receive: 165 Vaal Orbs
        Gold fee: 165 × 160 = 26,400 gold
        """
        fee = compute_gold_fee("vaal", 165)
        assert fee == 26_400


# ===========================================================================
# Effective Rate Tests
# ===========================================================================

class TestEffectiveRate:
    """Test the effective rate calculation after fees."""

    def test_effective_rate_reduces_raw_rate(self):
        """Effective rate should always be less than or equal to raw rate."""
        effective, fee_frac = compute_effective_rate(
            raw_rate=220.0,
            currency_from="divine",
            currency_to="exalted",
            gold_to_chaos_rate=0.001,
            price_to_in_chaos=0.5,  # 1 Exalted = 0.5 Chaos
        )
        assert effective < 220.0
        assert 0 < fee_frac < 1.0

    def test_effective_rate_direction_dependent(self):
        """
        effective_rate(A→B) ≠ effective_rate(B→A) even if
        raw_rate(A→B) = 1/raw_rate(B→A), because gold costs differ.
        """
        # Forward: 1 Divine → 220 Exalted
        eff_forward, fee_forward = compute_effective_rate(
            raw_rate=220.0,
            currency_from="divine",
            currency_to="exalted",
            gold_to_chaos_rate=0.001,
            price_to_in_chaos=0.5,
        )

        # Reverse: 1 Exalted → 1/220 Divine
        eff_reverse, fee_reverse = compute_effective_rate(
            raw_rate=1.0 / 220.0,
            currency_from="exalted",
            currency_to="divine",
            gold_to_chaos_rate=0.001,
            price_to_in_chaos=110.0,  # 1 Divine = 110 Chaos
        )

        # Fee fractions must differ (asymmetry)
        assert fee_forward != fee_reverse
        # Forward (receiving many Exalted) should have much higher fee fraction
        assert fee_forward > fee_reverse


# ===========================================================================
# Fee Breakdown Tests
# ===========================================================================

class TestFeeBreakdown:
    """Test the detailed fee breakdown."""

    def test_breakdown_fields_match(self):
        """Verify all breakdown fields are computed correctly."""
        breakdown = compute_fee_breakdown(
            currency_received="exalted",
            quantity_received=220,
            gold_to_chaos_rate=0.001,
            trade_value_in_chaos=110.0,
        )

        assert breakdown.currency_received == "exalted"
        assert breakdown.quantity_received == 220
        assert breakdown.gold_cost_per_unit == 120
        assert breakdown.gold_fee_total == 26_400
        assert breakdown.gold_to_chaos_rate == 0.001
        assert abs(breakdown.gold_fee_in_chaos - 26.4) < 0.01
        assert breakdown.trade_value_in_chaos == 110.0
        assert abs(breakdown.fee_fraction - 0.24) < 0.001
        assert breakdown.is_fallback_cost is False

    def test_breakdown_unknown_currency_is_flagged(self):
        """Unknown currencies should have is_fallback_cost=True."""
        breakdown = compute_fee_breakdown(
            currency_received="totally_fake_currency",
            quantity_received=10,
            gold_to_chaos_rate=0.001,
            trade_value_in_chaos=50.0,
            fallback_cost=200,
        )
        assert breakdown.is_fallback_cost is True
        assert breakdown.gold_cost_per_unit == 200


# ===========================================================================
# Trade Pair Fees Tests
# ===========================================================================

class TestTradePairFees:
    """Test the bidirectional fee calculation."""

    def test_pair_fee_asymmetry(self):
        """
        Verify that forward and reverse fees are asymmetric,
        matching the canonical examples.
        """
        result = compute_trade_pair_fees(
            currency_from="divine",
            currency_to="exalted",
            raw_rate_forward=220.0,
            gold_to_chaos_rate=0.001,
            price_from_in_chaos=110.0,
            price_to_in_chaos=0.5,
        )

        # Forward: receiving 220 Exalted
        assert abs(result["forward"].fee_fraction - 0.24) < 0.001

        # Reverse: receiving 1/220 Divine
        assert result["reverse"].fee_fraction < 0.01  # should be very small
