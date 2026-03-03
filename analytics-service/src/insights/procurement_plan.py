"""
Procurement Plan -- Aggregate restock needs by supplier.

NEW Tier 2 module. Identifies products below reorder point and
groups them by supplier for consolidated ordering.

Input: products with supplier_name, reorder_point, current_stock, lead_time_days, cost_price.
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
        return {"success": False, "error": "No data provided for procurement plan"}

    df = pd.DataFrame(data)

    supplier_col = next((c for c in ["supplier_name", "supplier", "vendor"] if c in df.columns), None)
    product_col = next((c for c in ["product_name", "name", "sku", "item"] if c in df.columns), None)
    reorder_col = next((c for c in ["reorder_point", "reorder_level", "min_stock"] if c in df.columns), None)
    stock_col = next((c for c in ["current_stock", "quantity", "on_hand", "stock"] if c in df.columns), None)
    lead_col = next((c for c in ["lead_time_days", "lead_time", "delivery_days"] if c in df.columns), None)
    cost_col = next((c for c in ["cost_price", "unit_cost", "cost"] if c in df.columns), None)

    if not supplier_col:
        return {"success": False, "error": "No supplier column found"}
    if not reorder_col or not stock_col:
        return {"success": False, "error": "Need reorder_point and current_stock columns"}

    df[reorder_col] = pd.to_numeric(df[reorder_col], errors="coerce").fillna(0)
    df[stock_col] = pd.to_numeric(df[stock_col], errors="coerce").fillna(0)
    if lead_col:
        df[lead_col] = pd.to_numeric(df[lead_col], errors="coerce").fillna(7)
    if cost_col:
        df[cost_col] = pd.to_numeric(df[cost_col], errors="coerce").fillna(0)

    # Find products needing restock
    needs_restock = df[df[stock_col] <= df[reorder_col]].copy()

    if len(needs_restock) == 0:
        return {
            "success": True,
            "summary": {
                "message": "All products are above their reorder points. No procurement needed.",
                "totalProducts": len(df),
                "totalSuppliersChecked": int(df[supplier_col].nunique()),
            },
            "table": None,
        }

    # Quantity to order = reorder_point - current_stock (+ safety buffer)
    buffer_pct = params.get("bufferPct", 20) / 100
    needs_restock["qty_to_order"] = ((needs_restock[reorder_col] - needs_restock[stock_col]) * (1 + buffer_pct)).clip(lower=1).astype(int)

    if cost_col:
        needs_restock["total_cost"] = needs_restock["qty_to_order"] * needs_restock[cost_col]
    else:
        needs_restock["total_cost"] = 0

    today = datetime.now()
    if lead_col:
        needs_restock["order_by_date"] = needs_restock[lead_col].apply(
            lambda d: (today + timedelta(days=int(d))).strftime("%Y-%m-%d")
        )
    else:
        needs_restock["order_by_date"] = (today + timedelta(days=7)).strftime("%Y-%m-%d")

    # Group by supplier
    supplier_summary = needs_restock.groupby(supplier_col).agg(
        items=("qty_to_order", "count"),
        total_qty=("qty_to_order", "sum"),
        total_cost=("total_cost", "sum"),
    ).sort_values("total_cost", ascending=False).reset_index()

    colors = apply_style(chart_config)
    palette = get_color_palette(colors, 8)

    fig, axes = plt.subplots(1, 2, figsize=(14, 6))

    # Left: Cost by supplier
    y_pos = range(len(supplier_summary))
    axes[0].barh(y_pos, supplier_summary["total_cost"], color=palette[:len(supplier_summary)], alpha=0.8)
    axes[0].set_yticks(y_pos)
    axes[0].set_yticklabels(supplier_summary[supplier_col], fontsize=9)
    axes[0].set_xlabel("Estimated Cost")
    axes[0].set_title("Procurement Cost by Supplier", fontsize=12, fontweight="bold")
    axes[0].invert_yaxis()

    # Right: Items count by supplier
    axes[1].barh(y_pos, supplier_summary["items"], color=palette[:len(supplier_summary)], alpha=0.8)
    axes[1].set_yticks(y_pos)
    axes[1].set_yticklabels(supplier_summary[supplier_col], fontsize=9)
    axes[1].set_xlabel("Items to Order")
    axes[1].set_title("Items Needing Restock by Supplier", fontsize=12, fontweight="bold")
    axes[1].invert_yaxis()

    add_watermark(fig, chart_config)
    fig.tight_layout()
    chart = fig_to_base64(fig, chart_config, width=1400, height=600)
    chart["title"] = "Procurement Plan"

    summary = {
        "totalSuppliers": len(supplier_summary),
        "totalItemsToOrder": int(needs_restock["qty_to_order"].sum()),
        "totalEstimatedCost": round(float(needs_restock["total_cost"].sum()), 2),
        "totalProductsChecked": len(df),
        "productsNeedingRestock": len(needs_restock),
    }

    table = {
        "columns": ["Supplier", "Product", "Qty to Order", "Unit Cost", "Total Cost", "Order By"],
        "rows": [
            [str(row[supplier_col]),
             str(row[product_col]) if product_col else "N/A",
             int(row["qty_to_order"]),
             format_currency(row[cost_col], chart_config) if cost_col else "N/A",
             format_currency(row["total_cost"], chart_config),
             row["order_by_date"]]
            for _, row in needs_restock.sort_values("total_cost", ascending=False).head(50).iterrows()
        ],
    }

    return {
        "success": True,
        "summary": summary,
        "charts": [chart],
        "table": table,
    }
