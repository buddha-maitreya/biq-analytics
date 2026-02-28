"""
Forecast Plot — Actual vs Predicted with confidence fan.

Renders historical actuals alongside model predictions with confidence
intervals displayed as a shaded fan chart. Works with output from any
of the forecasting modules (Prophet, ARIMA, Holt-Winters).

Input data:
  [{ "date": "2026-01-15", "actual": 500, "predicted": 480,
     "lower": 420, "upper": 540 }, ...]
"""

import pandas as pd
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from charts import apply_style, fig_to_base64, get_color_palette, add_watermark, format_currency, currency_formatter


def run(data: list, params: dict, chart_config: dict) -> dict:
    if not data:
        return {"error": "No data provided"}

    colors = apply_style(chart_config)
    palette = get_color_palette(colors, 6)

    df = pd.DataFrame(data)

    # Resolve columns
    date_col = next((c for c in ['date', 'ds', 'period', 'timestamp'] if c in df.columns), None)
    actual_col = next((c for c in ['actual', 'y', 'observed', 'value', 'amount'] if c in df.columns), None)
    pred_col = next((c for c in ['predicted', 'yhat', 'forecast', 'prediction'] if c in df.columns), None)
    lower_col = next((c for c in ['lower', 'yhat_lower', 'lower_bound', 'ci_lower'] if c in df.columns), None)
    upper_col = next((c for c in ['upper', 'yhat_upper', 'upper_bound', 'ci_upper'] if c in df.columns), None)

    if not date_col:
        return {"error": "No date column found"}

    df[date_col] = pd.to_datetime(df[date_col])
    df = df.sort_values(date_col)

    for col in [actual_col, pred_col, lower_col, upper_col]:
        if col:
            df[col] = pd.to_numeric(df[col], errors='coerce')

    # ── Chart ──
    fig, ax = plt.subplots(figsize=(14, 6))

    # Confidence interval fan
    if lower_col and upper_col:
        ci_mask = df[lower_col].notna() & df[upper_col].notna()
        ax.fill_between(
            df.loc[ci_mask, date_col], df.loc[ci_mask, lower_col], df.loc[ci_mask, upper_col],
            alpha=0.15, color=palette[1], label='Confidence Interval'
        )

    # Actual line
    if actual_col:
        actual_mask = df[actual_col].notna()
        ax.plot(df.loc[actual_mask, date_col], df.loc[actual_mask, actual_col],
                color=palette[0], linewidth=2, label='Actual', marker='o', markersize=3)

    # Predicted line
    if pred_col:
        pred_mask = df[pred_col].notna()
        ax.plot(df.loc[pred_mask, date_col], df.loc[pred_mask, pred_col],
                color=palette[1], linewidth=2, linestyle='--', label='Predicted')

    # Forecast boundary line (where actual ends and forecast begins)
    if actual_col and pred_col:
        last_actual_date = df.loc[df[actual_col].notna(), date_col].max()
        ax.axvline(last_actual_date, color='gray', linestyle=':', alpha=0.5, label='Forecast start')

    ax.set_xlabel('Date')
    ax.set_ylabel('Value')
    title = params.get('title', 'Actual vs Forecast')
    ax.set_title(title, fontsize=14, fontweight='bold')
    ax.legend(fontsize=9, loc='best')

    # Format dates
    ax.xaxis.set_major_formatter(mdates.DateFormatter('%b %d'))
    ax.xaxis.set_major_locator(mdates.AutoDateLocator())
    fig.autofmt_xdate()

    # Y-axis currency formatting if configured
    if chart_config.get('currencySymbol'):
        ax.yaxis.set_major_formatter(currency_formatter(chart_config))

    ax.grid(True, alpha=0.2)
    add_watermark(fig, chart_config)
    fig.tight_layout()
    chart = fig_to_base64(fig, chart_config, width=1400, height=600)
    chart['title'] = title

    # ── Compute accuracy metrics ──
    both_mask = pd.Series(True, index=df.index)
    if actual_col:
        both_mask &= df[actual_col].notna()
    if pred_col:
        both_mask &= df[pred_col].notna()

    metrics = {}
    if actual_col and pred_col and both_mask.sum() > 0:
        actual = df.loc[both_mask, actual_col]
        predicted = df.loc[both_mask, pred_col]
        errors = actual - predicted
        abs_errors = errors.abs()

        metrics = {
            'mae': round(float(abs_errors.mean()), 2),
            'rmse': round(float(np.sqrt((errors**2).mean())), 2),
            'mape': round(float((abs_errors / actual.replace(0, np.nan)).dropna().mean() * 100), 2),
            'dataPoints': int(both_mask.sum()),
        }

    # ── Summary ──
    summary = {
        'totalDataPoints': len(df),
        **metrics,
    }

    if actual_col and df[actual_col].notna().sum() > 0:
        summary['actualMean'] = round(float(df[actual_col].dropna().mean()), 2)
        summary['actualTotal'] = round(float(df[actual_col].dropna().sum()), 2)

    if pred_col and df[pred_col].notna().sum() > 0:
        # Future predictions (where actual is NaN)
        future_mask = df[pred_col].notna() & (df[actual_col].isna() if actual_col else True)
        if future_mask.sum() > 0:
            summary['forecastMean'] = round(float(df.loc[future_mask, pred_col].mean()), 2)
            summary['forecastTotal'] = round(float(df.loc[future_mask, pred_col].sum()), 2)
            summary['forecastDays'] = int(future_mask.sum())

    # ── Table ──
    table_cols = ['Date']
    if actual_col:
        table_cols.append('Actual')
    if pred_col:
        table_cols.append('Predicted')
    if lower_col:
        table_cols.append('Lower CI')
    if upper_col:
        table_cols.append('Upper CI')
    if actual_col and pred_col:
        table_cols.append('Error')

    table = {
        'columns': table_cols,
        'rows': [],
    }
    for _, row in df.tail(60).iterrows():
        r = [row[date_col].strftime('%Y-%m-%d')]
        if actual_col:
            r.append(format_currency(row[actual_col], chart_config) if pd.notna(row[actual_col]) else '—')
        if pred_col:
            r.append(format_currency(row[pred_col], chart_config) if pd.notna(row[pred_col]) else '—')
        if lower_col:
            r.append(format_currency(row[lower_col], chart_config) if pd.notna(row[lower_col]) else '—')
        if upper_col:
            r.append(format_currency(row[upper_col], chart_config) if pd.notna(row[upper_col]) else '—')
        if actual_col and pred_col:
            if pd.notna(row[actual_col]) and pd.notna(row[pred_col]):
                err = row[actual_col] - row[pred_col]
                r.append(format_currency(err, chart_config))
            else:
                r.append('—')
        table['rows'].append(r)

    return {
        'summary': summary,
        'charts': [chart],
        'table': table,
    }
