"""
Dead Stock Detection -- Identifies products with no or very low sales
over a configurable lookback period.

Input data:
  [{ "product_name": "Widget A", "last_sale_date": "2025-06-01",
     "quantity_on_hand": 100, "cost_price": 50 }, ...]
"""

import logging
import warnings
from typing import Any
from datetime import datetime, timedelta

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
        return {"success": False, "error": "No data provided for dead stock analysis"}

    colors = apply_style(chart_config)
    palette = get_color_palette(colors, 6)

    df = pd.DataFrame(data)

    product_col = next((c for c in ["product_name", "name", "sku", "item"] if c in df.columns), None)
    last_sale_col = next((c for c in ["last_sale_date", "last_sold", "last_sale"] if c in df.columns), None)
    qty_col = next((c for c in ["quantity_on_hand", "quantity", "stock", "on_hand"] if c in df.columns), None)
    cost_col = next((c for c in ["cost_price", "unit_cost", "cost"] if c in df.columns), None)
    category_col = next((c for c in ["category", "department", "group"] if c in df.columns), None)

    if not product_col:
        return {"success": False, "error": "No product column found"}

    # Parameters
    dead_days = params.get("deadStockDays", 90)
    slow_days = params.get("slowMovingDays", 30)

    now = datetime.now()

    if last_sale_col:
        df[last_sale_col] = pd.to_datetime(df[last_sale_col], errors="coerce")
        df["days_since_sale"] = (now - df[last_sale_col]).dt.days
    else:
        # If no last_sale_date, use quantity_sold as proxy
        qty_sold_col = next((c for c in ["quantity_sold", "units_sold", "sales_qty"] if c in df.columns), None)
        if qty_sold_col:
            df[qty_sold_col] = pd.to_numeric(df[qty_sold_col], errors="coerce").fillna(0)
            df["days_since_sale"] = np.where(df[qty_sold_col] == 0, dead_days + 1, 0)
        else:
            return {"success": False, "error": "Need last_sale_date or quantity_sold column"}

    if qty_col:
        df[qty_col] = pd.to_numeric(df[qty_col], errors="coerce").fillna(0)
    if cost_col:
        df[cost_col] = pd.to_numeric(df[cost_col], errors="coerce").fillna(0)

    # Classify
    df["status"] = "Active"
    df.loc[df["days_since_sale"] >= slow_days, "status"] = "Slow Moving"
    df.loc[df["days_since_sale"] >= dead_days, "status"] = "Dead Stock"

    if cost_col and qty_col:
        df["tied_capital"] = df[cost_col] * df[qty_col]
    elif qty_col:
        df["tied_capital"] = df[qty_col]
    else:
        df["tied_capital"] = 0

    dead = df[df["status"] == "Dead Stock"]
    slow = df[df["status"] == "Slow Moving"]
    active = df[df["status"] == "Active"]

    # Chart
    fig, axes = plt.subplots(1, 2, figsize=(14, 6))

    # Pie: status breakdown
    status_counts = df["status"].value_counts()
    axes[0].pie(status_counts.values, labels=status_counts.index, autopct="%1.0f%%",
                colors=[palette[0], palette[2], "#ef4444"], startangle=90, textprops={"fontsize": 10})
    axes[0].set_title("Stock Status Distribution", fontsize=12, fontweight="bold")

    # Bar: capital tied up by status
    status_capital = df.groupby("status")["tied_capital"].sum().sort_values(ascending=False)
    axes[1].bar(status_capital.index, status_capital.values, color=[palette[0], palette[2], "#ef4444"], alpha=0.8)
    axes[1].set_ylabel("Capital Tied Up")
    axes[1].set_title("Capital at Risk", fontsize=12, fontweight="bold")
    for i, (status, val) in enumerate(status_capital.items()):
        axes[1].text(i, val, format_currency(val, chart_config), ha="center", va="bottom", fontsize=9)

    add_watermark(fig, chart_config)
    fig.tight_layout()
    chart = fig_to_base64(fig, chart_config, width=1400, height=600)
    chart["title"] = "Dead Stock Analysis"

    summary = {
        "totalProducts": len(df),
        "deadStockCount": len(dead),
        "slowMovingCount": len(slow),
        "activeCount": len(active),
        "deadStockCapital": round(float(dead["tied_capital"].sum()), 2),
        "slowMovingCapital": round(float(slow["tied_capital"].sum()), 2),
        "totalCapitalAtRisk": round(float(dead["tied_capital"].sum() + slow["tied_capital"].sum()), 2),
        "deadStockDaysThreshold": dead_days,
        "slowMovingDaysThreshold": slow_days,
    }

    table = {
        "columns": ["Product", "Status", "Days Since Sale", "Qty on Hand", "Capital Tied Up"],
        "rows": [
            [str(row[product_col]), row["status"], int(row["days_since_sale"]),
             int(row[qty_col]) if qty_col else "N/A",
             format_currency(row["tied_capital"], chart_config)]
            for _, row in df.sort_values("days_since_sale", ascending=False).head(50).iterrows()
        ],
    }

    return {
        "success": True,
        "summary": summary,
        "charts": [chart],
        "table": table,
    }
