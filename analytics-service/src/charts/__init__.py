"""
Chart Utilities -- Shared helpers for all chart modules.

Handles brand-aware styling, currency formatting, base64 encoding,
and consistent chart output format.
"""

import io
import base64
import warnings
import logging

import matplotlib
matplotlib.use("Agg")
warnings.filterwarnings("ignore", message=".*findfont.*")
logging.getLogger("matplotlib.font_manager").setLevel(logging.ERROR)

import matplotlib.pyplot as plt
import matplotlib.ticker as mticker


def apply_style(chart_config: dict) -> dict:
    """Apply brand-aware styling from chart_config. Returns resolved colors."""
    style = chart_config.get("chartStyle", "modern") if chart_config else "modern"

    if style == "minimal":
        plt.style.use("seaborn-v0_8-whitegrid")
    elif style == "classic":
        plt.style.use("classic")
    else:
        plt.style.use("seaborn-v0_8-darkgrid")

    cfg = chart_config or {}
    colors = {
        "primary": cfg.get("primaryColor", "#3b82f6"),
        "secondary": cfg.get("secondaryColor", "#10b981"),
        "accent": cfg.get("accentColor", "#f59e0b"),
        "background": cfg.get("background", "#ffffff"),
        "text": "#1f2937",
        "grid": "#e5e7eb",
    }

    plt.rcParams.update({
        "figure.facecolor": colors["background"],
        "axes.facecolor": colors["background"],
        "text.color": colors["text"],
        "axes.labelcolor": colors["text"],
        "xtick.color": colors["text"],
        "ytick.color": colors["text"],
    })

    font = cfg.get("fontFamily", "sans-serif")
    try:
        plt.rcParams["font.family"] = font
    except Exception:
        plt.rcParams["font.family"] = "sans-serif"

    return colors


def format_currency(value, chart_config: dict) -> str:
    """Format a number as currency using chart_config settings."""
    cfg = chart_config or {}
    symbol = cfg.get("currencySymbol", "KES")
    position = cfg.get("currencyPosition", "prefix")

    if abs(value) >= 1_000_000:
        formatted = f"{value / 1_000_000:,.1f}M"
    elif abs(value) >= 1_000:
        formatted = f"{value / 1_000:,.1f}K"
    else:
        formatted = f"{value:,.0f}"

    if position == "suffix":
        return f"{formatted} {symbol}"
    return f"{symbol} {formatted}"


def currency_formatter(chart_config: dict):
    """Return a matplotlib FuncFormatter for currency axis labels."""
    def _fmt(x, pos):
        return format_currency(x, chart_config)
    return mticker.FuncFormatter(_fmt)


def fig_to_base64(fig, chart_config: dict, width: int = 800, height: int = 400) -> dict:
    """Convert a matplotlib figure to a base64-encoded PNG dict."""
    cfg = chart_config or {}
    dpi = cfg.get("dpiWeb", 150)

    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=dpi, bbox_inches="tight",
                facecolor=fig.get_facecolor(), edgecolor="none")
    buf.seek(0)
    b64 = base64.b64encode(buf.read()).decode("utf-8")
    buf.close()
    plt.close(fig)

    return {
        "format": "png",
        "data": b64,
        "width": width,
        "height": height,
    }


def get_color_palette(colors: dict, n: int = 6) -> list:
    """Generate a color palette with n colors based on brand colors."""
    base = [colors["primary"], colors["secondary"], colors["accent"]]
    extras = ["#6366f1", "#ec4899", "#14b8a6", "#f97316", "#8b5cf6", "#06b6d4"]
    palette = base + [c for c in extras if c not in base]
    return palette[:n]


def add_watermark(fig, chart_config: dict):
    """Add watermark text if enabled."""
    cfg = chart_config or {}
    if cfg.get("watermarkEnabled") and cfg.get("watermarkText"):
        fig.text(0.5, 0.5, cfg["watermarkText"],
                 fontsize=40, color="gray", alpha=0.1,
                 ha="center", va="center", rotation=30,
                 transform=fig.transFigure)
