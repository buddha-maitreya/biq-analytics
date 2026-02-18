import React, { useState, useEffect, useMemo } from "react";
import type { AppConfig } from "../types";

interface AdminPageProps {
  config: AppConfig;
  onSaved?: () => void;
}

type AdminTab = "users" | "statuses" | "tax" | "knowledge" | "settings" | "ai" | "tools" | "model" | "agents";

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
  const [tab, setTab] = useState<AdminTab>("knowledge");

  const tabs: { key: AdminTab; label: string; icon: string }[] = [
    { key: "knowledge", label: "Knowledge Base", icon: "🧠" },
    { key: "model", label: "AI Model", icon: "🤖" },
    { key: "ai", label: "Prompt Engineering", icon: "✍️" },
    { key: "tools", label: "Custom Tools", icon: "🧩" },
    { key: "agents", label: "AI Agents", icon: "🧬" },
    { key: "users", label: "Users & Access", icon: "🔐" },
    { key: "settings", label: "Profile", icon: "🏢" },
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
        {tab === "model" && <AIModelTab onSaved={onSaved} />}
        {tab === "ai" && <AIConfigTab config={config} onSaved={onSaved} />}
        {tab === "tools" && <CustomToolsTab />}
        {tab === "agents" && <AIAgentsTab />}
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

/* ===== AI MODEL TAB ===== */

const AI_PROVIDERS = [
  {
    id: "openai",
    name: "OpenAI",
    icon: "🟢",
    models: [
      { id: "gpt-4o", name: "GPT-4o", desc: "Most capable — vision, reasoning, tools" },
      { id: "gpt-4o-mini", name: "GPT-4o Mini", desc: "Fast & cost-effective" },
      { id: "gpt-4.1", name: "GPT-4.1", desc: "Latest flagship model" },
      { id: "gpt-4.1-mini", name: "GPT-4.1 Mini", desc: "Balanced performance" },
      { id: "gpt-4.1-nano", name: "GPT-4.1 Nano", desc: "Fastest, lowest cost" },
      { id: "o3-mini", name: "o3-mini", desc: "Advanced reasoning" },
    ],
    keyPlaceholder: "sk-...",
    keyPrefix: "sk-",
    docsUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    icon: "🟤",
    models: [
      { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4", desc: "Best balance of speed & intelligence" },
      { id: "claude-opus-4-20250514", name: "Claude Opus 4", desc: "Most capable" },
      { id: "claude-3-5-haiku-20241022", name: "Claude 3.5 Haiku", desc: "Fastest, lowest cost" },
    ],
    keyPlaceholder: "sk-ant-...",
    keyPrefix: "sk-ant-",
    docsUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "groq",
    name: "Groq",
    icon: "⚡",
    models: [
      { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B", desc: "High quality, fast inference" },
      { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B", desc: "Ultra-fast, lightweight" },
      { id: "mixtral-8x7b-32768", name: "Mixtral 8x7B", desc: "Strong open-source MoE" },
      { id: "gemma2-9b-it", name: "Gemma 2 9B", desc: "Google's open model on Groq" },
    ],
    keyPlaceholder: "gsk_...",
    keyPrefix: "gsk_",
    docsUrl: "https://console.groq.com/keys",
  },
];

function AIModelTab({ onSaved }: { onSaved?: () => void }) {
  const [provider, setProvider] = useState("openai");
  const [model, setModel] = useState("gpt-4o-mini");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const providerConfig = AI_PROVIDERS.find((p) => p.id === provider) ?? AI_PROVIDERS[0];

  // Load saved settings
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/settings");
        const json = await res.json();
        if (json.data) {
          if (json.data.aiModelProvider) setProvider(json.data.aiModelProvider);
          if (json.data.aiModelName) setModel(json.data.aiModelName);
          if (json.data.aiModelApiKey) setApiKey(json.data.aiModelApiKey);
        }
      } catch { /* use defaults */ }
      setLoading(false);
    })();
  }, []);

  // When provider changes, reset model to first of that provider
  const handleProviderChange = (newProvider: string) => {
    setProvider(newProvider);
    const prov = AI_PROVIDERS.find((p) => p.id === newProvider);
    if (prov && prov.models.length > 0) {
      setModel(prov.models[0].id);
    }
    setTestResult(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          aiModelProvider: provider,
          aiModelName: model,
          aiModelApiKey: apiKey,
        }),
      });
      if (res.ok) {
        setMessage({ type: "success", text: "AI model configuration saved!" });
        onSaved?.();
      } else {
        setMessage({ type: "error", text: "Failed to save." });
      }
    } catch {
      setMessage({ type: "error", text: "Network error." });
    }
    setSaving(false);
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/settings/test-model", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          model,
          apiKey,
        }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setTestResult({ ok: true, text: json.message || "Connection successful!" });
      } else {
        setTestResult({ ok: false, text: json.error || "Connection failed." });
      }
    } catch {
      setTestResult({ ok: false, text: "Network error — could not reach server." });
    }
    setTesting(false);
  };

  if (loading) return <div className="loading-state"><div className="spinner" />Loading AI model config…</div>;

  const selectedModel = providerConfig.models.find((m) => m.id === model);

  return (
    <div>
      {message && (
        <div className={`alert alert-${message.type}`} style={{ marginBottom: 16 }}>
          {message.type === "success" ? "✅" : "❌"} {message.text}
        </div>
      )}

      {/* Provider Selection */}
      <div className="settings-grid">
        <div className="card settings-card">
          <h4>🏢 AI Provider</h4>
          <p className="text-muted" style={{ marginBottom: 16, fontSize: "0.8rem" }}>
            Select which AI provider powers your business assistant.
          </p>
          <div className="ai-provider-grid">
            {AI_PROVIDERS.map((p) => (
              <button
                key={p.id}
                className={`ai-provider-card ${provider === p.id ? "active" : ""}`}
                onClick={() => handleProviderChange(p.id)}
              >
                <span className="ai-provider-icon">{p.icon}</span>
                <span className="ai-provider-name">{p.name}</span>
                <span className="ai-provider-models">{p.models.length} models</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Model Selection */}
      <div className="settings-grid" style={{ marginTop: 16 }}>
        <div className="card settings-card">
          <h4>🧠 Model</h4>
          <p className="text-muted" style={{ marginBottom: 16, fontSize: "0.8rem" }}>
            Choose the specific model for {providerConfig.name}. Higher-end models are more capable but cost more per request.
          </p>
          <div className="ai-model-grid">
            {providerConfig.models.map((m) => (
              <button
                key={m.id}
                className={`ai-model-card ${model === m.id ? "active" : ""}`}
                onClick={() => { setModel(m.id); setTestResult(null); }}
              >
                <span className="ai-model-name">{m.name}</span>
                <span className="ai-model-desc">{m.desc}</span>
                <code className="ai-model-id">{m.id}</code>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* API Key */}
      <div className="settings-grid" style={{ marginTop: 16 }}>
        <div className="card settings-card">
          <h4>🔑 API Key</h4>
          <p className="text-muted" style={{ marginBottom: 16, fontSize: "0.8rem" }}>
            Your {providerConfig.name} API key.{" "}
            <a href={providerConfig.docsUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--primary)" }}>
              Get one here →
            </a>
          </p>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type={showKey ? "text" : "password"}
              placeholder={providerConfig.keyPlaceholder}
              value={apiKey}
              onChange={(e) => { setApiKey(e.target.value); setTestResult(null); }}
              style={{ flex: 1, fontFamily: "monospace" }}
            />
            <button
              className="btn btn-sm"
              onClick={() => setShowKey(!showKey)}
              title={showKey ? "Hide" : "Show"}
              style={{ minWidth: 40 }}
            >
              {showKey ? "🙈" : "👁️"}
            </button>
          </div>

          {/* Test Connection */}
          <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button
              className="btn btn-sm"
              onClick={handleTestConnection}
              disabled={testing || !apiKey}
              style={{ background: "var(--surface-alt)", border: "1px solid var(--border)" }}
            >
              {testing ? "⏳ Testing…" : "🔌 Test Connection"}
            </button>
            {testResult && (
              <span style={{ fontSize: "0.85rem", color: testResult.ok ? "var(--success)" : "var(--danger)" }}>
                {testResult.ok ? "✅" : "❌"} {testResult.text}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Summary */}
      <div className="settings-grid" style={{ marginTop: 16 }}>
        <div className="card settings-card" style={{ background: "var(--surface-alt)", border: "1px dashed var(--border)" }}>
          <h4 style={{ marginBottom: 8 }}>📋 Current Configuration</h4>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", fontSize: "0.9rem" }}>
            <div><strong>Provider:</strong> {providerConfig.icon} {providerConfig.name}</div>
            <div><strong>Model:</strong> {selectedModel?.name || model}</div>
            <div><strong>API Key:</strong> {apiKey ? "••••" + apiKey.slice(-4) : <span className="text-muted">Not set</span>}</div>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <button className="btn btn-primary btn-lg" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "💾 Save AI Model Config"}
        </button>
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

/* ===== AI CONFIG TAB ===== */
const AI_DEFAULTS: Record<string, string> = {
  aiPersonality: "",
  aiEnvironment: "",
  aiTone: "",
  aiGoal: "",
  aiBusinessContext: "",
  aiResponseFormatting: "",
  aiQueryReasoning: "",
  aiToolGuidelines: "",
  aiGuardrails: "",
  aiInsightsInstructions: "",
  aiReportInstructions: "",
  aiWelcomeMessage: "",
};

/* ── Reusable form components ── */
const FormField = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
  <label className="ai-form-field">
    <span className="form-label">{label}</span>
    {children}
    {hint && <span className="form-hint">{hint}</span>}
  </label>
);

const FormTextarea = ({ label, hint, rows = 3, placeholder, value, onChange }: {
  label: string; hint?: string; rows?: number; placeholder?: string;
  value: string; onChange: (val: string) => void;
}) => (
  <FormField label={label} hint={hint}>
    <textarea rows={rows} placeholder={placeholder} value={value}
      onChange={(e) => onChange(e.target.value)} style={{ resize: "vertical" }} />
  </FormField>
);

const SectionCard = ({ icon, title, description, children }: {
  icon: string; title: string; description: string; children: React.ReactNode;
}) => (
  <div className="card settings-card">
    <h3>{icon} {title}</h3>
    <p className="text-muted" style={{ marginBottom: 16 }}>{description}</p>
    <div className="form-grid" style={{ gap: 16 }}>{children}</div>
  </div>
);

const InfoBox = ({ children }: { children: React.ReactNode }) => (
  <div className="card ai-info-box">
    <p style={{ margin: 0, fontSize: 13 }}>{children}</p>
  </div>
);

function AIConfigTab({ config, onSaved }: { config: AppConfig; onSaved?: () => void }) {
  const [settings, setSettings] = useState<Record<string, string>>({ ...AI_DEFAULTS });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(["identity"]));

  const toggleSection = (key: string) =>
    setExpandedSections((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/settings");
        const json = await res.json();
        if (json.data) {
          setSettings((prev) => ({
            ...prev,
            ...Object.fromEntries(Object.keys(AI_DEFAULTS).map((k) => [k, json.data[k] ?? ""])),
          }));
        }
      } catch { /* defaults */ }
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
        setMessage({ type: "success", text: "AI configuration saved!" });
        onSaved?.();
      } else {
        setMessage({ type: "error", text: "Failed to save." });
      }
    } catch {
      setMessage({ type: "error", text: "Network error." });
    }
    setSaving(false);
  };

  if (loading) return <div className="loading-state"><div className="spinner" />Loading AI configuration…</div>;

  const upd = (key: string, val: string) => setSettings((p) => ({ ...p, [key]: val }));

  const filledCount = Object.entries(settings).filter(([_, v]) => v.trim().length > 0).length;
  const totalCount = Object.keys(AI_DEFAULTS).length;

  const sections = [
    {
      key: "identity", icon: "�", title: "Identity & Role",
      desc: "Define who the AI is, its operating environment, and objectives.",
      fields: [
        { key: "aiPersonality", label: "Personality", rows: 3, placeholder: "e.g. You are a knowledgeable business advisor — data-driven, strategic, and action-oriented.", hint: "Who the AI is — role, expertise, character traits." },
        { key: "aiEnvironment", label: "Environment", rows: 3, placeholder: "e.g. You operate inside our company ERP. Users are managers and staff who need quick data answers.", hint: "Where/how the AI operates — interface context, user types, capabilities." },
        { key: "aiGoal", label: "Goal", rows: 2, placeholder: "e.g. Help users make data-driven decisions quickly. Surface actionable insights proactively.", hint: "The AI's primary objective." },
        { key: "aiWelcomeMessage", label: "Welcome Message", rows: 2, placeholder: "e.g. Hello! I'm your Business Assistant. Ask me about sales, inventory, or reports.", hint: "Greeting shown when a user starts a new chat." },
      ],
    },
    {
      key: "style", icon: "🎨", title: "Communication Style",
      desc: "Control tone, formatting, and response structure.",
      fields: [
        { key: "aiTone", label: "Tone", rows: 2, placeholder: "e.g. Professional but approachable. Clear, direct language.", hint: "Voice and communication style." },
        { key: "aiResponseFormatting", label: "Response Formatting", rows: 4, placeholder: "e.g.\n- Use Markdown headers, bullet points, and tables\n- Always show currency with proper symbols\n- Bold key numbers", hint: "How to format output — markdown rules, currency display, tables." },
      ],
    },
    {
      key: "knowledge", icon: "🏢", title: "Business Knowledge",
      desc: "Give the AI context about your business for more relevant answers.",
      fields: [
        { key: "aiBusinessContext", label: "Business Context", rows: 4, placeholder: "e.g. We are a B2B wholesale distributor. Peak season is Q4. We serve 200+ retail clients across 3 regions.", hint: "Domain knowledge — products, policies, specialties, seasonality." },
      ],
    },
    {
      key: "tools", icon: "🔧", title: "Tool & Query Behavior",
      desc: "Guide how the AI reasons about questions and selects tools.",
      fields: [
        { key: "aiQueryReasoning", label: "Query Reasoning", rows: 3, placeholder: "e.g.\n- Consider which date range makes sense\n- For financial questions, cross-check against the payments table", hint: "How the AI should think before calling tools." },
        { key: "aiToolGuidelines", label: "Tool Usage Guidelines", rows: 4, placeholder: "e.g.\n- For inventory questions, query inventory + inventory_transactions\n- For customer insights, check orders + payments together", hint: "When to use which tool — overrides default selection." },
      ],
    },
    {
      key: "safety", icon: "🛡️", title: "Safety & Guardrails",
      desc: "Set boundaries and safety rules the AI must follow.",
      fields: [
        { key: "aiGuardrails", label: "Guardrails", rows: 4, placeholder: "e.g.\n- Never disclose raw employee salary data\n- Don't make promises about delivery dates\n- Escalate when user is frustrated", hint: "Safety rules, boundaries, topics to avoid, escalation policies." },
      ],
    },
    {
      key: "agents", icon: "📊", title: "Specialized Agent Instructions",
      desc: "Customize the insights analyzer and report generator behavior.",
      fields: [
        { key: "aiInsightsInstructions", label: "Insights Analysis", rows: 4, placeholder: "e.g.\n- Focus on conversion rates and seasonal demand\n- Flag month-over-month changes >20%", hint: "Custom instructions for demand forecasting, anomaly detection, trends." },
        { key: "aiReportInstructions", label: "Report Generation", rows: 4, placeholder: "e.g.\n1. Executive Summary with key highlights\n2. Revenue breakdown by category\n3. Forward-looking recommendations", hint: "Custom structure and focus areas for generated reports." },
      ],
    },
  ];

  return (
    <div>
      {message && (
        <div className={`alert alert-${message.type}`} style={{ marginBottom: 16 }}>
          {message.type === "success" ? "✅" : "❌"} {message.text}
        </div>
      )}

      {/* Progress indicator */}
      <div className="ai-config-progress">
        <div className="ai-config-progress-bar">
          <div className="ai-config-progress-fill" style={{ width: `${(filledCount / totalCount) * 100}%` }} />
        </div>
        <span className="text-muted" style={{ fontSize: 12 }}>{filledCount}/{totalCount} fields configured</span>
      </div>

      <div className="settings-grid">
        {sections.map((section) => (
          <div key={section.key} className="card settings-card ai-section-card">
            <button className="ai-section-header" onClick={() => toggleSection(section.key)}>
              <div>
                <h3 style={{ margin: 0 }}>{section.icon} {section.title}</h3>
                <p className="text-muted" style={{ margin: "4px 0 0", fontSize: 13 }}>{section.desc}</p>
              </div>
              <span className="ai-section-chevron">{expandedSections.has(section.key) ? "▼" : "▶"}</span>
            </button>
            {expandedSections.has(section.key) && (
              <div className="form-grid ai-section-body" style={{ gap: 16 }}>
                {section.fields.map((f) => (
                  <FormTextarea key={f.key} label={f.label} hint={f.hint} rows={f.rows}
                    placeholder={f.placeholder} value={settings[f.key] ?? ""}
                    onChange={(val) => upd(f.key, val)} />
                ))}
              </div>
            )}
          </div>
        ))}

        <InfoBox>
          <strong>💡 How it works:</strong> These settings are loaded by AI agents at request time. Changes take effect immediately — no redeployment needed.
          Leave any field empty to use built-in defaults. The AI always knows your configured terminology ({config.labels.product}, {config.labels.order}, etc.)
          and currency ({config.currency}) automatically.
        </InfoBox>
      </div>

      <div style={{ marginTop: 16, position: "sticky", bottom: 0, background: "var(--color-bg)", padding: "12px 0", zIndex: 5 }}>
        <button className="btn btn-primary btn-lg" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "💾 Save AI Configuration"}
        </button>
      </div>
    </div>
  );
}

/* ===== AI AGENTS TAB ===== */

interface AgentConfig {
  id?: string;
  agentName: string;
  displayName: string;
  description: string | null;
  isActive: boolean;
  modelOverride: string | null;
  temperature: string | null;
  maxSteps: number | null;
  timeoutMs: number | null;
  customInstructions: string | null;
  executionPriority: number;
  config: Record<string, unknown> | null;
}

/** Per-agent specialization metadata (static, display-only) */
const AGENT_META: Record<string, { icon: string; role: string; color: string; configHints: { key: string; label: string; hint: string; type: "text" | "number" | "boolean" }[] }> = {
  "data-science": {
    icon: "🧠", role: "The Brain — Orchestrator",
    color: "#7c3aed",
    configHints: [
      { key: "enableSandbox", label: "Enable Sandbox", hint: "Allow running generated code in isolated sandbox", type: "boolean" },
      { key: "compressionThreshold", label: "Compression Threshold", hint: "Compress conversation after this many messages", type: "number" },
    ],
  },
  "insights-analyzer": {
    icon: "📊", role: "The Analyst — Statistical Computation",
    color: "#2563eb",
    configHints: [
      { key: "structuringModel", label: "Structuring Model", hint: "Fast model used for structuring step (e.g. gpt-4o-mini)", type: "text" },
      { key: "sandboxMemoryMb", label: "Sandbox Memory (MB)", hint: "Memory limit for sandbox execution", type: "number" },
      { key: "sandboxTimeoutMs", label: "Sandbox Timeout (ms)", hint: "Max execution time for sandbox code", type: "number" },
    ],
  },
  "report-generator": {
    icon: "📝", role: "The Writer — Report Narration",
    color: "#059669",
    configHints: [
      { key: "defaultFormat", label: "Default Format", hint: "Report output format: markdown or plain", type: "text" },
      { key: "maxSqlSteps", label: "Max SQL Steps", hint: "Maximum SQL queries the writer can execute", type: "number" },
    ],
  },
  "knowledge-base": {
    icon: "📚", role: "The Librarian — Document Retrieval",
    color: "#d97706",
    configHints: [
      { key: "topK", label: "Top K Results", hint: "Number of document chunks to retrieve per query", type: "number" },
      { key: "similarityThreshold", label: "Similarity Threshold", hint: "Minimum similarity score (0.0 – 1.0)", type: "number" },
    ],
  },
};

function AIAgentsTab() {
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const [editState, setEditState] = useState<Record<string, AgentConfig>>({});

  const loadAgents = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/agent-configs");
      const json = await res.json();
      if (json.data) {
        setAgents(json.data);
        // Initialize edit state with current values
        const state: Record<string, AgentConfig> = {};
        for (const a of json.data) state[a.agentName] = { ...a };
        setEditState(state);
      }
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { loadAgents(); }, []);

  const updateField = (agentName: string, field: keyof AgentConfig, value: unknown) => {
    setEditState((prev) => ({
      ...prev,
      [agentName]: { ...prev[agentName], [field]: value },
    }));
  };

  const updateConfig = (agentName: string, key: string, value: unknown) => {
    setEditState((prev) => ({
      ...prev,
      [agentName]: {
        ...prev[agentName],
        config: { ...(prev[agentName]?.config ?? {}), [key]: value },
      },
    }));
  };

  const handleSave = async (agentName: string) => {
    const agent = editState[agentName];
    if (!agent) return;
    setSaving(agentName);
    setMessage(null);
    try {
      const res = await fetch(`/api/agent-configs/${agentName}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(agent),
      });
      if (res.ok) {
        setMessage({ type: "success", text: `${agent.displayName} configuration saved!` });
        loadAgents();
      } else {
        const err = await res.json();
        setMessage({ type: "error", text: err.error || "Failed to save." });
      }
    } catch {
      setMessage({ type: "error", text: "Network error." });
    }
    setSaving(null);
  };

  const handleToggle = async (agentName: string) => {
    const agent = editState[agentName];
    if (!agent) return;
    const updated = { ...agent, isActive: !agent.isActive };
    setEditState((prev) => ({ ...prev, [agentName]: updated }));
    try {
      await fetch(`/api/agent-configs/${agentName}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });
      loadAgents();
    } catch { /* ignore */ }
  };

  if (loading) return <div className="loading-state"><div className="spinner" />Loading agent configurations…</div>;

  return (
    <div>
      {message && (
        <div className={`alert alert-${message.type}`} style={{ marginBottom: 16 }}>
          {message.type === "success" ? "✅" : "❌"} {message.text}
        </div>
      )}

      <div className="settings-grid">
        {agents.map((agent) => {
          const meta = AGENT_META[agent.agentName];
          const edit = editState[agent.agentName];
          const isExpanded = expandedAgent === agent.agentName;
          if (!meta || !edit) return null;

          return (
            <div key={agent.agentName} className="card settings-card" style={{ borderLeft: `4px solid ${meta.color}` }}>
              {/* Header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <button
                  className="ai-section-header"
                  style={{ flex: 1, textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                  onClick={() => setExpandedAgent(isExpanded ? null : agent.agentName)}
                >
                  <div>
                    <h3 style={{ margin: 0 }}>{meta.icon} {edit.displayName}</h3>
                    <p className="text-muted" style={{ margin: "4px 0 0", fontSize: 13 }}>{meta.role}</p>
                  </div>
                  <span className="ai-section-chevron">{isExpanded ? "▼" : "▶"}</span>
                </button>
                <label className="toggle-switch" style={{ marginLeft: 16 }}>
                  <input type="checkbox" checked={edit.isActive} onChange={() => handleToggle(agent.agentName)} />
                  <span className="toggle-slider" />
                  <span className="toggle-label">{edit.isActive ? "Active" : "Disabled"}</span>
                </label>
              </div>

              {/* Expanded editor */}
              {isExpanded && (
                <div style={{ marginTop: 16, borderTop: "1px solid var(--color-border)", paddingTop: 16 }}>
                  <div className="form-grid" style={{ gap: 16 }}>
                    {/* Basic fields */}
                    <FormField label="Display Name" hint="Human-friendly label shown in the UI">
                      <input type="text" value={edit.displayName} onChange={(e) => updateField(agent.agentName, "displayName", e.target.value)} />
                    </FormField>

                    <FormField label="Description" hint="What this agent specializes in">
                      <textarea rows={2} value={edit.description ?? ""} onChange={(e) => updateField(agent.agentName, "description", e.target.value)} style={{ resize: "vertical" }} />
                    </FormField>

                    {/* Model & Performance */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <FormField label="Model Override" hint="Leave empty to use system default">
                        <input type="text" placeholder="e.g. gpt-4o-mini, claude-3-haiku" value={edit.modelOverride ?? ""} onChange={(e) => updateField(agent.agentName, "modelOverride", e.target.value || null)} />
                      </FormField>

                      <FormField label="Temperature" hint="0.00 (deterministic) – 2.00 (creative)">
                        <input type="number" step="0.05" min="0" max="2" placeholder="System default" value={edit.temperature ?? ""} onChange={(e) => updateField(agent.agentName, "temperature", e.target.value || null)} />
                      </FormField>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                      <FormField label="Max Steps" hint="Tool-calling rounds">
                        <input type="number" min="1" max="20" placeholder="Default" value={edit.maxSteps ?? ""} onChange={(e) => updateField(agent.agentName, "maxSteps", e.target.value ? parseInt(e.target.value) : null)} />
                      </FormField>

                      <FormField label="Timeout (ms)" hint="Execution timeout">
                        <input type="number" min="1000" max="300000" step="1000" placeholder="Default" value={edit.timeoutMs ?? ""} onChange={(e) => updateField(agent.agentName, "timeoutMs", e.target.value ? parseInt(e.target.value) : null)} />
                      </FormField>

                      <FormField label="Priority" hint="Lower = higher priority">
                        <input type="number" min="0" max="99" value={edit.executionPriority} onChange={(e) => updateField(agent.agentName, "executionPriority", parseInt(e.target.value) || 0)} />
                      </FormField>
                    </div>

                    {/* Custom Instructions */}
                    <FormField label="Custom Instructions" hint="Business-specific instructions appended to this agent's system prompt">
                      <textarea rows={4} placeholder="e.g. Focus on wholesale metrics. Always include profit margins. Flag inventory below 50 units." value={edit.customInstructions ?? ""} onChange={(e) => updateField(agent.agentName, "customInstructions", e.target.value || null)} style={{ resize: "vertical" }} />
                    </FormField>

                    {/* Agent-specific config */}
                    {meta.configHints.length > 0 && (
                      <div>
                        <h4 style={{ margin: "8px 0", fontSize: 14 }}>🔧 Agent-Specific Settings</h4>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                          {meta.configHints.map((ch) => (
                            <FormField key={ch.key} label={ch.label} hint={ch.hint}>
                              {ch.type === "boolean" ? (
                                <label className="toggle-switch" style={{ marginTop: 4 }}>
                                  <input type="checkbox" checked={!!edit.config?.[ch.key]} onChange={(e) => updateConfig(agent.agentName, ch.key, e.target.checked)} />
                                  <span className="toggle-slider" />
                                  <span className="toggle-label">{edit.config?.[ch.key] ? "On" : "Off"}</span>
                                </label>
                              ) : ch.type === "number" ? (
                                <input type="number" value={(edit.config?.[ch.key] as number) ?? ""} onChange={(e) => updateConfig(agent.agentName, ch.key, e.target.value ? parseFloat(e.target.value) : undefined)} />
                              ) : (
                                <input type="text" value={(edit.config?.[ch.key] as string) ?? ""} onChange={(e) => updateConfig(agent.agentName, ch.key, e.target.value || undefined)} />
                              )}
                            </FormField>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Save button */}
                  <div style={{ marginTop: 16 }}>
                    <button className="btn btn-primary" onClick={() => handleSave(agent.agentName)} disabled={saving === agent.agentName}>
                      {saving === agent.agentName ? "Saving…" : `💾 Save ${edit.displayName}`}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        <InfoBox>
          <strong>💡 How AI Agents work:</strong> Each agent specializes in a different task — orchestration, statistical analysis, report writing, or document retrieval.
          Configuration changes take effect immediately. Use <strong>Model Override</strong> to use a faster/cheaper model for specific agents.
          <strong> Custom Instructions</strong> are appended to the agent's built-in system prompt for per-business customization.
          Disable an agent to prevent the orchestrator from delegating to it.
        </InfoBox>
      </div>
    </div>
  );
}

/* ===== CUSTOM TOOLS TAB ===== */
type ToolType = "server" | "client";

interface CustomTool {
  id?: string;
  toolType: ToolType;
  name: string;
  label: string;
  description: string;
  parameterSchema: Record<string, unknown>;
  webhookUrl: string;
  webhookMethod: string;
  webhookHeaders: Record<string, string>;
  webhookTimeoutSecs: number;
  authType: string;
  authConfig: Record<string, string>;
  pathParamsSchema: Array<Record<string, unknown>>;
  queryParamsSchema: Array<Record<string, unknown>>;
  requestBodySchema: Record<string, unknown>;
  expectsResponse: boolean;
  disableInterruptions: boolean;
  executionMode: string;
  dynamicVariables: Record<string, unknown>;
  dynamicVariableAssignments: Array<Record<string, unknown>>;
  isActive: boolean;
  sortOrder: number;
}

const EMPTY_TOOL: CustomTool = {
  toolType: "server", name: "", label: "", description: "",
  parameterSchema: {}, webhookUrl: "", webhookMethod: "GET",
  webhookHeaders: {}, webhookTimeoutSecs: 20, authType: "none",
  authConfig: {}, pathParamsSchema: [], queryParamsSchema: [],
  requestBodySchema: {}, expectsResponse: false,
  disableInterruptions: false, executionMode: "immediate",
  dynamicVariables: {}, dynamicVariableAssignments: [],
  isActive: true, sortOrder: 0,
};

/* ── Reusable JSON editor ── */
const JsonEditor = ({ label, hint, rows = 3, placeholder, value, onChange }: {
  label: string; hint?: string; rows?: number; placeholder?: string;
  value: unknown; onChange: (val: unknown) => void;
}) => {
  const [raw, setRaw] = useState(JSON.stringify(value, null, 2));
  const [valid, setValid] = useState(true);

  useEffect(() => { setRaw(JSON.stringify(value, null, 2)); }, [value]);

  return (
    <FormField label={label} hint={hint}>
      <textarea rows={rows} placeholder={placeholder} value={raw}
        onChange={(e) => {
          setRaw(e.target.value);
          try { const parsed = JSON.parse(e.target.value); setValid(true); onChange(parsed); }
          catch { setValid(false); }
        }}
        style={{ resize: "vertical", fontFamily: "monospace", fontSize: 12, borderColor: valid ? undefined : "var(--color-danger)" }}
      />
      {!valid && <span style={{ color: "var(--color-danger)", fontSize: 11 }}>Invalid JSON</span>}
    </FormField>
  );
};

/* ── Param schema editor (path/query params) ── */
const ParamSchemaEditor = ({ label, value, onChange }: {
  label: string;
  value: Array<Record<string, unknown>>;
  onChange: (val: Array<Record<string, unknown>>) => void;
}) => {
  const addParam = () => onChange([...value, { name: "", description: "", required: false, default: "" }]);
  const removeParam = (idx: number) => onChange(value.filter((_, i) => i !== idx));
  const updateParam = (idx: number, field: string, val: unknown) =>
    onChange(value.map((p, i) => (i === idx ? { ...p, [field]: val } : p)));

  return (
    <div className="param-schema-editor">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span className="form-label">{label}</span>
        <button className="btn btn-sm btn-secondary" onClick={addParam} style={{ fontSize: 11 }}>+ Add Parameter</button>
      </div>
      {value.length === 0 && <p className="text-muted" style={{ fontSize: 12 }}>No parameters defined.</p>}
      {value.map((param, idx) => (
        <div key={idx} className="param-row" style={{ display: "grid", gridTemplateColumns: "1fr 2fr auto auto", gap: 8, alignItems: "end", marginBottom: 6 }}>
          <input type="text" placeholder="name" value={String(param.name ?? "")}
            onChange={(e) => updateParam(idx, "name", e.target.value)} style={{ fontSize: 12 }} />
          <input type="text" placeholder="description" value={String(param.description ?? "")}
            onChange={(e) => updateParam(idx, "description", e.target.value)} style={{ fontSize: 12 }} />
          <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, whiteSpace: "nowrap" }}>
            <input type="checkbox" checked={!!param.required}
              onChange={(e) => updateParam(idx, "required", e.target.checked)} /> Req
          </label>
          <button className="btn btn-sm" onClick={() => removeParam(idx)} style={{ color: "var(--color-danger)", fontSize: 11 }}>✕</button>
        </div>
      ))}
    </div>
  );
};

/* ── Dynamic variables editor ── */
const DynamicVarsEditor = ({ variables, assignments, onVarsChange, onAssignChange }: {
  variables: Record<string, unknown>;
  assignments: Array<Record<string, unknown>>;
  onVarsChange: (v: Record<string, unknown>) => void;
  onAssignChange: (a: Array<Record<string, unknown>>) => void;
}) => {
  const addAssignment = () => onAssignChange([...assignments, { var: "", source: "session", default: "" }]);
  const removeAssignment = (idx: number) => onAssignChange(assignments.filter((_, i) => i !== idx));
  const updateAssignment = (idx: number, field: string, val: unknown) =>
    onAssignChange(assignments.map((a, i) => (i === idx ? { ...a, [field]: val } : a)));

  return (
    <div>
      <JsonEditor label="Dynamic Variables" hint="Template variables available in URL/headers/body via {{var_name}}"
        rows={2} placeholder={'{ "user_id": "string", "session_token": "string" }'}
        value={variables} onChange={(v) => onVarsChange(v as Record<string, unknown>)} />
      <div style={{ marginTop: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <span className="form-label">Variable Assignments</span>
          <button className="btn btn-sm btn-secondary" onClick={addAssignment} style={{ fontSize: 11 }}>+ Add</button>
        </div>
        {assignments.length === 0 && <p className="text-muted" style={{ fontSize: 12 }}>No dynamic variable assignments.</p>}
        {assignments.map((a, idx) => (
          <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 8, marginBottom: 6 }}>
            <input type="text" placeholder="variable name" value={String(a.var ?? "")}
              onChange={(e) => updateAssignment(idx, "var", e.target.value)} style={{ fontSize: 12 }} />
            <select value={String(a.source ?? "session")}
              onChange={(e) => updateAssignment(idx, "source", e.target.value)} style={{ fontSize: 12 }}>
              <option value="session">Session</option>
              <option value="env">Env Variable</option>
              <option value="static">Static Value</option>
            </select>
            <input type="text" placeholder="default value" value={String(a.default ?? "")}
              onChange={(e) => updateAssignment(idx, "default", e.target.value)} style={{ fontSize: 12 }} />
            <button className="btn btn-sm" onClick={() => removeAssignment(idx)} style={{ color: "var(--color-danger)", fontSize: 11 }}>✕</button>
          </div>
        ))}
      </div>
    </div>
  );
};

/* ── Auth config sub-form ── */
const AuthConfigForm = ({ authType, authConfig, onChange }: {
  authType: string;
  authConfig: Record<string, string>;
  onChange: (config: Record<string, string>) => void;
}) => {
  const upd = (key: string, val: string) => onChange({ ...authConfig, [key]: val });

  if (authType === "none") return null;

  return (
    <div className="auth-config-form">
      {authType === "bearer" && (
        <FormField label="Bearer Token" hint="The token sent in the Authorization header">
          <input type="password" placeholder="your-api-token" value={authConfig.token ?? ""} onChange={(e) => upd("token", e.target.value)} />
        </FormField>
      )}
      {authType === "api_key" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <FormField label="Header Name"><input type="text" placeholder="X-API-Key" value={authConfig.headerName ?? ""} onChange={(e) => upd("headerName", e.target.value)} /></FormField>
          <FormField label="API Key"><input type="password" placeholder="sk-..." value={authConfig.apiKey ?? ""} onChange={(e) => upd("apiKey", e.target.value)} /></FormField>
        </div>
      )}
      {authType === "basic" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <FormField label="Username"><input type="text" value={authConfig.username ?? ""} onChange={(e) => upd("username", e.target.value)} /></FormField>
          <FormField label="Password"><input type="password" value={authConfig.password ?? ""} onChange={(e) => upd("password", e.target.value)} /></FormField>
        </div>
      )}
      {authType === "oauth2" && (
        <FormField label="Access Token" hint="Obtained via your OAuth flow">
          <input type="password" placeholder="access-token" value={authConfig.accessToken ?? ""} onChange={(e) => upd("accessToken", e.target.value)} />
        </FormField>
      )}
    </div>
  );
};

/* ── Tool editor form ── */
const ToolEditorForm = ({ tool, onUpdate, onSave, onCancel, saving }: {
  tool: CustomTool;
  onUpdate: (partial: Partial<CustomTool>) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) => {
  const isServer = tool.toolType === "server";
  const needsBody = ["POST", "PUT", "PATCH"].includes(tool.webhookMethod);
  const canSave = tool.name.length > 0 && tool.label.length > 0 && tool.description.length > 0
    && (isServer ? tool.webhookUrl.length > 0 : true);

  const [activeTab, setActiveTab] = useState<"basic" | "auth" | "params" | "advanced">("basic");

  return (
    <div className="tool-editor">
      {/* Tool type selector */}
      <div className="tool-type-selector">
        {([
          { value: "server" as ToolType, icon: "🌐", label: "Server", desc: "Call an external API endpoint" },
          { value: "client" as ToolType, icon: "📱", label: "Client", desc: "Trigger an action in the browser" },
        ]).map((tt) => (
          <button key={tt.value} className={`tool-type-option ${tool.toolType === tt.value ? "active" : ""}`}
            onClick={() => onUpdate({ toolType: tt.value })}>
            <span style={{ fontSize: 18 }}>{tt.icon}</span>
            <div><strong>{tt.label}</strong><br /><span className="text-muted" style={{ fontSize: 11 }}>{tt.desc}</span></div>
          </button>
        ))}
      </div>

      {/* Sub-tabs for the form */}
      <div className="tool-editor-tabs">
        {(["basic", ...(isServer ? ["auth", "params"] : []), "advanced"] as const).map((tab) => (
          <button key={tab} className={`tool-editor-tab ${activeTab === tab ? "active" : ""}`}
            onClick={() => setActiveTab(tab as any)}>
            {tab === "basic" ? "📝 Basic" : tab === "auth" ? "🔐 Auth" : tab === "params" ? "📊 Params" : "⚙️ Advanced"}
          </button>
        ))}
      </div>

      {/* Basic tab */}
      {activeTab === "basic" && (
        <div className="form-grid" style={{ gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <FormField label="Tool Name (snake_case)" hint="Unique identifier used by the AI">
              <input type="text" placeholder="e.g. check_inventory"
                value={tool.name} onChange={(e) => onUpdate({ name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })} />
            </FormField>
            <FormField label="Display Label" hint="Human-readable name shown in the UI">
              <input type="text" placeholder="e.g. Check Inventory" value={tool.label} onChange={(e) => onUpdate({ label: e.target.value })} />
            </FormField>
          </div>
          <FormField label="Description (for the AI)" hint="Tells the AI when and why to use this tool — be specific">
            <textarea rows={3} placeholder="e.g. Check the current stock level for a specific product by SKU or name."
              value={tool.description} onChange={(e) => onUpdate({ description: e.target.value })} style={{ resize: "vertical" }} />
          </FormField>
          <JsonEditor label="Parameter Schema" hint="JSON schema defining the parameters the AI should collect"
            rows={4} placeholder={'{\n  "product_id": { "type": "string", "description": "The product ID to check" }\n}'}
            value={tool.parameterSchema} onChange={(v) => onUpdate({ parameterSchema: v as Record<string, unknown> })} />

          {isServer && (
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 12 }}>
              <FormField label="URL" hint="Supports {path_param} and {{dynamic_var}} placeholders">
                <input type="text" placeholder="https://api.example.com/v1/{resource}" value={tool.webhookUrl}
                  onChange={(e) => onUpdate({ webhookUrl: e.target.value })} />
              </FormField>
              <FormField label="Method">
                <select value={tool.webhookMethod} onChange={(e) => onUpdate({ webhookMethod: e.target.value })}>
                  {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </FormField>
              <FormField label="Timeout (s)">
                <input type="number" min={1} max={120} value={tool.webhookTimeoutSecs}
                  onChange={(e) => onUpdate({ webhookTimeoutSecs: Number(e.target.value) })} />
              </FormField>
            </div>
          )}

          {!isServer && (
            <FormField label="Expects Response?" hint="Whether the AI should wait for the browser to respond before continuing">
              <select value={tool.expectsResponse ? "true" : "false"}
                onChange={(e) => onUpdate({ expectsResponse: e.target.value === "true" })}>
                <option value="false">No — fire and forget</option>
                <option value="true">Yes — wait for browser response</option>
              </select>
            </FormField>
          )}
        </div>
      )}

      {/* Auth tab (server only) */}
      {activeTab === "auth" && isServer && (
        <div className="form-grid" style={{ gap: 12 }}>
          <FormField label="Authentication Type">
            <select value={tool.authType} onChange={(e) => onUpdate({ authType: e.target.value, authConfig: {} })}>
              <option value="none">None</option>
              <option value="api_key">API Key (custom header)</option>
              <option value="bearer">Bearer Token</option>
              <option value="basic">Basic Auth (user/pass)</option>
              <option value="oauth2">OAuth 2.0</option>
            </select>
          </FormField>
          <AuthConfigForm authType={tool.authType} authConfig={tool.authConfig}
            onChange={(config) => onUpdate({ authConfig: config })} />
          <JsonEditor label="Custom Headers" hint="Additional HTTP headers as key-value pairs"
            rows={2} placeholder={'{ "X-Custom-Header": "value" }'}
            value={tool.webhookHeaders} onChange={(v) => onUpdate({ webhookHeaders: v as Record<string, string> })} />
        </div>
      )}

      {/* Params tab (server only) */}
      {activeTab === "params" && isServer && (
        <div className="form-grid" style={{ gap: 16 }}>
          <ParamSchemaEditor label="Path Parameters" value={tool.pathParamsSchema}
            onChange={(v) => onUpdate({ pathParamsSchema: v })} />
          <ParamSchemaEditor label="Query Parameters" value={tool.queryParamsSchema}
            onChange={(v) => onUpdate({ queryParamsSchema: v })} />
          {needsBody && (
            <JsonEditor label="Request Body Schema"
              hint="JSON schema for the request body (POST/PUT/PATCH)"
              rows={4} placeholder={'{ "message": { "type": "string" }, "priority": { "type": "number" } }'}
              value={tool.requestBodySchema} onChange={(v) => onUpdate({ requestBodySchema: v as Record<string, unknown> })} />
          )}
          <DynamicVarsEditor variables={tool.dynamicVariables} assignments={tool.dynamicVariableAssignments}
            onVarsChange={(v) => onUpdate({ dynamicVariables: v })}
            onAssignChange={(a) => onUpdate({ dynamicVariableAssignments: a })} />
        </div>
      )}

      {/* Advanced tab */}
      {activeTab === "advanced" && (
        <div className="form-grid" style={{ gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <FormField label="Execution Mode" hint="Whether to run immediately or ask user first">
              <select value={tool.executionMode} onChange={(e) => onUpdate({ executionMode: e.target.value })}>
                <option value="immediate">Immediate — run right away</option>
                <option value="confirm">Confirm — ask user first</option>
              </select>
            </FormField>
            <FormField label="Disable Interruptions" hint="Prevent AI from streaming while tool executes">
              <select value={tool.disableInterruptions ? "true" : "false"}
                onChange={(e) => onUpdate({ disableInterruptions: e.target.value === "true" })}>
                <option value="false">No</option>
                <option value="true">Yes — block until complete</option>
              </select>
            </FormField>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <FormField label="Active" hint="Inactive tools are hidden from the AI">
              <select value={tool.isActive ? "true" : "false"}
                onChange={(e) => onUpdate({ isActive: e.target.value === "true" })}>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </FormField>
            <FormField label="Sort Order" hint="Lower numbers appear first">
              <input type="number" min={0} value={tool.sortOrder}
                onChange={(e) => onUpdate({ sortOrder: Number(e.target.value) })} />
            </FormField>
          </div>
        </div>
      )}

      {/* Save / Cancel */}
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button className="btn btn-primary" disabled={!canSave || saving} onClick={onSave}>
          {saving ? "Saving…" : tool.id ? "💾 Update Tool" : "➕ Create Tool"}
        </button>
        <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
};

/* ── Tool card in the list ── */
const ToolCard = ({ tool, onEdit, onTest, onDelete, onToggle }: {
  tool: CustomTool;
  onEdit: () => void;
  onTest: () => void;
  onDelete: () => void;
  onToggle: () => void;
}) => {
  const typeIcon = tool.toolType === "server" ? "🌐" : "📱";
  const typeLabel = tool.toolType === "server" ? "Server" : "Client";

  return (
    <div className={`tool-card ${!tool.isActive ? "tool-card-inactive" : ""}`}>
      <div className="tool-card-header">
        <div className="tool-card-title">
          <span className="tool-card-type-badge">{typeIcon} {typeLabel}</span>
          <h4 style={{ margin: 0 }}>{tool.label}</h4>
          <code className="tool-card-name">{tool.name}</code>
        </div>
        <div className="tool-card-actions">
          <button className="btn btn-sm" onClick={onToggle} title={tool.isActive ? "Deactivate" : "Activate"}>
            {tool.isActive ? "🟢" : "⚪"}
          </button>
          <button className="btn btn-sm" onClick={onEdit} title="Edit">✏️</button>
          <button className="btn btn-sm" onClick={onTest} title="Test">▶️</button>
          <button className="btn btn-sm" onClick={onDelete} title="Delete" style={{ color: "var(--color-danger)" }}>🗑️</button>
        </div>
      </div>
      <p className="tool-card-desc">{tool.description}</p>
      <div className="tool-card-meta">
        {tool.toolType === "server" && <span>{tool.webhookMethod} {tool.webhookUrl ? tool.webhookUrl.slice(0, 50) + (tool.webhookUrl.length > 50 ? "…" : "") : "—"}</span>}
        <span>Mode: {tool.executionMode}</span>
        {tool.authType !== "none" && <span>Auth: {tool.authType}</span>}
      </div>
    </div>
  );
};

function CustomToolsTab() {
  const [tools, setTools] = useState<CustomTool[]>([]);
  const [editingTool, setEditingTool] = useState<CustomTool | null>(null);
  const [testParams, setTestParams] = useState("{}");
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testingToolId, setTestingToolId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [filter, setFilter] = useState<"all" | "server" | "client">("all");

  const loadTools = async () => {
    try {
      const res = await fetch("/api/custom-tools");
      const json = await res.json();
      if (json.data) setTools(json.data);
    } catch { /* ignore */ }
  };

  useEffect(() => { loadTools(); }, []);

  const handleSave = async () => {
    if (!editingTool) return;
    setSaving(true);
    try {
      const method = editingTool.id ? "PUT" : "POST";
      const url = editingTool.id ? `/api/custom-tools/${editingTool.id}` : "/api/custom-tools";
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(editingTool) });
      if (res.ok) {
        setMessage({ type: "success", text: `Tool "${editingTool.label}" saved!` });
        setEditingTool(null);
        loadTools();
      } else {
        const err = await res.json();
        setMessage({ type: "error", text: err.error || "Failed to save tool" });
      }
    } catch { setMessage({ type: "error", text: "Network error saving tool" }); }
    setSaving(false);
  };

  const handleTest = async (toolId: string) => {
    setTestingToolId(toolId);
    setTestResult(null);
    try {
      const params = JSON.parse(testParams);
      const res = await fetch(`/api/custom-tools/${toolId}/test`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ params }),
      });
      const json = await res.json();
      setTestResult(JSON.stringify(json.data ?? json, null, 2));
    } catch (err: any) { setTestResult(`Error: ${err.message}`); }
    setTestingToolId(null);
  };

  const handleDelete = async (tool: CustomTool) => {
    if (!confirm(`Delete tool "${tool.label}"?`)) return;
    await fetch(`/api/custom-tools/${tool.id}`, { method: "DELETE" });
    loadTools();
  };

  const handleToggle = async (tool: CustomTool) => {
    await fetch(`/api/custom-tools/${tool.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...tool, isActive: !tool.isActive }),
    });
    loadTools();
  };

  const filteredTools = tools.filter((t) => filter === "all" || t.toolType === filter);

  return (
    <div>
      {message && (
        <div className={`alert alert-${message.type}`} style={{ marginBottom: 16 }}>
          {message.type === "success" ? "✅" : "❌"} {message.text}
        </div>
      )}

      <div className="settings-grid">
        {/* Creator / Editor */}
        <div className="card settings-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h3 style={{ margin: 0 }}>{editingTool?.id ? "✏️ Edit Tool" : "➕ Create Custom Tool"}</h3>
            {!editingTool && (
              <button className="btn btn-primary btn-sm" onClick={() => setEditingTool({ ...EMPTY_TOOL })}>
                + New Tool
              </button>
            )}
          </div>

          {editingTool ? (
            <ToolEditorForm tool={editingTool}
              onUpdate={(partial) => setEditingTool((prev) => ({ ...(prev ?? EMPTY_TOOL), ...partial }))}
              onSave={handleSave} onCancel={() => setEditingTool(null)} saving={saving} />
          ) : (
            <p className="text-muted">Click "New Tool" to create a custom tool the AI can invoke.</p>
          )}
        </div>

        {/* Tools list */}
        <div className="card settings-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>🧩 Your Custom Tools ({tools.length})</h3>
            <div style={{ display: "flex", gap: 4 }}>
              {(["all", "server", "client"] as const).map((f) => (
                <button key={f} className={`btn btn-sm ${filter === f ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => setFilter(f)} style={{ fontSize: 11, textTransform: "capitalize" }}>
                  {f === "all" ? "All" : f === "server" ? "🌐 Server" : "📱 Client"}
                </button>
              ))}
            </div>
          </div>

          {filteredTools.length === 0 ? (
            <p className="text-muted">{tools.length === 0 ? "No custom tools defined yet." : "No tools match the filter."}</p>
          ) : (
            <div className="tools-list">
              {filteredTools.map((t) => (
                <ToolCard key={t.id} tool={t}
                  onEdit={() => setEditingTool({ ...t })}
                  onTest={() => handleTest(t.id!)}
                  onDelete={() => handleDelete(t)}
                  onToggle={() => handleToggle(t)} />
              ))}
            </div>
          )}

          {/* Test panel */}
          <div style={{ marginTop: 16, borderTop: "1px solid var(--color-border)", paddingTop: 12 }}>
            <FormField label="Test Parameters (JSON)" hint="Provide params to test any tool above">
              <textarea rows={2} value={testParams} onChange={(e) => setTestParams(e.target.value)}
                style={{ fontFamily: "monospace", fontSize: 12, resize: "vertical" }}
                placeholder='{"product_id": "abc-123"}' />
            </FormField>
            {testResult && (
              <pre className="test-result-pre">{testResult}</pre>
            )}
          </div>
        </div>

        <InfoBox>
          <strong>💡 How custom tools work:</strong> The AI discovers active tools at request time and invokes them when relevant.
          <strong> Server</strong> tools call external APIs (HTTP/REST). <strong> Client</strong> tools trigger browser-side actions via SSE.
          Path params use <code>{"{param}"}</code> syntax in the URL. Dynamic variables use <code>{"{{var}}"}</code> syntax.
          Changes take effect immediately — no redeployment needed.
        </InfoBox>
      </div>
    </div>
  );
}
