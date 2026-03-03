import React, { useState, useMemo, useCallback } from "react";
import { useAPI } from "@agentuity/react";
import type { AppConfig, Page } from "../types";

interface DashboardProps {
  config: AppConfig;
  onNavigate: (page: Page) => void;
}

/* ── Helpers ── */

function getPreviousPeriod(startDate: string, endDate: string) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const durationMs = end.getTime() - start.getTime() + 86400000;
  const prevEnd = new Date(start.getTime() - 86400000);
  const prevStart = new Date(prevEnd.getTime() - durationMs + 86400000);
  return {
    start: prevStart.toISOString().slice(0, 10),
    end: prevEnd.toISOString().slice(0, 10),
  };
}

function TrendBadge({ pct }: { pct: number | null }) {
  if (pct == null) return null;
  const up = pct >= 0;
  return (
    <span className={`kpi-trend-badge ${up ? "kpi-trend-up" : "kpi-trend-down"}`}>
      {up ? "▲" : "▼"} {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

/* ── Chart Components ── */

const BarChart = React.memo(function BarChart({
  data, labelKey, valueKey, color = "#3b82f6", height = 160, maxItems, onBarClick,
}: {
  data: any[]; labelKey: string; valueKey: string; color?: string; height?: number;
  maxItems?: number; onBarClick?: (label: string, value: number) => void;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  if (!data.length) return <div className="chart-empty">No data</div>;
  const trimmed = maxItems ? data.slice(0, maxItems) : data;
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = React.useState(0);
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setContainerW((prev) => Math.abs(w - prev) > 5 ? w : prev);
    });
    ro.observe(el);
    setContainerW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const max = Math.max(...trimmed.map((d) => Number(d[valueKey]) || 0), 1);
  const chartW = containerW > 0 ? containerW : 500;
  const pad = 20;
  const gap = 6;
  const barW = Math.max(14, (chartW - pad * 2) / trimmed.length - gap);

  const [tooltip, setTooltip] = useState<{ x: number; y: number; label: string; value: number } | null>(null);

  return (
    <div ref={containerRef} style={{ width: "100%", overflow: "hidden", position: "relative" }}>
      {tooltip && (
        <div
          className="chart-tooltip"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <strong>{tooltip.label}</strong><br />
          {tooltip.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}
        </div>
      )}
      <svg
        width={chartW}
        height={height + 30}
        className="chart-svg"
        style={{ cursor: onBarClick ? "pointer" : undefined }}
        onMouseLeave={() => { setHovered(null); setTooltip(null); }}
      >
        {trimmed.map((d, i) => {
          const val = Number(d[valueKey]) || 0;
          const barH = (val / max) * height;
          const x = pad + i * (barW + gap);
          const isHovered = hovered === i;
          return (
            <g
              key={i}
              onClick={() => onBarClick?.(String(d[labelKey]), val)}
              onMouseEnter={(e) => {
                setHovered(i);
                const rect = containerRef.current?.getBoundingClientRect();
                const svgRect = (e.currentTarget.closest("svg") as SVGSVGElement)?.getBoundingClientRect();
                if (rect && svgRect) {
                  setTooltip({ x: x + barW / 2, y: height - barH - 36, label: String(d[labelKey]), value: val });
                }
              }}
              onMouseLeave={() => { setHovered(null); setTooltip(null); }}
            >
              <rect
                x={x} y={height - barH} width={barW} height={barH}
                fill={d.color ?? color} rx={3}
                opacity={isHovered ? 1 : 0.82}
                style={{ filter: isHovered ? "brightness(1.15)" : undefined, transition: "opacity 0.12s" }}
              />
              {onBarClick && isHovered && (
                <rect x={x} y={height - barH} width={barW} height={barH} fill="rgba(255,255,255,0.12)" rx={3} />
              )}
              <text x={x + barW / 2} y={height + 14} textAnchor="middle" fontSize={barW < 30 ? 7 : 10} fill="#64748b" className="chart-label">
                {String(d[labelKey]).slice(0, barW < 30 ? 5 : 8)}
              </text>
              <text x={x + barW / 2} y={height - barH - 4} textAnchor="middle" fontSize={barW < 30 ? 7 : 9} fill="#475569">
                {val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val.toFixed(0)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
});

const LineChart = React.memo(function LineChart({
  data, xKey, yKey, color = "#3b82f6", height = 160, xLabel = "", yLabel = "",
}: {
  data: any[]; xKey: string; yKey: string; color?: string; height?: number; xLabel?: string; yLabel?: string;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = React.useState(0);
  const [hoveredIdx, setHoveredIdx] = React.useState<number | null>(null);

  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const ro = new ResizeObserver((entries) => {
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
  const w = containerW > 0 ? containerW : Math.min(500, Math.max(400, data.length * 50));
  const pad = { top: 10, right: 20, bottom: 36, left: 52 };
  const plotW = w - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

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
  const gradId = `lineGrad-${color.replace("#", "")}`;

  return (
    <div ref={containerRef} className="chart-scroll" style={{ overflow: "hidden", position: "relative" }}>
      {hoveredIdx != null && (
        <div
          className="chart-tooltip"
          style={{
            left: points[hoveredIdx].x,
            top: Math.max(4, points[hoveredIdx].y - 36),
          }}
        >
          <strong>{points[hoveredIdx].label}</strong><br />
          {points[hoveredIdx].value.toLocaleString(undefined, { maximumFractionDigits: 2 })}
        </div>
      )}
      <svg
        width={w} height={height} className="chart-svg"
        onMouseLeave={() => setHoveredIdx(null)}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.28} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        {yTicks.map((t, i) => (
          <g key={`yt-${i}`}>
            <line x1={pad.left} y1={t.y} x2={pad.left + plotW} y2={t.y} stroke="#e2e8f0" strokeWidth={1} strokeDasharray={i === 0 ? "0" : "4,3"} />
            <text x={pad.left - 6} y={t.y + 3} textAnchor="end" fontSize={9} fill="#94a3b8">{fmtTick(t.val)}</text>
          </g>
        ))}
        {yLabel && (
          <text x={12} y={pad.top + plotH / 2} textAnchor="middle" fontSize={9} fill="#94a3b8" transform={`rotate(-90, 12, ${pad.top + plotH / 2})`}>{yLabel}</text>
        )}
        <path d={areaPath} fill={`url(#${gradId})`} />
        <path d={linePath} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" />
        {points.map((p, i) => (
          <g key={i} onMouseEnter={() => setHoveredIdx(i)}>
            {/* Invisible wider hit area */}
            <rect x={p.x - 12} y={pad.top} width={24} height={plotH} fill="transparent" />
            <circle cx={p.x} cy={p.y} r={hoveredIdx === i ? 5 : 3.5} fill="#fff" stroke={color} strokeWidth={2} style={{ transition: "r 0.1s" }} />
            {data.length <= 15 && (
              <text x={p.x} y={pad.top + plotH + 16} textAnchor="middle" fontSize={9} fill="#64748b">
                {String(p.label).slice(5)}
              </text>
            )}
          </g>
        ))}
        {xLabel && (
          <text x={pad.left + plotW / 2} y={height - 2} textAnchor="middle" fontSize={9} fill="#94a3b8">{xLabel}</text>
        )}
      </svg>
    </div>
  );
});

const PieChart = React.memo(function PieChart({
  data, labelKey, valueKey, size = 150,
}: {
  data: any[]; labelKey: string; valueKey: string; size?: number;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
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
          <path
            key={i} d={s.path}
            fill={s.color}
            opacity={hovered == null || hovered === i ? 0.88 : 0.45}
            stroke="#fff" strokeWidth={2}
            style={{ cursor: "default", transition: "opacity 0.15s" }}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
          >
            <title>{s.label}: {s.value.toLocaleString(undefined, { maximumFractionDigits: 2 })} ({s.pct}%)</title>
          </path>
        ))}
      </svg>
      <div className="pie-legend">
        {slices.map((s, i) => (
          <div
            key={i} className="pie-legend-item"
            style={{ opacity: hovered == null || hovered === i ? 1 : 0.5, transition: "opacity 0.15s" }}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
          >
            <span className="pie-legend-dot" style={{ background: s.color }} />
            <span className="pie-legend-label">{s.label}</span>
            <span className="pie-legend-value">{s.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
});

/* ── Drill-Down Category View ── */

function CategoryDrilldown({
  category, startDate, endDate, config, onBack, onNavigate,
}: {
  category: string; startDate: string; endDate: string;
  config: AppConfig; onBack: () => void; onNavigate: (page: Page) => void;
}) {
  const { data: products, isLoading } = useAPI<any>(
    `GET /api/products?limit=50&sortBy=revenue&order=desc`
  );
  const rows: any[] = products?.data ?? [];
  const filtered = rows.filter((p: any) =>
    (p.categoryName ?? p.category ?? "").toLowerCase() === category.toLowerCase()
  );
  const fmt = (n: number) => n?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="drilldown-view">
      {/* Breadcrumb */}
      <div className="breadcrumb">
        <button className="breadcrumb-link" onClick={onBack}>Dashboard</button>
        <span className="breadcrumb-sep">›</span>
        <span className="breadcrumb-current">{category}</span>
      </div>

      <div className="drilldown-header">
        <button className="btn btn-sm btn-secondary drilldown-back-btn" onClick={onBack}>
          ← Back
        </button>
        <h3 className="drilldown-title">{category} — Product Detail</h3>
        <button className="btn btn-sm btn-primary" onClick={() => onNavigate("analytics")}>
          Run Analytics
        </button>
      </div>

      {isLoading ? (
        <div className="loading-state"><div className="spinner" /><p>Loading products…</p></div>
      ) : filtered.length === 0 ? (
        <div className="chart-empty">No products found in this category</div>
      ) : (
        <div className="chart-card">
          <h3>{config.labels.productPlural} in {category} ({filtered.length})</h3>
          <table className="data-table" style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>{config.labels.product}</th>
                <th>SKU</th>
                <th className="text-right">Stock</th>
                <th className="text-right">Selling Price ({config.currency})</th>
                <th className="text-right">Cost Price ({config.currency})</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 20).map((p: any, i: number) => (
                <tr key={i}>
                  <td>{p.name}</td>
                  <td><code className="sku-code">{p.sku ?? "—"}</code></td>
                  <td className="text-right">{p.quantity ?? p.stock ?? "—"}</td>
                  <td className="text-right">{p.sellingPrice != null ? fmt(Number(p.sellingPrice)) : "—"}</td>
                  <td className="text-right">{p.costPrice != null ? fmt(Number(p.costPrice)) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length > 20 && (
            <p className="text-muted" style={{ marginTop: 8, fontSize: 13 }}>
              Showing 20 of {filtered.length} products.{" "}
              <button className="btn-link" onClick={() => onNavigate("analytics")}>View all</button>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Alerts Panel ── */

function AlertsPanel({
  lowStock, insights, onNavigate,
}: {
  lowStock: any[] | undefined;
  insights: Array<{ title: string; body: string; severity: "high" | "medium" | "low" }>;
  onNavigate: (page: Page) => void;
}) {
  const alertCount = (lowStock?.length ?? 0) + insights.filter((i) => i.severity !== "low").length;
  const [open, setOpen] = useState(false);

  return (
    <div className="alerts-panel-container">
      <button
        className={`alerts-toggle-btn ${alertCount > 0 ? "alerts-toggle-btn-active" : ""}`}
        onClick={() => setOpen((o) => !o)}
        title="Business Alerts"
      >
        🔔 Alerts
        {alertCount > 0 && (
          <span className="alerts-badge">{alertCount > 99 ? "99+" : alertCount}</span>
        )}
        <span className="alerts-chevron">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="alerts-panel">
          <div className="alerts-panel-header">
            <h4>Business Alerts</h4>
            <button className="alerts-panel-close" onClick={() => setOpen(false)}>✕</button>
          </div>
          <div className="alerts-panel-body">
            {/* Low stock alerts */}
            {lowStock && lowStock.length > 0 && lowStock.slice(0, 5).map((item: any, i: number) => (
              <div
                key={`ls-${i}`}
                className={`alert-item alert-item-${item.quantity === 0 ? "high" : "medium"}`}
                onClick={() => onNavigate("analytics")}
                style={{ cursor: "pointer" }}
              >
                <span className="alert-icon">{item.quantity === 0 ? "🚨" : "⚠️"}</span>
                <div className="alert-content">
                  <div className="alert-title">{item.productName}</div>
                  <div className="alert-body">
                    {item.quantity === 0 ? "Out of stock" : `${item.quantity} left (reorder: ${item.reorderPoint ?? item.minStockLevel})`}
                  </div>
                </div>
              </div>
            ))}

            {/* Insight alerts */}
            {insights.filter((i) => i.severity !== "low").map((ins, i) => (
              <div
                key={`ins-${i}`}
                className={`alert-item alert-item-${ins.severity}`}
                onClick={() => onNavigate("analytics")}
                style={{ cursor: "pointer" }}
              >
                <span className="alert-icon">{ins.severity === "high" ? "🚨" : "📊"}</span>
                <div className="alert-content">
                  <div className="alert-title">{ins.title}</div>
                  <div className="alert-body">{ins.body}</div>
                </div>
              </div>
            ))}

            {alertCount === 0 && (
              <div className="alert-item alert-item-low">
                <span className="alert-icon">✅</span>
                <div className="alert-content">
                  <div className="alert-title">All clear</div>
                  <div className="alert-body">No critical alerts at this time.</div>
                </div>
              </div>
            )}

            <div className="alerts-panel-footer">
              <button className="btn btn-xs btn-primary" onClick={() => { onNavigate("analytics"); setOpen(false); }}>
                Run Analytics
              </button>
              <button className="btn btn-xs btn-secondary" onClick={() => { onNavigate("analytics"); setOpen(false); }}>
                Run Analytics
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Dashboard Component ── */

export default function Dashboard({ config, onNavigate }: DashboardProps) {
  const { data: health } = useAPI<{ status: string }>("GET /api/health");
  const { data: stats } = useAPI<any>("GET /api/admin/stats");
  const { data: lowStock } = useAPI<{ data: any[] }>("GET /api/inventory/low-stock?limit=10");

  // Date range state
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const today = now.toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(monthStart);
  const [endDate, setEndDate] = useState(today);
  const [nlQuery, setNlQuery] = useState("");

  // Drill-down state
  const [drilldown, setDrilldown] = useState<{ category: string } | null>(null);

  const chartUrl = `GET /api/admin/chart-data?startDate=${startDate}T00:00:00Z&endDate=${endDate}T23:59:59Z`;
  const { data: chartData, isLoading: chartsLoading } = useAPI<any>(chartUrl);
  const cd = chartData?.data;

  // Previous period for comparison
  const prevPeriod = useMemo(() => getPreviousPeriod(startDate, endDate), [startDate, endDate]);
  const prevChartUrl = `GET /api/admin/chart-data?startDate=${prevPeriod.start}T00:00:00Z&endDate=${prevPeriod.end}T23:59:59Z`;
  const { data: prevChartData } = useAPI<any>(prevChartUrl);
  const pcd = prevChartData?.data;

  // Period-over-period KPI trends
  const kpiTrends = useMemo(() => {
    if (!cd?.salesByDay || !pcd?.salesByDay) return null;
    const sum = (arr: any[], key: string) => arr.reduce((s: number, d: any) => s + (Number(d[key]) || 0), 0);
    const curRev = sum(cd.salesByDay, "revenue");
    const prevRev = sum(pcd.salesByDay, "revenue");
    const curOrders = sum(cd.salesByDay, "orderCount");
    const prevOrders = sum(pcd.salesByDay, "orderCount");
    return {
      revPct: prevRev > 0 ? ((curRev - prevRev) / prevRev) * 100 : null,
      ordersPct: prevOrders > 0 ? ((curOrders - prevOrders) / prevOrders) * 100 : null,
      curRev,
      curOrders,
    };
  }, [cd, pcd]);

  const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtInt = (n: number) => n?.toLocaleString() ?? "—";
  const st = stats?.data;

  // Date presets
  const setPreset = useCallback((days: number) => {
    const end = new Date();
    const start = new Date(end.getTime() - days * 86400000);
    setStartDate(start.toISOString().slice(0, 10));
    setEndDate(end.toISOString().slice(0, 10));
    setDrilldown(null);
  }, []);
  const setMTD = useCallback(() => {
    const n = new Date();
    setStartDate(`${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-01`);
    setEndDate(n.toISOString().slice(0, 10));
    setDrilldown(null);
  }, []);
  const setYTD = useCallback(() => {
    setStartDate(`${new Date().getFullYear()}-01-01`);
    setEndDate(new Date().toISOString().slice(0, 10));
    setDrilldown(null);
  }, []);

  const handleNlFilter = useCallback(() => {
    const q = nlQuery.toLowerCase().trim();
    if (!q) return;
    if (q.includes("today")) setPreset(0);
    else if (q.includes("yesterday")) setPreset(1);
    else if (q.includes("last week") || q.includes("past week")) setPreset(7);
    else if (q.includes("last 2 weeks") || q.includes("two weeks")) setPreset(14);
    else if (q.includes("last month") || q.includes("past month") || q.includes("30 days")) setPreset(30);
    else if (q.includes("last quarter") || q.includes("past quarter") || q.includes("90 days") || q.includes("3 months")) setPreset(90);
    else if (q.match(/last (\d+) days?/)) {
      const days = parseInt(q.match(/last (\d+) days?/)![1]);
      if (days > 0 && days <= 365) setPreset(days);
    } else if (q.includes("this month") || q.includes("month to date") || q.includes("mtd")) setMTD();
    else if (q.includes("this year") || q.includes("year to date") || q.includes("ytd")) setYTD();
    else if (q.includes("all time") || q.includes("everything")) setPreset(365);
    setNlQuery("");
  }, [nlQuery, setPreset, setMTD, setYTD]);

  // Insights derived from data
  const insights = useMemo(() => {
    const result: Array<{ title: string; body: string; severity: "high" | "medium" | "low" }> = [];
    if (!st) return result;

    const lowCount = lowStock?.data?.length ?? 0;
    if (lowCount > 0) {
      const outOfStock = lowStock?.data?.filter((i: any) => i.quantity === 0).length ?? 0;
      result.push({
        title: outOfStock > 0 ? `${outOfStock} products out of stock` : `${lowCount} products running low`,
        body: outOfStock > 0
          ? `${outOfStock} products have zero stock and ${lowCount - outOfStock} are below reorder point.`
          : `${lowCount} products are below their reorder point.`,
        severity: outOfStock > 0 ? "high" : "medium",
      });
    }

    if (cd?.salesByDay?.length >= 7) {
      const recent = cd.salesByDay.slice(-7);
      const recentAvg = recent.reduce((s: number, d: any) => s + (Number(d.revenue) || 0), 0) / recent.length;
      const earlier = cd.salesByDay.slice(0, 7);
      const earlierAvg = earlier.reduce((s: number, d: any) => s + (Number(d.revenue) || 0), 0) / Math.max(earlier.length, 1);
      if (earlierAvg > 0) {
        const change = ((recentAvg - earlierAvg) / earlierAvg) * 100;
        if (Math.abs(change) > 10) {
          result.push({
            title: change > 0 ? `Sales trending up ${change.toFixed(0)}%` : `Sales trending down ${Math.abs(change).toFixed(0)}%`,
            body: change > 0
              ? `Recent daily revenue is ${change.toFixed(0)}% higher than the prior period.`
              : `Recent daily revenue dropped ${Math.abs(change).toFixed(0)}% vs prior period.`,
            severity: change < -20 ? "high" : change < 0 ? "medium" : "low",
          });
        }
      }
    }

    if (cd?.paymentCollection?.unpaid > 0) {
      const unpaidRate = cd.paymentCollection.unpaid / (cd.paymentCollection.fullyPaid + cd.paymentCollection.partiallyPaid + cd.paymentCollection.unpaid);
      if (unpaidRate > 0.3) {
        result.push({
          title: `${(unpaidRate * 100).toFixed(0)}% invoices unpaid`,
          body: `${cd.paymentCollection.unpaid} invoices remain unpaid. Consider sending reminders.`,
          severity: unpaidRate > 0.5 ? "high" : "medium",
        });
      }
    }

    if (result.length === 0 && st.orderCount > 0) {
      result.push({
        title: "Operations looking healthy",
        body: `${st.orderCount.toLocaleString()} orders processed. No critical alerts.`,
        severity: "low",
      });
    }

    return result.slice(0, 4);
  }, [st, cd, lowStock]);

  // Handle category bar click
  const handleCategoryClick = useCallback((label: string) => {
    setDrilldown({ category: label });
  }, []);

  // Comparison period label
  const comparisonLabel = useMemo(() => {
    const days = Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000);
    return `vs prev ${days}d`;
  }, [startDate, endDate]);

  return (
    <div className="page dashboard-page">
      {/* Header */}
      <div className="page-header-row">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div>
            <h2>Dashboard</h2>
            <span
              className="status-pill"
              style={{
                backgroundColor: health?.status === "ok" ? "#dcfce7" : "#fee2e2",
                color: health?.status === "ok" ? "#166534" : "#991b1b",
              }}
            >
              {health?.status === "ok" ? "✓ System Online" : "⏳ Connecting…"}
            </span>
          </div>
          <AlertsPanel
            lowStock={lowStock?.data}
            insights={insights}
            onNavigate={onNavigate}
          />
        </div>

        <div className="dashboard-date-filter">
          <div className="date-presets">
            <button className="btn btn-xs btn-secondary" onClick={() => setPreset(7)}>7d</button>
            <button className="btn btn-xs btn-secondary" onClick={setMTD}>MTD</button>
            <button className="btn btn-xs btn-secondary" onClick={() => setPreset(30)}>30d</button>
            <button className="btn btn-xs btn-secondary" onClick={() => setPreset(90)}>90d</button>
            <button className="btn btn-xs btn-secondary" onClick={setYTD}>YTD</button>
          </div>
          <input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); setDrilldown(null); }} className="date-input" />
          <span className="text-muted">to</span>
          <input type="date" value={endDate} onChange={(e) => { setEndDate(e.target.value); setDrilldown(null); }} className="date-input" />
          <input
            type="text"
            placeholder="'last week', 'last 60 days'…"
            value={nlQuery}
            onChange={(e) => setNlQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleNlFilter(); }}
            className="date-input"
            style={{ minWidth: 160, fontSize: 12 }}
          />
        </div>
      </div>

      {/* Drill-down view */}
      {drilldown ? (
        <CategoryDrilldown
          category={drilldown.category}
          startDate={startDate}
          endDate={endDate}
          config={config}
          onBack={() => setDrilldown(null)}
          onNavigate={onNavigate}
        />
      ) : (
        <>
          {/* KPI Cards */}
          <div className="summary-cards">
            <div className="summary-card summary-card-highlight">
              <span className="summary-card-value">
                {kpiTrends ? fmt(kpiTrends.curRev) : st ? fmt(st.totalRevenue) : "—"}
              </span>
              <span className="summary-card-label">Revenue ({config.currency})</span>
              <TrendBadge pct={kpiTrends?.revPct ?? null} />
              {kpiTrends && <span className="kpi-comparison-label">{comparisonLabel}</span>}
            </div>
            <div className="summary-card">
              <span className="summary-card-value">
                {kpiTrends ? fmtInt(kpiTrends.curOrders) : st ? fmtInt(st.orderCount) : "—"}
              </span>
              <span className="summary-card-label">{config.labels.orderPlural}</span>
              <TrendBadge pct={kpiTrends?.ordersPct ?? null} />
              {kpiTrends && <span className="kpi-comparison-label">{comparisonLabel}</span>}
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

          {/* Insights widget */}
          {insights.length > 0 && (
            <div className="chart-card" style={{ marginBottom: 16 }}>
              <h3>AI Insights</h3>
              <p className="chart-subtitle">Auto-generated from your current data</p>
              <div className="ai-insights-widget">
                {insights.map((insight, i) => (
                  <div
                    key={i}
                    className={`insight-card insight-card-${insight.severity}`}
                    onClick={() => insight.title.toLowerCase().includes("stock") ? onNavigate("analytics") : onNavigate("analytics")}
                    style={{ cursor: "pointer" }}
                  >
                    <div className="insight-card-title">{insight.title}</div>
                    <div className="insight-card-body">{insight.body}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {chartsLoading ? (
            <div className="loading-state"><div className="spinner" /><p>Loading charts…</p></div>
          ) : cd ? (
            <>
              {/* Row 1: Sales Trend + Revenue by Status */}
              <div className="chart-row">
                <div className="chart-card">
                  <h3>Sales Trend</h3>
                  <p className="chart-subtitle">Daily revenue — hover for exact value</p>
                  <LineChart
                    data={cd.salesByDay}
                    xKey="date" yKey="revenue" color="#3b82f6"
                    xLabel="Date" yLabel={`Revenue (${config.currency})`}
                  />
                </div>
                <div className="chart-card">
                  <h3>Revenue by Status</h3>
                  <p className="chart-subtitle">Order revenue breakdown — hover to highlight</p>
                  <PieChart data={cd.revenueByStatus} labelKey="label" valueKey="revenue" />
                </div>
              </div>

              {/* Row 2: Inventory by Category (clickable) + Payment Collection */}
              <div className="chart-row">
                <div className="chart-card">
                  <h3>Inventory Value by Category</h3>
                  <p className="chart-subtitle">
                    Stock value ({config.currency}) — <span className="text-muted" style={{ fontSize: 11 }}>click a bar to drill down</span>
                  </p>
                  <BarChart
                    data={cd.inventoryByCategory}
                    labelKey="category" valueKey="totalValue"
                    color="#8b5cf6" maxItems={12}
                    onBarClick={handleCategoryClick}
                  />
                </div>
                <div className="chart-card">
                  <h3>Payment Collection</h3>
                  <p className="chart-subtitle">Invoices: paid vs outstanding</p>
                  <PieChart
                    data={[
                      { label: "Fully Paid", value: cd.paymentCollection.fullyPaid, color: "#22c55e" },
                      { label: "Partially Paid", value: cd.paymentCollection.partiallyPaid, color: "#f59e0b" },
                      { label: "Unpaid", value: cd.paymentCollection.unpaid, color: "#ef4444" },
                    ].filter((d) => d.value > 0)}
                    labelKey="label" valueKey="value"
                  />
                </div>
              </div>

              {/* Row 3: Top Customers + Top Products */}
              <div className="chart-row">
                <div className="chart-card">
                  <h3>Top {config.labels.customerPlural}</h3>
                  <p className="chart-subtitle">By revenue ({config.currency})</p>
                  <BarChart data={cd.topCustomers} labelKey="name" valueKey="revenue" color="#06b6d4" maxItems={10} />
                </div>
                <div className="chart-card">
                  <h3>Top {config.labels.productPlural}</h3>
                  <p className="chart-subtitle">By revenue ({config.currency})</p>
                  <BarChart data={cd.topProducts} labelKey="name" valueKey="revenue" color="#f59e0b" maxItems={10} />
                </div>
              </div>

              {/* Invoice Breakdown */}
              {cd.invoiceStats.length > 0 && (
                <div className="chart-card" style={{ marginBottom: 16 }}>
                  <h3>Invoice Status Breakdown</h3>
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
                          <td>
                            <span
                              className="status-pill"
                              style={{
                                backgroundColor:
                                  inv.status === "paid" ? "#22c55e" :
                                  inv.status === "sent" ? "#3b82f6" :
                                  inv.status === "overdue" ? "#ef4444" : "#94a3b8",
                              }}
                            >
                              {inv.status}
                            </span>
                          </td>
                          <td className="text-right">{inv.count}</td>
                          <td className="text-right">{fmt(inv.totalBilled)}</td>
                          <td className="text-right" style={{ color: "#22c55e" }}>{fmt(inv.totalPaid)}</td>
                          <td className="text-right" style={{ color: inv.outstanding > 0 ? "#ef4444" : undefined }}>
                            {fmt(inv.outstanding)}
                          </td>
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
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <h3>Low Stock Alerts ({lowStock.data.length})</h3>
                <button className="btn btn-xs btn-secondary" onClick={() => onNavigate("analytics")}>
                  Run Analytics
                </button>
              </div>
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
        </>
      )}
    </div>
  );
}
