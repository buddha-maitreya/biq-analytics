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
  tax_id: string | null;
  is_active: boolean;
  created_at: string;
  metadata: Record<string, unknown> | null;
  // Enriched fields from orders join
  total_spent: string | number;
  order_count: string | number;
  first_order_date: string | null;
  last_order_date: string | null;
}

type SortKey = "name" | "email" | "phone" | "totalSpent" | "lastServed" | "createdAt";
type SortDir = "asc" | "desc";

const emptyForm = { name: "", email: "", phone: "", address: "", taxId: "", notes: "" };

export default function CustomersPage({ config }: CustomersPageProps) {
  const [page, setPage] = useState(1);
  const { data, isLoading, refetch } = useAPI<any>(`GET /api/customers?page=${page}&limit=25`);
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

  const fmt = (n: string | number) =>
    Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const fmtDate = (d: string | null) => {
    if (!d) return "—";
    try {
      return new Date(d).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return "—";
    }
  };

  // ── Summary stats ───────────────────────────────────────────
  const summary = useMemo(() => {
    let total = 0;
    let totalSpent = 0;
    let withOrders = 0;
    let withEmail = 0;
    let repeatCustomers = 0;

    for (const c of customers) {
      total++;
      const spent = Number(c.total_spent) || 0;
      const orders = Number(c.order_count) || 0;
      totalSpent += spent;
      if (orders > 0) withOrders++;
      if (orders > 1) repeatCustomers++;
      if (c.email) withEmail++;
    }

    return { total, totalSpent, withOrders, withEmail, repeatCustomers };
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
          (c.tax_id && c.tax_id.toLowerCase().includes(q))
      );
    }

    list.sort((a, b) => {
      let av: string | number = "";
      let bv: string | number = "";
      switch (sortKey) {
        case "name":       av = a.name.toLowerCase(); bv = b.name.toLowerCase(); break;
        case "email":      av = (a.email ?? "").toLowerCase(); bv = (b.email ?? "").toLowerCase(); break;
        case "phone":      av = a.phone ?? ""; bv = b.phone ?? ""; break;
        case "totalSpent": av = Number(a.total_spent) || 0; bv = Number(b.total_spent) || 0; break;
        case "lastServed": av = a.last_order_date ?? ""; bv = b.last_order_date ?? ""; break;
        case "createdAt":  av = a.created_at; bv = b.created_at; break;
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
      taxId: c.tax_id ?? "",
      notes: (c.metadata as any)?.notes ?? "",
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
      const body: Record<string, unknown> = {
        name: formData.name,
        email: formData.email || undefined,
        phone: formData.phone || undefined,
        address: formData.address || undefined,
        taxId: formData.taxId || undefined,
        metadata: formData.notes ? { notes: formData.notes } : undefined,
      };

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

  const handleDownload = () => {
    const a = document.createElement("a");
    a.href = "/api/export/customers";
    a.click();
  };

  // ── Render ──────────────────────────────────────────────────
  return (
    <div className="page">
      {/* Header */}
      <div className="page-header-row">
        <div>
          <h2>{labelPlural}</h2>
          <p className="text-muted">Manage your {labelPlural.toLowerCase()} and track engagement</p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button className="btn btn-secondary" onClick={handleDownload} title="Download as Excel">
            ↓ Excel
          </button>
          <button className="btn btn-primary" onClick={openCreate}>
            + New {label}
          </button>
        </div>
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
          <span className="summary-chip" style={{ background: "#10b981" }}>💰</span>
          <div>
            <div className="summary-value">{curr} {fmt(summary.totalSpent)}</div>
            <div className="summary-label">Total Revenue</div>
          </div>
        </div>
        <div className="summary-card">
          <span className="summary-chip" style={{ background: "#f59e0b" }}>🔁</span>
          <div>
            <div className="summary-value">{summary.repeatCustomers} / {summary.withOrders}</div>
            <div className="summary-label">Repeat {labelPlural}</div>
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
              <input value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="Full name or company" />
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
              <label>Tax ID / KRA PIN</label>
              <input value={formData.taxId} onChange={(e) => setFormData({ ...formData, taxId: e.target.value })} placeholder="KRA PIN / VAT No." />
            </div>
            <div className="form-field" style={{ gridColumn: "1 / -1" }}>
              <label>Address</label>
              <input value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })} placeholder="Street, City, Country" />
            </div>
            <div className="form-field" style={{ gridColumn: "1 / -1" }}>
              <label>Notes / Feedback</label>
              <input value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} placeholder="Special requirements, preferences, feedback..." />
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
                <th className="sortable" onClick={() => handleSort("totalSpent")}>Total Spent ({curr}){sortIcon("totalSpent")}</th>
                <th>First Served</th>
                <th className="sortable" onClick={() => handleSort("lastServed")}>Last Served{sortIcon("lastServed")}</th>
                <th>Notes</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredCustomers.map((c) => {
                const spent = Number(c.total_spent) || 0;
                const orderCount = Number(c.order_count) || 0;
                const notes = (c.metadata as any)?.notes;
                return (
                  <tr key={c.id}>
                    <td>
                      <div className="cell-main">{c.name}</div>
                      {c.tax_id && <div className="cell-sub">Tax: {c.tax_id}</div>}
                    </td>
                    <td>{c.email ?? <span className="text-muted">—</span>}</td>
                    <td>{c.phone ?? <span className="text-muted">—</span>}</td>
                    <td>
                      <span style={{ fontWeight: spent > 0 ? 600 : 400, color: spent > 0 ? "#059669" : undefined }}>
                        {spent > 0 ? fmt(spent) : "—"}
                      </span>
                      {orderCount > 0 && (
                        <div className="cell-sub">{orderCount} order{orderCount !== 1 ? "s" : ""}</div>
                      )}
                    </td>
                    <td className="text-muted" style={{ fontSize: "0.85rem" }}>
                      {fmtDate(c.first_order_date)}
                    </td>
                    <td className="text-muted" style={{ fontSize: "0.85rem" }}>
                      {fmtDate(c.last_order_date)}
                    </td>
                    <td style={{ maxWidth: 180, fontSize: "0.8rem" }}>
                      {notes ? (
                        <span className="text-muted" title={notes}>
                          {notes.length > 40 ? notes.slice(0, 40) + "…" : notes}
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
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
                  <td colSpan={8} className="text-center text-muted" style={{ padding: "2rem" }}>
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
