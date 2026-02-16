import React, { useState, useEffect } from "react";
import type { AppConfig } from "../App";

interface AdminPageProps {
  config: AppConfig;
}

type AdminTab = "statuses" | "tax" | "users" | "documents";

/* ---------- Sub-types ---------- */
interface OrderStatus {
  id: string;
  name: string;
  label: string;
  color: string | null;
  sortOrder: number;
  isFinal: boolean;
  isDefault: boolean;
}

interface TaxRule {
  id: string;
  name: string;
  rate: string;
  appliesTo: string | null;
  isDefault: boolean;
}

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
}

interface KBDocument {
  filename: string;
  title: string;
  category: string;
  uploadedAt: string;
  chunkCount: number;
}

/* =============================== */
export default function AdminPage({ config }: AdminPageProps) {
  const [tab, setTab] = useState<AdminTab>("statuses");

  const tabs: { key: AdminTab; label: string; icon: string }[] = [
    { key: "statuses", label: `${config.labels.order} Statuses`, icon: "🏷️" },
    { key: "tax", label: "Tax Rules", icon: "💲" },
    { key: "users", label: "Users", icon: "👤" },
    { key: "documents", label: "Knowledge Base", icon: "📄" },
  ];

  return (
    <div className="page admin-page">
      <div className="page-header">
        <h2>⚙️ Admin Console</h2>
        <span className="text-muted">Manage business configuration</span>
      </div>

      <div className="admin-tabs">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={`tab-btn ${tab === t.key ? "active" : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      <div className="admin-content">
        {tab === "statuses" && <OrderStatusesTab config={config} />}
        {tab === "tax" && <TaxRulesTab />}
        {tab === "users" && <UsersTab />}
        {tab === "documents" && <DocumentsTab />}
      </div>
    </div>
  );
}

/* ===== ORDER STATUSES TAB ===== */
function OrderStatusesTab({ config }: { config: AppConfig }) {
  const [statuses, setStatuses] = useState<OrderStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    label: "",
    color: "#3b82f6",
    sortOrder: 0,
    isFinal: false,
    isDefault: false,
  });

  const load = async () => {
    setLoading(true);
    const res = await fetch("/api/admin/order-statuses");
    const data = await res.json();
    setStatuses(data.data ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const resetForm = () => {
    setForm({ name: "", label: "", color: "#3b82f6", sortOrder: 0, isFinal: false, isDefault: false });
    setEditId(null);
    setShowForm(false);
  };

  const save = async () => {
    const method = editId ? "PUT" : "POST";
    const url = editId ? `/api/admin/order-statuses/${editId}` : "/api/admin/order-statuses";
    await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    resetForm();
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this status?")) return;
    await fetch(`/api/admin/order-statuses/${id}`, { method: "DELETE" });
    load();
  };

  const startEdit = (s: OrderStatus) => {
    setForm({
      name: s.name,
      label: s.label,
      color: s.color ?? "#3b82f6",
      sortOrder: s.sortOrder,
      isFinal: s.isFinal,
      isDefault: s.isDefault,
    });
    setEditId(s.id);
    setShowForm(true);
  };

  return (
    <div>
      <div className="section-header">
        <h3>{config.labels.order} Statuses</h3>
        <button className="btn btn-primary btn-sm" onClick={() => { resetForm(); setShowForm(true); }}>
          + New Status
        </button>
      </div>

      {showForm && (
        <div className="card inline-form">
          <div className="form-grid cols-3">
            <label>
              Name (slug)
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. pending" />
            </label>
            <label>
              Label
              <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="e.g. Pending" />
            </label>
            <label>
              Color
              <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} />
            </label>
            <label>
              Sort Order
              <input type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })} />
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={form.isFinal} onChange={(e) => setForm({ ...form, isFinal: e.target.checked })} />
              Final Status
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} />
              Default
            </label>
          </div>
          <div className="form-actions">
            <button className="btn btn-primary" onClick={save}>{editId ? "Update" : "Create"}</button>
            <button className="btn btn-secondary" onClick={resetForm}>Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <p>Loading…</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Color</th>
              <th>Name</th>
              <th>Label</th>
              <th>Order</th>
              <th>Final</th>
              <th>Default</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {statuses.map((s) => (
              <tr key={s.id}>
                <td><span className="color-dot" style={{ background: s.color ?? "#ccc" }} /></td>
                <td>{s.name}</td>
                <td>{s.label}</td>
                <td>{s.sortOrder}</td>
                <td>{s.isFinal ? "✓" : ""}</td>
                <td>{s.isDefault ? "✓" : ""}</td>
                <td>
                  <button className="btn btn-xs btn-secondary" onClick={() => startEdit(s)}>Edit</button>
                  <button className="btn btn-xs btn-danger" onClick={() => remove(s.id)}>Delete</button>
                </td>
              </tr>
            ))}
            {statuses.length === 0 && (
              <tr><td colSpan={7} className="text-center text-muted">No statuses configured</td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ===== TAX RULES TAB ===== */
function TaxRulesTab() {
  const [rules, setRules] = useState<TaxRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", rate: "", appliesTo: "", isDefault: false });

  const load = async () => {
    setLoading(true);
    const res = await fetch("/api/admin/tax-rules");
    const data = await res.json();
    setRules(data.data ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const resetForm = () => {
    setForm({ name: "", rate: "", appliesTo: "", isDefault: false });
    setEditId(null);
    setShowForm(false);
  };

  const save = async () => {
    const method = editId ? "PUT" : "POST";
    const url = editId ? `/api/admin/tax-rules/${editId}` : "/api/admin/tax-rules";
    await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        rate: form.rate,
        appliesTo: form.appliesTo || null,
      }),
    });
    resetForm();
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this tax rule?")) return;
    await fetch(`/api/admin/tax-rules/${id}`, { method: "DELETE" });
    load();
  };

  const startEdit = (r: TaxRule) => {
    setForm({
      name: r.name,
      rate: r.rate,
      appliesTo: r.appliesTo ?? "",
      isDefault: r.isDefault,
    });
    setEditId(r.id);
    setShowForm(true);
  };

  return (
    <div>
      <div className="section-header">
        <h3>Tax Rules</h3>
        <button className="btn btn-primary btn-sm" onClick={() => { resetForm(); setShowForm(true); }}>
          + New Rule
        </button>
      </div>

      {showForm && (
        <div className="card inline-form">
          <div className="form-grid cols-2">
            <label>
              Name
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Standard VAT" />
            </label>
            <label>
              Rate (%)
              <input type="number" step="0.01" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} placeholder="e.g. 16" />
            </label>
            <label>
              Applies To (optional)
              <input value={form.appliesTo} onChange={(e) => setForm({ ...form, appliesTo: e.target.value })} placeholder="Category or product type" />
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} />
              Default Rule
            </label>
          </div>
          <div className="form-actions">
            <button className="btn btn-primary" onClick={save}>{editId ? "Update" : "Create"}</button>
            <button className="btn btn-secondary" onClick={resetForm}>Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <p>Loading…</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Rate</th>
              <th>Applies To</th>
              <th>Default</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td>{r.rate}%</td>
                <td>{r.appliesTo ?? "All"}</td>
                <td>{r.isDefault ? "✓" : ""}</td>
                <td>
                  <button className="btn btn-xs btn-secondary" onClick={() => startEdit(r)}>Edit</button>
                  <button className="btn btn-xs btn-danger" onClick={() => remove(r.id)}>Delete</button>
                </td>
              </tr>
            ))}
            {rules.length === 0 && (
              <tr><td colSpan={5} className="text-center text-muted">No tax rules configured</td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ===== USERS TAB ===== */
function UsersTab() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ email: "", name: "", role: "staff" });

  const load = async () => {
    setLoading(true);
    const res = await fetch("/api/admin/users");
    const data = await res.json();
    setUsers(data.data ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const resetForm = () => {
    setForm({ email: "", name: "", role: "staff" });
    setEditId(null);
    setShowForm(false);
  };

  const save = async () => {
    const method = editId ? "PUT" : "POST";
    const url = editId ? `/api/admin/users/${editId}` : "/api/admin/users";
    await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    resetForm();
    load();
  };

  const toggleActive = async (u: User) => {
    if (u.isActive) {
      if (!confirm(`Deactivate ${u.name}?`)) return;
      await fetch(`/api/admin/users/${u.id}/deactivate`, { method: "POST" });
    } else {
      await fetch(`/api/admin/users/${u.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: true }),
      });
    }
    load();
  };

  const startEdit = (u: User) => {
    setForm({ email: u.email, name: u.name, role: u.role });
    setEditId(u.id);
    setShowForm(true);
  };

  return (
    <div>
      <div className="section-header">
        <h3>User Management</h3>
        <button className="btn btn-primary btn-sm" onClick={() => { resetForm(); setShowForm(true); }}>
          + New User
        </button>
      </div>

      {showForm && (
        <div className="card inline-form">
          <div className="form-grid cols-3">
            <label>
              Email
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="user@example.com" />
            </label>
            <label>
              Name
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Full name" />
            </label>
            <label>
              Role
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="admin">Admin</option>
                <option value="manager">Manager</option>
                <option value="staff">Staff</option>
                <option value="viewer">Viewer</option>
              </select>
            </label>
          </div>
          <div className="form-actions">
            <button className="btn btn-primary" onClick={save}>{editId ? "Update" : "Create"}</button>
            <button className="btn btn-secondary" onClick={resetForm}>Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <p>Loading…</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={u.isActive ? "" : "row-inactive"}>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td><span className={`role-badge role-${u.role}`}>{u.role}</span></td>
                <td>
                  <span className={`status-badge ${u.isActive ? "status-active" : "status-inactive"}`}>
                    {u.isActive ? "Active" : "Inactive"}
                  </span>
                </td>
                <td>
                  <button className="btn btn-xs btn-secondary" onClick={() => startEdit(u)}>Edit</button>
                  <button className="btn btn-xs btn-warning" onClick={() => toggleActive(u)}>
                    {u.isActive ? "Deactivate" : "Activate"}
                  </button>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr><td colSpan={5} className="text-center text-muted">No users</td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ===== DOCUMENTS / KNOWLEDGE BASE TAB ===== */
function DocumentsTab() {
  const [docs, setDocs] = useState<KBDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [queryText, setQueryText] = useState("");
  const [queryResult, setQueryResult] = useState<string | null>(null);
  const [querying, setQuerying] = useState(false);

  const [uploadForm, setUploadForm] = useState({
    title: "",
    filename: "",
    category: "general",
    content: "",
  });

  const load = async () => {
    setLoading(true);
    const res = await fetch("/api/admin/documents");
    const data = await res.json();
    setDocs(data.data ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const upload = async () => {
    if (!uploadForm.content.trim() || !uploadForm.title.trim()) return;
    setUploading(true);
    try {
      const res = await fetch("/api/admin/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: uploadForm.title,
          filename: uploadForm.filename || `${uploadForm.title.replace(/\s+/g, "-").toLowerCase()}.txt`,
          category: uploadForm.category,
          content: uploadForm.content,
        }),
      });
      if (!res.ok) throw new Error("Upload failed");
      setUploadForm({ title: "", filename: "", category: "general", content: "" });
      load();
    } catch {
      alert("Failed to upload document");
    } finally {
      setUploading(false);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setUploadForm((prev) => ({
      ...prev,
      title: prev.title || file.name.replace(/\.[^.]+$/, ""),
      filename: file.name,
      content: text,
    }));
  };

  const remove = async (filename: string) => {
    if (!confirm(`Remove "${filename}" from knowledge base?`)) return;
    await fetch(`/api/admin/documents/${encodeURIComponent(filename)}`, { method: "DELETE" });
    load();
  };

  const query = async () => {
    if (!queryText.trim()) return;
    setQuerying(true);
    setQueryResult(null);
    try {
      const res = await fetch("/api/admin/documents/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: queryText }),
      });
      const data = await res.json();
      setQueryResult(data.data?.answer ?? "No answer returned.");
    } catch {
      setQueryResult("Error querying knowledge base.");
    } finally {
      setQuerying(false);
    }
  };

  return (
    <div>
      <div className="section-header">
        <h3>📄 Knowledge Base Documents</h3>
        <span className="text-muted">Upload documents for the RAG-powered AI assistant</span>
      </div>

      {/* Upload section */}
      <div className="card upload-section">
        <h4>Upload Document</h4>
        <div className="form-grid cols-2">
          <label>
            Title
            <input
              value={uploadForm.title}
              onChange={(e) => setUploadForm({ ...uploadForm, title: e.target.value })}
              placeholder="Document title"
            />
          </label>
          <label>
            Category
            <select
              value={uploadForm.category}
              onChange={(e) => setUploadForm({ ...uploadForm, category: e.target.value })}
            >
              <option value="general">General</option>
              <option value="policy">Policies</option>
              <option value="procedure">Procedures</option>
              <option value="product-info">Product Information</option>
              <option value="training">Training Material</option>
              <option value="legal">Legal / Compliance</option>
              <option value="faq">FAQ</option>
            </select>
          </label>
        </div>

        <label>
          File (txt, md, csv)
          <input type="file" accept=".txt,.md,.csv,.json,.xml,.html" onChange={handleFileSelect} />
        </label>

        <label>
          Or paste content directly
          <textarea
            rows={6}
            value={uploadForm.content}
            onChange={(e) => setUploadForm({ ...uploadForm, content: e.target.value })}
            placeholder="Paste document text here..."
          />
        </label>

        <div className="form-actions">
          <button
            className="btn btn-primary"
            onClick={upload}
            disabled={!uploadForm.content.trim() || !uploadForm.title.trim() || uploading}
          >
            {uploading ? "Uploading & Indexing..." : "Upload & Index"}
          </button>
        </div>
      </div>

      {/* Documents list */}
      <div className="card">
        <h4>Indexed Documents</h4>
        {loading ? (
          <p>Loading…</p>
        ) : docs.length === 0 ? (
          <p className="text-muted">No documents uploaded yet. Upload documents above to enable RAG-powered Q&A.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Filename</th>
                <th>Category</th>
                <th>Chunks</th>
                <th>Uploaded</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.filename}>
                  <td>{d.title}</td>
                  <td className="text-mono">{d.filename}</td>
                  <td><span className="category-badge">{d.category}</span></td>
                  <td>{d.chunkCount}</td>
                  <td>{new Date(d.uploadedAt).toLocaleDateString()}</td>
                  <td>
                    <button className="btn btn-xs btn-danger" onClick={() => remove(d.filename)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Query section */}
      <div className="card query-section">
        <h4>🔍 Test Knowledge Base Query</h4>
        <div className="query-input">
          <input
            type="text"
            value={queryText}
            onChange={(e) => setQueryText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && query()}
            placeholder="Ask a question about your uploaded documents..."
          />
          <button className="btn btn-primary" onClick={query} disabled={querying || !queryText.trim()}>
            {querying ? "Searching..." : "Query"}
          </button>
        </div>

        {queryResult && (
          <div className="query-result">
            <p>{queryResult}</p>
          </div>
        )}
      </div>
    </div>
  );
}
