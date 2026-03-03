"""
Stockout Cost Estimation -- Revenue lost from out-of-stock events.

NEW Tier 2 module. Calculates lost revenue per product based on
average daily sales, selling price, and stockout duration.

Input: products with product_name, avg_daily_sales, selling_price, stockout_days.
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
        return {"success": False, "error": "No data provided for stockout cost estimation"}

    df = pd.DataFrame(data)

    product_col = next((c for c in ["product_name", "name", "sku", "item"] if c in df.columns), None)
    sales_col = next((c for c in ["avg_daily_sales", "daily_sales", "velocity"] if c in df.columns), None)
    price_col = next((c for c in ["selling_price", "price", "unit_price"] if c in df.columns), None)
    stockout_col = next((c for c in ["stockout_days", "days_out_of_stock", "oos_days"] if c in df.columns), None)

    if not product_col:
        return {"success": False, "error": "No product column found"}
    if not sales_col:
        return {"success": False, "error": "Need avg_daily_sales column"}
    if not price_col:
        return {"success": False, "error": "Need selling_price column"}
    if not stockout_col:
        return {"success": False, "error": "Need stockout_days column"}

    df[sales_col] = pd.to_numeric(df[sales_col], errors="coerce").fillna(0)
    df[price_col] = pd.to_numeric(df[price_col], errors="coerce").fillna(0)
    df[stockout_col] = pd.to_numeric(df[stockout_col], errors="coerce").fillna(0)

    # Calculate lost revenue
    df["lost_revenue"] = df[sales_col] * df[stockout_col] * df[price_col]
    df = df.sort_values("lost_revenue", ascending=False)

    total_lost = df["lost_revenue"].sum()
    total_stockout_days = df[stockout_col].sum()
    top_product = df.iloc[0] if len(df) > 0 else None

    colors = apply_style(chart_config)
    palette = get_color_palette(colors, 6)

    fig, axes = plt.subplots(1, 2, figsize=(14, 6))

    # Left: Top products by lost revenue
    top_n = min(15, len(df))
    top = df.head(top_n)
    y_pos = range(len(top))
    axes[0].barh(y_pos, top["lost_revenue"], color=palette[0], alpha=0.8)
    axes[0].set_yticks(y_pos)
    axes[0].set_yticklabels(top[product_col], fontsize=8)
    axes[0].set_xlabel("Lost Revenue")
    axes[0].set_title("Revenue Lost to Stockouts", fontsize=12, fontweight="bold")
    axes[0].invert_yaxis()

    # Right: Stockout days vs lost revenue scatter
    axes[1].scatter(df[stockout_col], df["lost_revenue"],
                    s=df[sales_col] * 20 + 10, c=palette[1], alpha=0.6,
                    edgecolors="white", linewidth=0.5)
    axes[1].set_xlabel("Stockout Days")
    axes[1].set_ylabel("Lost Revenue")
    axes[1].set_title("Stockout Impact (size = daily sales)", fontsize=12, fontweight="bold")
    axes[1].grid(True, alpha=0.3)

    add_watermark(fig, chart_config)
    fig.tight_layout()
    chart = fig_to_base64(fig, chart_config, width=1400, height=600)
    chart["title"] = "Stockout Cost Analysis"

    summary = {
        "totalStockoutDays": int(total_stockout_days),
        "totalRevenueLost": round(float(total_lost), 2),
        "topStockoutProduct": str(top_product[product_col]) if top_product is not None else None,
        "topProductLostRevenue": round(float(top_product["lost_revenue"]), 2) if top_product is not None else 0,
        "productsAffected": int((df[stockout_col] > 0).sum()),
        "avgStockoutDays": round(float(df[df[stockout_col] > 0][stockout_col].mean()), 1) if (df[stockout_col] > 0).any() else 0,
    }

    table = {
        "columns": ["Product", "Stockout Days", "Avg Daily Sales", "Lost Revenue"],
        "rows": [
            [str(row[product_col]), int(row[stockout_col]),
             round(float(row[sales_col]), 1),
             format_currency(row["lost_revenue"], chart_config)]
            for _, row in df.head(50).iterrows()
        ],
    }

    return {
        "success": True,
        "summary": summary,
        "charts": [chart],
        "table": table,
    }
