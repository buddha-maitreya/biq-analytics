import React, { useState, useEffect, useMemo } from "react";
import type { AppConfig } from "../types";

interface AdminPageProps {
  config: AppConfig;
  onSaved?: () => void;
}

type AdminTab = "users" | "statuses" | "tax" | "knowledge" | "settings";

/* ---------- Sub-types ---------- */
interface RBACConfig {
  roles: string[];
  roleRank: Record<string, number>;
  allPermissions: string[];
  defaultPerms: Record<string, string[]>;
}

interface Warehouse {
  id: string;
  name: string;
  code: string;
}

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  permissions: string[];
  assignedWarehouses: string[] | null;
  warehouseDetails: Warehouse[];
  allAccess: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

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

interface KBDocument {
  filename: string;
  title: string;
  category: string;
  uploadedAt: string;
  chunkCount: number;
}

// Payment config defaults (for Settings tab)
const PAYMENT_DEFAULTS: Record<string, string> = {
  paystackEnabled: "false",
  paystackPublicKey: "",
  paystackSecretKey: "",
  paystackCurrency: "KES",
  mpesaEnabled: "false",
  mpesaEnvironment: "sandbox",
  mpesaConsumerKey: "",
  mpesaConsumerSecret: "",
  mpesaShortcode: "",
  mpesaPasskey: "",
  mpesaPaymentType: "till",
  mpesaTillNumber: "",
  mpesaPaybillNumber: "",
  mpesaAccountReference: "",
  mpesaCallbackUrl: "",
  kraEnabled: "false",
  kraEnvironment: "sandbox",
  kraClientId: "",
  kraClientSecret: "",
  kraBusinessPin: "",
  kraEtimsDeviceSerial: "",
  kraBranchId: "00",
};

const ROLE_COLORS: Record<string, string> = {
  super_admin: "#7c3aed",
  admin: "#2563eb",
  manager: "#059669",
  staff: "#d97706",
  viewer: "#6b7280",
};

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  manager: "Manager",
  staff: "Staff",
  viewer: "Viewer",
};

const PERM_LABELS: Record<string, { icon: string; label: string; desc: string }> = {
  dashboard: { icon: "📊", label: "Dashboard", desc: "View business overview & charts" },
  products: { icon: "📦", label: "Products", desc: "Manage product catalog" },
  orders: { icon: "🛒", label: "Orders", desc: "Create & manage orders" },
  customers: { icon: "👥", label: "Customers", desc: "View & manage customers" },
  inventory: { icon: "🏭", label: "Inventory", desc: "Stock levels & warehouse ops" },
  invoices: { icon: "📄", label: "Invoices", desc: "Billing & payment tracking" },
  reports: { icon: "📈", label: "Reports", desc: "Generate & download reports" },
  pos: { icon: "💳", label: "POS", desc: "Point-of-Sale interface" },
  assistant: { icon: "🤖", label: "Executive AI Assistant", desc: "AI-powered business intelligence" },
  admin: { icon: "⚙️", label: "Admin", desc: "Admin console access" },
  settings: { icon: "🎨", label: "Settings", desc: "System configuration" },
};

/* =============================== */
export default function AdminPage({ config, onSaved }: AdminPageProps) {
  const [tab, setTab] = useState<AdminTab>("users");

  const tabs: { key: AdminTab; label: string; icon: string }[] = [
    { key: "users", label: "Users & Access", icon: "🔐" },
    { key: "knowledge", label: "Knowledge Base", icon: "🧠" },
    { key: "settings", label: "Settings", icon: "🎨" },
  ];

  return (
    <div className="page admin-page">
      <div className="page-header">
        <h2>⚙️ Admin Console</h2>
        <span className="text-muted">System administration, configuration & intelligence</span>
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
        {tab === "users" && <UsersAccessTab />}
        {tab === "knowledge" && <KnowledgeBaseTab />}
        {tab === "settings" && <SettingsTab config={config} onSaved={onSaved} />}
      </div>
    </div>
  );
}

/* ===== USERS & ACCESS TAB (RBAC) ===== */
function UsersAccessTab() {
  const [users, setUsers] = useState<User[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [rbac, setRbac] = useState<RBACConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [permUser, setPermUser] = useState<User | null>(null);

  const [form, setForm] = useState({
    email: "",
    name: "",
    role: "staff" as string,
    permissions: [] as string[],
    assignedWarehouses: null as string[] | null,
  });

  const load = async () => {
    setLoading(true);
    const [usersRes, rbacRes, whRes] = await Promise.all([
      fetch("/api/admin/users"),
      fetch("/api/admin/rbac-config"),
      fetch("/api/warehouses"),
    ]);
    const usersData = await usersRes.json();
    const rbacData = await rbacRes.json();
    const whData = await whRes.json();
    setUsers(usersData.data ?? []);
    setRbac(rbacData.data ?? null);
    setWarehouses(whData.data ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const roleCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const u of users) counts[u.role] = (counts[u.role] || 0) + 1;
    return counts;
  }, [users]);

  const filtered = useMemo(() => {
    let list = users;
    if (roleFilter) list = list.filter((u) => u.role === roleFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
    }
    return list;
  }, [users, roleFilter, search]);

  const resetForm = () => {
    setForm({ email: "", name: "", role: "staff", permissions: [], assignedWarehouses: null });
    setEditUser(null);
    setShowForm(false);
  };

  const openEdit = (u: User) => {
    setForm({ email: u.email, name: u.name, role: u.role, permissions: u.permissions ?? [], assignedWarehouses: u.assignedWarehouses });
    setEditUser(u);
    setShowForm(true);
  };

  const save = async () => {
    const method = editUser ? "PUT" : "POST";
    const url = editUser ? `/api/admin/users/${editUser.id}` : "/api/admin/users";
    await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    resetForm();
    load();
  };

  const toggleActive = async (u: User) => {
    const action = u.isActive ? "deactivate" : "activate";
    if (u.isActive && !confirm(`Deactivate ${u.name}?`)) return;
    await fetch(`/api/admin/users/${u.id}/${action}`, { method: "POST" });
    load();
  };

  const savePermissions = async () => {
    if (!permUser) return;
    await fetch(`/api/admin/users/${permUser.id}/permissions`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ permissions: form.permissions, assignedWarehouses: form.assignedWarehouses }),
    });
    setPermUser(null);
    load();
  };

  const openPermissions = (u: User) => {
    setForm((f) => ({ ...f, permissions: u.permissions ?? [], assignedWarehouses: u.assignedWarehouses }));
    setPermUser(u);
  };

  const togglePermission = (perm: string) => {
    setForm((f) => ({
      ...f,
      permissions: f.permissions.includes(perm) ? f.permissions.filter((p) => p !== perm) : [...f.permissions, perm],
    }));
  };

  const toggleWarehouse = (whId: string) => {
    setForm((f) => {
      const current = f.assignedWarehouses ?? [];
      const next = current.includes(whId) ? current.filter((id) => id !== whId) : [...current, whId];
      return { ...f, assignedWarehouses: next.length > 0 ? next : null };
    });
  };

  const setAllAccess = (all: boolean) => {
    setForm((f) => ({ ...f, assignedWarehouses: all ? null : [] }));
  };

  if (loading) return <div className="loading-state"><div className="spinner" />Loading users…</div>;

  /* ── Permission Editor Modal ── */
  if (permUser) {
    return (
      <div className="rbac-modal-backdrop">
        <div className="rbac-modal">
          <div className="rbac-modal-header">
            <div>
              <h3>🔑 Manage Access — {permUser.name}</h3>
              <p className="text-muted" style={{ margin: "4px 0 0" }}>
                <span className="role-pill" style={{ background: ROLE_COLORS[permUser.role] }}>{ROLE_LABELS[permUser.role]}</span>
                &nbsp;&nbsp;{permUser.email}
              </p>
            </div>
            <button className="btn btn-secondary btn-xs" onClick={() => setPermUser(null)}>✕</button>
          </div>

          <div className="rbac-section">
            <h4>Module Permissions</h4>
            <p className="text-muted" style={{ fontSize: "0.8rem", margin: "0 0 12px" }}>Select which modules this user can access</p>
            <div className="perm-grid">
              {(rbac?.allPermissions ?? []).map((perm) => {
                const info = PERM_LABELS[perm] ?? { icon: "•", label: perm, desc: "" };
                const checked = form.permissions.includes(perm);
                return (
                  <label key={perm} className={`perm-card ${checked ? "perm-card-active" : ""}`}>
                    <input type="checkbox" checked={checked} onChange={() => togglePermission(perm)} />
                    <span className="perm-card-icon">{info.icon}</span>
                    <span className="perm-card-label">{info.label}</span>
                    <span className="perm-card-desc">{info.desc}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="rbac-section">
            <h4>Warehouse / Branch Access</h4>
            <p className="text-muted" style={{ fontSize: "0.8rem", margin: "0 0 12px" }}>Control which locations this user can work with</p>
            <label className="perm-card perm-card-wide" style={{ marginBottom: 8 }}>
              <input type="checkbox" checked={!form.assignedWarehouses || form.assignedWarehouses.length === 0} onChange={(e) => setAllAccess(e.target.checked)} />
              <span className="perm-card-icon">🌐</span>
              <span className="perm-card-label">All Warehouses</span>
              <span className="perm-card-desc">Full access to every location</span>
            </label>
            {form.assignedWarehouses !== null && (
              <div className="wh-grid">
                {warehouses.map((wh) => {
                  const checked = (form.assignedWarehouses ?? []).includes(wh.id);
                  return (
                    <label key={wh.id} className={`perm-card ${checked ? "perm-card-active" : ""}`}>
                      <input type="checkbox" checked={checked} onChange={() => toggleWarehouse(wh.id)} />
                      <span className="perm-card-icon">🏭</span>
                      <span className="perm-card-label">{wh.name}</span>
                      <span className="perm-card-desc">{wh.code}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <div className="rbac-modal-footer">
            <button className="btn btn-secondary" onClick={() => setPermUser(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={savePermissions}>Save Permissions</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Role summary strip */}
      <div className="summary-strip">
        <button className={`summary-chip ${!roleFilter ? "active" : ""}`} onClick={() => setRoleFilter(null)}>
          <span className="chip-count">{users.length}</span>
          <span className="chip-label">All Users</span>
        </button>
        {(rbac?.roles ?? []).map((role) => (
          <button key={role} className={`summary-chip ${roleFilter === role ? "active" : ""}`} onClick={() => setRoleFilter(roleFilter === role ? null : role)}>
            <span className="chip-dot" style={{ background: ROLE_COLORS[role] }} />
            <span className="chip-count">{roleCounts[role] || 0}</span>
            <span className="chip-label">{ROLE_LABELS[role] ?? role}</span>
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="toolbar">
        <div className="search-box">
          <span className="search-icon">🔍</span>
          <input placeholder="Search users…" value={search} onChange={(e) => setSearch(e.target.value)} />
          {search && <button className="search-clear" onClick={() => setSearch("")}>✕</button>}
        </div>
        <span className="toolbar-count">{filtered.length} user{filtered.length !== 1 ? "s" : ""}</span>
        <button className="btn btn-primary btn-sm" onClick={() => { resetForm(); setShowForm(true); }}>+ Invite User</button>
      </div>

      {/* Create/Edit Form */}
      {showForm && (
        <div className="card user-form-card" style={{ marginBottom: 16 }}>
          <h4 style={{ marginBottom: 12 }}>{editUser ? `Edit — ${editUser.name}` : "Invite New User"}</h4>
          <div className="form-grid cols-4">
            <label>
              <span className="form-label">Email</span>
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="user@company.com" />
            </label>
            <label>
              <span className="form-label">Full Name</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Jane Doe" />
            </label>
            <label>
              <span className="form-label">Role</span>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {(rbac?.roles ?? []).map((r) => (
                  <option key={r} value={r}>{ROLE_LABELS[r] ?? r}</option>
                ))}
              </select>
            </label>
            <div className="form-actions" style={{ alignSelf: "end" }}>
              <button className="btn btn-primary" onClick={save}>{editUser ? "Update" : "Create"}</button>
              <button className="btn btn-secondary" onClick={resetForm}>Cancel</button>
            </div>
          </div>
          {!editUser && (
            <p className="form-hint" style={{ marginTop: 8 }}>Default permissions for the selected role will be applied. Customize after creation.</p>
          )}
        </div>
      )}

      {/* Users Table */}
      <div className="card table-card">
        <table className="data-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Role</th>
              <th>Permissions</th>
              <th>Warehouses</th>
              <th>Status</th>
              <th style={{ textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => (
              <tr key={u.id} className={u.isActive ? "" : "row-inactive"}>
                <td>
                  <div className="cell-main">{u.name}</div>
                  <div className="cell-sub">{u.email}</div>
                </td>
                <td>
                  <span className="role-pill" style={{ background: ROLE_COLORS[u.role] }}>{ROLE_LABELS[u.role] ?? u.role}</span>
                </td>
                <td>
                  <div className="perm-tags">
                    {(u.permissions ?? []).slice(0, 4).map((p) => (
                      <span key={p} className="perm-tag">{PERM_LABELS[p]?.icon ?? "•"} {PERM_LABELS[p]?.label ?? p}</span>
                    ))}
                    {(u.permissions ?? []).length > 4 && (
                      <span className="perm-tag perm-tag-more">+{(u.permissions ?? []).length - 4}</span>
                    )}
                  </div>
                </td>
                <td>
                  {u.allAccess ? (
                    <span className="wh-badge wh-badge-all">🌐 All</span>
                  ) : (
                    <div className="wh-tags">
                      {(u.warehouseDetails ?? []).slice(0, 2).map((w) => (
                        <span key={w.id} className="wh-badge">{w.name}</span>
                      ))}
                      {(u.warehouseDetails ?? []).length > 2 && (
                        <span className="wh-badge">+{(u.warehouseDetails ?? []).length - 2}</span>
                      )}
                    </div>
                  )}
                </td>
                <td>
                  <span className={`status-badge ${u.isActive ? "status-active" : "status-inactive"}`}>
                    {u.isActive ? "Active" : "Inactive"}
                  </span>
                </td>
                <td>
                  <div className="action-cell">
                    <button className="btn btn-xs btn-secondary" onClick={() => openPermissions(u)}>🔑 Permissions</button>
                    <button className="btn btn-xs btn-secondary" onClick={() => openEdit(u)}>Edit</button>
                    <button className={`btn btn-xs ${u.isActive ? "btn-warning" : "btn-primary"}`} onClick={() => toggleActive(u)}>
                      {u.isActive ? "Deactivate" : "Activate"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="text-center text-muted">No users match</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* RBAC Legend */}
      <div className="rbac-legend">
        <h4>Role Hierarchy</h4>
        <div className="rbac-hierarchy">
          {(rbac?.roles ?? []).slice().reverse().map((role, i, arr) => (
            <div key={role} className="rbac-rank">
              <span className="rbac-rank-badge" style={{ background: ROLE_COLORS[role] }}>{ROLE_LABELS[role]}</span>
              <span className="rbac-rank-desc">
                {role === "super_admin" && "Full control. Manages admins & all warehouse access."}
                {role === "admin" && "Manages staff permissions & warehouse assignments."}
                {role === "manager" && "Operational access with assigned permissions."}
                {role === "staff" && "POS & limited access. Permissions set by admin."}
                {role === "viewer" && "Read-only dashboard access."}
              </span>
              {i < arr.length - 1 && <span className="rbac-rank-arrow">↑ manages ↓</span>}
            </div>
          ))}
        </div>
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

/* ===== KNOWLEDGE BASE TAB (Enhanced) ===== */
function KnowledgeBaseTab() {
  const [docs, setDocs] = useState<KBDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [activeAction, setActiveAction] = useState<"upload" | "url" | "text" | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Upload form
  const [uploadForm, setUploadForm] = useState({
    title: "",
    filename: "",
    category: "general",
    content: "",
    url: "",
  });

  // KB Settings
  const [kbSettings, setKbSettings] = useState({
    elevenLabsAgentId: "",
    elevenLabsApiKey: "",
    chunkSize: "512",
    topKResults: "5",
  });
  const [savingKb, setSavingKb] = useState(false);

  // Query
  const [queryText, setQueryText] = useState("");
  const [queryResult, setQueryResult] = useState<string | null>(null);
  const [querying, setQuerying] = useState(false);

  const load = async () => {
    setLoading(true);
    const [docsRes, settingsRes] = await Promise.all([
      fetch("/api/admin/documents"),
      fetch("/api/settings"),
    ]);
    const docsData = await docsRes.json();
    setDocs(docsData.data ?? []);
    try {
      const settingsData = await settingsRes.json();
      if (settingsData.data) {
        setKbSettings((prev) => ({
          ...prev,
          elevenLabsAgentId: settingsData.data.elevenLabsAgentId || "",
          elevenLabsApiKey: settingsData.data.elevenLabsApiKey || "",
          chunkSize: settingsData.data.kbChunkSize || "512",
          topKResults: settingsData.data.kbTopK || "5",
        }));
      }
    } catch { /* use defaults */ }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const flash = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  };

  const resetForm = () => {
    setUploadForm({ title: "", filename: "", category: "general", content: "", url: "" });
    setActiveAction(null);
  };

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
      flash("success", `"${uploadForm.title}" uploaded and indexed successfully.`);
      resetForm();
      load();
    } catch {
      flash("error", "Failed to upload document.");
    } finally {
      setUploading(false);
    }
  };

  const addUrl = async () => {
    if (!uploadForm.url.trim() || !uploadForm.title.trim()) return;
    setUploading(true);
    try {
      const res = await fetch("/api/admin/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: uploadForm.title,
          filename: uploadForm.url.replace(/[^a-zA-Z0-9.-]/g, "_").slice(0, 60) + ".url",
          category: uploadForm.category,
          content: `[URL Source: ${uploadForm.url}]\n\nContent fetched from URL.`,
          sourceUrl: uploadForm.url,
        }),
      });
      if (!res.ok) throw new Error("URL add failed");
      flash("success", "URL added and indexed.");
      resetForm();
      load();
    } catch {
      flash("error", "Failed to add URL.");
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

  const handleReindex = async () => {
    if (!confirm("Re-index all documents? This may take a moment.")) return;
    flash("success", "Re-indexing started…");
    try {
      await fetch("/api/admin/documents/reindex", { method: "POST" });
      flash("success", "Re-indexing complete.");
      load();
    } catch {
      flash("error", "Re-index failed.");
    }
  };

  const remove = async (filename: string) => {
    if (!confirm(`Remove "${filename}" from knowledge base?`)) return;
    await fetch(`/api/admin/documents/${encodeURIComponent(filename)}`, { method: "DELETE" });
    load();
  };

  const saveKbSettings = async () => {
    setSavingKb(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          elevenLabsAgentId: kbSettings.elevenLabsAgentId,
          elevenLabsApiKey: kbSettings.elevenLabsApiKey,
          kbChunkSize: kbSettings.chunkSize,
          kbTopK: kbSettings.topKResults,
        }),
      });
      flash(res.ok ? "success" : "error", res.ok ? "KB settings saved." : "Failed to save.");
    } catch {
      flash("error", "Network error saving settings.");
    } finally {
      setSavingKb(false);
    }
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

  if (loading) return <div className="loading-state"><div className="spinner" />Loading knowledge base…</div>;

  return (
    <div>
      {message && (
        <div className={`alert alert-${message.type}`} style={{ marginBottom: 16 }}>
          {message.type === "success" ? "✅" : "❌"} {message.text}
        </div>
      )}

      {/* ── Quick Actions ── */}
      <div className="kb-quick-actions">
        <button
          className={`kb-action-card ${activeAction === "upload" ? "kb-action-active" : ""}`}
          onClick={() => setActiveAction(activeAction === "upload" ? null : "upload")}
        >
          <span className="kb-action-icon">📤</span>
          <span className="kb-action-title">Upload Document</span>
          <span className="kb-action-desc">PDF, TXT, MD, CSV files</span>
        </button>
        <button
          className={`kb-action-card ${activeAction === "url" ? "kb-action-active" : ""}`}
          onClick={() => setActiveAction(activeAction === "url" ? null : "url")}
        >
          <span className="kb-action-icon">🔗</span>
          <span className="kb-action-title">Add URL</span>
          <span className="kb-action-desc">Index a webpage</span>
        </button>
        <button
          className={`kb-action-card ${activeAction === "text" ? "kb-action-active" : ""}`}
          onClick={() => setActiveAction(activeAction === "text" ? null : "text")}
        >
          <span className="kb-action-icon">📝</span>
          <span className="kb-action-title">Add Text Content</span>
          <span className="kb-action-desc">Paste raw text</span>
        </button>
        <button className="kb-action-card" onClick={handleReindex}>
          <span className="kb-action-icon">🔄</span>
          <span className="kb-action-title">Re-index All</span>
          <span className="kb-action-desc">Rebuild search index</span>
        </button>
      </div>

      {/* ── Action Form ── */}
      {activeAction && (
        <div className="card kb-form-card">
          <h4 style={{ marginBottom: 12 }}>
            {activeAction === "upload" && "📤 Upload Document"}
            {activeAction === "url" && "🔗 Add URL Source"}
            {activeAction === "text" && "📝 Add Text Content"}
          </h4>
          <div className="form-grid cols-2">
            <label>
              <span className="form-label">Title</span>
              <input
                value={uploadForm.title}
                onChange={(e) => setUploadForm({ ...uploadForm, title: e.target.value })}
                placeholder="Document title"
              />
            </label>
            <label>
              <span className="form-label">Category</span>
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

          {activeAction === "upload" && (
            <>
              <label style={{ marginTop: 12 }}>
                <span className="form-label">Select File</span>
                <input type="file" accept=".txt,.md,.csv,.json,.xml,.html,.pdf,.doc,.docx" onChange={handleFileSelect} />
              </label>
              {uploadForm.content && (
                <p className="form-hint" style={{ marginTop: 4 }}>✅ {uploadForm.filename} loaded — {uploadForm.content.length.toLocaleString()} characters</p>
              )}
            </>
          )}

          {activeAction === "url" && (
            <label style={{ marginTop: 12 }}>
              <span className="form-label">URL</span>
              <input
                type="url"
                value={uploadForm.url}
                onChange={(e) => setUploadForm({ ...uploadForm, url: e.target.value })}
                placeholder="https://example.com/page"
              />
            </label>
          )}

          {activeAction === "text" && (
            <label style={{ marginTop: 12 }}>
              <span className="form-label">Content</span>
              <textarea
                rows={5}
                value={uploadForm.content}
                onChange={(e) => setUploadForm({ ...uploadForm, content: e.target.value })}
                placeholder="Paste document text here…"
              />
            </label>
          )}

          <div className="form-actions" style={{ marginTop: 12 }}>
            <button
              className="btn btn-primary"
              onClick={activeAction === "url" ? addUrl : upload}
              disabled={uploading || (!uploadForm.title.trim()) || (activeAction === "url" ? !uploadForm.url.trim() : !uploadForm.content.trim())}
            >
              {uploading ? "Processing…" : activeAction === "url" ? "Add & Index" : "Upload & Index"}
            </button>
            <button className="btn btn-secondary" onClick={resetForm}>Cancel</button>
          </div>
        </div>
      )}

      {/* ── Indexed Documents ── */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="section-header" style={{ marginBottom: 12 }}>
          <h4>📚 Indexed Documents</h4>
          <span className="badge">{docs.length} document{docs.length !== 1 ? "s" : ""}</span>
        </div>
        {docs.length === 0 ? (
          <p className="text-muted">No documents yet. Use Quick Actions above to add content to your knowledge base.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Category</th>
                <th>Chunks</th>
                <th>Uploaded</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.filename}>
                  <td>
                    <div className="cell-main">{d.title}</div>
                    <div className="cell-sub">{d.filename}</div>
                  </td>
                  <td><span className="category-badge">{d.category}</span></td>
                  <td>{d.chunkCount}</td>
                  <td>{new Date(d.uploadedAt).toLocaleDateString()}</td>
                  <td style={{ textAlign: "right" }}>
                    <button className="btn btn-xs btn-danger" onClick={() => remove(d.filename)}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Query Test ── */}
      <div className="card" style={{ marginTop: 16 }}>
        <h4>🔍 Test Knowledge Base</h4>
        <p className="text-muted" style={{ fontSize: "0.8rem", marginBottom: 12 }}>Ask a question to test your indexed documents</p>
        <div className="query-input">
          <input
            type="text"
            value={queryText}
            onChange={(e) => setQueryText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && query()}
            placeholder="Ask a question about your documents…"
          />
          <button className="btn btn-primary" onClick={query} disabled={querying || !queryText.trim()}>
            {querying ? "Searching…" : "Query"}
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

/* ===== SETTINGS TAB (merged from SettingsPage) ===== */
function SettingsTab({ config, onSaved }: { config: AppConfig; onSaved?: () => void }) {
  const [settings, setSettings] = useState<Record<string, string>>({
    businessName: "",
    businessLogoUrl: "",
    businessTagline: "",
    primaryColor: "#3b82f6",
    ...PAYMENT_DEFAULTS,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [section, setSection] = useState<"business" | "payments" | "tax">("business");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/settings");
        const json = await res.json();
        if (json.data) {
          setSettings((prev) => ({
            ...prev,
            businessName: json.data.businessName || "",
            businessLogoUrl: json.data.businessLogoUrl || "",
            businessTagline: json.data.businessTagline || "",
            primaryColor: json.data.primaryColor || "#3b82f6",
            ...Object.fromEntries(
              Object.keys(PAYMENT_DEFAULTS).map((k) => [k, json.data[k] ?? PAYMENT_DEFAULTS[k]])
            ),
          }));
        }
      } catch { /* use defaults */ }
      setLoading(false);
    })();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (res.ok) {
        setMessage({ type: "success", text: "Settings saved!" });
        onSaved?.();
      } else {
        setMessage({ type: "error", text: "Failed to save." });
      }
    } catch {
      setMessage({ type: "error", text: "Network error." });
    }
    setSaving(false);
  };

  if (loading) return <div className="loading-state"><div className="spinner" />Loading settings…</div>;

  const upd = (key: string, val: string) => setSettings((p) => ({ ...p, [key]: val }));

  return (
    <div>
      {message && (
        <div className={`alert alert-${message.type}`} style={{ marginBottom: 16 }}>
          {message.type === "success" ? "✅" : "❌"} {message.text}
        </div>
      )}

      {/* Sub-tabs */}
      <div className="settings-sub-tabs">
        <button className={`sub-tab ${section === "business" ? "active" : ""}`} onClick={() => setSection("business")}>
          🏢 Business Identity
        </button>
        <button className={`sub-tab ${section === "payments" ? "active" : ""}`} onClick={() => setSection("payments")}>
          💳 Payment Providers
        </button>
        <button className={`sub-tab ${section === "tax" ? "active" : ""}`} onClick={() => setSection("tax")}>
          🏛️ Tax & Compliance
        </button>
      </div>

      {/* ── Business Identity ── */}
      {section === "business" && (
        <div className="settings-grid">
          <div className="card settings-card">
            <h4>🏢 Business Identity</h4>
            <p className="text-muted" style={{ marginBottom: 16, fontSize: "0.8rem" }}>Appears in the sidebar and throughout the app.</p>
            <div className="form-grid" style={{ gap: 12 }}>
              <label>
                <span className="form-label">Business Name</span>
                <input type="text" placeholder="e.g. Safari Adventures Kenya" value={settings.businessName} onChange={(e) => upd("businessName", e.target.value)} />
              </label>
              <label>
                <span className="form-label">Tagline</span>
                <input type="text" placeholder="e.g. Your Gateway to African Wildlife" value={settings.businessTagline} onChange={(e) => upd("businessTagline", e.target.value)} />
              </label>
              <label>
                <span className="form-label">Logo URL</span>
                <input type="text" placeholder="https://example.com/logo.png" value={settings.businessLogoUrl} onChange={(e) => upd("businessLogoUrl", e.target.value)} />
              </label>
              <label>
                <span className="form-label">Primary Color</span>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input type="color" value={settings.primaryColor} onChange={(e) => upd("primaryColor", e.target.value)} style={{ width: 48, height: 36, padding: 2, cursor: "pointer" }} />
                  <input type="text" value={settings.primaryColor} onChange={(e) => upd("primaryColor", e.target.value)} style={{ width: 120 }} />
                </div>
              </label>
            </div>

            {/* Preview */}
            <div className="settings-preview" style={{ marginTop: 16 }}>
              <span className="preview-label">Preview</span>
              <div className="preview-sidebar">
                {settings.businessLogoUrl && (
                  <img src={settings.businessLogoUrl} alt="" className="preview-logo" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                )}
                <div className="preview-text">
                  <strong>{settings.businessName || "Business IQ"}</strong>
                  {settings.businessTagline && <span className="preview-tagline">{settings.businessTagline}</span>}
                </div>
                <span className="preview-powered">Powered by Business IQ</span>
              </div>
            </div>
          </div>


        </div>
      )}

      {/* ── Payment Providers ── */}
      {section === "payments" && (
        <div className="settings-grid">
          {/* Paystack */}
          <div className="card settings-card payment-card">
            <div className="payment-card-header">
              <div>
                <h4>💳 Paystack — Card Payments</h4>
                <p className="text-muted" style={{ fontSize: "0.8rem" }}>Accept Visa, Mastercard, and bank payments via Paystack</p>
              </div>
              <label className="toggle-switch">
                <input type="checkbox" checked={settings.paystackEnabled === "true"} onChange={(e) => upd("paystackEnabled", e.target.checked ? "true" : "false")} />
                <span className="toggle-slider" />
                <span className="toggle-label">{settings.paystackEnabled === "true" ? "On" : "Off"}</span>
              </label>
            </div>
            {settings.paystackEnabled === "true" && (
              <div className="payment-fields">
                <div className="form-field"><label>Public Key</label><input type="text" placeholder="pk_live_xxxx" value={settings.paystackPublicKey} onChange={(e) => upd("paystackPublicKey", e.target.value)} /></div>
                <div className="form-field"><label>Secret Key</label><input type="password" placeholder="sk_live_xxxx" value={settings.paystackSecretKey} onChange={(e) => upd("paystackSecretKey", e.target.value)} /></div>
                <div className="form-field"><label>Currency</label>
                  <select value={settings.paystackCurrency} onChange={(e) => upd("paystackCurrency", e.target.value)}>
                    <option value="KES">KES</option><option value="NGN">NGN</option><option value="GHS">GHS</option><option value="ZAR">ZAR</option><option value="USD">USD</option>
                  </select>
                </div>
                <div className="payment-status-bar">
                  {settings.paystackPublicKey && settings.paystackSecretKey
                    ? <span className="status-pill" style={{ background: "#dcfce7", color: "#166534" }}>✅ Keys configured</span>
                    : <span className="status-pill" style={{ background: "#fef3c7", color: "#92400e" }}>⚠️ Enter both keys</span>
                  }
                </div>
              </div>
            )}
          </div>

          {/* M-Pesa */}
          <div className="card settings-card payment-card">
            <div className="payment-card-header">
              <div>
                <h4>📱 M-Pesa — Mobile Money</h4>
                <p className="text-muted" style={{ fontSize: "0.8rem" }}>Safaricom Daraja API (STK Push, Till, Paybill)</p>
              </div>
              <label className="toggle-switch">
                <input type="checkbox" checked={settings.mpesaEnabled === "true"} onChange={(e) => upd("mpesaEnabled", e.target.checked ? "true" : "false")} />
                <span className="toggle-slider" />
                <span className="toggle-label">{settings.mpesaEnabled === "true" ? "On" : "Off"}</span>
              </label>
            </div>
            {settings.mpesaEnabled === "true" && (
              <div className="payment-fields">
                <div className="form-field">
                  <label>Environment</label>
                  <div className="env-toggle">
                    <button className={`env-btn ${settings.mpesaEnvironment === "sandbox" ? "active" : ""}`} onClick={() => upd("mpesaEnvironment", "sandbox")}>🧪 Sandbox</button>
                    <button className={`env-btn ${settings.mpesaEnvironment === "production" ? "active" : ""}`} onClick={() => upd("mpesaEnvironment", "production")}>🚀 Production</button>
                  </div>
                </div>
                <div className="payment-subsection">
                  <h5>🔑 API Credentials</h5>
                  <div className="form-field"><label>Consumer Key</label><input type="text" placeholder="From Daraja portal" value={settings.mpesaConsumerKey} onChange={(e) => upd("mpesaConsumerKey", e.target.value)} /></div>
                  <div className="form-field"><label>Consumer Secret</label><input type="password" placeholder="From Daraja portal" value={settings.mpesaConsumerSecret} onChange={(e) => upd("mpesaConsumerSecret", e.target.value)} /></div>
                  <div className="form-field"><label>Business Shortcode</label><input type="text" placeholder="e.g. 174379" value={settings.mpesaShortcode} onChange={(e) => upd("mpesaShortcode", e.target.value)} /></div>
                  <div className="form-field"><label>Passkey</label><input type="password" placeholder="Lipa Na M-Pesa passkey" value={settings.mpesaPasskey} onChange={(e) => upd("mpesaPasskey", e.target.value)} /></div>
                </div>
                <div className="payment-subsection">
                  <h5>💰 Payment Type</h5>
                  <div className="payment-type-grid">
                    <button
                      className={`payment-type-card ${settings.mpesaPaymentType === "till" || settings.mpesaPaymentType === "both" ? "active" : ""}`}
                      onClick={() => upd("mpesaPaymentType", settings.mpesaPaymentType === "both" ? "paybill" : settings.mpesaPaymentType === "till" ? "both" : "till")}
                    >
                      <span className="payment-type-icon">🏪</span>
                      <span className="payment-type-title">Buy Goods (Till)</span>
                    </button>
                    <button
                      className={`payment-type-card ${settings.mpesaPaymentType === "paybill" || settings.mpesaPaymentType === "both" ? "active" : ""}`}
                      onClick={() => upd("mpesaPaymentType", settings.mpesaPaymentType === "both" ? "till" : settings.mpesaPaymentType === "paybill" ? "both" : "paybill")}
                    >
                      <span className="payment-type-icon">🏦</span>
                      <span className="payment-type-title">Paybill</span>
                    </button>
                  </div>
                </div>
                {(settings.mpesaPaymentType === "till" || settings.mpesaPaymentType === "both") && (
                  <div className="form-field"><label>Till Number</label><input type="text" placeholder="e.g. 5001234" value={settings.mpesaTillNumber} onChange={(e) => upd("mpesaTillNumber", e.target.value)} /></div>
                )}
                {(settings.mpesaPaymentType === "paybill" || settings.mpesaPaymentType === "both") && (
                  <>
                    <div className="form-field"><label>Paybill Number</label><input type="text" placeholder="e.g. 888880" value={settings.mpesaPaybillNumber} onChange={(e) => upd("mpesaPaybillNumber", e.target.value)} /></div>
                    <div className="form-field"><label>Account Reference</label><input type="text" placeholder="e.g. INV001" value={settings.mpesaAccountReference} onChange={(e) => upd("mpesaAccountReference", e.target.value)} /></div>
                  </>
                )}
                <div className="form-field"><label>Callback URL</label><input type="text" placeholder="https://your-app.agentuity.run/api/payments/mpesa/callback" value={settings.mpesaCallbackUrl} onChange={(e) => upd("mpesaCallbackUrl", e.target.value)} /></div>
                <div className="payment-status-bar">
                  {settings.mpesaConsumerKey && settings.mpesaConsumerSecret && settings.mpesaShortcode
                    ? <span className="status-pill" style={{ background: "#dcfce7", color: "#166534" }}>✅ Configured</span>
                    : <span className="status-pill" style={{ background: "#fef3c7", color: "#92400e" }}>⚠️ Enter credentials</span>
                  }
                  <span className="status-pill" style={{ background: settings.mpesaEnvironment === "production" ? "#fef3c7" : "#e0e7ff", color: settings.mpesaEnvironment === "production" ? "#92400e" : "#3730a3" }}>
                    {settings.mpesaEnvironment === "production" ? "🚀 Live" : "🧪 Sandbox"}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Tax & Compliance ── */}
      {section === "tax" && (
        <div className="settings-grid">
          <div className="card settings-card payment-card">
            <div className="payment-card-header">
              <div>
                <h4>🏛️ KRA eTIMS — Tax Compliance</h4>
                <p className="text-muted" style={{ fontSize: "0.8rem" }}>Kenya Revenue Authority electronic Tax Invoice Management</p>
              </div>
              <label className="toggle-switch">
                <input type="checkbox" checked={settings.kraEnabled === "true"} onChange={(e) => upd("kraEnabled", e.target.checked ? "true" : "false")} />
                <span className="toggle-slider" />
                <span className="toggle-label">{settings.kraEnabled === "true" ? "On" : "Off"}</span>
              </label>
            </div>
            {settings.kraEnabled === "true" && (
              <div className="payment-fields">
                <div className="form-field">
                  <label>Environment</label>
                  <div className="env-toggle">
                    <button className={`env-btn ${settings.kraEnvironment === "sandbox" ? "active" : ""}`} onClick={() => upd("kraEnvironment", "sandbox")}>🧪 Sandbox</button>
                    <button className={`env-btn ${settings.kraEnvironment === "production" ? "active" : ""}`} onClick={() => upd("kraEnvironment", "production")}>🚀 Production</button>
                  </div>
                </div>
                <div className="payment-subsection">
                  <h5>🔑 API Credentials</h5>
                  <div className="form-field"><label>Client ID</label><input type="text" placeholder="From KRA eTIMS portal" value={settings.kraClientId} onChange={(e) => upd("kraClientId", e.target.value)} /></div>
                  <div className="form-field"><label>Client Secret</label><input type="password" placeholder="From KRA eTIMS portal" value={settings.kraClientSecret} onChange={(e) => upd("kraClientSecret", e.target.value)} /></div>
                </div>
                <div className="payment-subsection">
                  <h5>🏢 Business Details</h5>
                  <div className="form-field"><label>KRA PIN</label><input type="text" placeholder="e.g. A123456789B" value={settings.kraBusinessPin} onChange={(e) => upd("kraBusinessPin", e.target.value)} /></div>
                  <div className="form-field"><label>Device Serial (cmcKey)</label><input type="text" placeholder="e.g. KRAICD000000001" value={settings.kraEtimsDeviceSerial} onChange={(e) => upd("kraEtimsDeviceSerial", e.target.value)} /></div>
                  <div className="form-field"><label>Branch ID</label><input type="text" placeholder="00" value={settings.kraBranchId} onChange={(e) => upd("kraBranchId", e.target.value)} /></div>
                </div>
                <div className="payment-status-bar">
                  {settings.kraClientId && settings.kraClientSecret && settings.kraBusinessPin
                    ? <span className="status-pill" style={{ background: "#dcfce7", color: "#166534" }}>✅ Configured</span>
                    : <span className="status-pill" style={{ background: "#fef3c7", color: "#92400e" }}>⚠️ Enter credentials</span>
                  }
                  <span className="status-pill" style={{ background: settings.kraEnvironment === "production" ? "#fef3c7" : "#e0e7ff", color: settings.kraEnvironment === "production" ? "#92400e" : "#3730a3" }}>
                    {settings.kraEnvironment === "production" ? "🚀 Live" : "🧪 Sandbox"}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <button className="btn btn-primary btn-lg" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "💾 Save All Settings"}
        </button>
      </div>
    </div>
  );
}
