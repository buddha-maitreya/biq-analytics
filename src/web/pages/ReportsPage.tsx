import React, { useState } from "react";
import { useAPI } from "@agentuity/react";
import type { AppConfig } from "../types";

interface ReportsPageProps {
  config: AppConfig;
}

type ReportType = "sales-summary" | "inventory-health" | "customer-activity" | "financial-overview";
type ExportFormat = "markdown" | "csv" | "json";

const REPORT_TYPES = [
  { value: "sales-summary" as const, label: "Sales Summary", icon: "📊", desc: "Revenue, orders, top products, and sales trends" },
  { value: "inventory-health" as const, label: "Inventory Health", icon: "📦", desc: "Stock levels, low stock alerts, category breakdown" },
  { value: "customer-activity" as const, label: "Customer Activity", icon: "👥", desc: "Customer orders, revenue, and engagement" },
  { value: "financial-overview" as const, label: "Financial Overview", icon: "💰", desc: "Invoices, payments, receivables, and aging" },
];

const PERIODS = [
  { value: "7", label: "Last 7 days" },
  { value: "14", label: "Last 14 days" },
  { value: "30", label: "Last 30 days" },
  { value: "60", label: "Last 60 days" },
  { value: "90", label: "Last 90 days" },
  { value: "365", label: "Last 12 months" },
  { value: "custom", label: "Custom range" },
];

export default function ReportsPage({ config }: ReportsPageProps) {
  const [reportType, setReportType] = useState<ReportType>("sales-summary");
  const [period, setPeriod] = useState("30");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [exportFormat, setExportFormat] = useState<ExportFormat>("markdown");
  const [reportContent, setReportContent] = useState<string | null>(null);
  const [reportTitle, setReportTitle] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  const generateReport = async () => {
    setLoading(true);
    setError(null);
    setReportContent(null);

    try {
      const body: any = { type: reportType, periodDays: Number(period) };
      if (period === "custom") {
        body.periodDays = undefined;
        body.startDate = customStart;
        body.endDate = customEnd;
      }

      const res = await fetch("/api/reports/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate report");

      const content = data.data?.content ?? data.data?.report ?? "No report data returned.";
      const title = data.data?.title ?? REPORT_TYPES.find(r => r.value === reportType)?.label ?? "Report";
      setReportContent(content);
      setReportTitle(title);
      setGeneratedAt(new Date().toLocaleString());
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

  const handleDownload = (format: string) => {
    if (!reportContent) return;
    const ts = new Date().toISOString().slice(0, 10);
    const baseName = `${reportType}-${ts}`;

    switch (format) {
      case "markdown":
        downloadFile(reportContent, `${baseName}.md`, "text/markdown");
        break;
      case "txt":
        downloadFile(reportContent, `${baseName}.txt`, "text/plain");
        break;
      case "csv": {
        // Convert markdown tables to CSV-ish format
        const lines = reportContent.split("\n");
        const csvLines: string[] = [];
        for (const line of lines) {
          if (line.startsWith("|") && !line.match(/^\|[\s-|]+$/)) {
            const cells = line.split("|").filter(Boolean).map(c => c.trim());
            csvLines.push(cells.join(","));
          } else if (line.trim() && !line.startsWith("#") && !line.startsWith("-") && !line.startsWith("*")) {
            csvLines.push(line.trim());
          }
        }
        downloadFile(csvLines.join("\n"), `${baseName}.csv`, "text/csv");
        break;
      }
      case "json": {
        const jsonData = {
          reportType,
          title: reportTitle,
          generatedAt,
          period: period === "custom" ? `${customStart} to ${customEnd}` : `Last ${period} days`,
          content: reportContent,
        };
        downloadFile(JSON.stringify(jsonData, null, 2), `${baseName}.json`, "application/json");
        break;
      }
      case "html": {
        // Simple Markdown-to-HTML conversion
        let html = reportContent
          .replace(/^### (.*$)/gm, "<h3>$1</h3>")
          .replace(/^## (.*$)/gm, "<h2>$1</h2>")
          .replace(/^# (.*$)/gm, "<h1>$1</h1>")
          .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
          .replace(/\*(.*?)\*/g, "<em>$1</em>")
          .replace(/\n/g, "<br>");
        html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${reportTitle}</title><style>body{font-family:sans-serif;max-width:800px;margin:40px auto;padding:0 20px;color:#333}h1,h2,h3{color:#1a202c}table{border-collapse:collapse;width:100%}th,td{border:1px solid #e2e8f0;padding:8px;text-align:left}th{background:#f7fafc}</style></head><body>${html}</body></html>`;
        downloadFile(html, `${baseName}.html`, "text/html");
        break;
      }
    }
  };

  const selectedReport = REPORT_TYPES.find(r => r.value === reportType);

  return (
    <div className="page reports-page">
      <div className="page-header-row">
        <div>
          <h2>📈 Reports</h2>
          <span className="text-muted">
            Generate and download AI-powered business reports
          </span>
        </div>
      </div>

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

      {/* Configuration */}
      <div className="card report-config-card">
        <div className="report-config-grid">
          <div className="report-config-section">
            <label className="form-label">Time Period</label>
            <select value={period} onChange={(e) => setPeriod(e.target.value)} className="form-select">
              {PERIODS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
            {period === "custom" && (
              <div className="custom-date-range">
                <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="date-input" />
                <span className="text-muted">to</span>
                <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="date-input" />
              </div>
            )}
          </div>

          <div className="report-config-section">
            <label className="form-label">Selected Report</label>
            <div className="selected-report-preview">
              <span className="report-icon-lg">{selectedReport?.icon}</span>
              <div>
                <strong>{selectedReport?.label}</strong>
                <p className="text-muted" style={{ fontSize: "0.8rem", margin: 0 }}>{selectedReport?.desc}</p>
              </div>
            </div>
          </div>

          <div className="report-config-section">
            <button
              className="btn btn-primary btn-lg"
              onClick={generateReport}
              disabled={loading || (period === "custom" && (!customStart || !customEnd))}
              style={{ width: "100%" }}
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
              <span className="text-muted" style={{ fontSize: "0.8rem" }}>Generated {generatedAt}</span>
            </div>
            <div className="report-download-btns">
              <button className="btn btn-sm btn-secondary" onClick={() => handleDownload("markdown")} title="Download as Markdown">
                📝 .MD
              </button>
              <button className="btn btn-sm btn-secondary" onClick={() => handleDownload("txt")} title="Download as Plain Text">
                📄 .TXT
              </button>
              <button className="btn btn-sm btn-secondary" onClick={() => handleDownload("csv")} title="Download as CSV (Excel-compatible)">
                📊 .CSV
              </button>
              <button className="btn btn-sm btn-secondary" onClick={() => handleDownload("json")} title="Download as JSON">
                🗂 .JSON
              </button>
              <button className="btn btn-sm btn-secondary" onClick={() => handleDownload("html")} title="Download as HTML (printable)">
                🌐 .HTML
              </button>
              <button className="btn btn-sm btn-secondary" onClick={() => navigator.clipboard.writeText(reportContent)} title="Copy to clipboard">
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
