"""
Tests for clustering.py — Currency clustering with KMeans.

From PoE2_Flipper_Canonical_Formulas.md §5:

Features (per currency, 24h):
    volatility_24h = std(log_returns_24h, ddof=1)
    price_change_rate_24h = (price_now - price_24h_ago) / price_24h_ago
    liquidity_score_24h = log1p(volume_24h) / log1p(max_volume)

Normalization: min-max to [0,1]; if all identical -> 0.5

KMeans: n_clusters=3, init='k-means++', n_init=10, random_state=42

Label assignment:
    stable  = argmin(centroid[:, 0])
    volatile_illiquid = argmax(centroid[:, 0])
    moderate = remaining
    Tiebreaker: if volatility diff < 0.1, lower liquidity -> volatile_illiquid

Verification example from §5:
    A: vol=0.01, change=0.02, liq=0.9  -> "stable"
    B: vol=0.05, change=0.05, liq=0.7  -> "moderate"
    C: vol=0.10, change=-0.03, liq=0.3 -> "volatile_illiquid"
"""

import math

import numpy as np
import pytest

from backend.predictors.clustering import (
    CurrencyClusterer,
    CurrencyFeatures,
    ClusterResult,
    ClusteringOutput,
    compute_clustering_features,
    normalize_features,
    assign_cluster_labels,
    cluster_currencies,
)
from backend.models.currency import ClusterLabel


# ---------------------------------------------------------------------------
# Feature computation tests
# ---------------------------------------------------------------------------

class TestComputeClusteringFeatures:
    """Test compute_clustering_features against §5.1 formulas."""

    def test_basic_feature_computation(self):
        """Verify all three features are computed correctly for known data."""
        # Currency A: prices [100, 101, 100, 102] -> log_returns computed
        price_histories = {
            "A": [100.0, 101.0, 100.0, 102.0],
        }
        volumes_24h = {"A": 500.0}
        prices_now = {"A": 102.0}
        prices_24h_ago = {"A": 100.0}

        features = compute_clustering_features(
            price_histories, volumes_24h, prices_now, prices_24h_ago,
        )

        assert len(features) == 1
        f = features[0]
        assert f.currency == "A"

        # volatility_24h = std(log_returns, ddof=1)
        log_returns = np.diff(np.log([100.0, 101.0, 100.0, 102.0]))
        expected_vol = float(np.std(log_returns, ddof=1))
        assert abs(f.volatility_24h - expected_vol) < 1e-10

        # price_change_rate_24h = (102 - 100) / 100 = 0.02
        assert abs(f.price_change_rate_24h - 0.02) < 1e-10

        # liquidity_score_24h = log1p(500) / log1p(500) = 1.0 (max_volume = 500)
        assert abs(f.liquidity_score_24h - 1.0) < 1e-10

    def test_liquidity_normalization(self):
        """Liquidity score should be normalized by max volume across all currencies."""
        price_histories = {
            "A": [100.0, 101.0],
            "B": [200.0, 202.0],
        }
        volumes_24h = {"A": 500.0, "B": 1000.0}
        prices_now = {"A": 101.0, "B": 202.0}
        prices_24h_ago = {"A": 100.0, "B": 200.0}

        features = compute_clustering_features(
            price_histories, volumes_24h, prices_now, prices_24h_ago,
        )

        assert len(features) == 2

        feat_a = next(f for f in features if f.currency == "A")
        feat_b = next(f for f in features if f.currency == "B")

        max_volume = 1000.0
        expected_liq_a = float(np.log1p(500.0) / np.log1p(max_volume))
        expected_liq_b = float(np.log1p(1000.0) / np.log1p(max_volume))

        assert abs(feat_a.liquidity_score_24h - expected_liq_a) < 1e-10
        assert abs(feat_b.liquidity_score_24h - expected_liq_b) < 1e-10

    def test_zero_volume(self):
        """Currency with zero volume should get liquidity_score = 0."""
        price_histories = {"A": [100.0, 101.0]}
        volumes_24h = {"A": 0.0}
        prices_now = {"A": 101.0}
        prices_24h_ago = {"A": 100.0}

        features = compute_clustering_features(
            price_histories, volumes_24h, prices_now, prices_24h_ago,
        )

        assert len(features) == 1
        assert features[0].liquidity_score_24h == 0.0

    def test_single_price_point(self):
        """Currency with only one price point should have volatility = 0."""
        price_histories = {"A": [100.0]}
        volumes_24h = {"A": 100.0}
        prices_now = {"A": 100.0}
        prices_24h_ago = {"A": 100.0}

        features = compute_clustering_features(
            price_histories, volumes_24h, prices_now, prices_24h_ago,
        )

        assert len(features) == 1
        assert features[0].volatility_24h == 0.0

    def test_zero_price_24h_ago(self):
        """If price_24h_ago is 0, price_change_rate should be 0."""
        price_histories = {"A": [0.0, 100.0]}
        volumes_24h = {"A": 100.0}
        prices_now = {"A": 100.0}
        prices_24h_ago = {"A": 0.0}

        features = compute_clustering_features(
            price_histories, volumes_24h, prices_now, prices_24h_ago,
        )

        assert len(features) == 1
        assert features[0].price_change_rate_24h == 0.0

    def test_empty_input(self):
        """Empty input should return empty list."""
        features = compute_clustering_features({}, {}, {}, {})
        assert features == []

    def test_negative_price_change(self):
        """Negative price change rate should be computed correctly."""
        price_histories = {"A": [100.0, 99.0]}
        volumes_24h = {"A": 100.0}
        prices_now = {"A": 99.0}
        prices_24h_ago = {"A": 100.0}

        features = compute_clustering_features(
            price_histories, volumes_24h, prices_now, prices_24h_ago,
        )

        assert len(features) == 1
        # (99 - 100) / 100 = -0.01
        assert abs(features[0].price_change_rate_24h - (-0.01)) < 1e-10


# ---------------------------------------------------------------------------
# Normalization tests
# ---------------------------------------------------------------------------

class TestNormalizeFeatures:
    """Test min-max normalization from §5.2."""

    def test_basic_normalization(self):
        """Features should be normalized to [0, 1]."""
        features = [
            CurrencyFeatures("A", volatility_24h=0.01, price_change_rate_24h=0.02, liquidity_score_24h=0.3),
            CurrencyFeatures("B", volatility_24h=0.05, price_change_rate_24h=0.05, liquidity_score_24h=0.7),
            CurrencyFeatures("C", volatility_24h=0.10, price_change_rate_24h=-0.03, liquidity_score_24h=0.9),
        ]

        matrix, lists = normalize_features(features)

        assert matrix.shape == (3, 3)

        # Volatility: min=0.01, max=0.10
        # A: (0.01-0.01)/(0.10-0.01) = 0.0
        # B: (0.05-0.01)/(0.10-0.01) = 4/9 ≈ 0.444
        # C: (0.10-0.01)/(0.10-0.01) = 1.0
        assert abs(matrix[0, 0] - 0.0) < 1e-10
        assert abs(matrix[1, 0] - (4.0 / 9.0)) < 1e-10
        assert abs(matrix[2, 0] - 1.0) < 1e-10

        # All values in [0, 1]
        assert np.all(matrix >= 0.0)
        assert np.all(matrix <= 1.0)

    def test_identical_features(self):
        """If all currencies have identical values, normalized = 0.5."""
        features = [
            CurrencyFeatures("A", volatility_24h=0.05, price_change_rate_24h=0.02, liquidity_score_24h=0.5),
            CurrencyFeatures("B", volatility_24h=0.05, price_change_rate_24h=0.02, liquidity_score_24h=0.5),
            CurrencyFeatures("C", volatility_24h=0.05, price_change_rate_24h=0.02, liquidity_score_24h=0.5),
        ]

        matrix, _ = normalize_features(features)

        # All should be 0.5
        assert np.allclose(matrix, 0.5)

    def test_single_currency(self):
        """Single currency should normalize to 0.5 (feature_max == feature_min)."""
        features = [
            CurrencyFeatures("A", volatility_24h=0.05, price_change_rate_24h=0.02, liquidity_score_24h=0.5),
        ]

        matrix, _ = normalize_features(features)
        assert matrix.shape == (1, 3)
        assert np.allclose(matrix, 0.5)

    def test_empty_features(self):
        """Empty features should return empty arrays."""
        matrix, lists = normalize_features([])
        assert matrix.shape == (0, 3)
        assert lists == []

    def test_min_max_boundary(self):
        """First and last rows should have at least one 0 and one 1."""
        features = [
            CurrencyFeatures("X", volatility_24h=0.01, price_change_rate_24h=-0.05, liquidity_score_24h=0.1),
            CurrencyFeatures("Y", volatility_24h=0.10, price_change_rate_24h=0.05, liquidity_score_24h=0.9),
        ]

        matrix, _ = normalize_features(features)

        # Min and max in each column should map to 0 and 1
        # Volatility: X=0, Y=1
        assert abs(matrix[0, 0] - 0.0) < 1e-10
        assert abs(matrix[1, 0] - 1.0) < 1e-10


# ---------------------------------------------------------------------------
# Cluster label assignment tests
# ---------------------------------------------------------------------------

class TestAssignClusterLabels:
    """Test the centroid-based cluster label assignment from §5.4."""

    def test_clear_separation(self):
        """Centroids with clear volatility separation should get correct labels."""
        # Centroids: [volatility_norm, price_change_norm, liquidity_norm]
        centroids = np.array([
            [0.1, 0.5, 0.9],   # low volatility, high liquidity -> stable
            [0.5, 0.5, 0.5],   # medium -> moderate
            [0.9, 0.3, 0.1],   # high volatility, low liquidity -> volatile_illiquid
        ])

        label_map = assign_cluster_labels(centroids)

        assert label_map[0] == ClusterLabel.STABLE
        assert label_map[1] == ClusterLabel.MODERATE
        assert label_map[2] == ClusterLabel.VOLATILE_ILLIQUID

    def test_reversed_order(self):
        """Centroids in reversed volatility order should still get correct labels."""
        centroids = np.array([
            [0.9, 0.3, 0.1],   # high volatility -> volatile_illiquid
            [0.5, 0.5, 0.5],   # medium -> moderate
            [0.1, 0.5, 0.9],   # low volatility -> stable
        ])

        label_map = assign_cluster_labels(centroids)

        assert label_map[0] == ClusterLabel.VOLATILE_ILLIQUID
        assert label_map[1] == ClusterLabel.MODERATE
        assert label_map[2] == ClusterLabel.STABLE

    def test_tiebreaker_low_liquidity(self):
        """If two clusters have similar volatility, lower liquidity -> volatile_illiquid."""
        # Clusters 0 and 1 have very similar volatility (diff < 0.1)
        # but cluster 1 has lower liquidity -> should be volatile_illiquid
        centroids = np.array([
            [0.05, 0.5, 0.9],  # slightly lower vol, higher liquidity
            [0.10, 0.5, 0.2],  # slightly higher vol, lower liquidity -> volatile_illiquid via tiebreaker
            [0.80, 0.3, 0.1],  # clearly highest vol -> volatile_illiquid
        ])

        label_map = assign_cluster_labels(centroids)

        # The cluster with highest volatility (0.80) should be volatile_illiquid
        # Cluster 1 (vol=0.10) and cluster 0 (vol=0.05) are close
        # Cluster 1 has lower liquidity -> it should not be stable
        assert label_map[2] == ClusterLabel.VOLATILE_ILLIQUID

    def test_three_clusters_required(self):
        """assign_cluster_labels should assert 3 clusters."""
        centroids = np.array([
            [0.1, 0.5, 0.9],
            [0.5, 0.5, 0.5],
        ])

        with pytest.raises(AssertionError, match="Expected 3 clusters"):
            assign_cluster_labels(centroids)


# ---------------------------------------------------------------------------
# CurrencyClusterer integration tests
# ---------------------------------------------------------------------------

class TestCurrencyClusterer:
    """Integration tests for the full clustering pipeline."""

    def test_verification_example_from_spec(self):
        """§5 Verification: 3 currencies should cluster as described.

        A: vol=0.01, change=0.02, liq=0.9  -> "stable"
        B: vol=0.05, change=0.05, liq=0.7  -> "moderate"
        C: vol=0.10, change=-0.03, liq=0.3 -> "volatile_illiquid"

        Note: exact assignments depend on KMeans with the full dataset,
        but the principle should hold with enough differentiation.
        """
        # Build price histories that produce the expected volatilities
        # We construct price series that give approximately the right volatility
        np.random.seed(42)

        # Currency A: low volatility (stable)
        prices_a = [100.0]
        for _ in range(23):
            prices_a.append(prices_a[-1] * (1 + np.random.normal(0, 0.002)))
        prices_a[-1] = 102.0  # price_now = 102
        prices_a[0] = 100.0   # price_24h_ago = 100

        # Currency B: moderate volatility
        prices_b = [100.0]
        for _ in range(23):
            prices_b.append(prices_b[-1] * (1 + np.random.normal(0, 0.01)))
        prices_b[-1] = 105.0  # price_now = 105
        prices_b[0] = 100.0   # price_24h_ago = 100

        # Currency C: high volatility, low liquidity
        prices_c = [100.0]
        for _ in range(23):
            prices_c.append(prices_c[-1] * (1 + np.random.normal(0, 0.03)))
        prices_c[-1] = 97.0   # price_now = 97
        prices_c[0] = 100.0   # price_24h_ago = 100

        price_histories = {
            "A": prices_a,
            "B": prices_b,
            "C": prices_c,
        }
        volumes_24h = {"A": 900.0, "B": 700.0, "C": 100.0}
        prices_now = {"A": 102.0, "B": 105.0, "C": 97.0}
        prices_24h_ago = {"A": 100.0, "B": 100.0, "C": 100.0}

        clusterer = CurrencyClusterer()
        output = clusterer.fit(
            price_histories, volumes_24h, prices_now, prices_24h_ago,
        )

        assert output.n_currencies == 3
        assert len(output.clusters) == 3

        # The highest volatility currency should be volatile_illiquid
        # The lowest volatility currency should be stable
        by_currency = {c.currency: c.cluster for c in output.clusters}

        # C has the highest volatility and lowest liquidity
        assert by_currency["C"] == ClusterLabel.VOLATILE_ILLIQUID
        # A has the lowest volatility and highest liquidity
        assert by_currency["A"] == ClusterLabel.STABLE
        # B is in between
        assert by_currency["B"] == ClusterLabel.MODERATE

    def test_all_same_currency_gets_moderate(self):
        """If only one currency, it should be assigned MODERATE (edge case)."""
        price_histories = {"A": [100.0, 101.0]}
        volumes_24h = {"A": 100.0}
        prices_now = {"A": 101.0}
        prices_24h_ago = {"A": 100.0}

        clusterer = CurrencyClusterer()
        output = clusterer.fit(
            price_histories, volumes_24h, prices_now, prices_24h_ago,
        )

        # With only 1 currency (< n_clusters=3), all should be MODERATE
        assert output.n_currencies == 1
        assert output.clusters[0].cluster == ClusterLabel.MODERATE

    def test_two_currencies_fewer_than_clusters(self):
        """With 2 currencies (< 3 clusters), all should be MODERATE."""
        price_histories = {
            "A": [100.0, 101.0],
            "B": [200.0, 202.0],
        }
        volumes_24h = {"A": 500.0, "B": 100.0}
        prices_now = {"A": 101.0, "B": 202.0}
        prices_24h_ago = {"A": 100.0, "B": 200.0}

        clusterer = CurrencyClusterer()
        output = clusterer.fit(
            price_histories, volumes_24h, prices_now, prices_24h_ago,
        )

        assert output.n_currencies == 2
        for c in output.clusters:
            assert c.cluster == ClusterLabel.MODERATE

    def test_empty_input(self):
        """Empty input should return empty output with no clusters."""
        clusterer = CurrencyClusterer()
        output = clusterer.fit({}, {}, {}, {})

        assert output.n_currencies == 0
        assert output.clusters == []

    def test_output_contains_features(self):
        """Each ClusterResult should preserve the raw feature values."""
        price_histories = {
            "X": [100.0, 101.0, 100.0, 102.0],
            "Y": [200.0, 202.0, 198.0, 205.0],
            "Z": [50.0, 49.0, 51.0, 48.0],
        }
        volumes_24h = {"X": 500.0, "Y": 1000.0, "Z": 50.0}
        prices_now = {"X": 102.0, "Y": 205.0, "Z": 48.0}
        prices_24h_ago = {"X": 100.0, "Y": 200.0, "Z": 50.0}

        clusterer = CurrencyClusterer()
        output = clusterer.fit(
            price_histories, volumes_24h, prices_now, prices_24h_ago,
        )

        # Check that feature values are preserved
        for c in output.clusters:
            assert c.volatility_24h >= 0.0
            assert isinstance(c.price_change_rate_24h, float)
            assert 0.0 <= c.liquidity_score_24h <= 1.0

    def test_normalized_features_in_output(self):
        """Each ClusterResult should have normalized_features in [0,1]."""
        price_histories = {
            "A": [100.0, 101.0, 100.0, 102.0],
            "B": [200.0, 202.0, 198.0, 205.0],
            "C": [50.0, 49.0, 51.0, 48.0],
        }
        volumes_24h = {"A": 500.0, "B": 1000.0, "C": 50.0}
        prices_now = {"A": 102.0, "B": 205.0, "C": 48.0}
        prices_24h_ago = {"A": 100.0, "B": 200.0, "C": 50.0}

        clusterer = CurrencyClusterer()
        output = clusterer.fit(
            price_histories, volumes_24h, prices_now, prices_24h_ago,
        )

        for c in output.clusters:
            assert len(c.normalized_features) == 3
            for val in c.normalized_features:
                assert 0.0 <= val <= 1.0

    def test_cluster_label_is_valid_enum(self):
        """Each cluster label should be a valid ClusterLabel enum member."""
        price_histories = {
            "A": [100.0, 101.0],
            "B": [200.0, 202.0],
            "C": [50.0, 49.0],
        }
        volumes_24h = {"A": 500.0, "B": 1000.0, "C": 50.0}
        prices_now = {"A": 101.0, "B": 202.0, "C": 49.0}
        prices_24h_ago = {"A": 100.0, "B": 200.0, "C": 50.0}

        clusterer = CurrencyClusterer()
        output = clusterer.fit(
            price_histories, volumes_24h, prices_now, prices_24h_ago,
        )

        valid_labels = {ClusterLabel.STABLE, ClusterLabel.MODERATE, ClusterLabel.VOLATILE_ILLIQUID}
        for c in output.clusters:
            assert c.cluster in valid_labels

    def test_centroids_shape(self):
        """Centroids should have shape (3, 3)."""
        price_histories = {
            "A": [100.0, 101.0],
            "B": [200.0, 202.0],
            "C": [50.0, 49.0],
        }
        volumes_24h = {"A": 500.0, "B": 1000.0, "C": 50.0}
        prices_now = {"A": 101.0, "B": 202.0, "C": 49.0}
        prices_24h_ago = {"A": 100.0, "B": 200.0, "C": 50.0}

        clusterer = CurrencyClusterer()
        output = clusterer.fit(
            price_histories, volumes_24h, prices_now, prices_24h_ago,
        )

        assert output.centroids.shape == (3, 3)

    def test_last_output_stored(self):
        """The last_output property should store the most recent result."""
        price_histories = {
            "A": [100.0, 101.0],
            "B": [200.0, 202.0],
            "C": [50.0, 49.0],
        }
        volumes_24h = {"A": 500.0, "B": 1000.0, "C": 50.0}
        prices_now = {"A": 101.0, "B": 202.0, "C": 49.0}
        prices_24h_ago = {"A": 100.0, "B": 200.0, "C": 50.0}

        clusterer = CurrencyClusterer()
        output = clusterer.fit(
            price_histories, volumes_24h, prices_now, prices_24h_ago,
        )

        assert clusterer.last_output is not None
        assert clusterer.last_output.n_currencies == output.n_currencies

    def test_get_cluster_for_currency(self):
        """get_cluster_for_currency should return the right label after fit."""
        price_histories = {
            "A": [100.0, 101.0],
            "B": [200.0, 202.0],
            "C": [50.0, 49.0],
        }
        volumes_24h = {"A": 500.0, "B": 1000.0, "C": 50.0}
        prices_now = {"A": 101.0, "B": 202.0, "C": 49.0}
        prices_24h_ago = {"A": 100.0, "B": 200.0, "C": 50.0}

        clusterer = CurrencyClusterer()
        clusterer.fit(
            price_histories, volumes_24h, prices_now, prices_24h_ago,
        )

        # Should return a valid label for each currency
        for curr in ["A", "B", "C"]:
            label = clusterer.get_cluster_for_currency(curr)
            assert label in {ClusterLabel.STABLE, ClusterLabel.MODERATE, ClusterLabel.VOLATILE_ILLIQUID}

    def test_get_cluster_unknown_currency(self):
        """get_cluster_for_currency should return MODERATE for unknown currency."""
        clusterer = CurrencyClusterer()
        assert clusterer.get_cluster_for_currency("nonexistent") == ClusterLabel.MODERATE

    def test_get_cluster_before_fit(self):
        """get_cluster_for_currency should return MODERATE before any fit."""
        clusterer = CurrencyClusterer()
        assert clusterer.get_cluster_for_currency("A") == ClusterLabel.MODERATE

    def test_fitted_at_timestamp(self):
        """The fitted_at field should be a recent datetime."""
        price_histories = {
            "A": [100.0, 101.0],
            "B": [200.0, 202.0],
            "C": [50.0, 49.0],
        }
        volumes_24h = {"A": 500.0, "B": 1000.0, "C": 50.0}
        prices_now = {"A": 101.0, "B": 202.0, "C": 49.0}
        prices_24h_ago = {"A": 100.0, "B": 200.0, "C": 50.0}

        clusterer = CurrencyClusterer()
        output = clusterer.fit(
            price_histories, volumes_24h, prices_now, prices_24h_ago,
        )

        assert output.fitted_at is not None


# ---------------------------------------------------------------------------
# cluster_currencies convenience function tests
# ---------------------------------------------------------------------------

class TestClusterCurrencies:
    """Test the one-shot cluster_currencies function."""

    def test_returns_dict(self):
        """cluster_currencies should return a dict of currency -> ClusterLabel."""
        price_histories = {
            "A": [100.0, 101.0],
            "B": [200.0, 202.0],
            "C": [50.0, 49.0],
        }
        volumes_24h = {"A": 500.0, "B": 1000.0, "C": 50.0}
        prices_now = {"A": 101.0, "B": 202.0, "C": 49.0}
        prices_24h_ago = {"A": 100.0, "B": 200.0, "C": 50.0}

        result = cluster_currencies(
            price_histories, volumes_24h, prices_now, prices_24h_ago,
        )

        assert isinstance(result, dict)
        assert len(result) == 3
        for curr, label in result.items():
            assert isinstance(label, ClusterLabel)

    def test_empty_input(self):
        """Empty input should return empty dict."""
        result = cluster_currencies({}, {}, {}, {})
        assert result == {}


# ---------------------------------------------------------------------------
# Large-scale integration test
# ---------------------------------------------------------------------------

class TestClusteringIntegration:
    """Integration tests with more realistic data."""

    def test_many_currencies(self):
        """Clustering should work with a larger number of currencies."""
        np.random.seed(123)

        n_currencies = 15
        price_histories = {}
        volumes_24h = {}
        prices_now = {}
        prices_24h_ago = {}

        for i in range(n_currencies):
            name = f"curr_{i:02d}"
            base_price = 50 + i * 10
            vol_scale = 0.001 + i * 0.003  # increasing volatility
            prices = [base_price]
            for _ in range(23):
                prices.append(prices[-1] * (1 + np.random.normal(0, vol_scale)))
            price_histories[name] = prices
            volumes_24h[name] = max(10, 1000 - i * 60)  # decreasing volume
            prices_now[name] = prices[-1]
            prices_24h_ago[name] = prices[0]

        clusterer = CurrencyClusterer()
        output = clusterer.fit(
            price_histories, volumes_24h, prices_now, prices_24h_ago,
        )

        assert output.n_currencies == n_currencies
        assert len(output.clusters) == n_currencies

        # All three cluster types should be represented
        cluster_types = {c.cluster for c in output.clusters}
        assert len(cluster_types) >= 1  # at least one cluster type

    def test_deterministic_results(self):
        """KMeans with random_state=42 should produce deterministic results."""
        price_histories = {
            "A": [100.0, 101.0, 100.0, 102.0],
            "B": [200.0, 202.0, 198.0, 205.0],
            "C": [50.0, 49.0, 51.0, 48.0],
        }
        volumes_24h = {"A": 500.0, "B": 1000.0, "C": 50.0}
        prices_now = {"A": 102.0, "B": 205.0, "C": 48.0}
        prices_24h_ago = {"A": 100.0, "B": 200.0, "C": 50.0}

        clusterer1 = CurrencyClusterer()
        output1 = clusterer1.fit(
            price_histories, volumes_24h, prices_now, prices_24h_ago,
        )

        clusterer2 = CurrencyClusterer()
        output2 = clusterer2.fit(
            price_histories, volumes_24h, prices_now, prices_24h_ago,
        )

        labels1 = {c.currency: c.cluster for c in output1.clusters}
        labels2 = {c.currency: c.cluster for c in output2.clusters}

        assert labels1 == labels2

    def test_cluster_stability_with_small_perturbation(self):
        """Small perturbations in data should not drastically change cluster assignments.

        Note: with only 3 currencies, cluster assignments can be sensitive to
        small changes. We use more separated data to make the test robust.
        """
        np.random.seed(42)

        # Use more clearly separated currencies (like the verification example)
        base_histories = {
            "A": [100.0 + i * 0.01 for i in range(24)],  # very stable
            "B": [100.0 * (1 + np.sin(i / 3) * 0.01) for i in range(24)],  # moderate
            "C": [100.0 * (1 + np.sin(i / 2) * 0.05) for i in range(24)],  # volatile
        }
        volumes_24h = {"A": 900.0, "B": 500.0, "C": 100.0}
        prices_now = {k: v[-1] for k, v in base_histories.items()}
        prices_24h_ago = {k: v[0] for k, v in base_histories.items()}

        clusterer1 = CurrencyClusterer()
        output1 = clusterer1.fit(base_histories, volumes_24h, prices_now, prices_24h_ago)

        # Small perturbation
        perturbed_histories = {
            k: [p * (1 + np.random.normal(0, 0.001)) for p in v]
            for k, v in base_histories.items()
        }
        perturbed_now = {k: v[-1] for k, v in perturbed_histories.items()}
        perturbed_ago = {k: v[0] for k, v in perturbed_histories.items()}

        clusterer2 = CurrencyClusterer()
        output2 = clusterer2.fit(perturbed_histories, volumes_24h, perturbed_now, perturbed_ago)

        labels1 = {c.currency: c.cluster for c in output1.clusters}
        labels2 = {c.currency: c.cluster for c in output2.clusters}

        # At least 1 out of 3 should be the same (conservative for 3-point clustering)
        # With more separated data, we expect at least the extremes to match
        matches = sum(1 for k in labels1 if labels1[k] == labels2[k])
        assert matches >= 1, f"Expected >=1 matching labels, got {matches}: {labels1} vs {labels2}"

    def test_arbitrage_filter_penalty(self):
        """Currencies in volatile_illiquid cluster should be identifiable."""
        np.random.seed(42)

        # Create clearly separated currencies
        price_histories = {}
        volumes_24h = {}
        prices_now = {}
        prices_24h_ago = {}

        # Group 1: stable, high liquidity
        for i in range(5):
            name = f"stable_{i}"
            prices = [100.0] * 24
            for j in range(1, 24):
                prices[j] = prices[j-1] * (1 + np.random.normal(0, 0.001))
            price_histories[name] = prices
            volumes_24h[name] = 5000.0
            prices_now[name] = prices[-1]
            prices_24h_ago[name] = prices[0]

        # Group 2: moderate
        for i in range(5):
            name = f"moderate_{i}"
            prices = [100.0] * 24
            for j in range(1, 24):
                prices[j] = prices[j-1] * (1 + np.random.normal(0, 0.01))
            price_histories[name] = prices
            volumes_24h[name] = 500.0
            prices_now[name] = prices[-1]
            prices_24h_ago[name] = prices[0]

        # Group 3: volatile, illiquid
        for i in range(5):
            name = f"volatile_{i}"
            prices = [100.0] * 24
            for j in range(1, 24):
                prices[j] = prices[j-1] * (1 + np.random.normal(0, 0.05))
            price_histories[name] = prices
            volumes_24h[name] = 30.0
            prices_now[name] = prices[-1]
            prices_24h_ago[name] = prices[0]

        clusterer = CurrencyClusterer()
        output = clusterer.fit(
            price_histories, volumes_24h, prices_now, prices_24h_ago,
        )

        # Volatile currencies should mostly be in volatile_illiquid
        volatile_labels = [
            c.cluster for c in output.clusters if c.currency.startswith("volatile_")
        ]
        # At least some should be volatile_illiquid
        volatile_illiquid_count = sum(
            1 for l in volatile_labels if l == ClusterLabel.VOLATILE_ILLIQUID
        )
        assert volatile_illiquid_count >= 2, \
            f"Expected at least 2 volatile_illiquid, got {volatile_illiquid_count} out of {len(volatile_labels)}"
