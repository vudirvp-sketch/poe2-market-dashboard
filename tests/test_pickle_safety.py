"""
Tests for pickle safety of objects passed to ProcessPoolExecutor.

The main bug: DataSnapshot (or objects reachable from it) could hold
sqlite3.Connection references, causing "cannot pickle 'sqlite3.Connection'"
when ProcessPoolExecutor tries to serialize arguments for a subprocess.

Fix: FlipComputeBundle pre-extracts only picklable data from DataSnapshot.
DataSnapshot.__getstate__/__setstate__ guarantees only known fields are
serialized.
"""

from __future__ import annotations

import pickle
from datetime import datetime, timezone

import pytest

from backend.api.data_snapshot import DataSnapshot
from backend.api.routes_arbitrage import FlipComputeBundle
from backend.models.currency import (
    ExchangeRate,
    CurrencyInfo,
    PricePoint,
    CurrencyTier,
    LeaguePhase,
    PhaseInfo,
)


# ---------------------------------------------------------------------------
# Fixtures: sample data for pickling tests
# ---------------------------------------------------------------------------

def _make_sample_snapshot() -> DataSnapshot:
    """Create a DataSnapshot with sample data for pickling tests."""
    return DataSnapshot(
        exchange_rates={
            "exalted/chaos": ExchangeRate(
                currency_from="exalted",
                currency_to="chaos",
                raw_rate=10.0,
                volume_traded=5000,
                stock_value=50000.0,
                highest_stock=100,
                timestamp=datetime.now(timezone.utc),
            ),
        },
        currencies={
            "chaos": {"api_id": "Chaos", "text": "Chaos Orb", "current_price": 0.1},
        },
        currency_metadata=[
            CurrencyInfo(api_id="chaos", text="Chaos Orb", category_api_id="currency"),
        ],
        price_histories={
            "chaos": [
                PricePoint(timestamp=datetime.now(timezone.utc), price=0.1, volume=100),
                PricePoint(timestamp=datetime.now(timezone.utc), price=0.11, volume=150),
            ],
        },
        current_prices={"chaos": 0.1},
        prices_in_base={"exalted": 1.0, "chaos": 0.1},
        tiers={
            "exalted": CurrencyTier(
                api_id="exalted", tier=2, tier_label="Core",
                relative_price=1.0, tier_anchor="exalted",
            ),
        },
        fetched_at=datetime.now(timezone.utc),
        valid=True,
    )


def _make_sample_bundle() -> FlipComputeBundle:
    """Create a FlipComputeBundle with sample data for pickling tests."""
    snapshot = _make_sample_snapshot()
    return FlipComputeBundle(
        exchange_rates=dict(snapshot.exchange_rates),
        currencies=dict(snapshot.currencies),
        price_histories_raw={
            k: [(p.timestamp, p.price) for p in v]
            for k, v in snapshot.price_histories.items()
        },
        price_histories_prices={
            k: [p.price for p in v]
            for k, v in snapshot.price_histories.items()
        },
        prices_in_base=dict(snapshot.prices_in_base),
        current_prices=dict(snapshot.current_prices),
        tiers=dict(snapshot.tiers),
        base_currency="exalted",
        cache_ttl_seconds=300.0,
        fetched_at=snapshot.fetched_at,
        quantization_lot_sizes=[1, 5, 10, 50, 100],
        quantization_max_lot_search=10000,
    )


# ---------------------------------------------------------------------------
# Test: DataSnapshot pickle safety
# ---------------------------------------------------------------------------

class TestDataSnapshotPickle:
    """Verify DataSnapshot can be pickled and unpickled correctly."""

    def test_snapshot_pickle_roundtrip(self):
        """DataSnapshot should pickle and unpickle without errors."""
        snapshot = _make_sample_snapshot()
        data = pickle.dumps(snapshot)
        restored = pickle.loads(data)
        assert restored.valid is True
        assert len(restored.exchange_rates) == 1
        assert "chaos" in restored.currencies
        assert len(restored.price_histories["chaos"]) == 2
        assert restored.prices_in_base["chaos"] == 0.1

    def test_snapshot_getstate_strips_extras(self):
        """__getstate__ should only include known fields, ignoring extras."""
        snapshot = _make_sample_snapshot()
        # Simulate a runtime-attached attribute (e.g. accidental closure)
        object.__setattr__(snapshot, '_runtime_ref', object())  # unpicklable
        state = snapshot.__getstate__()
        assert '_runtime_ref' not in state
        assert 'exchange_rates' in state

    def test_snapshot_setstate_restores_all_fields(self):
        """__setstate__ should restore all fields from state dict."""
        snapshot = _make_sample_snapshot()
        state = snapshot.__getstate__()
        new_snapshot = DataSnapshot()
        new_snapshot.__setstate__(state)
        assert new_snapshot.valid is True
        assert len(new_snapshot.exchange_rates) == 1
        assert new_snapshot.prices_in_base["exalted"] == 1.0

    def test_snapshot_with_extras_pickle_succeeds(self):
        """Even with extra runtime attributes, pickling should succeed
        because __getstate__ filters them out."""
        snapshot = _make_sample_snapshot()
        # Attach an unpicklable attribute
        import sqlite3
        conn = sqlite3.connect(":memory:")
        object.__setattr__(snapshot, '_hidden_conn', conn)
        try:
            data = pickle.dumps(snapshot)
            restored = pickle.loads(data)
            assert restored.valid is True
            assert not hasattr(restored, '_hidden_conn')
        finally:
            conn.close()


# ---------------------------------------------------------------------------
# Test: FlipComputeBundle pickle safety
# ---------------------------------------------------------------------------

class TestFlipComputeBundlePickle:
    """Verify FlipComputeBundle is fully picklable."""

    def test_bundle_pickle_roundtrip(self):
        """FlipComputeBundle should pickle and unpickle without errors."""
        bundle = _make_sample_bundle()
        data = pickle.dumps(bundle)
        restored = pickle.loads(data)
        assert restored.base_currency == "exalted"
        assert len(restored.exchange_rates) == 1
        assert "chaos" in restored.price_histories_prices
        assert len(restored.price_histories_prices["chaos"]) == 2
        assert restored.cache_ttl_seconds == 300.0
        assert restored.quantization_lot_sizes == [1, 5, 10, 50, 100]

    def test_bundle_no_sqlite_connection(self):
        """FlipComputeBundle should never contain sqlite3.Connection."""
        import sqlite3
        bundle = _make_sample_bundle()
        data = pickle.dumps(bundle)
        # If this succeeds, no sqlite3.Connection is in the bundle
        assert data is not None

    def test_bundle_empty_histories(self):
        """FlipComputeBundle with empty histories should pickle."""
        bundle = FlipComputeBundle(
            exchange_rates={},
            currencies={},
            price_histories_raw={},
            price_histories_prices={},
            prices_in_base={"exalted": 1.0},
            current_prices={},
            tiers={},
            base_currency="exalted",
            cache_ttl_seconds=300.0,
            fetched_at=datetime.now(timezone.utc),
            quantization_lot_sizes=[1, 5, 10],
            quantization_max_lot_search=100,
        )
        data = pickle.dumps(bundle)
        restored = pickle.loads(data)
        assert len(restored.exchange_rates) == 0


# ---------------------------------------------------------------------------
# Test: Model pickle safety
# ---------------------------------------------------------------------------

class TestModelPickle:
    """Verify core domain models are picklable."""

    def test_exchange_rate_pickle(self):
        rate = ExchangeRate(
            currency_from="exalted",
            currency_to="chaos",
            raw_rate=10.0,
            volume_traded=5000,
            timestamp=datetime.now(timezone.utc),
        )
        data = pickle.dumps(rate)
        restored = pickle.loads(data)
        assert restored.currency_from == "exalted"
        assert restored.raw_rate == 10.0

    def test_price_point_pickle(self):
        pp = PricePoint(
            timestamp=datetime.now(timezone.utc),
            price=0.5,
            volume=100,
        )
        data = pickle.dumps(pp)
        restored = pickle.loads(data)
        assert restored.price == 0.5

    def test_currency_tier_pickle(self):
        ct = CurrencyTier(
            api_id="exalted",
            tier=2,
            tier_label="Core",
            relative_price=1.0,
            tier_anchor="exalted",
        )
        data = pickle.dumps(ct)
        restored = pickle.loads(data)
        assert restored.tier == 2

    def test_phase_info_pickle(self):
        pi = PhaseInfo(
            phase=LeaguePhase.EARLY,
            days_since_reference=5,
            reference_currency="exalted",
            recommended_strategy="Quick flips",
            min_spread_after_fees=0.15,
            max_hold_time="2 hours",
        )
        data = pickle.dumps(pi)
        restored = pickle.loads(data)
        assert restored.phase == LeaguePhase.EARLY
        assert restored.max_hold_time == "2 hours"
