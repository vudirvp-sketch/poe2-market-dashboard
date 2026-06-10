"""
Liquid Chain — vendor reforge conversion chain profitability analysis.

Computes per-step and cumulative profit/loss for vendor reforge chains
(e.g. 3 Diluted Liquid Ire → 1 Diluted Liquid Guilt).

From AGENT_NAVIGATION.md §12:
    For each step i → i+1:
        input_cost  = ratio × price(item_i)
        output_value = 1 × price(item_{i+1})
        profit      = output_value − input_cost
        profit_pct  = profit / input_cost × 100

    Cumulative (position j to k):
        cost  = ratio^(k-j) × price(item_j)
        value = price(item_k)

Design decisions:
- Prices are fetched from DataSnapshot (prices_in_base), which is already
  populated by the periodic snapshot refresh. No additional API calls.
- CPU-bound computation is minimal (10 steps × O(1) per step), so no
  executor offloading needed — runs directly in the async handler.
- Extensible: config supports multiple chains (not just delirium_liquids).
"""

from __future__ import annotations

import logging
from typing import Any

from backend.config import AppConfig, get_settings
from backend.models.currency import LiquidChainStep, LiquidChainCumulativePath, LiquidChainResult

logger = logging.getLogger(__name__)


def compute_liquid_chain(
    chain_config: Any,
    prices: dict[str, float],
) -> LiquidChainResult:
    """Compute profitability analysis for a single liquid chain.

    Args:
        chain_config: LiquidChainDefConfig from config — defines chain steps and ratios.
        prices: Mapping of api_id (lowercase) → price in base currency (Exalted).
                Typically from DataSnapshot.prices_in_base.

    Returns:
        LiquidChainResult with per-step analysis and cumulative paths.
    """
    steps_config = chain_config.steps
    total_steps = len(steps_config)

    if total_steps == 0:
        return LiquidChainResult(
            chain_name=chain_config.name,
            category=chain_config.category,
            steps=[],
            cumulative_paths=[],
            best_step=None,
            worst_step=None,
            data_available=False,
            steps_with_data=0,
            total_steps=0,
        )

    # Build price lookup — prices keys are lowercase api_ids
    steps_data: list[LiquidChainStep] = []
    steps_with_data = 0

    for i, step_cfg in enumerate(steps_config):
        api_id = step_cfg.api_id
        price = prices.get(api_id.lower())

        if price is None:
            # No price data — create step with zeroed fields
            steps_data.append(LiquidChainStep(
                api_id=api_id,
                name_en=step_cfg.name_en,
                name_ru=step_cfg.name_ru,
                ratio=step_cfg.ratio,
                price=0.0,
                input_cost=0.0,
                output_value=0.0,
                profit=0.0,
                profit_pct=0.0,
            ))
            continue

        steps_with_data += 1

        # For the last step, there's no "next" item to reforge into
        if i >= total_steps - 1:
            steps_data.append(LiquidChainStep(
                api_id=api_id,
                name_en=step_cfg.name_en,
                name_ru=step_cfg.name_ru,
                ratio=step_cfg.ratio,
                price=price,
                input_cost=0.0,
                output_value=0.0,
                profit=0.0,
                profit_pct=0.0,
            ))
            continue

        # Get output item price (next step's item)
        next_step = steps_config[i + 1]
        output_price = prices.get(next_step.api_id.lower())

        if output_price is None:
            # Output price missing — can't compute step profit
            steps_data.append(LiquidChainStep(
                api_id=api_id,
                name_en=step_cfg.name_en,
                name_ru=step_cfg.name_ru,
                ratio=step_cfg.ratio,
                price=price,
                input_cost=step_cfg.ratio * price,
                output_value=0.0,
                profit=0.0,
                profit_pct=0.0,
            ))
            continue

        input_cost = step_cfg.ratio * price
        output_value = output_price
        profit = output_value - input_cost
        profit_pct = (profit / input_cost * 100) if input_cost > 0 else 0.0

        steps_data.append(LiquidChainStep(
            api_id=api_id,
            name_en=step_cfg.name_en,
            name_ru=step_cfg.name_ru,
            ratio=step_cfg.ratio,
            price=price,
            input_cost=input_cost,
            output_value=output_value,
            profit=profit,
            profit_pct=profit_pct,
        ))

    # Find best/worst step (among steps with valid profit data)
    valid_steps = [
        (i, s) for i, s in enumerate(steps_data)
        if s.input_cost > 0 and s.output_value > 0
    ]

    best_step: int | None = None
    worst_step: int | None = None
    if valid_steps:
        best_step = max(valid_steps, key=lambda x: x[1].profit_pct)[0]
        worst_step = min(valid_steps, key=lambda x: x[1].profit_pct)[0]

    # Compute cumulative paths
    cumulative_paths = _compute_cumulative_paths(steps_config, prices)

    data_available = steps_with_data == total_steps

    return LiquidChainResult(
        chain_name=chain_config.name,
        category=chain_config.category,
        steps=steps_data,
        cumulative_paths=cumulative_paths,
        best_step=best_step,
        worst_step=worst_step,
        data_available=data_available,
        steps_with_data=steps_with_data,
        total_steps=total_steps,
    )


def _compute_cumulative_paths(
    steps_config: list,
    prices: dict[str, float],
) -> list[LiquidChainCumulativePath]:
    """Compute all profitable cumulative reforge paths.

    For each pair (j, k) where j < k:
        cumulative_ratio = product of ratio[j]...ratio[k-1]
        total_input_cost = cumulative_ratio × price(item_j)
        total_output_value = price(item_k)
        profit = total_output_value − total_input_cost
        profit_pct = profit / total_input_cost × 100

    Only paths with data available and positive cumulative_ratio are included.
    """
    paths: list[LiquidChainCumulativePath] = []
    n = len(steps_config)

    for j in range(n):
        price_j = prices.get(steps_config[j].api_id.lower())
        if price_j is None or price_j <= 0:
            continue

        cumulative_ratio = 1
        for k in range(j + 1, n):
            # Multiply by ratio of step (k-1) → step k
            # ratio[j] means how many of step[j] to produce 1 of step[j+1]
            prev_ratio = steps_config[k - 1].ratio
            if prev_ratio <= 0:
                break
            cumulative_ratio *= prev_ratio

            price_k = prices.get(steps_config[k].api_id.lower())
            if price_k is None or price_k <= 0:
                continue

            total_input_cost = cumulative_ratio * price_j
            total_output_value = price_k
            profit = total_output_value - total_input_cost
            profit_pct = (profit / total_input_cost * 100) if total_input_cost > 0 else 0.0

            paths.append(LiquidChainCumulativePath(
                from_index=j,
                to_index=k,
                total_input_cost=total_input_cost,
                total_output_value=total_output_value,
                cumulative_ratio=cumulative_ratio,
                profit=profit,
                profit_pct=profit_pct,
            ))

    return paths
