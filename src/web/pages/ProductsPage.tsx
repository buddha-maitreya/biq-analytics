import React, { useState } from "react";
import { useAPI } from "@agentuity/react";
import type { AppConfig } from "../App";

interface ProductsPageProps {
  config: AppConfig;
}

export default function ProductsPage({ config }: ProductsPageProps) {
  const [page, setPage] = useState(1);
  const { data, isLoading, refetch } = useAPI<any>(`GET /api/products?page=${page}&limit=20`);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    sku: "",
    name: "",
    description: "",
    price: 0,
    costPrice: 0,
    unit: config.labels.unitDefault,
  });

  const handleCreate = async () => {
    await fetch("/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formData),
    });
    setShowForm(false);
    setFormData({ sku: "", name: "", description: "", price: 0, costPrice: 0, unit: config.labels.unitDefault });
    refetch();
  };

  return (
    <div className="page">
      <div className="page-header">
        <h2>{config.labels.productPlural}</h2>
        <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
          + New {config.labels.product}
        </button>
      </div>

      {showForm && (
        <div className="card form-card">
          <h3>Create {config.labels.product}</h3>
          <div className="form-grid">
            <input placeholder="SKU" value={formData.sku} onChange={(e) => setFormData({ ...formData, sku: e.target.value })} />
            <input placeholder="Name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} />
            <input placeholder="Description" value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} />
            <input type="number" placeholder="Price" value={formData.price} onChange={(e) => setFormData({ ...formData, price: Number(e.target.value) })} />
            <input type="number" placeholder="Cost Price" value={formData.costPrice} onChange={(e) => setFormData({ ...formData, costPrice: Number(e.target.value) })} />
            <input placeholder="Unit" value={formData.unit} onChange={(e) => setFormData({ ...formData, unit: e.target.value })} />
          </div>
          <div className="form-actions">
            <button className="btn btn-primary" onClick={handleCreate}>Save</button>
            <button className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      {isLoading ? (
        <p className="loading">Loading {config.labels.productPlural.toLowerCase()}...</p>
      ) : (
        <>
          <table className="data-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Name</th>
                <th>Category</th>
                <th>Price ({config.currency})</th>
                <th>Unit</th>
              </tr>
            </thead>
            <tbody>
              {data?.data?.map((p: any) => (
                <tr key={p.id}>
                  <td>{p.sku}</td>
                  <td>{p.name}</td>
                  <td>{p.category?.name ?? "—"}</td>
                  <td>{Number(p.price).toFixed(2)}</td>
                  <td>{p.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data?.pagination && (
            <div className="pagination">
              <button disabled={!data.pagination.hasPrev} onClick={() => setPage(page - 1)}>← Prev</button>
              <span>Page {data.pagination.page} of {data.pagination.totalPages}</span>
              <button disabled={!data.pagination.hasNext} onClick={() => setPage(page + 1)}>Next →</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
