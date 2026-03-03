"""
Waterfall Chart -- Revenue contribution breakdown.
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
        return {"success": False, "error": "No data provided"}

    colors = apply_style(chart_config)
    palette = get_color_palette(colors, 6)

    df = pd.DataFrame(data)

    label_col = next((c for c in ["label", "name", "product_name", "category", "period", "month"] if c in df.columns), None)
    value_col = next((c for c in ["value", "revenue", "amount", "total", "contribution", "change"] if c in df.columns), None)

    if not label_col or not value_col:
        return {"success": False, "error": f"Need label and value columns. Found: {list(df.columns)}"}

    df[value_col] = pd.to_numeric(df[value_col], errors="coerce").fillna(0)

    labels = df[label_col].astype(str).tolist()
    values = df[value_col].tolist()

    cumulative = 0
    starts = []
    bar_values = []
    bar_colors = []

    positive_color = palette[0]
    negative_color = palette[3] if len(palette) > 3 else "#ef4444"
    total_color = palette[1]

    for v in values:
        starts.append(cumulative)
        bar_values.append(v)
        bar_colors.append(positive_color if v >= 0 else negative_color)
        cumulative += v

    labels.append("Total")
    starts.append(0)
    bar_values.append(cumulative)
    bar_colors.append(total_color)

    fig, ax = plt.subplots(figsize=(max(10, len(labels) * 0.8), 6))
    x_pos = range(len(labels))

    ax.bar(x_pos, bar_values, bottom=starts, color=bar_colors, alpha=0.85,
           edgecolor="white", linewidth=0.5, width=0.6)

    for i in range(len(values)):
        connector_y = starts[i] + values[i]
        if i < len(values) - 1:
            ax.plot([i + 0.3, i + 0.7], [connector_y, connector_y],
                    color="gray", linewidth=0.8, linestyle="-", alpha=0.5)

    for i, (start, val) in enumerate(zip(starts, bar_values)):
        label_text = format_currency(abs(val), chart_config)
        if val < 0:
            label_text = f"-{label_text}"
        ax.text(i, start + val + (cumulative * 0.01 if val >= 0 else cumulative * -0.01),
                label_text, ha="center", va="bottom" if val >= 0 else "top",
                fontsize=8, fontweight="bold")

    ax.set_xticks(x_pos)
    ax.set_xticklabels(labels, rotation=45, ha="right", fontsize=9)
    ax.set_ylabel("Value")
    ax.set_title("Revenue Waterfall", fontsize=14, fontweight="bold")
    ax.axhline(0, color="black", linewidth=0.5, alpha=0.3)

    add_watermark(fig, chart_config)
    fig.tight_layout()
    chart = fig_to_base64(fig, chart_config, width=max(1000, len(labels) * 80), height=600)
    chart["title"] = "Revenue Waterfall Chart"

    positive_sum = sum(v for v in values if v > 0)
    negative_sum = sum(v for v in values if v < 0)
    summary = {
        "totalValue": round(float(cumulative), 2),
        "positiveContributions": round(float(positive_sum), 2),
        "negativeContributions": round(float(negative_sum), 2),
        "itemCount": len(values),
        "largestPositive": {
            "label": str(labels[values.index(max(values))]) if values else "",
            "value": round(float(max(values)), 2) if values else 0,
        },
        "largestNegative": {
            "label": str(labels[values.index(min(values))]) if values else "",
            "value": round(float(min(values)), 2) if values else 0,
        },
    }

    table = {"columns": ["Item", "Value", "Running Total", "% of Total"], "rows": []}
    running = 0
    for lbl, val in zip(df[label_col].astype(str).tolist(), values):
        running += val
        pct = (val / cumulative * 100) if cumulative != 0 else 0
        table["rows"].append([lbl, format_currency(val, chart_config), format_currency(running, chart_config), f"{pct:.1f}%"])

    return {
        "success": True,
        "summary": summary,
        "charts": [chart],
        "table": table,
    }
