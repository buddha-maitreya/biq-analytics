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
  category: "forecasting" | "classification" | "anomaly" | "charts";
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
  charts?: AnalyticsChart[];
  table?: { columns: string[]; rows: Record<string, unknown>[] };
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
  forecasting:    { label: "Forecasting",     icon: "📈", color: "#3b82f6" },
  classification: { label: "Classification",  icon: "🏷️", color: "#8b5cf6" },
  anomaly:        { label: "Anomaly Detection", icon: "🔍", color: "#ef4444" },
  charts:         { label: "Visualizations",  icon: "📊", color: "#10b981" },
};

const CATEGORY_ORDER = ["forecasting", "classification", "anomaly", "charts"];

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

// ── Component ───────────────────────────────────────────────

export default function PredictiveAnalytics() {
  const [types, setTypes] = useState<AnalyticsType[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [datePreset, setDatePreset] = useState("last90");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AnalyticsResult | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      const res = await fetch("/api/predictive-analytics/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: selected,
          startDate: range.start,
          endDate: range.end,
        }),
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        setError(data.error || `Request failed (HTTP ${res.status})`);
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
              <label className="form-label">Data Period</label>
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
          <p style={{ color: "#ef4444", margin: 0 }}>❌ {error}</p>
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

          {/* Summary metrics */}
          {result.summary && Object.keys(result.summary).length > 0 && (
            <div className="analytics-summary-grid">
              {Object.entries(result.summary).map(([key, val]) => (
                <div key={key} className="analytics-summary-card">
                  <span className="analytics-summary-label">
                    {key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                  </span>
                  <span className="analytics-summary-value">
                    {typeof val === "number"
                      ? val % 1 === 0
                        ? val.toLocaleString()
                        : val.toFixed(2)
                      : typeof val === "object"
                        ? JSON.stringify(val)
                        : String(val)}
                  </span>
                </div>
              ))}
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
                      {result.table!.columns.map((col) => (
                        <td key={col}>
                          {typeof row[col] === "number"
                            ? (row[col] as number) % 1 === 0
                              ? (row[col] as number).toLocaleString()
                              : (row[col] as number).toFixed(2)
                            : String(row[col] ?? "")}
                        </td>
                      ))}
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
