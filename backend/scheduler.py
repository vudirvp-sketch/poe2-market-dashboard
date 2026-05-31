"""
Background Scheduler for Data Collection.

Phase 2 (Spec Section 7): A lightweight background scheduler that periodically
fetches prices and writes to SQLite, triggers event pruning, and manages
LightGBM model persistence.

Uses apscheduler (Advanced Python Scheduler) — simple, no external service
needed, integrates with FastAPI lifespan.

Jobs:
    - price_snapshot: Fetch current prices and write to HistoricalStore
    - event_pruning: Prune expired events from memory and SQLite
    - model_persistence: Save LightGBM models to disk periodically
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from backend.config import AppConfig, get_settings
from backend.data.historical import HistoricalStore

# Import get_snapshot at module level so tests can patch it via
# "backend.scheduler._get_snapshot"
from backend.api.data_snapshot import get_snapshot as _get_snapshot

logger = logging.getLogger(__name__)


class DataScheduler:
    """Background scheduler for periodic data collection tasks.

    Uses apscheduler's AsyncIOScheduler to run periodic jobs in the
    FastAPI event loop. Configured via config.yaml scheduler section.

    Jobs:
        - price_snapshot: Fetch current prices → write to HistoricalStore
        - event_pruning: Prune expired events from memory and SQLite
        - model_persistence: Persist LightGBM models to disk
    """

    def __init__(
        self,
        provider,  # Poe2ScoutProvider
        historical_store: HistoricalStore,
        event_manager,  # EventManager
        config: AppConfig | None = None,
    ):
        self._config = config or get_settings()
        self._provider = provider
        self._store = historical_store
        self._event_manager = event_manager
        self._scheduler = None  # lazily created in start()

    async def collect_price_snapshot(self) -> int:
        """Fetch current prices and write to HistoricalStore.

        Uses DataSnapshot exclusively for data — if the snapshot is
        stale or unavailable, triggers a fresh refresh.  This ensures
        consistency with the API routes (which also read from DataSnapshot).

        Returns:
            Number of snapshots written, or 0 on failure.
        """
        try:
            league = self._config.league.league_name

            # Use DataSnapshot (public API) — consistent with all routes.
            # If the snapshot is stale, get_snapshot() will trigger a refresh.
            snapshot = await _get_snapshot()

            rates = snapshot.exchange_rates
            if not rates:
                logger.debug("No exchange rates in DataSnapshot; skipping snapshot")
                return 0

            # Build price-in-base mapping for the base currency
            base = self._config.league.base_currency
            prices_in_base: dict[str, float] = {base: 1.0}

            for key, rate in rates.items():
                if rate.currency_from == base and rate.raw_rate > 0:
                    prices_in_base[rate.currency_to] = 1.0 / rate.raw_rate   # price in base
                elif rate.currency_to == base and rate.raw_rate > 0:
                    prices_in_base[rate.currency_from] = rate.raw_rate         # price in base

            # Build snapshots
            snapshots = []
            now = datetime.now(timezone.utc)

            for key, rate in rates.items():
                # Use the currency_to's price in base for the snapshot
                price_base = prices_in_base.get(rate.currency_to, rate.raw_rate)
                snapshots.append({
                    "currency": rate.currency_to,
                    "price": price_base,
                    "volume_24h": float(rate.volume_traded) if rate.volume_traded else None,
                    "bid": None,  # bid/ask not directly available from SnapshotPairs
                    "ask": None,
                })

                # Also write a snapshot for currency_from
                from_price = prices_in_base.get(rate.currency_from)
                if from_price is not None:
                    snapshots.append({
                        "currency": rate.currency_from,
                        "price": from_price,
                        "volume_24h": None,
                        "bid": None,
                        "ask": None,
                    })

            if snapshots:
                await self._store.write_price_snapshots_batch(league, snapshots)
                logger.info(
                    "Scheduler: wrote %d price snapshots for league %s",
                    len(snapshots), league,
                )
                return len(snapshots)

            return 0

        except Exception as e:
            logger.error("Scheduler: price snapshot collection failed: %s", e)
            return 0

    async def prune_events(self) -> int:
        """Prune expired events from both memory and SQLite.

        Returns:
            Number of events pruned from memory.
        """
        try:
            pruned_memory = self._event_manager._prune_expired()
            await self._store.prune_expired_events()
            return pruned_memory
        except Exception as e:
            logger.error("Scheduler: event pruning failed: %s", e)
            return 0

    async def persist_models(self) -> int:
        """Trigger LightGBM model persistence.

        Checks if ModelStore is available and persists any in-memory models.

        Returns:
            Number of models persisted, or 0 on failure.
        """
        try:
            from backend.predictors.model_store import get_model_store
            model_store = get_model_store()
            return model_store.persist_pending()
        except ImportError:
            logger.debug("Scheduler: ModelStore not available, skipping model persistence")
            return 0
        except Exception as e:
            logger.error("Scheduler: model persistence failed: %s", e)
            return 0

    def start(self) -> None:
        """Start the background scheduler.

        Creates and configures the AsyncIOScheduler with jobs based on
        the scheduler configuration in config.yaml. If scheduler.enabled
        is False, this method is a no-op.
        """
        scheduler_config = self._config.scheduler
        if not scheduler_config.enabled:
            logger.info("Scheduler: disabled in config, not starting")
            return

        try:
            from apscheduler.schedulers.asyncio import AsyncIOScheduler
            from apscheduler.triggers.interval import IntervalTrigger
        except ImportError:
            logger.warning(
                "Scheduler: apscheduler not installed. "
                "Install with: pip install apscheduler>=3.10"
            )
            return

        self._scheduler = AsyncIOScheduler()

        # Job 1: Price snapshot collection
        self._scheduler.add_job(
            self.collect_price_snapshot,
            IntervalTrigger(minutes=scheduler_config.price_snapshot_interval_minutes),
            id="price_snapshot",
            name="Collect price snapshots",
            max_instances=1,
            misfire_grace_time=60,
        )

        # Job 2: Event pruning
        self._scheduler.add_job(
            self.prune_events,
            IntervalTrigger(minutes=scheduler_config.event_pruning_interval_minutes),
            id="event_pruning",
            name="Prune expired events",
            max_instances=1,
            misfire_grace_time=120,
        )

        # Job 3: Model persistence
        self._scheduler.add_job(
            self.persist_models,
            IntervalTrigger(minutes=scheduler_config.model_persistence_interval_minutes),
            id="model_persistence",
            name="Persist LightGBM models",
            max_instances=1,
            misfire_grace_time=300,
        )

        self._scheduler.start()
        logger.info(
            "Scheduler: started with %d jobs "
            "(price=%dm, prune=%dm, model=%dm)",
            3,
            scheduler_config.price_snapshot_interval_minutes,
            scheduler_config.event_pruning_interval_minutes,
            scheduler_config.model_persistence_interval_minutes,
        )

    def shutdown(self, wait: bool = False) -> None:
        """Shutdown the background scheduler.

        Args:
            wait: If True, wait for running jobs to complete before shutting down.
        """
        if self._scheduler is not None:
            logger.info("Scheduler: shutting down (wait=%s)", wait)
            self._scheduler.shutdown(wait=wait)
            self._scheduler = None
