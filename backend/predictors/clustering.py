"""
Currency Clustering — KMeans-based classification of currencies into
stable / moderate / volatile_illiquid clusters.

Implements PoE2_Flipper_Canonical_Formulas.md §5:

Features (per currency, over 24h):
    volatility_24h          = std(log_returns_24h, ddof=1)
    price_change_rate_24h   = (price_now - price_24h_ago) / price_24h_ago
    liquidity_score_24h     = log1p(volume_24h) / log1p(max_volume_across_all)

Normalization: min-max to [0,1]; if all identical -> 0.5

Algorithm: KMeans with k=3, init='k-means++', n_init=10, random_state=42

Cluster label assignment (post-hoc, centroid-based):
    stable           = argmin(centroid[:, 0])  # lowest volatility
    volatile_illiquid = argmax(centroid[:, 0])  # highest volatility
    moderate          = remaining cluster

Tiebreaker (if two centroids have volatility difference < 0.1):
    lower liquidity -> volatile_illiquid
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

import numpy as np
from sklearn.cluster import KMeans

from backend.config import AppConfig, get_settings
from backend.models.currency import ClusterLabel

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class CurrencyFeatures:
    """Computed features for a single currency, used as clustering input."""
    currency: str
    volatility_24h: float = 0.0
    price_change_rate_24h: float = 0.0
    liquidity_score_24h: float = 0.0


@dataclass
class ClusterResult:
    """Output of the clustering pipeline for a single currency."""
    currency: str
    cluster: ClusterLabel
    volatility_24h: float = 0.0
    price_change_rate_24h: float = 0.0
    liquidity_score_24h: float = 0.0
    normalized_features: list[float] = field(default_factory=list)
    raw_cluster_id: int = -1


@dataclass
class ClusteringOutput:
    """Full output of a clustering run, including metadata."""
    clusters: list[ClusterResult]
    centroids: np.ndarray  # shape (3, 3) — normalized feature space
    label_mapping: dict[int, ClusterLabel]  # raw cluster id -> semantic label
    fitted_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    n_currencies: int = 0


# ---------------------------------------------------------------------------
# Feature computation
# ---------------------------------------------------------------------------

def compute_clustering_features(
    price_histories: dict[str, list[float]],
    volumes_24h: dict[str, float],
    prices_now: dict[str, float],
    prices_24h_ago: dict[str, float],
) -> list[CurrencyFeatures]:
    """Compute the three clustering features for each currency.

    Implements §5.1 of the Canonical Formulas.

    Args:
        price_histories: currency -> list of prices (at least 2 for log-returns).
            If fewer than 2 prices, volatility defaults to 0.
        volumes_24h: currency -> 24h trading volume.
        prices_now: currency -> current price.
        prices_24h_ago: currency -> price 24 hours ago.

    Returns:
        List of CurrencyFeatures, one per currency present in all input dicts.
    """
    # Collect currencies that have data in at least price_histories and volumes
    currencies = sorted(
        set(price_histories.keys()) & set(volumes_24h.keys())
    )

    if not currencies:
        return []

    max_volume = max(volumes_24h.get(c, 0) for c in currencies) if currencies else 1.0

    features: list[CurrencyFeatures] = []
    for curr in currencies:
        prices = price_histories.get(curr, [])
        volume = volumes_24h.get(curr, 0.0)
        price_now = prices_now.get(curr, 0.0)
        price_prev = prices_24h_ago.get(curr, 0.0)

        # volatility_24h = std(log_returns, ddof=1)
        # Filter out non-positive prices to avoid log(0) or log(negative)
        positive_prices = [p for p in prices if p > 0]
        if len(positive_prices) >= 2:
            log_returns = np.diff(np.log(positive_prices))
            volatility = float(np.std(log_returns, ddof=1)) if len(log_returns) > 1 else 0.0
        else:
            volatility = 0.0

        # price_change_rate_24h = (price_now - price_24h_ago) / price_24h_ago
        if price_prev > 0:
            price_change_rate = (price_now - price_prev) / price_prev
        else:
            price_change_rate = 0.0

        # liquidity_score_24h = log1p(volume_24h) / log1p(max_volume)
        if max_volume > 0:
            liquidity_score = np.log1p(volume) / np.log1p(max_volume)
        else:
            liquidity_score = 0.0

        features.append(CurrencyFeatures(
            currency=curr,
            volatility_24h=volatility,
            price_change_rate_24h=price_change_rate,
            liquidity_score_24h=float(liquidity_score),
        ))

    return features


# ---------------------------------------------------------------------------
# Normalization
# ---------------------------------------------------------------------------

def normalize_features(
    features: list[CurrencyFeatures],
) -> tuple[np.ndarray, list[list[float]]]:
    """Min-max normalize the three clustering features to [0, 1].

    Implements §5.2 of the Canonical Formulas.

    If all currencies have identical values on a feature (feature_max == feature_min),
    set feature_normalized = 0.5 for all.

    Args:
        features: List of CurrencyFeatures.

    Returns:
        Tuple of:
            - feature_matrix: np.ndarray of shape (N, 3) with normalized values
            - normalized_lists: same data as list of lists (for serialization)
    """
    if not features:
        return np.array([]).reshape(0, 3), []

    n = len(features)
    raw = np.zeros((n, 3))
    for i, f in enumerate(features):
        raw[i, 0] = f.volatility_24h
        raw[i, 1] = f.price_change_rate_24h
        raw[i, 2] = f.liquidity_score_24h

    normalized = np.zeros((n, 3))
    for col in range(3):
        col_min = raw[:, col].min()
        col_max = raw[:, col].max()
        if col_max == col_min:
            # All identical -> 0.5
            normalized[:, col] = 0.5
        else:
            normalized[:, col] = (raw[:, col] - col_min) / (col_max - col_min)

    normalized_lists = normalized.tolist()
    return normalized, normalized_lists


# ---------------------------------------------------------------------------
# Cluster label assignment
# ---------------------------------------------------------------------------

def assign_cluster_labels(
    centroids: np.ndarray,
) -> dict[int, ClusterLabel]:
    """Assign semantic labels to cluster IDs based on centroid inspection.

    Implements §5.4 of the Canonical Formulas.

    Centroids shape: (3, 3) where columns are:
        [0] volatility_norm, [1] price_change_norm, [2] liquidity_norm

    Assignment logic:
        stable            = argmin(centroid[:, 0])  # lowest volatility
        volatile_illiquid = argmax(centroid[:, 0])  # highest volatility
        moderate          = remaining cluster

    Tiebreaker: if two clusters have volatility centroids within 0.1,
    the one with lower liquidity gets "volatile_illiquid".

    Args:
        centroids: np.ndarray of shape (k, 3) from KMeans.

    Returns:
        Dict mapping raw cluster id (int) to ClusterLabel.
    """
    k = centroids.shape[0]
    assert k == 3, f"Expected 3 clusters, got {k}"

    # Sort clusters by volatility (column 0) ascending
    vol_centroids = centroids[:, 0]
    sorted_by_vol = np.argsort(vol_centroids)  # [lowest, middle, highest]

    stable_id = int(sorted_by_vol[0])
    volatile_id = int(sorted_by_vol[2])
    moderate_id = int(sorted_by_vol[1])

    # Tiebreaker: if stable and moderate have nearly equal volatility (diff < 0.1)
    # the one with lower liquidity should be moderate (and the other stable)
    if abs(vol_centroids[stable_id] - vol_centroids[moderate_id]) < 0.1:
        if centroids[moderate_id, 2] < centroids[stable_id, 2]:
            stable_id, moderate_id = moderate_id, stable_id

    # Tiebreaker: if moderate and volatile have nearly equal volatility (diff < 0.1)
    # the one with lower liquidity should be volatile_illiquid
    if abs(vol_centroids[moderate_id] - vol_centroids[volatile_id]) < 0.1:
        if centroids[moderate_id, 2] < centroids[volatile_id, 2]:
            moderate_id, volatile_id = volatile_id, moderate_id

    return {
        stable_id: ClusterLabel.STABLE,
        moderate_id: ClusterLabel.MODERATE,
        volatile_id: ClusterLabel.VOLATILE_ILLIQUID,
    }


# ---------------------------------------------------------------------------
# CurrencyClusterer — orchestrates the full pipeline
# ---------------------------------------------------------------------------

class CurrencyClusterer:
    """Orchestrates the clustering pipeline: features -> normalize -> KMeans -> label.

    Usage:
        clusterer = CurrencyClusterer()
        output = clusterer.fit(price_histories, volumes_24h, prices_now, prices_24h_ago)
        for result in output.clusters:
            print(result.currency, result.cluster)
    """

    def __init__(self, config: AppConfig | None = None):
        self._config = config or get_settings()
        self._n_clusters = self._config.clustering.n_clusters
        self._last_output: ClusteringOutput | None = None

    @property
    def last_output(self) -> ClusteringOutput | None:
        """Return the most recent clustering result, or None if not yet fit."""
        return self._last_output

    def fit(
        self,
        price_histories: dict[str, list[float]],
        volumes_24h: dict[str, float],
        prices_now: dict[str, float],
        prices_24h_ago: dict[str, float],
    ) -> ClusteringOutput:
        """Run the full clustering pipeline.

        Args:
            price_histories: currency -> list of recent prices (for volatility).
            volumes_24h: currency -> 24h trading volume.
            prices_now: currency -> current price.
            prices_24h_ago: currency -> price 24 hours ago.

        Returns:
            ClusteringOutput with per-currency cluster assignments.
        """
        # Step 1: Compute features
        features = compute_clustering_features(
            price_histories, volumes_24h, prices_now, prices_24h_ago,
        )

        if not features:
            logger.warning("No features computed; returning empty clustering output")
            return ClusteringOutput(
                clusters=[],
                centroids=np.zeros((3, 3)),
                label_mapping={0: ClusterLabel.MODERATE, 1: ClusterLabel.MODERATE, 2: ClusterLabel.MODERATE},
                n_currencies=0,
            )

        # Step 2: Normalize features
        feature_matrix, normalized_lists = normalize_features(features)

        n_currencies = feature_matrix.shape[0]

        # Edge case: fewer currencies than clusters
        if n_currencies < self._n_clusters:
            logger.warning(
                "Only %d currencies, fewer than n_clusters=%d. "
                "Assigning all to MODERATE.",
                n_currencies, self._n_clusters,
            )
            clusters = []
            for i, f in enumerate(features):
                clusters.append(ClusterResult(
                    currency=f.currency,
                    cluster=ClusterLabel.MODERATE,
                    volatility_24h=f.volatility_24h,
                    price_change_rate_24h=f.price_change_rate_24h,
                    liquidity_score_24h=f.liquidity_score_24h,
                    normalized_features=normalized_lists[i] if i < len(normalized_lists) else [0.5, 0.5, 0.5],
                    raw_cluster_id=0,
                ))
            return ClusteringOutput(
                clusters=clusters,
                centroids=np.zeros((self._n_clusters, 3)),
                label_mapping={0: ClusterLabel.MODERATE},
                n_currencies=n_currencies,
            )

        # Step 3: KMeans
        # §5.3: KMeans(n_clusters=3, init='k-means++', n_init=10, random_state=42)
        kmeans = KMeans(
            n_clusters=self._n_clusters,
            init='k-means++',
            n_init=10,
            random_state=42,
        )
        raw_labels = kmeans.fit_predict(feature_matrix)
        centroids = kmeans.cluster_centers_

        # Step 4: Assign semantic labels
        label_mapping = assign_cluster_labels(centroids)

        # Step 5: Build output
        clusters = []
        for i, f in enumerate(features):
            raw_id = int(raw_labels[i])
            clusters.append(ClusterResult(
                currency=f.currency,
                cluster=label_mapping.get(raw_id, ClusterLabel.MODERATE),
                volatility_24h=f.volatility_24h,
                price_change_rate_24h=f.price_change_rate_24h,
                liquidity_score_24h=f.liquidity_score_24h,
                normalized_features=normalized_lists[i] if i < len(normalized_lists) else [0.5, 0.5, 0.5],
                raw_cluster_id=raw_id,
            ))

        output = ClusteringOutput(
            clusters=clusters,
            centroids=centroids,
            label_mapping=label_mapping,
            n_currencies=n_currencies,
        )
        self._last_output = output
        return output

    def get_cluster_for_currency(self, currency: str) -> ClusterLabel:
        """Return the cluster label for a specific currency from the last fit.

        Returns ClusterLabel.MODERATE if no clustering has been done
        or the currency is not found.
        """
        if self._last_output is None:
            return ClusterLabel.MODERATE
        for c in self._last_output.clusters:
            if c.currency == currency:
                return c.cluster
        return ClusterLabel.MODERATE


# ---------------------------------------------------------------------------
# Convenience function
# ---------------------------------------------------------------------------

def cluster_currencies(
    price_histories: dict[str, list[float]],
    volumes_24h: dict[str, float],
    prices_now: dict[str, float],
    prices_24h_ago: dict[str, float],
    config: AppConfig | None = None,
) -> dict[str, ClusterLabel]:
    """One-shot clustering: compute features, normalize, run KMeans, assign labels.

    This is the primary API for other modules that need cluster assignments.

    Args:
        price_histories: currency -> list of recent prices.
        volumes_24h: currency -> 24h trading volume.
        prices_now: currency -> current price.
        prices_24h_ago: currency -> price 24h ago.
        config: Application configuration.

    Returns:
        Dict mapping currency -> ClusterLabel.
    """
    clusterer = CurrencyClusterer(config)
    output = clusterer.fit(price_histories, volumes_24h, prices_now, prices_24h_ago)
    return {c.currency: c.cluster for c in output.clusters}
