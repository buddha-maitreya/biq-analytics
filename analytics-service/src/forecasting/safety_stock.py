"""
Safety Stock & EOQ Calculator -- Dynamic safety stock and optimal order quantities.
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
from scipy import stats

from src.charts import apply_style, fig_to_base64, format_currency, currency_formatter, get_color_palette, add_watermark

logger = logging.getLogger(__name__)


def run(data: list[dict[str, Any]], params: dict[str, Any], chart_config: dict[str, Any] | None = None) -> dict[str, Any]:
    chart_config = chart_config or {}
    if not data:
        return {"success": False, "error": "No data provided for safety stock calculation"}

    colors = apply_style(chart_config)
    palette = get_color_palette(colors, 8)

    df = pd.DataFrame(data)

    product_col = next((c for c in ["product_name", "name", "sku", "item"] if c in df.columns), None)
    date_col = next((c for c in ["date", "sale_date", "created_at", "order_date"] if c in df.columns), None)
    qty_col = next((c for c in ["quantity", "qty", "units_sold", "demand"] if c in df.columns), None)

    if not product_col:
        return {"success": False, "error": "No product name column found"}
    if not date_col:
        return {"success": False, "error": "No date column found"}
    if not qty_col:
        return {"success": False, "error": "No quantity column found"}

    df[date_col] = pd.to_datetime(df[date_col])
    df[qty_col] = pd.to_numeric(df[qty_col], errors="coerce").fillna(0)

    service_level = params.get("serviceLevel", 0.95)
    default_lead_time = params.get("leadTimeDays", 7)
    holding_cost_pct = params.get("holdingCostPct", 0.25)
    ordering_cost = params.get("orderingCost", 50)
    z_score = stats.norm.ppf(service_level)

    results = []
    for product, group in df.groupby(product_col):
        daily = group.groupby(group[date_col].dt.date)[qty_col].sum()
        avg_daily_demand = daily.mean()
        std_daily_demand = daily.std() if len(daily) > 1 else 0

        if "lead_time_days" in group.columns:
            lead_time = group["lead_time_days"].mean()
            lead_time_std = group["lead_time_days"].std() if len(group) > 1 else 0
        else:
            lead_time = default_lead_time
            lead_time_std = 0

        safety_stock = z_score * np.sqrt(
            lead_time * std_daily_demand**2 + avg_daily_demand**2 * lead_time_std**2
        )
        reorder_point = avg_daily_demand * lead_time + safety_stock

        annual_demand = avg_daily_demand * 365
        unit_cost = group["unit_cost"].mean() if "unit_cost" in group.columns else 100
        holding_cost = unit_cost * holding_cost_pct
        eoq = np.sqrt(2 * annual_demand * ordering_cost / holding_cost) if holding_cost > 0 else 0

        current_rop = group["reorder_point"].iloc[0] if "reorder_point" in group.columns else None

        results.append({
            "product": str(product),
            "avgDailyDemand": round(float(avg_daily_demand), 2),
            "demandStdDev": round(float(std_daily_demand), 2),
            "leadTimeDays": round(float(lead_time), 1),
            "safetyStock": round(float(safety_stock), 0),
            "reorderPoint": round(float(reorder_point), 0),
            "currentReorderPoint": int(current_rop) if current_rop is not None else None,
            "eoq": round(float(eoq), 0),
            "annualDemand": round(float(annual_demand), 0),
            "unitCost": round(float(unit_cost), 2),
            "annualHoldingCost": round(float(holding_cost * eoq / 2), 2) if eoq > 0 else 0,
            "annualOrderingCost": round(float(ordering_cost * annual_demand / eoq), 2) if eoq > 0 else 0,
            "dataDays": len(daily),
        })

    results_df = pd.DataFrame(results).sort_values("annualDemand", ascending=False)

    fig, axes = plt.subplots(1, 2, figsize=(12, 5))

    top = results_df.head(15)
    y_pos = range(len(top))
    axes[0].barh(y_pos, top["safetyStock"], color=palette[0], alpha=0.8, label="Safety Stock")
    axes[0].barh(y_pos, top["reorderPoint"], color=palette[1], alpha=0.3, label="Reorder Point")
    axes[0].set_yticks(y_pos)
    axes[0].set_yticklabels(top["product"], fontsize=8)
    axes[0].set_xlabel("Units")
    axes[0].set_title("Safety Stock & Reorder Points", fontsize=12, fontweight="bold")
    axes[0].legend(fontsize=8)
    axes[0].invert_yaxis()

    axes[1].barh(y_pos, top["eoq"], color=palette[2], alpha=0.8)
    axes[1].set_yticks(y_pos)
    axes[1].set_yticklabels(top["product"], fontsize=8)
    axes[1].set_xlabel("Units")
    axes[1].set_title("Economic Order Quantity (EOQ)", fontsize=12, fontweight="bold")
    axes[1].invert_yaxis()

    add_watermark(fig, chart_config)
    fig.tight_layout()

    chart = fig_to_base64(fig, chart_config, width=1200, height=500)
    chart["title"] = "Safety Stock & EOQ Analysis"

    summary = {
        "productCount": len(results),
        "serviceLevel": service_level,
        "zScore": round(z_score, 2),
        "defaultLeadTimeDays": default_lead_time,
        "avgSafetyStock": round(float(results_df["safetyStock"].mean()), 1),
        "avgEoq": round(float(results_df["eoq"].mean()), 1),
        "avgReorderPoint": round(float(results_df["reorderPoint"].mean()), 1),
        "totalAnnualHoldingCost": round(float(results_df["annualHoldingCost"].sum()), 2),
        "totalAnnualOrderingCost": round(float(results_df["annualOrderingCost"].sum()), 2),
    }

    table = {
        "columns": ["Product", "Avg Daily Demand", "Safety Stock", "Reorder Point", "EOQ", "Current ROP", "ROP Delta"],
        "rows": [],
    }
    for _, r in results_df.iterrows():
        delta = ""
        if r["currentReorderPoint"] is not None:
            diff = r["reorderPoint"] - r["currentReorderPoint"]
            delta = f"+{int(diff)}" if diff > 0 else str(int(diff))
        table["rows"].append([
            r["product"], r["avgDailyDemand"], int(r["safetyStock"]),
            int(r["reorderPoint"]), int(r["eoq"]),
            r["currentReorderPoint"] if r["currentReorderPoint"] is not None else "N/A",
            delta if delta else "N/A",
        ])

    return {
        "success": True,
        "summary": summary,
        "charts": [chart],
        "table": table,
    }
