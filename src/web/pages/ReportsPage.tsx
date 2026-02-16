import React, { useState } from "react";
import { useAPI } from "@agentuity/react";
import type { AppConfig } from "../App";

interface ReportsPageProps {
  config: AppConfig;
}

type ReportType =
  | "sales-summary"
  | "inventory-health"
  | "customer-activity"
  | "financial-overview";

export default function ReportsPage({ config }: ReportsPageProps) {
  const [reportType, setReportType] = useState<ReportType>("sales-summary");
  const [period, setPeriod] = useState("30");
  const [reportContent, setReportContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reportTypes = [
    { value: "sales-summary", label: "Sales Summary", icon: "📊" },
    { value: "inventory-health", label: "Inventory Health", icon: "📦" },
    { value: "customer-activity", label: "Customer Activity", icon: "👥" },
    { value: "financial-overview", label: "Financial Overview", icon: "💰" },
  ];

  const generateReport = async () => {
    setLoading(true);
    setError(null);
    setReportContent(null);

    try {
      const res = await fetch("/api/reports/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: reportType, periodDays: Number(period) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate report");
      setReportContent(data.data?.report ?? "No report data returned.");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page reports-page">
      <div className="page-header">
        <h2>📈 Reports</h2>
        <span className="text-muted">
          AI-generated business reports and insights
        </span>
      </div>

      <div className="report-config card">
        <h3>Generate Report</h3>

        <div className="report-type-grid">
          {reportTypes.map((rt) => (
            <button
              key={rt.value}
              className={`report-type-card ${reportType === rt.value ? "active" : ""}`}
              onClick={() => setReportType(rt.value as ReportType)}
            >
              <span className="report-icon">{rt.icon}</span>
              <span>{rt.label}</span>
            </button>
          ))}
        </div>

        <div className="report-options">
          <label>
            Period:
            <select value={period} onChange={(e) => setPeriod(e.target.value)}>
              <option value="7">Last 7 days</option>
              <option value="14">Last 14 days</option>
              <option value="30">Last 30 days</option>
              <option value="60">Last 60 days</option>
              <option value="90">Last 90 days</option>
            </select>
          </label>

          <button
            className="btn btn-primary"
            onClick={generateReport}
            disabled={loading}
          >
            {loading ? "Generating..." : "Generate Report"}
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {reportContent && (
        <div className="card report-output">
          <div className="report-header">
            <h3>
              {reportTypes.find((r) => r.value === reportType)?.icon}{" "}
              {reportTypes.find((r) => r.value === reportType)?.label}
            </h3>
            <button
              className="btn btn-secondary"
              onClick={() => {
                navigator.clipboard.writeText(reportContent);
              }}
            >
              Copy
            </button>
          </div>
          <div className="report-content">
            <pre className="report-text">{reportContent}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
