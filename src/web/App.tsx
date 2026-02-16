import React, { useState, useEffect } from "react";
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
import "./styles/global.css";

export type Page =
  | "dashboard"
  | "products"
  | "orders"
  | "customers"
  | "inventory"
  | "invoices"
  | "assistant"
  | "reports"
  | "admin";

export interface AppConfig {
  companyName: string;
  companyLogoUrl: string;
  currency: string;
  timezone: string;
  labels: {
    product: string;
    productPlural: string;
    order: string;
    orderPlural: string;
    customer: string;
    customerPlural: string;
    warehouse: string;
    invoice: string;
    unitDefault: string;
  };
}

export default function App() {
  const [page, setPage] = useState<Page>("dashboard");
  const { data: appConfig } = useAPI<AppConfig>("/api/config");

  // Fallback config while loading
  const cfg: AppConfig = appConfig ?? {
    companyName: "Business IQ",
    companyLogoUrl: "",
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
      case "admin":
        return <AdminPage config={cfg} />;
    }
  };

  return (
    <div className="app-layout">
      <Sidebar config={cfg} currentPage={page} onNavigate={setPage} />
      <main className="main-content">{renderPage()}</main>
    </div>
  );
}
