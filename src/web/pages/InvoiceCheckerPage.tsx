import React, { useState, useRef } from "react";
import type { AppConfig } from "../types";

interface InvoiceCheckerPageProps {
  config: AppConfig;
}

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

export default function InvoiceCheckerPage({ config }: InvoiceCheckerPageProps) {
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const scanRef = useRef<HTMLInputElement>(null);

  const fmt = (n: number | null) =>
    n != null
      ? `${config.currency} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : "—";

  const fmtDate = (d: string | null) => {
    if (!d) return "—";
    try {
      return new Date(d).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return d;
    }
  };

  const fmtDateTime = (d: string | null) => {
    if (!d) return "—";
    try {
      return new Date(d).toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return d;
    }
  };

  const handleCheck = async () => {
    if (!invoiceNumber.trim() || !invoiceDate) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/kra/invoice/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceNumber: invoiceNumber.trim(),
          invoiceDate,
        }),
      });
      const json = await res.json();
      const data: CheckResult = json.data ?? json;

      setResult(data);

      // Add to history
      setHistory((prev) => [
        {
          invoiceNumber: invoiceNumber.trim(),
          invoiceDate,
          checkedAt: new Date().toISOString(),
          status: data.status,
          supplierName: data.invoiceDetails?.supplierName ?? null,
          totalAmount: data.invoiceDetails?.totalInvoiceAmount ?? null,
        },
        ...prev.slice(0, 19), // keep last 20
      ]);
    } catch {
      setError("Network error — could not reach the server.");
    } finally {
      setLoading(false);
    }
  };

  const fillFromHistory = (entry: HistoryEntry) => {
    setInvoiceNumber(entry.invoiceNumber);
    setInvoiceDate(entry.invoiceDate);
    setResult(null);
    setError(null);
  };

  const clearResult = () => {
    setResult(null);
    setError(null);
  };

  const d = result?.invoiceDetails;

  return (
    <div className="page invoice-checker-page">
      <div className="page-header">
        <div>
          <h2>🔍 KRA Invoice Checker</h2>
          <span className="text-muted">
            Verify supplier invoices against KRA eTIMS records
          </span>
        </div>
      </div>

      <div className="checker-layout">
        {/* ── LEFT: Search Form + Result ── */}
        <div className="checker-main">
          {/* Search Card */}
          <div className="card checker-search-card">
            <h3>Check an Invoice</h3>
            <p className="text-muted" style={{ marginBottom: 16 }}>
              Enter the invoice number and date from a supplier invoice to verify
              it was submitted to KRA.
            </p>

            <div className="checker-form">
              <div className="form-field">
                <label>Invoice Number</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    type="text"
                    placeholder="e.g. 0040799830000906400"
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleCheck()}
                    style={{ flex: 1 }}
                  />
                  {/* Scan invoice barcode / QR code */}
                  <input ref={scanRef} type="file" accept="image/*" capture="environment" onChange={() => {
                    scanRef.current && (scanRef.current.value = "");
                    alert("📷 Invoice captured! For full OCR extraction, use the AI Assistant — attach the photo and say \"scan this invoice\".");
                  }} style={{ display: "none" }} />
                  <button
                    className="btn btn-icon scan-btn"
                    onClick={() => scanRef.current?.click()}
                    title="Scan invoice with camera"
                  >
                    📷
                  </button>
                </div>
                <span className="form-hint">
                  The eTIMS invoice number printed on the supplier's receipt/invoice
                </span>
              </div>

              <div className="form-field">
                <label>Invoice Date</label>
                <input
                  type="date"
                  value={invoiceDate}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCheck()}
                />
                <span className="form-hint">Date shown on the invoice (YYYY-MM-DD)</span>
              </div>

              <button
                className="btn btn-primary checker-submit-btn"
                disabled={loading || !invoiceNumber.trim() || !invoiceDate}
                onClick={handleCheck}
              >
                {loading ? (
                  <>
                    <span className="spinner-inline" /> Checking…
                  </>
                ) : (
                  "🔍 Verify Invoice"
                )}
              </button>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="alert alert-error" style={{ marginTop: 16 }}>
              ❌ {error}
            </div>
          )}

          {/* Result Card */}
          {result && (
            <div
              className={`card checker-result-card ${
                result.status === "OK" ? "result-ok" : "result-error"
              }`}
              style={{ marginTop: 16 }}
            >
              <div className="checker-result-header">
                <div className="checker-result-status">
                  {result.status === "OK" ? (
                    <>
                      <span className="result-icon result-icon-ok">✅</span>
                      <div>
                        <h3>Invoice Verified</h3>
                        <p className="text-muted">{result.responseDesc}</p>
                      </div>
                    </>
                  ) : (
                    <>
                      <span className="result-icon result-icon-err">❌</span>
                      <div>
                        <h3>Verification Failed</h3>
                        <p className="text-muted">{result.responseDesc}</p>
                      </div>
                    </>
                  )}
                </div>
                <button
                  className="btn btn-xs btn-secondary"
                  onClick={clearResult}
                >
                  Clear
                </button>
              </div>

              {d && (
                <div className="checker-detail-grid">
                  {/* Supplier Info */}
                  <div className="checker-detail-section">
                    <h4>Supplier</h4>
                    <div className="detail-row">
                      <span className="detail-label">Name</span>
                      <span className="detail-value">{d.supplierName ?? "—"}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">KRA PIN</span>
                      <span className="detail-value mono">{d.supplierPIN ?? "—"}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">Device S/N</span>
                      <span className="detail-value mono">
                        {d.deviceSerialNumber ?? "—"}
                      </span>
                    </div>
                  </div>

                  {/* Customer Info */}
                  <div className="checker-detail-section">
                    <h4>Customer</h4>
                    <div className="detail-row">
                      <span className="detail-label">Name</span>
                      <span className="detail-value">
                        {d.customerName ?? "Not specified"}
                      </span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">KRA PIN</span>
                      <span className="detail-value mono">
                        {d.customerPin ?? "Not specified"}
                      </span>
                    </div>
                  </div>

                  {/* Invoice References */}
                  <div className="checker-detail-section">
                    <h4>Invoice References</h4>
                    <div className="detail-row">
                      <span className="detail-label">Control Unit #</span>
                      <span className="detail-value mono">
                        {d.controlUnitInvoiceNumber ?? "—"}
                      </span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">Trader System #</span>
                      <span className="detail-value mono">
                        {d.traderSystemInvoiceNumber ?? "—"}
                      </span>
                    </div>
                    {d.exemptionCertificateNo && (
                      <div className="detail-row">
                        <span className="detail-label">Exemption Cert</span>
                        <span className="detail-value mono">
                          {d.exemptionCertificateNo}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Dates */}
                  <div className="checker-detail-section">
                    <h4>Dates</h4>
                    <div className="detail-row">
                      <span className="detail-label">Sale Date</span>
                      <span className="detail-value">{fmtDate(d.salesDate)}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">Invoice Date</span>
                      <span className="detail-value">
                        {fmtDateTime(d.invoiceDate)}
                      </span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">Transmitted</span>
                      <span className="detail-value">
                        {fmtDateTime(d.transmissionDate)}
                      </span>
                    </div>
                  </div>

                  {/* Amounts */}
                  <div className="checker-detail-section checker-amounts">
                    <h4>Amounts</h4>
                    <div className="detail-row">
                      <span className="detail-label">Total Amount</span>
                      <span className="detail-value amount-total">
                        {fmt(d.totalInvoiceAmount)}
                      </span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">Taxable Amount</span>
                      <span className="detail-value">{fmt(d.totalTaxableAmount)}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">Tax Amount</span>
                      <span className="detail-value">{fmt(d.totalTaxAmount)}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">Discount</span>
                      <span className="detail-value">
                        {fmt(d.totalDiscountAmount)}
                      </span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">Items</span>
                      <span className="detail-value">{d.totalItemCount}</span>
                    </div>
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
            {history.length === 0 ? (
              <p className="text-muted" style={{ fontSize: 13 }}>
                No invoices checked yet. Results will appear here.
              </p>
            ) : (
              <div className="checker-history-list">
                {history.map((entry, idx) => (
                  <button
                    key={`${entry.invoiceNumber}-${idx}`}
                    className="checker-history-item"
                    onClick={() => fillFromHistory(entry)}
                    title="Click to re-check this invoice"
                  >
                    <div className="history-status">
                      {entry.status === "OK" ? "✅" : "❌"}
                    </div>
                    <div className="history-info">
                      <span className="history-invoice-no mono">
                        {entry.invoiceNumber.length > 20
                          ? entry.invoiceNumber.slice(0, 8) +
                            "…" +
                            entry.invoiceNumber.slice(-8)
                          : entry.invoiceNumber}
                      </span>
                      <span className="history-meta">
                        {entry.supplierName ?? "Unknown supplier"} •{" "}
                        {entry.totalAmount != null
                          ? fmt(entry.totalAmount)
                          : "—"}
                      </span>
                      <span className="history-date">
                        {fmtDateTime(entry.checkedAt)}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
            {history.length > 0 && (
              <button
                className="btn btn-xs btn-secondary"
                style={{ marginTop: 8, width: "100%" }}
                onClick={() => setHistory([])}
              >
                Clear History
              </button>
            )}
          </div>

          {/* Info Card */}
          <div className="card checker-info-card">
            <h4>ℹ️ About Invoice Checker</h4>
            <p className="text-muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
              This tool verifies supplier invoices against KRA's eTIMS (Electronic
              Tax Invoice Management System) database. A successful check confirms
              the invoice was submitted and signed by a KRA-approved fiscal device.
            </p>
            <div className="checker-info-codes">
              <div className="info-code">
                <span className="code-badge code-ok">40000</span>
                <span>Success — invoice found</span>
              </div>
              <div className="info-code">
                <span className="code-badge code-err">40001</span>
                <span>Invoice not found</span>
              </div>
              <div className="info-code">
                <span className="code-badge code-warn">40005</span>
                <span>Unable to process — retry</span>
              </div>
              <div className="info-code">
                <span className="code-badge code-err">50000</span>
                <span>KRA server error</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
