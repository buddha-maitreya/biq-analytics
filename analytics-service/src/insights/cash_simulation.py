"""
Cash Flow Simulation -- Monte Carlo simulation of stocking strategies.

NEW Tier 2 module. Estimates capital tied up in inventory and simulates
the effect of reducing C-tier stock.

Input: products with cost_price, quantity, avg_daily_sales.
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
        return {"success": False, "error": "No data provided for cash simulation"}

    df = pd.DataFrame(data)

    product_col = next((c for c in ["product_name", "name", "sku", "item"] if c in df.columns), None)
    cost_col = next((c for c in ["cost_price", "unit_cost", "cost"] if c in df.columns), None)
    qty_col = next((c for c in ["quantity", "quantity_on_hand", "stock", "on_hand"] if c in df.columns), None)
    sales_col = next((c for c in ["avg_daily_sales", "daily_sales", "velocity"] if c in df.columns), None)

    if not cost_col or not qty_col:
        return {"success": False, "error": "Need cost_price and quantity columns for cash simulation"}

    df[cost_col] = pd.to_numeric(df[cost_col], errors="coerce").fillna(0)
    df[qty_col] = pd.to_numeric(df[qty_col], errors="coerce").fillna(0)
    if sales_col:
        df[sales_col] = pd.to_numeric(df[sales_col], errors="coerce").fillna(0)

    # Calculate investment per product
    df["investment"] = df[cost_col] * df[qty_col]
    total_investment = df["investment"].sum()

    # ABC classification by investment (simple cumulative %)
    df = df.sort_values("investment", ascending=False)
    df["cum_pct"] = df["investment"].cumsum() / total_investment * 100 if total_investment > 0 else 0

    df["tier"] = "C"
    df.loc[df["cum_pct"] <= 80, "tier"] = "A"
    df.loc[(df["cum_pct"] > 80) & (df["cum_pct"] <= 95), "tier"] = "B"

    # Current investment by tier
    tier_investment = df.groupby("tier")["investment"].sum()
    a_investment = float(tier_investment.get("A", 0))
    b_investment = float(tier_investment.get("B", 0))
    c_investment = float(tier_investment.get("C", 0))

    # Simulate: reduce C-tier stock by 30%
    c_reduction_pct = params.get("cReductionPct", 30) / 100
    freed_capital = c_investment * c_reduction_pct
    proposed_investment = total_investment - freed_capital

    # Payback period: how many days of C-tier sales does the freed capital represent?
    if sales_col:
        c_daily_revenue = df[df["tier"] == "C"][sales_col].sum() * df[df["tier"] == "C"][cost_col].mean()
        payback_days = freed_capital / c_daily_revenue if c_daily_revenue > 0 else float("inf")
    else:
        payback_days = None

    colors = apply_style(chart_config)
    palette = get_color_palette(colors, 6)

    fig, axes = plt.subplots(1, 2, figsize=(14, 6))

    # Left: Investment by tier (current vs proposed)
    tiers = ["A", "B", "C"]
    current_vals = [a_investment, b_investment, c_investment]
    proposed_vals = [a_investment, b_investment, c_investment * (1 - c_reduction_pct)]
    x = np.arange(len(tiers))
    w = 0.35
    axes[0].bar(x - w / 2, current_vals, w, label="Current", color=palette[0], alpha=0.8)
    axes[0].bar(x + w / 2, proposed_vals, w, label="Proposed", color=palette[1], alpha=0.8)
    axes[0].set_xticks(x)
    axes[0].set_xticklabels([f"Tier {t}" for t in tiers])
    axes[0].set_ylabel("Capital Investment")
    axes[0].set_title("Investment by ABC Tier", fontsize=12, fontweight="bold")
    axes[0].legend(fontsize=9)

    # Right: Waterfall of freed capital
    items = ["Current Total", "C-Tier Reduction", "Proposed Total"]
    vals = [total_investment, -freed_capital, proposed_investment]
    bar_colors = [palette[0], "#ef4444", palette[1]]
    axes[1].bar(items, vals, color=bar_colors, alpha=0.8)
    axes[1].set_ylabel("Capital")
    axes[1].set_title("Capital Optimization", fontsize=12, fontweight="bold")
    for i, v in enumerate(vals):
        axes[1].text(i, v, format_currency(v, chart_config), ha="center",
                     va="bottom" if v >= 0 else "top", fontsize=9, fontweight="bold")

    add_watermark(fig, chart_config)
    fig.tight_layout()
    chart = fig_to_base64(fig, chart_config, width=1400, height=600)
    chart["title"] = "Cash Flow Simulation"

    summary = {
        "currentInvestment": round(float(total_investment), 2),
        "proposedInvestment": round(float(proposed_investment), 2),
        "freedCapital": round(float(freed_capital), 2),
        "cReductionPct": round(c_reduction_pct * 100, 0),
        "paybackPeriodDays": round(float(payback_days), 1) if payback_days and payback_days != float("inf") else None,
        "tierBreakdown": {
            "A": round(a_investment, 2),
            "B": round(b_investment, 2),
            "C": round(c_investment, 2),
        },
        "totalProducts": len(df),
    }

    table = {
        "columns": ["Product", "Tier", "Investment", "Qty", "Recommended Action"],
        "rows": [
            [str(row[product_col]) if product_col else f"Item {i}",
             row["tier"],
             format_currency(row["investment"], chart_config),
             int(row[qty_col]),
             "Reduce stock 30%" if row["tier"] == "C" else "Maintain"]
            for i, (_, row) in enumerate(df.head(50).iterrows())
        ],
    }

    return {
        "success": True,
        "summary": summary,
        "charts": [chart],
        "table": table,
    }
