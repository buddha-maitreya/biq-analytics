/**
 * Analytics Python Scripts — Embedded as TypeScript string constants.
 *
 * WHY: The analytics engine runs Python inside Agentuity sandboxes.
 * Sandboxes are ephemeral — they start from a snapshot (which has packages
 * like pandas, numpy, matplotlib pre-installed) but have NO application code.
 * All Python files must be uploaded via `command.files` on every call.
 *
 * This file embeds the Python source code from `scripts/analytics/` as
 * string constants that get bundled into the deployed TypeScript code.
 * When `analytics.ts` calls `sandboxApi.run()`, it includes these as
 * `{ path, content: Buffer.from(SCRIPT) }` entries.
 *
 * KEEPING IN SYNC: The corresponding `.py` files in `scripts/analytics/`
 * are the canonical source. Edit them there, then copy the content here.
 * A pre-deploy check could validate they match — but in practice, this
 * file IS the deployed version and scripts/ is the development/reference copy.
 *
 * ADDING NEW MODULES: When you implement a new Python module (e.g.
 * `scripts/analytics/forecasting/prophet_forecast.py`), export it here
 * and add it to the `ANALYTICS_FILES` array at the bottom.
 */

// ────────────────────────────────────────────────────────────
// Main Dispatcher
// ────────────────────────────────────────────────────────────

export const MAIN_PY = `"""
Analytics Engine — Main Dispatcher

Reads input.json, dispatches to the correct module based on 'action'.
Each module must export a run(data, params, chart_config) -> dict function.

Input validation runs BEFORE dispatch — catches bad data early with
clear error messages instead of cryptic pandas/numpy exceptions.
"""

import json
import sys
import os

# Ensure venv packages are available (from snapshot)
sys.path.insert(0, '/home/agentuity/venv/lib/python3.13/site-packages')


# ── Input Validation ─────────────────────────────────────────

# Minimum row requirements per action category
MIN_ROWS = {
    'chart.': 2,       # Charts need at least 2 data points
    'forecast.': 14,   # Forecasting needs meaningful history
    'classify.': 5,    # Classification needs enough items to segment
    'anomaly.': 10,    # Anomaly detection needs baseline data
    'pricing.': 5,     # Pricing analysis needs transaction history
}

# Required column patterns per action (at least one must match)
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
    """
    Validate input data before dispatching to analytics modules.

    Returns None if valid, or a dict with error details if invalid.
    Checks:
      1. Data is a non-empty list of dicts
      2. Minimum row count for the action category
      3. Required columns exist (where defined)
      4. At least one numeric column exists
    """
    # Check data is a list
    if not isinstance(data, list):
        return {
            "error": f"Expected data to be a list, got {type(data).__name__}",
            "hint": "Ensure the SQL query returns rows as an array of objects",
        }

    # Check non-empty
    if len(data) == 0:
        return {
            "error": "No data rows provided",
            "hint": "The SQL query returned 0 rows. Check date filters and table names.",
        }

    # Check rows are dicts
    if not isinstance(data[0], dict):
        return {
            "error": f"Expected rows to be dicts, got {type(data[0]).__name__}",
            "hint": "Each row should be a JSON object with column names as keys",
        }

    # Check minimum row count
    for prefix, min_count in MIN_ROWS.items():
        if action.startswith(prefix) and len(data) < min_count:
            return {
                "error": f"Insufficient data: {action} requires at least {min_count} rows, got {len(data)}",
                "hint": f"Expand date range or reduce filters to get more data points",
                "rowCount": len(data),
                "minRequired": min_count,
            }

    # Check required columns (if defined for this action)
    available_cols = set(data[0].keys())
    col_requirements = REQUIRED_COLUMNS.get(action, {})

    for role, candidates in col_requirements.items():
        if not any(c in available_cols for c in candidates):
            return {
                "error": f"Missing required '{role}' column for {action}",
                "hint": f"Expected one of: {candidates}. Available columns: {sorted(available_cols)}",
                "availableColumns": sorted(available_cols),
                "expectedOneOf": candidates,
            }

    # Check at least one numeric-ish column exists (heuristic)
    sample = data[0]
    has_numeric = False
    for key, val in sample.items():
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
        return {
            "error": "No numeric columns detected in data",
            "hint": "Analytics requires at least one numeric column (revenue, quantity, amount, etc.)",
            "sampleRow": {k: type(v).__name__ for k, v in sample.items()},
        }

    return None  # Valid


def main():
    with open('input.json', 'r') as f:
        payload = json.load(f)

    action = payload['action']
    data = payload.get('data', [])
    params = payload.get('params', {})
    chart_config = payload.get('chartConfig', {})

    try:
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
        elif action == 'anomaly.pricing':
            from anomaly.price_anomaly import run
        elif action == 'pricing.elasticity':
            from pricing.elasticity import run
        elif action == 'pricing.markdown':
            from pricing.markdown import run
        elif action == 'pricing.dynamic':
            from pricing.dynamic import run
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
`;

// ────────────────────────────────────────────────────────────
// Chart Utilities (charts/__init__.py)
// ────────────────────────────────────────────────────────────

export const CHARTS_INIT_PY = `"""
Chart Utilities — Shared helpers for all chart modules.
Handles brand-aware styling, currency formatting, base64 encoding.
"""

import io
import base64
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker


def apply_style(chart_config: dict) -> dict:
    """Apply brand-aware styling from chart_config. Returns resolved colors."""
    style = chart_config.get('chartStyle', 'modern')

    if style == 'minimal':
        plt.style.use('seaborn-v0_8-whitegrid')
    elif style == 'classic':
        plt.style.use('classic')
    else:
        plt.style.use('seaborn-v0_8-darkgrid')

    colors = {
        'primary': chart_config.get('primaryColor', '#3b82f6'),
        'secondary': chart_config.get('secondaryColor', '#10b981'),
        'accent': chart_config.get('accentColor', '#f59e0b'),
        'background': chart_config.get('background', '#ffffff'),
        'text': '#1f2937',
        'grid': '#e5e7eb',
    }

    plt.rcParams.update({
        'figure.facecolor': colors['background'],
        'axes.facecolor': colors['background'],
        'text.color': colors['text'],
        'axes.labelcolor': colors['text'],
        'xtick.color': colors['text'],
        'ytick.color': colors['text'],
    })

    font = chart_config.get('fontFamily', 'Inter')
    try:
        plt.rcParams['font.family'] = font
    except Exception:
        plt.rcParams['font.family'] = 'sans-serif'

    return colors


def format_currency(value, chart_config: dict) -> str:
    """Format a number as currency using chart_config settings."""
    symbol = chart_config.get('currencySymbol', 'KES')
    position = chart_config.get('currencyPosition', 'prefix')

    if abs(value) >= 1_000_000:
        formatted = f"{value/1_000_000:,.1f}M"
    elif abs(value) >= 1_000:
        formatted = f"{value/1_000:,.1f}K"
    else:
        formatted = f"{value:,.0f}"

    if position == 'suffix':
        return f"{formatted} {symbol}"
    return f"{symbol} {formatted}"


def currency_formatter(chart_config: dict):
    """Return a matplotlib FuncFormatter for currency axis labels."""
    def _fmt(x, pos):
        return format_currency(x, chart_config)
    return mticker.FuncFormatter(_fmt)


def fig_to_base64(fig, chart_config: dict, width: int = 800, height: int = 400) -> dict:
    """Convert a matplotlib figure to a base64-encoded PNG dict."""
    dpi = chart_config.get('dpiWeb', 150)

    buf = io.BytesIO()
    fig.savefig(buf, format='png', dpi=dpi, bbox_inches='tight',
                facecolor=fig.get_facecolor(), edgecolor='none')
    buf.seek(0)
    b64 = base64.b64encode(buf.read()).decode('utf-8')
    buf.close()
    plt.close(fig)

    return {
        'format': 'png',
        'data': b64,
        'width': width,
        'height': height,
    }


def get_color_palette(colors: dict, n: int = 6) -> list:
    """Generate a color palette with n colors based on brand colors."""
    base = [colors['primary'], colors['secondary'], colors['accent']]
    extras = ['#6366f1', '#ec4899', '#14b8a6', '#f97316', '#8b5cf6', '#06b6d4']
    palette = base + [c for c in extras if c not in base]
    return palette[:n]


def add_watermark(fig, chart_config: dict):
    """Add watermark text if enabled."""
    if chart_config.get('watermarkEnabled') and chart_config.get('watermarkText'):
        fig.text(0.5, 0.5, chart_config['watermarkText'],
                fontsize=40, color='gray', alpha=0.1,
                ha='center', va='center', rotation=30,
                transform=fig.transFigure)
`;

// ────────────────────────────────────────────────────────────
// Sales Trends Chart
// ────────────────────────────────────────────────────────────

export const SALES_TRENDS_PY = `"""
Sales Trends Chart — Time series line chart with moving averages.
"""

import pandas as pd
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from charts import apply_style, fig_to_base64, currency_formatter, get_color_palette, add_watermark, format_currency


def run(data: list, params: dict, chart_config: dict) -> dict:
    if not data:
        return {"error": "No data provided for sales trends chart"}

    colors = apply_style(chart_config)
    palette = get_color_palette(colors, 8)

    df = pd.DataFrame(data)

    # Normalize date column
    date_col = next((c for c in ['date', 'sale_date', 'created_at', 'order_date'] if c in df.columns), None)
    if not date_col:
        return {"error": "No date column found. Expected: date, sale_date, created_at, or order_date"}

    # Normalize amount column
    amount_col = next((c for c in ['total_amount', 'amount', 'revenue', 'total', 'net_amount'] if c in df.columns), None)
    if not amount_col:
        return {"error": "No amount column found. Expected: total_amount, amount, revenue, or total"}

    df[date_col] = pd.to_datetime(df[date_col])
    df[amount_col] = pd.to_numeric(df[amount_col], errors='coerce').fillna(0)

    # Aggregate by date
    daily = df.groupby(df[date_col].dt.date).agg(
        total=(amount_col, 'sum'),
        count=(amount_col, 'count')
    ).reset_index()
    daily.columns = ['date', 'total', 'count']
    daily['date'] = pd.to_datetime(daily['date'])
    daily = daily.sort_values('date')

    # Moving averages
    ma_window = params.get('movingAverageWindow', 7)
    daily['ma'] = daily['total'].rolling(window=ma_window, min_periods=1).mean()

    # Create figure
    fig, ax = plt.subplots(figsize=(10, 5))

    ax.plot(daily['date'], daily['total'], color=palette[0], alpha=0.4,
            linewidth=1, label='Daily Revenue')
    ax.plot(daily['date'], daily['ma'], color=palette[0], linewidth=2.5,
            label=f'{ma_window}-Day Moving Average')

    lower = daily['ma'] * 0.85
    upper = daily['ma'] * 1.15
    ax.fill_between(daily['date'], lower, upper, color=palette[0], alpha=0.08)

    ax.set_title('Sales Trend', fontsize=14, fontweight='bold', pad=15)
    ax.set_xlabel('')
    ax.set_ylabel('Revenue', fontsize=11)
    ax.yaxis.set_major_formatter(currency_formatter(chart_config))
    ax.xaxis.set_major_formatter(mdates.DateFormatter('%b %d'))
    ax.xaxis.set_major_locator(mdates.AutoDateLocator())
    ax.legend(loc='upper left', framealpha=0.9)
    ax.grid(True, alpha=0.3)
    fig.autofmt_xdate()

    add_watermark(fig, chart_config)
    fig.tight_layout()

    chart = fig_to_base64(fig, chart_config, width=1000, height=500)
    chart['title'] = 'Sales Trend'

    summary = {
        'totalRevenue': float(daily['total'].sum()),
        'totalRevenueFormatted': format_currency(daily['total'].sum(), chart_config),
        'avgDailyRevenue': float(daily['total'].mean()),
        'avgDailyRevenueFormatted': format_currency(daily['total'].mean(), chart_config),
        'peakDay': str(daily.loc[daily['total'].idxmax(), 'date'].date()),
        'peakDayRevenue': float(daily['total'].max()),
        'totalTransactions': int(daily['count'].sum()),
        'days': len(daily),
        'trend': 'up' if daily['ma'].iloc[-1] > daily['ma'].iloc[0] else 'down',
        'trendPct': float(((daily['ma'].iloc[-1] / daily['ma'].iloc[0]) - 1) * 100)
            if daily['ma'].iloc[0] > 0 else 0,
    }

    return {
        'summary': summary,
        'charts': [chart],
    }
`;

// ────────────────────────────────────────────────────────────
// Revenue Heatmap
// ────────────────────────────────────────────────────────────

export const HEATMAP_PY = `"""
Revenue Heatmap — Branch x Time Period intensity heatmap.
"""

import pandas as pd
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import seaborn as sns
from charts import apply_style, fig_to_base64, currency_formatter, add_watermark, format_currency


def run(data: list, params: dict, chart_config: dict) -> dict:
    if not data:
        return {"error": "No data provided for heatmap"}

    colors = apply_style(chart_config)
    df = pd.DataFrame(data)

    date_col = next((c for c in ['date', 'sale_date', 'created_at', 'order_date'] if c in df.columns), None)
    amount_col = next((c for c in ['total_amount', 'amount', 'revenue', 'total'] if c in df.columns), None)
    group_col = next((c for c in ['branch_name', 'warehouse_name', 'location', 'category_name'] if c in df.columns), None)

    if not date_col or not amount_col:
        return {"error": "Missing required columns: need a date column and an amount column"}

    df[date_col] = pd.to_datetime(df[date_col])
    df[amount_col] = pd.to_numeric(df[amount_col], errors='coerce').fillna(0)

    mode = params.get('heatmapMode', 'day_of_week')
    charts = []

    if group_col and df[group_col].nunique() > 1:
        if mode == 'month':
            df['period'] = df[date_col].dt.strftime('%Y-%m')
            period_label = 'Month'
        elif mode == 'week':
            df['period'] = df[date_col].dt.isocalendar().week.astype(str)
            period_label = 'Week'
        else:
            df['period'] = df[date_col].dt.day_name()
            period_label = 'Day of Week'
            day_order = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
            df['period'] = pd.Categorical(df['period'], categories=day_order, ordered=True)

        pivot = df.pivot_table(
            values=amount_col, index=group_col, columns='period',
            aggfunc='sum', fill_value=0
        )

        fig, ax = plt.subplots(figsize=(12, max(4, len(pivot) * 0.6 + 2)))
        sns.heatmap(pivot, annot=True, fmt=',.0f', cmap='YlOrRd',
                    linewidths=0.5, linecolor='white', ax=ax,
                    cbar_kws={'label': 'Revenue', 'format': currency_formatter(chart_config)})
        ax.set_title(f'Revenue Heatmap — {group_col.replace("_", " ").title()} x {period_label}',
                     fontsize=14, fontweight='bold', pad=15)
        ax.set_ylabel('')
        ax.set_xlabel(period_label)
    else:
        if 'hour' not in df.columns:
            df['hour'] = df[date_col].dt.hour
        df['day'] = df[date_col].dt.day_name()
        day_order = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
        df['day'] = pd.Categorical(df['day'], categories=day_order, ordered=True)

        pivot = df.pivot_table(
            values=amount_col, index='day', columns='hour',
            aggfunc='sum', fill_value=0
        )

        fig, ax = plt.subplots(figsize=(14, 5))
        sns.heatmap(pivot, annot=True, fmt=',.0f', cmap='YlOrRd',
                    linewidths=0.5, linecolor='white', ax=ax,
                    cbar_kws={'label': 'Revenue'})
        ax.set_title('Revenue Heatmap — Day x Hour',
                     fontsize=14, fontweight='bold', pad=15)
        ax.set_ylabel('')
        ax.set_xlabel('Hour of Day')

    add_watermark(fig, chart_config)
    fig.tight_layout()

    chart = fig_to_base64(fig, chart_config, width=1200, height=600)
    chart['title'] = 'Revenue Heatmap'
    charts.append(chart)

    if group_col and group_col in df.columns:
        branch_totals = df.groupby(group_col)[amount_col].sum().sort_values(ascending=False)
        top_branch = branch_totals.index[0] if len(branch_totals) > 0 else 'N/A'
        summary = {
            'topBranch': top_branch,
            'topBranchRevenue': float(branch_totals.iloc[0]) if len(branch_totals) > 0 else 0,
            'branchCount': int(df[group_col].nunique()),
            'totalRevenue': float(df[amount_col].sum()),
            'totalRevenueFormatted': format_currency(df[amount_col].sum(), chart_config),
        }
    else:
        summary = {
            'totalRevenue': float(df[amount_col].sum()),
            'totalRevenueFormatted': format_currency(df[amount_col].sum(), chart_config),
        }

    return {
        'summary': summary,
        'charts': charts,
    }
`;

// ────────────────────────────────────────────────────────────
// Pareto Chart (80/20 ABC analysis)
// ────────────────────────────────────────────────────────────

export const PARETO_PY = `"""
Pareto Chart (80/20) — ABC inventory analysis.
Combined bar + cumulative line showing which products drive majority of revenue.
"""

import pandas as pd
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from charts import apply_style, fig_to_base64, currency_formatter, get_color_palette, add_watermark, format_currency


def run(data: list, params: dict, chart_config: dict) -> dict:
    if not data:
        return {"error": "No data provided for Pareto chart"}

    colors = apply_style(chart_config)
    palette = get_color_palette(colors, 3)
    df = pd.DataFrame(data)

    name_col = next((c for c in ['name', 'product_name', 'sku', 'item'] if c in df.columns), None)
    value_col = next((c for c in ['total_revenue', 'revenue', 'total_amount', 'amount', 'value'] if c in df.columns), None)

    if not name_col or not value_col:
        return {"error": "Missing required columns: need a name column and a revenue/value column"}

    df[value_col] = pd.to_numeric(df[value_col], errors='coerce').fillna(0)
    df = df.sort_values(value_col, ascending=False).reset_index(drop=True)

    max_items = params.get('maxItems', 20)
    if len(df) > max_items:
        other_total = df.iloc[max_items:][value_col].sum()
        df = df.head(max_items).copy()
        other_row = pd.DataFrame([{name_col: f'Other ({len(data) - max_items} items)', value_col: other_total}])
        df = pd.concat([df, other_row], ignore_index=True)

    total = df[value_col].sum()
    df['cumulative_pct'] = (df[value_col].cumsum() / total * 100) if total > 0 else 0

    a_threshold = params.get('aThresholdPct', params.get('abc', {}).get('aThresholdPct', 80))
    b_threshold = a_threshold + params.get('bThresholdPct', params.get('abc', {}).get('bThresholdPct', 15))

    bar_colors = []
    for pct in df['cumulative_pct']:
        if pct <= a_threshold:
            bar_colors.append(palette[0])
        elif pct <= b_threshold:
            bar_colors.append(palette[1])
        else:
            bar_colors.append('#9ca3af')

    fig, ax1 = plt.subplots(figsize=(12, 6))
    ax2 = ax1.twinx()

    x = range(len(df))
    ax1.bar(x, df[value_col], color=bar_colors, alpha=0.85, edgecolor='white', linewidth=0.5)
    ax2.plot(x, df['cumulative_pct'], color=palette[2], linewidth=2.5,
             marker='o', markersize=4, zorder=5)

    ax2.axhline(y=a_threshold, color='red', linestyle='--', alpha=0.5, linewidth=1)
    ax2.text(len(df) - 1, a_threshold + 1.5, f'{a_threshold}%', color='red',
             fontsize=9, ha='right', alpha=0.7)

    ax1.set_title('Pareto Analysis — Product Revenue Contribution',
                  fontsize=14, fontweight='bold', pad=15)
    ax1.set_xlabel('')
    ax1.set_ylabel('Revenue', fontsize=11)
    ax2.set_ylabel('Cumulative %', fontsize=11)

    labels = [str(l)[:20] + '...' if len(str(l)) > 20 else str(l) for l in df[name_col].tolist()]
    ax1.set_xticks(list(x))
    ax1.set_xticklabels(labels, rotation=45, ha='right', fontsize=8)

    ax1.yaxis.set_major_formatter(currency_formatter(chart_config))
    ax2.set_ylim(0, 105)
    ax2.yaxis.set_major_formatter(plt.FuncFormatter(lambda y, _: f'{y:.0f}%'))

    from matplotlib.patches import Patch
    legend_elements = [
        Patch(facecolor=palette[0], label=f'A Items (top {a_threshold}% rev)'),
        Patch(facecolor=palette[1], label=f'B Items (next {b_threshold - a_threshold}%)'),
        Patch(facecolor='#9ca3af', label=f'C Items (remaining {100 - b_threshold}%)'),
    ]
    ax1.legend(handles=legend_elements, loc='center left', fontsize=9, framealpha=0.9)
    ax1.grid(True, alpha=0.2, axis='y')

    add_watermark(fig, chart_config)
    fig.tight_layout()

    chart = fig_to_base64(fig, chart_config, width=1200, height=600)
    chart['title'] = 'Pareto Analysis'

    a_count = sum(1 for pct in df['cumulative_pct'] if pct <= a_threshold)
    b_count = sum(1 for pct in df['cumulative_pct'] if a_threshold < pct <= b_threshold)
    c_count = len(df) - a_count - b_count

    a_revenue = float(df.head(a_count)[value_col].sum()) if a_count > 0 else 0
    b_revenue = float(df.iloc[a_count:a_count + b_count][value_col].sum()) if b_count > 0 else 0
    c_revenue = float(df.iloc[a_count + b_count:][value_col].sum())

    summary = {
        'totalProducts': len(data),
        'totalRevenue': float(total),
        'totalRevenueFormatted': format_currency(total, chart_config),
        'aItems': {
            'count': a_count, 'revenue': a_revenue,
            'revenueFormatted': format_currency(a_revenue, chart_config),
            'pct': round(a_revenue / total * 100, 1) if total > 0 else 0,
        },
        'bItems': {
            'count': b_count, 'revenue': b_revenue,
            'revenueFormatted': format_currency(b_revenue, chart_config),
            'pct': round(b_revenue / total * 100, 1) if total > 0 else 0,
        },
        'cItems': {
            'count': c_count, 'revenue': c_revenue,
            'revenueFormatted': format_currency(c_revenue, chart_config),
            'pct': round(c_revenue / total * 100, 1) if total > 0 else 0,
        },
        'topProduct': str(df.iloc[0][name_col]) if len(df) > 0 else 'N/A',
        'topProductRevenue': float(df.iloc[0][value_col]) if len(df) > 0 else 0,
    }

    return {
        'summary': summary,
        'charts': [chart],
    }
`;

// ────────────────────────────────────────────────────────────
// Placeholder __init__.py files for Python package structure
// ────────────────────────────────────────────────────────────

export const EMPTY_INIT_PY = `# Package marker — required for Python module imports\n`;

// ────────────────────────────────────────────────────────────
// File manifest — uploaded to sandbox via command.files
// ────────────────────────────────────────────────────────────

/**
 * All Python files needed in the sandbox, in the format expected by
 * sandboxApi.run({ command: { files: [...] } }).
 *
 * The data payload (input.json) is NOT included here — it's added
 * dynamically by the analytics runner.
 */
export interface SandboxFile {
  path: string;
  content: string;
}

export function getAnalyticsFiles(): SandboxFile[] {
  return [
    // Entry point
    { path: "main.py", content: MAIN_PY },

    // Chart modules
    { path: "charts/__init__.py", content: CHARTS_INIT_PY },
    { path: "charts/sales_trends.py", content: SALES_TRENDS_PY },
    { path: "charts/heatmap.py", content: HEATMAP_PY },
    { path: "charts/pareto.py", content: PARETO_PY },

    // Future module placeholders (so imports don't crash with confusing errors)
    { path: "forecasting/__init__.py", content: EMPTY_INIT_PY },
    { path: "classification/__init__.py", content: EMPTY_INIT_PY },
    { path: "anomaly/__init__.py", content: EMPTY_INIT_PY },
    { path: "pricing/__init__.py", content: EMPTY_INIT_PY },
  ];
}
