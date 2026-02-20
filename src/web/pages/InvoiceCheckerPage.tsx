import React, { useState, useRef, useCallback } from "react";
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

/** OCR-extracted invoice data from document-scanner agent */
interface ScannedInvoice {
  invoiceNumber: string | null;
  supplierName: string | null;
  supplierAddress: string | null;
  supplierContact: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  currency: string | null;
  subtotal: number | null;
  taxAmount: number | null;
  totalAmount: number | null;
  lineItems: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    sku: string | null;
  }>;
  paymentTerms: string | null;
  bankDetails: string | null;
  confidence: number;
  warnings: string[];
}

export default function InvoiceCheckerPage({ config }: InvoiceCheckerPageProps) {
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const scanRef = useRef<HTMLInputElement>(null);

  // OCR scan state
  const [scanning, setScanning] = useState(false);
  const [scannedInvoice, setScannedInvoice] = useState<ScannedInvoice | null>(null);
  const [savingInvoice, setSavingInvoice] = useState(false);
  const [saveResult, setSaveResult] = useState<any>(null);

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

  /** Handle invoice scan via camera */
  const handleInvoiceScan = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setScanning(true);
    setScannedInvoice(null);
    setSaveResult(null);

    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string).split(",")[1];
        try {
          const res = await fetch("/api/scan/invoice", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ imageData: base64 }),
          });
          const data = await res.json();

          if (!data.success || !data.data) {
            alert("Could not extract invoice data from the image. Try a clearer photo.");
            setScanning(false);
            return;
          }

          setScannedInvoice({
            invoiceNumber: data.data.invoiceNumber ?? null,
            supplierName: data.data.supplierName ?? null,
            supplierAddress: data.data.supplierAddress ?? null,
            supplierContact: data.data.supplierContact ?? null,
            invoiceDate: data.data.invoiceDate ?? null,
            dueDate: data.data.dueDate ?? null,
            currency: data.data.currency ?? config.currency,
            subtotal: data.data.subtotal ?? null,
            taxAmount: data.data.taxAmount ?? null,
            totalAmount: data.data.totalAmount ?? null,
            lineItems: data.data.lineItems ?? [],
            paymentTerms: data.data.paymentTerms ?? null,
            bankDetails: data.data.bankDetails ?? null,
            confidence: data.data.confidence ?? 0.5,
            warnings: data.data.warnings ?? [],
          });

          // Auto-fill the checker fields if invoice number extracted
          if (data.data.invoiceNumber) {
            setInvoiceNumber(data.data.invoiceNumber);
          }
          if (data.data.invoiceDate) {
            setInvoiceDate(data.data.invoiceDate);
          }
        } catch {
          alert("Failed to process invoice scan. Please try again.");
        }
        setScanning(false);
      };
      reader.readAsDataURL(file);
    } catch {
      setScanning(false);
    }
  }, [config.currency]);

  /** Save scanned invoice to system */
  const saveScannedInvoice = async () => {
    if (!scannedInvoice?.invoiceNumber) {
      alert("Invoice number is required to save.");
      return;
    }
    setSavingInvoice(true);
    try {
      const res = await fetch("/api/invoices/from-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceNumber: scannedInvoice.invoiceNumber,
          supplierName: scannedInvoice.supplierName,
          invoiceDate: scannedInvoice.invoiceDate,
          dueDate: scannedInvoice.dueDate,
          subtotal: scannedInvoice.subtotal,
          taxAmount: scannedInvoice.taxAmount,
          totalAmount: scannedInvoice.totalAmount,
          lineItems: scannedInvoice.lineItems,
        }),
      });
      const data = await res.json();
      setSaveResult(data.data);
    } catch {
      alert("Failed to save invoice.");
    }
    setSavingInvoice(false);
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
                  <input ref={scanRef} type="file" accept="image/*" capture="environment" onChange={handleInvoiceScan} style={{ display: "none" }} />
                  <button
                    className="btn btn-icon scan-btn"
                    onClick={() => scanRef.current?.click()}
                    disabled={scanning}
                    title="Scan invoice with camera"
                  >
                    {scanning ? "⏳" : "📷"}
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

          {/* ── Scanned Invoice Review Panel ── */}
          {scannedInvoice && (
            <div className="scan-review-panel" style={{ marginTop: 16 }}>
              <div className="scan-review-header">
                <div className="scan-review-header-left">
                  <span className="scan-review-icon">🧾</span>
                  <div>
                    <h3>Scanned Invoice Data</h3>
                    <span className="text-muted">
                      Confidence: {Math.round(scannedInvoice.confidence * 100)}%
                      {scannedInvoice.supplierName && ` · ${scannedInvoice.supplierName}`}
                    </span>
                  </div>
                </div>
                <button className="btn btn-xs btn-secondary" onClick={() => { setScannedInvoice(null); setSaveResult(null); }}>✕ Close</button>
              </div>

              {scannedInvoice.warnings.length > 0 && (
                <div className="scan-warnings">
                  {scannedInvoice.warnings.map((w, i) => (
                    <span key={i} className="scan-warning-badge">⚠ {w}</span>
                  ))}
                </div>
              )}

              <div className="scan-review-body">
                {/* Invoice header info */}
                <div className="scan-invoice-grid">
                  <div className="scan-invoice-field">
                    <span className="form-label">Invoice #</span>
                    <span className="scan-invoice-value mono">{scannedInvoice.invoiceNumber ?? "Not detected"}</span>
                  </div>
                  <div className="scan-invoice-field">
                    <span className="form-label">Supplier</span>
                    <span className="scan-invoice-value">{scannedInvoice.supplierName ?? "Not detected"}</span>
                  </div>
                  <div className="scan-invoice-field">
                    <span className="form-label">Invoice Date</span>
                    <span className="scan-invoice-value">{scannedInvoice.invoiceDate ?? "—"}</span>
                  </div>
                  <div className="scan-invoice-field">
                    <span className="form-label">Due Date</span>
                    <span className="scan-invoice-value">{scannedInvoice.dueDate ?? "—"}</span>
                  </div>
                  <div className="scan-invoice-field">
                    <span className="form-label">Subtotal</span>
                    <span className="scan-invoice-value">{scannedInvoice.subtotal != null ? fmt(scannedInvoice.subtotal) : "—"}</span>
                  </div>
                  <div className="scan-invoice-field">
                    <span className="form-label">Tax</span>
                    <span className="scan-invoice-value">{scannedInvoice.taxAmount != null ? fmt(scannedInvoice.taxAmount) : "—"}</span>
                  </div>
                  <div className="scan-invoice-field">
                    <span className="form-label">Total</span>
                    <span className="scan-invoice-value amount-total">{scannedInvoice.totalAmount != null ? fmt(scannedInvoice.totalAmount) : "—"}</span>
                  </div>
                  <div className="scan-invoice-field">
                    <span className="form-label">Payment Terms</span>
                    <span className="scan-invoice-value">{scannedInvoice.paymentTerms ?? "—"}</span>
                  </div>
                </div>

                {/* Line items */}
                {scannedInvoice.lineItems.length > 0 && (
                  <div style={{ marginTop: 16 }}>
                    <h4 style={{ fontSize: 14, marginBottom: 8 }}>Line Items ({scannedInvoice.lineItems.length})</h4>
                    <table className="data-table scan-review-table">
                      <thead>
                        <tr>
                          <th>Description</th>
                          <th className="text-right">Qty</th>
                          <th className="text-right">Unit Price</th>
                          <th className="text-right">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {scannedInvoice.lineItems.map((item, idx) => (
                          <tr key={idx}>
                            <td>
                              <div className="cell-main">{item.description}</div>
                              {item.sku && <div className="cell-sub">SKU: {item.sku}</div>}
                            </td>
                            <td className="text-right">{item.quantity}</td>
                            <td className="text-right">{fmt(item.unitPrice)}</td>
                            <td className="text-right font-semibold">{fmt(item.totalPrice)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Save result feedback */}
              {saveResult && (
                <div className={`scan-apply-result ${saveResult.duplicate ? "scan-apply-duplicate" : ""}`}>
                  <span className="scan-apply-result-icon">{saveResult.duplicate ? "⚠️" : "✅"}</span>
                  <span>{saveResult.duplicate ? saveResult.message : `Invoice saved successfully (ID: ${saveResult.invoice?.id})`}</span>
                </div>
              )}

              {/* Footer */}
              <div className="scan-review-footer">
                <span className="text-muted">
                  Review the extracted data above before saving
                </span>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn-secondary" onClick={() => { setScannedInvoice(null); setSaveResult(null); }}>Dismiss</button>
                  <button
                    className="btn btn-primary"
                    disabled={savingInvoice || !scannedInvoice.invoiceNumber || !!saveResult}
                    onClick={saveScannedInvoice}
                  >
                    {savingInvoice ? "Saving…" : "💾 Save Invoice to System"}
                  </button>
                </div>
              </div>
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
