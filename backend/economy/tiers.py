"""
Currency tier classification based on RelativePrice.

Tiers are a natural value pyramid in PoE2:
  T0 (Ultra)  — Mirror of Kalandra tier, RelativePrice > 50
  T1 (High)   — Divine Orb tier, 10 < RelativePrice <= 50
  T2 (Core)   — Exalted/Chaos tier, 1 < RelativePrice <= 10
  T3 (Mid)    — Regret/Annulment tier, 0.1 < RelativePrice <= 1
  T4 (Low)    — Transmutation/Augmentation tier, 0.01 < RelativePrice <= 0.1
  T5 (Micro)  — Scroll tier, RelativePrice <= 0.01

Boundaries are configurable via config.yaml — NEVER hardcode currency names.
Different leagues have different RelativePrice values (e.g., in Runes of Aldur,
Chaos ≈ 7.0 Exalted — more expensive than Exalted).
"""

from dataclasses import dataclass, replace
from backend.config import get_settings, TierBoundaryConfig


TIER_LABELS = {
    0: "Ultra",
    1: "High",
    2: "Core",
    3: "Mid",
    4: "Low",
    5: "Micro",
}


@dataclass(frozen=True)
class CurrencyTierResult:
    api_id: str
    tier: int               # 0-5
    tier_label: str         # "Ultra", "High", etc.
    relative_price: float
    tier_anchor: str        # api_id of the highest-priced currency in same tier


def compute_tier(relative_price: float, boundaries: TierBoundaryConfig | None = None) -> int:
    """
    Classify a currency into a tier based on its RelativePrice.
    Returns tier number 0-5.
    """
    if boundaries is None:
        cfg = get_settings()
        boundaries = cfg.tiers.boundaries

    if relative_price >= boundaries.t0_min:
        return 0
    elif relative_price >= boundaries.t1_min:
        return 1
    elif relative_price >= boundaries.t2_min:
        return 2
    elif relative_price >= boundaries.t3_min:
        return 3
    elif relative_price >= boundaries.t4_min:
        return 4
    else:
        return 5


def classify_currencies(
    currencies: list[dict],  # [{"api_id": str, "relative_price": float, ...}]
    boundaries: TierBoundaryConfig | None = None,
) -> list[CurrencyTierResult]:
    """
    Classify all currencies into tiers.
    Sets tier_anchor to the api_id of the currency with the highest
    RelativePrice in the same tier.
    """
    if boundaries is None:
        cfg = get_settings()
        boundaries = cfg.tiers.boundaries

    results: list[CurrencyTierResult] = []
    tier_groups: dict[int, list[CurrencyTierResult]] = {}

    for c in currencies:
        tier = compute_tier(c["relative_price"], boundaries)
        label = TIER_LABELS.get(tier, "Unknown")
        result = CurrencyTierResult(
            api_id=c["api_id"],
            tier=tier,
            tier_label=label,
            relative_price=c["relative_price"],
            tier_anchor="",  # Will be set below
        )
        results.append(result)
        tier_groups.setdefault(tier, []).append(result)

    # Set tier_anchor for each currency to the highest-priced currency in its tier
    for tier, group in tier_groups.items():
        anchor = max(group, key=lambda x: x.relative_price)
        results = [
            replace(r, tier_anchor=anchor.api_id) if r.tier == tier else r
            for r in results
        ]

    return results


def tier_distance(tier_a: int, tier_b: int) -> int:
    """Distance between two tiers. Same-tier = 0, adjacent = 1, etc."""
    return abs(tier_a - tier_b)


def tier_penalty(tier_a: int, tier_b: int) -> float:
    """
    Penalty factor for flipping between currencies of different tiers.
    Same tier = 1.0 (no penalty). Cross-tier = reduced score.
    """
    dist = tier_distance(tier_a, tier_b)
    return 1.0 / (1.0 + dist * 0.3)
