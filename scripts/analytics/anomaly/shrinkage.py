"""
Inventory Shrinkage Detection — Statistical threshold-based anomaly detection.

Detects inventory discrepancies (expected_stock - actual_stock) that exceed
a configurable sigma threshold, indicating potential theft, damage, spoilage,
or counting errors.

Input data:
  [{ "product_name": "Widget A", "expected_stock": 100, "actual_stock": 85,
     "unit_cost": 150, "date": "2026-01-15", "category": "Electronics" }, ...]

Params from ShrinkageParams:
  thresholdSigma, checkFrequencyDays, minValueFlag
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
    palette = get_color_palette(colors, 6)

    df = pd.DataFrame(data)

    # Resolve columns
    product_col = next((c for c in ['product_name', 'name', 'sku', 'item', 'product'] if c in df.columns), None)
    expected_col = next((c for c in ['expected_stock', 'expected', 'system_stock', 'book_stock'] if c in df.columns), None)
    actual_col = next((c for c in ['actual_stock', 'actual', 'counted', 'physical_stock'] if c in df.columns), None)
    cost_col = next((c for c in ['unit_cost', 'cost', 'price', 'unit_price'] if c in df.columns), None)
    date_col = next((c for c in ['date', 'count_date', 'created_at'] if c in df.columns), None)
    category_col = next((c for c in ['category', 'department', 'group', 'type'] if c in df.columns), None)

    if not product_col:
        return {"error": "No product column found"}
    if not expected_col or not actual_col:
        return {"error": f"Need expected_stock and actual_stock columns. Found: {list(df.columns)}"}

    df[expected_col] = pd.to_numeric(df[expected_col], errors='coerce').fillna(0)
    df[actual_col] = pd.to_numeric(df[actual_col], errors='coerce').fillna(0)
    if cost_col:
        df[cost_col] = pd.to_numeric(df[cost_col], errors='coerce').fillna(0)
    if date_col:
        df[date_col] = pd.to_datetime(df[date_col])

    # Parameters
    threshold_sigma = params.get('thresholdSigma', 2.5)
    min_value_flag = params.get('minValueFlag', 1000)

    # ── Calculate discrepancies ──
    df['discrepancy'] = df[expected_col] - df[actual_col]
    df['discrepancy_pct'] = (df['discrepancy'] / df[expected_col].replace(0, np.nan) * 100).fillna(0)

    if cost_col:
        df['shrinkage_value'] = df['discrepancy'] * df[cost_col]
    else:
        df['shrinkage_value'] = df['discrepancy']

    # ── Statistical thresholds ──
    mean_disc = df['discrepancy'].mean()
    std_disc = df['discrepancy'].std()

    if std_disc == 0:
        df['z_score'] = 0.0
    else:
        df['z_score'] = (df['discrepancy'] - mean_disc) / std_disc

    # Flag anomalies: z-score above threshold AND value above minimum
    df['flagged'] = (df['z_score'].abs() >= threshold_sigma)
    if cost_col:
        df['flagged'] = df['flagged'] & (df['shrinkage_value'].abs() >= min_value_flag)

    flagged = df[df['flagged']].sort_values('shrinkage_value', ascending=False)
    not_flagged = df[~df['flagged']]

    # ── Summary by category ──
    category_summary = {}
    if category_col:
        for cat, group in df.groupby(category_col):
            category_summary[str(cat)] = {
                'productCount': len(group),
                'totalDiscrepancy': int(group['discrepancy'].sum()),
                'totalShrinkageValue': round(float(group['shrinkage_value'].sum()), 2),
                'flaggedCount': int(group['flagged'].sum()),
            }

    # ── Charts ──
    fig, axes = plt.subplots(1, 3, figsize=(16, 5))

    # 1. Discrepancy distribution with threshold lines
    axes[0].hist(df['discrepancy'], bins=40, color=palette[0], alpha=0.7, edgecolor='white')
    axes[0].axvline(mean_disc + threshold_sigma * std_disc, color='red', linestyle='--',
                    label=f'+{threshold_sigma}σ')
    axes[0].axvline(mean_disc - threshold_sigma * std_disc, color='red', linestyle='--',
                    label=f'-{threshold_sigma}σ')
    axes[0].axvline(mean_disc, color=palette[1], linestyle='-', alpha=0.5, label='Mean')
    axes[0].set_xlabel('Discrepancy (units)')
    axes[0].set_ylabel('Products')
    axes[0].set_title('Discrepancy Distribution', fontsize=12, fontweight='bold')
    axes[0].legend(fontsize=8)

    # 2. Top flagged items by shrinkage value
    if len(flagged) > 0:
        top_flagged = flagged.head(15)
        y_pos = range(len(top_flagged))
        bar_colors = [palette[3] if v > 0 else palette[4] for v in top_flagged['shrinkage_value']]
        axes[1].barh(y_pos, top_flagged['shrinkage_value'], color=bar_colors, alpha=0.8)
        axes[1].set_yticks(y_pos)
        axes[1].set_yticklabels(top_flagged[product_col], fontsize=7)
        axes[1].set_xlabel('Shrinkage Value')
        axes[1].set_title(f'Top Flagged Items ({len(flagged)} total)', fontsize=12, fontweight='bold')
        axes[1].invert_yaxis()
    else:
        axes[1].text(0.5, 0.5, 'No anomalies detected\nat current threshold',
                    ha='center', va='center', fontsize=12, transform=axes[1].transAxes)
        axes[1].set_title('Flagged Items', fontsize=12, fontweight='bold')

    # 3. Category breakdown (if available)
    if category_col and category_summary:
        cats = sorted(category_summary.keys(), key=lambda k: category_summary[k]['totalShrinkageValue'], reverse=True)
        cat_values = [category_summary[c]['totalShrinkageValue'] for c in cats[:10]]
        cat_flags = [category_summary[c]['flaggedCount'] for c in cats[:10]]
        x_pos = range(len(cats[:10]))
        axes[2].bar(x_pos, cat_values, color=palette[2], alpha=0.7, label='Total Shrinkage')
        axes[2].set_xticks(x_pos)
        axes[2].set_xticklabels(cats[:10], rotation=45, ha='right', fontsize=8)
        axes[2].set_ylabel('Shrinkage Value')
        axes[2].set_title('Shrinkage by Category', fontsize=12, fontweight='bold')
        # Annotate flagged count
        for i, (v, f) in enumerate(zip(cat_values, cat_flags)):
            if f > 0:
                axes[2].text(i, v, f"⚠{f}", ha='center', va='bottom', fontsize=8, color='red')
    else:
        # Scatter: expected vs actual
        axes[2].scatter(not_flagged[expected_col], not_flagged[actual_col],
                       c=palette[0], alpha=0.3, s=15, label='Normal')
        if len(flagged) > 0:
            axes[2].scatter(flagged[expected_col], flagged[actual_col],
                           c='red', alpha=0.8, s=40, marker='x', label='Flagged')
        max_stock = max(df[expected_col].max(), df[actual_col].max())
        axes[2].plot([0, max_stock], [0, max_stock], 'k--', alpha=0.3, label='Perfect match')
        axes[2].set_xlabel('Expected Stock')
        axes[2].set_ylabel('Actual Stock')
        axes[2].set_title('Expected vs Actual', fontsize=12, fontweight='bold')
        axes[2].legend(fontsize=8)

    add_watermark(fig, chart_config)
    fig.tight_layout()
    chart = fig_to_base64(fig, chart_config, width=1600, height=500)
    chart['title'] = 'Inventory Shrinkage Analysis'

    # ── Summary ──
    summary = {
        'totalProducts': len(df),
        'totalDiscrepancyUnits': int(df['discrepancy'].sum()),
        'totalShrinkageValue': round(float(df['shrinkage_value'].sum()), 2),
        'flaggedCount': len(flagged),
        'flaggedValue': round(float(flagged['shrinkage_value'].sum()), 2) if len(flagged) > 0 else 0,
        'thresholdSigma': threshold_sigma,
        'minValueFlag': min_value_flag,
        'meanDiscrepancy': round(float(mean_disc), 2),
        'stdDiscrepancy': round(float(std_disc), 2),
        'shrinkageRate': round(float(df['discrepancy'].sum() / df[expected_col].sum() * 100), 2) if df[expected_col].sum() > 0 else 0,
    }

    if category_summary:
        summary['categories'] = category_summary

    # ── Table ──
    table_cols = ['Product', 'Expected', 'Actual', 'Discrepancy', 'Disc %']
    if cost_col:
        table_cols.append('Shrinkage Value')
    table_cols.extend(['Z-Score', 'Flagged'])

    sorted_df = df.sort_values('shrinkage_value', ascending=False)
    table = {
        'columns': table_cols,
        'rows': [],
    }
    for _, row in sorted_df.head(100).iterrows():
        r = [
            str(row[product_col]),
            int(row[expected_col]),
            int(row[actual_col]),
            int(row['discrepancy']),
            f"{row['discrepancy_pct']:.1f}%",
        ]
        if cost_col:
            r.append(format_currency(row['shrinkage_value'], chart_config))
        r.extend([
            round(float(row['z_score']), 2),
            '⚠ Yes' if row['flagged'] else 'No',
        ])
        table['rows'].append(r)

    return {
        'summary': summary,
        'charts': [chart],
        'table': table,
    }
