"""
Input validation — extracted from scripts/analytics/main.py.

Validates data before dispatching to analytics modules.
Raises ValueError instead of sys.exit().
"""

from typing import Any


MIN_ROWS: dict[str, int] = {
    "chart.": 2,
    "forecast.": 14,
    "classify.": 5,
    "anomaly.": 10,
}

REQUIRED_COLUMNS: dict[str, dict[str, list[str]]] = {
    "chart.sales_trends": {
        "date": ["date", "sale_date", "created_at", "order_date"],
        "amount": ["total_amount", "amount", "revenue", "total", "net_amount"],
    },
    "chart.heatmap": {
        "date": ["date", "sale_date", "created_at", "order_date"],
        "amount": ["total_amount", "amount", "revenue", "total"],
    },
    "chart.pareto": {
        "name": ["name", "product_name", "sku", "item"],
        "value": ["total_revenue", "revenue", "total_amount", "amount", "value"],
    },
    "classify.rfm": {
        "customer": ["customer_id", "customer_name", "client_id"],
        "date": ["date", "sale_date", "created_at", "order_date"],
        "amount": ["total_amount", "amount", "revenue", "total"],
    },
    "classify.abc_xyz": {
        "name": ["name", "product_name", "sku", "item"],
        "value": ["total_revenue", "revenue", "total_amount", "amount", "quantity"],
    },
}


def validate_input(action: str, data: list[dict[str, Any]]) -> None:
    """Validate input data before dispatching. Raises ValueError if invalid."""
    if not isinstance(data, list):
        raise ValueError(
            f"Expected data to be a list, got {type(data).__name__}. "
            "Ensure the SQL query returns rows as an array of objects."
        )

    # chart.render bypasses normal validation
    if action == "chart.render":
        return

    if len(data) == 0:
        raise ValueError(
            "No data rows provided. "
            "The SQL query returned 0 rows. Check date filters and table names."
        )

    if not isinstance(data[0], dict):
        raise ValueError(
            f"Expected rows to be dicts, got {type(data[0]).__name__}. "
            "Each row should be a JSON object with column names as keys."
        )

    for prefix, min_count in MIN_ROWS.items():
        if action.startswith(prefix) and len(data) < min_count:
            raise ValueError(
                f"Insufficient data: {action} requires at least {min_count} rows, "
                f"got {len(data)}. Expand date range or reduce filters."
            )

    available_cols = set(data[0].keys())
    col_requirements = REQUIRED_COLUMNS.get(action, {})
    for role, candidates in col_requirements.items():
        if not any(c in available_cols for c in candidates):
            raise ValueError(
                f"Missing required '{role}' column for {action}. "
                f"Expected one of: {candidates}. Available: {sorted(available_cols)}"
            )

    sample = data[0]
    has_numeric = False
    for val in sample.values():
        if isinstance(val, (int, float)):
            has_numeric = True
            break
        if isinstance(val, str):
            try:
                float(val)
                has_numeric = True
                break
            except (ValueError, TypeError):
                pass

    if not has_numeric and not action.startswith("classify."):
        raise ValueError(
            "No numeric columns detected in data. "
            "Analytics requires at least one numeric column."
        )
