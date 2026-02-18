import React, { useState, useMemo } from "react";
import { useAPI } from "@agentuity/react";
import type { AppConfig, Page } from "../types";

interface OrdersPageProps {
  config: AppConfig;
  onNavigate?: (page: Page) => void;
}

type SortKey = "orderNumber" | "customer" | "status" | "totalAmount" | "createdAt";
type SortDir = "asc" | "desc";

export default function OrdersPage({ config, onNavigate }: OrdersPageProps) {
  const [page, setPage] = useState(1);
  const { data, isLoading, refetch } = useAPI<any>(`GET /api/orders?page=${page}&limit=100`);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const orders: any[] = data?.data ?? [];

  // Summary stats
  const summary = useMemo(() => {
    const statusCounts: Record<string, { label: string; color: string; count: number; total: number }> = {};
    let grandTotal = 0;
    let grandCount = 0;

    for (const o of orders) {
      const label = o.status?.label ?? "Unknown";
      const color = o.status?.color ?? "#888";
      const name = o.status?.name ?? "unknown";
      const amount = Number(o.totalAmount) || 0;

      if (!statusCounts[name]) statusCounts[name] = { label, color, count: 0, total: 0 };
      statusCounts[name].count++;
      statusCounts[name].total += amount;
      grandTotal += amount;
      grandCount++;
    }

    return { statusCounts, grandTotal, grandCount };
  }, [orders]);

  // Filter + sort
  const filteredOrders = useMemo(() => {
    let list = [...orders];

    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (o) =>
          o.orderNumber?.toLowerCase().includes(q) ||
          o.customer?.name?.toLowerCase().includes(q) ||
          o.notes?.toLowerCase().includes(q)
      );
    }

    if (statusFilter !== "all") {
      list = list.filter((o) => (o.status?.name ?? "") === statusFilter);
    }

    list.sort((a, b) => {
      let aVal: string | number = "";
      let bVal: string | number = "";
      switch (sortKey) {
        case "orderNumber": aVal = a.orderNumber ?? ""; bVal = b.orderNumber ?? ""; break;
        case "customer":    aVal = a.customer?.name ?? ""; bVal = b.customer?.name ?? ""; break;
        case "status":      aVal = a.status?.label ?? ""; bVal = b.status?.label ?? ""; break;
        case "totalAmount": aVal = Number(a.totalAmount) || 0; bVal = Number(b.totalAmount) || 0; break;
        case "createdAt":   aVal = a.createdAt ?? ""; bVal = b.createdAt ?? ""; break;
      }
      if (typeof aVal === "string") {
        const cmp = aVal.localeCompare(bVal as string);
        return sortDir === "asc" ? cmp : -cmp;
      }
      return sortDir === "asc" ? aVal - (bVal as number) : (bVal as number) - aVal;
    });

    return list;
  }, [orders, search, statusFilter, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const sortIcon = (key: SortKey) => {
    if (sortKey !== key) return " ↕";
    return sortDir === "asc" ? " ↑" : " ↓";
  };

  const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="page">
      <div className="page-header-row">
        <div>
          <h2>{config.labels.orderPlural}</h2>
          <span className="text-muted">
            {summary.grandCount} {config.labels.orderPlural.toLowerCase()} · {config.currency} {fmt(summary.grandTotal)} total
          </span>
        </div>
        {onNavigate && (
          <button className="btn btn-primary" onClick={() => onNavigate("pos")}>
            ➕ New {config.labels.order}
          </button>
        )}
      </div>

      {/* Summary Cards */}
      {!isLoading && orders.length > 0 && (
        <div className="summary-cards">
          <div className="summary-card summary-card-highlight">
            <span className="summary-card-value">{fmt(summary.grandTotal)}</span>
            <span className="summary-card-label">Total Revenue ({config.currency})</span>
          </div>
          <div className="summary-card">
            <span className="summary-card-value">{summary.grandCount}</span>
            <span className="summary-card-label">Total {config.labels.orderPlural}</span>
          </div>
          <div className="summary-card">
            <span className="summary-card-value">
              {summary.grandCount > 0 ? fmt(summary.grandTotal / summary.grandCount) : "0.00"}
            </span>
            <span className="summary-card-label">Avg {config.labels.order} Value</span>
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
            <span className="chip-count">{summary.grandCount}</span>
            <span className="chip-label">All</span>
          </button>
          {Object.entries(summary.statusCounts).map(([name, s]) => (
            <button
              key={name}
              className={`summary-chip ${statusFilter === name ? "active" : ""}`}
              onClick={() => setStatusFilter(statusFilter === name ? "all" : name)}
              style={{ borderColor: statusFilter === name ? s.color : undefined }}
            >
              <span className="chip-dot" style={{ background: s.color }} />
              <span className="chip-count">{s.count}</span>
              <span className="chip-label">{s.label}</span>
              <span className="chip-amount">{config.currency} {fmt(s.total)}</span>
            </button>
          ))}
        </div>
      )}

      {/* Search Bar */}
      <div className="toolbar">
        <div className="search-box">
          <span className="search-icon">🔍</span>
          <input
            type="text"
            placeholder={`Search ${config.labels.orderPlural.toLowerCase()}...`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && <button className="search-clear" onClick={() => setSearch("")}>✕</button>}
        </div>
        <span className="toolbar-count">
          {filteredOrders.length} result{filteredOrders.length !== 1 ? "s" : ""}
        </span>
      </div>

      {isLoading ? (
        <div className="loading-state">
          <div className="spinner" />
          <p>Loading {config.labels.orderPlural.toLowerCase()}...</p>
        </div>
      ) : (
        <div className="card table-card">
          <table className="data-table">
            <thead>
              <tr>
                <th className="sortable" onClick={() => handleSort("orderNumber")}>{config.labels.order} #{sortIcon("orderNumber")}</th>
                <th className="sortable" onClick={() => handleSort("customer")}>{config.labels.customer}{sortIcon("customer")}</th>
                <th className="sortable" onClick={() => handleSort("status")}>Status{sortIcon("status")}</th>
                <th className="sortable" onClick={() => handleSort("totalAmount")}>Total ({config.currency}){sortIcon("totalAmount")}</th>
                <th className="sortable" onClick={() => handleSort("createdAt")}>Date{sortIcon("createdAt")}</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.map((o: any) => (
                <tr key={o.id}>
                  <td><code className="sku-code">{o.orderNumber}</code></td>
                  <td>
                    <div className="cell-main">{o.customer?.name ?? "Walk-in"}</div>
                    {o.notes && <div className="cell-sub">{o.notes.slice(0, 50)}{o.notes.length > 50 ? "…" : ""}</div>}
                  </td>
                  <td>
                    <span
                      className="status-pill"
                      style={{ backgroundColor: o.status?.color ?? "#888" }}
                    >
                      {o.status?.label ?? "—"}
                    </span>
                  </td>
                  <td className="text-right font-semibold">{fmt(Number(o.totalAmount))}</td>
                  <td>{new Date(o.createdAt).toLocaleDateString()}</td>
                  <td>
                    {!o.status?.isFinal && (
                      <button
                        className="btn btn-xs btn-danger"
                        onClick={async () => {
                          await fetch(`/api/orders/${o.id}/cancel`, { method: "POST" });
                          refetch();
                        }}
                      >
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {filteredOrders.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center text-muted" style={{ padding: 32 }}>
                    {search || statusFilter !== "all"
                      ? `No ${config.labels.orderPlural.toLowerCase()} match your filters`
                      : `No ${config.labels.orderPlural.toLowerCase()} found`}
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
