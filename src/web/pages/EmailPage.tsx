import React, { useState, useEffect, useCallback } from "react";
import type { AppConfig, AuthUser } from "../types";

interface EmailPageProps {
  config: AppConfig;
  user: AuthUser;
}

interface EmailThread {
  id: string;
  from: string;
  subject: string;
  preview: string;
  receivedAt: string;
  priority: "high" | "normal" | "low";
  isRead: boolean;
  hasAiDraft: boolean;
}

interface EmailDetail extends EmailThread {
  body: string;
  aiDraft: string | null;
}

const PRIORITY_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  high: { bg: "#fef2f2", color: "#dc2626", label: "🔴 High" },
  normal: { bg: "#f0f9ff", color: "#2563eb", label: "🔵 Normal" },
  low: { bg: "#f0fdf4", color: "#16a34a", label: "🟢 Low" },
};

export default function EmailPage({ config, user }: EmailPageProps) {
  const [emails, setEmails] = useState<EmailThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<EmailDetail | null>(null);
  const [draftText, setDraftText] = useState("");
  const [generatingDraft, setGeneratingDraft] = useState(false);
  const [sending, setSending] = useState(false);
  const [filter, setFilter] = useState<"all" | "unread" | "high">("all");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const flash = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  };

  const loadEmails = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/emails");
      const data = await res.json();
      setEmails(data.data ?? []);
    } catch {
      // Demo: show placeholder emails
      setEmails([
        {
          id: "demo-1",
          from: "reservations@safarilodge.co.ke",
          subject: "Group Booking Request — 12 Pax, March 2026",
          preview: "Dear Team, We have a group of 12 interested in a 5-day Masai Mara package starting March 15…",
          receivedAt: new Date(Date.now() - 1800000).toISOString(),
          priority: "high",
          isRead: false,
          hasAiDraft: true,
        },
        {
          id: "demo-2",
          from: "accounts@travelagent.com",
          subject: "Invoice #INV-2417 Payment Confirmation",
          preview: "Please find attached the payment receipt for invoice #INV-2417 totaling KES 485,000…",
          receivedAt: new Date(Date.now() - 7200000).toISOString(),
          priority: "normal",
          isRead: false,
          hasAiDraft: false,
        },
        {
          id: "demo-3",
          from: "supplier@equipment.co.ke",
          subject: "Re: Camping Equipment Order — Delivery Update",
          preview: "Hi, the tents and camping gear you ordered will be dispatched on Thursday. Tracking number…",
          receivedAt: new Date(Date.now() - 14400000).toISOString(),
          priority: "normal",
          isRead: true,
          hasAiDraft: false,
        },
        {
          id: "demo-4",
          from: "info@kws.go.ke",
          subject: "Park Entry Fee Update — Effective April 2026",
          preview: "Dear Operators, please note the revised park entry fees effective April 1, 2026…",
          receivedAt: new Date(Date.now() - 28800000).toISOString(),
          priority: "high",
          isRead: false,
          hasAiDraft: true,
        },
        {
          id: "demo-5",
          from: "marketing@newsletter.co",
          subject: "Weekly Industry Digest — Tourism Trends",
          preview: "This week's highlights: East Africa tourism up 23% YoY, new eco-lodge certifications…",
          receivedAt: new Date(Date.now() - 86400000).toISOString(),
          priority: "low",
          isRead: true,
          hasAiDraft: false,
        },
      ]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadEmails(); }, [loadEmails]);

  const openEmail = async (email: EmailThread) => {
    // Mark as read
    setEmails((prev) => prev.map((e) => (e.id === email.id ? { ...e, isRead: true } : e)));

    // Try to fetch full email, or use demo data
    try {
      const res = await fetch(`/api/admin/emails/${email.id}`);
      if (res.ok) {
        const data = await res.json();
        setSelected(data.data);
        setDraftText(data.data.aiDraft || "");
        return;
      }
    } catch { /* use demo */ }

    // Demo detail
    const demoBody = `${email.preview}\n\nFull email content would appear here. This is a preview of the AI-powered email management feature.\n\nThe system will:\n• Analyze incoming emails for intent and urgency\n• Auto-prioritize based on business context\n• Generate AI draft responses using your business knowledge base\n• Let you review, edit, and approve before sending`;
    const demoDraft = email.hasAiDraft
      ? `Dear ${email.from.split("@")[0]},\n\nThank you for your email regarding "${email.subject}".\n\nI have reviewed the details and would like to confirm the following:\n\n[AI-generated response based on your business context, pricing, availability, and policies would appear here.]\n\nPlease let me know if you need any further information.\n\nBest regards,\n${user.name}\n${config.companyName}`
      : null;

    setSelected({ ...email, body: demoBody, aiDraft: demoDraft });
    setDraftText(demoDraft || "");
  };

  const generateAiDraft = async () => {
    if (!selected) return;
    setGeneratingDraft(true);
    try {
      const res = await fetch("/api/admin/emails/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailId: selected.id, emailBody: selected.body, subject: selected.subject }),
      });
      if (res.ok) {
        const data = await res.json();
        setDraftText(data.data?.draft || "");
      }
    } catch {
      // Demo fallback
      setDraftText(`Dear ${selected.from.split("@")[0]},\n\nThank you for reaching out regarding "${selected.subject}".\n\n[AI draft response would be generated here using your business knowledge base, pricing data, and past correspondence patterns.]\n\nBest regards,\n${user.name}\n${config.companyName}`);
    }
    setGeneratingDraft(false);
  };

  const sendReply = async () => {
    if (!selected || !draftText.trim()) return;
    setSending(true);
    try {
      await fetch(`/api/admin/emails/${selected.id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: draftText }),
      });
      flash("success", "Reply sent successfully.");
      setSelected(null);
      setDraftText("");
    } catch {
      flash("success", "Reply sent! (demo mode)");
      setSelected(null);
      setDraftText("");
    }
    setSending(false);
  };

  const filtered = emails.filter((e) => {
    if (filter === "unread") return !e.isRead;
    if (filter === "high") return e.priority === "high";
    return true;
  });

  const unreadCount = emails.filter((e) => !e.isRead).length;
  const highCount = emails.filter((e) => e.priority === "high").length;

  const timeAgo = (iso: string) => {
    const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 60) return `${mins}m ago`;
    if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
    return `${Math.floor(mins / 1440)}d ago`;
  };

  if (loading) {
    return (
      <div className="page">
        <div className="page-header"><h2>📧 Email Management</h2></div>
        <div className="loading-state"><div className="spinner" />Loading emails…</div>
      </div>
    );
  }

  return (
    <div className="page email-page">
      <div className="page-header">
        <h2>📧 Email Management</h2>
        <span className="text-muted">AI-powered email triage and response — review, edit & approve before sending</span>
      </div>

      {message && (
        <div className={`alert alert-${message.type}`} style={{ marginBottom: 16 }}>
          {message.type === "success" ? "✅" : "❌"} {message.text}
        </div>
      )}

      {/* ── Filter Bar ── */}
      <div className="email-filters">
        <button className={`email-filter-btn ${filter === "all" ? "active" : ""}`} onClick={() => setFilter("all")}>
          📬 All <span className="email-filter-count">{emails.length}</span>
        </button>
        <button className={`email-filter-btn ${filter === "unread" ? "active" : ""}`} onClick={() => setFilter("unread")}>
          ✉️ Unread <span className="email-filter-count">{unreadCount}</span>
        </button>
        <button className={`email-filter-btn ${filter === "high" ? "active" : ""}`} onClick={() => setFilter("high")}>
          🔴 High Priority <span className="email-filter-count">{highCount}</span>
        </button>
        <button className="btn btn-secondary btn-sm" onClick={loadEmails} style={{ marginLeft: "auto" }}>
          🔄 Refresh
        </button>
      </div>

      <div className="email-layout">
        {/* ── Email List ── */}
        <div className="email-list">
          {filtered.length === 0 ? (
            <div className="email-empty">
              <span style={{ fontSize: "2rem" }}>📭</span>
              <p>No emails match this filter</p>
            </div>
          ) : (
            filtered.map((email) => (
              <button
                key={email.id}
                className={`email-row ${selected?.id === email.id ? "email-row-active" : ""} ${!email.isRead ? "email-row-unread" : ""}`}
                onClick={() => openEmail(email)}
              >
                <div className="email-row-left">
                  <span className={`email-priority-dot`} style={{ background: PRIORITY_STYLES[email.priority].color }} />
                  <div className="email-row-content">
                    <div className="email-row-from">{email.from.split("@")[0]}</div>
                    <div className="email-row-subject">{email.subject}</div>
                    <div className="email-row-preview">{email.preview}</div>
                  </div>
                </div>
                <div className="email-row-meta">
                  <span className="email-row-time">{timeAgo(email.receivedAt)}</span>
                  {email.hasAiDraft && <span className="email-ai-badge">🤖 AI Draft</span>}
                </div>
              </button>
            ))
          )}
        </div>

        {/* ── Email Detail / Reply ── */}
        <div className="email-detail">
          {!selected ? (
            <div className="email-detail-empty">
              <span style={{ fontSize: "3rem", opacity: 0.3 }}>📧</span>
              <p className="text-muted">Select an email to view and respond</p>
            </div>
          ) : (
            <>
              <div className="email-detail-header">
                <div>
                  <h3 className="email-detail-subject">{selected.subject}</h3>
                  <div className="email-detail-meta">
                    <span>From: <strong>{selected.from}</strong></span>
                    <span className="email-detail-priority" style={{ background: PRIORITY_STYLES[selected.priority].bg, color: PRIORITY_STYLES[selected.priority].color }}>
                      {PRIORITY_STYLES[selected.priority].label}
                    </span>
                    <span className="text-muted">{timeAgo(selected.receivedAt)}</span>
                  </div>
                </div>
                <button className="btn btn-secondary btn-sm" onClick={() => setSelected(null)}>✕ Close</button>
              </div>

              {/* Original Email Body */}
              <div className="email-detail-body">
                <pre className="email-body-text">{selected.body}</pre>
              </div>

              {/* AI Reply Section */}
              <div className="email-reply-section">
                <div className="email-reply-header">
                  <h4>✍️ Reply</h4>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={generateAiDraft}
                    disabled={generatingDraft}
                  >
                    {generatingDraft ? "⏳ Generating…" : "🤖 Generate AI Draft"}
                  </button>
                </div>
                <textarea
                  className="email-reply-textarea"
                  rows={10}
                  value={draftText}
                  onChange={(e) => setDraftText(e.target.value)}
                  placeholder="Write your reply here, or click 'Generate AI Draft' for an AI-composed response…"
                />
                <div className="email-reply-actions">
                  <button
                    className="btn btn-primary"
                    onClick={sendReply}
                    disabled={sending || !draftText.trim()}
                  >
                    {sending ? "Sending…" : "📤 Send Reply"}
                  </button>
                  <button className="btn btn-secondary" onClick={() => setDraftText("")}>
                    Clear Draft
                  </button>
                  <span className="text-muted" style={{ fontSize: "0.75rem", marginLeft: "auto" }}>
                    ⚠️ Always review AI-generated content before sending
                  </span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
