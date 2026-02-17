import React, { useState } from "react";
import { useAPI } from "@agentuity/react";
import type { AppConfig } from "../App";

interface InvoicesPageProps {
  config: AppConfig;
}

export default function InvoicesPage({ config }: InvoicesPageProps) {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const url = `GET /api/invoices?page=${page}&limit=20${statusFilter ? `&status=${statusFilter}` : ""}`;
  const { data, isLoading, refetch } = useAPI<any>(url);

  const handleAction = async (id: string, action: "send" | "void") => {
    await fetch(`/api/invoices/${id}/${action}`, { method: "POST" });
    refetch();
  };

  return (
    <div className="page">
      <div className="page-header">
        <h2>{config.labels.invoice}s</h2>
        <div className="header-actions">
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="sent">Sent</option>
            <option value="partial">Partial</option>
            <option value="paid">Paid</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </div>

      {isLoading ? (
        <p className="loading">Loading...</p>
      ) : (
        <>
          <table className="data-table">
            <thead>
              <tr>
                <th>{config.labels.invoice} #</th>
                <th>{config.labels.customer}</th>
                <th>Status</th>
                <th>Total ({config.currency})</th>
                <th>Paid ({config.currency})</th>
                <th>Due Date</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data?.data?.map((inv: any) => (
                <tr key={inv.id}>
                  <td className="font-mono">{inv.invoiceNumber}</td>
                  <td>{inv.customer?.name ?? "—"}</td>
                  <td>
                    <span className={`status-badge status-${inv.status}`}>{inv.status}</span>
                  </td>
                  <td>{Number(inv.totalAmount).toFixed(2)}</td>
                  <td>{Number(inv.paidAmount).toFixed(2)}</td>
                  <td>{inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : "—"}</td>
                  <td className="action-cell">
                    {inv.status === "draft" && (
                      <button className="btn btn-sm" onClick={() => handleAction(inv.id, "send")}>
                        Send
                      </button>
                    )}
                    {inv.status !== "cancelled" && inv.status !== "paid" && (
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={() => handleAction(inv.id, "void")}
                      >
                        Void
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {(!data?.data || data.data.length === 0) && (
                <tr>
                  <td colSpan={7} className="text-center text-muted">
                    No {config.labels.invoice.toLowerCase()}s found
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
