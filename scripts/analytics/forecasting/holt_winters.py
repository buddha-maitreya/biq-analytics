"""
Holt-Winters Exponential Smoothing — Fast, lightweight forecasts.

Best for high-velocity products with clear seasonal patterns.
Much faster than Prophet/ARIMA — suitable for bulk forecasting across many SKUs.

Input data format:
  [{ "date": "2026-01-15", "quantity": 42 }, ...]

Params:
  seasonalPeriods (int, default 7)
  trend ("add" | "mul", default "add")
  seasonal ("add" | "mul", default "add")
  dampedTrend (bool, default True)
  horizonDays (int, default 30)
"""

import pandas as pd
import numpy as np
import warnings
warnings.filterwarnings('ignore')

from statsmodels.tsa.holtwinters import ExponentialSmoothing
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from charts import apply_style, fig_to_base64, get_color_palette, add_watermark


def run(data: list, params: dict, chart_config: dict) -> dict:
    if not data:
        return {"error": "No data provided for Holt-Winters forecast"}

    colors = apply_style(chart_config)
    palette = get_color_palette(colors, 6)

    df = pd.DataFrame(data)

    # Resolve columns
    date_col = next((c for c in ['date', 'sale_date', 'created_at', 'order_date'] if c in df.columns), None)
    value_col = next((c for c in ['quantity', 'total_amount', 'amount', 'revenue', 'total'] if c in df.columns), None)

    if not date_col:
        return {"error": "No date column found"}
    if not value_col:
        return {"error": "No value column found"}

    df[date_col] = pd.to_datetime(df[date_col])
    df[value_col] = pd.to_numeric(df[value_col], errors='coerce').fillna(0)

    daily = df.groupby(df[date_col].dt.date)[value_col].sum().reset_index()
    daily.columns = ['date', 'value']
    daily['date'] = pd.to_datetime(daily['date'])
    daily = daily.sort_values('date').set_index('date')
    daily = daily.asfreq('D', fill_value=0)

    series = daily['value']

    # Parameters
    horizon = params.get('horizonDays', 30)
    seasonal_periods = params.get('seasonalPeriods', 7)
    trend_type = params.get('trend', 'add')
    seasonal_type = params.get('seasonal', 'add')
    damped = params.get('dampedTrend', True)

    if len(series) < seasonal_periods * 2:
        # Not enough data for seasonal — fall back to simple exponential smoothing
        seasonal_type = None
        seasonal_periods = None

    # Multiplicative requires all positive values
    if seasonal_type == 'mul' and (series <= 0).any():
        seasonal_type = 'add'
    if trend_type == 'mul' and (series <= 0).any():
        trend_type = 'add'

    try:
        model = ExponentialSmoothing(
            series,
            trend=trend_type,
            seasonal=seasonal_type,
            seasonal_periods=seasonal_periods,
            damped_trend=damped,
        )
        fit = model.fit(optimized=True)
    except Exception as e:
        return {"error": f"Holt-Winters fitting failed: {str(e)}"}

    # Forecast
    forecast = fit.forecast(horizon)
    forecast_dates = pd.date_range(start=series.index[-1] + pd.Timedelta(days=1), periods=horizon, freq='D')

    # Simple confidence interval estimation (± 1.96 * residual std)
    residuals = fit.resid.dropna()
    residual_std = residuals.std() if len(residuals) > 0 else 0
    ci_lower = forecast - 1.96 * residual_std
    ci_upper = forecast + 1.96 * residual_std

    # ── Chart ──
    fig, ax = plt.subplots(figsize=(10, 5))

    ax.plot(series.index, series.values, color=palette[0], linewidth=1.5,
            alpha=0.7, label='Actual')
    ax.plot(forecast_dates, forecast.values, color=palette[2],
            linewidth=2, linestyle='--', label=f'Holt-Winters ({horizon}d)')
    ax.fill_between(forecast_dates, ci_lower.values, ci_upper.values,
                     color=palette[2], alpha=0.12, label='95% CI')

    label_parts = []
    if trend_type: label_parts.append(f"trend={trend_type}")
    if seasonal_type: label_parts.append(f"seasonal={seasonal_type}")
    if damped: label_parts.append("damped")
    config_str = ", ".join(label_parts)

    ax.set_title(f'Holt-Winters Forecast ({config_str})', fontsize=13, fontweight='bold', pad=15)
    ax.set_ylabel(value_col.replace('_', ' ').title(), fontsize=11)
    ax.legend(loc='upper left', framealpha=0.9)
    ax.grid(True, alpha=0.3)
    fig.autofmt_xdate()
    add_watermark(fig, chart_config)
    fig.tight_layout()

    chart = fig_to_base64(fig, chart_config, width=1000, height=500)
    chart['title'] = 'Holt-Winters Forecast'

    summary = {
        'model': 'Holt-Winters',
        'trend': trend_type,
        'seasonal': seasonal_type,
        'seasonalPeriods': seasonal_periods,
        'dampedTrend': damped,
        'horizonDays': horizon,
        'totalForecast': float(forecast.sum()),
        'avgDailyForecast': float(forecast.mean()),
        'historicalDays': len(series),
        'historicalAvgDaily': float(series.mean()),
        'aic': round(float(fit.aic), 1) if hasattr(fit, 'aic') else None,
        'trend_direction': 'up' if forecast.mean() > series.tail(7).mean() else 'down',
    }

    return {
        'summary': summary,
        'charts': [chart],
    }
