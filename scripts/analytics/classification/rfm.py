"""
RFM Customer Segmentation — Recency / Frequency / Monetary scoring.

Assigns each customer a 3-digit score (e.g. 5-4-3) based on quantile bins,
then maps scores to named segments (Champions, Loyal, At Risk, Lost, etc.).

Input data:
  [{ "customer_name": "Alice", "date": "2026-01-15", "amount": 500,
     "order_id": "ORD-001" }, ...]

Params from RfmParams:
  recencyBins, frequencyBins, monetaryBins, analysisPeriodDays, segmentLabels
"""

import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from charts import apply_style, fig_to_base64, get_color_palette, add_watermark, format_currency


def run(data: list, params: dict, chart_config: dict) -> dict:
    if not data:
        return {"error": "No data provided"}

    colors = apply_style(chart_config)
    palette = get_color_palette(colors, 8)

    df = pd.DataFrame(data)

    # Resolve columns
    customer_col = next((c for c in ['customer_name', 'customer', 'name', 'client', 'buyer'] if c in df.columns), None)
    date_col = next((c for c in ['date', 'sale_date', 'created_at', 'order_date'] if c in df.columns), None)
    amt_col = next((c for c in ['amount', 'revenue', 'total', 'total_amount'] if c in df.columns), None)
    order_col = next((c for c in ['order_id', 'id', 'transaction_id', 'invoice_id'] if c in df.columns), None)

    if not customer_col:
        return {"error": "No customer column found"}
    if not date_col:
        return {"error": "No date column found"}

    df[date_col] = pd.to_datetime(df[date_col])
    if amt_col:
        df[amt_col] = pd.to_numeric(df[amt_col], errors='coerce').fillna(0)

    # Parameters
    r_bins = params.get('recencyBins', 5)
    f_bins = params.get('frequencyBins', 5)
    m_bins = params.get('monetaryBins', 5)
    period_days = params.get('analysisPeriodDays', 365)

    # Filter to analysis period
    now = df[date_col].max()
    cutoff = now - timedelta(days=period_days)
    df = df[df[date_col] >= cutoff]

    if len(df) == 0:
        return {"error": "No data within analysis period"}

    # ── Compute RFM metrics per customer ──
    agg_dict = {}
    agg_dict['recency'] = (date_col, lambda x: (now - x.max()).days)

    if order_col:
        agg_dict['frequency'] = (order_col, 'nunique')
    else:
        agg_dict['frequency'] = (date_col, 'count')

    if amt_col:
        agg_dict['monetary'] = (amt_col, 'sum')

    rfm = df.groupby(customer_col).agg(**agg_dict).reset_index()

    if 'monetary' not in rfm.columns:
        rfm['monetary'] = rfm['frequency']

    # ── Score using quantile bins ──
    # Recency: lower is better → reverse scoring
    rfm['R'] = pd.qcut(rfm['recency'], q=r_bins, labels=range(r_bins, 0, -1), duplicates='drop').astype(int)
    rfm['F'] = pd.qcut(rfm['frequency'].rank(method='first'), q=f_bins, labels=range(1, f_bins + 1), duplicates='drop').astype(int)
    rfm['M'] = pd.qcut(rfm['monetary'].rank(method='first'), q=m_bins, labels=range(1, m_bins + 1), duplicates='drop').astype(int)

    rfm['rfm_score'] = rfm['R'] * 100 + rfm['F'] * 10 + rfm['M']

    # ── Segment assignment ──
    segment_labels = params.get('segmentLabels', {
        'champions': [5, 4, 4],
        'loyal': [3, 3, 3],
        'potential_loyalists': [4, 2, 2],
        'at_risk': [2, 3, 3],
        'hibernating': [1, 1, 1],
        'lost': [1, 1, 2],
    })

    def assign_segment(row):
        r, f, m = row['R'], row['F'], row['M']
        best_match = 'other'
        best_score = -1
        for label, thresholds in segment_labels.items():
            min_r, min_f, min_m = thresholds
            if r >= min_r and f >= min_f and m >= min_m:
                match_score = min_r + min_f + min_m
                if match_score > best_score:
                    best_score = match_score
                    best_match = label
        return best_match.replace('_', ' ').title()

    rfm['segment'] = rfm.apply(assign_segment, axis=1)

    # ── Segment summary ──
    seg_summary = rfm.groupby('segment').agg(
        count=(customer_col, 'count'),
        avg_recency=('recency', 'mean'),
        avg_frequency=('frequency', 'mean'),
        avg_monetary=('monetary', 'mean'),
        total_monetary=('monetary', 'sum'),
    ).reset_index()

    # ── Charts ──
    fig, axes = plt.subplots(1, 3, figsize=(16, 5))

    # 1. Segment distribution (pie)
    seg_counts = rfm['segment'].value_counts()
    axes[0].pie(seg_counts.values, labels=seg_counts.index, autopct='%1.0f%%',
                colors=palette[:len(seg_counts)], startangle=90, textprops={'fontsize': 8})
    axes[0].set_title('Customer Segments', fontsize=12, fontweight='bold')

    # 2. R vs F scatter colored by M
    scatter = axes[1].scatter(rfm['R'], rfm['F'], c=rfm['M'], cmap='RdYlGn',
                              alpha=0.6, s=30, edgecolors='white', linewidth=0.3)
    axes[1].set_xlabel('Recency Score')
    axes[1].set_ylabel('Frequency Score')
    axes[1].set_title('R vs F (color = Monetary)', fontsize=12, fontweight='bold')
    fig.colorbar(scatter, ax=axes[1], label='M Score')

    # 3. Revenue by segment (bar)
    seg_rev = seg_summary.sort_values('total_monetary', ascending=True)
    axes[2].barh(seg_rev['segment'], seg_rev['total_monetary'], color=palette[:len(seg_rev)])
    axes[2].set_xlabel('Total Revenue')
    axes[2].set_title('Revenue by Segment', fontsize=12, fontweight='bold')
    for i, (_, row) in enumerate(seg_rev.iterrows()):
        axes[2].text(row['total_monetary'] * 1.02, i, format_currency(row['total_monetary'], chart_config),
                    va='center', fontsize=8)

    add_watermark(fig, chart_config)
    fig.tight_layout()
    chart = fig_to_base64(fig, chart_config, width=1600, height=500)
    chart['title'] = 'RFM Customer Segmentation'

    # ── Summary ──
    summary = {
        'totalCustomers': len(rfm),
        'analysisPeriodDays': period_days,
        'segments': {
            row['segment']: {
                'count': int(row['count']),
                'avgRecencyDays': round(float(row['avg_recency']), 1),
                'avgFrequency': round(float(row['avg_frequency']), 1),
                'avgMonetary': round(float(row['avg_monetary']), 2),
                'totalRevenue': round(float(row['total_monetary']), 2),
            }
            for _, row in seg_summary.iterrows()
        },
        'avgRecencyDays': round(float(rfm['recency'].mean()), 1),
        'avgFrequency': round(float(rfm['frequency'].mean()), 1),
        'avgMonetary': round(float(rfm['monetary'].mean()), 2),
    }

    # ── Table ──
    rfm_sorted = rfm.sort_values('monetary', ascending=False)
    table = {
        'columns': ['Customer', 'Recency (days)', 'Frequency', 'Monetary', 'R', 'F', 'M', 'Segment'],
        'rows': [
            [str(row[customer_col]), int(row['recency']), int(row['frequency']),
             format_currency(row['monetary'], chart_config),
             int(row['R']), int(row['F']), int(row['M']), row['segment']]
            for _, row in rfm_sorted.head(100).iterrows()
        ],
    }

    return {
        'summary': summary,
        'charts': [chart],
        'table': table,
    }
