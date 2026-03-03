"""
Transaction Anomaly Detection -- Isolation Forest / Local Outlier Factor.
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

    date_col = next((c for c in ["date", "sale_date", "created_at", "order_date"] if c in df.columns), None)
    amt_col = next((c for c in ["amount", "revenue", "total", "total_amount"] if c in df.columns), None)
    qty_col = next((c for c in ["quantity", "qty", "units_sold"] if c in df.columns), None)
    product_col = next((c for c in ["product_name", "name", "sku", "item", "product"] if c in df.columns), None)
    customer_col = next((c for c in ["customer_name", "customer", "client"] if c in df.columns), None)

    if not date_col:
        return {"success": False, "error": "No date column found"}

    df[date_col] = pd.to_datetime(df[date_col])
    if amt_col:
        df[amt_col] = pd.to_numeric(df[amt_col], errors="coerce").fillna(0)
    if qty_col:
        df[qty_col] = pd.to_numeric(df[qty_col], errors="coerce").fillna(0)

    contamination = params.get("contamination", 0.02)
    lookback_days = params.get("lookbackDays", 90)
    algorithm = params.get("algorithm", "isolation_forest")
    feature_names = params.get("features", ["amount", "quantity", "hour_of_day", "day_of_week"])

    now = df[date_col].max()
    cutoff = now - timedelta(days=lookback_days)
    df = df[df[date_col] >= cutoff].copy()

    if len(df) < 10:
        return {"success": False, "error": f"Only {len(df)} transactions in lookback period. Need at least 10."}

    df["hour_of_day"] = df[date_col].dt.hour
    df["day_of_week"] = df[date_col].dt.dayofweek

    feature_cols = []
    for f in feature_names:
        if f == "amount" and amt_col:
            feature_cols.append(amt_col)
        elif f == "quantity" and qty_col:
            feature_cols.append(qty_col)
        elif f in df.columns:
            feature_cols.append(f)

    if len(feature_cols) == 0:
        return {"success": False, "error": "No valid features available for anomaly detection"}

    X = df[feature_cols].copy().fillna(0)

    from sklearn.preprocessing import StandardScaler
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    if algorithm == "local_outlier_factor":
        from sklearn.neighbors import LocalOutlierFactor
        model = LocalOutlierFactor(n_neighbors=min(20, len(X) - 1), contamination=contamination)
        labels = model.fit_predict(X_scaled)
        scores = -model.negative_outlier_factor_
    else:
        from sklearn.ensemble import IsolationForest
        model = IsolationForest(contamination=contamination, random_state=42, n_estimators=100)
        labels = model.fit_predict(X_scaled)
        scores = -model.score_samples(X_scaled)

    df["anomaly"] = labels == -1
    df["anomaly_score"] = scores

    if amt_col:
        mean_amt = df[amt_col].mean()
        std_amt = df[amt_col].std()
        df["amount_zscore"] = ((df[amt_col] - mean_amt) / std_amt).abs() if std_amt > 0 else 0

    anomalies = df[df["anomaly"]].sort_values("anomaly_score", ascending=False)
    normal = df[~df["anomaly"]]

    fig, axes = plt.subplots(1, 3, figsize=(16, 5))

    axes[0].scatter(normal[date_col], normal[amt_col] if amt_col else normal.index,
                    c=palette[0], alpha=0.3, s=10, label="Normal")
    if len(anomalies) > 0:
        axes[0].scatter(anomalies[date_col], anomalies[amt_col] if amt_col else anomalies.index,
                        c="red", alpha=0.8, s=40, marker="x", label=f"Anomaly ({len(anomalies)})")
    axes[0].set_xlabel("Date")
    axes[0].set_ylabel("Amount" if amt_col else "Index")
    axes[0].set_title("Transaction Timeline", fontsize=12, fontweight="bold")
    axes[0].legend(fontsize=8)
    axes[0].tick_params(axis="x", rotation=30)

    axes[1].hist(df["anomaly_score"], bins=50, color=palette[1], alpha=0.7, edgecolor="white")
    threshold = anomalies["anomaly_score"].min() if len(anomalies) > 0 else scores.max()
    axes[1].axvline(threshold, color="red", linestyle="--", label="Threshold")
    axes[1].set_xlabel("Anomaly Score")
    axes[1].set_ylabel("Count")
    axes[1].set_title("Anomaly Score Distribution", fontsize=12, fontweight="bold")
    axes[1].legend(fontsize=8)

    if len(feature_cols) >= 2:
        f1, f2 = feature_cols[0], feature_cols[1]
        axes[2].scatter(normal[f1], normal[f2], c=palette[0], alpha=0.3, s=10, label="Normal")
        if len(anomalies) > 0:
            axes[2].scatter(anomalies[f1], anomalies[f2], c="red", alpha=0.8, s=40, marker="x", label="Anomaly")
        axes[2].set_xlabel(f1)
        axes[2].set_ylabel(f2)
        axes[2].set_title(f"{f1} vs {f2}", fontsize=12, fontweight="bold")
        axes[2].legend(fontsize=8)
    else:
        axes[2].text(0.5, 0.5, "Need >= 2 features\nfor scatter plot",
                     ha="center", va="center", fontsize=12, transform=axes[2].transAxes)
        axes[2].set_title("Feature Scatter", fontsize=12, fontweight="bold")

    add_watermark(fig, chart_config)
    fig.tight_layout()
    chart = fig_to_base64(fig, chart_config, width=1600, height=500)
    chart["title"] = "Transaction Anomaly Detection"

    summary = {
        "totalTransactions": len(df),
        "anomaliesDetected": len(anomalies),
        "anomalyRate": round(float(len(anomalies) / len(df) * 100), 2),
        "algorithm": algorithm,
        "contamination": contamination,
        "lookbackDays": lookback_days,
        "featuresUsed": feature_cols,
    }

    if amt_col and len(anomalies) > 0:
        summary["anomalyTotalAmount"] = round(float(anomalies[amt_col].sum()), 2)
        summary["avgAnomalyAmount"] = round(float(anomalies[amt_col].mean()), 2)
        summary["avgNormalAmount"] = round(float(normal[amt_col].mean()), 2)

    table_cols = ["Date"]
    if product_col:
        table_cols.append("Product")
    if customer_col:
        table_cols.append("Customer")
    if amt_col:
        table_cols.append("Amount")
    if qty_col:
        table_cols.append("Quantity")
    table_cols.extend(["Anomaly Score", "Z-Score"])

    table = {"columns": table_cols, "rows": []}
    for _, row in anomalies.head(50).iterrows():
        r = [row[date_col].strftime("%Y-%m-%d %H:%M")]
        if product_col:
            r.append(str(row[product_col]) if product_col in row else "N/A")
        if customer_col:
            r.append(str(row[customer_col]) if customer_col in row else "N/A")
        if amt_col:
            r.append(format_currency(row[amt_col], chart_config))
        if qty_col:
            r.append(int(row[qty_col]))
        r.append(round(float(row["anomaly_score"]), 3))
        r.append(round(float(row.get("amount_zscore", 0)), 2))
        table["rows"].append(r)

    return {
        "success": True,
        "summary": summary,
        "charts": [chart],
        "table": table,
    }
