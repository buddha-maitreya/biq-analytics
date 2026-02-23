import React, { useState } from "react";
import OrdersPage from "./OrdersPage";
import CustomersPage from "./CustomersPage";
import InvoicesPage from "./InvoicesPage";
import type { AppConfig } from "../types";

type OperationsTab = "orders" | "customers" | "invoices";

interface OperationsPageProps {
  config: AppConfig;
  initialTab?: OperationsTab;
}

const TABS: { key: OperationsTab; icon: string; labelKey?: keyof AppConfig["labels"]; fallback: string }[] = [
  { key: "orders", icon: "🛒", labelKey: "orderPlural", fallback: "Orders" },
  { key: "customers", icon: "👥", labelKey: "customerPlural", fallback: "Customers" },
  { key: "invoices", icon: "📄", labelKey: "invoice", fallback: "Invoices" },
];

export default function OperationsPage({ config, initialTab }: OperationsPageProps) {
  const [tab, setTab] = useState<OperationsTab>(initialTab ?? "orders");

  return (
    <div className="operations-page">
      <div className="page-header">
        <h2>Operations</h2>
      </div>

      <div className="operations-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`operations-tab ${tab === t.key ? "active" : ""}`}
            onClick={() => setTab(t.key)}
          >
            <span className="operations-tab-icon">{t.icon}</span>
            <span>{t.labelKey ? config.labels[t.labelKey] : t.fallback}</span>
          </button>
        ))}
      </div>

      <div className="operations-content">
        {tab === "orders" && <OrdersPage config={config} />}
        {tab === "customers" && <CustomersPage config={config} />}
        {tab === "invoices" && <InvoicesPage config={config} />}
      </div>
    </div>
  );
}
