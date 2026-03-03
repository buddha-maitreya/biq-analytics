"""
Holt-Winters Exponential Smoothing -- Fast, lightweight forecasts.
"""

import logging
import warnings
from typing import Any

warnings.filterwarnings("ignore")

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd
import numpy as np
from statsmodels.tsa.holtwinters import ExponentialSmoothing

from src.charts import apply_style, fig_to_base64, get_color_palette, add_watermark

logger = logging.getLogger(__name__)


def run(data: list[dict[str, Any]], params: dict[str, Any], chart_config: dict[str, Any] | None = None) -> dict[str, Any]:
    chart_config = chart_config or {}
    if not data:
        return {"success": False, "error": "No data provided for Holt-Winters forecast"}

    colors = apply_style(chart_config)
    palette = get_color_palette(colors, 6)

    df = pd.DataFrame(data)

    date_col = next((c for c in ["date", "sale_date", "created_at", "order_date"] if c in df.columns), None)
    value_col = next((c for c in ["quantity", "total_amount", "amount", "revenue", "total"] if c in df.columns), None)

    if not date_col:
        return {"success": False, "error": "No date column found"}
    if not value_col:
        return {"success": False, "error": "No value column found"}

    df[date_col] = pd.to_datetime(df[date_col])
    df[value_col] = pd.to_numeric(df[value_col], errors="coerce").fillna(0)

    daily = df.groupby(df[date_col].dt.date)[value_col].sum().reset_index()
    daily.columns = ["date", "value"]
    daily["date"] = pd.to_datetime(daily["date"])
    daily = daily.sort_values("date").set_index("date")
    daily = daily.asfreq("D", fill_value=0)

    series = daily["value"]

    horizon = params.get("horizonDays", 30)
    seasonal_periods = params.get("seasonalPeriods", 7)
    trend_type = params.get("trend", "add")
    seasonal_type = params.get("seasonal", "add")
    damped = params.get("dampedTrend", True)

    if len(series) < seasonal_periods * 2:
        seasonal_type = None
        seasonal_periods = None

    if seasonal_type == "mul" and (series <= 0).any():
        seasonal_type = "add"
    if trend_type == "mul" and (series <= 0).any():
        trend_type = "add"

    try:
        model = ExponentialSmoothing(
            series, trend=trend_type, seasonal=seasonal_type,
            seasonal_periods=seasonal_periods, damped_trend=damped,
        )
        fit = model.fit(optimized=True)
    except Exception as e:
        return {"success": False, "error": f"Holt-Winters fitting failed: {str(e)}"}

    forecast = fit.forecast(horizon)
    forecast_dates = pd.date_range(start=series.index[-1] + pd.Timedelta(days=1), periods=horizon, freq="D")

    residuals = fit.resid.dropna()
    residual_std = residuals.std() if len(residuals) > 0 else 0
    ci_lower = forecast - 1.96 * residual_std
    ci_upper = forecast + 1.96 * residual_std

    fig, ax = plt.subplots(figsize=(10, 5))
    ax.plot(series.index, series.values, color=palette[0], linewidth=1.5, alpha=0.7, label="Actual")
    ax.plot(forecast_dates, forecast.values, color=palette[2], linewidth=2, linestyle="--",
            label=f"Holt-Winters ({horizon}d)")
    ax.fill_between(forecast_dates, ci_lower.values, ci_upper.values,
                     color=palette[2], alpha=0.12, label="95% CI")

    label_parts = []
    if trend_type:
        label_parts.append(f"trend={trend_type}")
    if seasonal_type:
        label_parts.append(f"seasonal={seasonal_type}")
    if damped:
        label_parts.append("damped")
    config_str = ", ".join(label_parts)

    ax.set_title(f"Holt-Winters Forecast ({config_str})", fontsize=13, fontweight="bold", pad=15)
    ax.set_ylabel(value_col.replace("_", " ").title(), fontsize=11)
    ax.legend(loc="upper left", framealpha=0.9)
    ax.grid(True, alpha=0.3)
    fig.autofmt_xdate()
    add_watermark(fig, chart_config)
    fig.tight_layout()

    chart = fig_to_base64(fig, chart_config, width=1000, height=500)
    chart["title"] = "Holt-Winters Forecast"

    summary = {
        "model": "Holt-Winters",
        "trend": trend_type,
        "seasonal": seasonal_type,
        "seasonalPeriods": seasonal_periods,
        "dampedTrend": damped,
        "horizonDays": horizon,
        "totalForecast": float(forecast.sum()),
        "avgDailyForecast": float(forecast.mean()),
        "historicalDays": len(series),
        "historicalAvgDaily": float(series.mean()),
        "aic": round(float(fit.aic), 1) if hasattr(fit, "aic") else None,
        "trend_direction": "up" if forecast.mean() > series.tail(7).mean() else "down",
    }

    return {
        "success": True,
        "summary": summary,
        "charts": [chart],
    }
