"""
Geographic Map — Regional performance visualization.

Renders a bar/choropleth-style chart showing revenue, quantity, or other metrics
by region/county/area. Designed to work with any geographic hierarchy.

Input data:
  [{ "region": "Nairobi", "revenue": 500000, "quantity": 1200, "orders": 300 }, ...]
"""

import pandas as pd
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from charts import apply_style, fig_to_base64, get_color_palette, add_watermark, format_currency, currency_formatter


def run(data: list, params: dict, chart_config: dict) -> dict:
    if not data:
        return {"error": "No data provided"}

    colors = apply_style(chart_config)
    palette = get_color_palette(colors, 20)

    df = pd.DataFrame(data)

    # Resolve columns
    region_col = next((c for c in ['region', 'county', 'area', 'city', 'location', 'zone', 'state', 'province'] if c in df.columns), None)
    value_col = next((c for c in ['revenue', 'amount', 'total', 'sales', 'quantity', 'orders'] if c in df.columns), None)
    qty_col = next((c for c in ['quantity', 'qty', 'units', 'orders', 'count'] if c in df.columns), None)

    if not region_col:
        return {"error": "No region/location column found"}
    if not value_col:
        return {"error": "No value column found"}

    df[value_col] = pd.to_numeric(df[value_col], errors='coerce').fillna(0)
    if qty_col and qty_col != value_col:
        df[qty_col] = pd.to_numeric(df[qty_col], errors='coerce').fillna(0)

    # Aggregate by region
    agg_dict = {value_col: 'sum'}
    if qty_col and qty_col != value_col:
        agg_dict[qty_col] = 'sum'
    grouped = df.groupby(region_col).agg(agg_dict).reset_index()
    grouped = grouped.sort_values(value_col, ascending=False)

    total_value = grouped[value_col].sum()

    # ── Charts ──
    fig, axes = plt.subplots(1, 2, figsize=(16, max(6, len(grouped) * 0.35)))

    # 1. Horizontal bar chart (all regions)
    y_pos = range(len(grouped))
    bars = axes[0].barh(y_pos, grouped[value_col], color=palette[:len(grouped)], alpha=0.85)
    axes[0].set_yticks(y_pos)
    axes[0].set_yticklabels(grouped[region_col], fontsize=9)
    axes[0].set_xlabel('Revenue')
    axes[0].set_title('Revenue by Region', fontsize=13, fontweight='bold')
    axes[0].invert_yaxis()
    axes[0].xaxis.set_major_formatter(currency_formatter(chart_config))

    # Percentage labels on bars
    for i, (_, row) in enumerate(grouped.iterrows()):
        pct = row[value_col] / total_value * 100 if total_value > 0 else 0
        axes[0].text(row[value_col] * 1.02, i,
                    f"{format_currency(row[value_col], chart_config)} ({pct:.1f}%)",
                    va='center', fontsize=8)

    # 2. Top regions as pie / donut
    top_n = min(8, len(grouped))
    top = grouped.head(top_n).copy()
    if len(grouped) > top_n:
        others_val = grouped.iloc[top_n:][value_col].sum()
        others_row = pd.DataFrame({region_col: ['Others'], value_col: [others_val]})
        top = pd.concat([top, others_row], ignore_index=True)

    wedges, texts, autotexts = axes[1].pie(
        top[value_col], labels=top[region_col],
        autopct='%1.1f%%', colors=palette[:len(top)],
        startangle=90, textprops={'fontsize': 9},
        pctdistance=0.75
    )
    # Donut center
    centre_circle = plt.Circle((0, 0), 0.45, fc='white')
    axes[1].add_artist(centre_circle)
    axes[1].text(0, 0, f"Total\n{format_currency(total_value, chart_config)}",
                ha='center', va='center', fontsize=10, fontweight='bold')
    axes[1].set_title('Regional Share', fontsize=13, fontweight='bold')

    add_watermark(fig, chart_config)
    fig.tight_layout()
    chart = fig_to_base64(fig, chart_config, width=1600, height=max(600, len(grouped) * 35))
    chart['title'] = 'Geographic Performance'

    # ── Summary ──
    summary = {
        'totalRevenue': round(float(total_value), 2),
        'regionCount': len(grouped),
        'topRegion': str(grouped.iloc[0][region_col]),
        'topRegionRevenue': round(float(grouped.iloc[0][value_col]), 2),
        'topRegionPct': round(float(grouped.iloc[0][value_col] / total_value * 100), 1) if total_value > 0 else 0,
        'top3Pct': round(float(grouped.head(3)[value_col].sum() / total_value * 100), 1) if total_value > 0 else 0,
        'bottomRegion': str(grouped.iloc[-1][region_col]),
        'bottomRegionRevenue': round(float(grouped.iloc[-1][value_col]), 2),
    }

    # ── Table ──
    table_cols = ['Rank', 'Region', 'Revenue', '% Share', 'Cumulative %']
    if qty_col and qty_col != value_col:
        table_cols.insert(3, 'Quantity')

    table = {'columns': table_cols, 'rows': []}
    cumulative = 0
    for rank, (_, row) in enumerate(grouped.iterrows(), 1):
        pct = row[value_col] / total_value * 100 if total_value > 0 else 0
        cumulative += pct
        r = [rank, str(row[region_col]), format_currency(row[value_col], chart_config)]
        if qty_col and qty_col != value_col:
            r.append(int(row[qty_col]))
        r.extend([f"{pct:.1f}%", f"{cumulative:.1f}%"])
        table['rows'].append(r)

    return {
        'summary': summary,
        'charts': [chart],
        'table': table,
    }
