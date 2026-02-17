import React, { useState, useMemo } from "react";
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

export default function InvoicesPage({ config }: InvoicesPageProps) {
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

  return (
    <div className="page">
      <div className="page-header-row">
        <div>
          <h2>{config.labels.invoice}s</h2>
          <span className="text-muted">
            {summary.count} invoice{summary.count !== 1 ? "s" : ""} · {config.currency} {fmt(summary.grandTotal)} billed
          </span>
        </div>
      </div>

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
    </div>
  );
}
