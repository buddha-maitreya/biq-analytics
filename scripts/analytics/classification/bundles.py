"""
Product Bundle Detection — Association Rule Mining (Apriori / FP-Growth).

Uses mlxtend to discover which products customers frequently buy together.
Returns rules sorted by lift (how much more likely items are bought together
vs. independently).

Input data:
  [{ "order_id": "ORD-001", "product_name": "Widget A" }, ...]

Params from BundleParams:
  minSupport, minConfidence, minLift, maxItemsPerRule
"""

import pandas as pd
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from charts import apply_style, fig_to_base64, get_color_palette, add_watermark


def run(data: list, params: dict, chart_config: dict) -> dict:
    if not data:
        return {"error": "No data provided"}

    colors = apply_style(chart_config)
    palette = get_color_palette(colors, 8)

    df = pd.DataFrame(data)

    # Resolve columns
    order_col = next((c for c in ['order_id', 'transaction_id', 'invoice_id', 'basket_id', 'id'] if c in df.columns), None)
    product_col = next((c for c in ['product_name', 'name', 'sku', 'item', 'product'] if c in df.columns), None)

    if not order_col or not product_col:
        return {"error": f"Need order_id and product_name columns. Found: {list(df.columns)}"}

    # Parameters
    min_support = params.get('minSupport', 0.01)
    min_confidence = params.get('minConfidence', 0.3)
    min_lift = params.get('minLift', 1.5)
    max_items = params.get('maxItemsPerRule', 3)

    # ── Build one-hot encoded basket matrix ──
    baskets = df.groupby([order_col, product_col]).size().reset_index(name='count')
    basket_matrix = baskets.pivot_table(
        index=order_col, columns=product_col, values='count', fill_value=0
    )
    # Convert to boolean (presence/absence)
    basket_bool = (basket_matrix > 0)

    total_baskets = len(basket_bool)
    if total_baskets < 10:
        return {"error": f"Only {total_baskets} baskets found. Need at least 10 for association rules."}

    unique_products = len(basket_bool.columns)
    if unique_products < 2:
        return {"error": "Need at least 2 unique products for bundle detection."}

    # ── Run Apriori ──
    try:
        from mlxtend.frequent_patterns import apriori, association_rules
    except ImportError:
        return {"error": "mlxtend library not installed. Install with: pip install mlxtend"}

    # Use fpgrowth if available (faster), fallback to apriori
    try:
        from mlxtend.frequent_patterns import fpgrowth
        frequent = fpgrowth(basket_bool, min_support=min_support, use_colnames=True, max_len=max_items)
    except Exception:
        frequent = apriori(basket_bool, min_support=min_support, use_colnames=True, max_len=max_items)

    if len(frequent) == 0:
        return {
            "summary": {
                "totalBaskets": total_baskets,
                "uniqueProducts": unique_products,
                "frequentItemsets": 0,
                "rules": 0,
                "message": f"No frequent itemsets found at min_support={min_support}. Try lowering minSupport."
            },
            "charts": [],
            "table": {"columns": [], "rows": []},
        }

    # ── Generate association rules ──
    rules = association_rules(frequent, metric="lift", min_threshold=min_lift, num_items_base=1)
    rules = rules[rules['confidence'] >= min_confidence]
    rules = rules.sort_values('lift', ascending=False).reset_index(drop=True)

    if len(rules) == 0:
        return {
            "summary": {
                "totalBaskets": total_baskets,
                "uniqueProducts": unique_products,
                "frequentItemsets": len(frequent),
                "rules": 0,
                "message": f"No rules found at min_confidence={min_confidence}, min_lift={min_lift}. Try lowering thresholds."
            },
            "charts": [],
            "table": {"columns": [], "rows": []},
        }

    # Format frozensets to readable strings
    rules['antecedents_str'] = rules['antecedents'].apply(lambda x: ' + '.join(sorted(x)))
    rules['consequents_str'] = rules['consequents'].apply(lambda x: ' + '.join(sorted(x)))
    rules['rule'] = rules['antecedents_str'] + ' → ' + rules['consequents_str']

    # ── Charts ──
    fig, axes = plt.subplots(1, 2, figsize=(14, 6))

    # 1. Top rules by lift
    top_rules = rules.head(15)
    y_pos = range(len(top_rules))
    bars = axes[0].barh(y_pos, top_rules['lift'], color=palette[0], alpha=0.8)
    axes[0].set_yticks(y_pos)
    axes[0].set_yticklabels(top_rules['rule'], fontsize=7)
    axes[0].set_xlabel('Lift')
    axes[0].set_title('Top Association Rules by Lift', fontsize=12, fontweight='bold')
    axes[0].invert_yaxis()
    for i, (_, row) in enumerate(top_rules.iterrows()):
        axes[0].text(row['lift'] + 0.1, i, f"conf={row['confidence']:.0%}", va='center', fontsize=7)

    # 2. Support vs Confidence scatter (size = lift)
    scatter = axes[1].scatter(
        rules['support'], rules['confidence'],
        s=rules['lift'] * 30, c=rules['lift'], cmap='YlOrRd',
        alpha=0.6, edgecolors='white', linewidth=0.5
    )
    axes[1].set_xlabel('Support')
    axes[1].set_ylabel('Confidence')
    axes[1].set_title('Support vs Confidence (size = Lift)', fontsize=12, fontweight='bold')
    fig.colorbar(scatter, ax=axes[1], label='Lift')

    add_watermark(fig, chart_config)
    fig.tight_layout()
    chart = fig_to_base64(fig, chart_config, width=1400, height=600)
    chart['title'] = 'Product Bundle Associations'

    # ── Summary ──
    summary = {
        'totalBaskets': total_baskets,
        'uniqueProducts': unique_products,
        'frequentItemsets': len(frequent),
        'rulesFound': len(rules),
        'avgLift': round(float(rules['lift'].mean()), 2),
        'maxLift': round(float(rules['lift'].max()), 2),
        'avgConfidence': round(float(rules['confidence'].mean()), 3),
        'avgSupport': round(float(rules['support'].mean()), 4),
        'topBundle': {
            'rule': rules.iloc[0]['rule'],
            'lift': round(float(rules.iloc[0]['lift']), 2),
            'confidence': round(float(rules.iloc[0]['confidence']), 3),
            'support': round(float(rules.iloc[0]['support']), 4),
        } if len(rules) > 0 else None,
    }

    # ── Table ──
    table = {
        'columns': ['Antecedent (If bought)', 'Consequent (Also buy)', 'Support', 'Confidence', 'Lift'],
        'rows': [
            [row['antecedents_str'], row['consequents_str'],
             f"{row['support']:.3f}", f"{row['confidence']:.1%}",
             f"{row['lift']:.2f}"]
            for _, row in rules.head(50).iterrows()
        ],
    }

    return {
        'summary': summary,
        'charts': [chart],
        'table': table,
    }
