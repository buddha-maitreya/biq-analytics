"""Tests for input validation."""

import pytest
from src.validation import validate_input


def test_validate_empty_data():
    with pytest.raises(ValueError, match="No data rows"):
        validate_input("chart.sales_trends", [])


def test_validate_not_list():
    with pytest.raises(ValueError, match="Expected data to be a list"):
        validate_input("chart.sales_trends", "not a list")


def test_validate_not_dicts():
    with pytest.raises(ValueError, match="Expected rows to be dicts"):
        validate_input("chart.sales_trends", ["string", "data"])


def test_validate_insufficient_rows():
    data = [{"date": "2026-01-01", "amount": 100}]
    with pytest.raises(ValueError, match="Insufficient data"):
        validate_input("chart.sales_trends", data)


def test_validate_missing_columns():
    data = [{"foo": "bar", "baz": 123}, {"foo": "qux", "baz": 456}]
    with pytest.raises(ValueError, match="Missing required.*date"):
        validate_input("chart.sales_trends", data)


def test_validate_no_numeric():
    data = [{"date": "2026-01-01", "name": "abc"}, {"date": "2026-01-02", "name": "def"}]
    with pytest.raises(ValueError, match="No numeric columns"):
        validate_input("chart.sales_trends", data)


def test_validate_success():
    data = [
        {"date": "2026-01-01", "amount": 100},
        {"date": "2026-01-02", "amount": 200},
    ]
    # Should not raise
    validate_input("chart.sales_trends", data)


def test_validate_chart_render_bypasses():
    # chart.render bypasses validation
    validate_input("chart.render", [])


def test_validate_classify_no_numeric_ok():
    # Classification actions don't require numeric columns
    data = [
        {"name": "P1", "category": "A"},
        {"name": "P2", "category": "B"},
        {"name": "P3", "category": "C"},
        {"name": "P4", "category": "A"},
        {"name": "P5", "category": "B"},
    ]
    # Should not raise for classify action (no numeric check)
    validate_input("classify.abc_xyz", data)
