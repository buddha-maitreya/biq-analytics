import React from "react";
import { useAPI } from "@agentuity/react";
import type { AppConfig } from "../App";

interface InventoryPageProps {
  config: AppConfig;
}

export default function InventoryPage({ config }: InventoryPageProps) {
  const { data: lowStock, isLoading: lowLoading } = useAPI<any>("/api/inventory/low-stock");
  const { data: warehouses, isLoading: whLoading } = useAPI<any>("/api/warehouses");

  return (
    <div className="page">
      <div className="page-header">
        <h2>Inventory</h2>
      </div>

      {/* Warehouse overview */}
      <section className="card">
        <h3>{config.labels.warehouse}s</h3>
        {whLoading ? (
          <p className="loading">Loading...</p>
        ) : (
          <div className="card-grid">
            {warehouses?.data?.map((w: any) => (
              <div key={w.id} className="stat-card">
                <h4>
                  {w.name} {w.isDefault && <span className="badge">Default</span>}
                </h4>
                <p className="stat-desc">{w.code}</p>
                <p className="stat-desc">{w.address ?? "No address"}</p>
              </div>
            ))}
            {(!warehouses?.data || warehouses.data.length === 0) && (
              <p className="text-muted">No {config.labels.warehouse.toLowerCase()}s configured</p>
            )}
          </div>
        )}
      </section>

      {/* Low stock alerts */}
      <section className="card alert-card">
        <h3>⚠️ Low Stock Alerts</h3>
        {lowLoading ? (
          <p className="loading">Loading...</p>
        ) : lowStock?.data?.length > 0 ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>{config.labels.product}</th>
                <th>SKU</th>
                <th>Current Qty</th>
                <th>Reorder Point</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {lowStock.data.map((item: any, i: number) => (
                <tr key={i}>
                  <td>{item.productName}</td>
                  <td className="font-mono">{item.sku}</td>
                  <td className={item.quantity === 0 ? "text-danger" : "text-warning"}>
                    {item.quantity}
                  </td>
                  <td>{item.reorderPoint ?? item.minStockLevel}</td>
                  <td>
                    {item.quantity === 0 ? (
                      <span className="status-badge status-err">Out of Stock</span>
                    ) : (
                      <span className="status-badge status-warn">Low</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-muted">All stock levels healthy ✓</p>
        )}
      </section>
    </div>
  );
}
