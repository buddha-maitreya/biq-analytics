"""Tests for forecasting modules."""

import pytest
from src.forecasting import arima, holt_winters, safety_stock, seasonal_detect

# Prophet tests are optional since Prophet may not be installed
try:
    from src.forecasting import prophet_forecast
    HAS_PROPHET = True
except ImportError:
    HAS_PROPHET = False


@pytest.mark.skipif(not HAS_PROPHET, reason="Prophet not installed")
def test_prophet(daily_sales_90):
    result = prophet_forecast.run(daily_sales_90, {"horizonDays": 14}, {})
    assert result.get("success") is True
    assert "summary" in result
    assert "horizonDays" in result["summary"]


@pytest.mark.skipif(not HAS_PROPHET, reason="Prophet not installed")
def test_prophet_empty():
    result = prophet_forecast.run([], {}, {})
    assert result.get("success") is False


def test_arima(daily_sales_90):
    result = arima.run(daily_sales_90, {"horizonDays": 14, "autoOrder": False}, {})
    assert result.get("success") is True
    assert "summary" in result
    assert result["summary"]["model"] == "SARIMA"


def test_arima_empty():
    result = arima.run([], {}, {})
    assert result.get("success") is False


def test_holt_winters(daily_sales_90):
    result = holt_winters.run(daily_sales_90, {"horizonDays": 14}, {})
    assert result.get("success") is True
    assert "summary" in result


def test_holt_winters_empty():
    result = holt_winters.run([], {}, {})
    assert result.get("success") is False


def test_safety_stock():
    from datetime import date, timedelta
    base = date(2025, 12, 1)
    data = []
    for i in range(30):
        for p in range(3):
            data.append({
                "product_name": f"Product {p}",
                "date": (base + timedelta(days=i)).isoformat(),
                "quantity": 5 + p + (i % 3),
            })
    result = safety_stock.run(data, {}, {})
    assert result.get("success") is True
    assert "summary" in result
    assert result["summary"]["productCount"] == 3


def test_safety_stock_empty():
    result = safety_stock.run([], {}, {})
    assert result.get("success") is False


def test_seasonal_detect(daily_sales_400):
    result = seasonal_detect.run(daily_sales_400, {}, {})
    assert result.get("success") is True
    assert "summary" in result
    assert "detectedCycles" in result["summary"]
    assert result["summary"]["dataPoints"] >= 90


def test_seasonal_detect_insufficient_data():
    short_data = [{"date": f"2025-01-{i+1:02d}", "amount": 100 + i} for i in range(30)]
    result = seasonal_detect.run(short_data, {}, {})
    assert result.get("success") is False
