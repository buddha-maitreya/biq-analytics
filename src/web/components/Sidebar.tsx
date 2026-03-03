import React, { useState, useEffect, useRef, useCallback } from "react";
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
  { page: "dashboard",  icon: "📊", labelKey: null, fallback: "Dashboard" },
  { page: "analytics",  icon: "🔬", labelKey: null, fallback: "Analytics Explorer" },
  { page: "assistant",  icon: "🤖", labelKey: null, fallback: "AI Assistant" },
  { page: "reports",    icon: "📋", labelKey: null, fallback: "Reports" },
  { page: "admin",      icon: "⚙️", labelKey: null, fallback: "Admin" },
  { page: "about",      icon: "ℹ️", labelKey: null, fallback: "About" },
];

/** Pages restricted by role (base access — can be extended via permissions) */
const ROLE_VISIBLE: Record<string, Page[]> = {
  viewer:  ["dashboard", "analytics", "reports", "about"],
  staff:   ["dashboard", "analytics", "assistant", "reports", "about"],
  manager: ["dashboard", "analytics", "assistant", "reports", "about"],
  admin:   ["dashboard", "analytics", "assistant", "reports", "admin", "about"],
};


const Sidebar = React.memo(function Sidebar({ config, currentPage, onNavigate, user, onLogout, mobileOpen, onCloseMobile }: SidebarProps) {
  // ── Swipe-to-close for mobile sidebar drawer ──
  const sidebarRef = useRef<HTMLElement>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!touchStart.current) return;
    const dx = e.changedTouches[0].clientX - touchStart.current.x;
    const dy = Math.abs(e.changedTouches[0].clientY - touchStart.current.y);
    // Swipe left (at least 60px horizontal, mostly horizontal)
    if (dx < -60 && dy < 100) {
      onCloseMobile();
    }
    touchStart.current = null;
  }, [onCloseMobile]);

  // super_admin sees everything; others get role-based pages
  const visiblePages: Page[] | null = ROLE_VISIBLE[user.role]
    ? [...ROLE_VISIBLE[user.role]]
    : null; // null = all pages (super_admin)

  const handleNav = (p: Page) => {
    onNavigate(p);
    onCloseMobile(); // close drawer on mobile after navigating
  };

  return (
    <>
      {/* Overlay backdrop — visible only when mobile drawer is open */}
      {mobileOpen && <div className="sidebar-overlay" onClick={onCloseMobile} />}
      <aside
        ref={sidebarRef}
        className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
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
});

export default Sidebar;
