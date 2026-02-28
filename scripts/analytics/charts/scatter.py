"""
Scatter / Bubble Chart — Margin vs Volume analysis.

Plots products on a scatter with X = quantity sold, Y = profit margin,
bubble size = total revenue. Helps identify high-volume low-margin products
vs low-volume high-margin ones.

Input data:
  [{ "product_name": "Widget A", "quantity": 50, "revenue": 5000,
     "cost": 3000, "margin": 40 }, ...]
"""

import pandas as pd
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from charts import apply_style, fig_to_base64, get_color_palette, add_watermark, format_currency


def run(data: list, params: dict, chart_config: dict) -> dict:
    if not data:
        return {"error": "No data provided"}

    colors = apply_style(chart_config)
    palette = get_color_palette(colors, 6)

    df = pd.DataFrame(data)

    # Resolve columns
    product_col = next((c for c in ['product_name', 'name', 'sku', 'item', 'product'] if c in df.columns), None)
    qty_col = next((c for c in ['quantity', 'qty', 'units_sold', 'volume'] if c in df.columns), None)
    revenue_col = next((c for c in ['revenue', 'amount', 'total', 'sales'] if c in df.columns), None)
    cost_col = next((c for c in ['cost', 'cogs', 'total_cost'] if c in df.columns), None)
    margin_col = next((c for c in ['margin', 'profit_margin', 'margin_pct', 'gross_margin'] if c in df.columns), None)
    category_col = next((c for c in ['category', 'department', 'group', 'type'] if c in df.columns), None)

    if not product_col:
        return {"error": "No product column found"}

    # Compute margin if not provided
    for col in [qty_col, revenue_col, cost_col]:
        if col:
            df[col] = pd.to_numeric(df[col], errors='coerce').fillna(0)

    if margin_col:
        df[margin_col] = pd.to_numeric(df[margin_col], errors='coerce').fillna(0)
    elif revenue_col and cost_col:
        margin_col = '_margin'
        df[margin_col] = ((df[revenue_col] - df[cost_col]) / df[revenue_col].replace(0, np.nan) * 100).fillna(0)
    else:
        return {"error": "Need either margin column, or revenue + cost columns to compute margin"}

    x_col = qty_col or revenue_col
    if not x_col:
        return {"error": "Need quantity or revenue column for X axis"}

    # Aggregate by product
    agg_cols = {x_col: 'sum', margin_col: 'mean'}
    if revenue_col and revenue_col != x_col:
        agg_cols[revenue_col] = 'sum'
    if category_col:
        agg_cols[category_col] = 'first'

    grouped = df.groupby(product_col).agg(agg_cols).reset_index()

    size_col = revenue_col if revenue_col else x_col
    sizes = grouped[size_col]
    # Normalize bubble sizes
    size_min, size_max = sizes.min(), sizes.max()
    if size_max > size_min:
        normalized_sizes = 50 + (sizes - size_min) / (size_max - size_min) * 500
    else:
        normalized_sizes = pd.Series([100] * len(sizes))

    # ── Chart ──
    fig, ax = plt.subplots(figsize=(12, 8))

    if category_col:
        categories = grouped[category_col].unique()
        cat_colors = {cat: palette[i % len(palette)] for i, cat in enumerate(categories)}
        for cat in categories:
            mask = grouped[category_col] == cat
            subset = grouped[mask]
            ax.scatter(
                subset[x_col], subset[margin_col],
                s=normalized_sizes[mask], c=cat_colors[cat],
                alpha=0.6, edgecolors='white', linewidth=0.5, label=str(cat)
            )
        ax.legend(fontsize=8, loc='best')
    else:
        ax.scatter(
            grouped[x_col], grouped[margin_col],
            s=normalized_sizes, c=palette[0],
            alpha=0.6, edgecolors='white', linewidth=0.5
        )

    # Label top products
    top_n = min(10, len(grouped))
    top_products = grouped.nlargest(top_n, size_col)
    for _, row in top_products.iterrows():
        ax.annotate(str(row[product_col]), (row[x_col], row[margin_col]),
                    fontsize=7, ha='center', va='bottom', alpha=0.8)

    # Quadrant lines at medians
    med_x = grouped[x_col].median()
    med_y = grouped[margin_col].median()
    ax.axvline(med_x, color='gray', linestyle='--', alpha=0.3)
    ax.axhline(med_y, color='gray', linestyle='--', alpha=0.3)

    # Quadrant labels
    ax.text(0.02, 0.98, 'Low Vol / High Margin', transform=ax.transAxes, fontsize=8,
            va='top', ha='left', alpha=0.5, style='italic')
    ax.text(0.98, 0.98, 'High Vol / High Margin ★', transform=ax.transAxes, fontsize=8,
            va='top', ha='right', alpha=0.5, style='italic')
    ax.text(0.02, 0.02, 'Low Vol / Low Margin ⚠', transform=ax.transAxes, fontsize=8,
            va='bottom', ha='left', alpha=0.5, style='italic')
    ax.text(0.98, 0.02, 'High Vol / Low Margin', transform=ax.transAxes, fontsize=8,
            va='bottom', ha='right', alpha=0.5, style='italic')

    ax.set_xlabel('Quantity Sold' if qty_col else 'Revenue')
    ax.set_ylabel('Profit Margin (%)')
    ax.set_title('Product Performance Matrix', fontsize=14, fontweight='bold')

    add_watermark(fig, chart_config)
    fig.tight_layout()
    chart = fig_to_base64(fig, chart_config, width=1200, height=800)
    chart['title'] = 'Margin vs Volume Scatter'

    # ── Summary ──
    summary = {
        'totalProducts': len(grouped),
        'avgMargin': round(float(grouped[margin_col].mean()), 1),
        'medianMargin': round(float(grouped[margin_col].median()), 1),
        'highVolHighMargin': int(((grouped[x_col] >= med_x) & (grouped[margin_col] >= med_y)).sum()),
        'highVolLowMargin': int(((grouped[x_col] >= med_x) & (grouped[margin_col] < med_y)).sum()),
        'lowVolHighMargin': int(((grouped[x_col] < med_x) & (grouped[margin_col] >= med_y)).sum()),
        'lowVolLowMargin': int(((grouped[x_col] < med_x) & (grouped[margin_col] < med_y)).sum()),
    }

    table = {
        'columns': ['Product', 'Quantity', 'Revenue', 'Margin %', 'Quadrant'],
        'rows': [],
    }
    for _, row in grouped.sort_values(margin_col, ascending=False).head(50).iterrows():
        vol = 'High' if row[x_col] >= med_x else 'Low'
        mgn = 'High' if row[margin_col] >= med_y else 'Low'
        table['rows'].append([
            str(row[product_col]),
            int(row[x_col]),
            format_currency(row[size_col], chart_config) if revenue_col else int(row[x_col]),
            f"{row[margin_col]:.1f}%",
            f"{vol} Vol / {mgn} Margin",
        ])

    return {
        'summary': summary,
        'charts': [chart],
        'table': table,
    }
