import React, { useState, useMemo } from "react";
import { useAPI } from "@agentuity/react";
import type { AppConfig } from "../types";

interface DashboardProps {
  config: AppConfig;
}

/* ── Tiny SVG Chart Components (no external deps) ── */

const BarChart = React.memo(function BarChart({ data, labelKey, valueKey, color = "#3b82f6", height = 160 }: {
  data: any[]; labelKey: string; valueKey: string; color?: string; height?: number;
}) {
  if (!data.length) return <div className="chart-empty">No data</div>;
  const max = Math.max(...data.map((d) => Number(d[valueKey]) || 0), 1);
  const barW = Math.max(20, Math.min(60, (500 / data.length) - 8));
  const chartW = data.length * (barW + 8) + 40;
  return (
    <div className="chart-scroll">
      <svg width={chartW} height={height + 30} className="chart-svg">
        {data.map((d, i) => {
          const val = Number(d[valueKey]) || 0;
          const barH = (val / max) * height;
          const x = i * (barW + 8) + 20;
          return (
            <g key={i}>
              <rect x={x} y={height - barH} width={barW} height={barH} fill={d.color ?? color} rx={3} opacity={0.85}>
                <title>{d[labelKey]}: {val.toLocaleString(undefined, { maximumFractionDigits: 2 })}</title>
              </rect>
              <text x={x + barW / 2} y={height + 14} textAnchor="middle" fontSize={10} fill="#64748b" className="chart-label">
                {String(d[labelKey]).slice(0, 8)}
              </text>
              <text x={x + barW / 2} y={height - barH - 4} textAnchor="middle" fontSize={9} fill="#475569">
                {val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val.toFixed(0)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
});

const LineChart = React.memo(function LineChart({ data, xKey, yKey, color = "#3b82f6", height = 160, xLabel = "", yLabel = "" }: {
  data: any[]; xKey: string; yKey: string; color?: string; height?: number; xLabel?: string; yLabel?: string;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = React.useState(0);
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const ro = new ResizeObserver((entries) => {
      // Debounce width updates — only fire if width actually changed by >5px
      const newW = entries[0]?.contentRect.width ?? 0;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        setContainerW((prev) => Math.abs(newW - prev) > 5 ? newW : prev);
      }, 100);
    });
    ro.observe(el);
    setContainerW(el.clientWidth);
    return () => { ro.disconnect(); if (timer) clearTimeout(timer); };
  }, []);
  if (!data.length) return <div ref={containerRef} className="chart-empty">No data</div>;
  const max = Math.max(...data.map((d) => Number(d[yKey]) || 0), 1);
  // Use container width if available, otherwise fall back to a reasonable default
  const w = containerW > 0 ? containerW : Math.min(500, Math.max(400, data.length * 50));
  const pad = { top: 10, right: 20, bottom: 36, left: 52 };
  const plotW = w - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  // Y-axis ticks (5 ticks)
  const yTicks = Array.from({ length: 5 }, (_, i) => {
    const val = (max / 4) * i;
    return { val, y: pad.top + plotH - (val / max) * plotH };
  });
  const fmtTick = (v: number) => v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v.toFixed(0);

  const points = data.map((d, i) => ({
    x: pad.left + (i / Math.max(data.length - 1, 1)) * plotW,
    y: pad.top + plotH - ((Number(d[yKey]) || 0) / max) * plotH,
    label: d[xKey],
    value: Number(d[yKey]) || 0,
  }));

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const areaPath = `${linePath} L${points[points.length - 1].x},${pad.top + plotH} L${points[0].x},${pad.top + plotH} Z`;

  return (
    <div ref={containerRef} className="chart-scroll" style={{ overflow: 'hidden' }}>
      <svg width={w} height={height} className="chart-svg">
        <defs>
          <linearGradient id="lineGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.3} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        {/* Y-axis ticks + grid lines */}
        {yTicks.map((t, i) => (
          <g key={`yt-${i}`}>
            <line x1={pad.left} y1={t.y} x2={pad.left + plotW} y2={t.y} stroke="#e2e8f0" strokeWidth={1} strokeDasharray={i === 0 ? "0" : "4,3"} />
            <text x={pad.left - 6} y={t.y + 3} textAnchor="end" fontSize={9} fill="#94a3b8">{fmtTick(t.val)}</text>
          </g>
        ))}
        {/* Y-axis label */}
        {yLabel && (
          <text x={12} y={pad.top + plotH / 2} textAnchor="middle" fontSize={9} fill="#94a3b8" transform={`rotate(-90, 12, ${pad.top + plotH / 2})`}>{yLabel}</text>
        )}
        <path d={areaPath} fill="url(#lineGrad)" />
        <path d={linePath} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" />
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={3.5} fill="#fff" stroke={color} strokeWidth={2}>
              <title>{p.label}: {p.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}</title>
            </circle>
            {data.length <= 15 && (
              <text x={p.x} y={pad.top + plotH + 16} textAnchor="middle" fontSize={9} fill="#64748b">
                {String(p.label).slice(5)}
              </text>
            )}
          </g>
        ))}
        {/* X-axis label */}
        {xLabel && (
          <text x={pad.left + plotW / 2} y={height - 2} textAnchor="middle" fontSize={9} fill="#94a3b8">{xLabel}</text>
        )}
      </svg>
    </div>
  );
});

const PieChart = React.memo(function PieChart({ data, labelKey, valueKey, size = 150 }: {
  data: any[]; labelKey: string; valueKey: string; size?: number;
}) {
  if (!data.length) return <div className="chart-empty">No data</div>;
  const total = data.reduce((s, d) => s + (Number(d[valueKey]) || 0), 0);
  if (total === 0) return <div className="chart-empty">No data</div>;

  const COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#6b7280"];
  const cx = size / 2, cy = size / 2, r = size / 2 - 6;
  let cumAngle = -Math.PI / 2;

  const slices = data.map((d, i) => {
    const val = Number(d[valueKey]) || 0;
    const angle = (val / total) * 2 * Math.PI;
    const startAngle = cumAngle;
    cumAngle += angle;
    const endAngle = cumAngle;
    const largeArc = angle > Math.PI ? 1 : 0;
    const x1 = cx + r * Math.cos(startAngle);
    const y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle);
    const y2 = cy + r * Math.sin(endAngle);
    const path = `M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${largeArc} 1 ${x2},${y2} Z`;
    return { path, color: d.color ?? COLORS[i % COLORS.length], label: d[labelKey], value: val, pct: ((val / total) * 100).toFixed(1) };
  });

  return (
    <div className="pie-chart-container">
      <svg width={size} height={size} className="chart-svg" style={{ flexShrink: 0 }}>
        {slices.map((s, i) => (
          <path key={i} d={s.path} fill={s.color} opacity={0.85} stroke="#fff" strokeWidth={2}>
            <title>{s.label}: {s.value.toLocaleString(undefined, { maximumFractionDigits: 2 })} ({s.pct}%)</title>
          </path>
        ))}
      </svg>
      <div className="pie-legend">
        {slices.map((s, i) => (
          <div key={i} className="pie-legend-item">
            <span className="pie-legend-dot" style={{ background: s.color }} />
            <span className="pie-legend-label">{s.label}</span>
            <span className="pie-legend-value">{s.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
});

/* ── Dashboard Component ── */

export default function Dashboard({ config }: DashboardProps) {
  const { data: health } = useAPI<{ status: string }>("GET /api/health");
  const { data: stats } = useAPI<any>("GET /api/admin/stats");
  const { data: lowStock } = useAPI<{ data: any[] }>("GET /api/inventory/low-stock?limit=10");

  // Date range filters
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const today = now.toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(monthStart);
  const [endDate, setEndDate] = useState(today);
  const [nlQuery, setNlQuery] = useState("");

  const chartUrl = `GET /api/admin/chart-data?startDate=${startDate}T00:00:00Z&endDate=${endDate}T23:59:59Z`;
  const { data: chartData, isLoading: chartsLoading } = useAPI<any>(chartUrl);
  const cd = chartData?.data;

  const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtInt = (n: number) => n?.toLocaleString() ?? "—";

  const st = stats?.data;

  // Quick date presets
  const setPreset = (days: number) => {
    const end = new Date();
    const start = new Date(end.getTime() - days * 86400000);
    setStartDate(start.toISOString().slice(0, 10));
    setEndDate(end.toISOString().slice(0, 10));
  };
  const setMTD = () => {
    const n = new Date();
    setStartDate(`${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-01`);
    setEndDate(n.toISOString().slice(0, 10));
  };
  const setYTD = () => {
    setStartDate(`${new Date().getFullYear()}-01-01`);
    setEndDate(new Date().toISOString().slice(0, 10));
  };

  /** Natural language date filter */
  const handleNlFilter = () => {
    const q = nlQuery.toLowerCase().trim();
    if (!q) return;
    if (q.includes("today")) { setPreset(0); }
    else if (q.includes("yesterday")) { setPreset(1); }
    else if (q.includes("last week") || q.includes("past week")) { setPreset(7); }
    else if (q.includes("last 2 weeks") || q.includes("two weeks")) { setPreset(14); }
    else if (q.includes("last month") || q.includes("past month") || q.includes("30 days")) { setPreset(30); }
    else if (q.includes("last quarter") || q.includes("past quarter") || q.includes("90 days") || q.includes("3 months")) { setPreset(90); }
    else if (q.match(/last (\d+) days?/)) {
      const days = parseInt(q.match(/last (\d+) days?/)![1]);
      if (days > 0 && days <= 365) setPreset(days);
    }
    else if (q.includes("this month") || q.includes("month to date") || q.includes("mtd")) { setMTD(); }
    else if (q.includes("this year") || q.includes("year to date") || q.includes("ytd")) { setYTD(); }
    else if (q.includes("all time") || q.includes("everything")) { setPreset(365); }
    setNlQuery("");
  };

  /** Derive insights from dashboard data (no API call needed) */
  const insights = useMemo(() => {
    const result: Array<{ title: string; body: string; severity: "high" | "medium" | "low" }> = [];
    if (!st) return result;

    // Low stock alert
    const lowCount = lowStock?.data?.length ?? 0;
    if (lowCount > 0) {
      const outOfStock = lowStock?.data?.filter((i: any) => i.quantity === 0).length ?? 0;
      result.push({
        title: outOfStock > 0 ? `⚠️ ${outOfStock} products out of stock` : `📦 ${lowCount} products running low`,
        body: outOfStock > 0
          ? `${outOfStock} products have zero stock and ${lowCount - outOfStock} are below reorder point. Consider restocking immediately.`
          : `${lowCount} products are below their reorder point. Review and restock to avoid stockouts.`,
        severity: outOfStock > 0 ? "high" : "medium",
      });
    }

    // Revenue trend (if chart data available)
    if (cd?.salesByDay?.length >= 7) {
      const recent = cd.salesByDay.slice(-7);
      const recentAvg = recent.reduce((s: number, d: any) => s + (Number(d.revenue) || 0), 0) / recent.length;
      const earlier = cd.salesByDay.slice(0, 7);
      const earlierAvg = earlier.reduce((s: number, d: any) => s + (Number(d.revenue) || 0), 0) / Math.max(earlier.length, 1);
      if (earlierAvg > 0) {
        const change = ((recentAvg - earlierAvg) / earlierAvg) * 100;
        if (Math.abs(change) > 10) {
          result.push({
            title: change > 0 ? `📈 Sales trending up ${change.toFixed(0)}%` : `📉 Sales trending down ${Math.abs(change).toFixed(0)}%`,
            body: change > 0
              ? `Recent daily revenue is ${change.toFixed(0)}% higher than the prior period. Keep momentum going!`
              : `Recent daily revenue dropped ${Math.abs(change).toFixed(0)}% vs prior period. Investigate potential causes.`,
            severity: change < -20 ? "high" : change < 0 ? "medium" : "low",
          });
        }
      }
    }

    // Unpaid invoices
    if (cd?.paymentCollection?.unpaid > 0) {
      const unpaidRate = cd.paymentCollection.unpaid / (cd.paymentCollection.fullyPaid + cd.paymentCollection.partiallyPaid + cd.paymentCollection.unpaid);
      if (unpaidRate > 0.3) {
        result.push({
          title: `💳 ${(unpaidRate * 100).toFixed(0)}% invoices unpaid`,
          body: `${cd.paymentCollection.unpaid} invoices remain unpaid. Consider sending reminders or reviewing payment terms.`,
          severity: unpaidRate > 0.5 ? "high" : "medium",
        });
      }
    }

    // No data fallback
    if (result.length === 0 && st.orderCount > 0) {
      result.push({
        title: "✅ Operations looking healthy",
        body: `${st.orderCount.toLocaleString()} orders processed with ${st.productCount.toLocaleString()} active products. No critical alerts.`,
        severity: "low",
      });
    }

    return result.slice(0, 3);
  }, [st, cd, lowStock]);

  return (
    <div className="page dashboard-page">
      <div className="page-header-row">
        <div>
          <h2>Dashboard</h2>
          <span className={`status-pill ${health?.status === "ok" ? "" : ""}`} style={{ backgroundColor: health?.status === "ok" ? "#dcfce7" : "#fee2e2", color: health?.status === "ok" ? "#166534" : "#991b1b" }}>
            {health?.status === "ok" ? "✓ System Online" : "⏳ Connecting..."}
          </span>
        </div>
        <div className="dashboard-date-filter">
          <div className="date-presets">
            <button className="btn btn-xs btn-secondary" onClick={() => setPreset(7)}>7d</button>
            <button className="btn btn-xs btn-secondary" onClick={setMTD}>MTD</button>
            <button className="btn btn-xs btn-secondary" onClick={() => setPreset(30)}>30d</button>
            <button className="btn btn-xs btn-secondary" onClick={() => setPreset(90)}>90d</button>
            <button className="btn btn-xs btn-secondary" onClick={setYTD}>YTD</button>
          </div>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="date-input" />
          <span className="text-muted">to</span>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="date-input" />
          <input
            type="text"
            placeholder="Try: 'last week', 'last 60 days'…"
            value={nlQuery}
            onChange={(e) => setNlQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleNlFilter(); }}
            className="date-input"
            style={{ minWidth: 160, fontSize: 12 }}
          />
        </div>
      </div>

      {/* KPI Cards */}
      <div className="summary-cards">
        <div className="summary-card summary-card-highlight">
          <span className="summary-card-value">{st ? fmt(st.totalRevenue) : "—"}</span>
          <span className="summary-card-label">Total Revenue ({config.currency})</span>
        </div>
        <div className="summary-card">
          <span className="summary-card-value">{st ? fmtInt(st.orderCount) : "—"}</span>
          <span className="summary-card-label">{config.labels.orderPlural}</span>
        </div>
        <div className="summary-card">
          <span className="summary-card-value">{st ? fmtInt(st.productCount) : "—"}</span>
          <span className="summary-card-label">{config.labels.productPlural}</span>
        </div>
        <div className="summary-card">
          <span className="summary-card-value">{st ? fmtInt(st.customerCount) : "—"}</span>
          <span className="summary-card-label">{config.labels.customerPlural}</span>
        </div>
      </div>

      {/* AI Insights Widget */}
      {insights.length > 0 && (
        <div className="chart-card" style={{ marginBottom: 16 }}>
          <h3>💡 AI Insights</h3>
          <p className="chart-subtitle">Auto-generated from your current data</p>
          <div className="ai-insights-widget">
            {insights.map((insight, i) => (
              <div key={i} className={`insight-card insight-card-${insight.severity}`}>
                <div className="insight-card-title">{insight.title}</div>
                <div className="insight-card-body">{insight.body}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {chartsLoading ? (
        <div className="loading-state"><div className="spinner" /><p>Loading charts...</p></div>
      ) : cd ? (
        <>
          {/* Row 1: Sales Trend + Revenue by Status */}
          <div className="chart-row">
            <div className="chart-card">
              <h3>📈 Sales Trend</h3>
              <p className="chart-subtitle">Daily revenue for selected period</p>
              <LineChart data={cd.salesByDay} xKey="date" yKey="revenue" color="#3b82f6" xLabel="Date" yLabel={`Revenue (${config.currency})`} />
            </div>
            <div className="chart-card">
              <h3>🥧 Revenue by Status</h3>
              <p className="chart-subtitle">Order revenue breakdown</p>
              <PieChart data={cd.revenueByStatus} labelKey="label" valueKey="revenue" />
            </div>
          </div>

          {/* Row 2: Inventory by Category + Payment Collection */}
          <div className="chart-row">
            <div className="chart-card">
              <h3>📦 Inventory Value by Category</h3>
              <p className="chart-subtitle">Stock value across categories ({config.currency})</p>
              <BarChart data={cd.inventoryByCategory} labelKey="category" valueKey="totalValue" color="#8b5cf6" />
            </div>
            <div className="chart-card">
              <h3>💳 Payment Collection</h3>
              <p className="chart-subtitle">Invoices: paid vs outstanding</p>
              <PieChart
                data={[
                  { label: "Fully Paid", value: cd.paymentCollection.fullyPaid, color: "#22c55e" },
                  { label: "Partially Paid", value: cd.paymentCollection.partiallyPaid, color: "#f59e0b" },
                  { label: "Unpaid", value: cd.paymentCollection.unpaid, color: "#ef4444" },
                ].filter((d) => d.value > 0)}
                labelKey="label"
                valueKey="value"
              />
            </div>
          </div>

          {/* Row 3: Top Customers + Top Products */}
          <div className="chart-row">
            <div className="chart-card">
              <h3>🏆 Top {config.labels.customerPlural}</h3>
              <p className="chart-subtitle">By revenue ({config.currency})</p>
              <BarChart data={cd.topCustomers} labelKey="name" valueKey="revenue" color="#06b6d4" />
            </div>
            <div className="chart-card">
              <h3>🔥 Top {config.labels.productPlural}</h3>
              <p className="chart-subtitle">By revenue ({config.currency})</p>
              <BarChart data={cd.topProducts} labelKey="name" valueKey="revenue" color="#f59e0b" />
            </div>
          </div>

          {/* Row 4: Invoice Breakdown Table */}
          {cd.invoiceStats.length > 0 && (
            <div className="chart-card" style={{ marginBottom: 16 }}>
              <h3>📄 Invoice Status Breakdown</h3>
              <table className="data-table" style={{ marginTop: 12 }}>
                <thead>
                  <tr>
                    <th>Status</th>
                    <th className="text-right">Count</th>
                    <th className="text-right">Total Billed ({config.currency})</th>
                    <th className="text-right">Paid ({config.currency})</th>
                    <th className="text-right">Outstanding ({config.currency})</th>
                  </tr>
                </thead>
                <tbody>
                  {cd.invoiceStats.map((inv: any) => (
                    <tr key={inv.status}>
                      <td><span className="status-pill" style={{ backgroundColor: inv.status === "paid" ? "#22c55e" : inv.status === "sent" ? "#3b82f6" : inv.status === "overdue" ? "#ef4444" : "#94a3b8" }}>{inv.status}</span></td>
                      <td className="text-right">{inv.count}</td>
                      <td className="text-right">{fmt(inv.totalBilled)}</td>
                      <td className="text-right" style={{ color: "#22c55e" }}>{fmt(inv.totalPaid)}</td>
                      <td className="text-right" style={{ color: inv.outstanding > 0 ? "#ef4444" : undefined }}>{fmt(inv.outstanding)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}

      {/* Low Stock Alerts */}
      {lowStock?.data && lowStock.data.length > 0 && (
        <div className="chart-card" style={{ borderLeft: "3px solid #ef4444" }}>
          <h3>⚠️ Low Stock Alerts ({lowStock.data.length})</h3>
          <table className="data-table" style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>{config.labels.product}</th>
                <th>SKU</th>
                <th className="text-right">Quantity</th>
                <th className="text-right">Reorder Point</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {lowStock.data.slice(0, 10).map((item: any, i: number) => (
                <tr key={i}>
                  <td>{item.productName}</td>
                  <td><code className="sku-code">{item.sku}</code></td>
                  <td className="text-right text-danger font-semibold">{item.quantity}</td>
                  <td className="text-right">{item.reorderPoint ?? item.minStockLevel}</td>
                  <td>
                    {item.quantity === 0 ? (
                      <span className="status-pill" style={{ backgroundColor: "#fee2e2", color: "#991b1b" }}>Out of Stock</span>
                    ) : (
                      <span className="status-pill" style={{ backgroundColor: "#fef3c7", color: "#92400e" }}>Low</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
