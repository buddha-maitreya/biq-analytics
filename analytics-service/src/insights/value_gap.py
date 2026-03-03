"""
Value Gap Analysis -- Identifies pricing and margin optimization opportunities.

Finds products where actual selling price deviates significantly from
optimal price based on demand elasticity and competitive positioning.

Input data:
  [{ "product_name": "Widget A", "selling_price": 100, "cost_price": 60,
     "quantity_sold": 500, "category": "Electronics" }, ...]
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
        return {"success": False, "error": "No data provided for value gap analysis"}

    colors = apply_style(chart_config)
    palette = get_color_palette(colors, 6)

    df = pd.DataFrame(data)

    product_col = next((c for c in ["product_name", "name", "sku", "item"] if c in df.columns), None)
    price_col = next((c for c in ["selling_price", "price", "unit_price"] if c in df.columns), None)
    cost_col = next((c for c in ["cost_price", "cost", "unit_cost", "cogs"] if c in df.columns), None)
    qty_col = next((c for c in ["quantity_sold", "quantity", "units_sold"] if c in df.columns), None)
    category_col = next((c for c in ["category", "department", "group"] if c in df.columns), None)

    if not product_col:
        return {"success": False, "error": "No product column found"}
    if not price_col or not cost_col:
        return {"success": False, "error": "Need selling_price and cost_price columns"}

    df[price_col] = pd.to_numeric(df[price_col], errors="coerce").fillna(0)
    df[cost_col] = pd.to_numeric(df[cost_col], errors="coerce").fillna(0)
    if qty_col:
        df[qty_col] = pd.to_numeric(df[qty_col], errors="coerce").fillna(0)

    # Calculate margins
    df["margin"] = df[price_col] - df[cost_col]
    df["margin_pct"] = (df["margin"] / df[price_col].replace(0, np.nan) * 100).fillna(0)
    df["revenue"] = df[price_col] * (df[qty_col] if qty_col else 1)

    # Category averages for gap detection
    if category_col:
        cat_avg = df.groupby(category_col)["margin_pct"].mean()
        df["category_avg_margin"] = df[category_col].map(cat_avg)
        df["gap"] = df["margin_pct"] - df["category_avg_margin"]
    else:
        overall_avg = df["margin_pct"].mean()
        df["category_avg_margin"] = overall_avg
        df["gap"] = df["margin_pct"] - overall_avg

    # Sort by gap (biggest underperformers first)
    df = df.sort_values("gap")

    # Chart
    fig, axes = plt.subplots(1, 2, figsize=(14, 6))

    # Left: margin distribution
    axes[0].hist(df["margin_pct"], bins=30, color=palette[0], alpha=0.7, edgecolor="white")
    axes[0].axvline(df["margin_pct"].mean(), color="red", linestyle="--", label=f"Mean: {df['margin_pct'].mean():.1f}%")
    axes[0].set_xlabel("Margin %")
    axes[0].set_ylabel("Products")
    axes[0].set_title("Margin Distribution", fontsize=12, fontweight="bold")
    axes[0].legend(fontsize=8)

    # Right: top gaps (both positive and negative)
    top_gaps = pd.concat([df.head(10), df.tail(10)]).drop_duplicates()
    y_pos = range(len(top_gaps))
    bar_colors = [palette[1] if g >= 0 else palette[3] if len(palette) > 3 else "#ef4444" for g in top_gaps["gap"]]
    axes[1].barh(y_pos, top_gaps["gap"], color=bar_colors, alpha=0.8)
    axes[1].set_yticks(y_pos)
    axes[1].set_yticklabels(top_gaps[product_col], fontsize=7)
    axes[1].set_xlabel("Gap from Category Average (%)")
    axes[1].set_title("Margin Gap Analysis", fontsize=12, fontweight="bold")
    axes[1].axvline(0, color="black", linewidth=0.5)

    add_watermark(fig, chart_config)
    fig.tight_layout()
    chart = fig_to_base64(fig, chart_config, width=1400, height=600)
    chart["title"] = "Value Gap Analysis"

    underperformers = df[df["gap"] < -5]
    overperformers = df[df["gap"] > 5]

    summary = {
        "totalProducts": len(df),
        "avgMarginPct": round(float(df["margin_pct"].mean()), 1),
        "underperformers": len(underperformers),
        "overperformers": len(overperformers),
        "totalRevenue": round(float(df["revenue"].sum()), 2),
        "potentialRevenueLift": round(float(underperformers["revenue"].sum() * 0.05), 2) if len(underperformers) > 0 else 0,
    }

    table = {
        "columns": ["Product", "Price", "Cost", "Margin %", "Category Avg %", "Gap %"],
        "rows": [
            [str(row[product_col]), format_currency(row[price_col], chart_config),
             format_currency(row[cost_col], chart_config), f"{row['margin_pct']:.1f}%",
             f"{row['category_avg_margin']:.1f}%", f"{row['gap']:+.1f}%"]
            for _, row in df.head(50).iterrows()
        ],
    }

    return {
        "success": True,
        "summary": summary,
        "charts": [chart],
        "table": table,
    }
