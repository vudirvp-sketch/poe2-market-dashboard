"""
Mock POE2Scout Provider for Deterministic E2E Tests.

Phase 2 (Spec Section 12.3): Returns deterministic test data to avoid
dependency on live API availability or rate limits.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from backend.data.providers.base import BaseDataProvider
from backend.models.currency import (
    CurrencyInfo,
    ExchangeRate,
    PricePoint,
    PriceQuote,
)


class MockPoe2ScoutProvider(BaseDataProvider):
    """Deterministic mock provider for E2E testing.

    Returns fixed data that exercises all code paths without
    hitting the live POE2Scout API.
    """

    def name(self) -> str:
        return "mock_poe2scout"

    async def close(self) -> None:
        pass

    async def get_current_price(self, currency_pair: str) -> PriceQuote | None:
        """Return a mock current price for a currency pair."""
        # Simple mock: return a deterministic price quote for known pairs
        base_prices = {"divine": 220.0, "exalted": 1.0, "chaos": 0.1}
        parts = currency_pair.split("/")
        if len(parts) != 2:
            return None
        from_currency, to_currency = parts[0].strip(), parts[1].strip()
        from_price = base_prices.get(from_currency)
        to_price = base_prices.get(to_currency)
        if from_price is None or to_price is None:
            return None
        mid = from_price / to_price
        return PriceQuote(
            pair=currency_pair,
            bid=mid * 0.95,
            ask=mid * 1.05,
            mid_price=mid,
            volume_24h=1000,
        )

    async def get_exchange_rates(self, league: str) -> dict:
        return {
            "exalted/chaos": ExchangeRate(
                currency_from="exalted",
                currency_to="chaos",
                raw_rate=10.0,
                volume_traded=5000,
                stock_value=50000,
                highest_stock=100,
            ),
            "divine/exalted": ExchangeRate(
                currency_from="divine",
                currency_to="exalted",
                raw_rate=220.0,
                volume_traded=1000,
                stock_value=220000,
                highest_stock=50,
            ),
            "divine/chaos": ExchangeRate(
                currency_from="divine",
                currency_to="chaos",
                raw_rate=2200.0,
                volume_traded=800,
                stock_value=1760000,
                highest_stock=30,
            ),
            "chaos/exalted": ExchangeRate(
                currency_from="chaos",
                currency_to="exalted",
                raw_rate=0.1,
                volume_traded=5000,
                stock_value=500,
                highest_stock=200,
            ),
        }

    async def get_all_currencies_with_prices(self, league: str) -> list[dict]:
        return [
            {
                "api_id": "divine",
                "text": "Divine Orb",
                "icon_url": "https://web.poecdn.com/gen/image/divine.png",
                "current_price": 220.0,
                "current_quantity": 1000,
                "price_logs": [
                    {"price": 215.0, "time": "2025-01-20T00:00:00Z"},
                    {"price": 218.0, "time": "2025-01-20T06:00:00Z"},
                    {"price": 220.0, "time": "2025-01-20T12:00:00Z"},
                    {"price": 222.0, "time": "2025-01-20T18:00:00Z"},
                    {"price": 220.0, "time": "2025-01-21T00:00:00Z"},
                ],
            },
            {
                "api_id": "exalted",
                "text": "Exalted Orb",
                "icon_url": "https://web.poecdn.com/gen/image/exalted.png",
                "current_price": 1.0,
                "current_quantity": 5000,
                "price_logs": [
                    {"price": 1.0, "time": "2025-01-20T00:00:00Z"},
                    {"price": 1.02, "time": "2025-01-20T06:00:00Z"},
                    {"price": 0.99, "time": "2025-01-20T12:00:00Z"},
                    {"price": 1.01, "time": "2025-01-20T18:00:00Z"},
                    {"price": 1.0, "time": "2025-01-21T00:00:00Z"},
                ],
            },
            {
                "api_id": "chaos",
                "text": "Chaos Orb",
                "icon_url": "https://web.poecdn.com/gen/image/chaos.png",
                "current_price": 0.1,
                "current_quantity": 50000,
                "price_logs": [
                    {"price": 0.1, "time": "2025-01-20T00:00:00Z"},
                    {"price": 0.1, "time": "2025-01-20T06:00:00Z"},
                    {"price": 0.11, "time": "2025-01-20T12:00:00Z"},
                    {"price": 0.1, "time": "2025-01-20T18:00:00Z"},
                    {"price": 0.1, "time": "2025-01-21T00:00:00Z"},
                ],
            },
        ]

    async def get_currency_metadata(self, league: str) -> list[CurrencyInfo]:
        return [
            CurrencyInfo(
                api_id="divine",
                text="Divine Orb",
                category_api_id="currency",
                icon_url="https://web.poecdn.com/gen/image/divine.png",
            ),
            CurrencyInfo(
                api_id="exalted",
                text="Exalted Orb",
                category_api_id="currency",
                icon_url="https://web.poecdn.com/gen/image/exalted.png",
            ),
            CurrencyInfo(
                api_id="chaos",
                text="Chaos Orb",
                category_api_id="currency",
                icon_url="https://web.poecdn.com/gen/image/chaos.png",
            ),
        ]

    async def get_historical_prices(
        self, currency: str, days: int = 7
    ) -> list[PricePoint]:
        base_prices = {"divine": 220.0, "exalted": 1.0, "chaos": 0.1}
        price = base_prices.get(currency, 1.0)
        now = datetime.now(timezone.utc)
        return [
            PricePoint(
                timestamp=now,
                price=price * (1 + 0.01 * i),
                volume=100,
            )
            for i in range(7)
        ]

    async def get_daily_stats(
        self,
        league: str,
        item_id: int,
        day_count: int = 30,
        end_date: str | None = None,
    ) -> dict | None:
        """Return minimal deterministic daily stats for testing."""
        from datetime import timedelta
        now = datetime.now(timezone.utc)
        return {
            "item_id": item_id,
            "league": league,
            "days": [
                {
                    "day": (now - timedelta(days=i)).strftime("%Y-%m-%d"),
                    "open": 220.0 + i * 0.5,
                    "high": 225.0 + i * 0.5,
                    "low": 215.0 + i * 0.5,
                    "close": 220.0 + i * 0.5,
                    "volume": 1000 - i * 10,
                }
                for i in range(day_count)
            ],
        }
