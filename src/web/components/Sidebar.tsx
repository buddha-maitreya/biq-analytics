import React from "react";
import type { Page, AppConfig, AuthUser } from "../types";

interface SidebarProps {
  config: AppConfig;
  currentPage: Page;
  onNavigate: (page: Page) => void;
  user: AuthUser;
  onLogout: () => void;
}

/** Role display labels */
const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  manager: "Manager",
  staff: "Staff",
  viewer: "Viewer",
};

const navItems: { page: Page; icon: string; labelKey?: keyof AppConfig["labels"] | null; fallback: string }[] = [
  { page: "dashboard", icon: "📊", labelKey: null, fallback: "Dashboard" },
  { page: "products", icon: "📦", labelKey: "productPlural", fallback: "Products" },
  { page: "orders", icon: "🛒", labelKey: "orderPlural", fallback: "Orders" },
  { page: "customers", icon: "👥", labelKey: "customerPlural", fallback: "Customers" },
  { page: "inventory", icon: "🏭", labelKey: "warehouse", fallback: "Inventory" },
  { page: "invoices", icon: "📄", labelKey: "invoice", fallback: "Invoices" },
  { page: "assistant", icon: "🤖", labelKey: null, fallback: "AI Assistant" },
  { page: "reports", icon: "📈", labelKey: null, fallback: "Reports" },
  { page: "pos", icon: "➕", labelKey: null, fallback: "New Order" },
  { page: "invoice_checker", icon: "🔍", labelKey: null, fallback: "Invoice Checker" },
  { page: "admin", icon: "⚙️", labelKey: null, fallback: "Admin" },
  { page: "settings", icon: "🎨", labelKey: null, fallback: "Settings" },
];

/** Pages restricted by role */
const ROLE_VISIBLE: Record<string, Page[]> = {
  viewer: ["dashboard", "products", "orders", "customers", "inventory", "invoices", "reports"],
  staff: ["dashboard", "products", "orders", "customers", "inventory", "invoices", "assistant", "reports", "pos", "invoice_checker"],
  manager: ["dashboard", "products", "orders", "customers", "inventory", "invoices", "assistant", "reports", "pos", "invoice_checker"],
};

export default function Sidebar({ config, currentPage, onNavigate, user, onLogout }: SidebarProps) {
  // super_admin and admin see everything; others see role-specific pages
  const visiblePages = ROLE_VISIBLE[user.role] ?? null; // null = all pages

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        {config.companyLogoUrl && (
          <img src={config.companyLogoUrl} alt="" className="sidebar-logo" />
        )}
        <div className="sidebar-brand">
          <h1 className="sidebar-title">
            {config.companyName || "Business IQ"}
          </h1>
          {config.companyTagline && (
            <span className="sidebar-tagline">{config.companyTagline}</span>
          )}
        </div>
        <span className="sidebar-powered">Powered by Business IQ</span>
      </div>
      <nav className="sidebar-nav">
        {navItems
          .filter((item) => !visiblePages || visiblePages.includes(item.page))
          .map((item) => (
            <button
              key={item.page}
              className={`nav-item ${currentPage === item.page ? "active" : ""}`}
              onClick={() => onNavigate(item.page)}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">
                {item.labelKey ? config.labels[item.labelKey] : item.fallback}
              </span>
            </button>
          ))}
      </nav>
      <div className="sidebar-footer">
        <div className="sidebar-user">
          <div className="sidebar-user-avatar">
            {user.name.charAt(0).toUpperCase()}
          </div>
          <div className="sidebar-user-info">
            <span className="sidebar-user-name">{user.name}</span>
            <span className="sidebar-user-role">{ROLE_LABELS[user.role] ?? user.role}</span>
          </div>
          <button className="sidebar-logout-btn" onClick={onLogout} title="Sign out">
            ⏻
          </button>
        </div>
      </div>
    </aside>
  );
}
