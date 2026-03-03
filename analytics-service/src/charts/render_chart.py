"""
Generic Chart Renderer -- Renders ChartSpec JSON to enterprise matplotlib charts.

This module accepts ChartSpec format and renders enterprise-grade matplotlib charts.
Unlike other analytics modules, the actual chart data is inside params['charts'],
not in the 'data' arg.
"""

import logging
import warnings
import re
from typing import Any

warnings.filterwarnings("ignore")

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
import matplotlib.ticker as mticker
import pandas as pd
import numpy as np

from src.charts import apply_style, fig_to_base64, currency_formatter, get_color_palette, add_watermark, format_currency

logger = logging.getLogger(__name__)


def _is_date_field(values) -> bool:
    if len(values) == 0:
        return False
    sample = str(values.iloc[0]) if hasattr(values, "iloc") else str(values[0])
    return bool(re.match(r"^\d{4}-\d{2}(-\d{2})?", sample))


def _is_currency_field(field_name: str) -> bool:
    currency_hints = [
        "revenue", "amount", "total", "price", "cost", "profit", "sales",
        "income", "expense", "margin", "value", "payment", "fee", "spend",
        "budget", "net", "gross",
    ]
    name_lower = (field_name or "").lower().replace("_", " ")
    return any(hint in name_lower for hint in currency_hints)


def _smart_number_format(field_name: str, chart_config: dict):
    if _is_currency_field(field_name):
        return currency_formatter(chart_config)
    else:
        def _fmt(x, pos):
            if abs(x) >= 1_000_000:
                return f"{x / 1_000_000:,.1f}M"
            elif abs(x) >= 1_000:
                return f"{x / 1_000:,.1f}K"
            else:
                return f"{x:,.0f}"
        return mticker.FuncFormatter(_fmt)


def _render_line(spec: dict, chart_config: dict, colors: dict, palette: list) -> plt.Figure:
    df = pd.DataFrame(spec["data"])
    x_field = spec.get("xField", "x")
    y_field = spec.get("yField", "y")
    color_field = spec.get("colorField")
    title = spec.get("title", "Line Chart")

    fig, ax = plt.subplots(figsize=(10, 5))

    if _is_date_field(df[x_field]):
        df[x_field] = pd.to_datetime(df[x_field])
        df = df.sort_values(x_field)

    if color_field and color_field in df.columns:
        groups = df[color_field].unique()
        for i, group in enumerate(groups):
            subset = df[df[color_field] == group]
            c = palette[i % len(palette)]
            ax.plot(subset[x_field], pd.to_numeric(subset[y_field], errors="coerce"),
                    color=c, linewidth=2.5, label=str(group), marker="o", markersize=4)
    else:
        y_vals = pd.to_numeric(df[y_field], errors="coerce").fillna(0)
        ax.plot(df[x_field], y_vals, color=palette[0], alpha=0.4,
                linewidth=1, label=y_field.replace("_", " ").title())
        if len(y_vals) >= 5:
            ma_window = min(7, max(3, len(y_vals) // 5))
            ma = y_vals.rolling(window=ma_window, min_periods=1).mean()
            ax.plot(df[x_field], ma, color=palette[0], linewidth=2.5,
                    label=f"{ma_window}-pt Moving Average")
            ax.fill_between(df[x_field].values, ma * 0.85, ma * 1.15, color=palette[0], alpha=0.08)

    ax.set_title(title, fontsize=14, fontweight="bold", pad=15)
    ax.set_xlabel(spec.get("xLabel", ""), fontsize=11)
    ax.set_ylabel(spec.get("yLabel", y_field.replace("_", " ").title()), fontsize=11)

    if _is_date_field(df[x_field]):
        ax.xaxis.set_major_formatter(mdates.DateFormatter("%b %d"))
        ax.xaxis.set_major_locator(mdates.AutoDateLocator())
        fig.autofmt_xdate()

    ax.yaxis.set_major_formatter(_smart_number_format(y_field, chart_config))
    ax.legend(loc="upper left", framealpha=0.9, fontsize=9)
    ax.grid(True, alpha=0.3)
    return fig


def _render_bar(spec: dict, chart_config: dict, colors: dict, palette: list) -> plt.Figure:
    df = pd.DataFrame(spec["data"])
    x_field = spec.get("xField", "x")
    y_field = spec.get("yField", "y")
    color_field = spec.get("colorField")
    title = spec.get("title", "Bar Chart")
    chart_type = spec.get("type", "bar").lower().replace("_", "")

    df[y_field] = pd.to_numeric(df[y_field], errors="coerce").fillna(0)
    fig, ax = plt.subplots(figsize=(10, 5))

    if color_field and color_field in df.columns and chart_type in ("groupedbar", "stackedbar"):
        groups = df[color_field].unique()
        x_labels = df[x_field].unique()
        x_pos = np.arange(len(x_labels))
        bar_width = 0.8 / max(len(groups), 1)

        if chart_type == "stackedbar":
            bottom = np.zeros(len(x_labels))
            for i, group in enumerate(groups):
                vals = []
                for label in x_labels:
                    match = df[(df[x_field] == label) & (df[color_field] == group)]
                    vals.append(match[y_field].sum() if len(match) > 0 else 0)
                c = palette[i % len(palette)]
                ax.bar(x_pos, vals, bottom=bottom, color=c, label=str(group),
                       edgecolor="white", linewidth=0.5)
                bottom += np.array(vals)
        else:
            for i, group in enumerate(groups):
                vals = []
                for label in x_labels:
                    match = df[(df[x_field] == label) & (df[color_field] == group)]
                    vals.append(match[y_field].sum() if len(match) > 0 else 0)
                c = palette[i % len(palette)]
                offset = (i - len(groups) / 2 + 0.5) * bar_width
                ax.bar(x_pos + offset, vals, bar_width, color=c, label=str(group),
                       edgecolor="white", linewidth=0.5)

        ax.set_xticks(x_pos)
        ax.set_xticklabels([str(l) for l in x_labels], rotation=30, ha="right")
        ax.legend(loc="upper right", framealpha=0.9, fontsize=9)
    else:
        y_vals = df[y_field].values
        x_labels = [str(v) for v in df[x_field].values]
        x_pos = np.arange(len(x_labels))
        max_val = max(abs(y_vals.max()), abs(y_vals.min()), 1)
        alphas = 0.5 + 0.5 * (np.abs(y_vals) / max_val)

        for i, (pos, val, alpha) in enumerate(zip(x_pos, y_vals, alphas)):
            ax.bar(pos, val, color=palette[0], alpha=alpha, edgecolor="white", linewidth=0.5)

        ax.set_xticks(x_pos)
        ax.set_xticklabels(x_labels, rotation=30, ha="right", fontsize=9)

    ax.set_title(title, fontsize=14, fontweight="bold", pad=15)
    ax.set_xlabel(spec.get("xLabel", ""), fontsize=11)
    ax.set_ylabel(spec.get("yLabel", y_field.replace("_", " ").title()), fontsize=11)
    ax.yaxis.set_major_formatter(_smart_number_format(y_field, chart_config))
    ax.grid(True, alpha=0.2, axis="y")
    return fig


def _render_area(spec: dict, chart_config: dict, colors: dict, palette: list) -> plt.Figure:
    df = pd.DataFrame(spec["data"])
    x_field = spec.get("xField", "x")
    y_field = spec.get("yField", "y")
    color_field = spec.get("colorField")
    title = spec.get("title", "Area Chart")

    df[y_field] = pd.to_numeric(df[y_field], errors="coerce").fillna(0)
    fig, ax = plt.subplots(figsize=(10, 5))

    if _is_date_field(df[x_field]):
        df[x_field] = pd.to_datetime(df[x_field])
        df = df.sort_values(x_field)

    if color_field and color_field in df.columns:
        groups = df[color_field].unique()
        for i, group in enumerate(groups):
            subset = df[df[color_field] == group].sort_values(x_field)
            c = palette[i % len(palette)]
            vals = subset[y_field].values
            ax.fill_between(subset[x_field].values, 0, vals, color=c, alpha=0.3, label=str(group))
            ax.plot(subset[x_field], vals, color=c, linewidth=2)
        ax.legend(loc="upper left", framealpha=0.9, fontsize=9)
    else:
        y_vals = df[y_field].values
        ax.fill_between(df[x_field].values, 0, y_vals, color=palette[0], alpha=0.3)
        ax.plot(df[x_field], y_vals, color=palette[0], linewidth=2)

    ax.set_title(title, fontsize=14, fontweight="bold", pad=15)
    ax.set_xlabel(spec.get("xLabel", ""), fontsize=11)
    ax.set_ylabel(spec.get("yLabel", y_field.replace("_", " ").title()), fontsize=11)
    ax.yaxis.set_major_formatter(_smart_number_format(y_field, chart_config))

    if _is_date_field(df[x_field]):
        ax.xaxis.set_major_formatter(mdates.DateFormatter("%b %d"))
        fig.autofmt_xdate()

    ax.grid(True, alpha=0.3)
    return fig


def _render_pie(spec: dict, chart_config: dict, colors: dict, palette: list, donut: bool = False) -> plt.Figure:
    df = pd.DataFrame(spec["data"])
    label_field = spec.get("colorField") or spec.get("xField", "label")
    value_field = spec.get("yField", "value")
    title = spec.get("title", "Pie Chart")

    df[value_field] = pd.to_numeric(df[value_field], errors="coerce").fillna(0)
    df = df[df[value_field] > 0]

    if len(df) > 8:
        df = df.sort_values(value_field, ascending=False)
        top = df.head(7)
        other_val = df.iloc[7:][value_field].sum()
        other_row = pd.DataFrame([{label_field: "Other", value_field: other_val}])
        df = pd.concat([top, other_row], ignore_index=True)

    fig, ax = plt.subplots(figsize=(8, 6))
    wedge_colors = palette[:len(df)]
    wedges, texts, autotexts = ax.pie(
        df[value_field], labels=df[label_field], colors=wedge_colors,
        autopct="%1.1f%%", startangle=90,
        pctdistance=0.75 if donut else 0.6,
        wedgeprops=dict(width=0.5 if donut else 1, edgecolor="white", linewidth=2),
    )
    for text in texts:
        text.set_fontsize(9)
    for autotext in autotexts:
        autotext.set_fontsize(8)
        autotext.set_fontweight("bold")
    ax.set_title(title, fontsize=14, fontweight="bold", pad=20)
    return fig


def _render_scatter(spec: dict, chart_config: dict, colors: dict, palette: list) -> plt.Figure:
    df = pd.DataFrame(spec["data"])
    x_field = spec.get("xField", "x")
    y_field = spec.get("yField", "y")
    color_field = spec.get("colorField")
    title = spec.get("title", "Scatter Plot")

    df[x_field] = pd.to_numeric(df[x_field], errors="coerce")
    df[y_field] = pd.to_numeric(df[y_field], errors="coerce")
    df = df.dropna(subset=[x_field, y_field])

    fig, ax = plt.subplots(figsize=(10, 6))

    if color_field and color_field in df.columns:
        groups = df[color_field].unique()
        for i, group in enumerate(groups):
            subset = df[df[color_field] == group]
            c = palette[i % len(palette)]
            ax.scatter(subset[x_field], subset[y_field], color=c, s=50,
                       alpha=0.7, label=str(group), edgecolors="white", linewidth=0.5)
        ax.legend(loc="best", framealpha=0.9, fontsize=9)
    else:
        ax.scatter(df[x_field], df[y_field], color=palette[0], s=50,
                   alpha=0.7, edgecolors="white", linewidth=0.5)

    if len(df) >= 3:
        try:
            z = np.polyfit(df[x_field].values, df[y_field].values, 1)
            p = np.poly1d(z)
            x_sorted = np.sort(df[x_field].values)
            ax.plot(x_sorted, p(x_sorted), "--", color=colors["accent"],
                    linewidth=1.5, alpha=0.6, label="Trend")
        except Exception:
            pass

    ax.set_title(title, fontsize=14, fontweight="bold", pad=15)
    ax.set_xlabel(spec.get("xLabel", x_field.replace("_", " ").title()), fontsize=11)
    ax.set_ylabel(spec.get("yLabel", y_field.replace("_", " ").title()), fontsize=11)
    ax.xaxis.set_major_formatter(_smart_number_format(x_field, chart_config))
    ax.yaxis.set_major_formatter(_smart_number_format(y_field, chart_config))
    ax.grid(True, alpha=0.3)
    return fig


def _render_heatmap(spec: dict, chart_config: dict, colors: dict, palette: list) -> plt.Figure:
    import seaborn as sns

    df = pd.DataFrame(spec["data"])
    x_field = spec.get("xField", "x")
    y_field = spec.get("yField", "y")
    value_field = spec.get("colorField", "value")
    title = spec.get("title", "Heatmap")

    df[value_field] = pd.to_numeric(df[value_field], errors="coerce").fillna(0)
    try:
        pivot = df.pivot_table(index=y_field, columns=x_field, values=value_field,
                               aggfunc="sum", fill_value=0)
    except Exception:
        pivot = pd.DataFrame(df.set_index([y_field, x_field])[value_field]).unstack(fill_value=0)

    fig, ax = plt.subplots(figsize=(10, max(6, len(pivot) * 0.5 + 2)))
    sns.heatmap(pivot, annot=True, fmt=".0f", cmap="Blues", linewidths=0.5,
                ax=ax, cbar_kws={"shrink": 0.8})
    ax.set_title(title, fontsize=14, fontweight="bold", pad=15)
    ax.set_xlabel(spec.get("xLabel", x_field.replace("_", " ").title()), fontsize=11)
    ax.set_ylabel(spec.get("yLabel", y_field.replace("_", " ").title()), fontsize=11)
    plt.yticks(rotation=0)
    return fig


RENDERERS = {
    "line": _render_line,
    "bar": _render_bar,
    "grouped_bar": _render_bar,
    "groupedbar": _render_bar,
    "stacked_bar": _render_bar,
    "stackedbar": _render_bar,
    "area": _render_area,
    "pie": lambda s, cc, co, p: _render_pie(s, cc, co, p, donut=False),
    "donut": lambda s, cc, co, p: _render_pie(s, cc, co, p, donut=True),
    "arc": lambda s, cc, co, p: _render_pie(s, cc, co, p, donut=False),
    "scatter": _render_scatter,
    "point": _render_scatter,
    "heatmap": _render_heatmap,
    "rect": _render_heatmap,
}


def run(data: list[dict[str, Any]], params: dict[str, Any], chart_config: dict[str, Any] | None = None) -> dict[str, Any]:
    """
    Render one or more ChartSpec objects to enterprise matplotlib charts.

    Unlike other analytics modules, the actual chart data is inside
    params['charts'] (array of ChartSpec objects), not in the 'data' arg.
    """
    chart_config = chart_config or {}
    chart_specs = params.get("charts", [])
    if not chart_specs:
        return {"success": False, "error": "No chart specifications provided in params.charts"}

    colors = apply_style(chart_config)
    palette = get_color_palette(colors, 10)

    rendered_charts = []
    errors = []

    for i, spec in enumerate(chart_specs):
        chart_type = (spec.get("type", "bar") or "bar").lower().replace("-", "").replace("_", "")
        renderer = RENDERERS.get(chart_type, _render_bar)

        try:
            fig = renderer(spec, chart_config, colors, palette)
            add_watermark(fig, chart_config)
            fig.tight_layout()

            w = spec.get("width", 1000)
            h = spec.get("height", 500)
            chart_out = fig_to_base64(fig, chart_config, width=w, height=h)
            chart_out["title"] = spec.get("title", f"Chart {i + 1}")
            rendered_charts.append(chart_out)
        except Exception as e:
            errors.append(f"Chart {i + 1} ({spec.get('title', 'untitled')}): {str(e)}")
            plt.close("all")

    result = {
        "success": True,
        "summary": {
            "chartsRendered": len(rendered_charts),
            "chartsFailed": len(errors),
            "totalRequested": len(chart_specs),
        },
        "charts": rendered_charts,
    }

    if errors:
        result["summary"]["errors"] = errors

    return result
