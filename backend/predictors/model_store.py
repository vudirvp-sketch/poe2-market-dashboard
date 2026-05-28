"""
LightGBM Model Persistence — Save and Load Models to/from Disk.

Phase 2 (Spec Section 7.5): Persists trained LightGBM models to disk so
they survive server restarts. The ModelStore manages:

1. Saving trained models (median, lower quantile, upper quantile) as .txt files
2. Saving model metadata (training time, MAPE, feature config) as .json files
3. Loading models on startup to avoid retraining from scratch
4. Tracking which models are pending persistence

File layout:
    models/
    ├── {currency}_median.txt          — LightGBM Booster model file
    ├── {currency}_median_meta.json    — Training metadata
    ├── {currency}_lower.txt           — Lower quantile model
    ├── {currency}_lower_meta.json
    ├── {currency}_upper.txt           — Upper quantile model
    └── {currency}_upper_meta.json
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# Default model storage directory
_DEFAULT_BASE_PATH = Path(__file__).resolve().parent.parent.parent / "models"

# Model type suffixes matching LightGBMForecaster's three models
MODEL_TYPES = ("median", "lower", "upper")


class ModelStore:
    """Persist and load LightGBM models to/from disk.

    Thread safety: This class is designed for single-process use (FastAPI
    with uvicorn). For multi-worker deployments, use a shared storage
    backend instead of local files.

    Usage:
        store = ModelStore()

        # Save a trained model
        store.save_model("divine", "median", booster_obj, {
            "trained_at": "2025-06-01T12:00:00Z",
            "mape": 0.05,
            "n_samples": 500,
        })

        # Load a model
        model, meta = store.load_model("divine", "median")
        if model is not None:
            # Use the loaded model directly
            predictions = model.predict(X)
    """

    def __init__(self, base_path: str | Path | None = None):
        self._base_path = Path(base_path) if base_path else _DEFAULT_BASE_PATH
        os.makedirs(self._base_path, exist_ok=True)
        self._pending_saves: list[tuple[str, str, object, dict]] = []
        # Track in-memory models for persistence by the scheduler
        self._in_memory_models: dict[tuple[str, str], tuple[object, dict]] = {}

    @property
    def base_path(self) -> Path:
        """Return the base path where models are stored."""
        return self._base_path

    def save_model(
        self,
        currency: str,
        model_type: str,
        model,  # lgb.Booster or lgb.LGBMRegressor
        metadata: dict,
    ) -> str:
        """Save a LightGBM model and its metadata to disk.

        Args:
            currency: Currency API ID (e.g. "divine", "chaos")
            model_type: Model variant — "median", "lower", or "upper"
            model: Trained LightGBM model object (Booster or LGBMRegressor)
            metadata: Dict with training metadata (trained_at, mape, n_samples, etc.)

        Returns:
            Path to the saved model file.
        """
        safe_currency = _safe_filename(currency)
        model_filename = f"{safe_currency}_{model_type}.txt"
        meta_filename = f"{safe_currency}_{model_type}_meta.json"

        model_path = self._base_path / model_filename
        meta_path = self._base_path / meta_filename

        try:
            # Save model — handle both LGBMRegressor (sklearn API) and Booster
            if hasattr(model, 'booster_'):
                # LGBMRegressor — extract the underlying Booster
                model.booster_.save_model(str(model_path))
            elif hasattr(model, 'save_model'):
                # Direct Booster object
                model.save_model(str(model_path))
            else:
                logger.warning(
                    "Model for %s/%s has no save_model method, skipping save",
                    currency, model_type,
                )
                return ""

            # Save metadata
            meta_to_save = {
                **metadata,
                "currency": currency,
                "model_type": model_type,
                "saved_at": datetime.now(timezone.utc).isoformat(),
                "model_file": model_filename,
            }
            with open(meta_path, 'w', encoding='utf-8') as f:
                json.dump(meta_to_save, f, indent=2, default=str)

            # Track in memory
            self._in_memory_models[(currency, model_type)] = (model, metadata)

            logger.debug(
                "ModelStore: saved %s/%s to %s (MAPE: %s)",
                currency, model_type, model_path,
                metadata.get("mape", "N/A"),
            )
            return str(model_path)

        except Exception as e:
            logger.error("ModelStore: failed to save %s/%s: %s", currency, model_type, e)
            return ""

    def load_model(
        self, currency: str, model_type: str
    ) -> tuple[object | None, dict | None]:
        """Load a LightGBM model and its metadata from disk.

        Args:
            currency: Currency API ID
            model_type: Model variant — "median", "lower", or "upper"

        Returns:
            Tuple of (model, metadata). Both are None if the model file
            doesn't exist or loading fails.
        """
        safe_currency = _safe_filename(currency)
        model_filename = f"{safe_currency}_{model_type}.txt"
        meta_filename = f"{safe_currency}_{model_type}_meta.json"

        model_path = self._base_path / model_filename
        meta_path = self._base_path / meta_filename

        if not model_path.exists():
            return None, None

        try:
            import lightgbm as lgb

            model = lgb.Booster(model_file=str(model_path))

            metadata = None
            if meta_path.exists():
                with open(meta_path, 'r', encoding='utf-8') as f:
                    metadata = json.load(f)

            logger.debug(
                "ModelStore: loaded %s/%s from %s (trained: %s)",
                currency, model_type, model_path,
                metadata.get("trained_at", "unknown") if metadata else "unknown",
            )
            return model, metadata

        except ImportError:
            logger.warning("ModelStore: lightgbm not installed, cannot load model")
            return None, None
        except Exception as e:
            logger.error("ModelStore: failed to load %s/%s: %s", currency, model_type, e)
            return None, None

    def load_all_models_for_currency(
        self, currency: str
    ) -> dict[str, tuple[object | None, dict | None]]:
        """Load all model variants (median, lower, upper) for a currency.

        Args:
            currency: Currency API ID

        Returns:
            Dict mapping model_type to (model, metadata) tuples.
            Missing models are returned as (None, None).
        """
        result = {}
        for model_type in MODEL_TYPES:
            result[model_type] = self.load_model(currency, model_type)
        return result

    def delete_model(self, currency: str, model_type: str) -> bool:
        """Delete a model and its metadata from disk.

        Args:
            currency: Currency API ID
            model_type: Model variant

        Returns:
            True if the model was deleted, False if it didn't exist.
        """
        safe_currency = _safe_filename(currency)
        model_filename = f"{safe_currency}_{model_type}.txt"
        meta_filename = f"{safe_currency}_{model_type}_meta.json"

        model_path = self._base_path / model_filename
        meta_path = self._base_path / meta_filename

        deleted = False

        if model_path.exists():
            os.remove(model_path)
            deleted = True

        if meta_path.exists():
            os.remove(meta_path)
            deleted = True

        # Remove from in-memory tracking
        self._in_memory_models.pop((currency, model_type), None)

        if deleted:
            logger.debug("ModelStore: deleted %s/%s", currency, model_type)

        return deleted

    def delete_all_models_for_currency(self, currency: str) -> int:
        """Delete all model variants for a currency.

        Returns:
            Number of model types deleted.
        """
        count = 0
        for model_type in MODEL_TYPES:
            if self.delete_model(currency, model_type):
                count += 1
        return count

    def register_in_memory(
        self,
        currency: str,
        model_type: str,
        model: object,
        metadata: dict,
    ) -> None:
        """Register an in-memory model for later persistence by the scheduler.

        This is called by LightGBMForecaster.train() after training completes.
        The scheduler's persist_models() job will then save these to disk.

        Args:
            currency: Currency API ID
            model_type: Model variant — "median", "lower", or "upper"
            model: Trained LightGBM model
            metadata: Training metadata dict
        """
        self._in_memory_models[(currency, model_type)] = (model, metadata)

    def persist_pending(self) -> int:
        """Persist all registered in-memory models to disk.

        Called by the DataScheduler's model_persistence job.

        Returns:
            Number of models successfully persisted.
        """
        count = 0
        # Take a snapshot of pending items to avoid mutation during iteration
        items = list(self._in_memory_models.items())
        for (currency, model_type), (model, metadata) in items:
            path = self.save_model(currency, model_type, model, metadata)
            if path:
                count += 1
        if count > 0:
            logger.info("ModelStore: persisted %d pending models to disk", count)
        return count

    def list_saved_models(self) -> list[dict]:
        """List all saved models with their metadata.

        Returns:
            List of dicts with currency, model_type, trained_at, mape, etc.
        """
        results = []
        if not self._base_path.exists():
            return results

        for meta_file in sorted(self._base_path.glob("*_meta.json")):
            try:
                with open(meta_file, 'r', encoding='utf-8') as f:
                    meta = json.load(f)
                results.append({
                    "currency": meta.get("currency", "?"),
                    "model_type": meta.get("model_type", "?"),
                    "trained_at": meta.get("trained_at", "?"),
                    "saved_at": meta.get("saved_at", "?"),
                    "mape": meta.get("mape"),
                    "n_samples": meta.get("n_samples"),
                })
            except Exception:
                continue

        return results


def _safe_filename(name: str) -> str:
    """Convert a currency name to a safe filename component.

    Replaces characters that are problematic in filenames.
    """
    return name.replace("/", "_").replace("\\", "_").replace(" ", "_").replace(":", "_")


# ---------------------------------------------------------------------------
# Singleton accessor
# ---------------------------------------------------------------------------

_instance: ModelStore | None = None


def get_model_store(base_path: str | Path | None = None) -> ModelStore:
    """Return the global ModelStore instance (lazily created)."""
    global _instance
    if _instance is None:
        _instance = ModelStore(base_path)
    return _instance


def reset_model_store() -> None:
    """Reset the singleton. Primarily for testing."""
    global _instance
    _instance = None
