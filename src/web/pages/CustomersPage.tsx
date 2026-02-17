import React, { useState, useMemo } from "react";
import { useAPI } from "@agentuity/react";
import type { AppConfig } from "../types";

interface CustomersPageProps {
  config: AppConfig;
}

interface Customer {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  taxId: string | null;
  creditLimit: string | null;
  balance: string;
  isActive: boolean;
  createdAt: string;
  metadata: Record<string, unknown> | null;
}

type SortKey = "name" | "email" | "phone" | "balance" | "creditLimit" | "createdAt";
type SortDir = "asc" | "desc";

const emptyForm = { name: "", email: "", phone: "", address: "", taxId: "", creditLimit: "" };

export default function CustomersPage({ config }: CustomersPageProps) {
  const [page, setPage] = useState(1);
  const { data, isLoading, refetch } = useAPI<any>(`GET /api/customers?page=${page}&limit=100`);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const customers: Customer[] = data?.data ?? [];
  const label = config.labels.customer;
  const labelPlural = config.labels.customerPlural;
  const curr = config.currency;

  // ── Summary stats ───────────────────────────────────────────
  const summary = useMemo(() => {
    let total = 0;
    let withBalance = 0;
    let totalBalance = 0;
    let totalCreditLimit = 0;
    let withEmail = 0;

    for (const c of customers) {
      total++;
      const bal = Number(c.balance) || 0;
      if (bal > 0) { withBalance++; totalBalance += bal; }
      totalCreditLimit += Number(c.creditLimit) || 0;
      if (c.email) withEmail++;
    }

    return { total, withBalance, totalBalance, totalCreditLimit, withEmail };
  }, [customers]);

  // ── Filter + sort ───────────────────────────────────────────
  const filteredCustomers = useMemo(() => {
    let list = [...customers];

    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.email && c.email.toLowerCase().includes(q)) ||
          (c.phone && c.phone.includes(q)) ||
          (c.taxId && c.taxId.toLowerCase().includes(q))
      );
    }

    list.sort((a, b) => {
      let av: string | number = "";
      let bv: string | number = "";
      switch (sortKey) {
        case "name":        av = a.name.toLowerCase(); bv = b.name.toLowerCase(); break;
        case "email":       av = (a.email ?? "").toLowerCase(); bv = (b.email ?? "").toLowerCase(); break;
        case "phone":       av = a.phone ?? ""; bv = b.phone ?? ""; break;
        case "balance":     av = Number(a.balance) || 0; bv = Number(b.balance) || 0; break;
        case "creditLimit": av = Number(a.creditLimit) || 0; bv = Number(b.creditLimit) || 0; break;
        case "createdAt":   av = a.createdAt; bv = b.createdAt; break;
      }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });

    return list;
  }, [customers, search, sortKey, sortDir]);

  // ── Sort handler ────────────────────────────────────────────
  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const sortIcon = (key: SortKey) =>
    sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "";

  // ── Form handlers ──────────────────────────────────────────
  const openCreate = () => {
    setEditingId(null);
    setFormData(emptyForm);
    setShowForm(true);
    setMessage(null);
  };

  const openEdit = (c: Customer) => {
    setEditingId(c.id);
    setFormData({
      name: c.name,
      email: c.email ?? "",
      phone: c.phone ?? "",
      address: c.address ?? "",
      taxId: c.taxId ?? "",
      creditLimit: c.creditLimit ?? "",
    });
    setShowForm(true);
    setMessage(null);
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      setMessage({ type: "error", text: "Name is required." });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const body: Record<string, unknown> = { ...formData };
      if (body.creditLimit) body.creditLimit = Number(body.creditLimit);
      else delete body.creditLimit;

      const url = editingId ? `/api/customers/${editingId}` : "/api/customers";
      const method = editingId ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result?.error?.message ?? "Save failed");

      setShowForm(false);
      setFormData(emptyForm);
      setEditingId(null);
      setMessage({ type: "success", text: `${label} ${editingId ? "updated" : "created"} successfully.` });
      refetch();
    } catch (err: any) {
      setMessage({ type: "error", text: err.message ?? "An error occurred." });
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async (id: string, name: string) => {
    if (!confirm(`Deactivate ${name}? This will hide them from active lists.`)) return;
    try {
      const res = await fetch(`/api/customers/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to deactivate");
      setMessage({ type: "success", text: `${name} deactivated.` });
      refetch();
    } catch {
      setMessage({ type: "error", text: "Failed to deactivate." });
    }
  };

  const fmt = (n: string | number) => Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // ── Render ──────────────────────────────────────────────────
  return (
    <div className="page">
      {/* Header */}
      <div className="page-header-row">
        <div>
          <h2>{labelPlural}</h2>
          <p className="text-muted">Manage your {labelPlural.toLowerCase()} and track balances</p>
        </div>
        <button className="btn btn-primary" onClick={openCreate}>
          + New {label}
        </button>
      </div>

      {/* Summary cards */}
      <div className="summary-cards">
        <div className="summary-card">
          <span className="summary-chip" style={{ background: "#6366f1" }}>👤</span>
          <div>
            <div className="summary-value">{summary.total}</div>
            <div className="summary-label">Total {labelPlural}</div>
          </div>
        </div>
        <div className="summary-card">
          <span className="summary-chip" style={{ background: "#f59e0b" }}>💰</span>
          <div>
            <div className="summary-value">{curr} {fmt(summary.totalBalance)}</div>
            <div className="summary-label">Outstanding Balances</div>
          </div>
        </div>
        <div className="summary-card">
          <span className="summary-chip" style={{ background: "#10b981" }}>🏦</span>
          <div>
            <div className="summary-value">{curr} {fmt(summary.totalCreditLimit)}</div>
            <div className="summary-label">Total Credit Limit</div>
          </div>
        </div>
        <div className="summary-card">
          <span className="summary-chip" style={{ background: "#8b5cf6" }}>📧</span>
          <div>
            <div className="summary-value">{summary.withEmail} / {summary.total}</div>
            <div className="summary-label">With Email</div>
          </div>
        </div>
      </div>

      {/* Messages */}
      {message && (
        <div className={`alert alert-${message.type}`} style={{ marginBottom: "1rem" }}>
          {message.type === "success" ? "✅" : "❌"} {message.text}
        </div>
      )}

      {/* Create / Edit form */}
      {showForm && (
        <div className="card form-card" style={{ marginBottom: "1.5rem" }}>
          <h3>{editingId ? `Edit ${label}` : `New ${label}`}</h3>
          <div className="form-grid">
            <div className="form-field">
              <label>Name *</label>
              <input value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="Full name" />
            </div>
            <div className="form-field">
              <label>Email</label>
              <input type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} placeholder="email@example.com" />
            </div>
            <div className="form-field">
              <label>Phone</label>
              <input value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} placeholder="+254 700 000 000" />
            </div>
            <div className="form-field">
              <label>Tax ID</label>
              <input value={formData.taxId} onChange={(e) => setFormData({ ...formData, taxId: e.target.value })} placeholder="KRA PIN / VAT No." />
            </div>
            <div className="form-field">
              <label>Credit Limit ({curr})</label>
              <input type="number" min={0} step="0.01" value={formData.creditLimit} onChange={(e) => setFormData({ ...formData, creditLimit: e.target.value })} placeholder="0.00" />
            </div>
            <div className="form-field" style={{ gridColumn: "1 / -1" }}>
              <label>Address</label>
              <input value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })} placeholder="Street, City, Country" />
            </div>
          </div>
          <div className="form-actions">
            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : editingId ? "Update" : "Create"}
            </button>
            <button className="btn btn-secondary" onClick={() => { setShowForm(false); setEditingId(null); }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="toolbar">
        <div className="search-box">
          <span className="search-icon">🔍</span>
          <input
            type="text"
            placeholder={`Search ${labelPlural.toLowerCase()} by name, email, phone, or tax ID...`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && <button className="search-clear" onClick={() => setSearch("")}>✕</button>}
        </div>
        <span className="text-muted" style={{ fontSize: "0.85rem", whiteSpace: "nowrap" }}>
          {filteredCustomers.length} of {customers.length}
        </span>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="loading-state"><div className="spinner" /> Loading {labelPlural.toLowerCase()}...</div>
      ) : (
        <div className="table-card">
          <table className="data-table">
            <thead>
              <tr>
                <th className="sortable" onClick={() => handleSort("name")}>Name{sortIcon("name")}</th>
                <th className="sortable" onClick={() => handleSort("email")}>Email{sortIcon("email")}</th>
                <th className="sortable" onClick={() => handleSort("phone")}>Phone{sortIcon("phone")}</th>
                <th className="sortable" onClick={() => handleSort("balance")}>Balance ({curr}){sortIcon("balance")}</th>
                <th className="sortable" onClick={() => handleSort("creditLimit")}>Credit Limit{sortIcon("creditLimit")}</th>
                <th className="sortable" onClick={() => handleSort("createdAt")}>Since{sortIcon("createdAt")}</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredCustomers.map((c) => {
                const bal = Number(c.balance) || 0;
                const limit = Number(c.creditLimit) || 0;
                const overLimit = limit > 0 && bal > limit;
                return (
                  <tr key={c.id}>
                    <td>
                      <div className="cell-main">{c.name}</div>
                      {c.taxId && <div className="cell-sub">Tax: {c.taxId}</div>}
                    </td>
                    <td>{c.email ?? <span className="text-muted">—</span>}</td>
                    <td>{c.phone ?? <span className="text-muted">—</span>}</td>
                    <td>
                      <span className={overLimit ? "text-danger" : bal > 0 ? "text-warning" : ""}>
                        {fmt(bal)}
                      </span>
                      {overLimit && <span className="badge-warning" style={{ marginLeft: 6, fontSize: "0.7rem" }}>OVER LIMIT</span>}
                    </td>
                    <td>{limit > 0 ? fmt(limit) : <span className="text-muted">—</span>}</td>
                    <td className="text-muted" style={{ fontSize: "0.85rem" }}>
                      {new Date(c.createdAt).toLocaleDateString()}
                    </td>
                    <td className="action-cell">
                      <button className="btn btn-sm btn-secondary" onClick={() => openEdit(c)} title="Edit">✏️</button>
                      <button className="btn btn-sm btn-danger" onClick={() => handleDeactivate(c.id, c.name)} title="Deactivate">🗑️</button>
                    </td>
                  </tr>
                );
              })}
              {filteredCustomers.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center text-muted" style={{ padding: "2rem" }}>
                    {search ? `No ${labelPlural.toLowerCase()} matching "${search}"` : `No ${labelPlural.toLowerCase()} found`}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {data?.pagination && data.pagination.totalPages > 1 && (
        <div className="pagination">
          <button disabled={!data.pagination.hasPrev} onClick={() => setPage(page - 1)}>
            ← Prev
          </button>
          <span>Page {data.pagination.page} of {data.pagination.totalPages}</span>
          <button disabled={!data.pagination.hasNext} onClick={() => setPage(page + 1)}>
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
