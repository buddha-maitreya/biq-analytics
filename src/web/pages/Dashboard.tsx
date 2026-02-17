import React from "react";
import { useAPI } from "@agentuity/react";
import type { AppConfig } from "../App";

interface DashboardProps {
  config: AppConfig;
}

export default function Dashboard({ config }: DashboardProps) {
  const { data: health } = useAPI<{ status: string }>("GET /api/health");
  const { data: lowStock } = useAPI<{ data: any[] }>("GET /api/inventory/low-stock");

  return (
    <div className="page">
      <div className="page-header">
        <h2>Dashboard</h2>
        <span className={`status-badge ${health?.status === "ok" ? "status-ok" : "status-err"}`}>
          {health?.status === "ok" ? "System Online" : "Connecting..."}
        </span>
      </div>

      <div className="card-grid">
        <div className="stat-card">
          <h3>{config.labels.productPlural}</h3>
          <p className="stat-value">—</p>
          <p className="stat-desc">Active {config.labels.productPlural.toLowerCase()}</p>
        </div>
        <div className="stat-card">
          <h3>{config.labels.orderPlural}</h3>
          <p className="stat-value">—</p>
          <p className="stat-desc">Total {config.labels.orderPlural.toLowerCase()}</p>
        </div>
        <div className="stat-card">
          <h3>{config.labels.customerPlural}</h3>
          <p className="stat-value">—</p>
          <p className="stat-desc">Active {config.labels.customerPlural.toLowerCase()}</p>
        </div>
        <div className="stat-card">
          <h3>Revenue</h3>
          <p className="stat-value">—</p>
          <p className="stat-desc">{config.currency} total</p>
        </div>
      </div>

      {lowStock?.data && lowStock.data.length > 0 && (
        <div className="card alert-card">
          <h3>⚠️ Low Stock Alerts</h3>
          <table className="data-table">
            <thead>
              <tr>
                <th>{config.labels.product}</th>
                <th>SKU</th>
                <th>Quantity</th>
                <th>Reorder Point</th>
              </tr>
            </thead>
            <tbody>
              {lowStock.data.map((item: any, i: number) => (
                <tr key={i}>
                  <td>{item.productName}</td>
                  <td>{item.sku}</td>
                  <td className="text-danger">{item.quantity}</td>
                  <td>{item.reorderPoint ?? item.minStockLevel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
