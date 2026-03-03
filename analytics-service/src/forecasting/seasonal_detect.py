"""
Seasonal Cycle Detection -- Auto-detect seasonal cycles using FFT.

NEW Tier 2 module. Input: daily time series with date and amount columns.
Minimum 90 rows; 365 for annual detection.
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

from src.charts import apply_style, fig_to_base64, get_color_palette, add_watermark

logger = logging.getLogger(__name__)

# Map dominant periods to human-readable labels
PERIOD_LABELS = {
    (5, 9): "weekly",
    (25, 35): "monthly",
    (80, 100): "quarterly",
    (340, 390): "annual",
}


def _classify_period(period_days: float) -> str:
    """Map a period in days to a human-readable cycle name."""
    for (lo, hi), label in PERIOD_LABELS.items():
        if lo <= period_days <= hi:
            return label
    return f"{period_days:.0f}-day"


def run(data: list[dict[str, Any]], params: dict[str, Any], chart_config: dict[str, Any] | None = None) -> dict[str, Any]:
    chart_config = chart_config or {}
    if not data:
        return {"success": False, "error": "No data provided for seasonal detection"}

    if len(data) < 90:
        return {
            "success": False,
            "error": f"Seasonal detection requires at least 90 data points, got {len(data)}. "
                     "Provide at least 90 days of daily data for reliable cycle detection.",
        }

    colors = apply_style(chart_config)
    palette = get_color_palette(colors, 6)

    df = pd.DataFrame(data)

    date_col = next((c for c in ["date", "sale_date", "created_at", "order_date"] if c in df.columns), None)
    value_col = next((c for c in ["amount", "total_amount", "revenue", "total", "quantity", "count"] if c in df.columns), None)

    if not date_col:
        return {"success": False, "error": "No date column found"}
    if not value_col:
        return {"success": False, "error": "No value column found"}

    df[date_col] = pd.to_datetime(df[date_col])
    df[value_col] = pd.to_numeric(df[value_col], errors="coerce").fillna(0)

    # Aggregate to daily
    daily = df.groupby(df[date_col].dt.date)[value_col].sum().reset_index()
    daily.columns = ["date", "value"]
    daily["date"] = pd.to_datetime(daily["date"])
    daily = daily.sort_values("date").set_index("date")
    daily = daily.asfreq("D", fill_value=0)

    series = daily["value"].values
    n = len(series)

    if n < 90:
        return {
            "success": False,
            "error": f"After aggregation, only {n} daily data points. Need at least 90.",
        }

    # Remove trend via differencing for cleaner FFT
    detrended = series - pd.Series(series).rolling(window=min(30, n // 3), min_periods=1, center=True).mean().values

    # Apply FFT
    fft_vals = np.fft.rfft(detrended)
    fft_power = np.abs(fft_vals) ** 2
    freqs = np.fft.rfftfreq(n, d=1.0)  # d=1 day

    # Skip DC component (index 0) and very low frequencies
    min_freq_idx = max(1, int(n / (n * 0.9)))  # skip first bin
    fft_power[:min_freq_idx] = 0

    # Find dominant peaks
    # Only consider periods between 3 days and n/2 days
    valid_mask = (freqs > 0) & (1.0 / freqs <= n / 2) & (1.0 / freqs >= 3)
    valid_power = fft_power.copy()
    valid_power[~valid_mask] = 0

    # Find top peaks
    num_peaks = params.get("maxCycles", 5)
    peak_indices = np.argsort(valid_power)[-num_peaks:][::-1]

    total_power = valid_power.sum()
    detected_cycles = []

    for idx in peak_indices:
        if valid_power[idx] <= 0 or freqs[idx] <= 0:
            continue
        period_days = 1.0 / freqs[idx]
        strength = float(valid_power[idx] / total_power) if total_power > 0 else 0
        if strength < 0.02:  # Skip very weak signals
            continue
        cycle_name = _classify_period(period_days)
        detected_cycles.append({
            "period_days": round(period_days, 1),
            "label": cycle_name,
            "strength": round(strength, 4),
        })

    # Sort by strength
    detected_cycles.sort(key=lambda c: c["strength"], reverse=True)

    dominant = detected_cycles[0] if detected_cycles else None

    # Chart: FFT power spectrum
    fig, axes = plt.subplots(1, 2, figsize=(14, 5))

    # Left: Time series with trend
    axes[0].plot(daily.index, series, color=palette[0], alpha=0.5, linewidth=1, label="Daily")
    ma = pd.Series(series).rolling(window=min(30, n // 3), min_periods=1, center=True).mean()
    axes[0].plot(daily.index, ma.values, color=palette[1], linewidth=2, label="30-day MA")
    axes[0].set_title("Time Series", fontsize=12, fontweight="bold")
    axes[0].set_ylabel("Value")
    axes[0].legend(fontsize=8)
    axes[0].grid(True, alpha=0.3)
    fig.autofmt_xdate()

    # Right: Power spectrum (period in days on x-axis)
    valid_freqs = freqs[freqs > 0]
    valid_periods = 1.0 / valid_freqs
    valid_powers = fft_power[freqs > 0]

    # Only show periods up to n/2
    show_mask = valid_periods <= n / 2
    axes[1].plot(valid_periods[show_mask], valid_powers[show_mask], color=palette[0], linewidth=1.5)

    # Mark detected peaks
    for cycle in detected_cycles[:5]:
        axes[1].axvline(cycle["period_days"], color="red", linestyle="--", alpha=0.5)
        axes[1].text(cycle["period_days"], axes[1].get_ylim()[1] * 0.9,
                     f'{cycle["label"]}\n({cycle["period_days"]:.0f}d)',
                     ha="center", fontsize=8, color="red")

    axes[1].set_xlabel("Period (days)")
    axes[1].set_ylabel("Power")
    axes[1].set_title("Frequency Spectrum", fontsize=12, fontweight="bold")
    axes[1].grid(True, alpha=0.3)
    axes[1].set_xscale("log")

    add_watermark(fig, chart_config)
    fig.tight_layout()
    chart = fig_to_base64(fig, chart_config, width=1400, height=500)
    chart["title"] = "Seasonal Cycle Detection"

    summary = {
        "dataPoints": n,
        "detectedCycles": detected_cycles,
        "dominantPeriod": dominant["period_days"] if dominant else None,
        "dominantLabel": dominant["label"] if dominant else None,
        "strengthScore": dominant["strength"] if dominant else 0,
        "cycleCount": len(detected_cycles),
    }

    table = {
        "columns": ["Rank", "Cycle", "Period (days)", "Strength"],
        "rows": [
            [i + 1, c["label"], c["period_days"], f'{c["strength"]:.2%}']
            for i, c in enumerate(detected_cycles)
        ],
    }

    return {
        "success": True,
        "summary": summary,
        "charts": [chart],
        "table": table,
    }
