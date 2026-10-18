# 25010 Characteristic: Reliability — ML engine edge cases.
# The dashboard's "How sure are we?" row grades the grouping metrics with
# colors. When the data is too small to cluster, the scores are placeholders
# (0.0), so the payload must say clustered=False — otherwise the UI shows a
# false red alarm for data that simply does not exist yet.

import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import pytest
from unittest.mock import MagicMock, patch
from ml_engine import run_kmeans_clustering, invalidate_ml_cache


def _make_db(routes_with_fleets, route_data=None):
    """Stub the two db queries run_kmeans_clustering makes: a grouped
    fleet-count query (.group_by().filter().all()) and a per-route RouteData
    lookup (.filter().first())."""
    db = MagicMock()

    class Row:
        def __init__(self, route, fleet_size):
            self.route = route
            self.fleet_size = fleet_size

    fleet_rows = [Row(r, n) for r, n in routes_with_fleets]

    def query_side_effect(*args, **kwargs):
        # One positional arg = the per-route RouteData lookup
        # (db.query(RouteData).filter(...).first()); the fleet-count query
        # takes several columns.
        q = MagicMock()
        if len(args) <= 1:
            q.filter.return_value.first.return_value = route_data
        else:
            q.filter.return_value.group_by.return_value.all.return_value = fleet_rows
        return q

    db.query.side_effect = query_side_effect
    return db


class FakeRouteData:
    def __init__(self, population=5000, road_length_km=5.0):
        self.population = population
        self.road_length_km = road_length_km


@pytest.fixture(autouse=True)
def _clean_cache():
    invalidate_ml_cache()
    yield
    invalidate_ml_cache()


def test_too_few_routes_reports_not_clustered():
    # Two routes only: below the 3-route minimum for KMeans.
    db = _make_db([("ROUTE A", 10), ("ROUTE B", 4)], FakeRouteData())
    result = run_kmeans_clustering(db, "ROUTE A")
    assert result, "expected a payload even for tiny data"
    entry = result[0]
    assert entry["clustered"] is False
    assert entry["silhouette"] == 0.0
    assert entry["davies_bouldin"] == 0.0
    assert entry["calinski_harabasz"] == 0.0
    # The route itself still gets a plain GREEN verdict, no crash.
    assert entry["forecast_period"].startswith("GREEN")


def test_identical_densities_report_not_clustered():
    # 4 routes but every fullness value identical: nothing to separate.
    db = _make_db([("ROUTE A", 10), ("ROUTE B", 10), ("ROUTE C", 10), ("ROUTE D", 10)], FakeRouteData())
    result = run_kmeans_clustering(db, "ROUTE A")
    entry = result[0]
    assert entry["clustered"] is False


def test_real_clustering_reports_clustered_true():
    # Enough routes with different densities to actually cluster.
    routes = [("ROUTE A", 2), ("ROUTE B", 30), ("ROUTE C", 60),
              ("ROUTE D", 3), ("ROUTE E", 45), ("ROUTE F", 12)]
    db = _make_db(routes, FakeRouteData())
    result = run_kmeans_clustering(db, "ROUTE C")
    entry = result[0]
    assert entry["clustered"] is True
    # A real clustering should produce a nonnegative silhouette measurement.
    assert entry["silhouette"] >= 0.0
