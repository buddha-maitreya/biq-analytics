import React, { useState, useMemo, useRef } from "react";
import { useAPI } from "@agentuity/react";
import type { AppConfig } from "../types";

interface InvoicesPageProps {
  config: AppConfig;
}

type SortKey = "invoiceNumber" | "customer" | "status" | "totalAmount" | "paidAmount" | "balance" | "dueDate" | "kraVerified";
type SortDir = "asc" | "desc";

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  draft:     { label: "Draft",     color: "#94a3b8" },
  sent:      { label: "Sent",      color: "#3b82f6" },
  partial:   { label: "Partial",   color: "#f59e0b" },
  paid:      { label: "Paid",      color: "#22c55e" },
  overdue:   { label: "Overdue",   color: "#ef4444" },
  cancelled: { label: "Cancelled", color: "#6b7280" },
};

interface InvoiceDetails {
  salesDate: string | null;
  transmissionDate: string | null;
  invoiceDate: string | null;
  totalItemCount: number;
  supplierPIN: string | null;
  supplierName: string | null;
  deviceSerialNumber: string | null;
  customerPin: string | null;
  customerName: string | null;
  controlUnitInvoiceNumber: string | null;
  traderSystemInvoiceNumber: string | null;
  totalInvoiceAmount: number | null;
  totalTaxableAmount: number | null;
  totalTaxAmount: number | null;
  exemptionCertificateNo: string | null;
  totalDiscountAmount: number | null;
  itemDetails: unknown[];
}

interface CheckResult {
  responseCode: number;
  responseDesc: string;
  status: "OK" | "ERROR";
  invoiceDetails: InvoiceDetails | null;
}

interface HistoryEntry {
  invoiceNumber: string;
  invoiceDate: string;
  checkedAt: string;
  status: "OK" | "ERROR";
  supplierName: string | null;
  totalAmount: number | null;
}

export default function InvoicesPage({ config }: InvoicesPageProps) {
  const [activeTab, setActiveTab] = useState<"list" | "checker">("list");

  // ── Upload state ──
  const invoiceFileRef = useRef<HTMLInputElement>(null);
  const [uploadingInvoice, setUploadingInvoice] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const handleInvoiceUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingInvoice(true);
    setUploadMessage(null);
    try {
      // Step 1: Read file as base64
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.includes(",") ? result.split(",")[1] : result);
        };
        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.readAsDataURL(file);
      });

      const headers: Record<string, string> = { "Content-Type": "application/json" };

      // Step 2: Send to document scanner agent for OCR
      setUploadMessage({ type: "success", text: "Scanning invoice with AI..." });
      const scanRes = await fetch("/api/scan/invoice", {
        method: "POST",
        headers,
        body: JSON.stringify({ imageData: base64 }),
      });
      const scanJson = await scanRes.json();
      if (!scanRes.ok) throw new Error(scanJson.error || "Invoice scan failed");
      if (!scanJson.success || !scanJson.data) throw new Error("AI could not extract invoice data from this image");

      const ocrData = scanJson.data;

      // Step 3: Save the extracted invoice via from-scan endpoint
      setUploadMessage({ type: "success", text: "Saving extracted invoice..." });
      const saveRes = await fetch("/api/invoices/from-scan", {
        method: "POST",
        headers,
        body: JSON.stringify({
          invoiceNumber: ocrData.invoiceNumber || `SCAN-${Date.now()}`,
          supplierName: ocrData.supplierName,
          supplierTaxId: ocrData.supplierTaxId,
          invoiceDate: ocrData.invoiceDate,
          dueDate: ocrData.dueDate,
          subtotal: ocrData.subtotal,
          taxAmount: ocrData.taxAmount,
          totalAmount: ocrData.totalAmount,
          lineItems: ocrData.lineItems || [],
          confidence: ocrData.confidence,
          warnings: ocrData.warnings,
        }),
      });
      const saveJson = await saveRes.json();
      if (saveRes.status === 409) {
        setUploadMessage({ type: "error", text: `Duplicate invoice — #${ocrData.invoiceNumber} already exists` });
      } else if (!saveRes.ok) {
        throw new Error(saveJson.error || "Failed to save invoice");
      } else {
        setUploadMessage({ type: "success", text: `Invoice uploaded — #${saveJson.data?.invoiceNumber || ocrData.invoiceNumber}` });
        refetch();
      }
    } catch (err: any) {
      setUploadMessage({ type: "error", text: err.message || "Failed to upload invoice" });
    } finally {
      setUploadingInvoice(false);
      if (invoiceFileRef.current) invoiceFileRef.current.value = "";
      setTimeout(() => setUploadMessage(null), 8000);
    }
  };

  // ── Checker tab state ──
  const [ckInvoiceNumber, setCkInvoiceNumber] = useState("");
  const [ckDate, setCkDate] = useState("");
  const [ckLoading, setCkLoading] = useState(false);
  const [ckResult, setCkResult] = useState<CheckResult | null>(null);
  const [ckError, setCkError] = useState<string | null>(null);
  const [ckHistory, setCkHistory] = useState<HistoryEntry[]>([]);

  // ── List tab state ──
  const [page, setPage] = useState(1);
  const { data, isLoading, refetch } = useAPI<any>(`GET /api/invoices?page=${page}&limit=200`);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("invoiceNumber");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const invoices: any[] = data?.data ?? [];

  // Compute balance and classify debit/credit for each invoice
  const enriched = useMemo(() => {
    return invoices.map((inv: any) => {
      const total = Number(inv.totalAmount) || 0;
      const paid = Number(inv.paidAmount) || 0;
      const balance = total - paid;
      // "receivable" = customer owes us, "settled" = fully paid, "voided" = cancelled
      const direction =
        inv.status === "cancelled" ? "voided" :
        balance <= 0 ? "settled" : "receivable";
      return { ...inv, _total: total, _paid: paid, _balance: balance, _direction: direction };
    });
  }, [invoices]);

  // Summary stats
  const summary = useMemo(() => {
    const statusCounts: Record<string, { count: number; total: number }> = {};
    let grandTotal = 0;
    let totalPaid = 0;
    let totalOutstanding = 0;
    let overdueCount = 0;

    for (const inv of enriched) {
      const s = inv.status ?? "draft";
      if (!statusCounts[s]) statusCounts[s] = { count: 0, total: 0 };
      statusCounts[s].count++;
      statusCounts[s].total += inv._total;
      grandTotal += inv._total;
      totalPaid += inv._paid;
      if (inv._direction === "receivable") totalOutstanding += inv._balance;

      // Check if overdue (due date passed & not paid/cancelled)
      if (inv.dueDate && inv._direction === "receivable") {
        const due = new Date(inv.dueDate);
        if (due < new Date()) overdueCount++;
      }
    }

    return { statusCounts, grandTotal, totalPaid, totalOutstanding, overdueCount, count: enriched.length };
  }, [enriched]);

  // Filter + sort
  const filtered = useMemo(() => {
    let list = [...enriched];

    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (inv) =>
          inv.invoiceNumber?.toLowerCase().includes(q) ||
          inv.customer?.name?.toLowerCase().includes(q) ||
          inv.notes?.toLowerCase().includes(q)
      );
    }

    if (statusFilter !== "all") {
      list = list.filter((inv) => inv.status === statusFilter);
    }

    list.sort((a, b) => {
      let aVal: string | number = "";
      let bVal: string | number = "";
      switch (sortKey) {
        case "invoiceNumber": aVal = a.invoiceNumber ?? ""; bVal = b.invoiceNumber ?? ""; break;
        case "customer": aVal = a.customer?.name ?? ""; bVal = b.customer?.name ?? ""; break;
        case "status": aVal = a.status ?? ""; bVal = b.status ?? ""; break;
        case "totalAmount": aVal = a._total; bVal = b._total; break;
        case "paidAmount": aVal = a._paid; bVal = b._paid; break;
        case "balance": aVal = a._balance; bVal = b._balance; break;
        case "dueDate": aVal = a.dueDate ?? ""; bVal = b.dueDate ?? ""; break;
        case "kraVerified": aVal = a.kraVerified ? 1 : 0; bVal = b.kraVerified ? 1 : 0; break;
      }
      if (typeof aVal === "string") {
        const cmp = aVal.localeCompare(bVal as string);
        return sortDir === "asc" ? cmp : -cmp;
      }
      return sortDir === "asc" ? aVal - (bVal as number) : (bVal as number) - aVal;
    });

    return list;
  }, [enriched, search, statusFilter, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const sortIcon = (key: SortKey) => (sortKey !== key ? " ↕" : sortDir === "asc" ? " ↑" : " ↓");

  const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const handleAction = async (id: string, action: "send" | "void") => {
    await fetch(`/api/invoices/${id}/${action}`, { method: "POST" });
    refetch();
  };

  const directionBadge = (dir: string) => {
    switch (dir) {
      case "receivable":
        return <span className="direction-badge direction-receivable">⬆ Receivable</span>;
      case "settled":
        return <span className="direction-badge direction-settled">✓ Settled</span>;
      case "voided":
        return <span className="direction-badge direction-voided">✕ Voided</span>;
      default:
        return null;
    }
  };

  // ── Checker helpers ──
  const fmtAmount = (n: number | null) =>
    n != null ? `${config.currency} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";

  const fmtDate = (d: string | null) => {
    if (!d) return "—";
    try { return new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); } catch { return d; }
  };

  const fmtDateTime = (d: string | null) => {
    if (!d) return "—";
    try { return new Date(d).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); } catch { return d; }
  };

  const handleCheck = async () => {
    if (!ckInvoiceNumber.trim() || !ckDate) return;
    setCkLoading(true);
    setCkError(null);
    setCkResult(null);
    try {
      const res = await fetch("/api/kra/invoice/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceNumber: ckInvoiceNumber.trim(), invoiceDate: ckDate }),
      });
      const json = await res.json();
      const ckData: CheckResult = json.data ?? json;
      setCkResult(ckData);
      setCkHistory((prev) => [
        {
          invoiceNumber: ckInvoiceNumber.trim(),
          invoiceDate: ckDate,
          checkedAt: new Date().toISOString(),
          status: ckData.status,
          supplierName: ckData.invoiceDetails?.supplierName ?? null,
          totalAmount: ckData.invoiceDetails?.totalInvoiceAmount ?? null,
        },
        ...prev.slice(0, 19),
      ]);
    } catch {
      setCkError("Network error — could not reach the server.");
    } finally {
      setCkLoading(false);
    }
  };

  const fillFromHistory = (entry: HistoryEntry) => {
    setCkInvoiceNumber(entry.invoiceNumber);
    setCkDate(entry.invoiceDate);
    setCkResult(null);
    setCkError(null);
  };

  const clearCkResult = () => { setCkResult(null); setCkError(null); };

  const ckDetails = ckResult?.invoiceDetails;

  return (
    <div className="page">
      {/* Hidden file input for invoice upload */}
      <input
        ref={invoiceFileRef}
        type="file"
        accept=".pdf,.csv,.xlsx,.xls,.json,image/*"
        onChange={handleInvoiceUpload}
        style={{ display: "none" }}
      />

      <div className="page-header-row">
        <div>
          <h2>{config.labels.invoice}s</h2>
          <span className="text-muted">
            {summary.count} invoice{summary.count !== 1 ? "s" : ""} · {config.currency} {fmt(summary.grandTotal)} billed
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            className="btn btn-primary"
            onClick={() => invoiceFileRef.current?.click()}
            disabled={uploadingInvoice}
          >
            {uploadingInvoice ? "⏳ Uploading…" : "📤 Upload Invoice"}
          </button>
        </div>
      </div>

      {/* Upload feedback */}
      {uploadMessage && (
        <div style={{
          padding: "10px 16px",
          borderRadius: "var(--radius)",
          marginBottom: 16,
          fontSize: 14,
          fontWeight: 500,
          background: uploadMessage.type === "success" ? "#d1fae5" : "#fee2e2",
          color: uploadMessage.type === "success" ? "#065f46" : "#991b1b",
          border: `1px solid ${uploadMessage.type === "success" ? "#a7f3d0" : "#fecaca"}`,
        }}>
          {uploadMessage.type === "success" ? "✅" : "❌"} {uploadMessage.text}
        </div>
      )}

      {/* Tab Bar */}
      <div style={{ display: "flex", gap: 0, borderBottom: "2px solid #e5e7eb", marginBottom: 16 }}>
        <button
          onClick={() => setActiveTab("list")}
          style={{
            padding: "10px 20px", border: "none", cursor: "pointer", fontSize: 14, fontWeight: 600,
            background: "transparent",
            color: activeTab === "list" ? "#3b82f6" : "#6b7280",
            borderBottom: activeTab === "list" ? "2px solid #3b82f6" : "2px solid transparent",
            marginBottom: -2,
          }}
        >
          📄 {config.labels.invoice}s
        </button>
        <button
          onClick={() => setActiveTab("checker")}
          style={{
            padding: "10px 20px", border: "none", cursor: "pointer", fontSize: 14, fontWeight: 600,
            background: "transparent",
            color: activeTab === "checker" ? "#3b82f6" : "#6b7280",
            borderBottom: activeTab === "checker" ? "2px solid #3b82f6" : "2px solid transparent",
            marginBottom: -2,
          }}
        >
          🔍 {config.labels.invoice} Checker
        </button>
      </div>

      {/* ═══ INVOICES LIST TAB ═══ */}
      {activeTab === "list" && (
        <>

      {/* Summary Cards */}
      {!isLoading && enriched.length > 0 && (
        <div className="summary-cards">
          <div className="summary-card summary-card-highlight">
            <span className="summary-card-value">{fmt(summary.grandTotal)}</span>
            <span className="summary-card-label">Total Billed ({config.currency})</span>
          </div>
          <div className="summary-card" style={{ borderLeft: "3px solid #22c55e" }}>
            <span className="summary-card-value" style={{ color: "#22c55e" }}>{fmt(summary.totalPaid)}</span>
            <span className="summary-card-label">Collected ({config.currency})</span>
          </div>
          <div className="summary-card" style={{ borderLeft: "3px solid #f59e0b" }}>
            <span className="summary-card-value" style={{ color: "#f59e0b" }}>{fmt(summary.totalOutstanding)}</span>
            <span className="summary-card-label">Outstanding ({config.currency})</span>
          </div>
          <div className="summary-card" style={{ borderLeft: summary.overdueCount > 0 ? "3px solid #ef4444" : undefined }}>
            <span className="summary-card-value" style={{ color: summary.overdueCount > 0 ? "#ef4444" : undefined }}>
              {summary.overdueCount}
            </span>
            <span className="summary-card-label">Overdue</span>
          </div>
        </div>
      )}

      {/* Status Filter Chips */}
      {!isLoading && Object.keys(summary.statusCounts).length > 0 && (
        <div className="summary-strip">
          <button
            className={`summary-chip ${statusFilter === "all" ? "active" : ""}`}
            onClick={() => setStatusFilter("all")}
          >
            <span className="chip-count">{summary.count}</span>
            <span className="chip-label">All</span>
          </button>
          {Object.entries(summary.statusCounts).map(([status, s]) => {
            const cfg = STATUS_CONFIG[status] ?? { label: status, color: "#888" };
            return (
              <button
                key={status}
                className={`summary-chip ${statusFilter === status ? "active" : ""}`}
                onClick={() => setStatusFilter(statusFilter === status ? "all" : status)}
                style={{ borderColor: statusFilter === status ? cfg.color : undefined }}
              >
                <span className="chip-dot" style={{ background: cfg.color }} />
                <span className="chip-count">{s.count}</span>
                <span className="chip-label">{cfg.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Search Bar */}
      <div className="toolbar">
        <div className="search-box">
          <span className="search-icon">🔍</span>
          <input
            type="text"
            placeholder={`Search invoices by number or customer...`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && <button className="search-clear" onClick={() => setSearch("")}>✕</button>}
        </div>
        <span className="toolbar-count">
          {filtered.length} result{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {isLoading ? (
        <div className="loading-state">
          <div className="spinner" />
          <p>Loading invoices...</p>
        </div>
      ) : (
        <div className="card table-card">
          <table className="data-table">
            <thead>
              <tr>
                <th className="sortable" onClick={() => handleSort("invoiceNumber")}>{config.labels.invoice} #{sortIcon("invoiceNumber")}</th>
                <th className="sortable" onClick={() => handleSort("customer")}>{config.labels.customer}{sortIcon("customer")}</th>
                <th className="sortable" onClick={() => handleSort("status")}>Status{sortIcon("status")}</th>
                <th>Type</th>
                <th className="sortable" onClick={() => handleSort("totalAmount")}>Total ({config.currency}){sortIcon("totalAmount")}</th>
                <th className="sortable" onClick={() => handleSort("paidAmount")}>Paid ({config.currency}){sortIcon("paidAmount")}</th>
                <th className="sortable" onClick={() => handleSort("balance")}>Balance{sortIcon("balance")}</th>
                <th className="sortable" onClick={() => handleSort("kraVerified")}>KRA{sortIcon("kraVerified")}</th>
                <th className="sortable" onClick={() => handleSort("dueDate")}>Due Date{sortIcon("dueDate")}</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((inv: any) => {
                const isOverdue = inv.dueDate && inv._direction === "receivable" && new Date(inv.dueDate) < new Date();
                return (
                  <tr key={inv.id} className={isOverdue ? "row-overdue" : ""}>
                    <td><code className="sku-code">{inv.invoiceNumber}</code></td>
                    <td>
                      <div className="cell-main">{inv.customer?.name ?? "—"}</div>
                      {inv.notes && <div className="cell-sub">{inv.notes.slice(0, 50)}{inv.notes.length > 50 ? "…" : ""}</div>}
                    </td>
                    <td>
                      <span
                        className="status-pill"
                        style={{ backgroundColor: STATUS_CONFIG[inv.status]?.color ?? "#888" }}
                      >
                        {STATUS_CONFIG[inv.status]?.label ?? inv.status}
                      </span>
                    </td>
                    <td>{directionBadge(inv._direction)}</td>
                    <td className="text-right font-semibold">{fmt(inv._total)}</td>
                    <td className="text-right" style={{ color: inv._paid > 0 ? "#22c55e" : undefined }}>{fmt(inv._paid)}</td>
                    <td className="text-right" style={{ color: inv._balance > 0 ? "#f59e0b" : "#22c55e", fontWeight: 600 }}>
                      {inv._balance > 0 ? fmt(inv._balance) : "0.00"}
                    </td>
                    <td>
                      {inv.kraVerified ? (
                        <span className="status-pill" style={{ backgroundColor: "#22c55e", fontSize: "0.7rem" }} title={inv.kraVerifiedAt ? `Verified ${new Date(inv.kraVerifiedAt).toLocaleDateString()}` : "Verified"}>
                          ✅ Verified
                        </span>
                      ) : (
                        <span className="status-pill" style={{ backgroundColor: "#94a3b8", fontSize: "0.7rem" }}>
                          ⏳ Unverified
                        </span>
                      )}
                      {inv.kraInvoiceNumber && (
                        <div className="cell-sub" style={{ fontSize: "0.65rem", marginTop: 2 }}>{inv.kraInvoiceNumber}</div>
                      )}
                    </td>
                    <td>
                      {inv.dueDate ? (
                        <span style={{ color: isOverdue ? "#ef4444" : undefined, fontWeight: isOverdue ? 600 : undefined }}>
                          {new Date(inv.dueDate).toLocaleDateString()}
                          {isOverdue && " ⚠"}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="action-cell">
                      {inv.status === "draft" && (
                        <button className="btn btn-xs btn-primary" onClick={() => handleAction(inv.id, "send")}>
                          Send
                        </button>
                      )}
                      {inv.status !== "cancelled" && inv.status !== "paid" && (
                        <button
                          className="btn btn-xs btn-danger"
                          onClick={() => handleAction(inv.id, "void")}
                        >
                          Void
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={10} className="text-center text-muted" style={{ padding: 32 }}>
                    {search || statusFilter !== "all"
                      ? "No invoices match your filters"
                      : `No ${config.labels.invoice.toLowerCase()}s found`}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {data?.pagination && data.pagination.totalPages > 1 && (
        <div className="pagination">
          <button className="btn btn-sm btn-secondary" disabled={!data.pagination.hasPrev} onClick={() => setPage(page - 1)}>← Prev</button>
          <span className="pagination-info">Page {data.pagination.page} of {data.pagination.totalPages}</span>
          <button className="btn btn-sm btn-secondary" disabled={!data.pagination.hasNext} onClick={() => setPage(page + 1)}>Next →</button>
        </div>
      )}
        </>
      )}

      {/* ═══ INVOICE CHECKER TAB ═══ */}
      {activeTab === "checker" && (
        <div className="checker-layout">
          {/* ── LEFT: Search Form + Result ── */}
          <div className="checker-main">
            {/* Search Card */}
            <div className="card checker-search-card">
              <h3>Check an Invoice</h3>
              <p className="text-muted" style={{ marginBottom: 16 }}>
                Enter the invoice number and date from a supplier invoice to verify it was submitted to KRA.
              </p>
              <div className="checker-form">
                <div className="form-field">
                  <label>Invoice Number</label>
                  <input
                    type="text"
                    placeholder="e.g. 0040799830000906400"
                    value={ckInvoiceNumber}
                    onChange={(e) => setCkInvoiceNumber(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleCheck()}
                  />
                  <span className="form-hint">The eTIMS invoice number printed on the supplier's receipt/invoice</span>
                </div>
                <div className="form-field">
                  <label>Invoice Date</label>
                  <input
                    type="date"
                    value={ckDate}
                    onChange={(e) => setCkDate(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleCheck()}
                  />
                  <span className="form-hint">Date shown on the invoice (YYYY-MM-DD)</span>
                </div>
                <button
                  className="btn btn-primary checker-submit-btn"
                  disabled={ckLoading || !ckInvoiceNumber.trim() || !ckDate}
                  onClick={handleCheck}
                >
                  {ckLoading ? (<><span className="spinner-inline" /> Checking…</>) : "🔍 Verify Invoice"}
                </button>
              </div>
            </div>

            {/* Error */}
            {ckError && (
              <div className="alert alert-error" style={{ marginTop: 16 }}>❌ {ckError}</div>
            )}

            {/* Result Card */}
            {ckResult && (
              <div className={`card checker-result-card ${ckResult.status === "OK" ? "result-ok" : "result-error"}`} style={{ marginTop: 16 }}>
                <div className="checker-result-header">
                  <div className="checker-result-status">
                    {ckResult.status === "OK" ? (
                      <><span className="result-icon result-icon-ok">✅</span><div><h3>Invoice Verified</h3><p className="text-muted">{ckResult.responseDesc}</p></div></>
                    ) : (
                      <><span className="result-icon result-icon-err">❌</span><div><h3>Verification Failed</h3><p className="text-muted">{ckResult.responseDesc}</p></div></>
                    )}
                  </div>
                  <button className="btn btn-xs btn-secondary" onClick={clearCkResult}>Clear</button>
                </div>

                {ckDetails && (
                  <div className="checker-detail-grid">
                    <div className="checker-detail-section">
                      <h4>Supplier</h4>
                      <div className="detail-row"><span className="detail-label">Name</span><span className="detail-value">{ckDetails.supplierName ?? "—"}</span></div>
                      <div className="detail-row"><span className="detail-label">KRA PIN</span><span className="detail-value mono">{ckDetails.supplierPIN ?? "—"}</span></div>
                      <div className="detail-row"><span className="detail-label">Device S/N</span><span className="detail-value mono">{ckDetails.deviceSerialNumber ?? "—"}</span></div>
                    </div>
                    <div className="checker-detail-section">
                      <h4>Customer</h4>
                      <div className="detail-row"><span className="detail-label">Name</span><span className="detail-value">{ckDetails.customerName ?? "Not specified"}</span></div>
                      <div className="detail-row"><span className="detail-label">KRA PIN</span><span className="detail-value mono">{ckDetails.customerPin ?? "Not specified"}</span></div>
                    </div>
                    <div className="checker-detail-section">
                      <h4>Invoice References</h4>
                      <div className="detail-row"><span className="detail-label">Control Unit #</span><span className="detail-value mono">{ckDetails.controlUnitInvoiceNumber ?? "—"}</span></div>
                      <div className="detail-row"><span className="detail-label">Trader System #</span><span className="detail-value mono">{ckDetails.traderSystemInvoiceNumber ?? "—"}</span></div>
                      {ckDetails.exemptionCertificateNo && (
                        <div className="detail-row"><span className="detail-label">Exemption Cert</span><span className="detail-value mono">{ckDetails.exemptionCertificateNo}</span></div>
                      )}
                    </div>
                    <div className="checker-detail-section">
                      <h4>Dates</h4>
                      <div className="detail-row"><span className="detail-label">Sale Date</span><span className="detail-value">{fmtDate(ckDetails.salesDate)}</span></div>
                      <div className="detail-row"><span className="detail-label">Invoice Date</span><span className="detail-value">{fmtDateTime(ckDetails.invoiceDate)}</span></div>
                      <div className="detail-row"><span className="detail-label">Transmitted</span><span className="detail-value">{fmtDateTime(ckDetails.transmissionDate)}</span></div>
                    </div>
                    <div className="checker-detail-section checker-amounts">
                      <h4>Amounts</h4>
                      <div className="detail-row"><span className="detail-label">Total Amount</span><span className="detail-value amount-total">{fmtAmount(ckDetails.totalInvoiceAmount)}</span></div>
                      <div className="detail-row"><span className="detail-label">Taxable Amount</span><span className="detail-value">{fmtAmount(ckDetails.totalTaxableAmount)}</span></div>
                      <div className="detail-row"><span className="detail-label">Tax Amount</span><span className="detail-value">{fmtAmount(ckDetails.totalTaxAmount)}</span></div>
                      <div className="detail-row"><span className="detail-label">Discount</span><span className="detail-value">{fmtAmount(ckDetails.totalDiscountAmount)}</span></div>
                      <div className="detail-row"><span className="detail-label">Items</span><span className="detail-value">{ckDetails.totalItemCount}</span></div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── RIGHT: History Panel ── */}
          <div className="checker-sidebar">
            <div className="card checker-history-card">
              <h3>Recent Checks</h3>
              {ckHistory.length === 0 ? (
                <p className="text-muted" style={{ fontSize: 13 }}>No invoices checked yet. Results will appear here.</p>
              ) : (
                <div className="checker-history-list">
                  {ckHistory.map((entry, idx) => (
                    <button
                      key={`${entry.invoiceNumber}-${idx}`}
                      className="checker-history-item"
                      onClick={() => fillFromHistory(entry)}
                      title="Click to re-check this invoice"
                    >
                      <div className="history-status">{entry.status === "OK" ? "✅" : "❌"}</div>
                      <div className="history-info">
                        <span className="history-invoice-no mono">
                          {entry.invoiceNumber.length > 20 ? entry.invoiceNumber.slice(0, 8) + "…" + entry.invoiceNumber.slice(-8) : entry.invoiceNumber}
                        </span>
                        <span className="history-meta">
                          {entry.supplierName ?? "Unknown supplier"} • {entry.totalAmount != null ? fmtAmount(entry.totalAmount) : "—"}
                        </span>
                        <span className="history-date">{fmtDateTime(entry.checkedAt)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {ckHistory.length > 0 && (
                <button className="btn btn-xs btn-secondary" style={{ marginTop: 8, width: "100%" }} onClick={() => setCkHistory([])}>Clear History</button>
              )}
            </div>

            <div className="card checker-info-card">
              <h4>ℹ️ About Invoice Checker</h4>
              <p className="text-muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
                This tool verifies supplier invoices against KRA's eTIMS (Electronic Tax Invoice Management System) database.
                A successful check confirms the invoice was submitted and signed by a KRA-approved fiscal device.
              </p>
              <div className="checker-info-codes">
                <div className="info-code"><span className="code-badge code-ok">40000</span><span>Success — invoice found</span></div>
                <div className="info-code"><span className="code-badge code-err">40001</span><span>Invoice not found</span></div>
                <div className="info-code"><span className="code-badge code-warn">40005</span><span>Unable to process — retry</span></div>
                <div className="info-code"><span className="code-badge code-err">50000</span><span>KRA server error</span></div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
