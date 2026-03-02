/**
 * Predictive Analytics Section — UI component for running pre-built analytics.
 *
 * Renders a card-based selector grouped by category (forecasting, classification,
 * anomaly, charts). Users pick a type, configure date range, and run the module.
 * Results display structured summaries, charts (as base64 images), and data tables.
 *
 * API:
 *   GET  /api/predictive-analytics/types  — Available analytics types
 *   POST /api/predictive-analytics/run    — Execute analytics module
 */

import React, { useState, useEffect, useCallback } from "react";

// ── Types ───────────────────────────────────────────────────

interface AnalyticsType {
  action: string;
  label: string;
  description: string;
  category: "forecasting" | "classification" | "anomaly" | "charts" | "insights";
  icon: string;
}

interface AnalyticsChart {
  title: string;
  format: "png" | "svg";
  data: string; // base64
  width: number;
  height: number;
}

interface AnalyticsResult {
  success: boolean;
  summary?: Record<string, unknown>;
  insight?: string;
  charts?: AnalyticsChart[];
  table?: { columns: string[]; rows: (Record<string, unknown> | unknown[])[] };
  meta?: {
    action: string;
    dataRowCount: number;
    durationMs?: number;
    queryMs?: number;
    dateRange?: { start: string; end: string };
  };
  error?: string;
}

// ── Category metadata ───────────────────────────────────────

const CATEGORY_META: Record<string, { label: string; icon: string; color: string }> = {
  forecasting:    { label: "Forecasting",        icon: "📈", color: "#3b82f6" },
  classification: { label: "Classification",     icon: "🏷️", color: "#8b5cf6" },
  anomaly:        { label: "Anomaly Detection",  icon: "🔍", color: "#ef4444" },
  charts:         { label: "Visualizations",     icon: "📊", color: "#10b981" },
  insights:       { label: "Business Insights",  icon: "🏆", color: "#f59e0b" },
};

const CATEGORY_ORDER = ["insights", "forecasting", "classification", "anomaly", "charts"];

// ── Date presets ────────────────────────────────────────────

function getPresetRange(preset: string): { start: string; end: string } {
  const now = new Date();
  const end = now.toISOString().slice(0, 10);
  const ms = (days: number) => new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10);

  switch (preset) {
    case "last30":  return { start: ms(30), end };
    case "last60":  return { start: ms(60), end };
    case "last90":  return { start: ms(90), end };
    case "last180": return { start: ms(180), end };
    case "last365": return { start: ms(365), end };
    default:        return { start: ms(90), end };
  }
}

const DATE_PRESETS = [
  { value: "last30",  label: "30 days" },
  { value: "last60",  label: "60 days" },
  { value: "last90",  label: "90 days" },
  { value: "last180", label: "180 days" },
  { value: "last365", label: "1 year" },
];

// ── Human-friendly summary helpers ──────────────────────────

/** Labels that replace raw camelCase keys in the summary display */
const SUMMARY_LABELS: Record<string, string> = {
  // Prophet / forecasting
  model: "Forecast Model",
  horizonDays: "Forecast Period",
  totalForecast: "Total Predicted Revenue",
  avgDailyForecast: "Average Daily Revenue",
  peakForecastDay: "Busiest Expected Day",
  peakForecastValue: "Peak Day Revenue",
  historicalDays: "Days of History Used",
  historicalAvgDaily: "Recent Daily Average",
  trend: "Revenue Trend",
  trendPct: "Trend Change",
  // ARIMA
  aic: "Model Fit Score",
  rmse: "Prediction Accuracy",
  // Holt-Winters
  alpha: "Level Smoothing",
  beta: "Trend Smoothing",
  gamma: "Seasonal Smoothing",
  // Safety stock
  avgServiceLevel: "Stock Safety Level",
  totalSafetyStockUnits: "Safety Buffer (units)",
  totalReorderUnits: "Recommended Reorder",
  // ABC-XYZ
  aCount: "A-Class Products",
  bCount: "B-Class Products",
  cCount: "C-Class Products",
  // RFM
  segmentCount: "Customer Segments",
  totalCustomers: "Customers Analyzed",
  championsCount: "Top Customers",
  // Generic
  dataRowCount: "Data Points",
  durationMs: "Analysis Time",
};

/** Keys to hide from the summary cards (technical params the user doesn't need) */
const HIDDEN_SUMMARY_KEYS = new Set([
  "confidenceInterval",
  "seasonalityMode",
  "weeklySeasonality",
  "yearlySeasonality",
  "changepointSensitivity",
  "holidayCountry",
  "includeHolidays",
]);

/** Format a summary value for display */
function formatSummaryValue(key: string, val: unknown): string {
  if (val === null || val === undefined) return "—";

  // Trend direction with emoji
  if (key === "trend") {
    const t = String(val).toLowerCase();
    if (t === "up") return "📈 Growing";
    if (t === "down") return "📉 Declining";
    return "➡️ Stable";
  }

  // Trend percentage
  if (key === "trendPct") {
    const n = Number(val);
    const sign = n > 0 ? "+" : "";
    return `${sign}${n.toFixed(1)}%`;
  }

  // Horizon in human terms
  if (key === "horizonDays") {
    const d = Number(val);
    if (d === 7) return "1 week ahead";
    if (d === 14) return "2 weeks ahead";
    if (d === 30) return "~1 month ahead";
    if (d === 60) return "~2 months ahead";
    if (d === 90) return "~3 months ahead";
    return `${d} days ahead`;
  }

  // Duration in seconds
  if (key === "durationMs") return `${(Number(val) / 1000).toFixed(1)}s`;

  // Currency-like large numbers
  if (typeof val === "number") {
    const moneyKeys = ["totalForecast", "avgDailyForecast", "peakForecastValue", "historicalAvgDaily",
                        "totalRevenue", "avgRevenue", "revenue", "monetary"];
    if (moneyKeys.includes(key)) {
      return val >= 1_000_000
        ? `${(val / 1_000_000).toFixed(2)}M`
        : val >= 1_000
          ? `${(val / 1_000).toFixed(1)}K`
          : val.toLocaleString(undefined, { maximumFractionDigits: 0 });
    }
    // Percentages
    if (key.toLowerCase().includes("pct") || key.toLowerCase().includes("percent")) {
      return `${val.toFixed(1)}%`;
    }
    // Integers
    if (val % 1 === 0) return val.toLocaleString();
    // Decimals
    return val.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}

// ── Component ───────────────────────────────────────────────

const HORIZON_PRESETS = [
  { value: 7,  label: "1 week" },
  { value: 14, label: "2 weeks" },
  { value: 30, label: "1 month" },
  { value: 60, label: "2 months" },
  { value: 90, label: "3 months" },
];

/** Actions that expose a forecast horizon control */
const FORECAST_ACTIONS = new Set(["forecast.prophet", "forecast.arima", "forecast.holt_winters"]);

export default function PredictiveAnalytics() {
  const [types, setTypes] = useState<AnalyticsType[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [datePreset, setDatePreset] = useState("last90");
  const [horizonDays, setHorizonDays] = useState(30);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AnalyticsResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const showHorizonPicker = selected !== null && FORECAST_ACTIONS.has(selected);

  // ── Fetch available types on mount ──────────────────────
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/predictive-analytics/types");
        if (res.ok) {
          const { data } = await res.json();
          setTypes(data ?? []);
        }
      } catch {
        // Types endpoint unavailable — show empty state
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ── Run selected analytics ─────────────────────────────
  const runAnalytics = useCallback(async () => {
    if (!selected || running) return;
    setRunning(true);
    setResult(null);
    setError(null);

    const range = getPresetRange(datePreset);

    try {
      const body: Record<string, unknown> = {
        action: selected,
        startDate: range.start,
        endDate: range.end,
      };
      if (FORECAST_ACTIONS.has(selected)) {
        body.params = { horizonDays };
      }

      const res = await fetch("/api/predictive-analytics/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        const detail = data.traceback
          ? `\n\nDiagnostic detail:\n${typeof data.traceback === 'string' ? data.traceback.slice(0, 800) : JSON.stringify(data.traceback).slice(0, 800)}`
          : '';
        setError((data.error || `Request failed (HTTP ${res.status})`) + detail);
      } else {
        setResult(data);
      }
    } catch (err: any) {
      setError(err.message || "Network error");
    } finally {
      setRunning(false);
    }
  }, [selected, datePreset, running]);

  // ── Group types by category ─────────────────────────────
  const grouped = CATEGORY_ORDER
    .map((cat) => ({
      category: cat,
      meta: CATEGORY_META[cat],
      items: types.filter((t) => t.category === cat),
    }))
    .filter((g) => g.items.length > 0);

  const selectedType = types.find((t) => t.action === selected);

  if (loading) {
    return (
      <div className="card" style={{ padding: 24, textAlign: "center" }}>
        <span className="spinner-inline" /> Loading analytics modules...
      </div>
    );
  }

  if (types.length === 0) {
    return (
      <div className="card" style={{ padding: 24, textAlign: "center" }}>
        <p className="text-muted">
          No analytics modules available. Configure the analytics sandbox to enable predictive analytics.
        </p>
      </div>
    );
  }

  return (
    <div className="predictive-analytics-section">
      {/* Category groups */}
      {grouped.map((group) => (
        <div key={group.category} className="analytics-category-group">
          <h4 className="analytics-category-header" style={{ borderLeftColor: group.meta.color }}>
            {group.meta.icon} {group.meta.label}
          </h4>
          <div className="analytics-type-grid">
            {group.items.map((t) => (
              <button
                key={t.action}
                className={`analytics-type-card ${selected === t.action ? "active" : ""}`}
                onClick={() => { setSelected(t.action); setResult(null); setError(null); }}
              >
                <span className="analytics-type-icon">{t.icon}</span>
                <span className="analytics-type-label">{t.label}</span>
                <span className="analytics-type-desc">{t.description}</span>
              </button>
            ))}
          </div>
        </div>
      ))}

      {/* Run panel (shown when a type is selected) */}
      {selected && selectedType && (
        <div className="card analytics-run-panel">
          <div className="analytics-run-header">
            <div>
              <h4 style={{ margin: 0 }}>
                {selectedType.icon} {selectedType.label}
              </h4>
              <p className="text-muted" style={{ fontSize: "0.8rem", margin: "4px 0 0" }}>
                {selectedType.description}
              </p>
            </div>
          </div>

          <div className="analytics-run-config">
            <div className="analytics-config-field">
              <label className="form-label">Historical Data Period</label>
              <div className="analytics-date-pills">
                {DATE_PRESETS.map((p) => (
                  <button
                    key={p.value}
                    className={`analytics-pill ${datePreset === p.value ? "active" : ""}`}
                    onClick={() => setDatePreset(p.value)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {showHorizonPicker && (
              <div className="analytics-config-field">
                <label className="form-label">Forecast Horizon</label>
                <div className="analytics-date-pills">
                  {HORIZON_PRESETS.map((p) => (
                    <button
                      key={p.value}
                      className={`analytics-pill ${horizonDays === p.value ? "active" : ""}`}
                      onClick={() => setHorizonDays(p.value)}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <button
              className="btn btn-primary analytics-run-btn"
              onClick={runAnalytics}
              disabled={running}
            >
              {running ? (
                <><span className="spinner-inline" /> Running analysis...</>
              ) : (
                "🚀 Run Analysis"
              )}
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="card" style={{ borderLeft: "3px solid #ef4444", padding: 16 }}>
          <p style={{ color: "#ef4444", margin: 0, whiteSpace: 'pre-wrap', fontFamily: error.includes('Diagnostic') ? 'monospace' : 'inherit', fontSize: error.includes('Diagnostic') ? '0.8rem' : undefined }}>❌ {error}</p>
        </div>
      )}

      {/* Results */}
      {result && result.success !== false && (
        <div className="card analytics-results">
          <div className="analytics-results-header">
            <h4 style={{ margin: 0 }}>
              {selectedType?.icon} {selectedType?.label} — Results
            </h4>
            {result.meta && (
              <span className="text-muted" style={{ fontSize: "0.75rem" }}>
                {result.meta.dataRowCount?.toLocaleString()} rows analyzed
                {result.meta.durationMs ? ` · ${(result.meta.durationMs / 1000).toFixed(1)}s` : ""}
                {result.meta.dateRange
                  ? ` · ${result.meta.dateRange.start} → ${result.meta.dateRange.end}`
                  : ""}
              </span>
            )}
          </div>

          {/* Narrative insight */}
          {result.insight && (
            <div className="analytics-insight-box">
              <p style={{ margin: 0, lineHeight: 1.6 }}>{result.insight}</p>
            </div>
          )}

          {/* Summary metrics */}
          {result.summary && Object.keys(result.summary).length > 0 && (
            <div className="analytics-summary-grid">
              {Object.entries(result.summary)
                .filter(([key]) => !HIDDEN_SUMMARY_KEYS.has(key))
                .map(([key, val]) => {
                  const label = SUMMARY_LABELS[key] || key.replace(/([A-Z])/g, " $1").replace(/_/g, " ").replace(/^\w/, c => c.toUpperCase()).trim();
                  const formatted = formatSummaryValue(key, val);
                  return (
                    <div key={key} className="analytics-summary-card">
                      <span className="analytics-summary-label">{label}</span>
                      <span className="analytics-summary-value">{formatted}</span>
                    </div>
                  );
                })}
            </div>
          )}

          {/* Charts */}
          {result.charts && result.charts.length > 0 && (
            <div className="analytics-charts">
              {result.charts.map((chart, i) => (
                <div key={i} className="analytics-chart-container">
                  {chart.title && <h5 className="analytics-chart-title">{chart.title}</h5>}
                  <img
                    src={`data:image/${chart.format};base64,${chart.data}`}
                    alt={chart.title || `Chart ${i + 1}`}
                    className="analytics-chart-img"
                    style={{ maxWidth: "100%", height: "auto" }}
                  />
                </div>
              ))}
            </div>
          )}

          {/* Data table */}
          {result.table && result.table.columns.length > 0 && (
            <div className="analytics-table-wrap">
              <table className="analytics-data-table">
                <thead>
                  <tr>
                    {result.table.columns.map((col) => (
                      <th key={col}>{col.replace(/_/g, " ")}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.table.rows.slice(0, 100).map((row, i) => (
                    <tr key={i}>
                      {result.table!.columns.map((col, colIdx) => {
                        // Python modules return rows as arrays, not objects
                        const cellVal = Array.isArray(row) ? row[colIdx] : (row as Record<string, unknown>)[col];
                        return (
                          <td key={col}>
                            {typeof cellVal === "number"
                              ? cellVal % 1 === 0
                                ? cellVal.toLocaleString()
                                : cellVal.toLocaleString(undefined, { maximumFractionDigits: 0 })
                              : String(cellVal ?? "")}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              {result.table.rows.length > 100 && (
                <p className="text-muted" style={{ fontSize: "0.75rem", textAlign: "center", marginTop: 8 }}>
                  Showing first 100 of {result.table.rows.length} rows
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
