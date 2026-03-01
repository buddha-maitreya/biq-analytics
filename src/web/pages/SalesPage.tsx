import React, { useState, useMemo, useCallback } from "react";
import { useAPI } from "@agentuity/react";
import type { AppConfig } from "../types";

interface SalesPageProps {
  config: AppConfig;
}

type SortKey = "saleNumber" | "sku" | "productName" | "warehouseName" | "totalAmount" | "quantity" | "saleDate" | "paymentMethod";
type SortDir = "asc" | "desc";

type DatePreset = "all" | "today" | "yesterday" | "last7" | "last30" | "last90" | "thisMonth" | "lastMonth" | "custom";

function resolveDatePreset(preset: DatePreset): { from: string; to: string } {
  if (preset === "all" || preset === "custom") return { from: "", to: "" };
  const pad = (n: number) => String(n).padStart(2, "0");
  const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const now = new Date();
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86400000);
  switch (preset) {
    case "today":     return { from: iso(now), to: iso(now) };
    case "yesterday": { const y = daysAgo(1); return { from: iso(y), to: iso(y) }; }
    case "last7":     return { from: iso(daysAgo(7)), to: iso(now) };
    case "last30":    return { from: iso(daysAgo(30)), to: iso(now) };
    case "last90":    return { from: iso(daysAgo(90)), to: iso(now) };
    case "thisMonth": return { from: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`, to: iso(now) };
    case "lastMonth": {
      const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lme = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: iso(lm), to: iso(lme) };
    }
  }
}

export default function SalesPage({ config }: SalesPageProps) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [branchFilter, setBranchFilter] = useState("all");
  const [datePreset, setDatePreset] = useState<DatePreset>("last30");
  const [dateFrom, setDateFrom] = useState(() => resolveDatePreset("last30").from);
  const [dateTo, setDateTo] = useState(() => resolveDatePreset("last30").to);

  const handleDatePreset = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const p = e.target.value as DatePreset;
    setDatePreset(p);
    if (p !== "custom") {
      const { from, to } = resolveDatePreset(p);
      setDateFrom(from);
      setDateTo(to);
    }
    setPage(1);
  }, []);

  const searchParam  = search       ? `&search=${encodeURIComponent(search)}`       : "";
  const branchParam  = branchFilter !== "all" ? `&warehouseId=${branchFilter}` : "";
  const dateFromParam = dateFrom    ? `&startDate=${dateFrom}`                      : "";
  const dateToParam   = dateTo      ? `&endDate=${dateTo}`                          : "";
  const { data, isLoading, isError, error, refetch } = useAPI<any>(
    `GET /api/sales?page=${page}&limit=25${searchParam}${branchParam}${dateFromParam}${dateToParam}`
  );

  const handleDownload = () => {
    const p = new URLSearchParams();
    if (dateFrom)               p.set("startDate",  dateFrom);
    if (dateTo)                 p.set("endDate",    dateTo);
    if (branchFilter !== "all") p.set("warehouseId", branchFilter);
    const a = document.createElement("a");
    a.href = `/api/export/sales?${p}`;
    a.click();
  };

  const salesData: any[] = data?.data ?? [];

  // Summary stats
  const summary = useMemo(() => {
    let totalRevenue = 0;
    let totalQty = 0;
    const branches: Record<string, { name: string; id: string; count: number; revenue: number }> = {};
    const methods: Record<string, { count: number; revenue: number }> = {};
    const categories: Record<string, { count: number; revenue: number }> = {};

    for (const s of salesData) {
      const amount = Number(s.totalAmount) || 0;
      const qty = Number(s.quantity) || 0;
      totalRevenue += amount;
      totalQty += qty;

      const bn = s.warehouseName ?? "Unknown";
      const bid = s.warehouseId ?? "unknown";
      if (!branches[bid]) branches[bid] = { name: bn, id: bid, count: 0, revenue: 0 };
      branches[bid].count++;
      branches[bid].revenue += amount;

      const pm = s.paymentMethod ?? "Unknown";
      if (!methods[pm]) methods[pm] = { count: 0, revenue: 0 };
      methods[pm].count++;
      methods[pm].revenue += amount;

      const cat = s.category ?? "Uncategorized";
      if (!categories[cat]) categories[cat] = { count: 0, revenue: 0 };
      categories[cat].count++;
      categories[cat].revenue += amount;
    }

    return {
      totalRevenue,
      totalQty,
      totalCount: salesData.length,
      branches,
      methods,
      categories,
      avgSale: salesData.length > 0 ? totalRevenue / salesData.length : 0,
    };
  }, [salesData]);

  // Sort state
  const [sortKey, setSortKey] = useState<SortKey>("saleDate");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const sortedSales = useMemo(() => {
    const list = [...salesData];
    list.sort((a, b) => {
      let aVal: string | number = "";
      let bVal: string | number = "";
      switch (sortKey) {
        case "saleNumber":    aVal = a.saleNumber ?? ""; bVal = b.saleNumber ?? ""; break;
        case "sku":           aVal = a.sku ?? ""; bVal = b.sku ?? ""; break;
        case "productName":   aVal = a.productName ?? ""; bVal = b.productName ?? ""; break;
        case "warehouseName": aVal = a.warehouseName ?? ""; bVal = b.warehouseName ?? ""; break;
        case "totalAmount":   aVal = Number(a.totalAmount) || 0; bVal = Number(b.totalAmount) || 0; break;
        case "quantity":      aVal = Number(a.quantity) || 0; bVal = Number(b.quantity) || 0; break;
        case "saleDate":      aVal = a.saleDate ?? ""; bVal = b.saleDate ?? ""; break;
        case "paymentMethod": aVal = a.paymentMethod ?? ""; bVal = b.paymentMethod ?? ""; break;
      }
      if (typeof aVal === "string") {
        const cmp = aVal.localeCompare(bVal as string);
        return sortDir === "asc" ? cmp : -cmp;
      }
      return sortDir === "asc" ? aVal - (bVal as number) : (bVal as number) - aVal;
    });
    return list;
  }, [salesData, sortKey, sortDir]);

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

  const fmt = (n: number) =>
    n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="page">
      <div className="page-header-row">
        <div>
          <h2>Sales</h2>
          <span className="text-muted">
            {summary.totalCount} transactions · KES {fmt(summary.totalRevenue)} total revenue
          </span>
        </div>
        <button className="btn btn-secondary" onClick={handleDownload} title="Download as Excel">
          ↓ Excel
        </button>
      </div>

      {/* Summary Cards */}
      {!isLoading && salesData.length > 0 && (
        <div className="summary-cards">
          <div className="summary-card summary-card-highlight">
            <span className="summary-card-value">{fmt(summary.totalRevenue)}</span>
            <span className="summary-card-label">Total Revenue (KES)</span>
          </div>
          <div className="summary-card">
            <span className="summary-card-value">{summary.totalCount}</span>
            <span className="summary-card-label">Total Sales</span>
          </div>
          <div className="summary-card">
            <span className="summary-card-value">{summary.totalQty}</span>
            <span className="summary-card-label">Units Sold</span>
          </div>
          <div className="summary-card">
            <span className="summary-card-value">{fmt(summary.avgSale)}</span>
            <span className="summary-card-label">Avg Sale Value</span>
          </div>
        </div>
      )}

      {/* Branch Filter Chips */}
      {!isLoading && Object.keys(summary.branches).length > 1 && (
        <div className="summary-strip">
          <button
            className={`summary-chip ${branchFilter === "all" ? "active" : ""}`}
            onClick={() => { setBranchFilter("all"); setPage(1); }}
          >
            <span className="chip-count">{summary.totalCount}</span>
            <span className="chip-label">All Branches</span>
          </button>
          {Object.entries(summary.branches).map(([id, b]) => (
            <button
              key={id}
              className={`summary-chip ${branchFilter === id ? "active" : ""}`}
              onClick={() => { setBranchFilter(branchFilter === id ? "all" : id); setPage(1); }}
            >
              <span className="chip-dot" style={{ background: "#3b82f6" }} />
              <span className="chip-count">{b.count}</span>
              <span className="chip-label">{b.name}</span>
              <span className="chip-amount">KES {fmt(b.revenue)}</span>
            </button>
          ))}
        </div>
      )}

      {/* Search Bar */}
      <div className="toolbar">
        <div className="date-range-dropdown">
          <select className="date-range-select" value={datePreset} onChange={handleDatePreset} aria-label="Date range">
            <option value="all">All time</option>
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="last7">Last 7 days</option>
            <option value="last30">Last 30 days</option>
            <option value="last90">Last 90 days</option>
            <option value="thisMonth">This month</option>
            <option value="lastMonth">Last month</option>
            <option value="custom">Custom range</option>
          </select>
          {datePreset === "custom" && (
            <div className="date-range-custom">
              <input type="date" className="date-input" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} title="From date" />
              <span className="date-sep">–</span>
              <input type="date" className="date-input" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} title="To date" />
            </div>
          )}
        </div>
        <div className="search-box">
          <span className="search-icon">🔍</span>
          <input
            type="text"
            placeholder="Search sales by SKU, product, branch..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
          {search && (
            <button className="search-clear" onClick={() => { setSearch(""); setPage(1); }}>✕</button>
          )}
        </div>
        <span className="toolbar-count">
          {sortedSales.length} result{sortedSales.length !== 1 ? "s" : ""}
        </span>
      </div>

      {isError ? (
        <div className="error-state" style={{ textAlign: "center", padding: 32 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
          <h3 style={{ margin: "0 0 8px" }}>Failed to load sales</h3>
          <p className="text-muted" style={{ margin: "0 0 16px" }}>
            {error?.message || "Unable to fetch sales data. Please check your connection and try again."}
          </p>
          <button className="btn btn-primary" onClick={() => refetch()}>Retry</button>
        </div>
      ) : isLoading ? (
        <div className="loading-state">
          <div className="spinner" />
          <p>Loading sales...</p>
        </div>
      ) : (
        <div className="card table-card">
          <table className="data-table">
            <thead>
              <tr>
                <th className="sortable" onClick={() => handleSort("saleNumber")}>Sale #{sortIcon("saleNumber")}</th>
                <th className="sortable" onClick={() => handleSort("sku")}>SKU{sortIcon("sku")}</th>
                <th className="sortable" onClick={() => handleSort("productName")}>Product{sortIcon("productName")}</th>
                <th className="sortable" onClick={() => handleSort("warehouseName")}>Branch{sortIcon("warehouseName")}</th>
                <th className="sortable text-right" onClick={() => handleSort("totalAmount")}>Amount (KES){sortIcon("totalAmount")}</th>
                <th className="sortable text-right" onClick={() => handleSort("quantity")}>Qty{sortIcon("quantity")}</th>
                <th className="sortable" onClick={() => handleSort("paymentMethod")}>Payment{sortIcon("paymentMethod")}</th>
                <th className="sortable" onClick={() => handleSort("saleDate")}>Date{sortIcon("saleDate")}</th>
              </tr>
            </thead>
            <tbody>
              {sortedSales.map((s: any) => (
                <tr key={s.id}>
                  <td><code className="sku-code">{s.saleNumber}</code></td>
                  <td><code className="sku-code">{s.sku}</code></td>
                  <td>
                    <div className="cell-main">{s.productName}</div>
                    {s.category && <div className="cell-sub">{s.category}</div>}
                  </td>
                  <td>{s.warehouseName ?? "—"}</td>
                  <td className="text-right font-semibold">{fmt(Number(s.totalAmount))}</td>
                  <td className="text-right">{s.quantity}</td>
                  <td>
                    <span className={`payment-badge payment-${(s.paymentMethod ?? "").toLowerCase().replace(/\s+/g, "-")}`}>
                      {s.paymentMethod ?? "—"}
                    </span>
                  </td>
                  <td>{new Date(s.saleDate).toLocaleDateString()}</td>
                </tr>
              ))}
              {sortedSales.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center text-muted" style={{ padding: 32 }}>
                    {search || branchFilter !== "all"
                      ? "No sales match your filters"
                      : "No sales found"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {data?.pagination && data.pagination.totalPages > 1 && (
        <div className="pagination">
          <button
            className="btn btn-sm btn-secondary"
            disabled={!data.pagination.hasPrev}
            onClick={() => setPage(page - 1)}
          >
            ← Prev
          </button>
          <span className="pagination-info">
            Page {data.pagination.page} of {data.pagination.totalPages}
          </span>
          <button
            className="btn btn-sm btn-secondary"
            disabled={!data.pagination.hasNext}
            onClick={() => setPage(page + 1)}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
