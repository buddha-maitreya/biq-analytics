import React, { useState, useEffect, useCallback } from "react";
import { useAPI } from "@agentuity/react";
import Sidebar from "./components/Sidebar";
import Dashboard from "./pages/Dashboard";
import ProductsPage from "./pages/ProductsPage";
import OrdersPage from "./pages/OrdersPage";
import CustomersPage from "./pages/CustomersPage";
import InventoryPage from "./pages/InventoryPage";
import InvoicesPage from "./pages/InvoicesPage";
import AssistantPage from "./pages/AssistantPage";
import ReportsPage from "./pages/ReportsPage";
import AdminPage from "./pages/AdminPage";
import POSPage from "./pages/POSPage";
import InvoiceCheckerPage from "./pages/InvoiceCheckerPage";
import AboutPage from "./pages/AboutPage";
import EmailPage from "./pages/EmailPage";
import LoginPage from "./pages/LoginPage";
import "./styles/global.css";
import type { Page, AppConfig, AuthUser } from "./types";

export type { Page, AppConfig, AuthUser };

/** Page title labels for mobile header */
const PAGE_TITLES: Record<Page, string> = {
  dashboard: "Dashboard",
  products: "Products",
  orders: "Orders",
  customers: "Customers",
  inventory: "Inventory",
  invoices: "Invoices",
  assistant: "AI Assistant",
  reports: "Reports",
  pos: "New Order",
  invoice_checker: "Invoice Checker",
  admin: "Admin",
  settings: "Settings",
  email: "Email",
  about: "About",
};

export default function App() {
  const [page, setPage] = useState<Page>("dashboard");
  const [configVersion, setConfigVersion] = useState(0);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const saved = localStorage.getItem("biq_theme");
    if (saved === "dark" || saved === "light") return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  const { data: appConfig, refetch } = useAPI<AppConfig>("GET /api/config");

  // Apply theme to document
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("biq_theme", theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === "light" ? "dark" : "light"));
  }, []);

  // Check existing session on mount
  useEffect(() => {
    (async () => {
      try {
        // Try cookie-based auth first, fall back to localStorage token
        const token = localStorage.getItem("biq_token");
        const headers: Record<string, string> = {};
        if (token) headers["Authorization"] = `Bearer ${token}`;

        const res = await fetch("/api/auth/me", { headers });
        if (res.ok) {
          const data = await res.json();
          if (data.user) {
            setUser(data.user);
          }
        }
      } catch {
        // Network error — stay on login
      } finally {
        setAuthChecked(true);
      }
    })();
  }, []);

  const handleLogin = useCallback((loggedInUser: AuthUser) => {
    setUser(loggedInUser);
    setPage("dashboard");
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // ignore
    }
    localStorage.removeItem("biq_token");
    setUser(null);
    setPage("dashboard");
  }, []);

  const refreshConfig = useCallback(() => {
    setConfigVersion((v) => v + 1);
    refetch?.();
  }, [refetch]);

  // Fallback config while loading
  const cfg: AppConfig = appConfig ?? {
    companyName: "Business IQ",
    companyLogoUrl: "",
    companyTagline: "",
    primaryColor: "#3b82f6",
    currency: "USD",
    timezone: "UTC",
    labels: {
      product: "Product",
      productPlural: "Products",
      order: "Order",
      orderPlural: "Orders",
      customer: "Customer",
      customerPlural: "Customers",
      warehouse: "Warehouse",
      invoice: "Invoice",
      unitDefault: "piece",
    },
  };

  // Show loading spinner while checking auth
  if (!authChecked) {
    return (
      <div className="login-page">
        <div className="login-card" style={{ textAlign: "center", padding: "60px 40px" }}>
          <div className="login-title" style={{ fontSize: "18px", color: "#94a3b8" }}>
            Loading…
          </div>
        </div>
      </div>
    );
  }

  // Show login if not authenticated
  if (!user) {
    return <LoginPage config={cfg} onLogin={handleLogin} />;
  }

  const renderPage = () => {
    switch (page) {
      case "dashboard":
        return <Dashboard config={cfg} />;
      case "products":
        return <ProductsPage config={cfg} />;
      case "orders":
        return <OrdersPage config={cfg} />;
      case "customers":
        return <CustomersPage config={cfg} />;
      case "inventory":
        return <InventoryPage config={cfg} />;
      case "invoices":
        return <InvoicesPage config={cfg} />;
      case "assistant":
        return <AssistantPage config={cfg} />;
      case "reports":
        return <ReportsPage config={cfg} />;
      case "pos":
        return <POSPage config={cfg} />;
      case "invoice_checker":
        return <InvoiceCheckerPage config={cfg} />;
      case "admin":
        return <AdminPage config={cfg} onSaved={refreshConfig} />;
      case "settings":
        return <AdminPage config={cfg} onSaved={refreshConfig} />;
      case "email":
        return <EmailPage config={cfg} user={user} />;
      case "about":
        return <AboutPage config={cfg} />;
    }
  };

  return (
    <div className="app-layout">
      <Sidebar
        config={cfg}
        currentPage={page}
        onNavigate={setPage}
        user={user}
        onLogout={handleLogout}
        mobileOpen={sidebarOpen}
        onCloseMobile={() => setSidebarOpen(false)}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
      <main className="main-content">
        {/* Mobile top bar — only visible on small screens via CSS */}
        <div className="mobile-header">
          <button className="hamburger-btn" onClick={() => setSidebarOpen(true)} aria-label="Open menu">
            <span /><span /><span />
          </button>
          <span className="mobile-header-title">{PAGE_TITLES[page] || "Business IQ"}</span>
        </div>
        {renderPage()}
      </main>
    </div>
  );
}
