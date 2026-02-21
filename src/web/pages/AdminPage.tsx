import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import type { AppConfig } from "../types";

interface AdminPageProps {
  config: AppConfig;
  onSaved?: () => void;
}

type AdminTab = "users" | "approvals" | "statuses" | "tax" | "knowledge" | "settings" | "ai" | "tools" | "model" | "agents" | "prompts" | "evals" | "examples" | "scheduler" | "observability";

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
  reportsTo: string | null;
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

/* ═══════════════════════════════════════════════════════
   Admin Console — Enterprise Layout
   ═══════════════════════════════════════════════════════ */

interface NavSection {
  label: string;
  items: { key: AdminTab; label: string; icon: string; badge?: string }[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    label: "AI & Intelligence",
    items: [
      { key: "knowledge", label: "Knowledge Base", icon: "🧠" },
      { key: "model", label: "AI Model", icon: "🤖" },
      { key: "ai", label: "Prompt Engineering", icon: "✍️" },
      { key: "tools", label: "Custom Tools", icon: "🧩" },
      { key: "agents", label: "AI Agents", icon: "🧬" },
      { key: "prompts", label: "Prompt Templates", icon: "📋" },
      { key: "evals", label: "Evaluations", icon: "📊" },
      { key: "examples", label: "Few-Shot Examples", icon: "💡" },
    ],
  },
  {
    label: "Operations",
    items: [
      { key: "users", label: "Users & Access", icon: "🔐" },
      { key: "approvals", label: "Approval Workflows", icon: "✅" },
      { key: "scheduler", label: "Scheduler", icon: "⏰" },
      { key: "observability", label: "Observability", icon: "📡" },
    ],
  },
  {
    label: "Configuration",
    items: [
      { key: "settings", label: "Business Profile", icon: "🏢" },
    ],
  },
];

const SECTION_KEYS: Record<string, string> = {
  "AI & Intelligence": "ai",
  "Operations": "ops",
  "Configuration": "config",
};

/** Section title labels */
const TAB_TITLES: Record<AdminTab, string> = {
  knowledge: "Knowledge Base",
  model: "AI Model Configuration",
  ai: "Prompt Engineering",
  tools: "Custom Tools",
  agents: "AI Agents",
  prompts: "Prompt Templates",
  evals: "Evaluation Dashboard",
  examples: "Few-Shot Examples",
  scheduler: "Task Scheduler",
  observability: "Observability & Logs",
  users: "Users & Access Control",
  approvals: "Approval Workflows",
  statuses: "Order Statuses",
  tax: "Tax Rules",
  settings: "Business Profile",
};

const TAB_DESCRIPTIONS: Record<AdminTab, string> = {
  knowledge: "Train the AI with your business documents, policies, and procedures",
  model: "Select your AI provider, model, and manage API credentials",
  ai: "Configure AI personality, tone, reasoning, and safety guardrails",
  tools: "Create custom tool integrations for the AI to use",
  agents: "Fine-tune individual AI agent behavior and specializations",
  prompts: "Manage reusable prompt templates for consistent AI responses",
  evals: "Monitor AI response quality with automated evaluations",
  examples: "Provide example interactions to improve AI accuracy",
  scheduler: "Schedule automated tasks, reports, and maintenance jobs",
  observability: "Monitor system health, logs, and performance metrics",
  users: "Manage users, roles, permissions, and warehouse assignments",
  approvals: "Configure multi-step approval chains for business actions",
  statuses: "Define order lifecycle statuses and transitions",
  tax: "Configure tax rules and compliance settings",
  settings: "Company branding, payment providers, and system configuration",
};

/* ---------- Reusable FormField wrapper ---------- */
function FormField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--color-text)" }}>{label}</label>
      {hint && <span style={{ fontSize: "0.72rem", color: "var(--color-text-muted)", marginTop: -2 }}>{hint}</span>}
      {children}
    </div>
  );
}

/* ---------- Reusable InfoBox ---------- */
function InfoBox({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      padding: "12px 16px",
      borderRadius: 8,
      background: "var(--color-bg-elevated, #1e293b)",
      border: "1px solid var(--color-border, #334155)",
      fontSize: "0.82rem",
      lineHeight: 1.6,
      color: "var(--color-text-muted, #94a3b8)",
      marginTop: 12,
    }}>
      {children}
    </div>
  );
}

export default function AdminPage({ config, onSaved }: AdminPageProps) {
  const [tab, setTab] = useState<AdminTab>("knowledge");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className="admin-console">
      {/* ── Admin Sidebar Navigation ── */}
      <aside className={`admin-sidebar ${sidebarCollapsed ? "admin-sidebar-collapsed" : ""}`}>
        <div className="admin-sidebar-header">
          <div className="admin-sidebar-brand">
            <span className="admin-sidebar-icon">⚙️</span>
            {!sidebarCollapsed && <span className="admin-sidebar-title">Admin Console</span>}
          </div>
          <button
            className="admin-sidebar-toggle"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            title={sidebarCollapsed ? "Expand" : "Collapse"}
          >
            {sidebarCollapsed ? "»" : "«"}
          </button>
        </div>

        <nav className="admin-sidebar-nav">
          {NAV_SECTIONS.map((section) => (
            <div key={section.label} className="admin-nav-section" data-section={SECTION_KEYS[section.label] ?? ""}>
              {!sidebarCollapsed && (
                <div className="admin-nav-section-label">{section.label}</div>
              )}
              {section.items.map((item) => (
                <button
                  key={item.key}
                  className={`admin-nav-item ${tab === item.key ? "active" : ""}`}
                  onClick={() => setTab(item.key)}
                  title={sidebarCollapsed ? item.label : undefined}
                >
                  <span className="admin-nav-icon">{item.icon}</span>
                  {!sidebarCollapsed && (
                    <>
                      <span className="admin-nav-label">{item.label}</span>
                      {item.badge && <span className="admin-nav-badge">{item.badge}</span>}
                    </>
                  )}
                </button>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      {/* ── Content Area ── */}
      <div className="admin-main">
        {/* Content Header */}
        <div className="admin-content-header">
          <div className="admin-content-header-text">
            <h2 className="admin-content-title">{TAB_TITLES[tab] ?? tab}</h2>
            <p className="admin-content-desc">{TAB_DESCRIPTIONS[tab] ?? ""}</p>
          </div>
          <div className="admin-content-breadcrumb">
            <span className="breadcrumb-muted">Admin</span>
            <span className="breadcrumb-sep">/</span>
            <span className="breadcrumb-current">{TAB_TITLES[tab] ?? tab}</span>
          </div>
        </div>

        {/* Content Body */}
        <div className="admin-content-body">
          {tab === "users" && <UsersAccessTab />}
          {tab === "approvals" && <ApprovalWorkflowsTab />}
          {tab === "knowledge" && <KnowledgeBaseTab />}
          {tab === "model" && <AIModelTab onSaved={onSaved} />}
          {tab === "ai" && <AIConfigTab config={config} onSaved={onSaved} />}
          {tab === "tools" && <CustomToolsTab />}
          {tab === "agents" && <AIAgentsTab />}
          {tab === "prompts" && <PromptTemplatesTab />}
          {tab === "evals" && <EvalDashboardTab />}
          {tab === "examples" && <FewShotExamplesTab />}
          {tab === "scheduler" && <SchedulerTab />}
          {tab === "observability" && <ObservabilityTab />}
          {tab === "settings" && <SettingsTab config={config} onSaved={onSaved} />}
        </div>
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
    reportsTo: null as string | null,
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
    setForm({ email: "", name: "", role: "staff", permissions: [], assignedWarehouses: null, reportsTo: null });
    setEditUser(null);
    setShowForm(false);
  };

  const openEdit = (u: User) => {
    setForm({ email: u.email, name: u.name, role: u.role, permissions: u.permissions ?? [], assignedWarehouses: u.assignedWarehouses, reportsTo: u.reportsTo });
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
            <label>
              <span className="form-label">Reports To</span>
              <select
                value={form.reportsTo ?? ""}
                onChange={(e) => setForm({ ...form, reportsTo: e.target.value || null })}
              >
                <option value="">— None (top-level) —</option>
                {users
                  .filter((u) => u.id !== editUser?.id && (rbac?.roleRank?.[u.role] ?? 0) > (rbac?.roleRank?.[form.role] ?? 0))
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({ROLE_LABELS[u.role] ?? u.role})
                    </option>
                  ))}
              </select>
              <span className="form-hint">Direct supervisor in the approval chain</span>
            </label>
          </div>
          <div className="form-grid cols-4" style={{ marginTop: 8 }}>
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
              <th>Reports To</th>
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
                  {u.reportsTo ? (() => {
                    const supervisor = users.find((s) => s.id === u.reportsTo);
                    return supervisor ? (
                      <div>
                        <div className="cell-main">{supervisor.name}</div>
                        <div className="cell-sub">{ROLE_LABELS[supervisor.role] ?? supervisor.role}</div>
                      </div>
                    ) : <span className="text-muted">—</span>;
                  })() : <span className="text-muted">— Top level —</span>}
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
              <tr><td colSpan={7} className="text-center text-muted">No users match</td></tr>
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
    rateLimitChat: "30",
    rateLimitScan: "20",
    rateLimitReport: "10",
    rateLimitWebhook: "100",
    rateLimitToolDaily: "100",
    ...PAYMENT_DEFAULTS,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [section, setSection] = useState<"business" | "payments" | "tax" | "ratelimits">("business");

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
            rateLimitChat: json.data.rateLimitChat || "30",
            rateLimitScan: json.data.rateLimitScan || "20",
            rateLimitReport: json.data.rateLimitReport || "10",
            rateLimitWebhook: json.data.rateLimitWebhook || "100",
            rateLimitToolDaily: json.data.rateLimitToolDaily || "100",
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
        <button className={`sub-tab ${section === "ratelimits" ? "active" : ""}`} onClick={() => setSection("ratelimits")}>
          🚦 Rate Limits
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

      {/* ── Rate Limits ── */}
      {section === "ratelimits" && (
        <div className="settings-grid">
          <div className="card settings-card">
            <h4>🚦 Rate Limits</h4>
            <p className="text-muted" style={{ marginBottom: 16, fontSize: "0.8rem" }}>
              Control how many requests each user can make per minute (or per day for tools).
              This protects your system from abuse and runaway costs. Changes take effect within 1 minute.
            </p>
            <div className="form-grid" style={{ gap: 16 }}>
              <label>
                <span className="form-label">💬 Chat Messages (per user / minute)</span>
                <input type="number" min="1" max="1000" value={settings.rateLimitChat} onChange={(e) => upd("rateLimitChat", e.target.value)} />
                <span className="form-hint">Max messages a user can send per minute in the AI chat. Default: 30</span>
              </label>
              <label>
                <span className="form-label">📋 Report Generation (per user / minute)</span>
                <input type="number" min="1" max="100" value={settings.rateLimitReport} onChange={(e) => upd("rateLimitReport", e.target.value)} />
                <span className="form-hint">Max AI reports a user can generate per minute. Default: 10</span>
              </label>
              <label>
                <span className="form-label">📸 Document Scanning (per user / minute)</span>
                <input type="number" min="1" max="500" value={settings.rateLimitScan} onChange={(e) => upd("rateLimitScan", e.target.value)} />
                <span className="form-hint">Max barcode/invoice/stock-sheet scans per minute. Default: 20</span>
              </label>
              <label>
                <span className="form-label">🔗 Webhook Events (per source / minute)</span>
                <input type="number" min="1" max="10000" value={settings.rateLimitWebhook} onChange={(e) => upd("rateLimitWebhook", e.target.value)} />
                <span className="form-hint">Max incoming webhook events per source per minute. Default: 100</span>
              </label>
              <label>
                <span className="form-label">🔧 Custom Tool Runs (per user / day)</span>
                <input type="number" min="1" max="10000" value={settings.rateLimitToolDaily} onChange={(e) => upd("rateLimitToolDaily", e.target.value)} />
                <span className="form-hint">Max custom tool invocations per user per 24 hours. Default: 100</span>
              </label>
            </div>
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

/* ===== AI CONFIG TAB — Prompt Engineering ===== */

const AI_FIELDS = [
  { key: "aiPersonality", label: "Personality", section: "identity", rows: 4, placeholder: "e.g. You are a knowledgeable business advisor — data-driven, strategic, and action-oriented.", hint: "Who the AI is — role, expertise, character traits." },
  { key: "aiEnvironment", label: "Environment", section: "identity", rows: 4, placeholder: "e.g. You operate inside our company ERP. Users are managers and staff who need quick data answers.", hint: "Where/how the AI operates — interface context, user types, capabilities." },
  { key: "aiGoal", label: "Goal", section: "identity", rows: 3, placeholder: "e.g. Help users make data-driven decisions quickly. Surface actionable insights proactively.", hint: "The AI's primary objective." },
  { key: "aiWelcomeMessage", label: "Welcome Message", section: "identity", rows: 2, placeholder: "e.g. Hello! I'm your Business Assistant. Ask me about sales, inventory, or reports.", hint: "Greeting shown when a user starts a new chat." },
  { key: "aiTone", label: "Tone", section: "style", rows: 3, placeholder: "e.g. Professional but approachable. Clear, direct language.", hint: "Voice and communication style." },
  { key: "aiResponseFormatting", label: "Response Formatting", section: "style", rows: 5, placeholder: "e.g.\n- Use Markdown headers, bullet points, and tables\n- Always show currency with proper symbols\n- Bold key numbers", hint: "How to format output — markdown rules, currency display, tables." },
  { key: "aiBusinessContext", label: "Business Context", section: "knowledge", rows: 5, placeholder: "e.g. We are a B2B wholesale distributor. Peak season is Q4. We serve 200+ retail clients across 3 regions.", hint: "Domain knowledge — products, policies, specialties, seasonality." },
  { key: "aiQueryReasoning", label: "Query Reasoning", section: "tools", rows: 4, placeholder: "e.g.\n- Consider which date range makes sense\n- For financial questions, cross-check against the payments table", hint: "How the AI should think before calling tools." },
  { key: "aiToolGuidelines", label: "Tool Usage Guidelines", section: "tools", rows: 5, placeholder: "e.g.\n- For inventory questions, query inventory + inventory_transactions\n- For customer insights, check orders + payments together", hint: "When to use which tool — overrides default selection." },
  { key: "aiGuardrails", label: "Guardrails", section: "safety", rows: 5, placeholder: "e.g.\n- Never disclose raw employee salary data\n- Don't make promises about delivery dates\n- Escalate when user is frustrated", hint: "Safety rules, boundaries, topics to avoid, escalation policies." },
  { key: "aiInsightsInstructions", label: "Insights Analysis", section: "agents", rows: 5, placeholder: "e.g.\n- Focus on conversion rates and seasonal demand\n- Flag month-over-month changes >20%", hint: "Custom instructions for demand forecasting, anomaly detection, trends." },
  { key: "aiReportInstructions", label: "Report Generation", section: "agents", rows: 5, placeholder: "e.g.\n1. Executive Summary with key highlights\n2. Revenue breakdown by category\n3. Forward-looking recommendations", hint: "Custom structure and focus areas for generated reports." },
] as const;

const AI_SECTIONS = [
  { key: "identity", icon: "💎", title: "Identity & Role", desc: "Define who the AI is, its operating environment, and objectives.", color: "#7c3aed" },
  { key: "style", icon: "🎨", title: "Communication Style", desc: "Control tone, formatting, and response structure.", color: "#ec4899" },
  { key: "knowledge", icon: "🏢", title: "Business Knowledge", desc: "Give the AI context about your business for more relevant answers.", color: "#f59e0b" },
  { key: "tools", icon: "🔧", title: "Tool & Query Behavior", desc: "Guide how the AI reasons about questions and selects tools.", color: "#3b82f6" },
  { key: "safety", icon: "🛡️", title: "Safety & Guardrails", desc: "Set boundaries and safety rules the AI must follow.", color: "#ef4444" },
  { key: "agents", icon: "📊", title: "Specialized Agent Instructions", desc: "Customize the insights analyzer and report generator behavior.", color: "#059669" },
] as const;

const AI_DEFAULTS: Record<string, string> = Object.fromEntries(AI_FIELDS.map(f => [f.key, ""]));

/* ── Smart Textarea with character count, focus ring, and dirty indicator ── */
function PromptTextarea({ field, value, originalValue, onChange }: {
  field: typeof AI_FIELDS[number];
  value: string;
  originalValue: string;
  onChange: (val: string) => void;
}) {
  const [focused, setFocused] = useState(false);
  const isDirty = value !== originalValue;
  const charCount = value.length;
  const hasContent = value.trim().length > 0;

  return (
    <div className={`pe-field ${focused ? "pe-field--focused" : ""} ${hasContent ? "pe-field--filled" : ""} ${isDirty ? "pe-field--dirty" : ""}`}>
      <div className="pe-field__header">
        <label className="pe-field__label">
          {hasContent && <span className="pe-field__check">✓</span>}
          {field.label}
        </label>
        <div className="pe-field__meta">
          {isDirty && <span className="pe-field__dirty-badge">Modified</span>}
          {charCount > 0 && <span className="pe-field__chars">{charCount.toLocaleString()} chars</span>}
        </div>
      </div>
      <textarea
        className="pe-field__textarea"
        rows={field.rows}
        placeholder={field.placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      <p className="pe-field__hint">{field.hint}</p>
    </div>
  );
}

/* ── Collapsible Section with animated expand/collapse ── */
function PromptSection({ section, fields, settings, originals, onUpdate, isExpanded, onToggle }: {
  section: typeof AI_SECTIONS[number];
  fields: typeof AI_FIELDS[number][];
  settings: Record<string, string>;
  originals: Record<string, string>;
  onUpdate: (key: string, val: string) => void;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const filledCount = fields.filter(f => (settings[f.key] ?? "").trim().length > 0).length;
  const dirtyCount = fields.filter(f => settings[f.key] !== originals[f.key]).length;

  return (
    <div className={`pe-section ${isExpanded ? "pe-section--open" : ""}`} style={{ "--section-color": section.color } as React.CSSProperties}>
      <button className="pe-section__header" onClick={onToggle} type="button">
        <div className="pe-section__title-group">
          <span className="pe-section__icon">{section.icon}</span>
          <div>
            <h3 className="pe-section__title">{section.title}</h3>
            <p className="pe-section__desc">{section.desc}</p>
          </div>
        </div>
        <div className="pe-section__indicators">
          <span className={`pe-section__pill ${filledCount === fields.length ? "pe-section__pill--complete" : filledCount > 0 ? "pe-section__pill--partial" : ""}`}>
            {filledCount}/{fields.length}
          </span>
          {dirtyCount > 0 && <span className="pe-section__pill pe-section__pill--dirty">{dirtyCount} unsaved</span>}
          <span className={`pe-section__chevron ${isExpanded ? "pe-section__chevron--open" : ""}`}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </span>
        </div>
      </button>
      <div className={`pe-section__body ${isExpanded ? "pe-section__body--open" : ""}`}>
        <div className="pe-section__fields">
          {fields.map(f => (
            <PromptTextarea key={f.key} field={f} value={settings[f.key] ?? ""} originalValue={originals[f.key] ?? ""} onChange={(val) => onUpdate(f.key, val)} />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Main AI Config Tab ── */
function AIConfigTab({ config, onSaved }: { config: AppConfig; onSaved?: () => void }) {
  const [settings, setSettings] = useState<Record<string, string>>({ ...AI_DEFAULTS });
  const [originals, setOriginals] = useState<Record<string, string>>({ ...AI_DEFAULTS });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(["identity"]));
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const showToast = useCallback((type: "success" | "error", text: string) => {
    setToast({ type, text });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);

  const toggleSection = useCallback((key: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }, []);

  // Fetch settings from API
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/settings", { credentials: "same-origin" });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        const json = await res.json();
        if (!cancelled && json.data) {
          const loaded = Object.fromEntries(
            Object.keys(AI_DEFAULTS).map(k => [k, json.data[k] ?? ""])
          );
          setSettings(prev => ({ ...prev, ...loaded }));
          setOriginals(prev => ({ ...prev, ...loaded }));
        }
      } catch (err: unknown) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : "Failed to load settings";
          setLoadError(msg);
          console.error("[PromptEngineering] Load error:", msg);
        }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const updateField = useCallback((key: string, val: string) => {
    setSettings(prev => ({ ...prev, [key]: val }));
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(settings),
      });
      if (res.ok) {
        setOriginals({ ...settings });
        showToast("success", "AI configuration saved successfully!");
        onSaved?.();
      } else {
        const json = await res.json().catch(() => null);
        showToast("error", json?.error ?? `Failed to save (HTTP ${res.status})`);
      }
    } catch {
      showToast("error", "Network error — check your connection.");
    }
    setSaving(false);
  }, [settings, showToast, onSaved]);

  const handleReset = useCallback(() => {
    setSettings({ ...originals });
  }, [originals]);

  // Derived state
  const filledCount = useMemo(() =>
    Object.values(settings).filter(v => v.trim().length > 0).length
  , [settings]);
  const totalCount = AI_FIELDS.length;
  const isDirty = useMemo(() =>
    Object.keys(AI_DEFAULTS).some(k => settings[k] !== originals[k])
  , [settings, originals]);
  const dirtyCount = useMemo(() =>
    Object.keys(AI_DEFAULTS).filter(k => settings[k] !== originals[k]).length
  , [settings, originals]);

  // Loading state
  if (loading) {
    return (
      <div className="pe-loading">
        <div className="pe-loading__spinner" />
        <p>Loading AI configuration…</p>
      </div>
    );
  }

  // Error state with retry
  if (loadError) {
    return (
      <div className="pe-error">
        <span className="pe-error__icon">⚠️</span>
        <h3>Failed to load settings</h3>
        <p>{loadError}</p>
        <button className="btn btn-primary" onClick={() => window.location.reload()}>
          Retry
        </button>
      </div>
    );
  }

  const progressPct = totalCount > 0 ? (filledCount / totalCount) * 100 : 0;

  return (
    <div className="pe-container">
      {/* Toast notification */}
      {toast && (
        <div className={`pe-toast pe-toast--${toast.type}`} role="alert">
          <span className="pe-toast__icon">{toast.type === "success" ? "✅" : "❌"}</span>
          <span className="pe-toast__text">{toast.text}</span>
          <button className="pe-toast__close" onClick={() => setToast(null)}>×</button>
        </div>
      )}

      {/* Progress header */}
      <div className="pe-progress">
        <div className="pe-progress__info">
          <div className="pe-progress__stats">
            <span className={`pe-progress__count ${filledCount === totalCount ? "pe-progress__count--complete" : ""}`}>
              {filledCount}/{totalCount}
            </span>
            <span className="pe-progress__label">fields configured</span>
          </div>
          {isDirty && (
            <span className="pe-progress__dirty">
              {dirtyCount} unsaved {dirtyCount === 1 ? "change" : "changes"}
            </span>
          )}
        </div>
        <div className="pe-progress__bar">
          <div
            className={`pe-progress__fill ${filledCount === totalCount ? "pe-progress__fill--complete" : ""}`}
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Sections */}
      <div className="pe-sections">
        {AI_SECTIONS.map(section => {
          const sectionFields = AI_FIELDS.filter(f => f.section === section.key);
          return (
            <PromptSection
              key={section.key}
              section={section}
              fields={sectionFields}
              settings={settings}
              originals={originals}
              onUpdate={updateField}
              isExpanded={expandedSections.has(section.key)}
              onToggle={() => toggleSection(section.key)}
            />
          );
        })}
      </div>

      {/* Info box */}
      <div className="pe-info">
        <div className="pe-info__icon">💡</div>
        <div className="pe-info__content">
          <strong>How it works:</strong> These settings are loaded by AI agents at request time.
          Changes take effect immediately — no redeployment needed. Leave any field empty to use built-in defaults.
          The AI always knows your configured terminology ({config.labels.product}, {config.labels.order}, etc.) and currency ({config.currency}) automatically.
        </div>
      </div>

      {/* Sticky action bar */}
      <div className={`pe-actions ${isDirty ? "pe-actions--visible" : ""}`}>
        <div className="pe-actions__inner">
          {isDirty && (
            <button className="btn pe-actions__reset" onClick={handleReset} disabled={saving} type="button">
              Discard Changes
            </button>
          )}
          <button className="btn btn-primary pe-actions__save" onClick={handleSave} disabled={saving || !isDirty} type="button">
            {saving ? (
              <><span className="pe-actions__spinner" /> Saving…</>
            ) : (
              <>💾 Save AI Configuration</>
            )}
          </button>
        </div>
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
  updatedAt?: string;
}

/** Validate agent config fields — returns array of error strings (empty = valid) */
function validateAgentConfig(edit: AgentConfig): string[] {
  const errors: string[] = [];
  const temp = edit.temperature != null ? parseFloat(String(edit.temperature)) : null;
  if (temp != null && (isNaN(temp) || temp < 0 || temp > 2))
    errors.push("Temperature must be between 0.00 and 2.00");
  if (edit.maxSteps != null && (edit.maxSteps < 1 || edit.maxSteps > 20))
    errors.push("Max Steps must be between 1 and 20");
  if (edit.timeoutMs != null && (edit.timeoutMs < 5000 || edit.timeoutMs > 300000))
    errors.push("Timeout must be between 5,000 and 300,000 ms");
  return errors;
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
    // Validate before saving
    const errors = validateAgentConfig(agent);
    if (errors.length > 0) {
      setMessage({ type: "error", text: errors.join(". ") });
      return;
    }
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

  const handleReset = async (agentName: string) => {
    if (!confirm(`Reset ${editState[agentName]?.displayName ?? agentName} to default settings?`)) return;
    setSaving(agentName);
    setMessage(null);
    try {
      // Re-seed defaults then reload
      await fetch("/api/agent-configs/seed", { method: "POST" });
      // Delete & re-seed for this specific agent by setting defaults
      const res = await fetch(`/api/agent-configs/${agentName}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resetToDefaults: true }),
      });
      if (res.ok) {
        setMessage({ type: "success", text: `${agentName} reset to defaults!` });
        loadAgents();
      }
    } catch {
      setMessage({ type: "error", text: "Failed to reset." });
    }
    setSaving(null);
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
                    <p className="text-muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
                      {meta.role}
                      {agent.updatedAt && (
                        <span style={{ marginLeft: 8, fontSize: 11, opacity: 0.7 }}>
                          · Updated {new Date(agent.updatedAt).toLocaleDateString()}
                        </span>
                      )}
                    </p>
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

                  {/* Validation errors */}
                  {validateAgentConfig(edit).length > 0 && (
                    <div className="alert alert-error" style={{ marginTop: 12, fontSize: 13 }}>
                      {validateAgentConfig(edit).map((e, i) => <div key={i}>⚠️ {e}</div>)}
                    </div>
                  )}

                  {/* Save + Reset buttons */}
                  <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
                    <button className="btn btn-primary" onClick={() => handleSave(agent.agentName)} disabled={saving === agent.agentName || validateAgentConfig(edit).length > 0}>
                      {saving === agent.agentName ? "Saving…" : `💾 Save ${edit.displayName}`}
                    </button>
                    <button className="btn btn-secondary" onClick={() => handleReset(agent.agentName)} disabled={saving === agent.agentName} title="Reset this agent to factory defaults">
                      ↺ Reset Defaults
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
type ToolType = "server" | "client" | "mcp";

interface CustomTool {
  id?: string;
  toolType: ToolType;
  metadata?: Record<string, unknown>;
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
  const [seeding, setSeeding] = useState(false);
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
      body: JSON.stringify({ isActive: !tool.isActive }),
    });
    loadTools();
  };

  const handleSeedTools = async () => {
    setSeeding(true);
    setMessage(null);
    try {
      const res = await fetch("/api/custom-tools/seed", { method: "POST" });
      const json = await res.json();
      if (res.ok) {
        const count = json.data?.seeded ?? 0;
        setMessage({ type: "success", text: count > 0 ? `${count} starter tools created!` : "All starter tools already exist." });
        loadTools();
      } else {
        setMessage({ type: "error", text: json.error || "Failed to seed tools." });
      }
    } catch {
      setMessage({ type: "error", text: "Network error seeding tools." });
    }
    setSeeding(false);
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
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <button className="btn btn-sm btn-secondary" onClick={handleSeedTools} disabled={seeding} title="Create default starter tools" style={{ fontSize: 11 }}>
                {seeding ? "…" : "🌱 Seed"}
              </button>
              {(["all", "server", "client"] as const).map((f) => (
                <button key={f} className={`btn btn-sm ${filter === f ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => setFilter(f)} style={{ fontSize: 11, textTransform: "capitalize" }}>
                  {f === "all" ? "All" : f === "server" ? "🌐 Server" : "📱 Client"}
                </button>
              ))}
            </div>
          </div>

          {filteredTools.length === 0 ? (
            <div>
              <p className="text-muted">{tools.length === 0 ? "No custom tools defined yet." : "No tools match the filter."}</p>
              {tools.length === 0 && (
                <button className="btn btn-primary btn-sm" onClick={handleSeedTools} disabled={seeding} style={{ marginTop: 8 }}>
                  {seeding ? "Seeding…" : "🌱 Seed Starter Tools"}
                </button>
              )}
            </div>
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

        {/* MCP Tools Section */}
        <McpToolsSection onTestTool={handleTest} />
      </div>
    </div>
  );
}

/* ===== MCP TOOLS SECTION ===== */

function McpToolsSection({ onTestTool }: { onTestTool?: (id: string) => void }) {
  const [mcpTools, setMcpTools] = useState<CustomTool[]>([]);
  const [seeding, setSeeding] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, string | null>>({});
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [editingTool, setEditingTool] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, unknown>>({});

  const loadMcpTools = async () => {
    try {
      const res = await fetch("/api/custom-tools/mcp");
      const json = await res.json();
      if (json.data) setMcpTools(json.data);
    } catch { /* ignore */ }
  };

  useEffect(() => { loadMcpTools(); }, []);

  const handleSeedMcp = async () => {
    setSeeding(true);
    setMessage(null);
    try {
      const res = await fetch("/api/custom-tools/seed-mcp", { method: "POST" });
      const json = await res.json();
      if (res.ok) {
        const count = json.seeded ?? 0;
        setMessage({ type: "success", text: count > 0 ? `${count} MCP integration(s) added!` : "All MCP integrations already exist." });
        loadMcpTools();
      } else {
        setMessage({ type: "error", text: json.error || "Failed to seed MCP tools." });
      }
    } catch {
      setMessage({ type: "error", text: "Network error seeding MCP tools." });
    }
    setSeeding(false);
  };

  const handleToggle = async (tool: CustomTool) => {
    try {
      await fetch(`/api/custom-tools/${tool.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !tool.isActive }),
      });
      loadMcpTools();
    } catch { /* ignore */ }
  };

  const handleTestMcp = async (tool: CustomTool) => {
    setTesting(tool.id!);
    setTestResult((prev) => ({ ...prev, [tool.id!]: null }));
    try {
      const meta = (tool.metadata ?? {}) as Record<string, unknown>;
      const params = meta.mcpType === "weather"
        ? { location: (meta.location as string) ?? "Nairobi" }
        : { symbol: (meta.defaultSymbol as string) ?? "SCOM" };

      const res = await fetch(`/api/custom-tools/${tool.id}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ params }),
      });
      const json = await res.json();
      setTestResult((prev) => ({ ...prev, [tool.id!]: JSON.stringify(json.data ?? json, null, 2) }));
    } catch (err: any) {
      setTestResult((prev) => ({ ...prev, [tool.id!]: `Error: ${err.message}` }));
    }
    setTesting(null);
  };

  const handleSaveConfig = async (tool: CustomTool) => {
    try {
      const updates: Record<string, unknown> = {};
      const meta = { ...(tool.metadata ?? {}) } as Record<string, unknown>;

      // Merge edit values into metadata
      if (editValues.location !== undefined) meta.location = editValues.location;
      if (editValues.latitude !== undefined) meta.latitude = Number(editValues.latitude);
      if (editValues.longitude !== undefined) meta.longitude = Number(editValues.longitude);
      if (editValues.timezone !== undefined) meta.timezone = editValues.timezone;
      if (editValues.forecastDays !== undefined) meta.forecastDays = Number(editValues.forecastDays);
      updates.metadata = meta;

      // Handle API key updates
      if (editValues.apiKey !== undefined) {
        updates.authConfig = { ...(tool.authConfig ?? {}), apiKey: editValues.apiKey };
      }

      await fetch(`/api/custom-tools/${tool.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      setMessage({ type: "success", text: `"${tool.label}" configuration saved!` });
      setEditingTool(null);
      setEditValues({});
      loadMcpTools();
    } catch {
      setMessage({ type: "error", text: "Failed to save configuration." });
    }
  };

  const handleDelete = async (tool: CustomTool) => {
    if (!confirm(`Remove MCP integration "${tool.label}"? You can re-add it later via Seed.`)) return;
    await fetch(`/api/custom-tools/${tool.id}`, { method: "DELETE" });
    loadMcpTools();
  };

  const getStatusIcon = (tool: CustomTool) => {
    const meta = (tool.metadata ?? {}) as Record<string, unknown>;
    if (!tool.isActive) return "⚪";
    if (meta.noApiKeyRequired) return "🟢";
    // Check if API key is configured
    const authCfg = (tool.authConfig ?? {}) as Record<string, string>;
    return authCfg.apiKey ? "🟢" : "🟡";
  };

  const getStatusText = (tool: CustomTool) => {
    const meta = (tool.metadata ?? {}) as Record<string, unknown>;
    if (!tool.isActive) return "Disabled";
    if (meta.noApiKeyRequired) return "Active — No key required";
    const authCfg = (tool.authConfig ?? {}) as Record<string, string>;
    return authCfg.apiKey ? "Active — API key configured" : "Needs API key";
  };

  const getCategoryIcon = (tool: CustomTool) => {
    const meta = (tool.metadata ?? {}) as Record<string, unknown>;
    switch (meta.category) {
      case "weather": return "🌤️";
      case "finance": return "📈";
      default: return "🔌";
    }
  };

  return (
    <div style={{ gridColumn: "1 / -1", marginTop: 16 }}>
      {message && (
        <div className={`alert alert-${message.type}`} style={{ marginBottom: 12 }}>
          {message.type === "success" ? "✅" : "❌"} {message.text}
        </div>
      )}

      <div className="card settings-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ margin: 0 }}>🔌 MCP Integrations ({mcpTools.length})</h3>
          <button className="btn btn-sm btn-primary" onClick={handleSeedMcp} disabled={seeding} style={{ fontSize: 11 }}>
            {seeding ? "…" : "🌱 Seed Defaults"}
          </button>
        </div>

        {mcpTools.length === 0 ? (
          <div style={{ textAlign: "center", padding: "24px 16px" }}>
            <p style={{ fontSize: 28, margin: "0 0 8px 0" }}>🔌</p>
            <p style={{ fontWeight: 600, margin: "0 0 4px 0" }}>No MCP integrations configured</p>
            <p className="text-muted" style={{ margin: "0 0 12px 0" }}>
              Click "Seed Defaults" to add pre-configured integrations for weather data and NSE stock market.
            </p>
            <button className="btn btn-primary btn-sm" onClick={handleSeedMcp} disabled={seeding}>
              {seeding ? "Seeding…" : "🌱 Seed Default Integrations"}
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {mcpTools.map((tool) => {
              const meta = (tool.metadata ?? {}) as Record<string, unknown>;
              const isEditing = editingTool === tool.id;

              return (
                <div key={tool.id} className={`tool-card ${!tool.isActive ? "tool-card-inactive" : ""}`}>
                  <div className="tool-card-header">
                    <div className="tool-card-title">
                      <span className="tool-card-type-badge">{getCategoryIcon(tool)} MCP</span>
                      <h4 style={{ margin: 0 }}>{tool.label}</h4>
                      <code className="tool-card-name">{tool.name}</code>
                    </div>
                    <div className="tool-card-actions">
                      <span title={getStatusText(tool)} style={{ cursor: "default" }}>{getStatusIcon(tool)}</span>
                      <button className="btn btn-sm" onClick={() => handleToggle(tool)}
                        title={tool.isActive ? "Deactivate" : "Activate"}>
                        {tool.isActive ? "Disable" : "Enable"}
                      </button>
                      <button className="btn btn-sm" onClick={() => {
                        setEditingTool(isEditing ? null : tool.id!);
                        setEditValues({});
                      }} title="Configure">⚙️</button>
                      <button className="btn btn-sm" onClick={() => handleTestMcp(tool)}
                        disabled={testing === tool.id} title="Test">
                        {testing === tool.id ? "…" : "▶️"}
                      </button>
                      <button className="btn btn-sm" onClick={() => handleDelete(tool)}
                        title="Remove" style={{ color: "var(--color-danger)" }}>🗑️</button>
                    </div>
                  </div>

                  <p className="tool-card-desc">{tool.description}</p>

                  <div className="tool-card-meta">
                    <span>Provider: {meta.provider as string ?? "—"}</span>
                    <span>Status: {getStatusText(tool)}</span>
                    {meta.category === "weather" && <span>Location: {meta.location as string ?? "—"}</span>}
                    {meta.category === "finance" && <span>Exchange: {meta.exchangeName as string ?? "—"}</span>}
                  </div>

                  {/* Inline config editor */}
                  {isEditing && (
                    <div style={{ marginTop: 12, padding: 12, background: "var(--bg-tertiary, #1a1a2e)", borderRadius: 6, border: "1px solid var(--color-border)" }}>
                      <h5 style={{ margin: "0 0 8px 0", fontSize: 13 }}>⚙️ Configuration</h5>

                      {meta.mcpType === "weather" && (
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
                          <div>
                            <label className="form-label" style={{ fontSize: 11 }}>Business Location</label>
                            <input type="text"
                              defaultValue={meta.location as string ?? "Nairobi"}
                              onChange={(e) => setEditValues((prev) => ({ ...prev, location: e.target.value }))}
                              placeholder="e.g. Mombasa" style={{ fontSize: 12 }} />
                          </div>
                          <div>
                            <label className="form-label" style={{ fontSize: 11 }}>Latitude</label>
                            <input type="number" step="0.0001"
                              defaultValue={meta.latitude as number ?? -1.2921}
                              onChange={(e) => setEditValues((prev) => ({ ...prev, latitude: e.target.value }))}
                              style={{ fontSize: 12 }} />
                          </div>
                          <div>
                            <label className="form-label" style={{ fontSize: 11 }}>Longitude</label>
                            <input type="number" step="0.0001"
                              defaultValue={meta.longitude as number ?? 36.8219}
                              onChange={(e) => setEditValues((prev) => ({ ...prev, longitude: e.target.value }))}
                              style={{ fontSize: 12 }} />
                          </div>
                          <div>
                            <label className="form-label" style={{ fontSize: 11 }}>Forecast Days</label>
                            <input type="number" min={1} max={16}
                              defaultValue={meta.forecastDays as number ?? 7}
                              onChange={(e) => setEditValues((prev) => ({ ...prev, forecastDays: e.target.value }))}
                              style={{ fontSize: 12 }} />
                            <span className="form-hint" style={{ fontSize: 10 }}>1–16 days</span>
                          </div>
                        </div>
                      )}

                      {meta.mcpType === "stock_market" && (
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                          <div>
                            <label className="form-label" style={{ fontSize: 11 }}>API Key (Marketstack)</label>
                            <input type="password"
                              defaultValue={(tool.authConfig as Record<string, string>)?.apiKey ?? ""}
                              onChange={(e) => setEditValues((prev) => ({ ...prev, apiKey: e.target.value }))}
                              placeholder="Your Marketstack API key"
                              style={{ fontSize: 12 }} />
                          </div>
                          <div>
                            <label className="form-label" style={{ fontSize: 11 }}>Setup</label>
                            <p className="text-muted" style={{ fontSize: 11, margin: 0 }}>
                              Get a free API key at{" "}
                              <a href={meta.setupUrl as string ?? "#"} target="_blank" rel="noopener noreferrer"
                                style={{ color: "var(--color-primary)" }}>
                                marketstack.com/signup/free
                              </a>{" "}
                              ({meta.freeTier as string ?? "100 requests/month"})
                            </p>
                          </div>
                        </div>
                      )}

                      <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                        <button className="btn btn-sm btn-primary" onClick={() => handleSaveConfig(tool)}>Save</button>
                        <button className="btn btn-sm btn-secondary" onClick={() => { setEditingTool(null); setEditValues({}); }}>Cancel</button>
                      </div>
                    </div>
                  )}

                  {/* Test result */}
                  {testResult[tool.id!] && (
                    <pre className="test-result-pre" style={{ marginTop: 8, maxHeight: 200 }}>
                      {testResult[tool.id!]}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <InfoBox>
        <strong>🔌 MCP Integrations</strong> are pre-configured external data sources the AI can query in real-time.
        <strong> Weather</strong> uses Open-Meteo (free, no API key) — configure your business location above.
        <strong> NSE Stocks</strong> uses Marketstack — requires a free API key from{" "}
        <a href="https://marketstack.com/signup/free" target="_blank" rel="noopener noreferrer"
          style={{ color: "inherit", textDecoration: "underline" }}>marketstack.com</a>.
        More integrations will be added in future updates. Tools take effect immediately — no redeployment needed.
      </InfoBox>
    </div>
  );
}

/* ===== PROMPT TEMPLATES TAB ===== */
interface PromptTemplate {
  id: string;
  agentName: string;
  sectionKey: string;
  template: string;
  version: number;
  isActive: boolean;
  createdBy: string | null;
  changeNotes: string | null;
  createdAt: string;
}

function PromptTemplatesTab() {
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filterAgent, setFilterAgent] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    agentName: "data-science",
    sectionKey: "system",
    template: "",
    changeNotes: "",
  });
  const [testInput, setTestInput] = useState("");
  const [testResult, setTestResult] = useState("");
  const [testing, setTesting] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [seedMessage, setSeedMessage] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);

  const fetchTemplates = async () => {
    setLoading(true);
    try {
      const url = filterAgent
        ? `/api/admin/prompts/${filterAgent}`
        : "/api/admin/prompts";
      const res = await fetch(url, { credentials: "include" });
      const data = await res.json();
      setTemplates(data.data ?? data.templates ?? []);
    } catch {
      setError("Failed to load prompt templates");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTemplates();
  }, [filterAgent]);

  const handleCreate = async () => {
    try {
      const res = await fetch("/api/admin/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(formData),
      });
      if (!res.ok) throw new Error("Failed to create template");
      setShowForm(false);
      setFormData({ agentName: "data-science", sectionKey: "system", template: "", changeNotes: "" });
      fetchTemplates();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleActivate = async (id: string) => {
    try {
      await fetch(`/api/admin/prompts/${id}/activate`, {
        method: "PUT",
        credentials: "include",
      });
      fetchTemplates();
    } catch {
      setError("Failed to activate template");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this template version?")) return;
    try {
      await fetch(`/api/admin/prompts/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      fetchTemplates();
    } catch {
      setError("Failed to delete template");
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult("");
    try {
      const res = await fetch("/api/admin/prompts/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          agentName: formData.agentName,
          testMessage: testInput || "Hello, what can you do?",
          overrides: formData.template
            ? { [formData.sectionKey]: formData.template }
            : undefined,
        }),
      });
      const data = await res.json();
      setTestResult(data.response ?? JSON.stringify(data, null, 2));
    } catch (err: any) {
      setTestResult(`Error: ${err.message}`);
    } finally {
      setTesting(false);
    }
  };

  const agents = ["*", "data-science", "insights-analyzer", "report-generator", "knowledge-base"];

  const handleSeedTemplates = async () => {
    setSeeding(true);
    setSeedMessage({ type: "info", text: "🤖 AI is generating industry-specific prompt templates… this may take 15–30 seconds." });
    try {
      const res = await fetch("/api/admin/prompts/seed", {
        method: "POST",
        credentials: "include",
      });
      const json = await res.json();
      if (res.ok) {
        const count = json.seeded ?? 0;
        setSeedMessage({
          type: count > 0 ? "success" : "info",
          text: json.message || `✅ AI seeded ${count} template(s).`,
        });
        fetchTemplates();
      } else {
        setSeedMessage({ type: "error", text: json.error || "Failed to seed templates." });
      }
    } catch (err: any) {
      setSeedMessage({ type: "error", text: `Network error: ${err.message}` });
    }
    setSeeding(false);
  };

  return (
    <div className="admin-section">
      <div className="section-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3>📋 Prompt Templates</h3>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={handleSeedTemplates}
            disabled={seeding}
            title="Use AI to generate industry-specific prompt templates based on your business profile"
            style={{ fontSize: 11 }}
          >
            {seeding ? "🤖 Generating…" : "🌱 AI Seed"}
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setShowForm(!showForm)}>
            {showForm ? "Cancel" : "+ New Template"}
          </button>
        </div>
      </div>

      {seedMessage && (
        <div className={`alert alert-${seedMessage.type}`} style={{ marginBottom: 12 }}>
          {seedMessage.text}
          {seedMessage.type !== "info" && (
            <button
              onClick={() => setSeedMessage(null)}
              style={{ float: "right", background: "none", border: "none", cursor: "pointer", fontSize: 14 }}
            >
              ✕
            </button>
          )}
        </div>
      )}

      {error && <div className="alert alert-error">{error}</div>}

      {/* Agent filter */}
      <div style={{ marginBottom: 12 }}>
        <select value={filterAgent} onChange={(e) => setFilterAgent(e.target.value)}
          style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid var(--color-border)" }}>
          <option value="">All Agents</option>
          {agents.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="card" style={{ marginBottom: 16, padding: 16 }}>
          <h4>New Prompt Template</h4>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <label>Agent</label>
              <select value={formData.agentName} onChange={(e) => setFormData({ ...formData, agentName: e.target.value })}
                style={{ width: "100%", padding: "6px 10px", borderRadius: 6, border: "1px solid var(--color-border)" }}>
                {agents.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>
            <div>
              <label>Section Key</label>
              <input value={formData.sectionKey} onChange={(e) => setFormData({ ...formData, sectionKey: e.target.value })}
                style={{ width: "100%", padding: "6px 10px", borderRadius: 6, border: "1px solid var(--color-border)" }}
                placeholder="e.g. system, guardrails, examples" />
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label>Template Content</label>
            <textarea rows={8} value={formData.template} onChange={(e) => setFormData({ ...formData, template: e.target.value })}
              style={{ width: "100%", fontFamily: "monospace", fontSize: 12, padding: 10, borderRadius: 6, border: "1px solid var(--color-border)", resize: "vertical" }}
              placeholder="Enter prompt template text..." />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label>Change Notes</label>
            <input value={formData.changeNotes} onChange={(e) => setFormData({ ...formData, changeNotes: e.target.value })}
              style={{ width: "100%", padding: "6px 10px", borderRadius: 6, border: "1px solid var(--color-border)" }}
              placeholder="Brief description of changes" />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary btn-sm" onClick={handleCreate}>Save Template</button>
            <button className="btn btn-secondary btn-sm" onClick={() => { setShowForm(false); }}>Cancel</button>
          </div>

          {/* Test section */}
          <div style={{ marginTop: 16, borderTop: "1px solid var(--color-border)", paddingTop: 12 }}>
            <h4>🧪 Test Prompt</h4>
            <input value={testInput} onChange={(e) => setTestInput(e.target.value)}
              style={{ width: "100%", padding: "6px 10px", borderRadius: 6, border: "1px solid var(--color-border)", marginBottom: 8 }}
              placeholder="Test message (e.g. 'What are our top products?')" />
            <button className="btn btn-secondary btn-sm" onClick={handleTest} disabled={testing}>
              {testing ? "Testing..." : "Run Test"}
            </button>
            {testResult && (
              <pre style={{ marginTop: 8, background: "var(--color-bg-secondary)", padding: 12, borderRadius: 6, fontSize: 12, maxHeight: 300, overflow: "auto", whiteSpace: "pre-wrap" }}>
                {testResult}
              </pre>
            )}
          </div>
        </div>
      )}

      {/* Templates list */}
      {loading ? (
        <div className="text-muted">Loading templates...</div>
      ) : templates.length === 0 ? (
        <div className="empty-state" style={{ textAlign: "center", padding: "32px 16px" }}>
          <p className="text-muted" style={{ marginBottom: 12 }}>No prompt templates yet.</p>
          <p className="text-muted" style={{ fontSize: 12, marginBottom: 16 }}>
            Set your industry in <strong>Settings → Business Identity</strong>, then click <strong>AI Seed</strong> to
            auto-generate industry-specific templates using your configured LLM.
          </p>
          <button className="btn btn-primary btn-sm" onClick={handleSeedTemplates} disabled={seeding} style={{ marginTop: 4 }}>
            {seeding ? "🤖 Generating…" : "🌱 AI Seed Templates"}
          </button>
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Agent</th>
              <th>Section</th>
              <th>Version</th>
              <th>Active</th>
              <th>Notes</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {templates.map((t) => (
              <tr key={t.id}>
                <td><code>{t.agentName}</code></td>
                <td>{t.sectionKey}</td>
                <td>v{t.version}</td>
                <td>
                  <span style={{ color: t.isActive ? "var(--color-success)" : "var(--color-text-muted)" }}>
                    {t.isActive ? "✅ Active" : "—"}
                  </span>
                </td>
                <td className="text-muted" style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {t.changeNotes || "—"}
                </td>
                <td className="text-muted">{new Date(t.createdAt).toLocaleDateString()}</td>
                <td>
                  <div style={{ display: "flex", gap: 4 }}>
                    {!t.isActive && (
                      <button className="btn btn-sm" onClick={() => handleActivate(t.id)} title="Activate this version">
                        ▶️
                      </button>
                    )}
                    <button className="btn btn-sm btn-danger" onClick={() => handleDelete(t.id)} title="Delete">
                      🗑️
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <InfoBox>
        <strong>💡 Prompt versioning</strong> lets you track and roll back changes to agent system prompts.
        Each save creates a new version. Only one version per agent+section can be active at a time.
        Use <strong>🌱 AI Seed</strong> to auto-generate industry-specific templates based on your business profile (Settings → Industry).
        Use the <strong>Test</strong> feature to preview how prompt changes affect agent responses before activating.
      </InfoBox>
    </div>
  );
}

/* ===== EVAL DASHBOARD TAB ===== */
interface EvalResultRow {
  id: string;
  agentName: string;
  evalName: string;
  passed: boolean;
  score: string | null;
  reason: string | null;
  createdAt: string;
}

interface EvalSummaryRow {
  agentName: string;
  evalName: string;
  totalRuns: number;
  passCount: number;
  failCount: number;
  passRate: number;
  avgScore: number | null;
}

interface EvalTrendRow {
  date: string;
  totalRuns: number;
  passCount: number;
  failCount: number;
  passRate: number;
  avgScore: number | null;
}

function EvalDashboardTab() {
  const [summaries, setSummaries] = useState<EvalSummaryRow[]>([]);
  const [trends, setTrends] = useState<EvalTrendRow[]>([]);
  const [recentResults, setRecentResults] = useState<EvalResultRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [runningEvals, setRunningEvals] = useState(false);
  const [runResult, setRunResult] = useState<any>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [sumRes, trendRes, recentRes] = await Promise.all([
        fetch("/api/admin/evals/summary", { credentials: "include" }),
        fetch("/api/admin/evals/trends?days=14", { credentials: "include" }),
        fetch("/api/admin/evals?limit=20", { credentials: "include" }),
      ]);

      const sumData = await sumRes.json();
      const trendData = await trendRes.json();
      const recentData = await recentRes.json();

      setSummaries(sumData.summaries ?? []);
      setTrends(trendData.trends ?? []);
      setRecentResults(recentData.results ?? []);
    } catch {
      setError("Failed to load eval data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleRunEvals = async () => {
    setRunningEvals(true);
    setRunResult(null);
    try {
      const res = await fetch("/api/admin/evals/run", {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      setRunResult(data);
      fetchData(); // Refresh dashboard
    } catch (err: any) {
      setRunResult({ error: err.message });
    } finally {
      setRunningEvals(false);
    }
  };

  const overallPassRate = summaries.length
    ? Math.round(
        (summaries.reduce((s, r) => s + r.passCount, 0) /
          Math.max(summaries.reduce((s, r) => s + r.totalRuns, 0), 1)) *
          100
      )
    : 0;

  const totalRuns = summaries.reduce((s, r) => s + r.totalRuns, 0);

  return (
    <div className="admin-section">
      <div className="section-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3>📊 Eval Dashboard</h3>
        <button
          className="btn btn-primary btn-sm"
          onClick={handleRunEvals}
          disabled={runningEvals}
        >
          {runningEvals ? "Running..." : "▶️ Run Evals Now"}
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {runResult && (
        <div className="card" style={{ marginBottom: 16, padding: 12 }}>
          <strong>Eval Run Complete:</strong>{" "}
          {runResult.error ? (
            <span style={{ color: "var(--color-error)" }}>{runResult.error}</span>
          ) : (
            <span>
              {runResult.passed}/{runResult.totalTests} passed
              ({runResult.failed} failed)
            </span>
          )}
        </div>
      )}

      {loading ? (
        <div className="text-muted">Loading eval data...</div>
      ) : (
        <>
          {/* Summary cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 20 }}>
            <div className="card" style={{ padding: 16, textAlign: "center" }}>
              <div style={{ fontSize: 28, fontWeight: 700 }}>{totalRuns}</div>
              <div className="text-muted">Total Runs</div>
            </div>
            <div className="card" style={{ padding: 16, textAlign: "center" }}>
              <div style={{ fontSize: 28, fontWeight: 700, color: overallPassRate >= 80 ? "var(--color-success)" : overallPassRate >= 50 ? "var(--color-warning)" : "var(--color-error)" }}>
                {overallPassRate}%
              </div>
              <div className="text-muted">Pass Rate</div>
            </div>
            <div className="card" style={{ padding: 16, textAlign: "center" }}>
              <div style={{ fontSize: 28, fontWeight: 700 }}>{summaries.length}</div>
              <div className="text-muted">Eval Types</div>
            </div>
          </div>

          {/* Per-eval summary table */}
          {summaries.length > 0 && (
            <>
              <h4>Eval Summary</h4>
              <table className="data-table" style={{ marginBottom: 20 }}>
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th>Eval</th>
                    <th>Runs</th>
                    <th>Pass Rate</th>
                    <th>Avg Score</th>
                  </tr>
                </thead>
                <tbody>
                  {summaries.map((s, i) => (
                    <tr key={i}>
                      <td><code>{s.agentName}</code></td>
                      <td>{s.evalName}</td>
                      <td>{s.totalRuns}</td>
                      <td>
                        <span style={{ color: s.passRate >= 0.8 ? "var(--color-success)" : s.passRate >= 0.5 ? "var(--color-warning)" : "var(--color-error)" }}>
                          {Math.round(s.passRate * 100)}%
                        </span>
                      </td>
                      <td>{s.avgScore != null ? s.avgScore.toFixed(2) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {/* 14-day trend (simple text table) */}
          {trends.length > 0 && (
            <>
              <h4>14-Day Trend</h4>
              <div style={{ display: "flex", gap: 4, marginBottom: 20, flexWrap: "wrap" }}>
                {trends.map((t, i) => {
                  const pct = Math.round(t.passRate * 100);
                  const bg = pct >= 80 ? "var(--color-success)" : pct >= 50 ? "var(--color-warning)" : "var(--color-error)";
                  return (
                    <div key={i} title={`${t.date}: ${pct}% pass (${t.totalRuns} runs)`}
                      style={{ width: 24, height: 40, background: bg, opacity: Math.max(0.3, pct / 100), borderRadius: 4, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
                      <span style={{ fontSize: 9, color: "#fff" }}>{t.totalRuns}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* Recent results */}
          <h4>Recent Results</h4>
          {recentResults.length === 0 ? (
            <div className="text-muted">No eval results yet. Run evals or wait for the daily scheduled run.</div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Agent</th>
                  <th>Eval</th>
                  <th>Result</th>
                  <th>Score</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {recentResults.map((r) => (
                  <tr key={r.id}>
                    <td className="text-muted">{new Date(r.createdAt).toLocaleString()}</td>
                    <td><code>{r.agentName}</code></td>
                    <td>{r.evalName}</td>
                    <td>
                      <span style={{ color: r.passed ? "var(--color-success)" : "var(--color-error)" }}>
                        {r.passed ? "✅ Pass" : "❌ Fail"}
                      </span>
                    </td>
                    <td>{r.score != null ? Number(r.score).toFixed(2) : "—"}</td>
                    <td className="text-muted" style={{ maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis" }}>
                      {r.reason || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      <InfoBox>
        <strong>📊 Eval Dashboard</strong> tracks automated quality checks for all AI agents.
        Evals run automatically after each response and daily at 3 AM.
        Click <strong>Run Evals Now</strong> to trigger a manual evaluation sweep.
        Monitor pass rates and trends to catch regressions early.
      </InfoBox>
    </div>
  );
}

/* ===== FEW-SHOT EXAMPLES TAB ===== */
interface FewShotExample {
  id: string;
  category: string;
  userInput: string;
  expectedBehavior: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
}

function FewShotExamplesTab() {
  const [examples, setExamples] = useState<FewShotExample[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    category: "general",
    userInput: "",
    expectedBehavior: "",
    isActive: true,
    sortOrder: 0,
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const [exRes, catRes] = await Promise.all([
        fetch(
          filterCategory
            ? `/api/admin/examples?category=${filterCategory}`
            : "/api/admin/examples",
          { credentials: "include" }
        ),
        fetch("/api/admin/examples/categories", { credentials: "include" }),
      ]);
      const exData = await exRes.json();
      const catData = await catRes.json();
      setExamples(exData.examples ?? []);
      setCategories(catData.categories ?? []);
    } catch {
      setError("Failed to load examples");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [filterCategory]);

  const handleSave = async () => {
    try {
      const url = editingId
        ? `/api/admin/examples/${editingId}`
        : "/api/admin/examples";
      const method = editingId ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(formData),
      });
      if (!res.ok) throw new Error("Failed to save example");
      setShowForm(false);
      setEditingId(null);
      setFormData({ category: "general", userInput: "", expectedBehavior: "", isActive: true, sortOrder: 0 });
      fetchData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleEdit = (ex: FewShotExample) => {
    setEditingId(ex.id);
    setFormData({
      category: ex.category,
      userInput: ex.userInput,
      expectedBehavior: ex.expectedBehavior,
      isActive: ex.isActive,
      sortOrder: ex.sortOrder,
    });
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this example?")) return;
    try {
      await fetch(`/api/admin/examples/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      fetchData();
    } catch {
      setError("Failed to delete example");
    }
  };

  return (
    <div className="admin-section">
      <div className="section-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3>💡 Few-Shot Examples</h3>
        <button className="btn btn-primary btn-sm" onClick={() => {
          setShowForm(!showForm);
          setEditingId(null);
          setFormData({ category: "general", userInput: "", expectedBehavior: "", isActive: true, sortOrder: 0 });
        }}>
          {showForm ? "Cancel" : "+ New Example"}
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {/* Category filter */}
      <div style={{ marginBottom: 12 }}>
        <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}
          style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid var(--color-border)" }}>
          <option value="">All Categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <span className="text-muted" style={{ marginLeft: 8 }}>
          {examples.length} example{examples.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Create/Edit form */}
      {showForm && (
        <div className="card" style={{ marginBottom: 16, padding: 16 }}>
          <h4>{editingId ? "Edit Example" : "New Example"}</h4>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <label>Category</label>
              <input value={formData.category} onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                style={{ width: "100%", padding: "6px 10px", borderRadius: 6, border: "1px solid var(--color-border)" }}
                placeholder="e.g. general, sales-query, inventory" />
            </div>
            <div>
              <label>Sort Order</label>
              <input type="number" value={formData.sortOrder} onChange={(e) => setFormData({ ...formData, sortOrder: Number(e.target.value) })}
                style={{ width: "100%", padding: "6px 10px", borderRadius: 6, border: "1px solid var(--color-border)" }} />
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label>User Input (example question/request)</label>
            <textarea rows={3} value={formData.userInput} onChange={(e) => setFormData({ ...formData, userInput: e.target.value })}
              style={{ width: "100%", fontFamily: "monospace", fontSize: 12, padding: 10, borderRadius: 6, border: "1px solid var(--color-border)", resize: "vertical" }}
              placeholder='e.g. "What were last month total sales?"' />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label>Expected Behavior (how the AI should respond)</label>
            <textarea rows={4} value={formData.expectedBehavior} onChange={(e) => setFormData({ ...formData, expectedBehavior: e.target.value })}
              style={{ width: "100%", fontFamily: "monospace", fontSize: 12, padding: 10, borderRadius: 6, border: "1px solid var(--color-border)", resize: "vertical" }}
              placeholder='e.g. "Use the query_database tool to run a SUM query on the orders table for the last 30 days, then present the total with currency formatting."' />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label>
              <input type="checkbox" checked={formData.isActive} onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })} />{" "}
              Active
            </label>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary btn-sm" onClick={handleSave}>
              {editingId ? "Update" : "Create"} Example
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => { setShowForm(false); setEditingId(null); }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Examples list */}
      {loading ? (
        <div className="text-muted">Loading examples...</div>
      ) : examples.length === 0 ? (
        <div className="text-muted">No few-shot examples yet. Add examples to teach the AI how to handle specific queries.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {examples.map((ex) => (
            <div key={ex.id} className="card" style={{ padding: 12, opacity: ex.isActive ? 1 : 0.5 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                    <span style={{ background: "var(--color-bg-secondary)", padding: "2px 8px", borderRadius: 12, fontSize: 11 }}>
                      {ex.category}
                    </span>
                    {!ex.isActive && (
                      <span className="text-muted" style={{ fontSize: 11 }}>inactive</span>
                    )}
                  </div>
                  <div style={{ marginBottom: 4 }}>
                    <strong>Q: </strong>
                    <span style={{ fontFamily: "monospace", fontSize: 13 }}>{ex.userInput}</span>
                  </div>
                  <div className="text-muted" style={{ fontSize: 13 }}>
                    <strong>A: </strong>{ex.expectedBehavior.slice(0, 200)}{ex.expectedBehavior.length > 200 ? "..." : ""}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 4, marginLeft: 8 }}>
                  <button className="btn btn-sm" onClick={() => handleEdit(ex)} title="Edit">✏️</button>
                  <button className="btn btn-sm btn-danger" onClick={() => handleDelete(ex.id)} title="Delete">🗑️</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <InfoBox>
        <strong>💡 Few-shot examples</strong> teach the AI agent how to handle specific types of queries.
        When a user sends a message, the system dynamically selects the most relevant examples
        (via semantic similarity) and includes them in the prompt context.
        Active examples are used at runtime. Organize by category for easier management.
      </InfoBox>
    </div>
  );
}

/* ===== SCHEDULER TAB ===== */
interface Schedule {
  id: string;
  name: string;
  taskType: string;
  cronExpression: string | null;
  taskConfig: Record<string, unknown>;
  isActive: boolean;
  timezone: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
  failureCount: number;
  maxFailures: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ScheduleExecution {
  id: string;
  scheduleId: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  result: Record<string, unknown> | null;
  errorMessage: string | null;
  triggerSource: string;
}

interface ExecutionSummary {
  total: number;
  succeeded: number;
  failed: number;
  avgDurationMs: number;
}

const TASK_TYPE_LABELS: Record<string, { icon: string; label: string; desc: string }> = {
  report: { icon: "📊", label: "Report", desc: "Generate a scheduled report" },
  insight: { icon: "💡", label: "Insight", desc: "Run insight analysis" },
  alert: { icon: "🔔", label: "Alert", desc: "Check alert conditions (low stock, overdue invoices)" },
  cleanup: { icon: "🧹", label: "Cleanup", desc: "Purge old sessions, notifications, executions" },
  custom: { icon: "⚙️", label: "Custom", desc: "Custom task with arbitrary config" },
};

function SchedulerTab() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [historyScheduleId, setHistoryScheduleId] = useState<string | null>(null);
  const [executions, setExecutions] = useState<ScheduleExecution[]>([]);
  const [summary, setSummary] = useState<ExecutionSummary | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    taskType: "report",
    cronExpression: "0 8 * * *",
    taskConfig: "{}",
    timezone: "UTC",
    maxFailures: 5,
    isActive: true,
  });

  const fetchSchedules = async () => {
    try {
      const res = await fetch("/api/admin/schedules", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setSchedules(data.schedules || []);
      }
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchSchedules(); }, []);

  const handleSave = async () => {
    let config: Record<string, unknown>;
    try {
      config = JSON.parse(formData.taskConfig);
    } catch {
      alert("Task Config must be valid JSON");
      return;
    }
    const body = {
      name: formData.name,
      taskType: formData.taskType,
      cronExpression: formData.cronExpression || null,
      taskConfig: config,
      timezone: formData.timezone,
      maxFailures: formData.maxFailures,
      isActive: formData.isActive,
    };
    const url = editingId ? `/api/admin/schedules/${editingId}` : "/api/admin/schedules";
    const method = editingId ? "PUT" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    if (res.ok) {
      setShowForm(false);
      setEditingId(null);
      fetchSchedules();
    } else {
      const err = await res.json().catch(() => ({}));
      alert((err as { error?: string }).error || "Failed to save schedule");
    }
  };

  const handleEdit = (s: Schedule) => {
    setEditingId(s.id);
    setFormData({
      name: s.name,
      taskType: s.taskType,
      cronExpression: s.cronExpression || "",
      taskConfig: JSON.stringify(s.taskConfig || {}, null, 2),
      timezone: s.timezone || "UTC",
      maxFailures: s.maxFailures,
      isActive: s.isActive,
    });
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this schedule?")) return;
    const res = await fetch(`/api/admin/schedules/${id}`, { method: "DELETE", credentials: "include" });
    if (res.ok) fetchSchedules();
  };

  const handleToggle = async (id: string) => {
    const res = await fetch(`/api/admin/schedules/${id}/toggle`, { method: "POST", credentials: "include" });
    if (res.ok) fetchSchedules();
  };

  const handleRun = async (id: string) => {
    setRunning(id);
    try {
      const res = await fetch(`/api/admin/schedules/${id}/run`, { method: "POST", credentials: "include" });
      if (res.ok) {
        fetchSchedules();
        if (historyScheduleId === id) loadHistory(id);
      } else {
        const err = await res.json().catch(() => ({}));
        alert((err as { error?: string }).error || "Run failed");
      }
    } finally {
      setRunning(null);
    }
  };

  const loadHistory = async (scheduleId: string) => {
    setHistoryScheduleId(scheduleId);
    setLoadingHistory(true);
    try {
      const [histRes, sumRes] = await Promise.all([
        fetch(`/api/admin/schedules/${scheduleId}/history?limit=20`, { credentials: "include" }),
        fetch(`/api/admin/schedules/summary?scheduleId=${scheduleId}`, { credentials: "include" }),
      ]);
      if (histRes.ok) {
        const data = await histRes.json();
        setExecutions(data.executions || []);
      }
      if (sumRes.ok) {
        const data = await sumRes.json();
        setSummary(data.summary || null);
      }
    } finally {
      setLoadingHistory(false);
    }
  };

  const resetForm = () => {
    setFormData({ name: "", taskType: "report", cronExpression: "0 8 * * *", taskConfig: "{}", timezone: "UTC", maxFailures: 5, isActive: true });
    setEditingId(null);
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h3>⏰ Scheduled Tasks</h3>
        <button className="btn btn-primary btn-sm" onClick={() => { resetForm(); setShowForm(!showForm); }}>
          {showForm ? "Cancel" : "+ New Schedule"}
        </button>
      </div>

      {/* Create / Edit Form */}
      {showForm && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <h4>{editingId ? "Edit Schedule" : "New Schedule"}</h4>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <label className="text-muted" style={{ fontSize: 12 }}>Name</label>
              <input className="input" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="Daily Sales Report" />
            </div>
            <div>
              <label className="text-muted" style={{ fontSize: 12 }}>Task Type</label>
              <select className="input" value={formData.taskType} onChange={(e) => setFormData({ ...formData, taskType: e.target.value })}>
                {Object.entries(TASK_TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v.icon} {v.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-muted" style={{ fontSize: 12 }}>Cron Expression</label>
              <input className="input" value={formData.cronExpression} onChange={(e) => setFormData({ ...formData, cronExpression: e.target.value })} placeholder="0 8 * * * (daily at 8am)" />
            </div>
            <div>
              <label className="text-muted" style={{ fontSize: 12 }}>Timezone</label>
              <input className="input" value={formData.timezone} onChange={(e) => setFormData({ ...formData, timezone: e.target.value })} placeholder="UTC" />
            </div>
            <div>
              <label className="text-muted" style={{ fontSize: 12 }}>Max Failures (auto-disable after)</label>
              <input className="input" type="number" value={formData.maxFailures} onChange={(e) => setFormData({ ...formData, maxFailures: parseInt(e.target.value) || 0 })} />
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label className="text-muted" style={{ fontSize: 12 }}>Task Config (JSON)</label>
            <textarea className="input" rows={4} value={formData.taskConfig} onChange={(e) => setFormData({ ...formData, taskConfig: e.target.value })} style={{ fontFamily: "monospace", fontSize: 13 }}
              placeholder={'{\n  "reportType": "sales_summary",\n  "period": "daily"\n}'} />
            <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>
              {TASK_TYPE_LABELS[formData.taskType]?.desc || "Configure the task parameters."}
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label>
              <input type="checkbox" checked={formData.isActive} onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })} />{" "}
              Active
            </label>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary btn-sm" onClick={handleSave}>
              {editingId ? "Update" : "Create"} Schedule
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => { setShowForm(false); setEditingId(null); }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Schedule List */}
      {loading ? (
        <div className="text-muted">Loading schedules...</div>
      ) : schedules.length === 0 ? (
        <div className="text-muted">No scheduled tasks yet. Create one to automate reports, insights, alerts, or cleanup jobs.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {schedules.map((s) => {
            const tt = TASK_TYPE_LABELS[s.taskType] || TASK_TYPE_LABELS.custom;
            return (
              <div key={s.id} className="card" style={{ padding: 12, opacity: s.isActive ? 1 : 0.5 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                      <strong>{tt.icon} {s.name}</strong>
                      <span style={{ background: "var(--color-bg-secondary)", padding: "2px 8px", borderRadius: 12, fontSize: 11 }}>
                        {tt.label}
                      </span>
                      {s.cronExpression && (
                        <span className="text-muted" style={{ fontSize: 11, fontFamily: "monospace" }}>
                          {s.cronExpression}
                        </span>
                      )}
                      {!s.isActive && (
                        <span style={{ color: "#ef4444", fontSize: 11, fontWeight: 600 }}>DISABLED</span>
                      )}
                    </div>
                    <div className="text-muted" style={{ fontSize: 12, display: "flex", gap: 16 }}>
                      <span>TZ: {s.timezone}</span>
                      {s.lastRunAt && <span>Last run: {new Date(s.lastRunAt).toLocaleString()}</span>}
                      {s.nextRunAt && <span>Next: {new Date(s.nextRunAt).toLocaleString()}</span>}
                      {s.failureCount > 0 && (
                        <span style={{ color: "#ef4444" }}>Failures: {s.failureCount}/{s.maxFailures}</span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 4, marginLeft: 8 }}>
                    <button className="btn btn-sm" onClick={() => handleRun(s.id)} disabled={running === s.id} title="Run now">
                      {running === s.id ? "⏳" : "▶️"}
                    </button>
                    <button className="btn btn-sm" onClick={() => handleToggle(s.id)} title={s.isActive ? "Disable" : "Enable"}>
                      {s.isActive ? "⏸️" : "▶️"}
                    </button>
                    <button className="btn btn-sm" onClick={() => loadHistory(s.id)} title="History">📜</button>
                    <button className="btn btn-sm" onClick={() => handleEdit(s)} title="Edit">✏️</button>
                    <button className="btn btn-sm btn-danger" onClick={() => handleDelete(s.id)} title="Delete">🗑️</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Execution History Panel */}
      {historyScheduleId && (
        <div className="card" style={{ padding: 16, marginTop: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h4>📜 Execution History</h4>
            <button className="btn btn-sm" onClick={() => setHistoryScheduleId(null)}>✕ Close</button>
          </div>

          {summary && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
              <div className="card" style={{ padding: 10, textAlign: "center" }}>
                <div className="text-muted" style={{ fontSize: 11 }}>Total Runs</div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{summary.total}</div>
              </div>
              <div className="card" style={{ padding: 10, textAlign: "center" }}>
                <div className="text-muted" style={{ fontSize: 11 }}>Succeeded</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: "#10b981" }}>{summary.succeeded}</div>
              </div>
              <div className="card" style={{ padding: 10, textAlign: "center" }}>
                <div className="text-muted" style={{ fontSize: 11 }}>Failed</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: "#ef4444" }}>{summary.failed}</div>
              </div>
              <div className="card" style={{ padding: 10, textAlign: "center" }}>
                <div className="text-muted" style={{ fontSize: 11 }}>Avg Duration</div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{summary.avgDurationMs ? `${(summary.avgDurationMs / 1000).toFixed(1)}s` : "–"}</div>
              </div>
            </div>
          )}

          {loadingHistory ? (
            <div className="text-muted">Loading...</div>
          ) : executions.length === 0 ? (
            <div className="text-muted">No executions yet.</div>
          ) : (
            <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                  <th style={{ textAlign: "left", padding: 6 }}>Status</th>
                  <th style={{ textAlign: "left", padding: 6 }}>Started</th>
                  <th style={{ textAlign: "left", padding: 6 }}>Duration</th>
                  <th style={{ textAlign: "left", padding: 6 }}>Trigger</th>
                  <th style={{ textAlign: "left", padding: 6 }}>Details</th>
                </tr>
              </thead>
              <tbody>
                {executions.map((ex) => (
                  <tr key={ex.id} style={{ borderBottom: "1px solid var(--color-border)" }}>
                    <td style={{ padding: 6 }}>
                      <span style={{
                        display: "inline-block",
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        marginRight: 6,
                        background: ex.status === "completed" ? "#10b981" : ex.status === "failed" ? "#ef4444" : "#f59e0b",
                      }} />
                      {ex.status}
                    </td>
                    <td style={{ padding: 6 }}>{new Date(ex.startedAt).toLocaleString()}</td>
                    <td style={{ padding: 6 }}>{ex.durationMs != null ? `${(ex.durationMs / 1000).toFixed(1)}s` : "–"}</td>
                    <td style={{ padding: 6 }}>{ex.triggerSource}</td>
                    <td style={{ padding: 6, maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {ex.errorMessage || (ex.result ? JSON.stringify(ex.result).slice(0, 100) : "–")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <InfoBox>
        <strong>⏰ Scheduler</strong> automates recurring tasks. The cron engine checks every 15 minutes for due schedules
        and dispatches them to the Scheduler Agent. Task types include <em>report</em> (generates reports),
        <em>insight</em> (runs analysis), <em>alert</em> (checks low-stock/overdue invoices),
        <em>cleanup</em> (purges old data), and <em>custom</em>. Schedules auto-disable after reaching
        the max failure threshold.
      </InfoBox>
    </div>
  );
}

/* ===== OBSERVABILITY TAB (Phase 1.10 + 2.2) ===== */

interface AgentPerformance {
  agentName: string;
  totalInvocations: number;
  avgDurationMs: number;
  errorRate: number;
  llmCalls: number;
  toolCalls: number;
  avgLlmLatencyMs: number;
}

interface ToolUsageStat {
  toolName: string;
  totalCalls: number;
  successCount: number;
  errorCount: number;
  timeoutCount: number;
  successRate: number;
  avgDurationMs: number;
  p95DurationMs: number;
  avgInputSize: number;
  avgOutputSize: number;
}

interface TimelinePoint {
  hour: string;
  totalSpans: number;
  errorCount: number;
}

function ObservabilityTab() {
  const [agents, setAgents] = useState<AgentPerformance[]>([]);
  const [tools, setTools] = useState<ToolUsageStat[]>([]);
  const [timeline, setTimeline] = useState<TimelinePoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(7);
  const [view, setView] = useState<"agents" | "tools" | "timeline">("agents");

  const load = async () => {
    setLoading(true);
    try {
      const [agentsRes, toolsRes, timelineRes] = await Promise.all([
        fetch(`/api/admin/telemetry/agents?days=${days}`, { credentials: "include" }),
        fetch(`/api/admin/telemetry/tools?days=${days}`, { credentials: "include" }),
        fetch(`/api/admin/telemetry/timeline?days=${Math.min(days, 14)}`, { credentials: "include" }),
      ]);
      if (agentsRes.ok) {
        const d = await agentsRes.json();
        setAgents(d.data || []);
      }
      if (toolsRes.ok) {
        const d = await toolsRes.json();
        setTools(d.data || []);
      }
      if (timelineRes.ok) {
        const d = await timelineRes.json();
        setTimeline(d.data || []);
      }
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [days]);

  const totalInvocations = agents.reduce((s, a) => s + a.totalInvocations, 0);
  const avgErrorRate = agents.length
    ? agents.reduce((s, a) => s + a.errorRate, 0) / agents.length
    : 0;
  const totalToolCalls = tools.reduce((s, t) => s + t.totalCalls, 0);
  const avgToolSuccess = tools.length
    ? tools.reduce((s, t) => s + t.successRate, 0) / tools.length
    : 100;

  return (
    <div className="admin-section">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h3 style={{ margin: 0 }}>📡 Observability</h3>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <label style={{ fontSize: 13, color: "var(--color-text-muted)" }}>Period:</label>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="input" style={{ width: 120 }}>
            <option value={1}>Last 24h</option>
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
          </select>
          <button className="btn btn-sm" onClick={load} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 20 }}>
        <SummaryCard label="Agent Invocations" value={totalInvocations.toLocaleString()} icon="🔄" />
        <SummaryCard label="Avg Error Rate" value={`${avgErrorRate.toFixed(1)}%`} icon={avgErrorRate > 10 ? "⚠️" : "✅"} />
        <SummaryCard label="Tool Calls" value={totalToolCalls.toLocaleString()} icon="🔧" />
        <SummaryCard label="Tool Success" value={`${avgToolSuccess.toFixed(1)}%`} icon={avgToolSuccess < 90 ? "⚠️" : "✅"} />
      </div>

      {/* Sub-nav */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16, borderBottom: "1px solid var(--color-border)", paddingBottom: 8 }}>
        {(["agents", "tools", "timeline"] as const).map((v) => (
          <button
            key={v}
            className={`tab-btn ${view === v ? "active" : ""}`}
            onClick={() => setView(v)}
            style={{ padding: "6px 14px", fontSize: 13 }}
          >
            {v === "agents" ? "🤖 Agents" : v === "tools" ? "🔧 Tools" : "📈 Timeline"}
          </button>
        ))}
      </div>

      {loading && <p style={{ color: "var(--color-text-muted)" }}>Loading telemetry data…</p>}

      {!loading && view === "agents" && (
        <div className="table-wrap">
          {agents.length === 0 ? (
            <p style={{ color: "var(--color-text-muted)", textAlign: "center", padding: 24 }}>
              No agent telemetry data yet. Data will appear once agents process requests with tracing enabled.
            </p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th style={{ textAlign: "right" }}>Invocations</th>
                  <th style={{ textAlign: "right" }}>Avg Duration</th>
                  <th style={{ textAlign: "right" }}>Error Rate</th>
                  <th style={{ textAlign: "right" }}>LLM Calls</th>
                  <th style={{ textAlign: "right" }}>Tool Calls</th>
                  <th style={{ textAlign: "right" }}>Avg LLM Latency</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((a) => (
                  <tr key={a.agentName}>
                    <td><code>{a.agentName}</code></td>
                    <td style={{ textAlign: "right" }}>{a.totalInvocations.toLocaleString()}</td>
                    <td style={{ textAlign: "right" }}>{formatMs(a.avgDurationMs)}</td>
                    <td style={{ textAlign: "right" }}>
                      <span style={{ color: a.errorRate > 10 ? "#f87171" : a.errorRate > 5 ? "#fbbf24" : "#4ade80" }}>
                        {a.errorRate.toFixed(1)}%
                      </span>
                    </td>
                    <td style={{ textAlign: "right" }}>{a.llmCalls.toLocaleString()}</td>
                    <td style={{ textAlign: "right" }}>{a.toolCalls.toLocaleString()}</td>
                    <td style={{ textAlign: "right" }}>{formatMs(a.avgLlmLatencyMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {!loading && view === "tools" && (
        <div className="table-wrap">
          {tools.length === 0 ? (
            <p style={{ color: "var(--color-text-muted)", textAlign: "center", padding: 24 }}>
              No tool invocation data yet. Data will appear once AI tools are used.
            </p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Tool</th>
                  <th style={{ textAlign: "right" }}>Total</th>
                  <th style={{ textAlign: "right" }}>Success</th>
                  <th style={{ textAlign: "right" }}>Errors</th>
                  <th style={{ textAlign: "right" }}>Rate</th>
                  <th style={{ textAlign: "right" }}>Avg Duration</th>
                  <th style={{ textAlign: "right" }}>P95</th>
                  <th style={{ textAlign: "right" }}>Avg In</th>
                  <th style={{ textAlign: "right" }}>Avg Out</th>
                </tr>
              </thead>
              <tbody>
                {tools.map((t) => (
                  <tr key={t.toolName}>
                    <td><code>{t.toolName}</code></td>
                    <td style={{ textAlign: "right" }}>{t.totalCalls.toLocaleString()}</td>
                    <td style={{ textAlign: "right", color: "#4ade80" }}>{t.successCount}</td>
                    <td style={{ textAlign: "right", color: t.errorCount > 0 ? "#f87171" : "var(--color-text-muted)" }}>
                      {t.errorCount}{t.timeoutCount > 0 ? ` (${t.timeoutCount} T/O)` : ""}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <span style={{ color: t.successRate < 90 ? "#fbbf24" : "#4ade80" }}>
                        {t.successRate.toFixed(1)}%
                      </span>
                    </td>
                    <td style={{ textAlign: "right" }}>{formatMs(t.avgDurationMs)}</td>
                    <td style={{ textAlign: "right" }}>{formatMs(t.p95DurationMs)}</td>
                    <td style={{ textAlign: "right" }}>{formatBytes(t.avgInputSize)}</td>
                    <td style={{ textAlign: "right" }}>{formatBytes(t.avgOutputSize)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {!loading && view === "timeline" && (
        <div style={{ padding: 12 }}>
          {timeline.length === 0 ? (
            <p style={{ color: "var(--color-text-muted)", textAlign: "center", padding: 24 }}>
              No timeline data available for the selected period.
            </p>
          ) : (
            <div>
              <p style={{ color: "var(--color-text-muted)", fontSize: 13, marginBottom: 12 }}>
                Hourly span volume &amp; error rate (last {Math.min(days, 14)} days)
              </p>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 1, height: 120, padding: "0 4px" }}>
                {(() => {
                  const maxSpans = Math.max(...timeline.map((t) => t.totalSpans), 1);
                  // Show last 48 points for readability
                  const visible = timeline.slice(-48);
                  return visible.map((point, i) => {
                    const height = Math.max((point.totalSpans / maxSpans) * 100, 2);
                    const errorPct = point.totalSpans > 0
                      ? (point.errorCount / point.totalSpans) * 100
                      : 0;
                    const color = errorPct > 20 ? "#f87171" : errorPct > 5 ? "#fbbf24" : "#4ade80";
                    const hour = new Date(point.hour).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
                    return (
                      <div
                        key={i}
                        title={`${hour}: ${point.totalSpans} spans, ${point.errorCount} errors`}
                        style={{
                          flex: 1,
                          height: `${height}%`,
                          background: color,
                          borderRadius: "2px 2px 0 0",
                          opacity: 0.8,
                          minWidth: 3,
                        }}
                      />
                    );
                  });
                })()}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--color-text-muted)", marginTop: 4 }}>
                <span>{timeline.length > 0 ? new Date(timeline[Math.max(timeline.length - 48, 0)]?.hour).toLocaleDateString() : ""}</span>
                <span>Now</span>
              </div>
            </div>
          )}
        </div>
      )}

      <InfoBox>
        <strong>📡 Observability</strong> shows real-time performance metrics for all AI agents and tools.
        Agent telemetry tracks every LLM call, tool execution, and agent invocation with duration and error rates.
        Tool analytics provides per-tool success rates, latency percentiles (P95), and I/O sizes.
        The timeline shows hourly span volume with error highlighting. Data is collected automatically
        by the tracing infrastructure wired into each agent.
      </InfoBox>
    </div>
  );
}

/* ===== APPROVAL WORKFLOWS TAB ===== */

interface ApprovalWorkflow {
  id: string;
  actionType: string;
  name: string;
  description: string | null;
  isActive: boolean;
  condition: Record<string, unknown> | null;
  stepCount: number;
  autoApproveAboveRole: string | null;
  steps: ApprovalStep[];
  createdAt: string;
}

interface ApprovalStep {
  id: string;
  workflowId: string;
  stepOrder: number;
  approverRole: string;
  approverUserId: string | null;
  label: string | null;
}

const ACTION_TYPE_OPTIONS = [
  { value: "inventory.delivery_request", icon: "🚚", label: "Inventory Delivery Request" },
  { value: "inventory.adjustment", icon: "📦", label: "Stock Adjustment" },
  { value: "inventory.write_off", icon: "🗑️", label: "Inventory Write-Off" },
  { value: "inventory.transfer", icon: "🔄", label: "Warehouse Transfer" },
  { value: "order.large_order", icon: "💰", label: "Large Order" },
  { value: "order.discount", icon: "🏷️", label: "Order Discount" },
  { value: "order.refund", icon: "↩️", label: "Refund Request" },
  { value: "order.cancellation", icon: "❌", label: "Order Cancellation" },
  { value: "pricing.price_change", icon: "💲", label: "Price Change" },
  { value: "pricing.bulk_update", icon: "📊", label: "Bulk Price Update" },
  { value: "customer.credit_limit", icon: "💳", label: "Credit Limit Change" },
  { value: "customer.delete", icon: "🧹", label: "Customer Deletion" },
  { value: "product.new_product", icon: "🆕", label: "New Product" },
  { value: "product.discontinue", icon: "🚫", label: "Discontinue Product" },
  { value: "expense.reimbursement", icon: "🧾", label: "Expense Reimbursement" },
  { value: "custom", icon: "⚙️", label: "Custom Action (enter below)" },
];

const ACTION_TYPE_LABELS: Record<string, { icon: string; label: string }> = Object.fromEntries(
  ACTION_TYPE_OPTIONS.filter(o => o.value !== "custom").map(o => [o.value, { icon: o.icon, label: o.label }])
);

function ApprovalWorkflowsTab() {
  const [workflows, setWorkflows] = useState<ApprovalWorkflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editWf, setEditWf] = useState<ApprovalWorkflow | null>(null);
  const [seeding, setSeeding] = useState(false);

  const [form, setForm] = useState({
    actionType: "",
    name: "",
    description: "",
    isActive: true,
    conditionField: "",
    conditionOp: ">",
    conditionValue: "",
    autoApproveAboveRole: "",
    steps: [{ stepOrder: 1, approverRole: "manager", approverUserId: "", label: "" }] as Array<{
      stepOrder: number;
      approverRole: string;
      approverUserId: string;
      label: string;
    }>,
  });

  const load = async () => {
    setLoading(true);
    const res = await fetch("/api/approvals/workflows");
    const data = await res.json();
    setWorkflows(data.data ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const resetForm = () => {
    setForm({
      actionType: "", name: "", description: "", isActive: true,
      conditionField: "", conditionOp: ">", conditionValue: "",
      autoApproveAboveRole: "",
      steps: [{ stepOrder: 1, approverRole: "manager", approverUserId: "", label: "" }],
    });
    setEditWf(null);
    setShowForm(false);
  };

  const openEdit = (wf: ApprovalWorkflow) => {
    const cond = wf.condition as { field?: string; operator?: string; value?: number } | null;
    setForm({
      actionType: wf.actionType,
      name: wf.name,
      description: wf.description ?? "",
      isActive: wf.isActive,
      conditionField: cond?.field ?? "",
      conditionOp: cond?.operator ?? ">",
      conditionValue: cond?.value != null ? String(cond.value) : "",
      autoApproveAboveRole: wf.autoApproveAboveRole ?? "",
      steps: wf.steps.map((s) => ({
        stepOrder: s.stepOrder,
        approverRole: s.approverRole,
        approverUserId: s.approverUserId ?? "",
        label: s.label ?? "",
      })),
    });
    setEditWf(wf);
    setShowForm(true);
  };

  const addStep = () => {
    setForm((f) => ({
      ...f,
      steps: [...f.steps, { stepOrder: f.steps.length + 1, approverRole: "admin", approverUserId: "", label: "" }],
    }));
  };

  const removeStep = (idx: number) => {
    setForm((f) => ({
      ...f,
      steps: f.steps.filter((_, i) => i !== idx).map((s, i) => ({ ...s, stepOrder: i + 1 })),
    }));
  };

  const updateStep = (idx: number, field: string, value: string) => {
    setForm((f) => ({
      ...f,
      steps: f.steps.map((s, i) => i === idx ? { ...s, [field]: value } : s),
    }));
  };

  const save = async () => {
    const body: Record<string, unknown> = {
      actionType: form.actionType,
      name: form.name,
      description: form.description || undefined,
      isActive: form.isActive,
      autoApproveAboveRole: form.autoApproveAboveRole || null,
      steps: form.steps.map((s) => ({
        stepOrder: s.stepOrder,
        approverRole: s.approverRole,
        approverUserId: s.approverUserId || null,
        label: s.label || undefined,
      })),
    };
    if (form.conditionField && form.conditionValue) {
      body.condition = {
        field: form.conditionField,
        operator: form.conditionOp,
        value: Number(form.conditionValue),
      };
    }

    const method = editWf ? "PUT" : "POST";
    const url = editWf ? `/api/approvals/workflows/${editWf.id}` : "/api/approvals/workflows";
    await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    resetForm();
    load();
  };

  const toggleActive = async (wf: ApprovalWorkflow) => {
    await fetch(`/api/approvals/workflows/${wf.id}/toggle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !wf.isActive }),
    });
    load();
  };

  const deleteWf = async (wf: ApprovalWorkflow) => {
    if (!confirm(`Delete workflow "${wf.name}"?`)) return;
    await fetch(`/api/approvals/workflows/${wf.id}`, { method: "DELETE" });
    load();
  };

  const seedDefaults = async () => {
    setSeeding(true);
    await fetch("/api/approvals/workflows/seed", { method: "POST" });
    await load();
    setSeeding(false);
  };

  if (loading) return <div className="loading-state"><div className="spinner" />Loading workflows…</div>;

  return (
    <div>
      {/* Info Box */}
      <InfoBox>
        <strong>✅ Approval Workflows</strong> define multi-step approval chains for business actions.
        When a user performs an action that requires approval (e.g., requesting inventory delivery,
        adjusting stock, or creating a large order), the request is routed through the configured
        approval chain — from staff → manager → admin. Each user's <strong>"Reports To"</strong> field
        (set in Users & Access) determines who reviews their requests.
      </InfoBox>

      {/* Toolbar */}
      <div className="toolbar" style={{ marginBottom: 16 }}>
        <span className="toolbar-count">{workflows.length} workflow{workflows.length !== 1 ? "s" : ""} configured</span>
        <div style={{ display: "flex", gap: 8 }}>
          {workflows.length === 0 && (
            <button className="btn btn-secondary btn-sm" onClick={seedDefaults} disabled={seeding}>
              {seeding ? "Seeding…" : "🌱 Seed Defaults"}
            </button>
          )}
          <button className="btn btn-primary btn-sm" onClick={() => { resetForm(); setShowForm(true); }}>+ New Workflow</button>
        </div>
      </div>

      {/* Create/Edit Form */}
      {showForm && (
        <div className="admin-form-panel">
          {/* Panel Header */}
          <div className="admin-form-panel-header">
            <div className="admin-form-panel-header-icon">{editWf ? "✏️" : "✅"}</div>
            <h4>{editWf ? `Edit — ${editWf.name}` : "New Approval Workflow"}</h4>
          </div>

          {/* Panel Body */}
          <div className="admin-form-panel-body">
            <div className="form-grid cols-3">
              <label>
                <span className="form-label">Action Type</span>
                <select
                  value={ACTION_TYPE_OPTIONS.some(o => o.value === form.actionType) ? form.actionType : "custom"}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === "custom") {
                      setForm({ ...form, actionType: "" });
                    } else {
                      const opt = ACTION_TYPE_OPTIONS.find(o => o.value === val);
                      setForm({ ...form, actionType: val, name: form.name || opt?.label || "" });
                    }
                  }}
                >
                  <option value="" disabled>Select an action…</option>
                  {ACTION_TYPE_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.icon} {o.label}</option>
                  ))}
                </select>
                {(!ACTION_TYPE_OPTIONS.some(o => o.value === form.actionType) || form.actionType === "") && (
                  <input
                    style={{ marginTop: 6 }}
                    value={form.actionType}
                    onChange={(e) => setForm({ ...form, actionType: e.target.value })}
                    placeholder="e.g. inventory.delivery_request"
                  />
                )}
                <span className="form-hint">Machine-readable identifier for this workflow trigger</span>
              </label>
              <label>
                <span className="form-label">Workflow Name</span>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Inventory Delivery Request"
                />
                <span className="form-hint">Human-readable name displayed in approval inbox</span>
              </label>
              <label>
                <span className="form-label">Auto-Approve Above Role</span>
                <select
                  value={form.autoApproveAboveRole}
                  onChange={(e) => setForm({ ...form, autoApproveAboveRole: e.target.value })}
                >
                  <option value="">— None —</option>
                  <option value="manager">Manager & above</option>
                  <option value="admin">Admin & above</option>
                  <option value="super_admin">Super Admin only</option>
                </select>
                <span className="form-hint">Skip approval for users at this role or higher</span>
              </label>
            </div>

            <div className="form-grid cols-2" style={{ marginTop: 16 }}>
              <label>
                <span className="form-label">Description</span>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Describe when this workflow should be triggered…"
                  rows={2}
                />
              </label>
              <div>
                <span className="form-label">Condition (Optional)</span>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    style={{ flex: 1 }}
                    value={form.conditionField}
                    onChange={(e) => setForm({ ...form, conditionField: e.target.value })}
                    placeholder="Field (e.g. totalAmount)"
                  />
                  <select
                    style={{ width: 60 }}
                    value={form.conditionOp}
                    onChange={(e) => setForm({ ...form, conditionOp: e.target.value })}
                  >
                    <option value=">">&gt;</option>
                    <option value=">=">&gt;=</option>
                    <option value="<">&lt;</option>
                    <option value="<=">&lt;=</option>
                    <option value="==">=</option>
                  </select>
                  <input
                    style={{ width: 100 }}
                    type="number"
                    value={form.conditionValue}
                    onChange={(e) => setForm({ ...form, conditionValue: e.target.value })}
                    placeholder="Value"
                  />
                </div>
                <span className="form-hint">Only trigger when condition is met (leave empty for always)</span>
              </div>
            </div>

            {/* Approval Steps */}
            <div className="admin-form-section">
              <div className="admin-form-section-header">
                <span className="admin-form-section-title">Approval Steps</span>
                <button className="btn btn-secondary btn-xs" onClick={addStep}>+ Add Step</button>
              </div>
              <div>
                {form.steps.map((step, idx) => (
                  <div key={idx} className="approval-step-card">
                    <div className="approval-step-number">{step.stepOrder}</div>
                    <div className="approval-step-fields">
                      <label>
                        <span className="form-label">Approver Role</span>
                        <select value={step.approverRole} onChange={(e) => updateStep(idx, "approverRole", e.target.value)}>
                          <option value="staff">Staff</option>
                          <option value="manager">Manager</option>
                          <option value="admin">Admin</option>
                          <option value="super_admin">Super Admin</option>
                        </select>
                      </label>
                      <label>
                        <span className="form-label">Step Label</span>
                        <input
                          value={step.label}
                          onChange={(e) => updateStep(idx, "label", e.target.value)}
                          placeholder="e.g. Manager Review"
                        />
                      </label>
                    </div>
                    {form.steps.length > 1 && (
                      <button className="approval-step-remove" onClick={() => removeStep(idx)} title="Remove step">✕</button>
                    )}
                  </div>
                ))}
              </div>
              <p className="form-hint" style={{ marginTop: 4 }}>
                Steps are executed in order. Step 1 is reviewed first, then step 2, etc.
              </p>
            </div>
          </div>

          {/* Panel Footer */}
          <div className="admin-form-panel-footer">
            <div
              className="admin-toggle-switch"
              onClick={() => setForm({ ...form, isActive: !form.isActive })}
            >
              <div className={`admin-toggle-track ${form.isActive ? "active" : ""}`}>
                <div className="admin-toggle-thumb" />
              </div>
              <span className="admin-toggle-label">{form.isActive ? "Active" : "Inactive"}</span>
            </div>
            <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              <button className="btn btn-primary" onClick={save}>
                {editWf ? "💾 Update Workflow" : "✅ Create Workflow"}
              </button>
              <button className="btn btn-secondary" onClick={resetForm}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Workflows List */}
      {workflows.length === 0 && !showForm ? (
        <div className="card" style={{ padding: 40, textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
          <h3>No Approval Workflows Configured</h3>
          <p className="text-muted" style={{ marginBottom: 16 }}>
            Set up approval chains to route business actions through your management hierarchy.
          </p>
          <button className="btn btn-primary" onClick={seedDefaults} disabled={seeding}>
            {seeding ? "Seeding…" : "🌱 Seed Default Workflows"}
          </button>
        </div>
      ) : (
        <div className="card table-card">
          <table className="data-table">
            <thead>
              <tr>
                <th>Workflow</th>
                <th>Action Type</th>
                <th>Approval Chain</th>
                <th>Condition</th>
                <th>Status</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {workflows.map((wf) => {
                const info = ACTION_TYPE_LABELS[wf.actionType];
                const cond = wf.condition as { field?: string; operator?: string; value?: number } | null;
                return (
                  <tr key={wf.id}>
                    <td>
                      <div className="cell-main">{wf.name}</div>
                      {wf.description && <div className="cell-sub">{wf.description}</div>}
                    </td>
                    <td>
                      <span className="perm-tag">{info?.icon ?? "📋"} {info?.label ?? wf.actionType}</span>
                    </td>
                    <td>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
                        {wf.steps.map((step, i) => (
                          <React.Fragment key={step.id}>
                            <span className="role-pill" style={{
                              background: ROLE_COLORS[step.approverRole] ?? "#555",
                              fontSize: 11,
                              padding: "2px 8px",
                            }}>
                              {step.label || ROLE_LABELS[step.approverRole] || step.approverRole}
                            </span>
                            {i < wf.steps.length - 1 && <span style={{ color: "var(--color-text-muted)", fontSize: 12 }}>→</span>}
                          </React.Fragment>
                        ))}
                      </div>
                    </td>
                    <td>
                      {cond?.field ? (
                        <span className="text-muted" style={{ fontSize: 12 }}>
                          {cond.field} {cond.operator} {cond.value?.toLocaleString()}
                        </span>
                      ) : (
                        <span className="text-muted">Always</span>
                      )}
                    </td>
                    <td>
                      <span
                        className={`status-badge ${wf.isActive ? "status-active" : "status-inactive"}`}
                        style={{ cursor: "pointer" }}
                        onClick={() => toggleActive(wf)}
                      >
                        {wf.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td>
                      <div className="action-cell">
                        <button className="btn btn-xs btn-secondary" onClick={() => openEdit(wf)}>Edit</button>
                        <button className="btn btn-xs btn-warning" onClick={() => deleteWf(wf)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ===== Shared Helpers ===== */

function SummaryCard({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="obs-summary-card">
      <div className="obs-summary-icon">{icon}</div>
      <div className="obs-summary-value">{value}</div>
      <div className="obs-summary-label">{label}</div>
    </div>
  );
}

function formatMs(ms: number): string {
  if (!ms || ms === 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function formatBytes(chars: number): string {
  if (!chars || chars === 0) return "—";
  if (chars < 1000) return `${chars}`;
  if (chars < 1000000) return `${(chars / 1000).toFixed(1)}k`;
  return `${(chars / 1000000).toFixed(1)}M`;
}
