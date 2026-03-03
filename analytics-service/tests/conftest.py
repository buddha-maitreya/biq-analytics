import pytest
from datetime import date, timedelta


@pytest.fixture
def daily_sales_90():
    """90 days of synthetic daily sales."""
    base = date(2025, 12, 1)
    return [
        {"date": (base + timedelta(days=i)).isoformat(), "amount": 1000 + i * 5 + (i % 7) * 100}
        for i in range(90)
    ]


@pytest.fixture
def daily_sales_400():
    """400 days for seasonal detection."""
    base = date(2025, 1, 1)
    return [
        {"date": (base + timedelta(days=i)).isoformat(), "amount": 1000 + (i % 7) * 200 + (i % 30) * 50}
        for i in range(400)
    ]


@pytest.fixture
def product_data():
    """20 products with sales and cost data."""
    return [
        {
            "product_name": f"Product {i}",
            "sku": f"SKU{i:03d}",
            "category": ["A", "B", "C"][i % 3],
            "quantity_sold": 100 - i * 4,
            "revenue": (100 - i * 4) * 10.0,
            "cost_price": 5.0,
            "selling_price": 10.0,
            "quantity": 50 + i * 2,
            "avg_daily_sales": 3.0 - i * 0.1,
        }
        for i in range(20)
    ]


@pytest.fixture
def customer_data():
    """15 customers with purchase history."""
    base = date(2025, 1, 1)
    records = []
    for i in range(15):
        for j in range(5):
            records.append({
                "customer_id": f"C{i:03d}",
                "order_date": (base + timedelta(days=j * 10 + i)).isoformat(),
                "order_value": 100 + i * 20 + j * 5,
            })
    return records


@pytest.fixture
def transaction_data():
    """50 transactions for anomaly detection."""
    return [
        {
            "date": f"2026-01-{(i % 28) + 1:02d}",
            "amount": 500 + (i * 17) % 800,
            "quantity": 1 + i % 10,
            "product_id": f"P{i % 5}",
        }
        for i in range(50)
    ]
