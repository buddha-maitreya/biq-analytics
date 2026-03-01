/**
 * ToolCallCard — Renders a tool call with name, input, output, and status.
 *
 * Each tool type renders differently:
 *   - query_database: SQL block → results table
 *   - analyze_trends: insight cards with severity badges
 *   - generate_report: expandable markdown report
 *   - search_knowledge: answer with source citations
 *   - get_business_snapshot: overview cards
 */

import React, { useState } from "react";
import type { ToolCall } from "../../hooks/useChatStream";

interface ToolCallCardProps {
  toolCall: ToolCall;
}

const TOOL_LABELS: Record<string, { label: string; icon: string }> = {
  query_database: { label: "Database Query", icon: "🗄️" },
  analyze_trends: { label: "Insights Analysis", icon: "📊" },
  run_predictive_analytics: { label: "Predictive Analytics", icon: "🔬" },
  generate_report: { label: "Report Generation", icon: "📋" },
  search_knowledge: { label: "Knowledge Search", icon: "📚" },
  get_business_snapshot: { label: "Business Overview", icon: "📈" },
};

const ToolCallCard = React.memo(function ToolCallCard({ toolCall }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);
  const meta = TOOL_LABELS[toolCall.name] || {
    label: toolCall.name,
    icon: "🔧",
  };

  const statusClass =
    toolCall.status === "running"
      ? "tool-status-running"
      : toolCall.status === "completed"
      ? "tool-status-completed"
      : toolCall.status === "error"
      ? "tool-status-error"
      : "tool-status-pending";

  return (
    <div className={`tool-call-card ${statusClass}`}>
      <button
        className="tool-call-header"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="tool-call-icon">{meta.icon}</span>
        <span className="tool-call-label">{meta.label}</span>
        <span className={`tool-call-status-badge ${statusClass}`}>
          {toolCall.status === "running" ? (
            <span className="tool-spinner" />
          ) : toolCall.status === "completed" ? (
            "✓"
          ) : toolCall.status === "error" ? (
            "✗"
          ) : (
            "…"
          )}
        </span>
        <span className={`tool-call-chevron ${expanded ? "expanded" : ""}`}>
          ▸
        </span>
      </button>

      {expanded && (
        <div className="tool-call-body">
          {/* Input section */}
          <div className="tool-call-section">
            <div className="tool-call-section-label">Input</div>
            {renderInput(toolCall)}
          </div>

          {/* Output section */}
          {toolCall.output !== undefined && (
            <div className="tool-call-section">
              <div className="tool-call-section-label">Result</div>
              {renderOutput(toolCall)}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export default ToolCallCard;

function renderInput(toolCall: ToolCall) {
  const input = toolCall.input;

  switch (toolCall.name) {
    case "query_database":
      return (
        <div className="tool-sql-block">
          <div className="tool-sql-explanation">
            {(input as any).explanation}
          </div>
          <pre className="tool-sql-code">
            <code>{(input as any).query}</code>
          </pre>
        </div>
      );

    case "analyze_trends":
      return (
        <div className="tool-input-pills">
          <span className="tool-pill">{(input as any).analysis}</span>
          <span className="tool-pill">
            {(input as any).timeframeDays} days
          </span>
        </div>
      );

    case "run_predictive_analytics":
      return (
        <div className="tool-input-pills">
          <span className="tool-pill">{(input as any).action}</span>
          {(input as any).periodDays && (
            <span className="tool-pill">{(input as any).periodDays} days</span>
          )}
        </div>
      );

    case "generate_report":
      return (
        <div className="tool-input-pills">
          <span className="tool-pill">{(input as any).reportType}</span>
          {(input as any).startDate && (
            <span className="tool-pill">{(input as any).startDate}</span>
          )}
        </div>
      );

    case "search_knowledge":
      return (
        <div className="tool-input-quote">"{(input as any).question}"</div>
      );

    default:
      return (
        <pre className="tool-json-block">
          {JSON.stringify(input, null, 2)}
        </pre>
      );
  }
}

function renderOutput(toolCall: ToolCall) {
  const output = toolCall.output as any;
  if (!output) return null;

  if (output.error) {
    return <div className="tool-error-message">{output.error}</div>;
  }

  switch (toolCall.name) {
    case "query_database":
      return <QueryResultTable output={output} />;

    case "analyze_trends":
      return <InsightsResult output={output} />;

    case "generate_report":
      return <ReportResult output={output} />;

    case "search_knowledge":
      return <KnowledgeResult output={output} />;

    case "run_predictive_analytics":
      return <PredictiveAnalyticsResult output={output} />;

    case "get_business_snapshot":
      return <SnapshotResult output={output} />;

    default:
      return (
        <pre className="tool-json-block">
          {JSON.stringify(output, null, 2)}
        </pre>
      );
  }
}

// ── Sub-renderers ──────────────────────────────────────────

function QueryResultTable({ output }: { output: any }) {
  const rows = output.rows || [];
  if (rows.length === 0) {
    return <div className="tool-empty-result">No results returned</div>;
  }

  const columns = Object.keys(rows[0]);
  const displayRows = rows.slice(0, 20); // Show max 20 rows

  return (
    <div className="tool-table-wrapper">
      <div className="tool-row-count">
        {output.rowCount} row{output.rowCount !== 1 ? "s" : ""}
        {output.truncated ? " (showing first 100)" : ""}
      </div>
      <table className="tool-result-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col}>{col}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {displayRows.map((row: any, i: number) => (
            <tr key={i}>
              {columns.map((col) => (
                <td key={col}>{formatValue(row[col])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 20 && (
        <div className="tool-truncation-notice">
          Showing 20 of {rows.length} rows
        </div>
      )}
    </div>
  );
}

function InsightsResult({ output }: { output: any }) {
  const insights = output.insights || [];
  const charts = output.charts || [];
  return (
    <div className="tool-insights">
      {output.summary && (
        <div className="tool-insights-summary">{output.summary}</div>
      )}
      {charts.length > 0 && (
        <div className="tool-insights-charts">
          {charts.map((chart: any, i: number) => (
            <div key={i} className="tool-chart-container">
              <div className="tool-chart-title">{chart.title}</div>
              <img
                src={`data:image/png;base64,${chart.data}`}
                alt={chart.title}
                className="tool-chart-image"
                style={{
                  maxWidth: "100%",
                  width: Math.min(chart.width || 800, 800),
                  height: "auto",
                }}
              />
            </div>
          ))}
        </div>
      )}
      {insights.map((insight: any, i: number) => (
        <div key={i} className={`tool-insight-card severity-${insight.severity}`}>
          <div className="tool-insight-header">
            <span className={`severity-badge ${insight.severity}`}>
              {insight.severity}
            </span>
            <span className="tool-insight-title">{insight.title}</span>
            <span className="tool-insight-confidence">
              {Math.round(insight.confidence * 100)}%
            </span>
          </div>
          <p className="tool-insight-desc">{insight.description}</p>
          <p className="tool-insight-rec">💡 {insight.recommendation}</p>
        </div>
      ))}
    </div>
  );
}

function ReportResult({ output }: { output: any }) {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const handleExport = async (format: "pdf" | "xlsx" | "docx" | "pptx" = "pdf") => {
    if (exporting || !output?.content) return;
    setExporting(true);
    setExportError(null);
    try {
      const res = await fetch("/api/reports/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: output.content,
          title: output.title || "Business Report",
          format,
          subtitle: output.reportType || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Export failed");
      if (json.data?.downloadUrl) {
        if (json.data.downloadUrl.startsWith("data:")) {
          // Data URL fallback (S3 unavailable) — download via blob
          const fetchRes = await fetch(json.data.downloadUrl);
          const blob = await fetchRes.blob();
          const blobUrl = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = blobUrl;
          a.download = json.data.filename || `report.${format}`;
          document.body.appendChild(a);
          a.click();
          URL.revokeObjectURL(blobUrl);
          document.body.removeChild(a);
        } else {
          window.open(json.data.downloadUrl, "_blank");
        }
      }
    } catch (err: any) {
      setExportError(err?.message || "Export failed");
    }
    setExporting(false);
  };

  return (
    <div className="tool-report">
      <div className="tool-report-title">{output.title}</div>
      <div className="tool-report-period">
        {output.period?.start?.split("T")[0]} →{" "}
        {output.period?.end?.split("T")[0]}
      </div>
      <div className="tool-report-content">
        {renderSimpleMarkdown(output.content || "")}
      </div>
      {output.content && (
        <div className="tool-report-actions">
          <button
            className="btn btn-primary btn-sm tool-report-download-btn"
            onClick={() => handleExport("pdf")}
            disabled={exporting}
          >
            {exporting ? "⏳ Generating..." : "📥 Download PDF"}
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => handleExport("xlsx")}
            disabled={exporting}
            title="Download as Excel"
          >
            📊 Excel
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => handleExport("docx")}
            disabled={exporting}
            title="Download as Word"
          >
            📄 Word
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => handleExport("pptx")}
            disabled={exporting}
            title="Download as PowerPoint"
          >
            📙 PPTX
          </button>
          {exportError && <span className="tool-export-error">{exportError}</span>}
        </div>
      )}
    </div>
  );
}

function KnowledgeResult({ output }: { output: any }) {
  return (
    <div className="tool-knowledge">
      <div className="tool-knowledge-answer">{output.answer}</div>
      {output.sources?.length > 0 && (
        <div className="tool-knowledge-sources">
          <span className="tool-sources-label">Sources:</span>
          {output.sources.map((s: string, i: number) => (
            <span key={i} className="tool-source-chip">
              📄 {s}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function PredictiveAnalyticsResult({ output }: { output: any }) {
  const summary = output.summary || {};
  const charts = output.charts || [];
  const table = output.table;
  const summaryEntries = Object.entries(summary).filter(
    ([, v]) => typeof v !== "object" || v === null
  );

  return (
    <div className="tool-predictive-analytics">
      {/* Action & meta */}
      <div className="tool-pa-meta">
        {output.action && <span className="tool-pill">{output.action}</span>}
        {output.dataRowCount != null && (
          <span className="tool-pa-stat">{output.dataRowCount.toLocaleString()} rows</span>
        )}
        {output.durationMs != null && (
          <span className="tool-pa-stat">{(output.durationMs / 1000).toFixed(1)}s</span>
        )}
        {output.dateRange && (
          <span className="tool-pa-stat">
            {output.dateRange.start} → {output.dateRange.end}
          </span>
        )}
      </div>

      {/* Summary metric cards */}
      {summaryEntries.length > 0 && (
        <div className="tool-pa-summary-grid">
          {summaryEntries.slice(0, 12).map(([key, val]) => (
            <div key={key} className="tool-pa-summary-card">
              <span className="tool-pa-summary-label">
                {key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
              </span>
              <span className="tool-pa-summary-value">
                {typeof val === "number"
                  ? val % 1 === 0 ? val.toLocaleString() : val.toFixed(2)
                  : String(val ?? "—")}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Charts (base64 images) */}
      {charts.length > 0 && (
        <div className="tool-insights-charts">
          {charts.map((chart: any, i: number) => (
            <div key={i} className="tool-chart-container">
              <div className="tool-chart-title">{chart.title}</div>
              <img
                src={`data:image/${chart.format || "png"};base64,${chart.data}`}
                alt={chart.title}
                className="tool-chart-image"
                style={{
                  maxWidth: "100%",
                  width: Math.min(chart.width || 800, 800),
                  height: "auto",
                }}
              />
            </div>
          ))}
        </div>
      )}

      {/* Data table */}
      {table && table.columns?.length > 0 && (
        <div className="tool-table-wrapper">
          <div className="tool-row-count">
            {table.rows?.length ?? 0} row{(table.rows?.length ?? 0) !== 1 ? "s" : ""}
          </div>
          <table className="tool-result-table">
            <thead>
              <tr>
                {table.columns.map((col: string) => (
                  <th key={col}>{col.replace(/_/g, " ")}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(table.rows || []).slice(0, 20).map((row: any, i: number) => (
                <tr key={i}>
                  {table.columns.map((col: string) => (
                    <td key={col}>{formatValue(row[col])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {(table.rows?.length ?? 0) > 20 && (
            <div className="tool-truncation-notice">
              Showing 20 of {table.rows.length} rows
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SnapshotResult({ output }: { output: any }) {
  return (
    <div className="tool-snapshot">
      <div className="tool-snapshot-grid">
        {output.totalProducts !== undefined && (
          <div className="tool-snapshot-stat">
            <div className="tool-snapshot-value">{output.totalProducts}</div>
            <div className="tool-snapshot-label">Products</div>
          </div>
        )}
        {output.totalOrders !== undefined && (
          <div className="tool-snapshot-stat">
            <div className="tool-snapshot-value">{output.totalOrders}</div>
            <div className="tool-snapshot-label">Orders</div>
          </div>
        )}
        {output.totalCustomers !== undefined && (
          <div className="tool-snapshot-stat">
            <div className="tool-snapshot-value">{output.totalCustomers}</div>
            <div className="tool-snapshot-label">Customers</div>
          </div>
        )}
        {output.totalRevenue !== undefined && (
          <div className="tool-snapshot-stat">
            <div className="tool-snapshot-value">
              {output.currency} {Number(output.totalRevenue).toLocaleString()}
            </div>
            <div className="tool-snapshot-label">Revenue</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────

function formatValue(val: unknown): string {
  if (val === null || val === undefined) return "—";
  if (typeof val === "number") return val.toLocaleString();
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}

/** Very simple markdown subset renderer (headers, bold, bullet lists) */
function renderSimpleMarkdown(text: string) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("### ")) {
      elements.push(<h4 key={i}>{line.slice(4)}</h4>);
    } else if (line.startsWith("## ")) {
      elements.push(<h3 key={i}>{line.slice(3)}</h3>);
    } else if (line.startsWith("# ")) {
      elements.push(<h2 key={i}>{line.slice(2)}</h2>);
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      elements.push(
        <li key={i}>{renderInline(line.slice(2))}</li>
      );
    } else if (line.trim() === "") {
      elements.push(<br key={i} />);
    } else {
      elements.push(<p key={i}>{renderInline(line)}</p>);
    }
  }

  return <>{elements}</>;
}

function renderInline(text: string): React.ReactNode {
  // Bold: **text**
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <strong key={i}>{part.slice(2, -2)}</strong>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}
