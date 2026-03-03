"""
Supplier Reliability Analysis -- Measures delivery performance.

NEW Tier 2 module. Calculates on-time rates, average delays,
and reliability scores per supplier.

Input: delivery records with supplier_name, promised_date, actual_date, order_value.
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

from src.charts import apply_style, fig_to_base64, get_color_palette, add_watermark, format_currency

logger = logging.getLogger(__name__)


def run(data: list[dict[str, Any]], params: dict[str, Any], chart_config: dict[str, Any] | None = None) -> dict[str, Any]:
    chart_config = chart_config or {}

    if not data:
        return {
            "success": True,
            "summary": {"message": "No delivery data available. This module requires delivery tracking records."},
            "table": None,
        }

    df = pd.DataFrame(data)

    supplier_col = next((c for c in ["supplier_name", "supplier", "vendor"] if c in df.columns), None)
    promised_col = next((c for c in ["promised_date", "expected_date", "due_date"] if c in df.columns), None)
    actual_col = next((c for c in ["actual_date", "delivery_date", "received_date"] if c in df.columns), None)
    value_col = next((c for c in ["order_value", "value", "amount", "total"] if c in df.columns), None)

    if not supplier_col:
        return {"success": False, "error": "No supplier column found"}
    if not promised_col or not actual_col:
        return {"success": False, "error": "Need promised_date and actual_date columns"}

    df[promised_col] = pd.to_datetime(df[promised_col], errors="coerce")
    df[actual_col] = pd.to_datetime(df[actual_col], errors="coerce")
    df = df.dropna(subset=[promised_col, actual_col])

    if len(df) == 0:
        return {
            "success": True,
            "summary": {"message": "No delivery data available. This module requires delivery tracking records."},
            "table": None,
        }

    if value_col:
        df[value_col] = pd.to_numeric(df[value_col], errors="coerce").fillna(0)

    df["delay_days"] = (df[actual_col] - df[promised_col]).dt.days
    df["on_time"] = df["delay_days"] <= 0

    # Per-supplier stats
    suppliers = []
    for supplier, group in df.groupby(supplier_col):
        on_time_rate = group["on_time"].mean() * 100
        avg_delay = group["delay_days"].mean()
        std_delay = group["delay_days"].std() if len(group) > 1 else 0
        total_orders = len(group)
        total_value = group[value_col].sum() if value_col else 0

        # Reliability score: 0-100 based on on-time rate and consistency
        consistency_score = max(0, 100 - std_delay * 10) if std_delay > 0 else 100
        reliability = (on_time_rate * 0.7 + consistency_score * 0.3)

        suppliers.append({
            "supplier": str(supplier),
            "orders": total_orders,
            "on_time_rate": round(on_time_rate, 1),
            "avg_delay_days": round(float(avg_delay), 1),
            "std_delay": round(float(std_delay), 1),
            "reliability_score": round(float(reliability), 1),
            "total_value": round(float(total_value), 2),
        })

    suppliers_df = pd.DataFrame(suppliers).sort_values("reliability_score", ascending=False)

    colors = apply_style(chart_config)
    palette = get_color_palette(colors, 6)

    fig, axes = plt.subplots(1, 2, figsize=(14, 6))

    # Left: Reliability scores
    y_pos = range(len(suppliers_df))
    bar_colors = ["green" if s >= 80 else "orange" if s >= 60 else "red" for s in suppliers_df["reliability_score"]]
    axes[0].barh(y_pos, suppliers_df["reliability_score"], color=bar_colors, alpha=0.8)
    axes[0].set_yticks(y_pos)
    axes[0].set_yticklabels(suppliers_df["supplier"], fontsize=9)
    axes[0].set_xlabel("Reliability Score")
    axes[0].set_title("Supplier Reliability Scores", fontsize=12, fontweight="bold")
    axes[0].set_xlim(0, 100)
    axes[0].axvline(80, color="green", linestyle="--", alpha=0.3)
    axes[0].axvline(60, color="orange", linestyle="--", alpha=0.3)
    axes[0].invert_yaxis()

    # Right: On-time rate vs avg delay scatter
    axes[1].scatter(suppliers_df["avg_delay_days"], suppliers_df["on_time_rate"],
                    s=suppliers_df["orders"] * 5, c=suppliers_df["reliability_score"],
                    cmap="RdYlGn", alpha=0.7, edgecolors="white")
    axes[1].set_xlabel("Avg Delay (days)")
    axes[1].set_ylabel("On-Time Rate (%)")
    axes[1].set_title("Delivery Performance (size = orders)", fontsize=12, fontweight="bold")
    axes[1].axhline(80, color="green", linestyle="--", alpha=0.3)
    axes[1].grid(True, alpha=0.3)

    add_watermark(fig, chart_config)
    fig.tight_layout()
    chart = fig_to_base64(fig, chart_config, width=1400, height=600)
    chart["title"] = "Supplier Reliability Analysis"

    best = suppliers_df.iloc[0] if len(suppliers_df) > 0 else None
    worst = suppliers_df.iloc[-1] if len(suppliers_df) > 0 else None

    summary = {
        "totalSuppliers": len(suppliers_df),
        "totalDeliveries": len(df),
        "overallOnTimeRate": round(float(df["on_time"].mean() * 100), 1),
        "overallAvgDelay": round(float(df["delay_days"].mean()), 1),
        "bestSupplier": best["supplier"] if best is not None else None,
        "bestReliability": best["reliability_score"] if best is not None else None,
        "worstSupplier": worst["supplier"] if worst is not None else None,
        "worstReliability": worst["reliability_score"] if worst is not None else None,
    }

    table = {
        "columns": ["Supplier", "Orders", "On-Time Rate", "Avg Delay", "Reliability Score"],
        "rows": [
            [r["supplier"], r["orders"], f"{r['on_time_rate']}%",
             f"{r['avg_delay_days']} days", f"{r['reliability_score']}/100"]
            for _, r in suppliers_df.iterrows()
        ],
    }

    return {
        "success": True,
        "summary": summary,
        "charts": [chart],
        "table": table,
    }
