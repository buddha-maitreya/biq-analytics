"""
Customer Lifetime Value (CLV) -- BG/NBD + Gamma-Gamma probabilistic model.
"""

import logging
import warnings
from typing import Any
from datetime import timedelta

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
        return {"success": False, "error": "No data provided"}

    colors = apply_style(chart_config)
    palette = get_color_palette(colors, 6)

    df = pd.DataFrame(data)

    customer_col = next((c for c in ["customer_name", "customer", "name", "client", "buyer"] if c in df.columns), None)
    date_col = next((c for c in ["date", "sale_date", "created_at", "order_date"] if c in df.columns), None)
    amt_col = next((c for c in ["amount", "revenue", "total", "total_amount"] if c in df.columns), None)

    if not customer_col or not date_col or not amt_col:
        return {"success": False, "error": f"Need customer, date, and amount columns. Found: {list(df.columns)}"}

    df[date_col] = pd.to_datetime(df[date_col])
    df[amt_col] = pd.to_numeric(df[amt_col], errors="coerce").fillna(0)
    df = df[df[amt_col] > 0]

    prediction_months = params.get("predictionMonths", 12)
    discount_rate = params.get("discountRateMonthly", 0.01)
    min_transactions = params.get("minimumTransactions", 2)
    prediction_days = prediction_months * 30

    now = df[date_col].max()

    try:
        from lifetimes.utils import summary_data_from_transaction_data
    except ImportError:
        return {"success": False, "error": "lifetimes library not installed. Install with: pip install lifetimes"}

    rfm = summary_data_from_transaction_data(
        df, customer_col, date_col, monetary_value_col=amt_col, observation_period_end=now,
    )

    rfm = rfm[rfm["frequency"] >= min_transactions]
    if len(rfm) == 0:
        return {"success": False, "error": f"No customers with >= {min_transactions} transactions"}

    from lifetimes import BetaGeoFitter
    bgf = BetaGeoFitter(penalizer_coef=0.01)
    bgf.fit(rfm["frequency"], rfm["recency"], rfm["T"])

    rfm["predicted_purchases"] = bgf.conditional_expected_number_of_purchases_up_to_time(
        prediction_days, rfm["frequency"], rfm["recency"], rfm["T"]
    )

    from lifetimes import GammaGammaFitter
    ggf = GammaGammaFitter(penalizer_coef=0.01)
    gg_data = rfm[(rfm["frequency"] > 0) & (rfm["monetary_value"] > 0)]
    ggf.fit(gg_data["frequency"], gg_data["monetary_value"])

    rfm.loc[gg_data.index, "predicted_avg_value"] = ggf.conditional_expected_average_profit(
        gg_data["frequency"], gg_data["monetary_value"]
    )
    rfm["predicted_avg_value"] = rfm["predicted_avg_value"].fillna(rfm["monetary_value"])

    rfm["clv"] = ggf.customer_lifetime_value(
        bgf, gg_data["frequency"], gg_data["recency"], gg_data["T"],
        gg_data["monetary_value"], time=prediction_months, discount_rate=discount_rate,
    ).reindex(rfm.index, fill_value=0)

    rfm = rfm.sort_values("clv", ascending=False).reset_index()
    rfm["clv_segment"] = pd.qcut(rfm["clv"], q=4, labels=["Low", "Medium", "High", "Premium"], duplicates="drop")

    fig, axes = plt.subplots(1, 3, figsize=(16, 5))

    axes[0].hist(rfm["clv"], bins=30, color=palette[0], alpha=0.8, edgecolor="white")
    axes[0].set_xlabel("Customer Lifetime Value")
    axes[0].set_ylabel("Customers")
    axes[0].set_title("CLV Distribution", fontsize=12, fontweight="bold")
    axes[0].axvline(rfm["clv"].median(), color=palette[1], linestyle="--",
                    label=f"Median: {format_currency(rfm['clv'].median(), chart_config)}")
    axes[0].legend(fontsize=8)

    top20 = rfm.head(20)
    y_pos = range(len(top20))
    axes[1].barh(y_pos, top20["clv"], color=palette[2], alpha=0.8)
    axes[1].set_yticks(y_pos)
    axes[1].set_yticklabels(top20[customer_col], fontsize=7)
    axes[1].set_xlabel("Predicted CLV")
    axes[1].set_title(f"Top 20 Customers ({prediction_months}mo CLV)", fontsize=12, fontweight="bold")
    axes[1].invert_yaxis()

    seg_clv = rfm.groupby("clv_segment")["clv"].agg(["sum", "count"]).sort_values("sum", ascending=False)
    axes[2].bar(seg_clv.index.astype(str), seg_clv["sum"], color=palette[:len(seg_clv)])
    axes[2].set_xlabel("CLV Segment")
    axes[2].set_ylabel("Total Predicted CLV")
    axes[2].set_title("Predicted Revenue by Segment", fontsize=12, fontweight="bold")
    for i, (seg, row) in enumerate(seg_clv.iterrows()):
        axes[2].text(i, row["sum"], f"n={int(row['count'])}", ha="center", va="bottom", fontsize=8)

    add_watermark(fig, chart_config)
    fig.tight_layout()
    chart = fig_to_base64(fig, chart_config, width=1600, height=500)
    chart["title"] = f"Customer Lifetime Value ({prediction_months} Months)"

    summary = {
        "totalCustomers": len(rfm),
        "predictionMonths": prediction_months,
        "discountRateMonthly": discount_rate,
        "totalPredictedClv": round(float(rfm["clv"].sum()), 2),
        "avgClv": round(float(rfm["clv"].mean()), 2),
        "medianClv": round(float(rfm["clv"].median()), 2),
        "maxClv": round(float(rfm["clv"].max()), 2),
        "avgPredictedPurchases": round(float(rfm["predicted_purchases"].mean()), 2),
        "avgPredictedValue": round(float(rfm["predicted_avg_value"].mean()), 2),
        "segments": {
            str(seg): {"count": int(row["count"]), "totalClv": round(float(row["sum"]), 2)}
            for seg, row in seg_clv.iterrows()
        },
        "modelParams": {
            "bgNbd": {k: round(float(v), 4) for k, v in bgf.params_.items()},
            "gammaGamma": {k: round(float(v), 4) for k, v in ggf.params_.items()},
        },
    }

    table = {
        "columns": ["Customer", "Frequency", "Recency (days)", "Monetary Avg",
                     "Pred. Purchases", "Pred. Avg Value", "CLV", "Segment"],
        "rows": [
            [str(row[customer_col]), int(row["frequency"]), int(row["recency"]),
             format_currency(row["monetary_value"], chart_config),
             round(float(row["predicted_purchases"]), 1),
             format_currency(row["predicted_avg_value"], chart_config),
             format_currency(row["clv"], chart_config), str(row["clv_segment"])]
            for _, row in rfm.head(100).iterrows()
        ],
    }

    return {
        "success": True,
        "summary": summary,
        "charts": [chart],
        "table": table,
    }
