"""
DataSnapshot — unified, cached data snapshot shared across all API routes.

PROBLEM:
  Each route (prices, arbitrage, portfolio, anomalies, etc.) independently
  fetches data from the Poe2Scout API:
    - get_exchange_rates()  → 1 request (SnapshotPairs)
    - get_currency_metadata() → 15+ requests (ByCategory, all pages)
    - get_all_currencies_with_prices() → 15+ requests (ByCategory again)
    - get_historical_prices() per currency → N requests (or 15+ ByCategory fallback)

  A single page load triggers 50-80+ API requests because routes don't
  share data and repeatedly fetch the same ByCategory pages.

SOLUTION:
  DataSnapshot fetches ALL needed data in ONE coordinated pass:
    1. SnapshotPairs (exchange rates, 1 request)
    2. ByCategory for all categories (15 requests, single page each)
    3. Derives metadata + price histories from the ByCategory response

  All routes use get_snapshot() to get the cached result.
  TTL is configurable (default: 5 minutes = cache_ttl_prices_minutes).

  Total API requests per 5-minute window: ~16 (down from 50-80+).
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional

from backend.config import AppConfig, get_settings
from backend.data.providers.poe2scout import Poe2ScoutProvider
from backend.models.currency import (
    CurrencyInfo,
    ExchangeRate,
    PricePoint,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Snapshot data container
# ---------------------------------------------------------------------------

@dataclass
class DataSnapshot:
    """Holds a coherent snapshot of all market data.

    All data is fetched atomically — no mixing of stale and fresh data.
    """

    # Exchange rates from SnapshotPairs
    exchange_rates: dict[str, ExchangeRate] = field(default_factory=dict)

    # All currencies with their price logs from ByCategory
    # Key: api_id (lowercase)
    currencies: dict[str, dict] = field(default_factory=dict)

    # Currency metadata (api_id -> CurrencyInfo)
    currency_metadata: list[CurrencyInfo] = field(default_factory=list)

    # Price histories derived from ByCategory price_logs
    # Key: api_id (lowercase) -> list of PricePoint
    price_histories: dict[str, list[PricePoint]] = field(default_factory=dict)

    # Current prices: api_id -> current_price
    current_prices: dict[str, float] = field(default_factory=dict)

    # Prices in base currency (from SnapshotPairs relative_price)
    prices_in_base: dict[str, float] = field(default_factory=dict)

    # Timestamps
    fetched_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    # Whether the snapshot is valid (has at least some data)
    valid: bool = False

    # ------------------------------------------------------------------
    # Convenience lookup methods
    # ------------------------------------------------------------------

    def get_currency(self, api_id: str) -> dict | None:
        """Look up a currency by api_id (case-insensitive, with fallback).

        Tries lowercase first, then the original-case key stored in
        ``currencies``.  Returns the raw dict from ByCategory or None.
        """
        if not api_id:
            return None
        low = api_id.lower()
        if low in self.currencies:
            return self.currencies[low]
        # Fallback: scan for original-case match
        for key, curr in self.currencies.items():
            if curr.get("api_id", "") == api_id:
                return curr
        return None

    def get_price_history(self, api_id: str) -> list[PricePoint]:
        """Return price history for *api_id* (case-insensitive)."""
        if not api_id:
            return []
        low = api_id.lower()
        if low in self.price_histories:
            return self.price_histories[low]
        # Fallback: check original-case api_id entries
        for key, points in self.price_histories.items():
            if key.lower() == low:
                return points
        return []

    def get_current_price(self, api_id: str) -> float | None:
        """Return the current price for *api_id* (case-insensitive)."""
        if not api_id:
            return None
        low = api_id.lower()
        if low in self.current_prices:
            return self.current_prices[low]
        return None


# ---------------------------------------------------------------------------
# Transitive price calculation (MEDIUM-1)
# ---------------------------------------------------------------------------

def _compute_transitive_prices(prices_in_base: dict, rates: dict, base: str) -> None:
    """BFS to find prices for currencies not directly paired with the base.

    Uses intermediate currencies that already have a base price.
    Transitive prices are less accurate than direct ones — the BFS uses the
    first path found, not necessarily the best. This is acceptable for fee
    estimation.
    """
    from collections import deque

    known = set(prices_in_base.keys()) | {base}
    queue = deque(known)

    while queue:
        current = queue.popleft()
        current_price = prices_in_base.get(current, 1.0)  # base currency has price 1.0

        for key, rate in rates.items():
            if rate.raw_rate <= 0:
                continue

            # Can we price a new currency through 'current'?
            if rate.currency_from == current and rate.currency_to not in prices_in_base:
                # 1 current = raw_rate units of currency_to
                # 1 currency_to = (1/raw_rate) units of current
                # price_of_currency_to_in_base = current_price / raw_rate
                prices_in_base[rate.currency_to] = current_price / rate.raw_rate
                queue.append(rate.currency_to)

            elif rate.currency_to == current and rate.currency_from not in prices_in_base:
                # 1 currency_from = raw_rate units of current
                # price_of_currency_from_in_base = current_price * raw_rate
                prices_in_base[rate.currency_from] = current_price * rate.raw_rate
                queue.append(rate.currency_from)


# ---------------------------------------------------------------------------
# Snapshot manager (singleton)
# ---------------------------------------------------------------------------

class SnapshotManager:
    """Manages a shared, TTL-cached DataSnapshot.

    Thread-safe via asyncio.Lock — only one refresh at a time.
    Other callers await the in-progress refresh instead of starting
    their own.
    """

    def __init__(self, config: AppConfig | None = None):
        self._config = config or get_settings()
        self._snapshot: DataSnapshot | None = None
        self._snapshot_ts: float = 0.0
        self._ttl: float = self._config.data.cache_ttl_prices_minutes * 60.0
        self._lock = asyncio.Lock()
        self._refresh_in_progress = False

    async def get_snapshot(self) -> DataSnapshot:
        """Return the current snapshot, refreshing if stale.

        If a refresh is already in progress, wait for it instead of
        starting a duplicate.
        """
        now = time.monotonic()

        # Fast path: fresh snapshot
        if (
            self._snapshot is not None
            and self._snapshot.valid
            and now - self._snapshot_ts < self._ttl
        ):
            return self._snapshot

        # Slow path: need refresh
        async with self._lock:
            # Double-check after acquiring lock (another coroutine may have
            # refreshed while we waited)
            now = time.monotonic()
            if (
                self._snapshot is not None
                and self._snapshot.valid
                and now - self._snapshot_ts < self._ttl
            ):
                return self._snapshot

            # Refresh
            try:
                self._snapshot = await self._refresh()
                self._snapshot_ts = time.monotonic()
                logger.info(
                    "DataSnapshot refreshed: %d exchange rates, %d currencies",
                    len(self._snapshot.exchange_rates),
                    len(self._snapshot.currencies),
                )
            except Exception as e:
                logger.error("DataSnapshot refresh failed: %s", e)
                # Return stale snapshot if available, otherwise empty
                if self._snapshot is not None:
                    stale_age = now - self._snapshot_ts
                    logger.warning(
                        "DEGRADED: Returning stale DataSnapshot after refresh failure "
                        "(age=%.1fs, rates=%d, currencies=%d)",
                        stale_age,
                        len(self._snapshot.exchange_rates),
                        len(self._snapshot.currencies),
                    )
                    return self._snapshot
                self._snapshot = DataSnapshot(valid=False)

            return self._snapshot

    async def _refresh(self) -> DataSnapshot:
        """Fetch all data from the Poe2Scout API in a coordinated pass.

        Makes exactly:
          - 1 request to SnapshotPairs
          - 1 request to Items/Categories
          - N requests to Currencies/ByCategory (one per category)
        Total: ~16 requests (vs 50-80+ without sharing)
        """
        from backend.api.shared import get_provider

        provider = get_provider()
        config = self._config
        league = config.league.league_name
        snapshot = DataSnapshot()

        # --- Step 1: Fetch exchange rates (1 request) ---
        try:
            rates = await provider.get_exchange_rates(league)
            snapshot.exchange_rates = rates or {}
        except Exception as e:
            logger.error("Snapshot: get_exchange_rates failed: %s", e)
            snapshot.exchange_rates = {}

        # --- Step 2: Build prices_in_base from exchange rates ---
        base = config.league.base_currency
        prices_in_base: dict[str, float] = {base: 1.0}
        for key, rate in snapshot.exchange_rates.items():
            if rate.currency_from == base and rate.raw_rate > 0:
                if rate.currency_to not in prices_in_base:
                    prices_in_base[rate.currency_to] = 1.0 / rate.raw_rate   # price of currency_to in base
            elif rate.currency_to == base and rate.raw_rate > 0:
                if rate.currency_from not in prices_in_base:
                    prices_in_base[rate.currency_from] = rate.raw_rate         # price of currency_from in base

        # MEDIUM-1: Transitive price calculation for currencies without direct
        # pair to the base currency (e.g. vaal has no exalted/vaal pair).
        # Uses BFS through intermediate currencies that already have a base price.
        _compute_transitive_prices(prices_in_base, snapshot.exchange_rates, base)

        snapshot.prices_in_base = prices_in_base

        # --- Step 3: Fetch all currencies via ByCategory (~15 requests) ---
        try:
            all_currencies = await provider.get_all_currencies_with_prices(league)
        except Exception as e:
            logger.error("Snapshot: get_all_currencies_with_prices failed: %s", e)
            all_currencies = []

        # --- Step 4: Build lookup structures from ByCategory data ---
        currencies: dict[str, dict] = {}
        currency_metadata: list[CurrencyInfo] = []
        price_histories: dict[str, list[PricePoint]] = {}
        current_prices: dict[str, float] = {}

        for curr in all_currencies:
            api_id = curr.get("api_id", "")
            if not api_id:
                continue

            currencies[api_id.lower()] = curr

            # Metadata
            currency_metadata.append(CurrencyInfo(
                api_id=api_id,
                text=curr.get("text", ""),
                category_api_id=curr.get("category_api_id", ""),
                icon_url=curr.get("icon_url"),
                item_id=curr.get("item_id"),
                currency_item_id=curr.get("currency_item_id"),
            ))

            # Current price
            cp = curr.get("current_price")
            if cp is not None and cp > 0:
                current_prices[api_id.lower()] = cp

            # Price history from price_logs (already in ByCategory response!)
            price_logs = curr.get("price_logs", [])
            points: list[PricePoint] = []
            for log in price_logs:
                time_val = log.get("time")
                price = log.get("price")
                quantity = log.get("quantity", 0)
                if time_val is not None and price is not None:
                    try:
                        if isinstance(time_val, str):
                            ts = datetime.fromisoformat(
                                time_val.replace("Z", "+00:00")
                            )
                        elif isinstance(time_val, datetime):
                            ts = time_val
                        else:
                            continue
                        points.append(PricePoint(
                            timestamp=ts,
                            price=float(price),
                            volume=float(quantity) if quantity else 0.0,
                        ))
                    except (ValueError, TypeError) as exc:
                        logger.debug(
                            "Skipping invalid price log for %s: %s",
                            api_id, exc,
                        )
            if points:
                price_histories[api_id.lower()] = points

        snapshot.currencies = currencies
        snapshot.currency_metadata = currency_metadata
        snapshot.price_histories = price_histories
        snapshot.current_prices = current_prices
        snapshot.valid = bool(currencies or snapshot.exchange_rates)

        return snapshot

    def invalidate(self) -> None:
        """Force a refresh on the next get_snapshot() call."""
        self._snapshot_ts = 0.0

    def health_info(self) -> dict:
        """Return diagnostic information about the snapshot state.

        Used by the /api/health endpoint to provide visibility into
        degraded-mode caching.
        """
        now = time.monotonic()
        age = now - self._snapshot_ts if self._snapshot_ts > 0 else -1
        is_stale = age > self._ttl if age >= 0 else True

        return {
            "snapshot_valid": self._snapshot is not None and self._snapshot.valid,
            "snapshot_stale": is_stale,
            "snapshot_age_seconds": round(age, 1) if age >= 0 else None,
            "snapshot_ttl_seconds": self._ttl,
            "exchange_rates_count": len(self._snapshot.exchange_rates) if self._snapshot else 0,
            "currencies_count": len(self._snapshot.currencies) if self._snapshot else 0,
            "price_histories_count": len(self._snapshot.price_histories) if self._snapshot else 0,
            "fetched_at": self._snapshot.fetched_at.isoformat() if self._snapshot and self._snapshot.fetched_at else None,
        }


# ---------------------------------------------------------------------------
# Singleton
# ---------------------------------------------------------------------------

_snapshot_manager: SnapshotManager | None = None


def get_snapshot_manager(config: AppConfig | None = None) -> SnapshotManager:
    """Return the global SnapshotManager singleton."""
    global _snapshot_manager
    if _snapshot_manager is None:
        _snapshot_manager = SnapshotManager(config)
    return _snapshot_manager


async def get_snapshot() -> DataSnapshot:
    """Convenience: get the current DataSnapshot."""
    return await get_snapshot_manager().get_snapshot()
