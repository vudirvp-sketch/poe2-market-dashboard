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
    CurrencyTier,
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

    # P1-3: Currency tier classifications
    tiers: dict[str, CurrencyTier] = field(default_factory=dict)

    # Timestamps
    fetched_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    # Whether the snapshot is valid (has at least some data)
    valid: bool = False

    # ------------------------------------------------------------------
    # Pickle safety — guarantee DataSnapshot is always picklable
    # ------------------------------------------------------------------

    def __getstate__(self) -> dict:
        """Custom pickle: strip any non-picklable attributes that might
        have been attached at runtime (e.g. via monkey-patching or
        accidental closure capture).  Only the known dataclass fields
        are serialized.
        """
        state = {
            'exchange_rates': self.exchange_rates,
            'currencies': self.currencies,
            'currency_metadata': self.currency_metadata,
            'price_histories': self.price_histories,
            'current_prices': self.current_prices,
            'prices_in_base': self.prices_in_base,
            'tiers': self.tiers,
            'fetched_at': self.fetched_at,
            'valid': self.valid,
        }
        return state

    def __setstate__(self, state: dict) -> None:
        """Restore from pickle — set all known fields from state dict."""
        self.exchange_rates = state.get('exchange_rates', {})
        self.currencies = state.get('currencies', {})
        self.currency_metadata = state.get('currency_metadata', [])
        self.price_histories = state.get('price_histories', {})
        self.current_prices = state.get('current_prices', {})
        self.prices_in_base = state.get('prices_in_base', {})
        self.tiers = state.get('tiers', {})
        self.fetched_at = state.get('fetched_at', datetime.now(timezone.utc))
        self.valid = state.get('valid', False)

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
    # NOTE: The BFS uses the first path found to compute transitive prices.
    # This is not guaranteed to be the highest-volume or most accurate path.
    # For currencies with many indirect paths, the transitive price may differ
    # from the most accurate estimate. This is acceptable for tier classification
    # and portfolio weighting, but should be noted for precision-critical uses.
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
        self._periodic_task: asyncio.Task | None = None
        # P2-3: Separate TTL cache for individual price histories
        # Key: api_id (lowercase), Value: (fetch_time, price_logs)
        self._history_cache: dict[str, tuple[float, list]] = {}
        # TTL for active currencies (present in current SnapshotPairs)
        self._history_cache_active_ttl = 5 * 60.0  # 5 minutes
        # TTL for inactive currencies (not in current SnapshotPairs)
        self._history_cache_inactive_ttl = 30 * 60.0  # 30 minutes
        # Track which currencies are active (present in SnapshotPairs)
        self._active_currencies: set[str] = set()

    @property
    def last_snapshot(self) -> DataSnapshot | None:
        """Return the last snapshot, even if stale. None if never refreshed."""
        return self._snapshot

    async def start_periodic_refresh(self) -> None:
        """Start periodic snapshot refresh as a long-running background task.

        P0-1: This runs as an asyncio.Task started from the FastAPI lifespan.
        The first refresh happens immediately; subsequent refreshes happen
        every TTL seconds. If the API is unreachable, the refresh is
        skipped and retried on the next cycle.

        This method is designed to be cancelled via task.cancel() on shutdown.
        """
        logger.info("SnapshotManager: starting periodic refresh (TTL=%.0fs)", self._ttl)
        while True:
            try:
                # Attempt a refresh
                try:
                    snapshot = await self._refresh()
                    if snapshot is not None and snapshot.valid:
                        self._snapshot = snapshot
                        self._snapshot_ts = time.monotonic()
                        logger.info(
                            "SnapshotManager: snapshot refreshed — %d exchange rates, %d currencies",
                            len(snapshot.exchange_rates),
                            len(snapshot.currencies),
                        )
                    else:
                        logger.warning("SnapshotManager: refresh returned invalid snapshot, keeping previous")
                except Exception as e:
                    logger.error("SnapshotManager: refresh failed: %s — keeping previous snapshot if available", e)
                    # Do NOT crash — keep serving the old snapshot

                # Wait for TTL before next refresh
                await asyncio.sleep(self._ttl)
            except asyncio.CancelledError:
                logger.info("SnapshotManager: periodic refresh cancelled — shutting down")
                raise

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

        P0-1: Network errors are caught and logged. The caller (get_snapshot
        or start_periodic_refresh) is responsible for deciding whether to
        keep the previous snapshot or create an empty one.

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

        # --- Step 4.5: Fill price histories for SnapshotPair currencies not in ByCategory ---
        # BUG FIX (2026-06-04): Currencies that appear in SnapshotPairs (46 pairs)
        # but whose ItemId doesn't map to any ByCategory category will have NO
        # price_histories. This causes zero momentum/volatility in arbitrage
        # calculations and empty correlation matrices. We fetch their individual
        # price histories from /Currencies/{ApiId} to fill the gap.
        snapshot_pair_currencies: set[str] = set()
        for key, rate in snapshot.exchange_rates.items():
            if rate.currency_from:
                snapshot_pair_currencies.add(rate.currency_from.lower())
            if rate.currency_to:
                snapshot_pair_currencies.add(rate.currency_to.lower())

        missing_currencies = snapshot_pair_currencies - set(price_histories.keys())

        # P2-3: Update active currencies set for TTL determination
        self._active_currencies = snapshot_pair_currencies

        if missing_currencies:
            logger.info(
                "SnapshotPairs coverage: %d currencies missing from ByCategory, "
                "fetching individual price histories: %s",
                len(missing_currencies),
                sorted(missing_currencies)[:10],  # log first 10 to avoid spam
            )
            cache_hits = 0
            cache_misses = 0
            for api_id_lower in missing_currencies:
                # P2-3: Check history cache first
                cached = self._history_cache.get(api_id_lower)
                if cached is not None:
                    fetch_time, cached_points = cached
                    is_active = api_id_lower in self._active_currencies
                    ttl = self._history_cache_active_ttl if is_active else self._history_cache_inactive_ttl
                    if time.monotonic() - fetch_time < ttl:
                        price_histories[api_id_lower] = cached_points
                        cache_hits += 1
                        logger.debug(
                            "History cache HIT for %s (%d points, age=%.0fs, ttl=%.0fs)",
                            api_id_lower, len(cached_points),
                            time.monotonic() - fetch_time, ttl,
                        )
                        continue  # Use cached data, don't re-fetch
                    else:
                        logger.debug(
                            "History cache EXPIRED for %s (age=%.0fs > ttl=%.0fs)",
                            api_id_lower, time.monotonic() - fetch_time, ttl,
                        )

                cache_misses += 1
                try:
                    # Try the original-case api_id (from exchange_rates)
                    orig_id = api_id_lower
                    for rate in snapshot.exchange_rates.values():
                        if rate.currency_from and rate.currency_from.lower() == api_id_lower:
                            orig_id = rate.currency_from
                            break
                        if rate.currency_to and rate.currency_to.lower() == api_id_lower:
                            orig_id = rate.currency_to
                            break

                    points_ind = await provider.get_historical_prices(orig_id, days=7)
                    if points_ind:
                        price_histories[api_id_lower] = points_ind
                        # P2-3: Store in history cache
                        self._history_cache[api_id_lower] = (time.monotonic(), points_ind)
                        logger.debug(
                            "Filled price history for %s: %d points (cached)",
                            api_id_lower, len(points_ind),
                        )
                except Exception as e:
                    # P0-1: Don't crash if one individual fetch fails
                    logger.debug(
                        "Could not fetch individual price history for %s: %s",
                        api_id_lower, e,
                    )

            if cache_hits > 0 or cache_misses > 0:
                logger.info(
                    "Individual history fetch: %d cache hits, %d cache misses (fetches)",
                    cache_hits, cache_misses,
                )

        # Log coverage summary
        covered = snapshot_pair_currencies & set(price_histories.keys())
        logger.info(
            "SnapshotPairs coverage: %d/%d currencies have price histories "
            "(ByCategory: %d, individual fetch: %d)",
            len(covered), len(snapshot_pair_currencies),
            len(covered - missing_currencies),
            len(missing_currencies & set(price_histories.keys())),
        )

        snapshot.currencies = currencies
        snapshot.currency_metadata = currency_metadata
        snapshot.price_histories = price_histories
        snapshot.current_prices = current_prices
        snapshot.valid = bool(currencies or snapshot.exchange_rates)

        # P1-3: Compute currency tier classifications from prices_in_base
        if snapshot.prices_in_base:
            try:
                from backend.economy.tiers import classify_currencies
                tier_input = [
                    {"api_id": api_id, "relative_price": price}
                    for api_id, price in snapshot.prices_in_base.items()
                    if price > 0
                ]
                tier_results = classify_currencies(tier_input, config.tiers.boundaries)
                snapshot.tiers = {
                    r.api_id: CurrencyTier(
                        api_id=r.api_id,
                        tier=r.tier,
                        tier_label=r.tier_label,
                        relative_price=r.relative_price,
                        tier_anchor=r.tier_anchor,
                    )
                    for r in tier_results
                }
                logger.info("Tier classification: %d currencies classified", len(snapshot.tiers))
            except Exception as e:
                logger.error("Tier classification failed: %s", e)
                snapshot.tiers = {}

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
