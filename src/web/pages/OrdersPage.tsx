import React, { useState } from "react";
import { useAPI } from "@agentuity/react";
import type { AppConfig } from "../App";

interface OrdersPageProps {
  config: AppConfig;
}

export default function OrdersPage({ config }: OrdersPageProps) {
  const [page, setPage] = useState(1);
  const { data, isLoading, refetch } = useAPI<any>(`GET /api/orders?page=${page}&limit=20`);

  return (
    <div className="page">
      <div className="page-header">
        <h2>{config.labels.orderPlural}</h2>
      </div>

      {isLoading ? (
        <p className="loading">Loading {config.labels.orderPlural.toLowerCase()}...</p>
      ) : (
        <>
          <table className="data-table">
            <thead>
              <tr>
                <th>{config.labels.order} #</th>
                <th>{config.labels.customer}</th>
                <th>Status</th>
                <th>Total ({config.currency})</th>
                <th>Date</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data?.data?.map((o: any) => (
                <tr key={o.id}>
                  <td className="font-mono">{o.orderNumber}</td>
                  <td>{o.customer?.name ?? "Walk-in"}</td>
                  <td>
                    <span
                      className="status-badge"
                      style={{ backgroundColor: o.status?.color ?? "#888" }}
                    >
                      {o.status?.label ?? "—"}
                    </span>
                  </td>
                  <td>{Number(o.totalAmount).toFixed(2)}</td>
                  <td>{new Date(o.createdAt).toLocaleDateString()}</td>
                  <td>
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={async () => {
                        await fetch(`/api/orders/${o.id}/cancel`, { method: "POST" });
                        refetch();
                      }}
                    >
                      Cancel
                    </button>
                  </td>
                </tr>
              ))}
              {(!data?.data || data.data.length === 0) && (
                <tr>
                  <td colSpan={6} className="text-center text-muted">
                    No {config.labels.orderPlural.toLowerCase()} found
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
              <span>
                Page {data.pagination.page} of {data.pagination.totalPages}
              </span>
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
