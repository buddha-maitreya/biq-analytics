import React, { useState, useMemo } from "react";
import { useAPI } from "@agentuity/react";
import type { AppConfig } from "../types";

interface ProductsPageProps {
  config: AppConfig;
}

type SortKey = "sku" | "name" | "category" | "price" | "unit";
type SortDir = "asc" | "desc";

export default function ProductsPage({ config }: ProductsPageProps) {
  const [page, setPage] = useState(1);
  const { data, isLoading, refetch } = useAPI<any>(`GET /api/products?page=${page}&limit=25`);
  const { data: catData } = useAPI<any>("GET /api/categories");
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [formData, setFormData] = useState({
    sku: "",
    name: "",
    description: "",
    price: 0,
    costPrice: 0,
    unit: config.labels.unitDefault,
    categoryId: "",
  });

  const handleDownload = () => {
    const a = document.createElement("a");
    a.href = "/api/export/products";
    a.click();
  };

  const categories: any[] = catData?.data ?? [];
  const products: any[] = data?.data ?? [];

  // Category summary stats
  const categorySummary = useMemo(() => {
    const map: Record<string, { name: string; count: number; totalValue: number }> = {};
    for (const p of products) {
      const catName = p.category?.name ?? "Uncategorized";
      if (!map[catName]) map[catName] = { name: catName, count: 0, totalValue: 0 };
      map[catName].count++;
      map[catName].totalValue += Number(p.price) || 0;
    }
    return Object.values(map).sort((a, b) => b.count - a.count);
  }, [products]);

  // Filter + sort
  const filteredProducts = useMemo(() => {
    let list = [...products];

    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (p) =>
          p.name?.toLowerCase().includes(q) ||
          p.sku?.toLowerCase().includes(q) ||
          p.description?.toLowerCase().includes(q)
      );
    }

    if (categoryFilter !== "all") {
      list = list.filter((p) => (p.category?.name ?? "Uncategorized") === categoryFilter);
    }

    list.sort((a, b) => {
      let aVal: string | number = "";
      let bVal: string | number = "";
      switch (sortKey) {
        case "sku":      aVal = a.sku ?? ""; bVal = b.sku ?? ""; break;
        case "name":     aVal = a.name ?? ""; bVal = b.name ?? ""; break;
        case "category": aVal = a.category?.name ?? ""; bVal = b.category?.name ?? ""; break;
        case "price":    aVal = Number(a.price) || 0; bVal = Number(b.price) || 0; break;
        case "unit":     aVal = a.unit ?? ""; bVal = b.unit ?? ""; break;
      }
      if (typeof aVal === "string") {
        const cmp = aVal.localeCompare(bVal as string);
        return sortDir === "asc" ? cmp : -cmp;
      }
      return sortDir === "asc" ? aVal - (bVal as number) : (bVal as number) - aVal;
    });

    return list;
  }, [products, search, categoryFilter, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const sortIcon = (key: SortKey) => {
    if (sortKey !== key) return " ↕";
    return sortDir === "asc" ? " ↑" : " ↓";
  };

  const handleCreate = async () => {
    await fetch("/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formData),
    });
    setShowForm(false);
    setFormData({ sku: "", name: "", description: "", price: 0, costPrice: 0, unit: config.labels.unitDefault, categoryId: "" });
    refetch();
  };

  return (
    <div className="page">
      <div className="page-header-row">
        <div>
          <h2>{config.labels.productPlural}</h2>
          <span className="text-muted">
            {products.length} {config.labels.productPlural.toLowerCase()} across {categorySummary.length} categories
          </span>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button className="btn btn-secondary" onClick={handleDownload} title="Download all products as Excel">
            ↓ Excel
          </button>
          <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
            + New {config.labels.product}
          </button>
        </div>
      </div>

      {/* Category Summary Cards */}
      {!isLoading && categorySummary.length > 0 && (
        <div className="summary-strip">
          <button
            className={`summary-chip ${categoryFilter === "all" ? "active" : ""}`}
            onClick={() => setCategoryFilter("all")}
          >
            <span className="chip-count">{products.length}</span>
            <span className="chip-label">All</span>
          </button>
          {categorySummary.map((cat) => (
            <button
              key={cat.name}
              className={`summary-chip ${categoryFilter === cat.name ? "active" : ""}`}
              onClick={() => setCategoryFilter(categoryFilter === cat.name ? "all" : cat.name)}
            >
              <span className="chip-count">{cat.count}</span>
              <span className="chip-label">{cat.name}</span>
            </button>
          ))}
        </div>
      )}

      {showForm && (
        <div className="card form-card inline-form">
          <h3>Create {config.labels.product}</h3>
          <div className="form-grid cols-2">
            <label>
              SKU
              <input placeholder="e.g. SAF-MARA-5D" value={formData.sku} onChange={(e) => setFormData({ ...formData, sku: e.target.value })} />
            </label>
            <label>
              Name
              <input placeholder="Product name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} />
            </label>
            <label>
              Category
              <select value={formData.categoryId} onChange={(e) => setFormData({ ...formData, categoryId: e.target.value })}>
                <option value="">— Select —</option>
                {categories.map((c: any) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            <label>
              Price ({config.currency})
              <input type="number" step="0.01" value={formData.price} onChange={(e) => setFormData({ ...formData, price: Number(e.target.value) })} />
            </label>
            <label>
              Cost Price ({config.currency})
              <input type="number" step="0.01" value={formData.costPrice} onChange={(e) => setFormData({ ...formData, costPrice: Number(e.target.value) })} />
            </label>
            <label>
              Unit
              <input placeholder="e.g. person, day, kg" value={formData.unit} onChange={(e) => setFormData({ ...formData, unit: e.target.value })} />
            </label>
          </div>
          <label style={{ marginTop: 8 }}>
            Description
            <textarea placeholder="Product description" rows={2} value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} />
          </label>
          <div className="form-actions">
            <button className="btn btn-primary" onClick={handleCreate}>Save</button>
            <button className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Search & Filter Bar */}
      <div className="toolbar">
        <div className="search-box">
          <span className="search-icon">🔍</span>
          <input
            type="text"
            placeholder={`Search ${config.labels.productPlural.toLowerCase()}...`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button className="search-clear" onClick={() => setSearch("")}>✕</button>
          )}
        </div>
        <span className="toolbar-count">
          {filteredProducts.length} result{filteredProducts.length !== 1 ? "s" : ""}
        </span>
      </div>

      {isLoading ? (
        <div className="loading-state">
          <div className="spinner" />
          <p>Loading {config.labels.productPlural.toLowerCase()}...</p>
        </div>
      ) : (
        <div className="card table-card">
          <table className="data-table">
            <thead>
              <tr>
                <th className="sortable" onClick={() => handleSort("sku")}>SKU{sortIcon("sku")}</th>
                <th className="sortable" onClick={() => handleSort("name")}>Name{sortIcon("name")}</th>
                <th className="sortable" onClick={() => handleSort("category")}>Category{sortIcon("category")}</th>
                <th className="sortable" onClick={() => handleSort("price")}>Price ({config.currency}){sortIcon("price")}</th>
                <th className="sortable" onClick={() => handleSort("unit")}>Unit{sortIcon("unit")}</th>
              </tr>
            </thead>
            <tbody>
              {filteredProducts.map((p: any) => (
                <tr key={p.id}>
                  <td><code className="sku-code">{p.sku}</code></td>
                  <td>
                    <div className="cell-main">{p.name}</div>
                    {p.description && <div className="cell-sub">{p.description.slice(0, 60)}{p.description.length > 60 ? "…" : ""}</div>}
                  </td>
                  <td><span className="category-badge">{p.category?.name ?? "—"}</span></td>
                  <td className="text-right">{Number(p.price).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                  <td>{p.unit}</td>
                </tr>
              ))}
              {filteredProducts.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center text-muted" style={{ padding: 32 }}>
                    {search || categoryFilter !== "all"
                      ? `No ${config.labels.productPlural.toLowerCase()} match your filters`
                      : `No ${config.labels.productPlural.toLowerCase()} found`}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {data?.pagination && data.pagination.totalPages > 1 && (
        <div className="pagination">
          <button className="btn btn-sm btn-secondary" disabled={!data.pagination.hasPrev} onClick={() => setPage(page - 1)}>← Prev</button>
          <span className="pagination-info">Page {data.pagination.page} of {data.pagination.totalPages}</span>
          <button className="btn btn-sm btn-secondary" disabled={!data.pagination.hasNext} onClick={() => setPage(page + 1)}>Next →</button>
        </div>
      )}
    </div>
  );
}
