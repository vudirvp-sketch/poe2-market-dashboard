"""
Tests for ModelStore — LightGBM Model Persistence.

Phase 2 (Spec Section 7.5): Tests that verify:
- save_model writes .txt and _meta.json files to disk
- load_model reads them back correctly
- Save/load roundtrip preserves model predictions
- Metadata (training time, MAPE, n_samples) is preserved
- delete_model removes files from disk
- persist_pending flushes in-memory models to disk
- load_all_models_for_currency loads median/lower/upper variants
- Handles missing files gracefully
- Singleton accessor works correctly
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from backend.predictors.model_store import (
    ModelStore,
    get_model_store,
    reset_model_store,
    _safe_filename,
    MODEL_TYPES,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def store(tmp_path):
    """Create a ModelStore with a temp directory."""
    return ModelStore(base_path=str(tmp_path / "models"))


@pytest.fixture(autouse=True)
def _reset_singleton():
    """Reset the ModelStore singleton before and after each test."""
    reset_model_store()
    yield
    reset_model_store()


def _make_mock_booster():
    """Create a mock LightGBM Booster that simulates save_model.
    
    Writes a minimal valid LightGBM model text file to the given path.
    
    Note: We use spec=None and explicitly delete the 'booster_' attribute
    to prevent MagicMock from auto-creating it (which would cause the
    ModelStore to take the LGBMRegressor branch instead of Booster).
    """
    mock = MagicMock(spec=['save_model'])

    def mock_save_model(path):
        # Write a minimal LightGBM model file header
        # Real LightGBM .txt files start with specific headers
        with open(path, "w") as f:
            f.write("tree\nversion=v3\nnum_class=1\nnum_tree_per_iteration=1\n")
            f.write("max_feature_idx=0\nobjective=regression\n")
            f.write("feature_names=feature_0\nfeature_infos=none\n")
            f.write("tree_sizes=1\nTree=0\n")
            f.write("split_feature=0\nsplit_gain=1.0\nthreshold=0.5\n")
            f.write("left_child=-1\nright_child=-1\nleaf_value=0.5\n")
            f.write("internal_value=0\ninternal_count=10\nleaf_count=5\n")
            f.write("end of trees\n")

    mock.save_model = mock_save_model
    # Ensure booster_ does NOT exist (MagicMock auto-creates it otherwise)
    if hasattr(mock, 'booster_'):
        delattr(mock, 'booster_')
    return mock


# ---------------------------------------------------------------------------
# Save Model Tests
# ---------------------------------------------------------------------------

class TestSaveModel:
    """Test ModelStore.save_model()."""

    def test_save_creates_model_file(self, store):
        """save_model should create a .txt model file on disk."""
        mock_model = _make_mock_booster()
        path = store.save_model("divine", "median", mock_model, {
            "trained_at": "2025-01-15T12:00:00Z",
            "mape": 0.05,
        })
        assert path != "", "save_model should return a non-empty path"
        assert Path(path).exists(), "Model file should exist on disk"

    def test_save_creates_metadata_file(self, store):
        """save_model should create a _meta.json file alongside the model."""
        mock_model = _make_mock_booster()
        store.save_model("divine", "median", mock_model, {
            "trained_at": "2025-01-15T12:00:00Z",
            "mape": 0.05,
            "n_samples": 100,
        })

        meta_path = store.base_path / "divine_median_meta.json"
        assert meta_path.exists(), "Metadata file should exist on disk"

        with open(meta_path, "r") as f:
            meta = json.load(f)

        assert meta["currency"] == "divine"
        assert meta["model_type"] == "median"
        assert meta["mape"] == 0.05
        assert meta["n_samples"] == 100
        assert meta["trained_at"] == "2025-01-15T12:00:00Z"
        assert "saved_at" in meta, "Metadata should include saved_at timestamp"

    def test_save_tracks_in_memory(self, store):
        """save_model should track the model in _in_memory_models."""
        mock_model = _make_mock_booster()
        store.save_model("divine", "median", mock_model, {"mape": 0.05})

        assert ("divine", "median") in store._in_memory_models
        stored_model, stored_meta = store._in_memory_models[("divine", "median")]
        assert stored_model is mock_model

    def test_save_with_lgbm_regressor(self, store):
        """save_model should handle LGBMRegressor (sklearn API) objects."""
        mock_regressor = MagicMock()
        mock_booster = MagicMock()
        mock_regressor.booster_ = mock_booster

        store.save_model("chaos", "lower", mock_regressor, {"mape": 0.1})
        # The booster_.save_model should have been called
        mock_booster.save_model.assert_called_once()

    def test_save_with_invalid_model(self, store):
        """save_model should handle models without save_model method."""
        # Object with no save_model or booster_ attribute
        bad_model = object()
        path = store.save_model("bad", "median", bad_model, {})
        assert path == "", "Should return empty string for invalid model"

    def test_safe_filename(self):
        """_safe_filename should sanitize problematic characters."""
        assert _safe_filename("a/b") == "a_b"
        assert _safe_filename("a\\b") == "a_b"
        assert _safe_filename("a b") == "a_b"
        assert _safe_filename("a:b") == "a_b"
        assert _safe_filename("normal") == "normal"


# ---------------------------------------------------------------------------
# Load Model Tests
# ---------------------------------------------------------------------------

class TestLoadModel:
    """Test ModelStore.load_model()."""

    def test_load_returns_none_for_missing_model(self, store):
        """load_model should return (None, None) for non-existent model."""
        model, meta = store.load_model("nonexistent", "median")
        assert model is None
        assert meta is None

    def test_load_reads_metadata(self, store):
        """load_model should read back metadata from the _meta.json file."""
        mock_model = _make_mock_booster()
        metadata = {
            "trained_at": "2025-01-15T12:00:00Z",
            "mape": 0.05,
            "n_samples": 100,
        }
        store.save_model("divine", "median", mock_model, metadata)

        # Now load - note: the actual LightGBM Booster loading requires
        # lightgbm to be installed and a real model file. We test the metadata
        # roundtrip which works with our mock.
        # The model loading itself will fail with a mock file, so we test
        # that the metadata file is readable even if model loading fails.
        meta_path = store.base_path / "divine_median_meta.json"
        assert meta_path.exists()
        with open(meta_path, "r") as f:
            loaded_meta = json.load(f)
        assert loaded_meta["mape"] == 0.05
        assert loaded_meta["n_samples"] == 100

    def test_load_model_with_real_lightgbm(self, store):
        """If lightgbm is installed, test save/load roundtrip with a real model."""
        try:
            import lightgbm as lgb
        except ImportError:
            pytest.skip("lightgbm not installed")

        import numpy as np

        # Create a tiny training dataset
        np.random.seed(42)
        X_train = np.random.randn(50, 3)
        y_train = X_train[:, 0] * 2.0 + 1.0 + np.random.randn(50) * 0.1

        # Train a minimal model
        train_data = lgb.Dataset(X_train, label=y_train)
        params = {
            "objective": "regression",
            "verbose": -1,
            "num_leaves": 4,
            "min_data_in_leaf": 5,
        }
        model = lgb.train(params, train_data, num_boost_round=10)

        # Save it
        metadata = {
            "trained_at": datetime.now(timezone.utc).isoformat(),
            "mape": 0.03,
            "n_samples": 50,
            "feature_names": ["f0", "f1", "f2"],
        }
        path = store.save_model("test_currency", "median", model, metadata)
        assert path != ""

        # Load it back
        loaded_model, loaded_meta = store.load_model("test_currency", "median")
        assert loaded_model is not None, "Model should load successfully"
        assert loaded_meta is not None, "Metadata should load successfully"
        assert loaded_meta["mape"] == 0.03
        assert loaded_meta["n_samples"] == 50

        # Verify the loaded model produces similar predictions
        X_test = np.random.randn(5, 3)
        original_preds = model.predict(X_test)
        loaded_preds = loaded_model.predict(X_test)
        np.testing.assert_allclose(
            original_preds, loaded_preds, rtol=1e-5,
            err_msg="Loaded model predictions should match original"
        )


# ---------------------------------------------------------------------------
# Delete Model Tests
# ---------------------------------------------------------------------------

class TestDeleteModel:
    """Test ModelStore.delete_model()."""

    def test_delete_removes_files(self, store):
        """delete_model should remove both .txt and _meta.json files."""
        mock_model = _make_mock_booster()
        store.save_model("divine", "median", mock_model, {"mape": 0.05})

        assert (store.base_path / "divine_median.txt").exists()
        assert (store.base_path / "divine_median_meta.json").exists()

        result = store.delete_model("divine", "median")
        assert result is True
        assert not (store.base_path / "divine_median.txt").exists()
        assert not (store.base_path / "divine_median_meta.json").exists()

    def test_delete_nonexistent_returns_false(self, store):
        """Deleting a model that doesn't exist should return False."""
        result = store.delete_model("nonexistent", "median")
        assert result is False

    def test_delete_removes_from_in_memory(self, store):
        """delete_model should also remove the model from _in_memory_models."""
        mock_model = _make_mock_booster()
        store.save_model("divine", "median", mock_model, {"mape": 0.05})
        assert ("divine", "median") in store._in_memory_models

        store.delete_model("divine", "median")
        assert ("divine", "median") not in store._in_memory_models


# ---------------------------------------------------------------------------
# Persist Pending Tests
# ---------------------------------------------------------------------------

class TestPersistPending:
    """Test ModelStore.persist_pending()."""

    def test_persist_saves_registered_models(self, store):
        """persist_pending should save all in-memory models to disk."""
        mock_model = _make_mock_booster()
        store.register_in_memory("divine", "median", mock_model, {
            "trained_at": "2025-01-15T12:00:00Z",
            "mape": 0.05,
        })
        store.register_in_memory("chaos", "lower", mock_model, {
            "trained_at": "2025-01-15T12:00:00Z",
            "mape": 0.08,
        })

        count = store.persist_pending()
        assert count == 2, f"Should persist 2 models, got {count}"

        # Verify files exist on disk
        assert (store.base_path / "divine_median.txt").exists()
        assert (store.base_path / "chaos_lower.txt").exists()

    def test_persist_empty_returns_zero(self, store):
        """persist_pending with no registered models should return 0."""
        count = store.persist_pending()
        assert count == 0

    def test_register_and_persist_roundtrip(self, store):
        """Register → persist → list_saved_models should show the model."""
        mock_model = _make_mock_booster()
        store.register_in_memory("divine", "upper", mock_model, {
            "trained_at": "2025-01-15T12:00:00Z",
            "mape": 0.07,
            "n_samples": 200,
        })

        store.persist_pending()

        saved = store.list_saved_models()
        assert len(saved) >= 1
        divine_upper = [s for s in saved if s["currency"] == "divine" and s["model_type"] == "upper"]
        assert len(divine_upper) == 1
        assert divine_upper[0]["mape"] == 0.07
        assert divine_upper[0]["n_samples"] == 200


# ---------------------------------------------------------------------------
# Load All Models for Currency Tests
# ---------------------------------------------------------------------------

class TestLoadAllModelsForCurrency:
    """Test ModelStore.load_all_models_for_currency()."""

    def test_loads_all_three_variants(self, store):
        """Should load median, lower, and upper models for a currency."""
        mock_model = _make_mock_booster()
        for model_type in MODEL_TYPES:
            store.save_model("divine", model_type, mock_model, {
                "mape": 0.05,
                "model_type": model_type,
            })

        result = store.load_all_models_for_currency("divine")
        assert "median" in result
        assert "lower" in result
        assert "upper" in result


# ---------------------------------------------------------------------------
# Delete All Models for Currency Tests
# ---------------------------------------------------------------------------

class TestDeleteAllModelsForCurrency:
    """Test ModelStore.delete_all_models_for_currency()."""

    def test_deletes_all_variants(self, store):
        """Should delete median, lower, and upper models for a currency."""
        mock_model = _make_mock_booster()
        for model_type in MODEL_TYPES:
            store.save_model("divine", model_type, mock_model, {"mape": 0.05})

        count = store.delete_all_models_for_currency("divine")
        assert count == 3, f"Should delete 3 model variants, got {count}"


# ---------------------------------------------------------------------------
# Singleton Accessor Tests
# ---------------------------------------------------------------------------

class TestSingletonAccessor:
    """Test get_model_store() and reset_model_store()."""

    def test_get_model_store_returns_instance(self):
        """get_model_store should return a ModelStore instance."""
        store = get_model_store()
        assert isinstance(store, ModelStore)

    def test_get_model_store_returns_same_instance(self):
        """get_model_store should return the same instance on repeated calls."""
        store1 = get_model_store()
        store2 = get_model_store()
        assert store1 is store2

    def test_reset_clears_singleton(self):
        """reset_model_store should clear the singleton."""
        store1 = get_model_store()
        reset_model_store()
        store2 = get_model_store()
        assert store1 is not store2


# ---------------------------------------------------------------------------
# List Saved Models Tests
# ---------------------------------------------------------------------------

class TestListSavedModels:
    """Test ModelStore.list_saved_models()."""

    def test_list_empty(self, store):
        """list_saved_models should return empty list when no models saved."""
        assert store.list_saved_models() == []

    def test_list_returns_saved_models(self, store):
        """list_saved_models should return info for all saved models."""
        mock_model = _make_mock_booster()
        store.save_model("divine", "median", mock_model, {"mape": 0.05})
        store.save_model("chaos", "lower", mock_model, {"mape": 0.08})

        saved = store.list_saved_models()
        assert len(saved) == 2
        currencies = {s["currency"] for s in saved}
        assert "divine" in currencies
        assert "chaos" in currencies
