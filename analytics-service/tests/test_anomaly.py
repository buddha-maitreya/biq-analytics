"""Tests for anomaly detection modules."""

from src.anomaly import isolation_forest, shrinkage


def test_isolation_forest(transaction_data):
    result = isolation_forest.run(transaction_data, {}, {})
    assert result.get("success") is True
    assert "summary" in result
    assert "anomaliesDetected" in result["summary"]
    assert result["summary"]["totalTransactions"] > 0


def test_isolation_forest_empty():
    result = isolation_forest.run([], {}, {})
    assert result.get("success") is False


def test_shrinkage():
    data = [
        {"product_name": f"P{i}", "expected_stock": 100, "actual_stock": 100 - i * 3,
         "unit_cost": 50, "date": "2026-01-15"}
        for i in range(20)
    ]
    result = shrinkage.run(data, {}, {})
    assert result.get("success") is True
    assert "summary" in result
    assert "totalProducts" in result["summary"]
    assert result["summary"]["totalProducts"] == 20


def test_shrinkage_empty():
    result = shrinkage.run([], {}, {})
    assert result.get("success") is False
