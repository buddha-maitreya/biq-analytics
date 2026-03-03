"""Tests for classification modules."""

from datetime import date, timedelta
from src.classification import abc_xyz, rfm


def test_abc_xyz():
    base = date(2025, 12, 1)
    data = []
    for i in range(30):
        for p in range(10):
            data.append({
                "product_name": f"Product {p}",
                "date": (base + timedelta(days=i)).isoformat(),
                "quantity": 10 + p * 2 + (i % 5),
                "amount": (10 + p * 2 + (i % 5)) * (50 - p * 3),
            })
    result = abc_xyz.run(data, {}, {})
    assert result.get("success") is True or "summary" in result
    assert "summary" in result
    assert "table" in result
    assert "columns" in result["table"]
    assert len(result["table"]["rows"]) > 0


def test_abc_xyz_empty():
    result = abc_xyz.run([], {}, {})
    assert result.get("success") is False or "error" in result


def test_rfm(customer_data):
    # Adapt customer_data fixture: rename fields to match expected
    data = [
        {"customer_name": r["customer_id"], "date": r["order_date"], "amount": r["order_value"]}
        for r in customer_data
    ]
    result = rfm.run(data, {}, {})
    assert result.get("success") is True
    assert "summary" in result
    assert "table" in result
    assert "columns" in result["table"]
    assert len(result["table"]["rows"]) > 0


def test_rfm_empty():
    result = rfm.run([], {}, {})
    assert result.get("success") is False
