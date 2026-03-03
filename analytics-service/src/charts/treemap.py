"""
Treemap -- Hierarchical revenue visualization using squarify.
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
import squarify

from src.charts import apply_style, fig_to_base64, get_color_palette, add_watermark, format_currency

logger = logging.getLogger(__name__)


def run(data: list[dict[str, Any]], params: dict[str, Any], chart_config: dict[str, Any] | None = None) -> dict[str, Any]:
    chart_config = chart_config or {}
    if not data:
        return {"success": False, "error": "No data provided"}

    colors = apply_style(chart_config)
    palette = get_color_palette(colors, 20)

    df = pd.DataFrame(data)

    product_col = next((c for c in ["product_name", "name", "sku", "item", "product"] if c in df.columns), None)
    category_col = next((c for c in ["category", "department", "group", "type"] if c in df.columns), None)
    value_col = next((c for c in ["revenue", "amount", "total", "sales", "quantity"] if c in df.columns), None)

    if not value_col:
        return {"success": False, "error": "No revenue/amount column found"}

    df[value_col] = pd.to_numeric(df[value_col], errors="coerce").fillna(0)
    df = df[df[value_col] > 0]

    group_col = category_col or product_col
    if not group_col:
        return {"success": False, "error": "No product or category column found"}

    grouped = df.groupby(group_col)[value_col].sum().sort_values(ascending=False)
    total = grouped.sum()

    max_items = params.get("maxItems", 30)
    if len(grouped) > max_items:
        top = grouped.head(max_items - 1)
        others = pd.Series({"Others": grouped.iloc[max_items - 1:].sum()})
        grouped = pd.concat([top, others])

    fig, ax = plt.subplots(figsize=(14, 8))

    labels = []
    for name, val in grouped.items():
        pct = val / total * 100
        currency_val = format_currency(val, chart_config)
        labels.append(f"{name}\n{currency_val}\n({pct:.1f}%)")

    squarify.plot(
        sizes=grouped.values, label=labels,
        color=palette[:len(grouped)], alpha=0.8, ax=ax,
        text_kwargs={"fontsize": 8, "fontweight": "bold"}, pad=2,
    )

    ax.set_title(
        f'Revenue by {"Category" if category_col else "Product"} (Total: {format_currency(total, chart_config)})',
        fontsize=14, fontweight="bold", pad=20
    )
    ax.axis("off")

    add_watermark(fig, chart_config)
    fig.tight_layout()
    chart = fig_to_base64(fig, chart_config, width=1400, height=800)
    chart["title"] = f'Revenue Treemap by {"Category" if category_col else "Product"}'

    charts = [chart]
    if category_col and product_col:
        top_cats = df.groupby(category_col)[value_col].sum().nlargest(5).index
        fig2, axes2 = plt.subplots(1, min(5, len(top_cats)), figsize=(16, 5))
        if len(top_cats) == 1:
            axes2 = [axes2]

        for i, cat in enumerate(top_cats[:5]):
            cat_data = df[df[category_col] == cat].groupby(product_col)[value_col].sum().sort_values(ascending=False).head(10)
            cat_total = cat_data.sum()
            cat_labels = [f"{n}\n{format_currency(v, chart_config)}" for n, v in cat_data.items()]
            squarify.plot(
                sizes=cat_data.values, label=cat_labels,
                color=palette[i * 4:(i * 4) + len(cat_data)], alpha=0.8, ax=axes2[i],
                text_kwargs={"fontsize": 7}, pad=1,
            )
            axes2[i].set_title(f"{cat} ({format_currency(cat_total, chart_config)})", fontsize=10, fontweight="bold")
            axes2[i].axis("off")

        add_watermark(fig2, chart_config)
        fig2.tight_layout()
        chart2 = fig_to_base64(fig2, chart_config, width=1600, height=500)
        chart2["title"] = "Category Detail Treemaps"
        charts.append(chart2)

    summary = {
        "totalRevenue": round(float(total), 2),
        "itemCount": len(grouped),
        "topItem": str(grouped.index[0]),
        "topItemRevenue": round(float(grouped.iloc[0]), 2),
        "topItemPct": round(float(grouped.iloc[0] / total * 100), 1),
        "top5Pct": round(float(grouped.head(5).sum() / total * 100), 1),
    }

    table = {
        "columns": ["Rank", "Category" if category_col else "Product", "Revenue", "% of Total", "Cumulative %"],
        "rows": [],
    }
    cumulative = 0
    for rank, (name, val) in enumerate(grouped.items(), 1):
        pct = val / total * 100
        cumulative += pct
        table["rows"].append([
            rank, str(name), format_currency(val, chart_config),
            f"{pct:.1f}%", f"{cumulative:.1f}%",
        ])

    return {
        "success": True,
        "summary": summary,
        "charts": charts,
        "table": table,
    }
