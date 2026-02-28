"""
Analytics Engine — Main Dispatcher

Single entry point for all analytics operations. Reads input.json,
dispatches to the correct module based on the 'action' field.

The canonical version of this file is embedded as MAIN_PY in
src/lib/analytics-scripts.ts. This file is kept as a reference copy.

Each module must export a `run(data, params, chart_config) -> dict` function.

Input validation runs BEFORE dispatch — catches bad data early with
clear error messages instead of cryptic pandas/numpy exceptions.
"""

import json
import sys
import os

# Ensure venv packages are available
sys.path.insert(0, '/home/agentuity/venv/lib/python3.13/site-packages')


# ── Input Validation ─────────────────────────────────────────

MIN_ROWS = {
    'chart.': 2,
    'forecast.': 14,
    'classify.': 5,
    'anomaly.': 10,
}

REQUIRED_COLUMNS = {
    'chart.sales_trends': {
        'date': ['date', 'sale_date', 'created_at', 'order_date'],
        'amount': ['total_amount', 'amount', 'revenue', 'total', 'net_amount'],
    },
    'chart.heatmap': {
        'date': ['date', 'sale_date', 'created_at', 'order_date'],
        'amount': ['total_amount', 'amount', 'revenue', 'total'],
    },
    'chart.pareto': {
        'name': ['name', 'product_name', 'sku', 'item'],
        'value': ['total_revenue', 'revenue', 'total_amount', 'amount', 'value'],
    },
    'classify.rfm': {
        'customer': ['customer_id', 'customer_name', 'client_id'],
        'date': ['date', 'sale_date', 'created_at', 'order_date'],
        'amount': ['total_amount', 'amount', 'revenue', 'total'],
    },
    'classify.abc_xyz': {
        'name': ['name', 'product_name', 'sku', 'item'],
        'value': ['total_revenue', 'revenue', 'total_amount', 'amount', 'quantity'],
    },
}


def validate_input(action: str, data: list) -> dict | None:
    """Validate input data before dispatching. Returns None if valid, or error dict."""
    if not isinstance(data, list):
        return {"error": f"Expected data to be a list, got {type(data).__name__}",
                "hint": "Ensure the SQL query returns rows as an array of objects"}
    if len(data) == 0:
        return {"error": "No data rows provided",
                "hint": "The SQL query returned 0 rows. Check date filters and table names."}
    if not isinstance(data[0], dict):
        return {"error": f"Expected rows to be dicts, got {type(data[0]).__name__}",
                "hint": "Each row should be a JSON object with column names as keys"}

    for prefix, min_count in MIN_ROWS.items():
        if action.startswith(prefix) and len(data) < min_count:
            return {"error": f"Insufficient data: {action} requires at least {min_count} rows, got {len(data)}",
                    "hint": "Expand date range or reduce filters to get more data points",
                    "rowCount": len(data), "minRequired": min_count}

    available_cols = set(data[0].keys())
    col_requirements = REQUIRED_COLUMNS.get(action, {})
    for role, candidates in col_requirements.items():
        if not any(c in available_cols for c in candidates):
            return {"error": f"Missing required '{role}' column for {action}",
                    "hint": f"Expected one of: {candidates}. Available: {sorted(available_cols)}",
                    "availableColumns": sorted(available_cols), "expectedOneOf": candidates}

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

    if not has_numeric and not action.startswith('classify.'):
        return {"error": "No numeric columns detected in data",
                "hint": "Analytics requires at least one numeric column",
                "sampleRow": {k: type(v).__name__ for k, v in sample.items()}}

    return None


def main():
    with open('input.json', 'r') as f:
        payload = json.load(f)

    action = payload['action']
    data = payload.get('data', [])
    params = payload.get('params', {})
    chart_config = payload.get('chartConfig', {})

    # Dispatch to the right module
    try:
        # ── chart.render bypasses normal validation ──────────
        # (chart data is in params.charts, not in the 'data' arg)
        if action == 'chart.render':
            from charts.render_chart import run
            result = run(data, params, chart_config)
            print(json.dumps(result, default=str))
            sys.exit(0)

        # ── Input Validation (before dispatch) ───────────────
        validation_error = validate_input(action, data)
        if validation_error:
            print(json.dumps(validation_error))
            sys.exit(1)

        # ── Dispatch to module ───────────────────────────────
        if action == 'chart.sales_trends':
            from charts.sales_trends import run
        elif action == 'chart.heatmap':
            from charts.heatmap import run
        elif action == 'chart.scatter':
            from charts.scatter import run
        elif action == 'chart.treemap':
            from charts.treemap import run
        elif action == 'chart.pareto':
            from charts.pareto import run
        elif action == 'chart.waterfall':
            from charts.waterfall import run
        elif action == 'chart.forecast':
            from charts.forecast_plot import run
        elif action == 'chart.geo_map':
            from charts.geo_map import run
        elif action == 'forecast.prophet':
            from forecasting.prophet_forecast import run
        elif action == 'forecast.arima':
            from forecasting.arima import run
        elif action == 'forecast.holt_winters':
            from forecasting.holt_winters import run
        elif action == 'forecast.safety_stock':
            from forecasting.safety_stock import run
        elif action == 'classify.abc_xyz':
            from classification.abc_xyz import run
        elif action == 'classify.rfm':
            from classification.rfm import run
        elif action == 'classify.clv':
            from classification.clv import run
        elif action == 'classify.bundles':
            from classification.bundles import run
        elif action == 'anomaly.transactions':
            from anomaly.isolation_forest import run
        elif action == 'anomaly.shrinkage':
            from anomaly.shrinkage import run
        else:
            print(json.dumps({"error": f"Unknown action: {action}"}))
            sys.exit(1)

        result = run(data, params, chart_config)
        print(json.dumps(result, default=str))

    except Exception as e:
        import traceback
        print(json.dumps({
            "error": str(e),
            "traceback": traceback.format_exc()
        }))
        sys.exit(1)


if __name__ == '__main__':
    main()
