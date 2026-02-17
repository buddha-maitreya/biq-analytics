import React from "react";
import type { Page, AppConfig } from "../types";

interface SidebarProps {
  config: AppConfig;
  currentPage: Page;
  onNavigate: (page: Page) => void;
}

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

export default function Sidebar({ config, currentPage, onNavigate }: SidebarProps) {
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
        {navItems.map((item) => (
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
        <span className="version">v1.0.0</span>
      </div>
    </aside>
  );
}
