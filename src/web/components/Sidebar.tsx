import React, { useState, useEffect } from "react";
import type { Page, AppConfig, AuthUser } from "../types";

interface SidebarProps {
  config: AppConfig;
  currentPage: Page;
  onNavigate: (page: Page) => void;
  user: AuthUser;
  onLogout: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

/** Role display labels */
const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  manager: "Manager",
  staff: "Staff",
  viewer: "Viewer",
};

/** Role emoji badges */
const ROLE_EMOJIS: Record<string, string> = {
  super_admin: "🛡️",
  admin: "⚡",
  manager: "📋",
  staff: "👤",
  viewer: "👁️",
};

const navItems: { page: Page; icon: string; labelKey?: keyof AppConfig["labels"] | null; fallback: string }[] = [
  { page: "assistant", icon: "🤖", labelKey: null, fallback: "Executive AI Assistant" },
  { page: "dashboard", icon: "📊", labelKey: null, fallback: "Dashboard" },
  { page: "products", icon: "📦", labelKey: "productPlural", fallback: "Products" },
  { page: "orders", icon: "🛒", labelKey: "orderPlural", fallback: "Orders" },
  { page: "customers", icon: "👥", labelKey: "customerPlural", fallback: "Customers" },
  { page: "inventory", icon: "🏭", labelKey: "warehouse", fallback: "Inventory" },
  { page: "invoices", icon: "📄", labelKey: "invoice", fallback: "Invoices" },
  { page: "reports", icon: "📈", labelKey: null, fallback: "Reports" },
  { page: "admin", icon: "⚙️", labelKey: null, fallback: "Admin" },
  { page: "email", icon: "📧", labelKey: null, fallback: "Email" },
  { page: "about", icon: "ℹ️", labelKey: null, fallback: "About" },
];

/** Pages restricted by role (base access — can be extended via permissions) */
const ROLE_VISIBLE: Record<string, Page[]> = {
  viewer: ["dashboard", "products", "orders", "customers", "inventory", "invoices", "reports", "about"],
  staff: ["dashboard", "products", "orders", "customers", "inventory", "invoices", "reports", "about"],
  manager: ["dashboard", "products", "orders", "customers", "inventory", "invoices", "reports", "about"],
  admin: ["dashboard", "products", "orders", "customers", "inventory", "invoices", "reports", "admin", "about"],
};

/** Pages that can be unlocked via the permissions array (regardless of role) */
const PERMISSION_PAGES: Record<string, Page> = {
  assistant: "assistant",
};

export default function Sidebar({ config, currentPage, onNavigate, user, onLogout, mobileOpen, onCloseMobile }: SidebarProps) {
  // ── Theme toggle ──
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("biq-theme") as "light" | "dark") ?? "light";
    }
    return "light";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("biq-theme", theme);
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === "light" ? "dark" : "light"));

  // super_admin sees everything; others get role-based pages + permission-granted pages
  let visiblePages: Page[] | null = null; // null = all pages (super_admin)
  if (ROLE_VISIBLE[user.role]) {
    visiblePages = [...ROLE_VISIBLE[user.role]];
    // Add permission-gated pages
    for (const [perm, page] of Object.entries(PERMISSION_PAGES)) {
      if (user.permissions?.includes(perm) && !visiblePages.includes(page)) {
        visiblePages.unshift(page); // Add at the top
      }
    }
  }

  const handleNav = (p: Page) => {
    onNavigate(p);
    onCloseMobile(); // close drawer on mobile after navigating
  };

  return (
    <>
      {/* Overlay backdrop — visible only when mobile drawer is open */}
      {mobileOpen && <div className="sidebar-overlay" onClick={onCloseMobile} />}
      <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
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
          <button className="sidebar-close-btn" onClick={onCloseMobile} aria-label="Close menu">✕</button>
          <div className="sidebar-header-actions">
            <button className="theme-toggle-btn" onClick={toggleTheme} title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}>
              {theme === "light" ? "🌙" : "☀️"}
            </button>
          </div>
          <span className="sidebar-powered">Business IQ - Enterprise</span>
        </div>
        <nav className="sidebar-nav">
          {navItems
            .filter((item) => !visiblePages || visiblePages.includes(item.page))
            .map((item) => (
              <button
                key={item.page}
                className={`nav-item ${currentPage === item.page ? "active" : ""}`}
                onClick={() => handleNav(item.page)}
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
              {ROLE_EMOJIS[user.role] ?? "👤"}
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
    </>
  );
}
