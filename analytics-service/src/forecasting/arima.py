"""
ARIMA/SARIMA Forecast -- For products with strong seasonal patterns.
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
from statsmodels.tsa.statespace.sarimax import SARIMAX
from statsmodels.tsa.stattools import adfuller

from src.charts import apply_style, fig_to_base64, get_color_palette, add_watermark

logger = logging.getLogger(__name__)


def _auto_order(series, max_p=5, max_d=2, max_q=5, seasonal=True, period=7):
    """Simple AIC-based grid search for SARIMA order."""
    best_aic = np.inf
    best_order = (1, 1, 1)
    best_seasonal = (0, 0, 0, period)

    d = 0
    temp = series.copy()
    for i in range(max_d + 1):
        result = adfuller(temp.dropna(), autolag="AIC")
        if result[1] < 0.05:
            d = i
            break
        temp = temp.diff().dropna()
        d = i + 1
    d = min(d, max_d)

    p_range = range(0, min(max_p + 1, 4))
    q_range = range(0, min(max_q + 1, 4))

    for p in p_range:
        for q in q_range:
            try:
                order = (p, d, q)
                s_order = (1, 1, 0, period) if seasonal and period > 1 else (0, 0, 0, 0)
                model = SARIMAX(series, order=order, seasonal_order=s_order,
                                enforce_stationarity=False, enforce_invertibility=False)
                fit = model.fit(disp=False, maxiter=50)
                if fit.aic < best_aic:
                    best_aic = fit.aic
                    best_order = order
                    best_seasonal = s_order
            except Exception:
                continue

    return best_order, best_seasonal, best_aic


def run(data: list[dict[str, Any]], params: dict[str, Any], chart_config: dict[str, Any] | None = None) -> dict[str, Any]:
    chart_config = chart_config or {}
    if not data:
        return {"success": False, "error": "No data provided for ARIMA forecast"}

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
    if len(series) < 14:
        return {"success": False, "error": f"ARIMA requires at least 14 data points, got {len(series)}"}

    horizon = params.get("horizonDays", 30)
    seasonal = params.get("seasonal", True)
    period = params.get("seasonalPeriod", 7)
    auto = params.get("autoOrder", True)

    if auto:
        order, s_order, aic = _auto_order(
            series, max_p=params.get("maxP", 5), max_d=params.get("maxD", 2),
            max_q=params.get("maxQ", 5), seasonal=seasonal, period=period,
        )
    else:
        order = (1, 1, 1)
        s_order = (1, 1, 0, period) if seasonal else (0, 0, 0, 0)
        aic = None

    try:
        model = SARIMAX(series, order=order, seasonal_order=s_order,
                        enforce_stationarity=False, enforce_invertibility=False)
        fit = model.fit(disp=False, maxiter=200)
    except Exception as e:
        return {"success": False, "error": f"ARIMA model fitting failed: {str(e)}"}

    fc = fit.get_forecast(steps=horizon)
    forecast_mean = fc.predicted_mean
    ci = fc.conf_int(alpha=0.05)
    forecast_dates = pd.date_range(start=series.index[-1] + pd.Timedelta(days=1), periods=horizon, freq="D")

    fig, ax = plt.subplots(figsize=(10, 5))
    ax.plot(series.index, series.values, color=palette[0], linewidth=1.5, alpha=0.7, label="Actual")
    ax.plot(forecast_dates, forecast_mean.values, color=palette[1], linewidth=2, linestyle="--",
            label=f"SARIMA Forecast ({horizon}d)")
    ax.fill_between(forecast_dates, ci.iloc[:, 0].values, ci.iloc[:, 1].values,
                     color=palette[1], alpha=0.15, label="95% CI")

    ax.set_title(f"SARIMA{order}x{s_order} Forecast", fontsize=14, fontweight="bold", pad=15)
    ax.set_ylabel(value_col.replace("_", " ").title(), fontsize=11)
    ax.legend(loc="upper left", framealpha=0.9)
    ax.grid(True, alpha=0.3)
    fig.autofmt_xdate()
    add_watermark(fig, chart_config)
    fig.tight_layout()

    chart = fig_to_base64(fig, chart_config, width=1000, height=500)
    chart["title"] = "SARIMA Forecast"

    summary = {
        "model": "SARIMA",
        "order": list(order),
        "seasonalOrder": list(s_order),
        "aic": round(float(fit.aic), 1) if hasattr(fit, "aic") else aic,
        "horizonDays": horizon,
        "totalForecast": float(forecast_mean.sum()),
        "avgDailyForecast": float(forecast_mean.mean()),
        "historicalDays": len(series),
        "historicalAvgDaily": float(series.mean()),
        "trend": "up" if forecast_mean.mean() > series.tail(7).mean() else "down",
    }

    return {
        "success": True,
        "summary": summary,
        "charts": [chart],
    }
