"""
Tests for §11 backend functions: _select_anchor, _find_optimal_payment, _detect_cross_rate_flips.

These functions live in backend/api/routes_arbitrage.py and implement
cross-currency optimal payment analysis and cross-rate flip detection.

Test data mirrors the canonical examples from PoE2_Flipper_Canonical_Formulas.md §11.
"""

import pytest
import math

from backend.models.currency import ExchangeRate
from backend.api.routes_arbitrage import (
    _select_anchor,
    _effective_anchor_price,
    _find_optimal_payment,
    _detect_cross_rate_flips,
    ANCHOR_CURRENCIES,
)


# ---------------------------------------------------------------------------
# _select_anchor tests
# ---------------------------------------------------------------------------

class TestSelectAnchor:
    """§11.1: Anchor currency selection."""

    def test_prefers_mirror_when_available(self):
        """Mirror of Kalandra is the highest-priority anchor."""
        prices = {"mirror": 15000.0, "divine": 150.0, "exalted": 1.0, "chaos": 0.1}
        assert _select_anchor(prices) == "mirror"

    def test_prefers_divine_when_no_mirror(self):
        """Divine Orb is preferred when Mirror is absent."""
        prices = {"divine": 150.0, "exalted": 1.0, "chaos": 0.1}
        assert _select_anchor(prices) == "divine"

    def test_prefers_exalted_when_no_mirror_or_divine(self):
        """Exalted Orb is preferred when Mirror and Divine are absent."""
        prices = {"exalted": 1.0, "chaos": 0.1}
        assert _select_anchor(prices) == "exalted"

    def test_uses_chaos_as_last_resort(self):
        """Chaos Orb is selected when no higher anchor is available."""
        prices = {"chaos": 1.0, "regret": 0.05}
        assert _select_anchor(prices) == "chaos"

    def test_returns_exalted_fallback_when_empty(self):
        """Empty prices_in_base returns 'exalted' as ultimate fallback."""
        assert _select_anchor({}) == "exalted"

    def test_returns_exalted_fallback_when_no_known_anchors(self):
        """Only unknown currencies in prices → fallback to 'exalted'."""
        prices = {"some_currency": 5.0, "other": 0.3}
        assert _select_anchor(prices) == "exalted"

    def test_ignores_zero_price_anchor(self):
        """Anchor with price=0 is skipped."""
        prices = {"mirror": 0.0, "divine": 150.0, "exalted": 1.0}
        assert _select_anchor(prices) == "divine"

    def test_ignores_negative_price_anchor(self):
        """Anchor with negative price is skipped."""
        prices = {"divine": -1.0, "exalted": 1.0}
        assert _select_anchor(prices) == "exalted"

    def test_ignores_none_price_anchor(self):
        """Anchor with None price is skipped."""
        prices = {"divine": None, "exalted": 1.0}
        assert _select_anchor(prices) == "exalted"


# ---------------------------------------------------------------------------
# _effective_anchor_price tests
# ---------------------------------------------------------------------------

class TestEffectiveAnchorPrice:
    """§11.2: Effective anchor price computation."""

    def test_basic_computation(self):
        """effective_anchor_price = P_C * (relPrice_C / relPrice_anchor)"""
        # Item costs 3 Divine, Divine relPrice=150, Exalted relPrice=1 (anchor)
        result = _effective_anchor_price(3.0, 150.0, 1.0)
        assert result == pytest.approx(450.0)

    def test_anchor_price_same_as_currency(self):
        """When payment currency IS the anchor, rate_to_anchor = 1."""
        result = _effective_anchor_price(5.0, 1.0, 1.0)
        assert result == pytest.approx(5.0)

    def test_returns_inf_for_zero_anchor_price(self):
        """Zero anchor relative price → Infinity (undefined rate)."""
        result = _effective_anchor_price(1.0, 150.0, 0.0)
        assert result == float("inf")

    def test_returns_inf_for_negative_anchor_price(self):
        """Negative anchor relative price → Infinity."""
        result = _effective_anchor_price(1.0, 150.0, -1.0)
        assert result == float("inf")

    def test_returns_inf_for_zero_currency_price(self):
        """Zero currency relative price → Infinity."""
        result = _effective_anchor_price(1.0, 0.0, 1.0)
        assert result == float("inf")

    def test_returns_inf_for_negative_currency_price(self):
        """Negative currency relative price → Infinity."""
        result = _effective_anchor_price(1.0, -1.0, 1.0)
        assert result == float("inf")

    def test_small_fractional_price(self):
        """Very small relative prices should still compute correctly."""
        # Chaos: relPrice=0.1, Exalted anchor: relPrice=1.0
        # Item costs 10 Chaos → effective = 10 * (0.1/1.0) = 1.0 Exalted
        result = _effective_anchor_price(10.0, 0.1, 1.0)
        assert result == pytest.approx(1.0)

    def test_large_price_difference(self):
        """Mirror-priced item with tiny currency relative price."""
        # Item costs 0.001 Mirror, Mirror relPrice=15000, Exalted anchor=1
        result = _effective_anchor_price(0.001, 15000.0, 1.0)
        assert result == pytest.approx(15.0)


# ---------------------------------------------------------------------------
# _find_optimal_payment tests
# ---------------------------------------------------------------------------

class TestFindOptimalPayment:
    """§11.4: Optimal payment currency detection."""

    def test_returns_none_for_single_option(self):
        """Need at least 2 payment options for comparison."""
        options = [
            {"currency_id": "divine", "currency_name": "Divine Orb",
             "price_in_currency": 3.0, "relative_price": 150.0},
        ]
        assert _find_optimal_payment(options, 1.0) is None

    def test_returns_none_for_empty_options(self):
        """Empty options list → None."""
        assert _find_optimal_payment([], 1.0) is None

    def test_cheapest_currency_wins(self):
        """Currency with lowest effective anchor price should be best."""
        options = [
            # Paying in Exalted: 450 Exa * (1/1) = 450 Exa
            {"currency_id": "exalted", "currency_name": "Exalted Orb",
             "price_in_currency": 450.0, "relative_price": 1.0},
            # Paying in Divine: 3 Div * (150/1) = 450 Exa
            {"currency_id": "divine", "currency_name": "Divine Orb",
             "price_in_currency": 3.0, "relative_price": 150.0},
        ]
        result = _find_optimal_payment(options, 1.0)
        assert result is not None
        # Both are equally priced in this case — best is whichever sorts first
        assert result["savings_pct"] == pytest.approx(0.0, abs=0.01)

    def test_detects_real_savings(self):
        """When one currency is cheaper, savings should be positive."""
        options = [
            # Paying in Exalted: 450 Exa → 450 Exa effective
            {"currency_id": "exalted", "currency_name": "Exalted Orb",
             "price_in_currency": 450.0, "relative_price": 1.0},
            # Paying in Divine: 4 Div → 600 Exa effective (more expensive)
            {"currency_id": "divine", "currency_name": "Divine Orb",
             "price_in_currency": 4.0, "relative_price": 150.0},
        ]
        result = _find_optimal_payment(options, 1.0)
        assert result is not None
        assert result["best_currency_id"] == "exalted"
        assert result["worst_currency_id"] == "divine"
        assert result["savings_anchor"] > 0
        assert result["savings_pct"] > 0

    def test_options_sorted_by_effective_price(self):
        """Options in result should be sorted by effectiveAnchorPrice ascending."""
        options = [
            {"currency_id": "chaos", "currency_name": "Chaos Orb",
             "price_in_currency": 4500.0, "relative_price": 0.1},
            {"currency_id": "divine", "currency_name": "Divine Orb",
             "price_in_currency": 4.0, "relative_price": 150.0},
            {"currency_id": "exalted", "currency_name": "Exalted Orb",
             "price_in_currency": 450.0, "relative_price": 1.0},
        ]
        result = _find_optimal_payment(options, 1.0)
        assert result is not None
        effective_prices = [o["effectiveAnchorPrice"] for o in result["options"]]
        assert effective_prices == sorted(effective_prices)

    def test_premium_pct_is_zero_for_cheapest(self):
        """Cheapest option should have 0% premium."""
        options = [
            {"currency_id": "exalted", "currency_name": "Exalted Orb",
             "price_in_currency": 450.0, "relative_price": 1.0},
            {"currency_id": "divine", "currency_name": "Divine Orb",
             "price_in_currency": 4.0, "relative_price": 150.0},
        ]
        result = _find_optimal_payment(options, 1.0)
        assert result is not None
        assert result["options"][0]["premiumPct"] == pytest.approx(0.0)

    def test_filters_invalid_options(self):
        """Options with zero or negative relative_price are filtered out."""
        options = [
            {"currency_id": "exalted", "currency_name": "Exalted Orb",
             "price_in_currency": 450.0, "relative_price": 1.0},
            {"currency_id": "broken", "currency_name": "Broken Currency",
             "price_in_currency": 10.0, "relative_price": 0.0},
        ]
        # Only 1 valid option left after filtering → returns None
        result = _find_optimal_payment(options, 1.0)
        assert result is None

    def test_three_currencies_with_clear_winner(self):
        """With 3 payment options, the cheapest by effective price wins."""
        options = [
            # Chaos: 5000 * (0.1/1.0) = 500 Exa
            {"currency_id": "chaos", "currency_name": "Chaos Orb",
             "price_in_currency": 5000.0, "relative_price": 0.1},
            # Exalted: 450 * (1.0/1.0) = 450 Exa
            {"currency_id": "exalted", "currency_name": "Exalted Orb",
             "price_in_currency": 450.0, "relative_price": 1.0},
            # Divine: 4 * (150/1.0) = 600 Exa
            {"currency_id": "divine", "currency_name": "Divine Orb",
             "price_in_currency": 4.0, "relative_price": 150.0},
        ]
        result = _find_optimal_payment(options, 1.0)
        assert result is not None
        assert result["best_currency_id"] == "exalted"
        assert result["worst_currency_id"] == "divine"
        # Savings = 600 - 450 = 150 Exa
        assert result["savings_anchor"] == pytest.approx(150.0)
        # Savings pct = 150/600 * 100 = 25%
        assert result["savings_pct"] == pytest.approx(25.0, abs=0.1)


# ---------------------------------------------------------------------------
# _detect_cross_rate_flips tests
# ---------------------------------------------------------------------------

class TestDetectCrossRateFlips:
    """§11.5: Cross-rate flip opportunity detection."""

    def _make_rate(self, from_id: str, to_id: str, raw_rate: float,
                   volume: int = 100) -> ExchangeRate:
        """Helper to create an ExchangeRate for testing."""
        return ExchangeRate(
            currency_from=from_id,
            currency_to=to_id,
            raw_rate=raw_rate,
            volume_traded=volume,
            stock_value=0.0,
            highest_stock=0,
        )

    def test_detects_undervalued_currency(self):
        """When market rate < fair rate, the 'from' currency is undervalued."""
        # exalted/chaos: fair rate = 10/0.1 = 100, but market rate = 80
        # → exalted is undervalued: buy exalted with chaos is cheap
        rates = {
            "exalted_chaos": self._make_rate("exalted", "chaos", 80.0, volume=500),
        }
        prices = {"exalted": 10.0, "chaos": 0.1}
        flips = _detect_cross_rate_flips(rates, prices, threshold_pct=5.0)

        assert len(flips) >= 1
        flip = flips[0]
        assert flip["buyCurrencyId"] == "exalted"
        assert flip["sellCurrencyId"] == "chaos"
        assert flip["deviationPct"] < 0  # market < fair → negative deviation
        assert flip["estimatedProfitPct"] > 0

    def test_detects_overvalued_currency(self):
        """When market rate > fair rate, the 'to' currency is undervalued."""
        # exalted/chaos: fair rate = 10/0.1 = 100, but market rate = 120
        # → chaos is undervalued: buy chaos with exalted is cheap
        rates = {
            "exalted_chaos": self._make_rate("exalted", "chaos", 120.0, volume=500),
        }
        prices = {"exalted": 10.0, "chaos": 0.1}
        flips = _detect_cross_rate_flips(rates, prices, threshold_pct=5.0)

        assert len(flips) >= 1
        flip = flips[0]
        assert flip["buyCurrencyId"] == "chaos"
        assert flip["sellCurrencyId"] == "exalted"
        assert flip["deviationPct"] > 0  # market > fair → positive deviation

    def test_no_flips_below_threshold(self):
        """Pairs within threshold should not be flagged."""
        # Fair rate = 100, market = 102 → 2% deviation, below 5% threshold
        rates = {
            "exalted_chaos": self._make_rate("exalted", "chaos", 102.0, volume=500),
        }
        prices = {"exalted": 10.0, "chaos": 0.1}
        flips = _detect_cross_rate_flips(rates, prices, threshold_pct=5.0)
        assert len(flips) == 0

    def test_custom_threshold(self):
        """Lower threshold catches smaller deviations."""
        rates = {
            "exalted_chaos": self._make_rate("exalted", "chaos", 102.0, volume=500),
        }
        prices = {"exalted": 10.0, "chaos": 0.1}
        # 2% deviation → not flagged at 5%, flagged at 1%
        flips_5 = _detect_cross_rate_flips(rates, prices, threshold_pct=5.0)
        flips_1 = _detect_cross_rate_flips(rates, prices, threshold_pct=1.0)
        assert len(flips_5) == 0
        assert len(flips_1) >= 1

    def test_skips_low_volume_pairs(self):
        """Pairs below min_volume threshold are skipped."""
        rates = {
            "exalted_chaos": self._make_rate("exalted", "chaos", 80.0, volume=5),
        }
        prices = {"exalted": 10.0, "chaos": 0.1}
        flips = _detect_cross_rate_flips(rates, prices, threshold_pct=5.0, min_volume=10)
        assert len(flips) == 0

    def test_skips_missing_prices(self):
        """Pairs with missing prices_in_base entries are skipped."""
        rates = {
            "exalted_chaos": self._make_rate("exalted", "chaos", 80.0, volume=500),
        }
        # Missing 'chaos' in prices
        prices = {"exalted": 10.0}
        flips = _detect_cross_rate_flips(rates, prices, threshold_pct=5.0)
        assert len(flips) == 0

    def test_skips_zero_or_negative_prices(self):
        """Pairs with zero or negative prices are skipped."""
        rates = {
            "exalted_chaos": self._make_rate("exalted", "chaos", 80.0, volume=500),
        }
        prices_zero = {"exalted": 10.0, "chaos": 0.0}
        prices_neg = {"exalted": 10.0, "chaos": -0.1}
        assert len(_detect_cross_rate_flips(rates, prices_zero, 5.0)) == 0
        assert len(_detect_cross_rate_flips(rates, prices_neg, 5.0)) == 0

    def test_empty_rates_returns_empty(self):
        """No rates → no flips."""
        assert _detect_cross_rate_flips({}, {"exalted": 1.0}) == []

    def test_results_sorted_by_profit_descending(self):
        """Multiple flips should be sorted by estimated profit descending."""
        rates = {
            "a_b": self._make_rate("a", "b", 80.0, volume=500),
            "c_d": self._make_rate("c", "d", 50.0, volume=500),
        }
        prices = {"a": 10.0, "b": 0.1, "c": 10.0, "d": 0.1}
        flips = _detect_cross_rate_flips(rates, prices, threshold_pct=5.0)
        if len(flips) >= 2:
            profits = [f["estimatedProfitPct"] for f in flips]
            assert profits == sorted(profits, reverse=True)

    def test_max_50_results(self):
        """Results are capped at 50 entries."""
        rates = {}
        prices = {}
        for i in range(60):
            from_id = f"from_{i}"
            to_id = f"to_{i}"
            key = f"{from_id}_{to_id}"
            rates[key] = self._make_rate(from_id, to_id, 80.0, volume=500)
            prices[from_id] = 10.0
            prices[to_id] = 0.1
        flips = _detect_cross_rate_flips(rates, prices, threshold_pct=5.0)
        assert len(flips) <= 50


# ---------------------------------------------------------------------------
# Item-aware grouping tests (§11 extension)
# ---------------------------------------------------------------------------

class TestItemAwareGrouping:
    """Tests for item-aware optimal payment grouping in the /optimal-currency endpoint.

    These tests verify the logic that groups exchange pairs by item category
    (ritual, ultimatum, idol, vaultkeys, delirium) and finds the cheapest
    payment currency for each craft item.

    The actual grouping logic runs inside the /optimal-currency endpoint,
    but the underlying _find_optimal_payment function is the same.
    These tests simulate what happens when item-category pairs are processed.
    """

    def test_item_with_two_payment_currencies(self):
        """A Ritual Omen priced in both Exalted and Chaos — cheapest should win.

        Scenario: 'Blood Filled Bowl' (ritual omen) is sold for:
          - 0.5 Exalted (effective = 0.5 Exa)
          - 8 Chaos (effective = 8 * 0.1 = 0.8 Exa)
        → Exalted is cheaper payment.
        """
        # Simulating the pricing options that the item-aware grouping would build
        options = [
            {"currency_id": "exalted", "currency_name": "Exalted Orb",
             "price_in_currency": 0.5, "relative_price": 1.0},
            {"currency_id": "chaos", "currency_name": "Chaos Orb",
             "price_in_currency": 8.0, "relative_price": 0.1},
        ]
        result = _find_optimal_payment(options, 1.0)
        assert result is not None
        assert result["best_currency_id"] == "exalted"
        assert result["worst_currency_id"] == "chaos"
        assert result["savings_pct"] > 0

    def test_item_with_three_payment_currencies(self):
        """A Soul Core priced in Exalted, Divine, and Chaos."""
        options = [
            {"currency_id": "exalted", "currency_name": "Exalted Orb",
             "price_in_currency": 2.0, "relative_price": 1.0},
            {"currency_id": "divine", "currency_name": "Divine Orb",
             "price_in_currency": 0.02, "relative_price": 150.0},  # 0.02*150=3 Exa
            {"currency_id": "chaos", "currency_name": "Chaos Orb",
             "price_in_currency": 25.0, "relative_price": 0.1},   # 25*0.1=2.5 Exa
        ]
        result = _find_optimal_payment(options, 1.0)
        assert result is not None
        assert result["best_currency_id"] == "exalted"  # 2.0 Exa cheapest
        assert result["worst_currency_id"] == "divine"  # 3.0 Exa most expensive
        # Savings = 3.0 - 2.0 = 1.0 Exa
        assert result["savings_anchor"] == pytest.approx(1.0)

    def test_item_with_single_payment_returns_none(self):
        """Item with only one payment option → no comparison possible."""
        options = [
            {"currency_id": "exalted", "currency_name": "Exalted Orb",
             "price_in_currency": 1.0, "relative_price": 1.0},
        ]
        result = _find_optimal_payment(options, 1.0)
        assert result is None

    def test_divine_premium_on_items(self):
        """Divine Orb typically has ~10% premium on items.

        Scenario: An item priced at 1 Exalted or 0.008 Divine.
        - Exalted: 1.0 * (1.0/1.0) = 1.0 Exa
        - Divine: 0.008 * (150.0/1.0) = 1.2 Exa
        → Exalted is 16.7% cheaper.
        """
        options = [
            {"currency_id": "exalted", "currency_name": "Exalted Orb",
             "price_in_currency": 1.0, "relative_price": 1.0},
            {"currency_id": "divine", "currency_name": "Divine Orb",
             "price_in_currency": 0.008, "relative_price": 150.0},
        ]
        result = _find_optimal_payment(options, 1.0)
        assert result is not None
        assert result["best_currency_id"] == "exalted"
        assert result["savings_pct"] == pytest.approx(16.67, abs=0.5)

    def test_new_item_categories_in_config(self):
        """Verify that new item categories (idol, vaultkeys, delirium) are in config."""
        from backend.config import get_settings
        settings = get_settings()
        item_cats = settings.league.item_categories
        assert "ritual" in item_cats
        assert "ultimatum" in item_cats
        assert "idol" in item_cats
        assert "vaultkeys" in item_cats
        assert "delirium" in item_cats
