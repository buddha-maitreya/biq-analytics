"""
Sales Velocity Scoring -- Composite velocity x margin quadrant analysis.

NEW Tier 2 module. Scores products by velocity (units/day) and margin,
then assigns quadrants: Star, Volume, Premium, Dog.

Input: products with name, quantity_sold, days_in_period, selling_price, cost_price.
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
        return {"success": False, "error": "No data provided for sales velocity analysis"}

    df = pd.DataFrame(data)

    name_col = next((c for c in ["name", "product_name", "sku", "item"] if c in df.columns), None)
    qty_col = next((c for c in ["quantity_sold", "quantity", "units_sold"] if c in df.columns), None)
    days_col = next((c for c in ["days_in_period", "period_days", "days"] if c in df.columns), None)
    price_col = next((c for c in ["selling_price", "price", "unit_price"] if c in df.columns), None)
    cost_col = next((c for c in ["cost_price", "unit_cost", "cost"] if c in df.columns), None)

    if not name_col:
        return {"success": False, "error": "No product name column found"}
    if not qty_col:
        return {"success": False, "error": "Need quantity_sold column"}
    if not price_col or not cost_col:
        return {"success": False, "error": "Need selling_price and cost_price columns"}

    df[qty_col] = pd.to_numeric(df[qty_col], errors="coerce").fillna(0)
    df[price_col] = pd.to_numeric(df[price_col], errors="coerce").fillna(0)
    df[cost_col] = pd.to_numeric(df[cost_col], errors="coerce").fillna(0)

    if days_col:
        df[days_col] = pd.to_numeric(df[days_col], errors="coerce").fillna(30)
    else:
        days_col = "_days"
        df[days_col] = params.get("defaultPeriodDays", 30)

    # Calculate metrics
    df["velocity"] = df[qty_col] / df[days_col].replace(0, np.nan)
    df["velocity"] = df["velocity"].fillna(0)
    df["margin_pct"] = ((df[price_col] - df[cost_col]) / df[price_col].replace(0, np.nan) * 100).fillna(0)
    df["score"] = df["velocity"] * df["margin_pct"] / 100

    # Quadrant assignment
    velocity_median = df["velocity"].median()
    margin_median = df["margin_pct"].median()

    def assign_quadrant(row):
        high_vel = row["velocity"] >= velocity_median
        high_margin = row["margin_pct"] >= margin_median
        if high_vel and high_margin:
            return "Star"
        elif high_vel and not high_margin:
            return "Volume"
        elif not high_vel and high_margin:
            return "Premium"
        else:
            return "Dog"

    df["quadrant"] = df.apply(assign_quadrant, axis=1)

    # Sort by score
    df = df.sort_values("score", ascending=False)

    stars = len(df[df["quadrant"] == "Star"])
    dogs = len(df[df["quadrant"] == "Dog"])
    highest_vel = df.loc[df["velocity"].idxmax()]

    colors = apply_style(chart_config)
    palette = get_color_palette(colors, 6)

    fig, ax = plt.subplots(figsize=(12, 8))

    quadrant_colors = {"Star": palette[0], "Volume": palette[1], "Premium": palette[2], "Dog": "#9ca3af"}
    for quad in ["Star", "Volume", "Premium", "Dog"]:
        mask = df["quadrant"] == quad
        subset = df[mask]
        if len(subset) > 0:
            ax.scatter(subset["velocity"], subset["margin_pct"],
                       s=subset["score"].abs() * 50 + 20,
                       c=quadrant_colors[quad], alpha=0.7, label=f"{quad} ({len(subset)})",
                       edgecolors="white", linewidth=0.5)

    # Median lines
    ax.axvline(velocity_median, color="gray", linestyle="--", alpha=0.4)
    ax.axhline(margin_median, color="gray", linestyle="--", alpha=0.4)

    # Quadrant labels
    ax.text(0.98, 0.98, "Star", transform=ax.transAxes, fontsize=14, fontweight="bold",
            va="top", ha="right", alpha=0.3, color=quadrant_colors["Star"])
    ax.text(0.98, 0.02, "Volume", transform=ax.transAxes, fontsize=14, fontweight="bold",
            va="bottom", ha="right", alpha=0.3, color=quadrant_colors["Volume"])
    ax.text(0.02, 0.98, "Premium", transform=ax.transAxes, fontsize=14, fontweight="bold",
            va="top", ha="left", alpha=0.3, color=quadrant_colors["Premium"])
    ax.text(0.02, 0.02, "Dog", transform=ax.transAxes, fontsize=14, fontweight="bold",
            va="bottom", ha="left", alpha=0.3, color=quadrant_colors["Dog"])

    # Label top products
    for _, row in df.head(5).iterrows():
        ax.annotate(str(row[name_col]), (row["velocity"], row["margin_pct"]),
                    fontsize=7, ha="center", va="bottom", alpha=0.8)

    ax.set_xlabel("Velocity (units/day)")
    ax.set_ylabel("Margin (%)")
    ax.set_title("Sales Velocity Matrix", fontsize=14, fontweight="bold")
    ax.legend(loc="best", fontsize=9)
    ax.grid(True, alpha=0.2)

    add_watermark(fig, chart_config)
    fig.tight_layout()
    chart = fig_to_base64(fig, chart_config, width=1200, height=800)
    chart["title"] = "Sales Velocity Analysis"

    summary = {
        "totalProducts": len(df),
        "totalStars": stars,
        "totalDogs": dogs,
        "totalVolume": len(df[df["quadrant"] == "Volume"]),
        "totalPremium": len(df[df["quadrant"] == "Premium"]),
        "highestVelocityProduct": str(highest_vel[name_col]),
        "highestVelocity": round(float(highest_vel["velocity"]), 2),
        "avgVelocity": round(float(df["velocity"].mean()), 2),
        "avgMarginPct": round(float(df["margin_pct"].mean()), 1),
    }

    table = {
        "columns": ["Rank", "Product", "Velocity", "Margin %", "Score", "Quadrant"],
        "rows": [
            [i + 1, str(row[name_col]), round(float(row["velocity"]), 2),
             f"{row['margin_pct']:.1f}%", round(float(row["score"]), 3), row["quadrant"]]
            for i, (_, row) in enumerate(df.head(50).iterrows())
        ],
    }

    return {
        "success": True,
        "summary": summary,
        "charts": [chart],
        "table": table,
    }
