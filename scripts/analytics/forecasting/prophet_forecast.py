"""
Prophet Forecast — Per-product demand prediction with holiday calendar.

Uses Facebook Prophet for additive/multiplicative seasonal decomposition.
Supports country-specific holidays (Kenyan by default).

Input data format:
  [{ "date": "2026-01-15", "quantity": 42, "product_name": "Widget A" }, ...]

Params:
  horizonDays (int, default 30)
  confidenceInterval (float, default 0.95)
  seasonalityMode ("additive" | "multiplicative")
  includeHolidays (bool)
  holidayCountry (str, ISO 3166-1, default "KE")
"""

import pandas as pd
import numpy as np
import json
import sys

# Prophet may not be installed — graceful fallback
try:
    from prophet import Prophet
    HAS_PROPHET = True
except ImportError:
    HAS_PROPHET = False

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from charts import apply_style, fig_to_base64, format_currency, get_color_palette, add_watermark


def run(data: list, params: dict, chart_config: dict) -> dict:
    if not HAS_PROPHET:
        return {"error": "Prophet is not installed in the sandbox. Install with: pip install prophet"}

    if not data:
        return {"error": "No data provided for Prophet forecast"}

    colors = apply_style(chart_config)
    palette = get_color_palette(colors, 6)

    df = pd.DataFrame(data)

    # Resolve date column
    date_col = None
    for col in ['date', 'sale_date', 'created_at', 'order_date']:
        if col in df.columns:
            date_col = col
            break
    if not date_col:
        return {"error": "No date column found. Expected: date, sale_date, created_at, or order_date"}

    # Resolve value column
    value_col = None
    for col in ['quantity', 'total_amount', 'amount', 'revenue', 'total', 'count']:
        if col in df.columns:
            value_col = col
            break
    if not value_col:
        return {"error": "No value column found. Expected: quantity, total_amount, amount, revenue, or count"}

    df[date_col] = pd.to_datetime(df[date_col])
    df[value_col] = pd.to_numeric(df[value_col], errors='coerce').fillna(0)

    # Aggregate by date
    daily = df.groupby(df[date_col].dt.date)[value_col].sum().reset_index()
    daily.columns = ['ds', 'y']
    daily['ds'] = pd.to_datetime(daily['ds'])
    daily = daily.sort_values('ds')

    # Prophet configuration
    horizon_days = params.get('horizonDays', 30)
    confidence = params.get('confidenceInterval', 0.95)
    seasonality_mode = params.get('seasonalityMode', 'multiplicative')
    include_holidays = params.get('includeHolidays', True)
    holiday_country = params.get('holidayCountry', 'KE')

    model = Prophet(
        interval_width=confidence,
        seasonality_mode=seasonality_mode,
        daily_seasonality=False,
        weekly_seasonality=params.get('weeklySeasonality', True),
        yearly_seasonality=params.get('yearlySeasonality', True),
        changepoint_prior_scale=params.get('changepointSensitivity', 0.05),
    )

    if include_holidays:
        try:
            model.add_country_holidays(country_name=holiday_country)
        except Exception:
            pass  # Country not supported — continue without holidays

    model.fit(daily)

    future = model.make_future_dataframe(periods=horizon_days)
    forecast = model.predict(future)

    # ── Chart: Actual vs Forecast with confidence intervals ──
    fig, ax = plt.subplots(figsize=(10, 5))

    # Historical actuals
    ax.plot(daily['ds'], daily['y'], color=palette[0], linewidth=1.5,
            alpha=0.7, label='Actual', marker='.', markersize=3)

    # Forecast line (including historical fit)
    forecast_future = forecast[forecast['ds'] > daily['ds'].max()]
    ax.plot(forecast_future['ds'], forecast_future['yhat'], color=palette[1],
            linewidth=2, label=f'Forecast ({horizon_days}d)', linestyle='--')

    # Confidence intervals
    ax.fill_between(forecast_future['ds'],
                     forecast_future['yhat_lower'],
                     forecast_future['yhat_upper'],
                     color=palette[1], alpha=0.15,
                     label=f'{int(confidence*100)}% CI')

    ax.set_title('Demand Forecast (Prophet)', fontsize=14, fontweight='bold', pad=15)
    ax.set_xlabel('')
    ax.set_ylabel(value_col.replace('_', ' ').title(), fontsize=11)
    ax.legend(loc='upper left', framealpha=0.9)
    ax.grid(True, alpha=0.3)
    fig.autofmt_xdate()
    add_watermark(fig, chart_config)
    fig.tight_layout()

    chart = fig_to_base64(fig, chart_config, width=1000, height=500)
    chart['title'] = 'Demand Forecast (Prophet)'

    # ── Summary statistics ──
    future_forecast = forecast[forecast['ds'] > daily['ds'].max()]
    total_forecast = float(future_forecast['yhat'].sum())
    avg_daily_forecast = float(future_forecast['yhat'].mean())
    peak_day = future_forecast.loc[future_forecast['yhat'].idxmax()]

    # Trend direction
    last_actual_avg = float(daily['y'].tail(7).mean()) if len(daily) >= 7 else float(daily['y'].mean())
    first_forecast_avg = float(future_forecast['yhat'].head(7).mean())
    trend_pct = ((first_forecast_avg / last_actual_avg) - 1) * 100 if last_actual_avg > 0 else 0

    summary = {
        'model': 'Prophet',
        'horizonDays': horizon_days,
        'confidenceInterval': confidence,
        'seasonalityMode': seasonality_mode,
        'totalForecast': total_forecast,
        'avgDailyForecast': avg_daily_forecast,
        'peakForecastDay': str(peak_day['ds'].date()),
        'peakForecastValue': float(peak_day['yhat']),
        'historicalDays': len(daily),
        'historicalAvgDaily': float(daily['y'].mean()),
        'trend': 'up' if trend_pct > 2 else ('down' if trend_pct < -2 else 'stable'),
        'trendPct': round(trend_pct, 1),
    }

    # ── Table: forecast by week ──
    future_forecast = future_forecast.copy()
    future_forecast['week'] = future_forecast['ds'].dt.isocalendar().week
    weekly = future_forecast.groupby('week').agg(
        avg_forecast=('yhat', 'mean'),
        lower=('yhat_lower', 'mean'),
        upper=('yhat_upper', 'mean'),
    ).reset_index()

    table = {
        'columns': ['Week', 'Avg Forecast', 'Lower Bound', 'Upper Bound'],
        'rows': [[int(r['week']), round(r['avg_forecast'], 1),
                   round(r['lower'], 1), round(r['upper'], 1)]
                  for _, r in weekly.iterrows()],
    }

    return {
        'summary': summary,
        'charts': [chart],
        'table': table,
    }
