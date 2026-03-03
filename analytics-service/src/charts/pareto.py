"""
Pareto Chart (80/20) -- ABC inventory analysis.
"""

import logging
import warnings
from typing import Any

warnings.filterwarnings("ignore")

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Patch
import pandas as pd
import numpy as np

from src.charts import apply_style, fig_to_base64, currency_formatter, get_color_palette, add_watermark, format_currency

logger = logging.getLogger(__name__)


def run(data: list[dict[str, Any]], params: dict[str, Any], chart_config: dict[str, Any] | None = None) -> dict[str, Any]:
    chart_config = chart_config or {}
    if not data:
        return {"success": False, "error": "No data provided for Pareto chart"}

    colors = apply_style(chart_config)
    palette = get_color_palette(colors, 3)

    df = pd.DataFrame(data)

    name_col = next((c for c in ["name", "product_name", "sku", "item"] if c in df.columns), None)
    value_col = next((c for c in ["total_revenue", "revenue", "total_amount", "amount", "value"] if c in df.columns), None)

    if not name_col or not value_col:
        return {"success": False, "error": "Missing required columns: need a name column and a revenue/value column"}

    df[value_col] = pd.to_numeric(df[value_col], errors="coerce").fillna(0)
    df = df.sort_values(value_col, ascending=False).reset_index(drop=True)

    max_items = params.get("maxItems", 20)
    if len(df) > max_items:
        other_total = df.iloc[max_items:][value_col].sum()
        df = df.head(max_items).copy()
        other_row = pd.DataFrame([{name_col: f"Other ({len(data) - max_items} items)", value_col: other_total}])
        df = pd.concat([df, other_row], ignore_index=True)

    total = df[value_col].sum()
    df["cumulative_pct"] = (df[value_col].cumsum() / total * 100) if total > 0 else 0

    a_threshold = params.get("aThresholdPct", params.get("abc", {}).get("aThresholdPct", 80))
    b_threshold = a_threshold + params.get("bThresholdPct", params.get("abc", {}).get("bThresholdPct", 15))

    bar_colors = []
    for pct in df["cumulative_pct"]:
        if pct <= a_threshold:
            bar_colors.append(palette[0])
        elif pct <= b_threshold:
            bar_colors.append(palette[1])
        else:
            bar_colors.append("#9ca3af")

    fig, ax1 = plt.subplots(figsize=(12, 6))
    ax2 = ax1.twinx()

    x = range(len(df))
    ax1.bar(x, df[value_col], color=bar_colors, alpha=0.85, edgecolor="white", linewidth=0.5)
    ax2.plot(x, df["cumulative_pct"], color=palette[2], linewidth=2.5, marker="o", markersize=4, zorder=5)
    ax2.axhline(y=a_threshold, color="red", linestyle="--", alpha=0.5, linewidth=1)
    ax2.text(len(df) - 1, a_threshold + 1.5, f"{a_threshold}%", color="red", fontsize=9, ha="right", alpha=0.7)

    ax1.set_title("Pareto Analysis -- Product Revenue Contribution", fontsize=14, fontweight="bold", pad=15)
    ax1.set_xlabel("")
    ax1.set_ylabel("Revenue", fontsize=11)
    ax2.set_ylabel("Cumulative %", fontsize=11)

    labels = df[name_col].tolist()
    labels = [l[:20] + "..." if len(str(l)) > 20 else str(l) for l in labels]
    ax1.set_xticks(list(x))
    ax1.set_xticklabels(labels, rotation=45, ha="right", fontsize=8)

    ax1.yaxis.set_major_formatter(currency_formatter(chart_config))
    ax2.set_ylim(0, 105)
    ax2.yaxis.set_major_formatter(plt.FuncFormatter(lambda y, _: f"{y:.0f}%"))

    legend_elements = [
        Patch(facecolor=palette[0], label=f"A Items (top {a_threshold}% rev)"),
        Patch(facecolor=palette[1], label=f"B Items (next {b_threshold - a_threshold}%)"),
        Patch(facecolor="#9ca3af", label=f"C Items (remaining {100 - b_threshold}%)"),
    ]
    ax1.legend(handles=legend_elements, loc="center left", fontsize=9, framealpha=0.9)
    ax1.grid(True, alpha=0.2, axis="y")

    add_watermark(fig, chart_config)
    fig.tight_layout()

    chart = fig_to_base64(fig, chart_config, width=1200, height=600)
    chart["title"] = "Pareto Analysis"

    a_count = sum(1 for pct in df["cumulative_pct"] if pct <= a_threshold)
    b_count = sum(1 for pct in df["cumulative_pct"] if a_threshold < pct <= b_threshold)
    c_count = len(df) - a_count - b_count

    a_revenue = float(df.head(a_count)[value_col].sum()) if a_count > 0 else 0
    b_revenue = float(df.iloc[a_count:a_count + b_count][value_col].sum()) if b_count > 0 else 0
    c_revenue = float(df.iloc[a_count + b_count:][value_col].sum())

    summary = {
        "totalProducts": len(data),
        "totalRevenue": float(total),
        "totalRevenueFormatted": format_currency(total, chart_config),
        "aItems": {"count": a_count, "revenue": a_revenue, "revenueFormatted": format_currency(a_revenue, chart_config), "pct": round(a_revenue / total * 100, 1) if total > 0 else 0},
        "bItems": {"count": b_count, "revenue": b_revenue, "revenueFormatted": format_currency(b_revenue, chart_config), "pct": round(b_revenue / total * 100, 1) if total > 0 else 0},
        "cItems": {"count": c_count, "revenue": c_revenue, "revenueFormatted": format_currency(c_revenue, chart_config), "pct": round(c_revenue / total * 100, 1) if total > 0 else 0},
        "topProduct": str(df.iloc[0][name_col]) if len(df) > 0 else "N/A",
        "topProductRevenue": float(df.iloc[0][value_col]) if len(df) > 0 else 0,
    }

    return {
        "success": True,
        "summary": summary,
        "charts": [chart],
    }
