import React, { useState, useEffect, useCallback } from "react";
import type { AppConfig, AuthUser } from "../types";

/* ─── Types ─── */
interface ApprovalsPageProps {
  config: AppConfig;
  user: AuthUser;
}

type TabKey = "pending" | "my-requests" | "all";

interface ApprovalItem {
  request: {
    id: string;
    workflowId: string;
    actionType: string;
    requesterId: string;
    currentStep: number;
    status: string;
    entityType: string;
    entityId: string;
    actionData: Record<string, unknown> | null;
    requesterNote: string | null;
    warehouseId: string | null;
    createdAt: string;
  };
  workflow: {
    id: string;
    name: string;
    actionType: string;
    stepCount: number;
  };
  currentStepInfo: {
    id: string;
    stepOrder: number;
    approverRole: string;
    label: string | null;
  };
  requester: {
    id: string;
    name: string;
    email: string;
    role: string;
  } | null;
}

interface MyRequest {
  id: string;
  actionType: string;
  entityType: string;
  entityId: string;
  currentStep: number;
  status: string;
  requesterNote: string | null;
  actionData: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

/* ─── Constants ─── */
const ACTION_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  "inventory.delivery_request": { label: "Inventory Delivery", icon: "📦", color: "#3b82f6" },
  "inventory.adjustment": { label: "Stock Adjustment", icon: "🔄", color: "#f59e0b" },
  "order.large_order": { label: "Large Order", icon: "🛒", color: "#8b5cf6" },
};

const STATUS_CONFIG: Record<string, { bg: string; color: string; label: string; icon: string }> = {
  pending: { bg: "var(--approvals-status-pending-bg, #fef3c7)", color: "var(--approvals-status-pending-fg, #92400e)", label: "Pending", icon: "⏳" },
  approved: { bg: "var(--approvals-status-approved-bg, #d1fae5)", color: "var(--approvals-status-approved-fg, #065f46)", label: "Approved", icon: "✓" },
  rejected: { bg: "var(--approvals-status-rejected-bg, #fee2e2)", color: "var(--approvals-status-rejected-fg, #991b1b)", label: "Rejected", icon: "✕" },
  cancelled: { bg: "var(--approvals-status-cancelled-bg, #e2e8f0)", color: "var(--approvals-status-cancelled-fg, #475569)", label: "Cancelled", icon: "—" },
};

const ROLE_COLORS: Record<string, string> = {
  super_admin: "#7c3aed",
  admin: "#2563eb",
  manager: "#059669",
  staff: "#d97706",
  viewer: "#6b7280",
};

/* ─── Helpers ─── */
const formatDate = (d: string) => {
  try {
    return new Date(d).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch { return d; }
};

const getActionInfo = (actionType: string) =>
  ACTION_LABELS[actionType] ?? { label: actionType.replace(/\./g, " › ").replace(/_/g, " "), icon: "📋", color: "#6b7280" };

const timeAgo = (d: string) => {
  const secs = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
};

/* ─── Sub-Components ─── */

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  return (
    <span className="approval-status-badge" style={{ backgroundColor: s.bg, color: s.color }}>
      <span className="approval-status-icon">{s.icon}</span>
      {s.label}
    </span>
  );
}

function StepProgress({ current, total }: { current: number; total: number }) {
  return (
    <div className="approval-step-progress">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`approval-step-dot ${i + 1 < current ? "completed" : i + 1 === current ? "current" : "upcoming"}`}
          title={`Step ${i + 1}`}
        >
          {i + 1 < current ? "✓" : i + 1}
        </div>
      ))}
    </div>
  );
}

function StatCard({ icon, value, label, accent }: { icon: string; value: number | string; label: string; accent: string }) {
  return (
    <div className="approval-stat-card" style={{ borderTopColor: accent }}>
      <div className="approval-stat-icon">{icon}</div>
      <div className="approval-stat-value">{value}</div>
      <div className="approval-stat-label">{label}</div>
    </div>
  );
}

function EmptyState({ icon, title, description }: { icon: string; title: string; description: string }) {
  return (
    <div className="approval-empty-state">
      <div className="approval-empty-icon">{icon}</div>
      <h3 className="approval-empty-title">{title}</h3>
      <p className="approval-empty-desc">{description}</p>
    </div>
  );
}

/* ═══════════════════════════════════════════
   Main Component
   ═══════════════════════════════════════════ */
export default function ApprovalsPage({ config, user }: ApprovalsPageProps) {
  const [tab, setTab] = useState<TabKey>("pending");
  const [deciding, setDeciding] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pendingItems, setPendingItems] = useState<ApprovalItem[]>([]);
  const [myRequests, setMyRequests] = useState<MyRequest[]>([]);
  const [allRequests, setAllRequests] = useState<MyRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const headers: Record<string, string> = { "Content-Type": "application/json" };

  const showToast = (type: "success" | "error", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      if (tab === "pending") {
        const res = await fetch("/api/approvals/pending", { headers });
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        const json = await res.json();
        setPendingItems(json.data ?? []);
      } else if (tab === "my-requests") {
        const res = await fetch(`/api/approvals/requests?requesterId=${user.id}`, { headers });
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        const json = await res.json();
        setMyRequests(json.data ?? []);
      } else {
        const res = await fetch("/api/approvals/requests?limit=100", { headers });
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        const json = await res.json();
        setAllRequests(json.data ?? []);
      }
    } catch (e: any) {
      console.error("Failed to fetch approvals", e);
      setFetchError(e?.message || "Failed to load approvals");
    } finally {
      setLoading(false);
    }
  }, [tab, user.id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleDecision = async (requestId: string, decision: "approved" | "rejected") => {
    setDeciding(requestId);
    try {
      const res = await fetch(`/api/approvals/requests/${requestId}/decide`, {
        method: "POST",
        headers,
        body: JSON.stringify({ decision, comment: comment || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to ${decision}`);
      }
      showToast("success", `Request ${decision} successfully`);
      setComment("");
      setExpandedId(null);
      fetchData();
    } catch (e: any) {
      showToast("error", e.message || "Action failed");
    } finally {
      setDeciding(null);
    }
  };

  const handleCancel = async (requestId: string) => {
    try {
      const res = await fetch(`/api/approvals/requests/${requestId}/cancel`, {
        method: "POST",
        headers,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to cancel");
      }
      showToast("success", "Request cancelled");
      fetchData();
    } catch (e: any) {
      showToast("error", e.message);
    }
  };

  const isAdminRole = ["admin", "super_admin"].includes(user.role);

  const tabs: { key: TabKey; label: string; icon: string; count?: number }[] = [
    { key: "pending", label: "Pending Review", icon: "📥", count: pendingItems.length },
    { key: "my-requests", label: "My Requests", icon: "📤", count: myRequests.length },
    ...(isAdminRole ? [{ key: "all" as TabKey, label: "All Requests", icon: "📋" }] : []),
  ];

  const stats = {
    pending: pendingItems.length,
    myPending: myRequests.filter((r) => r.status === "pending").length,
    myApproved: myRequests.filter((r) => r.status === "approved").length,
    myRejected: myRequests.filter((r) => r.status === "rejected").length,
  };

  return (
    <div className="approvals-page">
      {toast && (
        <div className={`approvals-toast approvals-toast-${toast.type}`}>
          <span>{toast.type === "success" ? "✓" : "✕"}</span>
          <span>{toast.message}</span>
          <button onClick={() => setToast(null)} className="approvals-toast-close">✕</button>
        </div>
      )}

      <div className="approvals-header">
        <div>
          <h2 className="approvals-title">Approvals</h2>
          <p className="approvals-subtitle">Review and manage approval requests across your organization</p>
        </div>
      </div>

      <div className="approvals-stats-row">
        <StatCard icon="📥" value={stats.pending} label="Awaiting Your Review" accent="var(--color-warning)" />
        <StatCard icon="📤" value={stats.myPending} label="My Pending" accent="var(--color-info)" />
        <StatCard icon="✓" value={stats.myApproved} label="My Approved" accent="var(--color-success)" />
        <StatCard icon="✕" value={stats.myRejected} label="My Rejected" accent="var(--color-danger)" />
      </div>

      <div className="approvals-tab-bar">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`approvals-tab ${tab === t.key ? "active" : ""}`}
          >
            <span className="approvals-tab-icon">{t.icon}</span>
            <span>{t.label}</span>
            {t.count != null && t.count > 0 && (
              <span className="approvals-tab-count">{t.count}</span>
            )}
          </button>
        ))}
      </div>

      <div className="approvals-content">
        {fetchError ? (
          <div style={{ textAlign: "center", padding: 32 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
            <h3 style={{ margin: "0 0 8px" }}>Failed to load approvals</h3>
            <p className="text-muted" style={{ margin: "0 0 16px" }}>{fetchError}</p>
            <button className="btn btn-primary" onClick={() => fetchData()}>Retry</button>
          </div>
        ) : loading ? (
          <div className="approvals-loading">
            <div className="approvals-loading-spinner" />
            <span>Loading approvals…</span>
          </div>
        ) : (
          <>
            {tab === "pending" && (
              pendingItems.length === 0 ? (
                <EmptyState icon="🎉" title="All caught up!" description="No pending approvals right now. New requests will appear here when submitted." />
              ) : (
                <div className="approvals-card-list">
                  {pendingItems.map((item) => {
                    const isExpanded = expandedId === item.request.id;
                    const action = getActionInfo(item.request.actionType);
                    return (
                      <div key={item.request.id} className={`approval-card ${isExpanded ? "expanded" : ""}`}>
                        <div className="approval-card-accent" style={{ backgroundColor: action.color }} />

                        <div className="approval-card-header" onClick={() => setExpandedId(isExpanded ? null : item.request.id)}>
                          <div className="approval-card-header-left">
                            <div className="approval-card-action-icon" style={{ backgroundColor: `${action.color}15`, color: action.color }}>
                              {action.icon}
                            </div>
                            <div className="approval-card-meta">
                              <div className="approval-card-action-name">{action.label}</div>
                              <div className="approval-card-requester">
                                <span className="approval-card-requester-name">{item.requester?.name ?? "Unknown"}</span>
                                {item.requester?.role && (
                                  <span className="approval-card-role-pill" style={{ backgroundColor: ROLE_COLORS[item.requester.role] ?? "#6b7280" }}>
                                    {item.requester.role.replace(/_/g, " ")}
                                  </span>
                                )}
                                <span className="approval-card-time">{timeAgo(item.request.createdAt)}</span>
                              </div>
                            </div>
                          </div>
                          <div className="approval-card-header-right">
                            <StepProgress current={item.request.currentStep} total={item.workflow.stepCount} />
                            <StatusBadge status={item.request.status} />
                            <span className="approval-card-chevron">{isExpanded ? "▲" : "▼"}</span>
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="approval-card-body" onClick={(e) => e.stopPropagation()}>
                            <div className="approval-detail-grid">
                              <div className="approval-detail-item">
                                <span className="approval-detail-label">Workflow</span>
                                <span className="approval-detail-value">{item.workflow.name}</span>
                              </div>
                              <div className="approval-detail-item">
                                <span className="approval-detail-label">Entity</span>
                                <span className="approval-detail-value">{item.request.entityType} #{item.request.entityId.slice(0, 8)}</span>
                              </div>
                              <div className="approval-detail-item">
                                <span className="approval-detail-label">Current Step</span>
                                <span className="approval-detail-value">
                                  {item.currentStepInfo.label || `Step ${item.currentStepInfo.stepOrder}`}
                                  <span className="approval-detail-sub"> ({item.currentStepInfo.approverRole})</span>
                                </span>
                              </div>
                              <div className="approval-detail-item">
                                <span className="approval-detail-label">Submitted</span>
                                <span className="approval-detail-value">{formatDate(item.request.createdAt)}</span>
                              </div>
                            </div>

                            {item.request.requesterNote && (
                              <div className="approval-note">
                                <span className="approval-note-label">Note from requester</span>
                                <p className="approval-note-text">{item.request.requesterNote}</p>
                              </div>
                            )}

                            {item.request.actionData && Object.keys(item.request.actionData).length > 0 && (
                              <details className="approval-action-data">
                                <summary>View action data</summary>
                                <pre>{JSON.stringify(item.request.actionData, null, 2)}</pre>
                              </details>
                            )}

                            <div className="approval-decision-form">
                              <textarea
                                value={expandedId === item.request.id ? comment : ""}
                                onChange={(e) => setComment(e.target.value)}
                                placeholder="Add a comment (optional)…"
                                rows={2}
                                className="approval-decision-textarea"
                              />
                              <div className="approval-decision-actions">
                                <button
                                  onClick={() => handleDecision(item.request.id, "rejected")}
                                  disabled={deciding === item.request.id}
                                  className="approval-btn approval-btn-reject"
                                >
                                  ✕ Reject
                                </button>
                                <button
                                  onClick={() => handleDecision(item.request.id, "approved")}
                                  disabled={deciding === item.request.id}
                                  className="approval-btn approval-btn-approve"
                                >
                                  ✓ Approve
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )
            )}

            {tab === "my-requests" && (
              myRequests.length === 0 ? (
                <EmptyState icon="📭" title="No requests submitted" description="Your approval requests will appear here once you submit actions that require approval." />
              ) : (
                <div className="approvals-table-wrapper">
                  <table className="approvals-table">
                    <thead>
                      <tr>
                        <th>Action</th>
                        <th>Entity</th>
                        <th>Status</th>
                        <th>Step</th>
                        <th>Submitted</th>
                        <th style={{ textAlign: "right" }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {myRequests.map((r) => {
                        const action = getActionInfo(r.actionType);
                        return (
                          <tr key={r.id}>
                            <td>
                              <div className="approvals-table-action">
                                <span className="approvals-table-action-icon" style={{ color: action.color }}>{action.icon}</span>
                                <span className="approvals-table-action-label">{action.label}</span>
                              </div>
                            </td>
                            <td className="approvals-table-entity">{r.entityType} #{r.entityId.slice(0, 8)}</td>
                            <td><StatusBadge status={r.status} /></td>
                            <td className="approvals-table-step">Step {r.currentStep}</td>
                            <td className="approvals-table-date">{formatDate(r.createdAt)}</td>
                            <td style={{ textAlign: "right" }}>
                              {r.status === "pending" && (
                                <button onClick={() => handleCancel(r.id)} className="approval-btn-cancel">Cancel</button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )
            )}

            {tab === "all" && isAdminRole && (
              allRequests.length === 0 ? (
                <EmptyState icon="📋" title="No requests yet" description="Approval requests from all users will be listed here." />
              ) : (
                <div className="approvals-table-wrapper">
                  <table className="approvals-table">
                    <thead>
                      <tr>
                        <th>Action</th>
                        <th>Entity</th>
                        <th>Status</th>
                        <th>Step</th>
                        <th>Submitted</th>
                        <th>Updated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allRequests.map((r) => {
                        const action = getActionInfo(r.actionType);
                        return (
                          <tr key={r.id}>
                            <td>
                              <div className="approvals-table-action">
                                <span className="approvals-table-action-icon" style={{ color: action.color }}>{action.icon}</span>
                                <span className="approvals-table-action-label">{action.label}</span>
                              </div>
                            </td>
                            <td className="approvals-table-entity">{r.entityType} #{r.entityId.slice(0, 8)}</td>
                            <td><StatusBadge status={r.status} /></td>
                            <td className="approvals-table-step">Step {r.currentStep}</td>
                            <td className="approvals-table-date">{formatDate(r.createdAt)}</td>
                            <td className="approvals-table-date">{formatDate(r.updatedAt)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </>
        )}
      </div>
    </div>
  );
}
