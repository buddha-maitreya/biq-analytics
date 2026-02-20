import React, { useState, useMemo, useRef, useCallback } from "react";
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

interface ScanItem {
  name: string;
  sku: string | null;
  quantity: number;
  unit: string | null;
  location: string | null;
  notes: string | null;
  matchedProductId?: string;
  matchedProductName?: string;
  matchOptions?: Array<{ id: string; name: string; sku: string }>;
  include: boolean;
}

interface ScanResult {
  items: ScanItem[];
  documentDate: string | null;
  totalItems: number;
  confidence: number;
  warnings: string[];
}

export default function InventoryPage({ config }: InventoryPageProps) {
  const { data: whData, isLoading, refetch } = useAPI<any>("GET /api/warehouses/summary");
  const { data: lowStock } = useAPI<any>("GET /api/inventory/low-stock");
  const [expandedWh, setExpandedWh] = useState<Set<string>>(new Set());
  const [expandedCat, setExpandedCat] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState("");
  const scanRef = useRef<HTMLInputElement>(null);

  // OCR scan state
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [selectedWarehouse, setSelectedWarehouse] = useState<string>("");
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<any>(null);

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

  /** Handle stock sheet scan */
  const handleStockScan = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setScanning(true);
    setScanResult(null);
    setApplyResult(null);

    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string).split(",")[1];
        try {
          // Step 1: OCR the stock sheet
          const res = await fetch("/api/scan/stock", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ imageData: base64 }),
          });
          const data = await res.json();

          if (!data.success || !data.data?.items?.length) {
            alert("Could not extract stock data from the image. Try a clearer photo of the stock sheet.");
            setScanning(false);
            return;
          }

          // Step 2: Fuzzy match extracted names to existing products
          const names = data.data.items.map((i: any) => i.name).filter(Boolean);
          let matchResults: Record<string, any[]> = {};
          if (names.length > 0) {
            const matchRes = await fetch("/api/products/fuzzy-match", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ names }),
            });
            const matchData = await matchRes.json();
            matchResults = matchData.data ?? {};
          }

          // Build scan items with match suggestions
          const items: ScanItem[] = data.data.items.map((item: any) => {
            const matches = matchResults[item.name] ?? [];
            return {
              name: item.name,
              sku: item.sku,
              quantity: item.quantity ?? 0,
              unit: item.unit,
              location: item.location,
              notes: item.notes,
              matchedProductId: matches.length === 1 ? matches[0].id : "",
              matchedProductName: matches.length === 1 ? matches[0].name : "",
              matchOptions: matches.map((m: any) => ({ id: m.id, name: m.name, sku: m.sku })),
              include: matches.length === 1,
            };
          });

          setScanResult({
            items,
            documentDate: data.data.documentDate,
            totalItems: data.data.totalItems ?? items.length,
            confidence: data.data.confidence ?? 0.5,
            warnings: data.data.warnings ?? [],
          });

          // Default to first warehouse
          if (warehouses.length > 0 && !selectedWarehouse) {
            setSelectedWarehouse(warehouses[0].id);
          }
        } catch {
          alert("Failed to process stock sheet. Please try again.");
        }
        setScanning(false);
      };
      reader.readAsDataURL(file);
    } catch {
      setScanning(false);
    }
  }, [warehouses, selectedWarehouse]);

  /** Update a scan item's matched product */
  const updateScanItemMatch = (idx: number, productId: string) => {
    setScanResult((prev) => {
      if (!prev) return prev;
      const items = [...prev.items];
      const opt = items[idx].matchOptions?.find((m) => m.id === productId);
      items[idx] = {
        ...items[idx],
        matchedProductId: productId,
        matchedProductName: opt?.name ?? "",
        include: !!productId,
      };
      return { ...prev, items };
    });
  };

  /** Toggle include for a scan item */
  const toggleScanItem = (idx: number) => {
    setScanResult((prev) => {
      if (!prev) return prev;
      const items = [...prev.items];
      items[idx] = { ...items[idx], include: !items[idx].include };
      return { ...prev, items };
    });
  };

  /** Apply confirmed stock adjustments */
  const applyStockScan = async () => {
    if (!scanResult || !selectedWarehouse) return;
    const itemsToApply = scanResult.items.filter((i) => i.include && i.matchedProductId);
    if (itemsToApply.length === 0) {
      alert("No items selected for import. Match products and check the include boxes.");
      return;
    }

    setApplying(true);
    try {
      const res = await fetch("/api/inventory/bulk-adjust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: itemsToApply.map((i) => ({
            productId: i.matchedProductId,
            warehouseId: selectedWarehouse,
            quantity: i.quantity,
            notes: `Stock sheet import: ${i.name}${i.location ? ` (location: ${i.location})` : ""}`,
          })),
        }),
      });
      const data = await res.json();
      setApplyResult(data.data);
      if (refetch) refetch();
    } catch {
      alert("Failed to apply stock adjustments.");
    }
    setApplying(false);
  };

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
          <input ref={scanRef} type="file" accept="image/*" capture="environment" onChange={handleStockScan} style={{ display: "none" }} />
          <button
            className="btn btn-icon scan-btn"
            onClick={() => scanRef.current?.click()}
            disabled={scanning}
            title="Scan stock sheet or barcode with camera"
          >
            {scanning ? "⏳" : "📷"}
          </button>
        </div>
        <span className="toolbar-count">
          {filteredGroups.length} location{filteredGroups.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* ── OCR Scan Review Modal ── */}
      {scanResult && (
        <div className="scan-review-panel">
          <div className="scan-review-header">
            <div className="scan-review-header-left">
              <span className="scan-review-icon">📋</span>
              <div>
                <h3>Stock Sheet Scan Results</h3>
                <span className="text-muted">
                  {scanResult.items.length} items extracted
                  {scanResult.documentDate && ` · Date: ${scanResult.documentDate}`}
                  {` · Confidence: ${Math.round(scanResult.confidence * 100)}%`}
                </span>
              </div>
            </div>
            <button className="btn btn-xs btn-secondary" onClick={() => { setScanResult(null); setApplyResult(null); }}>✕ Close</button>
          </div>

          {scanResult.warnings.length > 0 && (
            <div className="scan-warnings">
              {scanResult.warnings.map((w, i) => (
                <span key={i} className="scan-warning-badge">⚠ {w}</span>
              ))}
            </div>
          )}

          <div className="scan-review-body">
            {/* Warehouse selector */}
            <div className="scan-warehouse-select">
              <label className="form-label">Target {config.labels.warehouse}:</label>
              <select value={selectedWarehouse} onChange={(e) => setSelectedWarehouse(e.target.value)}>
                <option value="">Select warehouse…</option>
                {warehouses.map((wh) => (
                  <option key={wh.id} value={wh.id}>{wh.name} ({wh.code})</option>
                ))}
              </select>
            </div>

            {/* Items table */}
            <table className="data-table scan-review-table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}>✓</th>
                  <th>Extracted Name</th>
                  <th>Qty</th>
                  <th>Unit</th>
                  <th>Matched Product</th>
                  <th>Location</th>
                </tr>
              </thead>
              <tbody>
                {scanResult.items.map((item, idx) => (
                  <tr key={idx} className={item.include ? "" : "scan-row-excluded"}>
                    <td>
                      <input type="checkbox" checked={item.include} onChange={() => toggleScanItem(idx)} />
                    </td>
                    <td>
                      <div className="cell-main">{item.name}</div>
                      {item.sku && <div className="cell-sub">SKU: {item.sku}</div>}
                    </td>
                    <td className="text-right font-semibold">{item.quantity}</td>
                    <td>{item.unit ?? "—"}</td>
                    <td>
                      {item.matchOptions && item.matchOptions.length > 0 ? (
                        <select
                          className="scan-match-select"
                          value={item.matchedProductId ?? ""}
                          onChange={(e) => updateScanItemMatch(idx, e.target.value)}
                        >
                          <option value="">— Select product —</option>
                          {item.matchOptions.map((m) => (
                            <option key={m.id} value={m.id}>{m.name} ({m.sku})</option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-muted scan-no-match">No matches found</span>
                      )}
                    </td>
                    <td className="text-muted">{item.location ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Apply result */}
          {applyResult && (
            <div className="scan-apply-result">
              <span className="scan-apply-result-icon">✅</span>
              <span>
                Applied: {applyResult.succeeded} succeeded, {applyResult.failed} failed out of {applyResult.total} items
              </span>
            </div>
          )}

          {/* Footer */}
          <div className="scan-review-footer">
            <span className="text-muted">
              {scanResult.items.filter((i) => i.include && i.matchedProductId).length} of {scanResult.items.length} items ready to import
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-secondary" onClick={() => { setScanResult(null); setApplyResult(null); }}>Cancel</button>
              <button
                className="btn btn-primary"
                disabled={applying || !selectedWarehouse || scanResult.items.filter((i) => i.include && i.matchedProductId).length === 0}
                onClick={applyStockScan}
              >
                {applying ? "Applying…" : `✅ Confirm & Import ${scanResult.items.filter((i) => i.include && i.matchedProductId).length} Items`}
              </button>
            </div>
          </div>
        </div>
      )}

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
