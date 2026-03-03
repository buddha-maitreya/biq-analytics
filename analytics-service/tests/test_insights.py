"""Tests for insights modules."""

from src.insights import (
    value_gap, dead_stock, cash_simulation, procurement_plan,
    supplier_analysis, stockout_cost, sales_velocity,
)


def test_supplier_analysis_empty_data():
    result = supplier_analysis.run([], {}, {})
    assert result.get("success") is True
    assert "message" in result["summary"]
    assert "No delivery data" in result["summary"]["message"]


def test_supplier_analysis_with_data():
    data = [
        {"supplier_name": f"Supplier {i % 3}", "promised_date": f"2026-01-{10 + i:02d}",
         "actual_date": f"2026-01-{10 + i + (i % 2):02d}", "order_value": 1000 + i * 100}
        for i in range(15)
    ]
    result = supplier_analysis.run(data, {}, {})
    assert result.get("success") is True
    assert "totalSuppliers" in result["summary"]


def test_sales_velocity(product_data):
    # Add required fields
    data = [
        {**p, "days_in_period": 30}
        for p in product_data
    ]
    result = sales_velocity.run(data, {}, {})
    assert result.get("success") is True
    assert "totalStars" in result["summary"]
    assert "totalDogs" in result["summary"]
    assert "table" in result
    assert len(result["table"]["rows"]) > 0


def test_cash_simulation(product_data):
    result = cash_simulation.run(product_data, {}, {})
    assert result.get("success") is True
    assert "currentInvestment" in result["summary"]
    assert "freedCapital" in result["summary"]


def test_stockout_cost():
    data = [
        {"product_name": f"P{i}", "avg_daily_sales": 5.0 + i, "selling_price": 100.0,
         "stockout_days": i * 2}
        for i in range(10)
    ]
    result = stockout_cost.run(data, {}, {})
    assert result.get("success") is True
    assert "totalRevenueLost" in result["summary"]
    assert result["summary"]["totalStockoutDays"] > 0


def test_procurement_plan():
    data = [
        {"supplier_name": f"Supplier {i % 3}", "product_name": f"P{i}",
         "reorder_point": 20, "current_stock": 10 if i % 2 == 0 else 30,
         "lead_time_days": 7, "cost_price": 50.0}
        for i in range(10)
    ]
    result = procurement_plan.run(data, {}, {})
    assert result.get("success") is True
    assert "totalSuppliers" in result.get("summary", {}) or "message" in result.get("summary", {})


def test_value_gap():
    data = [
        {"product_name": f"P{i}", "selling_price": 100 + i * 5,
         "cost_price": 50 + i * 2, "quantity_sold": 50 - i, "category": ["A", "B"][i % 2]}
        for i in range(10)
    ]
    result = value_gap.run(data, {}, {})
    assert result.get("success") is True
    assert "avgMarginPct" in result["summary"]


def test_dead_stock():
    data = [
        {"product_name": f"P{i}", "last_sale_date": f"2025-{6 + i % 6:02d}-01",
         "quantity_on_hand": 50 + i * 5, "cost_price": 30.0}
        for i in range(10)
    ]
    result = dead_stock.run(data, {}, {})
    assert result.get("success") is True
    assert "deadStockCount" in result["summary"]
