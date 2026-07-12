"""
P2-3 regression tests — ensures the JSON-backed `currency_names_ru` loader
returns the same data the old hardcoded-dict version did.

Scope:
  - The 4 dicts load from `currency_names.json` and are non-empty
  - The 4 helper functions work and return None for unknown ids
  - Spot-check a handful of well-known api_ids (exalted, divine, mirror, …)
  - Round-trip: every key in CURRENCY_NAMES_RU also exists in CURRENCY_NAMES_EN
    (the TS-side mirror file already enforces this; we enforce it on the
    Python side too so the two can't drift silently)
  - iter 147 (TD-6 phase 2): unique_names_ru/en sections also load and
    maintain RU/EN key parity. Spot-check a well-known unique item.
"""
from __future__ import annotations

import json
from pathlib import Path

from backend.data.currency_names_ru import (
    CATEGORY_NAMES_EN,
    CATEGORY_NAMES_RU,
    CURRENCY_NAMES_EN,
    CURRENCY_NAMES_RU,
    get_category_en,
    get_category_ru,
    get_en_name,
    get_ru_name,
)


# Load unique_names_ru/en directly from JSON (the loader module doesn't
# expose them yet — they were added iter 147 / TD-6 phase 2 and the loader
# was intentionally kept thin to avoid changing its public API).
_JSON_PATH = Path(__file__).resolve().parent.parent / "backend" / "data" / "currency_names.json"
with _JSON_PATH.open(encoding="utf-8") as _fh:
    _DATA = json.load(_fh)
UNIQUE_NAMES_RU: dict[str, str] = _DATA.get("unique_names_ru", {})
UNIQUE_NAMES_EN: dict[str, str] = _DATA.get("unique_names_en", {})


def test_dicts_load_from_json_and_are_non_empty():
    # Counts verified at iter 137 (F1 unblock — 337 new translations added via
    # the sync_currency_names_from_poe2db.py --fetch-ru-by-item pipeline).
    # If you add new translations, bump these numbers in the same PR.
    assert len(CATEGORY_NAMES_RU) == 17
    assert len(CATEGORY_NAMES_EN) == 17
    assert len(CURRENCY_NAMES_RU) == 686
    assert len(CURRENCY_NAMES_EN) == 686


def test_helpers_return_none_for_unknown_ids():
    assert get_ru_name("definitely-not-an-api-id") is None
    assert get_en_name("definitely-not-an-api-id") is None
    assert get_category_ru("nope") is None
    assert get_category_en("nope") is None


def test_helpers_return_expected_name_for_known_ids():
    # Spot-check the canonical reference currencies in PoE2.
    # iter 146 (TD-6 phase 1 / KI-32 fix): exalted was previously the PoE1-style
    # "Благородная сфера" — overwritten with poe2db's official "Сфера возвышения"
    # via `sync_currency_names_from_poe2db.py --apply-audit --confirm`.
    # divine and mirror already matched poe2db's official RU translation, so
    # they were not in the KI-32 mismatch list and remain unchanged.
    assert get_ru_name("exalted") == "Сфера возвышения"
    assert get_en_name("exalted") == "Exalted Orb"
    assert get_ru_name("divine") == "Божественная сфера"
    assert get_en_name("divine") == "Divine Orb"
    assert get_ru_name("mirror") == "Зеркало Каландры"
    assert get_en_name("mirror") == "Mirror of Kalandra"


def test_category_helpers():
    assert get_category_ru("currency") == "Валюта"
    assert get_category_en("currency") == "Currency"
    assert get_category_ru("ritual") == "Омены ритуала"
    assert get_category_en("ritual") == "Ritual Omens"


def test_ru_and_en_keys_match():
    """The two name maps must cover exactly the same api_ids.

    Without this check, the dashboard would show English names for items
    that have no Russian translation (or vice versa) — confusing UX.
    """
    ru_keys = set(CURRENCY_NAMES_RU.keys())
    en_keys = set(CURRENCY_NAMES_EN.keys())
    assert ru_keys == en_keys, (
        f"RU/EN key drift — only-RU: {ru_keys - en_keys}, "
        f"only-EN: {en_keys - ru_keys}"
    )


def test_category_ru_and_en_keys_match():
    ru_keys = set(CATEGORY_NAMES_RU.keys())
    en_keys = set(CATEGORY_NAMES_EN.keys())
    assert ru_keys == en_keys, (
        f"Category RU/EN key drift — only-RU: {ru_keys - en_keys}, "
        f"only-EN: {en_keys - ru_keys}"
    )


def test_hinekoras_lock_is_translated():
    # Hinekora's Lock is one of the value-storage currencies the product vision
    # calls out explicitly — make sure its translation is always present.
    assert get_ru_name("hinekoras-lock") == "Прядь Хинекоры"
    assert get_en_name("hinekoras-lock") == "Hinekora's Lock"


# ---------------------------------------------------------------------------
# iter 147 (TD-6 phase 2) — unique_items_ru/en parity + spot-checks
# ---------------------------------------------------------------------------

def test_unique_names_dicts_load_and_are_non_empty():
    # iter 147 (TD-6 phase 2): 445 unique items added via
    # `sync_currency_names_from_poe2db.py --fetch-unique-ru` + `--apply-unique`.
    # If you re-run the pipeline and counts change, bump these in the same PR.
    assert len(UNIQUE_NAMES_RU) >= 400, (
        f"unique_names_ru has {len(UNIQUE_NAMES_RU)} entries — expected ≥400. "
        "Re-run --fetch-unique-ru + --apply-unique if poe2db added new items."
    )
    assert len(UNIQUE_NAMES_EN) == len(UNIQUE_NAMES_RU), (
        "unique_names_ru and unique_names_en must have the same number of entries"
    )


def test_unique_names_ru_and_en_keys_match():
    """The two unique-items maps must cover exactly the same slugs."""
    ru_keys = set(UNIQUE_NAMES_RU.keys())
    en_keys = set(UNIQUE_NAMES_EN.keys())
    assert ru_keys == en_keys, (
        f"Unique RU/EN key drift — only-RU: {ru_keys - en_keys}, "
        f"only-EN: {en_keys - ru_keys}"
    )


def test_unique_names_spot_check():
    # Spot-check a well-known unique item: Brynhand's Mark is the first item
    # on poe2db's Unique_item index page. Verified iter 147 against
    # https://poe2db.tw/ru/Brynhands_Mark — RU name "Клеймо Бринханда".
    assert UNIQUE_NAMES_RU.get("Brynhands_Mark") == "Клеймо Бринханда"
    assert UNIQUE_NAMES_EN.get("Brynhands_Mark") == "Brynhand's Mark"

