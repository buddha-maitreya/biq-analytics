import React, { useState, useEffect } from "react";
import { useAPI } from "@agentuity/react";
import type { AppConfig } from "../types";

interface ReportsPageProps {
  config: AppConfig;
}

interface SavedReport {
  id: string;
  title: string;
  reportType: string;
  periodStart: string;
  periodEnd: string;
  format: string;
  createdAt: string;
  isScheduled: boolean;
}

type ReportType = "sales-summary" | "inventory-health" | "customer-activity" | "financial-overview";
type ExportFormat = "xlsx" | "csv" | "pdf";

const REPORT_TYPES = [
  { value: "sales-summary" as const, label: "Sales Summary", icon: "📊", desc: "Revenue, orders, top products, and sales trends" },
  { value: "inventory-health" as const, label: "Inventory Health", icon: "📦", desc: "Stock levels, low stock alerts, category breakdown" },
  { value: "customer-activity" as const, label: "Customer Activity", icon: "👥", desc: "Customer orders, revenue, and engagement" },
  { value: "financial-overview" as const, label: "Financial Overview", icon: "💰", desc: "Invoices, payments, receivables, and aging" },
];

const FORMAT_OPTIONS: { value: ExportFormat; label: string; icon: string; desc: string }[] = [
  { value: "xlsx", label: "Excel (.xlsx)", icon: "📗", desc: "Spreadsheet with formatted tables" },
  { value: "csv", label: "CSV (.csv)", icon: "📄", desc: "Comma-separated for any tool" },
  { value: "pdf", label: "PDF (.pdf)", icon: "📕", desc: "Print-ready formatted report" },
];

function getPresetRange(preset: string): { start: string; end: string } {
  const now = new Date();
  const end = now.toISOString().slice(0, 10);
  const ms = (days: number) => new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10);

  switch (preset) {
    case "today": return { start: end, end };
    case "yesterday": { const y = ms(1); return { start: y, end: y }; }
    case "last7": return { start: ms(7), end };
    case "last14": return { start: ms(14), end };
    case "last30": return { start: ms(30), end };
    case "last60": return { start: ms(60), end };
    case "last90": return { start: ms(90), end };
    case "mtd": return { start: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`, end };
    case "qtd": {
      const q = Math.floor(now.getMonth() / 3) * 3;
      return { start: `${now.getFullYear()}-${String(q + 1).padStart(2, "0")}-01`, end };
    }
    case "ytd": return { start: `${now.getFullYear()}-01-01`, end };
    case "last12m": return { start: ms(365), end };
    default: return { start: ms(30), end };
  }
}

const DATE_PRESETS = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last7", label: "Last 7 days" },
  { value: "last14", label: "Last 14 days" },
  { value: "last30", label: "Last 30 days" },
  { value: "last60", label: "Last 60 days" },
  { value: "last90", label: "Last 90 days" },
  { value: "mtd", label: "Month to date" },
  { value: "qtd", label: "Quarter to date" },
  { value: "ytd", label: "Year to date" },
  { value: "last12m", label: "Last 12 months" },
  { value: "custom", label: "Custom range" },
];

export default function ReportsPage({ config }: ReportsPageProps) {
  const [reportType, setReportType] = useState<ReportType>("sales-summary");
  const [datePreset, setDatePreset] = useState("last30");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [exportFormat, setExportFormat] = useState<ExportFormat>("xlsx");
  const [reportContent, setReportContent] = useState<string | null>(null);
  const [reportTitle, setReportTitle] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [savedReports, setSavedReports] = useState<SavedReport[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Load report history
  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch("/api/reports/history?limit=25");
      if (res.ok) {
        const { data } = await res.json();
        setSavedReports(data ?? []);
      }
    } catch {
      // silent
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => { loadHistory(); }, []);

  // Load a saved report from history
  const loadSavedReport = async (id: string) => {
    try {
      const res = await fetch(`/api/reports/${id}`);
      if (!res.ok) return;
      const { data } = await res.json();
      setReportContent(data.content);
      setReportTitle(data.title);
      setGeneratedAt(new Date(data.createdAt).toLocaleString());
      setHistoryOpen(false);
    } catch {
      // silent
    }
  };

  // Delete a saved report
  const deleteSavedReport = async (id: string) => {
    try {
      await fetch(`/api/reports/${id}`, { method: "DELETE" });
      setSavedReports((prev) => prev.filter((r) => r.id !== id));
    } catch {
      // silent
    }
  };

  const effectiveRange = datePreset === "custom"
    ? { start: customStart, end: customEnd }
    : getPresetRange(datePreset);

  const generateReport = async () => {
    setLoading(true);
    setError(null);
    setReportContent(null);

    try {
      const body: any = {
        type: reportType,
        startDate: effectiveRange.start,
        endDate: effectiveRange.end,
        format: exportFormat,
      };

      // For backward compat with existing API that uses periodDays
      if (datePreset !== "custom") {
        const presetMap: Record<string, number> = {
          today: 0, yesterday: 1, last7: 7, last14: 14, last30: 30,
          last60: 60, last90: 90, mtd: 30, qtd: 90, ytd: 365, last12m: 365,
        };
        body.periodDays = presetMap[datePreset] ?? 30;
      }

      const res = await fetch("/api/reports/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`Server returned invalid response (HTTP ${res.status}). Please try again.`);
      }
      if (!res.ok) throw new Error(data.error || "Failed to generate report");

      const content = data.data?.content ?? data.data?.report ?? "No report data returned.";
      const title = data.data?.title ?? REPORT_TYPES.find(r => r.value === reportType)?.label ?? "Report";
      setReportContent(content);
      setReportTitle(title);
      setGeneratedAt(new Date().toLocaleString());
      // Refresh history since the agent persists reports
      loadHistory();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const downloadFile = (content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownload = () => {
    if (!reportContent) return;
    const ts = new Date().toISOString().slice(0, 10);
    const baseName = `${reportType}-${ts}`;

    switch (exportFormat) {
      case "csv": {
        // Extract tables from markdown content into CSV
        const lines = reportContent.split("\n");
        const csvLines: string[] = [];
        for (const line of lines) {
          if (line.startsWith("|") && !line.match(/^\|[\s-|]+$/)) {
            const cells = line.split("|").filter(Boolean).map(c => {
              const trimmed = c.trim();
              // Escape commas and quotes in CSV
              return trimmed.includes(",") || trimmed.includes('"')
                ? `"${trimmed.replace(/"/g, '""')}"` : trimmed;
            });
            csvLines.push(cells.join(","));
          } else if (line.trim() && !line.startsWith("#") && !line.startsWith("-") && !line.startsWith("*")) {
            csvLines.push(line.trim());
          }
        }
        downloadFile(csvLines.join("\n"), `${baseName}.csv`, "text/csv;charset=utf-8;");
        break;
      }
      case "xlsx": {
        // Generate a simple XML spreadsheet (opens in Excel)
        const lines = reportContent.split("\n");
        const rows: string[][] = [];
        // Title row
        rows.push([reportTitle, `Generated: ${generatedAt}`, `Period: ${effectiveRange.start} to ${effectiveRange.end}`]);
        rows.push([]);

        for (const line of lines) {
          if (line.startsWith("|") && !line.match(/^\|[\s-|]+$/)) {
            const cells = line.split("|").filter(Boolean).map(c => c.trim());
            rows.push(cells);
          } else if (line.startsWith("# ") || line.startsWith("## ") || line.startsWith("### ")) {
            rows.push([]);
            rows.push([line.replace(/^#+\s*/, "")]);
          } else if (line.trim() && !line.startsWith("-") && !line.startsWith("*")) {
            rows.push([line.trim()]);
          }
        }

        const escXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const xmlRows = rows.map(row => {
          const cells = row.map(cell => {
            const isNum = /^\d[\d,.]*$/.test(cell.replace(/[,$%]/g, ""));
            return isNum
              ? `<Cell><Data ss:Type="Number">${cell.replace(/[,$%]/g, "")}</Data></Cell>`
              : `<Cell><Data ss:Type="String">${escXml(cell)}</Data></Cell>`;
          }).join("");
          return `<Row>${cells}</Row>`;
        }).join("\n");

        const xml = `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles>
  <Style ss:ID="Header"><Font ss:Bold="1" ss:Size="11"/></Style>
  <Style ss:ID="Title"><Font ss:Bold="1" ss:Size="14"/></Style>
</Styles>
<Worksheet ss:Name="${escXml(reportTitle.slice(0, 31))}">
<Table>
${xmlRows}
</Table>
</Worksheet>
</Workbook>`;

        downloadFile(xml, `${baseName}.xlsx`, "application/vnd.ms-excel");
        break;
      }
      case "pdf": {
        // Generate a printable HTML and trigger print dialog
        let html = reportContent
          .replace(/^### (.*$)/gm, "<h3>$1</h3>")
          .replace(/^## (.*$)/gm, "<h2>$1</h2>")
          .replace(/^# (.*$)/gm, "<h1>$1</h1>")
          .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
          .replace(/\*(.*?)\*/g, "<em>$1</em>");

        // Convert markdown tables to HTML tables
        const tableRegex = /(\|.+\|[\r\n]+\|[-|\s:]+\|[\r\n]+((\|.+\|[\r\n]*)+))/g;
        html = html.replace(tableRegex, (match) => {
          const rows = match.trim().split("\n").filter(r => !r.match(/^\|[\s-|:]+$/));
          let table = "<table><thead>";
          rows.forEach((row, idx) => {
            const cells = row.split("|").filter(Boolean).map(c => c.trim());
            const tag = idx === 0 ? "th" : "td";
            const rowHtml = cells.map(c => `<${tag}>${c}</${tag}>`).join("");
            if (idx === 0) {
              table += `<tr>${rowHtml}</tr></thead><tbody>`;
            } else {
              table += `<tr>${rowHtml}</tr>`;
            }
          });
          table += "</tbody></table>";
          return table;
        });

        html = html.replace(/\n/g, "<br>");

        const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>${reportTitle}</title>
<style>
  @media print { @page { margin: 1cm; } }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; color: #1a202c; font-size: 12px; }
  h1 { font-size: 20px; border-bottom: 2px solid #3b82f6; padding-bottom: 8px; }
  h2 { font-size: 16px; margin-top: 24px; color: #2563eb; }
  h3 { font-size: 14px; margin-top: 16px; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; }
  th, td { border: 1px solid #e2e8f0; padding: 6px 10px; text-align: left; font-size: 11px; }
  th { background: #f1f5f9; font-weight: 600; }
  tr:nth-child(even) { background: #fafbfc; }
  .header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 16px; }
  .meta { color: #64748b; font-size: 11px; }
</style></head><body>
<div class="header">
  <h1>${reportTitle}</h1>
  <div class="meta">
    <div>${config.companyName}</div>
    <div>${effectiveRange.start} — ${effectiveRange.end}</div>
    <div>Generated: ${generatedAt}</div>
  </div>
</div>
${html}
</body></html>`;

        // Open in new window and trigger print (which allows Save as PDF)
        const printWindow = window.open("", "_blank");
        if (printWindow) {
          printWindow.document.write(fullHtml);
          printWindow.document.close();
          setTimeout(() => printWindow.print(), 300);
        } else {
          // Fallback: download as HTML
          downloadFile(fullHtml, `${baseName}.html`, "text/html");
        }
        break;
      }
    }
  };

  const selectedReport = REPORT_TYPES.find(r => r.value === reportType);
  const canGenerate = datePreset !== "custom" || (customStart && customEnd);

  return (
    <div className="page reports-page">
      <div className="page-header-row">
        <div>
          <h2>📈 Reports</h2>
          <span className="text-muted">
            Generate and download business reports
          </span>
        </div>
        <button
          className="btn btn-secondary"
          onClick={() => setHistoryOpen(!historyOpen)}
        >
          📋 History ({savedReports.length})
        </button>
      </div>

      {/* Report History Panel */}
      {historyOpen && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>📋 Report History</h3>
            <button className="btn btn-sm" onClick={() => setHistoryOpen(false)}>✕ Close</button>
          </div>
          {historyLoading ? (
            <p className="text-muted">Loading...</p>
          ) : savedReports.length === 0 ? (
            <p className="text-muted">No saved reports yet. Generate your first report below.</p>
          ) : (
            <div className="report-history-list">
              {savedReports.map((r) => {
                const typeInfo = REPORT_TYPES.find((rt) => rt.value === r.reportType);
                return (
                  <div key={r.id} className="report-history-item" onClick={() => loadSavedReport(r.id)}>
                    <div className="report-history-item-info">
                      <span className="report-history-item-title">
                        {typeInfo?.icon ?? "📄"} {r.title}
                      </span>
                      <span className="report-history-item-meta">
                        {new Date(r.createdAt).toLocaleDateString()} ·{" "}
                        {r.periodStart?.slice(0, 10)} → {r.periodEnd?.slice(0, 10)}
                        {r.isScheduled && " · ⏰ Scheduled"}
                      </span>
                    </div>
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={(e) => { e.stopPropagation(); deleteSavedReport(r.id); }}
                      title="Delete"
                    >
                      🗑
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Report Type Selection */}
      <div className="report-type-grid">
        {REPORT_TYPES.map((rt) => (
          <button
            key={rt.value}
            className={`report-type-card ${reportType === rt.value ? "active" : ""}`}
            onClick={() => setReportType(rt.value)}
          >
            <span className="report-icon">{rt.icon}</span>
            <span className="report-type-label">{rt.label}</span>
            <span className="report-type-desc">{rt.desc}</span>
          </button>
        ))}
      </div>

      {/* Configuration Panel */}
      <div className="card report-config-card">
        <div className="report-config-grid-v2">
          {/* Date Range */}
          <div className="report-config-section">
            <label className="form-label">Date Range</label>
            <select value={datePreset} onChange={(e) => setDatePreset(e.target.value)} className="form-select">
              {DATE_PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
            {datePreset === "custom" ? (
              <div className="custom-date-range">
                <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="date-input" />
                <span className="text-muted">to</span>
                <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="date-input" />
              </div>
            ) : (
              <div className="date-range-preview">
                <span className="text-muted" style={{ fontSize: "0.75rem" }}>
                  {effectiveRange.start} → {effectiveRange.end}
                </span>
              </div>
            )}
          </div>

          {/* Export Format */}
          <div className="report-config-section">
            <label className="form-label">Export Format</label>
            <div className="format-selector">
              {FORMAT_OPTIONS.map(f => (
                <button
                  key={f.value}
                  className={`format-option ${exportFormat === f.value ? "active" : ""}`}
                  onClick={() => setExportFormat(f.value)}
                >
                  <span className="format-icon">{f.icon}</span>
                  <span className="format-label">{f.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Selected Report + Generate */}
          <div className="report-config-section">
            <label className="form-label">Selected Report</label>
            <div className="selected-report-preview">
              <span className="report-icon-lg">{selectedReport?.icon}</span>
              <div>
                <strong>{selectedReport?.label}</strong>
                <p className="text-muted" style={{ fontSize: "0.75rem", margin: 0 }}>{selectedReport?.desc}</p>
              </div>
            </div>
            <button
              className="btn btn-primary"
              onClick={generateReport}
              disabled={loading || !canGenerate}
              style={{ width: "100%", marginTop: 8 }}
            >
              {loading ? (
                <><span className="spinner-inline" /> Generating...</>
              ) : (
                "🚀 Generate Report"
              )}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="card" style={{ borderLeft: "3px solid #ef4444", padding: 16 }}>
          <p style={{ color: "#ef4444", margin: 0 }}>❌ {error}</p>
        </div>
      )}

      {/* Report Output */}
      {reportContent && (
        <div className="card report-output-card">
          <div className="report-output-header">
            <div>
              <h3>{selectedReport?.icon} {reportTitle}</h3>
              <span className="text-muted" style={{ fontSize: "0.75rem" }}>
                Generated {generatedAt} · {effectiveRange.start} — {effectiveRange.end}
              </span>
            </div>
            <div className="report-download-btns">
              <button className="btn btn-sm btn-primary" onClick={handleDownload} title={`Download as ${exportFormat.toUpperCase()}`}>
                {FORMAT_OPTIONS.find(f => f.value === exportFormat)?.icon} Download .{exportFormat.toUpperCase()}
              </button>
              <button className="btn btn-sm btn-secondary" onClick={() => navigator.clipboard.writeText(reportContent)} title="Copy raw content">
                📋 Copy
              </button>
            </div>
          </div>
          <div className="report-content-area">
            <pre className="report-text">{reportContent}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
