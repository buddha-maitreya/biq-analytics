import React, { useState } from "react";
import { useAPI } from "@agentuity/react";
import type { AppConfig } from "../App";

interface CustomersPageProps {
  config: AppConfig;
}

export default function CustomersPage({ config }: CustomersPageProps) {
  const [page, setPage] = useState(1);
  const { data, loading, refetch } = useAPI<any>(`/api/customers?page=${page}&limit=20`);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    address: "",
  });

  const handleCreate = async () => {
    await fetch("/api/customers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formData),
    });
    setShowForm(false);
    setFormData({ name: "", email: "", phone: "", address: "" });
    refetch();
  };

  return (
    <div className="page">
      <div className="page-header">
        <h2>{config.labels.customerPlural}</h2>
        <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
          + New {config.labels.customer}
        </button>
      </div>

      {showForm && (
        <div className="card form-card">
          <h3>Create {config.labels.customer}</h3>
          <div className="form-grid">
            <input
              placeholder="Name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
            <input
              placeholder="Email"
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            />
            <input
              placeholder="Phone"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
            />
            <input
              placeholder="Address"
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
            />
          </div>
          <div className="form-actions">
            <button className="btn btn-primary" onClick={handleCreate}>
              Save
            </button>
            <button className="btn btn-secondary" onClick={() => setShowForm(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="loading">Loading {config.labels.customerPlural.toLowerCase()}...</p>
      ) : (
        <>
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Balance ({config.currency})</th>
              </tr>
            </thead>
            <tbody>
              {data?.data?.map((c: any) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{c.email ?? "—"}</td>
                  <td>{c.phone ?? "—"}</td>
                  <td>{Number(c.balance).toFixed(2)}</td>
                </tr>
              ))}
              {(!data?.data || data.data.length === 0) && (
                <tr>
                  <td colSpan={4} className="text-center text-muted">
                    No {config.labels.customerPlural.toLowerCase()} found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {data?.pagination && (
            <div className="pagination">
              <button disabled={!data.pagination.hasPrev} onClick={() => setPage(page - 1)}>
                ← Prev
              </button>
              <span>Page {data.pagination.page} of {data.pagination.totalPages}</span>
              <button disabled={!data.pagination.hasNext} onClick={() => setPage(page + 1)}>
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
