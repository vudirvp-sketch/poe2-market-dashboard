"""
Russian and English name mappings for PoE2 currencies and items — JSON loader.

Maps api_id (from POE2Scout API) to localized display names.
Used by the backend API to return translated names alongside the api_id.

Data lives in `currency_names.json` (next to this file) so editors can update
localized names without touching Python code. P2-3 (iter 70).

Sources:
  - poe2db.tw/ru/ — verified Russian localization from the PoE2 wiki
  - POE2Scout API — api_id verification (items not in API noted as such)
  - config.yaml liquid_chain sections (confirmed ru_name values)

Maintainer notes:
  - "# poe2db" = verified against poe2db.tw/ru/ (PoE2 wiki)
  - "# poe2db, POE2Scout confirmed" = api_id verified in POE2Scout API
  - "# poe2db, not in POE2Scout API" = exists in game but not tracked by POE2Scout
  - "# poedb" = verified against poedb.tw/ru/ (PoE1 client, may need re-verification)
  - Standard PoE1 orbs (portal, scouring, regret, etc.) — no tag
  - PoE2 uses a different essence system: Lesser -> base -> Greater -> Perfect
    (no "Deafening" tier — those are PoE1-only and have been removed)
  - PoE1-only items have been removed — this is a PoE2-only dashboard
  - PoE2 Russian client uses "Иш" for "Esh" (not "Эш" as in some PoE1 translations)
  - PoE2 runes were overhauled: fire/ice/lightning tiers replaced with
    adept/body/iron/mind/stone/storm rune system with lesser/greater/perfect tiers
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

_JSON_PATH = Path(__file__).parent / "currency_names.json"

with _JSON_PATH.open(encoding="utf-8") as _fh:
    _DATA = json.load(_fh)

CATEGORY_NAMES_RU: dict[str, str] = _DATA["category_names_ru"]
CATEGORY_NAMES_EN: dict[str, str] = _DATA["category_names_en"]
CURRENCY_NAMES_RU: dict[str, str] = _DATA["currency_names_ru"]
CURRENCY_NAMES_EN: dict[str, str] = _DATA["currency_names_en"]


def get_ru_name(api_id: str) -> Optional[str]:
    """Return the Russian name for an api_id, or None if not found."""
    return CURRENCY_NAMES_RU.get(api_id)


def get_en_name(api_id: str) -> Optional[str]:
    """Return the English name for an api_id, or None if not found."""
    return CURRENCY_NAMES_EN.get(api_id)


def get_category_ru(category_api_id: str) -> Optional[str]:
    """Return the Russian category label for a category api_id, or None if not found."""
    return CATEGORY_NAMES_RU.get(category_api_id)


def get_category_en(category_api_id: str) -> Optional[str]:
    """Return the English category label for a category api_id, or None if not found."""
    return CATEGORY_NAMES_EN.get(category_api_id)
