import React, { useState, useMemo, useRef } from "react";
import { useAPI } from "@agentuity/react";
import type { AppConfig } from "../types";

interface InventoryPageProps {
  config: AppConfig;
}

interface CategoryGroup {
  categoryName: string;
  totalQty: number;
  totalReserved: number;
  totalValue: number;
  reorderAlerts: number;
  items: any[];
}

interface WarehouseData {
  id: string;
  name: string;
  code: string;
  address: string | null;
  isDefault: boolean;
  metadata: any;
  inventory: any[];
}

export default function InventoryPage({ config }: InventoryPageProps) {
  const { data: whData, isLoading } = useAPI<any>("GET /api/warehouses/summary");
  const { data: lowStock } = useAPI<any>("GET /api/inventory/low-stock");
  const [expandedWh, setExpandedWh] = useState<Set<string>>(new Set());
  const [expandedCat, setExpandedCat] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState("");
  const scanRef = useRef<HTMLInputElement>(null);

  const warehouses: WarehouseData[] = whData?.data ?? [];
  const lowStockItems: any[] = lowStock?.data ?? [];

  // Build category groups per warehouse
  const warehouseGroups = useMemo(() => {
    return warehouses.map((wh) => {
      const catMap: Record<string, CategoryGroup> = {};
      let whTotalQty = 0;
      let whTotalValue = 0;
      let whAlerts = 0;

      for (const inv of wh.inventory ?? []) {
        const product = inv.product;
        if (!product) continue;

        const catName = product.category?.name ?? "Uncategorized";
        if (!catMap[catName]) {
          catMap[catName] = { categoryName: catName, totalQty: 0, totalReserved: 0, totalValue: 0, reorderAlerts: 0, items: [] };
        }
        const qty = inv.quantity ?? 0;
        const reserved = inv.reservedQuantity ?? 0;
        const price = Number(product.price) || 0;
        const value = qty * price;
        const reorderPt = product.reorderPoint ?? product.minStockLevel ?? 0;
        const isLow = qty <= reorderPt && reorderPt > 0;

        catMap[catName].totalQty += qty;
        catMap[catName].totalReserved += reserved;
        catMap[catName].totalValue += value;
        if (isLow) catMap[catName].reorderAlerts++;
        catMap[catName].items.push({ ...inv, _value: value, _isLow: isLow, _reorderPt: reorderPt });

        whTotalQty += qty;
        whTotalValue += value;
        if (isLow) whAlerts++;
      }

      const categories = Object.values(catMap).sort((a, b) => a.categoryName.localeCompare(b.categoryName));
      return { warehouse: wh, categories, whTotalQty, whTotalValue, whAlerts };
    });
  }, [warehouses]);

  // Global summary
  const globalSummary = useMemo(() => {
    let totalLocations = warehouses.length;
    let totalItems = 0;
    let totalValue = 0;
    let totalCategories = new Set<string>();
    let totalAlerts = lowStockItems.length;

    for (const wg of warehouseGroups) {
      totalItems += wg.whTotalQty;
      totalValue += wg.whTotalValue;
      for (const cat of wg.categories) {
        totalCategories.add(cat.categoryName);
      }
    }

    return { totalLocations, totalItems, totalValue, totalCategories: totalCategories.size, totalAlerts };
  }, [warehouseGroups, lowStockItems, warehouses]);

  const toggleWarehouse = (id: string) => {
    setExpandedWh((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleCategory = (key: string) => {
    setExpandedCat((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtInt = (n: number) => n.toLocaleString();

  // Filter by search
  const filteredGroups = useMemo(() => {
    if (!searchTerm) return warehouseGroups;
    const q = searchTerm.toLowerCase();
    return warehouseGroups.filter(
      (wg) =>
        wg.warehouse.name.toLowerCase().includes(q) ||
        wg.warehouse.code.toLowerCase().includes(q) ||
        wg.categories.some((c) => c.categoryName.toLowerCase().includes(q))
    );
  }, [warehouseGroups, searchTerm]);

  return (
    <div className="page">
      <div className="page-header-row">
        <div>
          <h2>Inventory</h2>
          <span className="text-muted">
            {globalSummary.totalLocations} {config.labels.warehouse.toLowerCase()}{globalSummary.totalLocations !== 1 ? "s" : ""} · {fmtInt(globalSummary.totalItems)} items in stock
          </span>
        </div>
      </div>

      {/* Global Summary Cards */}
      {!isLoading && (
        <div className="summary-cards">
          <div className="summary-card summary-card-highlight">
            <span className="summary-card-value">{fmt(globalSummary.totalValue)}</span>
            <span className="summary-card-label">Total Inventory Value ({config.currency})</span>
          </div>
          <div className="summary-card">
            <span className="summary-card-value">{fmtInt(globalSummary.totalItems)}</span>
            <span className="summary-card-label">Total Units in Stock</span>
          </div>
          <div className="summary-card">
            <span className="summary-card-value">{globalSummary.totalCategories}</span>
            <span className="summary-card-label">Active Categories</span>
          </div>
          <div className="summary-card" style={{ borderLeft: globalSummary.totalAlerts > 0 ? "3px solid #ef4444" : undefined }}>
            <span className="summary-card-value" style={{ color: globalSummary.totalAlerts > 0 ? "#ef4444" : "#22c55e" }}>
              {globalSummary.totalAlerts > 0 ? `${globalSummary.totalAlerts} ⚠` : "✓"}
            </span>
            <span className="summary-card-label">{globalSummary.totalAlerts > 0 ? "Low Stock Alerts" : "Stock Healthy"}</span>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="toolbar">
        <div className="search-box">
          <span className="search-icon">🔍</span>
          <input
            type="text"
            placeholder="Search warehouses or categories..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          {searchTerm && <button className="search-clear" onClick={() => setSearchTerm("")}>✕</button>}
          {/* Scan stock sheet / barcode */}
          <input ref={scanRef} type="file" accept="image/*" capture="environment" onChange={() => {
            scanRef.current && (scanRef.current.value = "");
            alert("📷 Stock sheet captured! For full OCR, use the AI Assistant — attach the photo and say \"read this stock sheet\".");
          }} style={{ display: "none" }} />
          <button
            className="btn btn-icon scan-btn"
            onClick={() => scanRef.current?.click()}
            title="Scan stock sheet or barcode with camera"
          >
            📷
          </button>
        </div>
        <span className="toolbar-count">
          {filteredGroups.length} location{filteredGroups.length !== 1 ? "s" : ""}
        </span>
      </div>

      {isLoading ? (
        <div className="loading-state">
          <div className="spinner" />
          <p>Loading inventory...</p>
        </div>
      ) : (
        <div className="warehouse-grid">
          {filteredGroups.map(({ warehouse: wh, categories, whTotalQty, whTotalValue, whAlerts }) => {
            const isOpen = expandedWh.has(wh.id);
            const phone = wh.metadata?.phone ?? null;
            const email = wh.metadata?.email ?? null;
            const type = wh.metadata?.type ?? null;

            return (
              <div key={wh.id} className={`warehouse-card ${isOpen ? "warehouse-card-open" : ""}`}>
                {/* Warehouse Header */}
                <div className="warehouse-header" onClick={() => toggleWarehouse(wh.id)}>
                  <div className="warehouse-header-left">
                    <span className="warehouse-expand-icon">{isOpen ? "▼" : "▶"}</span>
                    <div>
                      <div className="warehouse-name">
                        {wh.name}
                        {wh.isDefault && <span className="badge badge-default">Default</span>}
                      </div>
                      <div className="warehouse-meta">
                        <code className="sku-code">{wh.code}</code>
                        {wh.address && <span> · {wh.address}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="warehouse-header-right">
                    <div className="warehouse-stat">
                      <span className="warehouse-stat-value">{fmtInt(whTotalQty)}</span>
                      <span className="warehouse-stat-label">Units</span>
                    </div>
                    <div className="warehouse-stat">
                      <span className="warehouse-stat-value">{fmt(whTotalValue)}</span>
                      <span className="warehouse-stat-label">{config.currency}</span>
                    </div>
                    <div className="warehouse-stat">
                      <span className="warehouse-stat-value">{categories.length}</span>
                      <span className="warehouse-stat-label">Categories</span>
                    </div>
                    {whAlerts > 0 && (
                      <div className="warehouse-stat warehouse-stat-alert">
                        <span className="warehouse-stat-value">{whAlerts} ⚠</span>
                        <span className="warehouse-stat-label">Low Stock</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Contact Info */}
                {isOpen && (phone || email || type) && (
                  <div className="warehouse-contact">
                    {type && <span className="contact-tag">{type}</span>}
                    {phone && <span className="contact-item">📞 {phone}</span>}
                    {email && <span className="contact-item">✉ {email}</span>}
                  </div>
                )}

                {/* Category Breakdown */}
                {isOpen && (
                  <div className="warehouse-categories">
                    <table className="data-table inventory-table">
                      <thead>
                        <tr>
                          <th style={{ width: 30 }}></th>
                          <th>Category</th>
                          <th className="text-right">Current Qty</th>
                          <th className="text-right">Value ({config.currency})</th>
                          <th className="text-right">Reorder Alerts</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {categories.map((cat) => {
                          const catKey = `${wh.id}__${cat.categoryName}`;
                          const catOpen = expandedCat.has(catKey);
                          const hasAlerts = cat.reorderAlerts > 0;

                          return (
                            <React.Fragment key={catKey}>
                              <tr className="category-row" onClick={() => toggleCategory(catKey)}>
                                <td className="expand-cell">{catOpen ? "▼" : "▶"}</td>
                                <td>
                                  <span className="category-badge-inv">{cat.categoryName}</span>
                                  <span className="text-muted" style={{ marginLeft: 8, fontSize: "0.8rem" }}>
                                    ({cat.items.length} item{cat.items.length !== 1 ? "s" : ""})
                                  </span>
                                </td>
                                <td className="text-right font-semibold">{fmtInt(cat.totalQty)}</td>
                                <td className="text-right">{fmt(cat.totalValue)}</td>
                                <td className="text-right">
                                  {hasAlerts
                                    ? <span style={{ color: "#ef4444", fontWeight: 600 }}>{cat.reorderAlerts}</span>
                                    : <span style={{ color: "#22c55e" }}>0</span>}
                                </td>
                                <td>
                                  {hasAlerts ? (
                                    <span className="status-pill" style={{ backgroundColor: "#fef3c7", color: "#92400e" }}>
                                      Needs Reorder
                                    </span>
                                  ) : (
                                    <span className="status-pill" style={{ backgroundColor: "#dcfce7", color: "#166534" }}>
                                      Healthy
                                    </span>
                                  )}
                                </td>
                              </tr>

                              {/* Expanded item details */}
                              {catOpen && cat.items.map((item: any) => (
                                <tr key={item.id} className="item-detail-row">
                                  <td></td>
                                  <td>
                                    <div className="cell-main">{item.product?.name}</div>
                                    <div className="cell-sub"><code className="sku-code">{item.product?.sku}</code> · {item.product?.unit ?? "piece"}</div>
                                  </td>
                                  <td className={`text-right ${item._isLow ? "text-danger font-semibold" : ""}`}>
                                    {fmtInt(item.quantity ?? 0)}
                                    {item.reservedQuantity > 0 && (
                                      <span className="text-muted" style={{ fontSize: "0.75rem" }}> ({item.reservedQuantity} reserved)</span>
                                    )}
                                  </td>
                                  <td className="text-right">{fmt(item._value)}</td>
                                  <td className="text-right text-muted">{item._reorderPt > 0 ? fmtInt(item._reorderPt) : "—"}</td>
                                  <td>
                                    {item._isLow ? (
                                      item.quantity === 0 ? (
                                        <span className="status-pill" style={{ backgroundColor: "#fee2e2", color: "#991b1b" }}>Out of Stock</span>
                                      ) : (
                                        <span className="status-pill" style={{ backgroundColor: "#fef3c7", color: "#92400e" }}>Low</span>
                                      )
                                    ) : (
                                      <span className="status-pill" style={{ backgroundColor: "#dcfce7", color: "#166534" }}>OK</span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </React.Fragment>
                          );
                        })}
                        {categories.length === 0 && (
                          <tr>
                            <td colSpan={6} className="text-center text-muted" style={{ padding: 24 }}>
                              No inventory in this {config.labels.warehouse.toLowerCase()}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}

          {filteredGroups.length === 0 && !isLoading && (
            <div className="card text-center text-muted" style={{ padding: 32 }}>
              {searchTerm ? "No warehouses match your search" : `No ${config.labels.warehouse.toLowerCase()}s configured`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
