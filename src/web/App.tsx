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
import SettingsPage from "./pages/SettingsPage";
import "./styles/global.css";
import type { Page, AppConfig } from "./types";

export type { Page, AppConfig };

export default function App() {
  const [page, setPage] = useState<Page>("dashboard");
  const [configVersion, setConfigVersion] = useState(0);
  const { data: appConfig, refetch } = useAPI<AppConfig>("GET /api/config");

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
        return <AdminPage config={cfg} />;
      case "settings":
        return <SettingsPage config={cfg} onSaved={refreshConfig} />;
    }
  };

  return (
    <div className="app-layout">
      <Sidebar config={cfg} currentPage={page} onNavigate={setPage} />
      <main className="main-content">{renderPage()}</main>
    </div>
  );
}
