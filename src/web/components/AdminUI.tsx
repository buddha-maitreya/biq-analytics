import React from "react";

/* ═══════════════════════════════════════════════════════
   Shared Admin Console UI Components
   Elegant, reusable primitives for all admin pages
   ═══════════════════════════════════════════════════════ */

/* ---------- Stat Card ---------- */
interface StatCardProps {
  icon: string;
  value: string | number;
  label: string;
  accent?: string; // hex color for gradient
  subtitle?: string;
  onClick?: () => void;
}

export function StatCard({ icon, value, label, accent = "#3b82f6", subtitle, onClick }: StatCardProps) {
  return (
    <div
      className="admin-stat-card"
      style={{ "--stat-accent": accent } as React.CSSProperties}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") onClick(); } : undefined}
    >
      <div className="admin-stat-icon-wrap">
        <span className="admin-stat-icon">{icon}</span>
      </div>
      <div className="admin-stat-body">
        <span className="admin-stat-value">{value}</span>
        <span className="admin-stat-label">{label}</span>
        {subtitle && <span className="admin-stat-subtitle">{subtitle}</span>}
      </div>
    </div>
  );
}

export function StatRow({ children }: { children: React.ReactNode }) {
  return <div className="admin-stat-row">{children}</div>;
}

/* ---------- Section Card ---------- */
interface SectionCardProps {
  title?: string;
  icon?: string;
  subtitle?: string;
  accent?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  noPadding?: boolean;
}

export function SectionCard({ title, icon, subtitle, accent, actions, children, className = "", noPadding }: SectionCardProps) {
  return (
    <div className={`admin-section-card ${className}`} style={accent ? { "--section-accent": accent } as React.CSSProperties : undefined}>
      {(title || actions) && (
        <div className="admin-section-card-header">
          <div className="admin-section-card-title-group">
            {icon && <span className="admin-section-card-icon">{icon}</span>}
            <div>
              {title && <h4 className="admin-section-card-title">{title}</h4>}
              {subtitle && <p className="admin-section-card-subtitle">{subtitle}</p>}
            </div>
          </div>
          {actions && <div className="admin-section-card-actions">{actions}</div>}
        </div>
      )}
      <div className={noPadding ? "admin-section-card-body-flush" : "admin-section-card-body"}>
        {children}
      </div>
    </div>
  );
}

/* ---------- Search Toolbar ---------- */
interface SearchToolbarProps {
  search: string;
  onSearchChange: (val: string) => void;
  placeholder?: string;
  count?: number;
  countLabel?: string;
  children?: React.ReactNode; // extra buttons/filters
}

export function SearchToolbar({ search, onSearchChange, placeholder = "Search...", count, countLabel, children }: SearchToolbarProps) {
  return (
    <div className="admin-toolbar">
      <div className="admin-search-wrap">
        <span className="admin-search-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
        </span>
        <input
          className="admin-search-input"
          placeholder={placeholder}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        {search && (
          <button className="admin-search-clear" onClick={() => onSearchChange("")}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
      {count !== undefined && (
        <span className="admin-toolbar-count">
          {count} {countLabel || "result"}{count !== 1 ? "s" : ""}
        </span>
      )}
      {children}
    </div>
  );
}

/* ---------- Empty State ---------- */
interface EmptyStateProps {
  icon: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="admin-empty-state">
      <div className="admin-empty-icon">{icon}</div>
      <h3 className="admin-empty-title">{title}</h3>
      {description && <p className="admin-empty-desc">{description}</p>}
      {action && <div className="admin-empty-action">{action}</div>}
    </div>
  );
}

/* ---------- Alert / Flash Banner ---------- */
interface AlertBannerProps {
  type: "success" | "error" | "info" | "warning";
  children: React.ReactNode;
  onDismiss?: () => void;
}

const ALERT_ICONS: Record<string, string> = {
  success: "✓",
  error: "✕",
  info: "ℹ",
  warning: "⚠",
};

export function AlertBanner({ type, children, onDismiss }: AlertBannerProps) {
  return (
    <div className={`admin-alert admin-alert-${type}`}>
      <span className="admin-alert-icon">{ALERT_ICONS[type]}</span>
      <span className="admin-alert-text">{children}</span>
      {onDismiss && (
        <button className="admin-alert-dismiss" onClick={onDismiss}>×</button>
      )}
    </div>
  );
}

/* ---------- Form Panel (elevated create/edit form) ---------- */
interface FormPanelProps {
  title: string;
  icon?: string;
  onClose: () => void;
  onSave: () => void;
  saving?: boolean;
  saveLabel?: string;
  children: React.ReactNode;
  footer?: React.ReactNode; // extra footer content (e.g. toggle switch)
}

export function FormPanel({ title, icon, onClose, onSave, saving, saveLabel, children, footer }: FormPanelProps) {
  return (
    <div className="admin-form-panel-v2">
      <div className="admin-form-panel-v2-header">
        <div className="admin-form-panel-v2-header-left">
          {icon && <span className="admin-form-panel-v2-icon">{icon}</span>}
          <h4 className="admin-form-panel-v2-title">{title}</h4>
        </div>
        <button className="admin-form-panel-v2-close" onClick={onClose}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="admin-form-panel-v2-body">
        {children}
      </div>
      <div className="admin-form-panel-v2-footer">
        {footer}
        <div className="admin-form-panel-v2-actions">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={onSave} disabled={saving}>
            {saving ? "Saving..." : saveLabel || "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Field Group (visual grouping of form fields) ---------- */
interface FieldGroupProps {
  label?: string;
  hint?: string;
  cols?: 1 | 2 | 3 | 4;
  children: React.ReactNode;
}

export function FieldGroup({ label, hint, cols = 2, children }: FieldGroupProps) {
  return (
    <div className="admin-field-group">
      {label && (
        <div className="admin-field-group-header">
          <span className="admin-field-group-label">{label}</span>
          {hint && <span className="admin-field-group-hint">{hint}</span>}
        </div>
      )}
      <div className={`admin-field-grid admin-field-cols-${cols}`}>
        {children}
      </div>
    </div>
  );
}

/* ---------- Form Field v2 ---------- */
interface FormFieldV2Props {
  label: string;
  hint?: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}

export function FormFieldV2({ label, hint, required, error, children }: FormFieldV2Props) {
  return (
    <div className={`admin-form-field ${error ? "admin-form-field-error" : ""}`}>
      <label className="admin-form-field-label">
        {label}
        {required && <span className="admin-form-field-required">*</span>}
      </label>
      {children}
      {hint && !error && <span className="admin-form-field-hint">{hint}</span>}
      {error && <span className="admin-form-field-error-text">{error}</span>}
    </div>
  );
}

/* ---------- Badge ---------- */
interface BadgeProps {
  children: React.ReactNode;
  variant?: "default" | "success" | "warning" | "danger" | "info" | "muted";
  dot?: boolean;
  dotColor?: string;
}

export function Badge({ children, variant = "default", dot, dotColor }: BadgeProps) {
  return (
    <span className={`admin-badge admin-badge-${variant}`}>
      {dot && <span className="admin-badge-dot" style={dotColor ? { background: dotColor } : undefined} />}
      {children}
    </span>
  );
}

/* ---------- Tip / Help Block ---------- */
export function TipBlock({ children }: { children: React.ReactNode }) {
  return (
    <div className="admin-tip-block">
      <span className="admin-tip-icon">💡</span>
      <div className="admin-tip-content">{children}</div>
    </div>
  );
}

/* ---------- Loading Spinner ---------- */
export function LoadingState({ message = "Loading..." }: { message?: string }) {
  return (
    <div className="admin-loading-state">
      <div className="admin-loading-spinner" />
      <p className="admin-loading-text">{message}</p>
    </div>
  );
}
