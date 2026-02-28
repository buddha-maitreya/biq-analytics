"""
ABC-XYZ Classification — Dual-axis inventory segmentation.

ABC = Revenue contribution (Pareto): A = top 80%, B = next 15%, C = bottom 5%
XYZ = Demand variability (CV of weekly demand): X = stable, Y = moderate, Z = erratic

The 9-cell matrix (AX, AY, AZ, BX, BY, BZ, CX, CY, CZ) drives inventory strategy:
  AX → high value, stable demand  → lean JIT, tight safety stock
  AZ → high value, erratic demand → buffer stock, close monitoring
  CZ → low value, erratic         → drop or simplify

Input data:
  [{ "product_name": "Widget A", "date": "2026-01-15", "quantity": 5, "amount": 250 }, ...]

Params from AbcParams + XyzParams:
  aThresholdPct, bThresholdPct, xCvThreshold, yCvThreshold, periodDays, revenueMetric
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
    palette = get_color_palette(colors, 9)

    df = pd.DataFrame(data)

    # Resolve columns
    product_col = next((c for c in ['product_name', 'name', 'sku', 'item', 'product'] if c in df.columns), None)
    date_col = next((c for c in ['date', 'sale_date', 'created_at', 'order_date'] if c in df.columns), None)
    qty_col = next((c for c in ['quantity', 'qty', 'units_sold', 'demand'] if c in df.columns), None)
    amt_col = next((c for c in ['amount', 'revenue', 'total', 'total_amount', 'sales'] if c in df.columns), None)

    if not product_col or not date_col:
        return {"error": f"Missing required columns. Found: {list(df.columns)}"}

    df[date_col] = pd.to_datetime(df[date_col])
    if qty_col:
        df[qty_col] = pd.to_numeric(df[qty_col], errors='coerce').fillna(0)
    if amt_col:
        df[amt_col] = pd.to_numeric(df[amt_col], errors='coerce').fillna(0)

    # ── Parameters ──
    a_pct = params.get('aThresholdPct', 80)
    b_pct = params.get('bThresholdPct', 15)
    x_cv = params.get('xCvThreshold', 0.5)
    y_cv = params.get('yCvThreshold', 1.0)

    # ── ABC: Revenue contribution ──
    revenue_col = amt_col or qty_col
    if not revenue_col:
        return {"error": "Need either amount or quantity column for ABC analysis"}

    product_revenue = df.groupby(product_col)[revenue_col].sum().sort_values(ascending=False)
    total_revenue = product_revenue.sum()
    cumulative_pct = (product_revenue.cumsum() / total_revenue * 100) if total_revenue > 0 else product_revenue * 0

    abc_map = {}
    for product, cum_pct in cumulative_pct.items():
        if cum_pct <= a_pct:
            abc_map[product] = 'A'
        elif cum_pct <= a_pct + b_pct:
            abc_map[product] = 'B'
        else:
            abc_map[product] = 'C'

    # ── XYZ: Demand variability (CV of weekly demand) ──
    df['_week'] = df[date_col].dt.isocalendar().week.astype(int)
    df['_year'] = df[date_col].dt.year
    demand_col = qty_col or revenue_col

    weekly = df.groupby([product_col, '_year', '_week'])[demand_col].sum().reset_index()
    weekly_stats = weekly.groupby(product_col)[demand_col].agg(['mean', 'std']).fillna(0)
    weekly_stats['cv'] = weekly_stats['std'] / weekly_stats['mean'].replace(0, np.nan)
    weekly_stats['cv'] = weekly_stats['cv'].fillna(0)

    xyz_map = {}
    for product, row in weekly_stats.iterrows():
        if row['cv'] <= x_cv:
            xyz_map[product] = 'X'
        elif row['cv'] <= y_cv:
            xyz_map[product] = 'Y'
        else:
            xyz_map[product] = 'Z'

    # ── Build results DataFrame ──
    results = []
    for product in product_revenue.index:
        abc = abc_map.get(product, 'C')
        xyz = xyz_map.get(product, 'Z')
        cv = weekly_stats.loc[product, 'cv'] if product in weekly_stats.index else 0
        rev = product_revenue[product]
        results.append({
            'product': str(product),
            'revenue': round(float(rev), 2),
            'revenuePct': round(float(rev / total_revenue * 100), 1) if total_revenue > 0 else 0,
            'cumulativePct': round(float(cumulative_pct[product]), 1),
            'abc': abc,
            'cv': round(float(cv), 3),
            'xyz': xyz,
            'segment': f"{abc}{xyz}",
        })

    results_df = pd.DataFrame(results)

    # ── Matrix counts ──
    matrix = {}
    for seg in ['AX', 'AY', 'AZ', 'BX', 'BY', 'BZ', 'CX', 'CY', 'CZ']:
        count = len(results_df[results_df['segment'] == seg])
        rev = results_df[results_df['segment'] == seg]['revenue'].sum()
        matrix[seg] = {'count': count, 'revenue': round(float(rev), 2)}

    # ── Chart 1: ABC-XYZ scatter ──
    fig, axes = plt.subplots(1, 2, figsize=(14, 6))

    # Scatter: revenue vs CV, colored by ABC class
    abc_colors = {'A': palette[0], 'B': palette[2], 'C': palette[4]}
    for abc_class in ['A', 'B', 'C']:
        mask = results_df['abc'] == abc_class
        subset = results_df[mask]
        axes[0].scatter(
            subset['cv'], subset['revenue'],
            c=abc_colors[abc_class], label=f"Class {abc_class} ({len(subset)})",
            alpha=0.7, s=50, edgecolors='white', linewidth=0.5
        )

    # Draw XYZ boundaries
    axes[0].axvline(x=x_cv, color='gray', linestyle='--', alpha=0.5, label=f'X/Y boundary (CV={x_cv})')
    axes[0].axvline(x=y_cv, color='gray', linestyle=':', alpha=0.5, label=f'Y/Z boundary (CV={y_cv})')
    axes[0].set_xlabel('Demand Variability (CV)')
    axes[0].set_ylabel('Total Revenue')
    axes[0].set_title('ABC-XYZ Classification', fontsize=12, fontweight='bold')
    axes[0].legend(fontsize=8)

    # Chart 2: Matrix heatmap
    matrix_data = np.zeros((3, 3))
    labels = [['AX', 'AY', 'AZ'], ['BX', 'BY', 'BZ'], ['CX', 'CY', 'CZ']]
    for i, row in enumerate(labels):
        for j, seg in enumerate(row):
            matrix_data[i][j] = matrix[seg]['count']

    im = axes[1].imshow(matrix_data, cmap='YlOrRd', aspect='auto')
    axes[1].set_xticks([0, 1, 2])
    axes[1].set_xticklabels(['X (Stable)', 'Y (Variable)', 'Z (Erratic)'])
    axes[1].set_yticks([0, 1, 2])
    axes[1].set_yticklabels(['A (High)', 'B (Medium)', 'C (Low)'])
    axes[1].set_title('Segment Matrix (Product Count)', fontsize=12, fontweight='bold')

    # Annotate cells
    for i in range(3):
        for j in range(3):
            seg = labels[i][j]
            count = matrix[seg]['count']
            axes[1].text(j, i, f"{seg}\n{count}", ha='center', va='center',
                        fontsize=10, fontweight='bold',
                        color='white' if matrix_data[i][j] > matrix_data.max() * 0.6 else 'black')

    fig.colorbar(im, ax=axes[1], fraction=0.046, pad=0.04)
    add_watermark(fig, chart_config)
    fig.tight_layout()

    chart = fig_to_base64(fig, chart_config, width=1400, height=600)
    chart['title'] = 'ABC-XYZ Classification Matrix'

    # ── Summary ──
    summary = {
        'totalProducts': len(results),
        'totalRevenue': round(float(total_revenue), 2),
        'aCount': len(results_df[results_df['abc'] == 'A']),
        'bCount': len(results_df[results_df['abc'] == 'B']),
        'cCount': len(results_df[results_df['abc'] == 'C']),
        'xCount': len(results_df[results_df['xyz'] == 'X']),
        'yCount': len(results_df[results_df['xyz'] == 'Y']),
        'zCount': len(results_df[results_df['xyz'] == 'Z']),
        'matrix': matrix,
        'thresholds': {
            'aThresholdPct': a_pct,
            'bThresholdPct': b_pct,
            'xCvThreshold': x_cv,
            'yCvThreshold': y_cv,
        },
    }

    # ── Table ──
    table = {
        'columns': ['Product', 'Revenue', 'Revenue %', 'Cumul %', 'ABC', 'CV', 'XYZ', 'Segment'],
        'rows': [[r['product'], format_currency(r['revenue'], chart_config),
                   f"{r['revenuePct']}%", f"{r['cumulativePct']}%",
                   r['abc'], r['cv'], r['xyz'], r['segment']]
                  for r in results[:50]],
    }

    return {
        'summary': summary,
        'charts': [chart],
        'table': table,
    }
