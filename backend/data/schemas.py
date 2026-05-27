"""
Pydantic models for POE2Scout API responses.

All field names use PascalCase (alias_generator) to match the API's
convention. Access via property names (camelCase) in Python code.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, alias_generators


# ---------------------------------------------------------------------------
# Base model with PascalCase alias support
# ---------------------------------------------------------------------------

class ApiModel(BaseModel):
    """Base model: Python attrs are snake_case, serialized as PascalCase."""
    model_config = ConfigDict(
        alias_generator=alias_generators.to_pascal,
        populate_by_name=True,
    )


# ---------------------------------------------------------------------------
# Price Logs
# ---------------------------------------------------------------------------

class PriceLogEntry(ApiModel):
    price: float
    time: datetime
    quantity: int = 0


# ---------------------------------------------------------------------------
# Currency Items
# ---------------------------------------------------------------------------

class ItemMetadata(ApiModel):
    name: Optional[str] = None
    base_type: Optional[str] = None
    stack_size: Optional[int] = None
    max_stack_size: Optional[int] = None
    description: Optional[str] = None
    effect: Optional[list[str]] = None
    flavor_text: Optional[str] = None


class CurrencyItem(ApiModel):
    currency_item_id: int
    item_id: int
    currency_category_id: int
    api_id: str
    text: str
    category_api_id: str
    icon_url: Optional[str] = None
    item_metadata: Optional[ItemMetadata] = None


class CurrencyItemExtended(CurrencyItem):
    price_logs: list[Optional[PriceLogEntry]] = Field(default_factory=list)
    current_price: Optional[float] = None
    current_quantity: Optional[int] = None


# ---------------------------------------------------------------------------
# Unique Items
# ---------------------------------------------------------------------------

class UniqueItem(ApiModel):
    unique_item_id: int
    item_id: int
    icon_url: Optional[str] = None
    text: str = ""
    name: str = ""
    category_api_id: str = ""
    item_metadata: Optional[ItemMetadata] = None
    type: Optional[str] = None
    is_chanceable: Optional[bool] = None
    is_current: bool = True


class UniqueItemExtended(UniqueItem):
    price_logs: list[Optional[PriceLogEntry]] = Field(default_factory=list)
    current_price: Optional[float] = None
    current_quantity: Optional[int] = None


# ---------------------------------------------------------------------------
# Exchange Snapshot
# ---------------------------------------------------------------------------

class PairDataDetails(ApiModel):
    """Per-currency data within a snapshot pair. Decimal fields come as strings."""
    value_traded: Decimal = Decimal("0")
    relative_price: Decimal = Decimal("0")
    stock_value: Decimal = Decimal("0")
    volume_traded: int = 0
    highest_stock: int = 0


class SnapshotPair(ApiModel):
    """A single trading pair in an exchange snapshot."""
    currency_exchange_snapshot_pair_id: int = 0
    currency_exchange_snapshot_id: int = 0
    volume: Decimal = Decimal("0")
    base_currency_api_id: str = "exalted"
    base_currency_text: str = "Exalted Orb"
    currency_one: Optional[CurrencyItem] = None
    currency_two: Optional[CurrencyItem] = None
    currency_one_data: Optional[PairDataDetails] = None
    currency_two_data: Optional[PairDataDetails] = None


class ExchangeSnapshot(ApiModel):
    """Top-level exchange snapshot summary."""
    epoch: int = 0
    volume: Decimal = Decimal("0")
    market_cap: Decimal = Decimal("0")
    base_currency_api_id: str = "exalted"
    base_currency_text: str = "Exalted Orb"


class SnapshotHistoryPoint(ApiModel):
    epoch: int = 0
    market_cap: Decimal = Decimal("0")
    volume: Decimal = Decimal("0")


class SnapshotHistoryMeta(ApiModel):
    has_more: bool = False


class SnapshotHistoryResponse(ApiModel):
    data: list[SnapshotHistoryPoint] = Field(default_factory=list)
    meta: SnapshotHistoryMeta = SnapshotHistoryMeta()
    base_currency_api_id: str = "exalted"
    base_currency_text: str = "Exalted Orb"


# ---------------------------------------------------------------------------
# Pair History
# ---------------------------------------------------------------------------

class PairHistoryDataPoint(ApiModel):
    """A single epoch's data for both currencies in a pair."""
    currency_one_data: Optional[PairDataDetails] = None
    currency_two_data: Optional[PairDataDetails] = None


class PairHistoryEntry(ApiModel):
    epoch: int = 0
    data: Optional[PairHistoryDataPoint] = None


class PairHistoryResponse(ApiModel):
    history: list[PairHistoryEntry] = Field(default_factory=list)
    meta: SnapshotHistoryMeta = SnapshotHistoryMeta()
    base_currency_api_id: str = "exalted"
    base_currency_text: str = "Exalted Orb"


# ---------------------------------------------------------------------------
# Daily Stats
# ---------------------------------------------------------------------------

class DailyStatsPoint(ApiModel):
    time: str = ""       # date string
    open: float = 0.0
    high: float = 0.0
    low: float = 0.0
    close: float = 0.0
    average: float = 0.0
    volume: int = 0


class DailyStatsResponse(ApiModel):
    daily_stats: list[DailyStatsPoint] = Field(default_factory=list)
    has_more: bool = False
    base_currency_api_id: str = "exalted"
    base_currency_text: str = "Exalted Orb"


# ---------------------------------------------------------------------------
# Paginated Responses
# ---------------------------------------------------------------------------

class PaginatedResponse(ApiModel):
    current_page: int = 1
    pages: int = 1
    total: int = 0


class CurrencyByCategoryResponse(PaginatedResponse):
    items: list[CurrencyItemExtended] = Field(default_factory=list)


class UniqueByCategoryResponse(PaginatedResponse):
    items: list[UniqueItemExtended] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Reference Currencies
# ---------------------------------------------------------------------------

class ReferenceCurrency(ApiModel):
    api_id: str = ""
    text: str = ""
    icon_url: Optional[str] = None
    relative_price: float = 1.0


# ---------------------------------------------------------------------------
# Realms & Leagues
# ---------------------------------------------------------------------------

class RealmOption(ApiModel):
    value: str = ""          # e.g. "poe2/pc"
    label: str = ""
    game_api_id: str = ""
    realm_api_id: str = ""
    trade_api_path: str = ""
    default_league_value: str = "Standard"


class DefaultCurrency(ApiModel):
    api_id: str = ""
    text: str = ""
    icon_url: Optional[str] = None
    relative_price: float = 1.0


class LeagueInfo(ApiModel):
    value: str = ""
    short_name: str = ""
    is_current: bool = False
    divine_price: Optional[float] = None
    chaos_divine_price: Optional[float] = None
    base_currency_api_id: str = "exalted"
    base_currency_text: str = "Exalted Orb"
    base_currency_icon_url: Optional[str] = None
    exalted_currency_text: str = "Exalted Orb"
    exalted_currency_icon_url: Optional[str] = None
    divine_currency_text: str = "Divine Orb"
    divine_currency_icon_url: Optional[str] = None
    chaos_currency_text: str = "Chaos Orb"
    chaos_currency_icon_url: Optional[str] = None
    default_currency: Optional[DefaultCurrency] = None


# ---------------------------------------------------------------------------
# Item Categories
# ---------------------------------------------------------------------------

class UniqueCategory(ApiModel):
    item_category_id: int = 0
    api_id: str = ""
    label: str = ""
    icon: Optional[str] = None


class CurrencyCategory(ApiModel):
    currency_category_id: int = 0
    api_id: str = ""
    label: str = ""
    icon: Optional[str] = None


class CategoriesResponse(ApiModel):
    unique_categories: list[UniqueCategory] = Field(default_factory=list)
    currency_categories: list[CurrencyCategory] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Landing Splash
# ---------------------------------------------------------------------------

class LandingSplashItem(ApiModel):
    currency_item_id: int = 0
    item_id: int = 0
    currency_category_id: int = 0
    api_id: str = ""
    text: str = ""
    category_api_id: str = ""
    icon_url: Optional[str] = None
    item_metadata: Optional[ItemMetadata] = None
    price_logs: list[Optional[PriceLogEntry]] = Field(default_factory=list)
    current_price: Optional[float] = None
