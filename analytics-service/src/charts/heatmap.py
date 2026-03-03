"""
Revenue Heatmap -- Branch x Time Period intensity heatmap.

Input data format:
  [{ "branch_name": "Main", "date": "2026-01-15", "total_amount": 15000 }, ...]
"""

import logging
import warnings
from typing import Any

warnings.filterwarnings("ignore")

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import seaborn as sns
import pandas as pd

from src.charts import apply_style, fig_to_base64, currency_formatter, add_watermark, format_currency

logger = logging.getLogger(__name__)


def run(data: list[dict[str, Any]], params: dict[str, Any], chart_config: dict[str, Any] | None = None) -> dict[str, Any]:
    chart_config = chart_config or {}
    if not data:
        return {"success": False, "error": "No data provided for heatmap"}

    colors = apply_style(chart_config)

    df = pd.DataFrame(data)

    date_col = next((c for c in ["date", "sale_date", "created_at", "order_date"] if c in df.columns), None)
    amount_col = next((c for c in ["total_amount", "amount", "revenue", "total"] if c in df.columns), None)
    group_col = next((c for c in ["branch_name", "warehouse_name", "location", "category_name"] if c in df.columns), None)

    if not date_col or not amount_col:
        return {"success": False, "error": "Missing required columns: need a date column and an amount column"}

    df[date_col] = pd.to_datetime(df[date_col])
    df[amount_col] = pd.to_numeric(df[amount_col], errors="coerce").fillna(0)

    mode = params.get("heatmapMode", "day_of_week")
    charts = []

    if group_col and df[group_col].nunique() > 1:
        if mode == "month":
            df["period"] = df[date_col].dt.strftime("%Y-%m")
            period_label = "Month"
        elif mode == "week":
            df["period"] = df[date_col].dt.isocalendar().week.astype(str)
            period_label = "Week"
        else:
            df["period"] = df[date_col].dt.day_name()
            period_label = "Day of Week"
            day_order = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
            df["period"] = pd.Categorical(df["period"], categories=day_order, ordered=True)

        pivot = df.pivot_table(
            values=amount_col, index=group_col, columns="period",
            aggfunc="sum", fill_value=0
        )

        fig, ax = plt.subplots(figsize=(12, max(4, len(pivot) * 0.6 + 2)))
        sns.heatmap(pivot, annot=True, fmt=",.0f", cmap="YlOrRd",
                    linewidths=0.5, linecolor="white", ax=ax,
                    cbar_kws={"label": "Revenue", "format": currency_formatter(chart_config)})
        ax.set_title(f'Revenue Heatmap -- {group_col.replace("_", " ").title()} x {period_label}',
                     fontsize=14, fontweight="bold", pad=15)
        ax.set_ylabel("")
        ax.set_xlabel(period_label)
    else:
        if "hour" not in df.columns:
            df["hour"] = df[date_col].dt.hour
        df["day"] = df[date_col].dt.day_name()
        day_order = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
        df["day"] = pd.Categorical(df["day"], categories=day_order, ordered=True)

        pivot = df.pivot_table(
            values=amount_col, index="day", columns="hour",
            aggfunc="sum", fill_value=0
        )

        fig, ax = plt.subplots(figsize=(14, 5))
        sns.heatmap(pivot, annot=True, fmt=",.0f", cmap="YlOrRd",
                    linewidths=0.5, linecolor="white", ax=ax,
                    cbar_kws={"label": "Revenue"})
        ax.set_title("Revenue Heatmap -- Day x Hour", fontsize=14, fontweight="bold", pad=15)
        ax.set_ylabel("")
        ax.set_xlabel("Hour of Day")

    add_watermark(fig, chart_config)
    fig.tight_layout()

    chart = fig_to_base64(fig, chart_config, width=1200, height=600)
    chart["title"] = "Revenue Heatmap"
    charts.append(chart)

    if group_col and group_col in df.columns:
        branch_totals = df.groupby(group_col)[amount_col].sum().sort_values(ascending=False)
        top_branch = branch_totals.index[0] if len(branch_totals) > 0 else "N/A"
        summary = {
            "topBranch": top_branch,
            "topBranchRevenue": float(branch_totals.iloc[0]) if len(branch_totals) > 0 else 0,
            "branchCount": int(df[group_col].nunique()),
            "totalRevenue": float(df[amount_col].sum()),
            "totalRevenueFormatted": format_currency(df[amount_col].sum(), chart_config),
        }
    else:
        summary = {
            "totalRevenue": float(df[amount_col].sum()),
            "totalRevenueFormatted": format_currency(df[amount_col].sum(), chart_config),
        }

    return {
        "success": True,
        "summary": summary,
        "charts": charts,
    }
