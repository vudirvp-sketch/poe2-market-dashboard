"""
BaseDataProvider — abstract base class for all data providers.

Every provider must implement these methods. Return None or empty list
on failure — never raise. The system must degrade gracefully.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime
from typing import Optional

from backend.models.currency import (
    CurrencyInfo,
    ExchangeRate,
    PricePoint,
    PriceQuote,
)


class BaseDataProvider(ABC):
    """Abstract data provider interface."""

    @abstractmethod
    async def get_current_price(self, currency_pair: str) -> PriceQuote | None:
        """Return current best bid/ask for a currency pair. None if unavailable."""

    @abstractmethod
    async def get_historical_prices(
        self, currency: str, days: int
    ) -> list[PricePoint]:
        """Return daily/hourly price history. May return empty list."""

    @abstractmethod
    async def get_exchange_rates(self, league: str) -> dict[str, ExchangeRate]:
        """Return all available exchange rates for a league."""

    @abstractmethod
    async def get_currency_metadata(self, league: str) -> list[CurrencyInfo]:
        """Return metadata: name, icon URL, trade ID, etc."""

    @abstractmethod
    def name(self) -> str:
        """Return the provider's name for logging and cache keys."""

    # Fix 5.3: Add close() to the abstract base class so polymorphic usage
    # doesn't raise AttributeError when Poe2ScoutProvider.close() is called.
    # Must be async to match Poe2ScoutProvider.close() which uses `await client.aclose()`.
    async def close(self) -> None:
        """Clean up resources (e.g., HTTP sessions). Override if needed."""
        pass

    async def get_daily_stats(
        self,
        league: str,
        item_id: int,
        day_count: int = 30,
        end_date: str | None = None,
    ) -> dict | None:
        """Return daily OHLCV stats for an item.

        Optional method — default implementation returns None.
        Providers that support DailyStatsHistory should override this.
        """
        return None
