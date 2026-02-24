"""
Sales Trends Chart — Time series line chart with moving averages.

Input data format:
  [{ "date": "2026-01-15", "total_amount": 15000, "branch_name": "Main" }, ...]

Output:
  { "summary": { ... }, "charts": [{ "title": ..., "format": "png", "data": "base64...", ... }] }
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
    date_col = None
    for col in ['date', 'sale_date', 'created_at', 'order_date']:
        if col in df.columns:
            date_col = col
            break
    if not date_col:
        return {"error": "No date column found. Expected: date, sale_date, created_at, or order_date"}

    # Normalize amount column
    amount_col = None
    for col in ['total_amount', 'amount', 'revenue', 'total', 'net_amount']:
        if col in df.columns:
            amount_col = col
            break
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

    # Revenue line
    ax.plot(daily['date'], daily['total'], color=palette[0], alpha=0.4,
            linewidth=1, label='Daily Revenue')
    
    # Moving average line
    ax.plot(daily['date'], daily['ma'], color=palette[0], linewidth=2.5,
            label=f'{ma_window}-Day Moving Average')

    # Fill between for confidence band
    lower = daily['ma'] * 0.85
    upper = daily['ma'] * 1.15
    ax.fill_between(daily['date'], lower, upper, color=palette[0], alpha=0.08)

    # Formatting
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

    # Summary stats
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
