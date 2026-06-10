"""
Tests for the Liquid Chain module — vendor reforge conversion chain profitability.

Covers:
- compute_liquid_chain() with full data, partial data, empty chains
- Cumulative path computation
- Edge cases: zero prices, missing prices, single-step chains
- Config parsing for liquid_chain section
"""

import pytest

from backend.arbitrage.liquid_chain import compute_liquid_chain, _compute_cumulative_paths
from backend.config import LiquidChainStepConfig, LiquidChainDefConfig, LiquidChainConfig
from backend.models.currency import LiquidChainStep, LiquidChainCumulativePath, LiquidChainResult


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_chain(steps: list[tuple[str, str, str, int]]) -> LiquidChainDefConfig:
    """Create a LiquidChainDefConfig from (api_id, name_en, name_ru, ratio) tuples."""
    return LiquidChainDefConfig(
        name="test_chain",
        category="delirium",
        steps=[
            LiquidChainStepConfig(api_id=api_id, name_en=en, name_ru=ru, ratio=ratio)
            for api_id, en, ru, ratio in steps
        ],
    )


# Realistic prices from POE2Scout API (2026-06-10, runes league)
REAL_PRICES = {
    "diluted-liquid-ire": 0.1805,
    "diluted-liquid-guilt": 0.1877,
    "diluted-liquid-greed": 0.9225,
    "liquid-paranoia": 2.0019,
    "liquid-envy": 2.3670,
    "liquid-disgust": 7.3293,
    "liquid-despair": 21.0253,
    "concentrated-liquid-fear": 68.5724,
    "concentrated-liquid-suffering": 193.0017,
    "concentrated-liquid-isolation": 657.6258,
}


# ---------------------------------------------------------------------------
# Test: compute_liquid_chain — full data
# ---------------------------------------------------------------------------

class TestComputeLiquidChainFullData:
    """Tests with all prices available."""

    def test_full_chain_all_steps_have_data(self):
        chain = _make_chain([
            ("diluted-liquid-ire", "Diluted Liquid Ire", "Разбавленный жидкий гнев", 3),
            ("diluted-liquid-guilt", "Diluted Liquid Guilt", "Разбавленная жидкая вина", 3),
            ("diluted-liquid-greed", "Diluted Liquid Greed", "Разбавленная жидкая жадность", 3),
        ])
        result = compute_liquid_chain(chain, REAL_PRICES)

        assert result.chain_name == "test_chain"
        assert result.category == "delirium"
        assert result.data_available is True
        assert result.steps_with_data == 3
        assert result.total_steps == 3
        assert len(result.steps) == 3

    def test_step_profit_calculation(self):
        """Verify per-step profit: profit = output_value - input_cost, input_cost = ratio * price."""
        chain = _make_chain([
            ("diluted-liquid-ire", "Diluted Liquid Ire", "Разбавленный жидкий гнев", 3),
            ("diluted-liquid-guilt", "Diluted Liquid Guilt", "Разбавленная жидкая вина", 3),
        ])
        result = compute_liquid_chain(chain, REAL_PRICES)

        step0 = result.steps[0]
        assert step0.price == pytest.approx(0.1805, abs=1e-4)
        assert step0.input_cost == pytest.approx(3 * 0.1805, abs=1e-4)
        assert step0.output_value == pytest.approx(0.1877, abs=1e-4)
        assert step0.profit == pytest.approx(0.1877 - 3 * 0.1805, abs=1e-4)

    def test_profit_pct_calculation(self):
        """Verify profit_pct = profit / input_cost × 100."""
        chain = _make_chain([
            ("diluted-liquid-ire", "Diluted Liquid Ire", "Разбавленный жидкий гнев", 3),
            ("diluted-liquid-guilt", "Diluted Liquid Guilt", "Разбавленная жидкая вина", 3),
        ])
        result = compute_liquid_chain(chain, REAL_PRICES)

        step0 = result.steps[0]
        input_cost = 3 * 0.1805
        expected_profit_pct = ((0.1877 - input_cost) / input_cost) * 100
        assert step0.profit_pct == pytest.approx(expected_profit_pct, abs=0.01)

    def test_last_step_no_output(self):
        """Last step should have zero output_value and profit (no next item to reforge into)."""
        chain = _make_chain([
            ("diluted-liquid-ire", "Diluted Liquid Ire", "Разбавленный жидкий гнев", 3),
            ("diluted-liquid-guilt", "Diluted Liquid Guilt", "Разбавленная жидкая вина", 1),
        ])
        result = compute_liquid_chain(chain, REAL_PRICES)

        last_step = result.steps[-1]
        assert last_step.output_value == 0.0
        assert last_step.profit == 0.0
        assert last_step.profit_pct == 0.0

    def test_best_worst_step(self):
        """best_step should be the index with highest profit_pct, worst_step the lowest."""
        chain = _make_chain([
            ("diluted-liquid-ire", "Ire", "Гнев", 3),
            ("diluted-liquid-guilt", "Guilt", "Вина", 3),
            ("diluted-liquid-greed", "Greed", "Жадность", 3),
        ])
        result = compute_liquid_chain(chain, REAL_PRICES)

        # Step 0: 3*0.1805=0.5415 vs 0.1877 → loss
        # Step 1: 3*0.1877=0.5631 vs 0.9225 → profit
        assert result.best_step is not None
        assert result.worst_step is not None

        best = result.steps[result.best_step]
        worst = result.steps[result.worst_step]
        assert best.profit_pct >= worst.profit_pct


# ---------------------------------------------------------------------------
# Test: compute_liquid_chain — partial data
# ---------------------------------------------------------------------------

class TestComputeLiquidChainPartialData:
    """Tests with some prices missing."""

    def test_missing_price_step_zeroed(self):
        """Steps with missing prices should have zeroed fields."""
        chain = _make_chain([
            ("diluted-liquid-ire", "Ire", "Гнев", 3),
            ("nonexistent-item", "Fake", "Фейк", 3),
        ])
        prices = {"diluted-liquid-ire": 0.18}
        result = compute_liquid_chain(chain, prices)

        assert result.data_available is False
        assert result.steps_with_data == 1
        # Step 1 has no price
        assert result.steps[1].price == 0.0
        assert result.steps[1].input_cost == 0.0

    def test_missing_output_price(self):
        """Step with input price but missing output price should have zeroed output."""
        chain = _make_chain([
            ("diluted-liquid-ire", "Ire", "Гнев", 3),
            ("diluted-liquid-guilt", "Guilt", "Вина", 3),
        ])
        prices = {"diluted-liquid-ire": 0.18}  # Missing guilt price
        result = compute_liquid_chain(chain, prices)

        step0 = result.steps[0]
        assert step0.price == pytest.approx(0.18, abs=1e-4)
        assert step0.input_cost == pytest.approx(0.54, abs=1e-4)
        assert step0.output_value == 0.0  # No output price available


# ---------------------------------------------------------------------------
# Test: compute_liquid_chain — edge cases
# ---------------------------------------------------------------------------

class TestComputeLiquidChainEdgeCases:
    """Edge case tests."""

    def test_empty_chain(self):
        """Empty chain should return empty result with data_available=False."""
        chain = LiquidChainDefConfig(name="empty", category="test", steps=[])
        result = compute_liquid_chain(chain, {})

        assert result.data_available is False
        assert result.steps_with_data == 0
        assert result.total_steps == 0
        assert result.steps == []
        assert result.cumulative_paths == []

    def test_single_step_chain(self):
        """Single-step chain: no conversion possible, no cumulative paths."""
        chain = _make_chain([
            ("diluted-liquid-ire", "Ire", "Гнев", 3),
        ])
        result = compute_liquid_chain(chain, REAL_PRICES)

        assert result.total_steps == 1
        assert len(result.steps) == 1
        assert result.steps[0].output_value == 0.0
        assert result.cumulative_paths == []

    def test_case_insensitive_prices(self):
        """Price lookup should be case-insensitive (lowercase api_id)."""
        chain = _make_chain([
            ("Diluted-Liquid-Ire", "Ire", "Гнев", 3),
            ("Diluted-Liquid-Guilt", "Guilt", "Вина", 3),
        ])
        prices = {"diluted-liquid-ire": 0.18, "diluted-liquid-guilt": 0.19}
        result = compute_liquid_chain(chain, prices)

        assert result.steps_with_data == 2
        assert result.steps[0].price == pytest.approx(0.18, abs=1e-4)

    def test_zero_price_treated_as_missing(self):
        """Zero price should be treated as missing data."""
        chain = _make_chain([
            ("item-a", "A", "А", 3),
            ("item-b", "B", "Б", 3),
        ])
        prices = {"item-a": 0.0, "item-b": 1.0}
        result = compute_liquid_chain(chain, prices)

        # item-a has price=0 → should be treated as missing
        assert result.steps[0].price == 0.0
        assert result.steps[0].input_cost == 0.0


# ---------------------------------------------------------------------------
# Test: cumulative paths
# ---------------------------------------------------------------------------

class TestCumulativePaths:
    """Tests for cumulative path computation."""

    def test_cumulative_path_count(self):
        """n-step chain should produce n*(n-1)/2 cumulative paths (all pairs)."""
        chain = _make_chain([
            ("diluted-liquid-ire", "Ire", "Гнев", 3),
            ("diluted-liquid-guilt", "Guilt", "Вина", 3),
            ("diluted-liquid-greed", "Greed", "Жадность", 3),
        ])
        result = compute_liquid_chain(chain, REAL_PRICES)

        # 3 steps → 3 paths: 0→1, 0→2, 1→2
        assert len(result.cumulative_paths) == 3

    def test_cumulative_ratio(self):
        """Cumulative ratio should be product of step ratios."""
        chain = _make_chain([
            ("diluted-liquid-ire", "Ire", "Гнев", 3),
            ("diluted-liquid-guilt", "Guilt", "Вина", 3),
            ("diluted-liquid-greed", "Greed", "Жадность", 3),
        ])
        result = compute_liquid_chain(chain, REAL_PRICES)

        # Path 0→1: ratio = 3
        path_01 = [p for p in result.cumulative_paths if p.from_index == 0 and p.to_index == 1][0]
        assert path_01.cumulative_ratio == 3

        # Path 0→2: ratio = 3 * 3 = 9
        path_02 = [p for p in result.cumulative_paths if p.from_index == 0 and p.to_index == 2][0]
        assert path_02.cumulative_ratio == 9

        # Path 1→2: ratio = 3
        path_12 = [p for p in result.cumulative_paths if p.from_index == 1 and p.to_index == 2][0]
        assert path_12.cumulative_ratio == 3

    def test_cumulative_profit(self):
        """Cumulative: cost = cum_ratio * price_j, value = price_k."""
        chain = _make_chain([
            ("diluted-liquid-ire", "Ire", "Гнев", 3),
            ("diluted-liquid-guilt", "Guilt", "Вина", 3),
        ])
        result = compute_liquid_chain(chain, REAL_PRICES)

        path = result.cumulative_paths[0]
        assert path.from_index == 0
        assert path.to_index == 1
        expected_cost = 3 * 0.1805
        expected_value = 0.1877
        assert path.total_input_cost == pytest.approx(expected_cost, abs=1e-4)
        assert path.total_output_value == pytest.approx(expected_value, abs=1e-4)
        assert path.profit == pytest.approx(expected_value - expected_cost, abs=1e-4)


# ---------------------------------------------------------------------------
# Test: config parsing
# ---------------------------------------------------------------------------

class TestLiquidChainConfig:
    """Tests for LiquidChainConfig parsing from YAML."""

    def test_default_empty_config(self):
        """Default LiquidChainConfig should have empty chains list."""
        config = LiquidChainConfig()
        assert config.chains == []

    def test_step_config_defaults(self):
        """LiquidChainStepConfig should have sensible defaults."""
        step = LiquidChainStepConfig(api_id="test-item")
        assert step.api_id == "test-item"
        assert step.name_en == ""
        assert step.name_ru == ""
        assert step.ratio == 3

    def test_chain_def_config(self):
        """LiquidChainDefConfig should require name and category."""
        chain = LiquidChainDefConfig(
            name="test_chain",
            category="delirium",
            steps=[LiquidChainStepConfig(api_id="item-a", name_en="Item A", ratio=3)],
        )
        assert chain.name == "test_chain"
        assert chain.category == "delirium"
        assert len(chain.steps) == 1


# ---------------------------------------------------------------------------
# Test: full 10-step chain with real prices
# ---------------------------------------------------------------------------

class TestFullChainWithRealPrices:
    """Integration test with the complete 10-step delirium_liquids chain."""

    def test_full_10_step_chain(self):
        chain = _make_chain([
            ("diluted-liquid-ire", "Diluted Liquid Ire", "Разбавленный жидкий гнев", 3),
            ("diluted-liquid-guilt", "Diluted Liquid Guilt", "Разбавленная жидкая вина", 3),
            ("diluted-liquid-greed", "Diluted Liquid Greed", "Разбавленная жидкая жадность", 3),
            ("liquid-paranoia", "Liquid Paranoia", "Жидкая паранойя", 3),
            ("liquid-envy", "Liquid Envy", "Жидкая зависть", 3),
            ("liquid-disgust", "Liquid Disgust", "Жидкое отвращение", 3),
            ("liquid-despair", "Liquid Despair", "Жидкое отчаяние", 3),
            ("concentrated-liquid-fear", "Concentrated Liquid Fear", "Концентрированный жидкий страх", 3),
            ("concentrated-liquid-suffering", "Concentrated Liquid Suffering", "Концентрированное жидкое страдание", 3),
            ("concentrated-liquid-isolation", "Concentrated Liquid Isolation", "Концентрированное жидкое отчуждение", 1),
        ])
        result = compute_liquid_chain(chain, REAL_PRICES)

        assert result.total_steps == 10
        assert result.steps_with_data == 10
        assert result.data_available is True

        # 10 steps → 9 conversion steps (last has no output)
        # Plus cumulative paths: 9+8+7+6+5+4+3+2+1 = 45 paths
        assert len(result.cumulative_paths) == 45

        # Step 0 (ire→guilt) should be a loss: 3*0.18=0.54 vs 0.19 → -65%
        assert result.steps[0].profit_pct < 0

        # Some later steps should be profitable (prices increase faster than 3x)
        profitable_steps = [s for s in result.steps if s.profit_pct > 0]
        assert len(profitable_steps) > 0

        # Best step should exist
        assert result.best_step is not None
