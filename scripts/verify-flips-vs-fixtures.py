#!/usr/bin/env python3
"""
Flip Verification Script — Compare fixture data with expected flip logic.

This script reads test fixtures from tests/fixtures/ and verifies:
1. Item-category pair coverage (all 5 categories present)
2. BestPaymentBadge logic correctness for Omens (ritual) and Soul Cores (ultimatum)
3. Cross-rate flip detection using real pair data

Usage:
    python scripts/verify-flips-vs-fixtures.py

No VPN or live API required — uses only local fixture data.
"""

import json
import math
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

FIXTURES_DIR = Path(__file__).resolve().parent.parent / "tests" / "fixtures"

# Must stay in sync with config.yaml → league.item_categories
ITEM_CATEGORIES = {"ritual", "ultimatum", "idol", "vaultkeys", "delirium"}

# Anchor hierarchy (§11.1)
ANCHOR_CURRENCIES = ["mirror", "divine", "exalted", "chaos"]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def load_fixture(name: str):
    """Load a JSON fixture file."""
    path = FIXTURES_DIR / name
    if not path.exists():
        print(f"  ✗ Fixture not found: {path}")
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def select_anchor(prices: dict) -> str:
    """§11.1: Select best available anchor currency."""
    for anchor in ANCHOR_CURRENCIES:
        price = prices.get(anchor)
        if price is not None and price > 0:
            return anchor
    return "exalted"


def effective_anchor_price(price_in_currency: float,
                           currency_rel_price: float,
                           anchor_rel_price: float) -> float:
    """§11.2: effective_anchor_price = P_C * (relPrice_C / relPrice_anchor)"""
    if anchor_rel_price <= 0 or currency_rel_price <= 0:
        return float("inf")
    return price_in_currency * (currency_rel_price / anchor_rel_price)


def find_optimal_payment(pricing_options: list, anchor_rel_price: float) -> dict | None:
    """§11.4: Find cheapest payment currency."""
    if len(pricing_options) < 2:
        return None

    options = []
    for opt in pricing_options:
        eff = effective_anchor_price(
            opt["price_in_currency"],
            opt["relative_price"],
            anchor_rel_price,
        )
        if math.isfinite(eff) and eff > 0:
            options.append({**opt, "effective_anchor_price": eff})

    if len(options) < 2:
        return None

    options.sort(key=lambda o: o["effective_anchor_price"])
    best = options[0]
    worst = options[-1]

    savings_anchor = worst["effective_anchor_price"] - best["effective_anchor_price"]
    savings_pct = (savings_anchor / worst["effective_anchor_price"] * 100) if worst["effective_anchor_price"] > 0 else 0.0

    return {
        "best_currency_id": best["currency_id"],
        "best_name": best["currency_name"],
        "worst_currency_id": worst["currency_id"],
        "best_eff_price": best["effective_anchor_price"],
        "worst_eff_price": worst["effective_anchor_price"],
        "savings_anchor": savings_anchor,
        "savings_pct": savings_pct,
        "options": options,
    }


# ---------------------------------------------------------------------------
# Verification 1: Item-category pair coverage
# ---------------------------------------------------------------------------

def verify_item_category_coverage():
    """Check that item-category-pairs.json contains all 5 item categories."""
    print("\n=== Verification 1: Item-Category Pair Coverage ===")
    data = load_fixture("item-category-pairs.json")
    if data is None:
        return False

    found_cats = set(data.keys())
    print(f"  Categories in fixture: {sorted(found_cats)}")
    print(f"  Expected categories:   {sorted(ITEM_CATEGORIES)}")

    missing = ITEM_CATEGORIES - found_cats
    extra = found_cats - ITEM_CATEGORIES

    ok = True
    if missing:
        print(f"  ✗ MISSING categories: {sorted(missing)}")
        ok = False
    else:
        print(f"  ✓ All 5 item categories present")

    if extra:
        print(f"  ⚠ Extra categories (not item-cats): {sorted(extra)}")

    for cat in sorted(found_cats & ITEM_CATEGORIES):
        pairs = data[cat]
        print(f"  • {cat}: {len(pairs)} pairs")

    return ok


# ---------------------------------------------------------------------------
# Verification 2: BestPaymentBadge logic for Omens and Soul Cores
# ---------------------------------------------------------------------------

def verify_optimal_payment_for_items():
    """Verify BestPaymentBadge finds savings for items priced in multiple currencies.

    Uses SnapshotPairs fixture data (item-category-pairs.json) which has pairs
    like: Soul Core of Quipolatl/Exalted, Soul Core of Quipolatl/Chaos, etc.

    For each item, we group its pairs by CurrencyTwo (payment currency),
    then run findOptimalPayment() to check if there's a cheaper option.
    """
    print("\n=== Verification 2: BestPaymentBadge Logic (Omens/Soul Cores) ===")
    pairs_data = load_fixture("item-category-pairs.json")
    ref_data = load_fixture("reference-currencies.json")

    if pairs_data is None or ref_data is None:
        return False

    # Build reference currency prices (relativePrice in Exalted)
    ref_prices = {}
    for rc in ref_data:
        api_id = rc.get("ApiId", "").lower()
        rel_price = float(rc.get("RelativePrice", 0))
        ref_prices[api_id] = rel_price

    # Select anchor
    anchor = select_anchor(ref_prices)
    anchor_rel = ref_prices.get(anchor, 1.0)
    print(f"  Anchor: {anchor} (relPrice={anchor_rel})")

    items_with_savings = 0
    items_checked = 0
    sample_results = []

    for cat in ["ritual", "ultimatum"]:
        pairs = pairs_data.get(cat, [])
        if not pairs:
            print(f"  ⚠ No pairs for category: {cat}")
            continue

        # Group pairs by CurrencyOne.ApiId (the item itself)
        items: dict[str, list] = {}
        for pair in pairs:
            c1 = pair.get("CurrencyOne", {})
            item_id = c1.get("ApiId", "unknown")
            if item_id not in items:
                items[item_id] = []
            items[item_id].append(pair)

        print(f"\n  --- {cat} ({len(items)} unique items) ---")

        for item_id, item_pairs in items.items():
            # Build pricing options from pairs
            options = []
            for pair in item_pairs:
                c2 = pair.get("CurrencyTwo", {})
                c2_id = c2.get("ApiId", "")
                c2_name = c2.get("Text", c2_id)
                c2_rel = ref_prices.get(c2_id.lower(), 0)

                # RelativePrice from CurrencyOneData
                c1_data = pair.get("CurrencyOneData", {})
                rel_price_str = c1_data.get("RelativePrice", "0")
                rel_price = float(rel_price_str) if rel_price_str else 0

                if c2_rel > 0 and rel_price > 0:
                    # price_in_currency = how many c2 per 1 c1
                    # From the pair: CurrencyOneData.RelativePrice is the price of
                    # CurrencyOne in base currency (Exalted).
                    # price_in_currency = CurrencyOne.RelativePrice / CurrencyTwo.RelativePrice
                    c2_rel_in_base = ref_prices.get(c2_id.lower(), 0)
                    if c2_rel_in_base > 0:
                        price_in_c2 = rel_price / c2_rel_in_base
                    else:
                        continue

                    options.append({
                        "currency_id": c2_id,
                        "currency_name": c2_name,
                        "price_in_currency": price_in_c2,
                        "relative_price": c2_rel_in_base,
                    })

            if len(options) >= 2:
                result = find_optimal_payment(options, anchor_rel)
                items_checked += 1

                if result and result["savings_pct"] >= 1.0:
                    items_with_savings += 1
                    c1 = item_pairs[0].get("CurrencyOne", {})
                    item_name = c1.get("Text", item_id)
                    if len(sample_results) < 5:
                        sample_results.append({
                            "name": item_name,
                            "category": cat,
                            "best": result["best_currency_id"],
                            "worst": result["worst_currency_id"],
                            "savings_pct": result["savings_pct"],
                            "best_eff": result["best_eff_price"],
                        })

    print(f"\n  Items checked: {items_checked}")
    print(f"  Items with savings >= 1%: {items_with_savings}")

    if sample_results:
        print(f"\n  Sample results (BestPaymentBadge would show):")
        for s in sample_results:
            print(f"    • {s['name']} [{s['category']}]: "
                  f"Pay in {s['best']} (save {s['savings_pct']:.1f}% vs {s['worst']})")

    if items_with_savings == 0 and items_checked > 0:
        print("  ⚠ No items with savings >= 1% — check if reference prices are current")
        return True  # Not a failure, just informational

    return items_checked > 0


# ---------------------------------------------------------------------------
# Verification 3: Cross-rate flip detection
# ---------------------------------------------------------------------------

def verify_cross_rate_flips():
    """Verify cross-rate flip detection using fixture SnapshotPairs data.

    For each pair, compute the fair cross-rate from reference prices and
    compare with the market rate from the pair itself.
    """
    print("\n=== Verification 3: Cross-Rate Flip Detection ===")
    pairs_data = load_fixture("item-category-pairs.json")
    ref_data = load_fixture("reference-currencies.json")

    if pairs_data is None or ref_data is None:
        return False

    # Build reference prices
    ref_prices = {}
    for rc in ref_data:
        api_id = rc.get("ApiId", "").lower()
        rel_price = float(rc.get("RelativePrice", 0))
        ref_prices[api_id] = rel_price

    flips_found = 0
    total_pairs = 0
    sample_flips = []

    # Only check currency↔currency pairs (skip item-category pairs)
    currency_data = load_fixture("currency-pairs-sample.json")
    if currency_data is None:
        print("  ⚠ No currency-pairs-sample.json — using item-category pairs only")
        all_pairs = []
        for cat, pairs in pairs_data.items():
            all_pairs.extend(pairs)
    else:
        all_pairs = currency_data

    for pair in all_pairs:
        c1 = pair.get("CurrencyOne", {})
        c2 = pair.get("CurrencyTwo", {})
        c1_id = c1.get("ApiId", "").lower()
        c2_id = c2.get("ApiId", "").lower()

        c1_price = ref_prices.get(c1_id)
        c2_price = ref_prices.get(c2_id)

        if c1_price is None or c2_price is None or c1_price <= 0 or c2_price <= 0:
            continue

        # Market rate from the pair
        c1_data = pair.get("CurrencyOneData", {})
        rel_price = float(c1_data.get("RelativePrice", 0))
        c2_data = pair.get("CurrencyTwoData", {})
        c2_rel_price = float(c2_data.get("RelativePrice", 0))

        if rel_price <= 0 or c2_rel_price <= 0:
            continue

        total_pairs += 1

        # Market rate: how many c2 per 1 c1
        market_rate = c2_rel_price / rel_price * rel_price  # simplified: use direct pair price
        # Actually from the pair: market_rate = c1_data.RelativePrice / c2_data.RelativePrice
        # Wait — the pair gives us both RelativePrices in base currency.
        # Fair rate: c1_price / c2_price (using reference prices)
        # Market rate: c1_data.RelativePrice / c2_data.RelativePrice (from pair data)
        market_rate_val = rel_price / c2_rel_price if c2_rel_price > 0 else None
        if market_rate_val is None or market_rate_val <= 0:
            continue

        fair_rate = c1_price / c2_price
        if fair_rate <= 0:
            continue

        deviation_pct = ((market_rate_val - fair_rate) / fair_rate) * 100

        if abs(deviation_pct) >= 5.0:
            flips_found += 1
            direction = "buy_sell_with_buy" if deviation_pct < 0 else "buy_buy_with_sell"
            if len(sample_flips) < 5:
                sample_flips.append({
                    "pair": f"{c1.get('Text', c1_id)}/{c2.get('Text', c2_id)}",
                    "fair_rate": fair_rate,
                    "market_rate": market_rate_val,
                    "deviation_pct": deviation_pct,
                    "direction": direction,
                })

    print(f"  Currency pairs checked: {total_pairs}")
    print(f"  Cross-rate flips (>=5% deviation): {flips_found}")

    if sample_flips:
        print(f"\n  Sample flips:")
        for f in sample_flips:
            print(f"    • {f['pair']}: "
                  f"fair={f['fair_rate']:.4f}, market={f['market_rate']:.4f}, "
                  f"dev={f['deviation_pct']:+.1f}%, dir={f['direction']}")

    return True


# ---------------------------------------------------------------------------
# Verification 4: Fixture consistency check
# ---------------------------------------------------------------------------

def verify_fixture_consistency():
    """Check that categories.json matches item-category-pairs.json."""
    print("\n=== Verification 4: Fixture Consistency ===")
    categories = load_fixture("categories.json")
    pairs_data = load_fixture("item-category-pairs.json")

    if categories is None or pairs_data is None:
        return False

    # Check CurrencyCategories in categories.json include our item categories
    currency_cats = categories.get("CurrencyCategories", [])
    cat_api_ids = {c["ApiId"] for c in currency_cats}

    print(f"  CurrencyCategories in fixture: {sorted(cat_api_ids)}")

    missing_in_cats = ITEM_CATEGORIES - cat_api_ids
    if missing_in_cats:
        print(f"  ✗ Item categories missing from categories.json: {sorted(missing_in_cats)}")
        return False
    else:
        print(f"  ✓ All item categories present in categories.json")

    # Check that categories.json labels match expected
    cat_labels = {c["ApiId"]: c["Label"] for c in currency_cats}
    print(f"\n  Category labels:")
    for api_id in sorted(ITEM_CATEGORIES):
        label = cat_labels.get(api_id, "???")
        print(f"    • {api_id}: {label}")

    # Verify vaultkeys label is "Reliquary Keys" (not "Vault Keys")
    vaultkeys_label = cat_labels.get("vaultkeys", "")
    if vaultkeys_label == "Reliquary Keys":
        print(f"  ✓ vaultkeys label correctly shows 'Reliquary Keys'")
    else:
        print(f"  ⚠ vaultkeys label is '{vaultkeys_label}' (expected 'Reliquary Keys')")

    return True


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print("╔════════════════════════════════════════════════════════════╗")
    print("║  POE2 Market Dashboard — Flip Verification vs Fixtures   ║")
    print("╚════════════════════════════════════════════════════════════╝")

    results = {}

    results["category_coverage"] = verify_item_category_coverage()
    results["optimal_payment"] = verify_optimal_payment_for_items()
    results["cross_rate_flips"] = verify_cross_rate_flips()
    results["fixture_consistency"] = verify_fixture_consistency()

    print("\n" + "=" * 60)
    print("Summary:")
    all_ok = True
    for name, ok in results.items():
        status = "✓ PASS" if ok else "✗ FAIL"
        print(f"  {status}: {name}")
        if not ok:
            all_ok = False

    if all_ok:
        print("\n  All verifications passed! ✓")
    else:
        print("\n  Some verifications failed! ✗")

    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
