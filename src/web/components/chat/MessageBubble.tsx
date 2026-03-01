/**
 * MessageBubble — Renders a single chat message (user or assistant).
 * Assistant messages include markdown rendering, tool call cards, and feedback buttons.
 */

import React, { useMemo } from "react";
import type { ChatMessage } from "../../hooks/useChatStream";
import ToolCallCard from "./ToolCallCard";

interface MessageBubbleProps {
  message: ChatMessage;
  onFeedback?: (messageId: string, rating: "up" | "down") => void;
}

const MessageBubble = React.memo(function MessageBubble({
  message,
  onFeedback,
}: MessageBubbleProps) {
  const isUser = message.role === "user";
  const renderedContent = useMemo(
    () => (isUser ? null : renderMarkdown(message.content)),
    [isUser, message.content]
  );

  return (
    <div className={`chat-message ${message.role}`}>
      <div className="message-bubble">
        {/* Tool calls (shown before the text for assistant messages) */}
        {!isUser && message.toolCalls && message.toolCalls.length > 0 && (
          <div className="message-tool-calls">
            {message.toolCalls.map((tc) => (
              <ToolCallCard key={tc.id} toolCall={tc} />
            ))}
          </div>
        )}

        {/* Message content */}
        <div className="message-content">
          {isUser ? (
            <p>{message.content}</p>
          ) : (
            <div className="message-markdown">
              {renderedContent}
            </div>
          )}
        </div>

        {/* Footer: time + tokens + feedback */}
        <div className="message-footer">
          <span className="message-time">
            {new Date(message.createdAt).toLocaleTimeString()}
          </span>

          {!isUser && onFeedback && (
            <div className="message-feedback">
              <button
                className={`feedback-btn ${
                  message.metadata?.feedbackRating === "up" ? "active" : ""
                }`}
                onClick={() => onFeedback(message.id, "up")}
                title="Helpful"
              >
                👍
              </button>
              <button
                className={`feedback-btn ${
                  message.metadata?.feedbackRating === "down" ? "active" : ""
                }`}
                onClick={() => onFeedback(message.id, "down")}
                title="Not helpful"
              >
                👎
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

export default MessageBubble;

// ── Markdown Renderer ──────────────────────────────────────

export function renderMarkdown(text: string): React.ReactNode {
  if (!text) return null;

  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];
  let codeLang = "";

  // Table accumulation
  let tableRows: string[][] = [];
  let tableIsHeader = true; // first non-separator row is treated as header

  function flushTable(key: string) {
    if (!tableRows.length) return;
    const [head, ...body] = tableRows;
    elements.push(
      <table key={key} className="message-md-table">
        <thead>
          <tr>{head.map((c, j) => <th key={j}>{renderInline(c)}</th>)}</tr>
        </thead>
        <tbody>
          {body.map((row, ri) => (
            <tr key={ri}>{row.map((c, j) => <td key={j}>{renderInline(c)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    );
    tableRows = [];
    tableIsHeader = true;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code blocks
    if (line.startsWith("```")) {
      flushTable(`tbl-pre-${i}`);
      if (inCodeBlock) {
        const lang = codeLang;
        const content = codeLines.join("\n");
        codeLines = [];
        codeLang = "";
        inCodeBlock = false;

        if (lang === "chart") {
          try {
            const spec = JSON.parse(content);
            elements.push(<ReportChart key={i} spec={spec} />);
          } catch {
            elements.push(
              <pre key={i} className="message-code-block" data-lang="chart">
                <code>{content}</code>
              </pre>
            );
          }
        } else {
          elements.push(
            <pre key={i} className="message-code-block" data-lang={lang}>
              <code>{content}</code>
            </pre>
          );
        }
      } else {
        inCodeBlock = true;
        codeLang = line.slice(3).trim();
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    // Table rows
    if (line.startsWith("|")) {
      // Separator row (|---|---| or |:---|---:|) — marks end of header
      if (line.match(/^\|[\s\-:|]+\|$/)) {
        tableIsHeader = false;
        continue;
      }
      const cells = line.split("|").filter((_, ci) => ci > 0 && ci < line.split("|").length - 1).map((c) => c.trim());
      if (cells.length) tableRows.push(cells);
      continue;
    }

    // Non-table line — flush any accumulated table
    if (tableRows.length) flushTable(`tbl-${i}`);

    // Headers
    if (line.startsWith("#### ")) {
      elements.push(<h5 key={i}>{renderInline(line.slice(5))}</h5>);
    } else if (line.startsWith("### ")) {
      elements.push(<h4 key={i}>{renderInline(line.slice(4))}</h4>);
    } else if (line.startsWith("## ")) {
      elements.push(<h3 key={i}>{renderInline(line.slice(3))}</h3>);
    } else if (line.startsWith("# ")) {
      elements.push(<h2 key={i}>{renderInline(line.slice(2))}</h2>);
    }
    // Horizontal rule
    else if (line.match(/^[-*_]{3,}$/)) {
      elements.push(<hr key={i} />);
    }
    // Bullet lists
    else if (line.match(/^\s*[-*+]\s/)) {
      elements.push(
        <li key={i}>{renderInline(line.replace(/^\s*[-*+]\s/, ""))}</li>
      );
    }
    // Numbered lists
    else if (line.match(/^\s*\d+\.\s/)) {
      elements.push(
        <li key={i}>{renderInline(line.replace(/^\s*\d+\.\s/, ""))}</li>
      );
    }
    // Empty line
    else if (line.trim() === "") {
      elements.push(<br key={i} />);
    }
    // Regular paragraph
    else {
      elements.push(<p key={i}>{renderInline(line)}</p>);
    }
  }

  // Flush any trailing table / code block
  flushTable("tbl-end");
  if (inCodeBlock && codeLines.length) {
    const content = codeLines.join("\n");
    if (codeLang === "chart") {
      try {
        const spec = JSON.parse(content);
        elements.push(<ReportChart key="chart-end" spec={spec} />);
      } catch {
        elements.push(
          <pre key="final-code" className="message-code-block">
            <code>{content}</code>
          </pre>
        );
      }
    } else {
      elements.push(
        <pre key="final-code" className="message-code-block">
          <code>{content}</code>
        </pre>
      );
    }
  }

  return <>{elements}</>;
}

// ── Report Chart Component ─────────────────────────────────
// Renders ```chart JSON blocks as inline SVG visualisations.
// Uses viewBox so charts scale responsively inside message bubbles.

const CHART_COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#06b6d4", "#f97316", "#84cc16", "#ec4899", "#14b8a6",
];

function ReportChart({ spec }: { spec: any }) {
  const { type = "bar", title, data, xField, yField, colorField } = spec;
  if (!Array.isArray(data) || !data.length || !xField || !yField) {
    return (
      <div className="report-chart-error">
        ⚠ Chart: missing data or field mapping
      </div>
    );
  }

  if (type === "pie" || type === "donut") {
    return <ReportPieChart data={data} labelField={xField} valueField={yField} title={title} donut={type === "donut"} />;
  }
  if (type === "line" || type === "area") {
    return <ReportLineChart data={data} xKey={xField} yKey={yField} title={title} area={type === "area"} />;
  }
  // bar, grouped_bar, stacked_bar, scatter → bar-style SVG
  return <ReportBarChart data={data} xKey={xField} yKey={yField} colorField={colorField} title={title} />;
}

function ReportBarChart({ data, xKey, yKey, colorField, title }: {
  data: any[]; xKey: string; yKey: string; colorField?: string; title?: string;
}) {
  const W = 480, H = 200, PAD_L = 48, PAD_B = 40, PAD_T = 28, PAD_R = 8;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const max = Math.max(...data.map((d) => Number(d[yKey]) || 0), 1);
  const barW = Math.max(8, innerW / data.length - 4);
  // Y-axis ticks
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({ ratio: t, val: max * t }));

  return (
    <div className="report-chart">
      {title && <div className="report-chart-title">{title}</div>}
      <svg viewBox={`0 0 ${W} ${H}`} className="report-chart-svg" aria-label={title}>
        {/* Y-axis grid lines + labels */}
        {ticks.map(({ ratio, val }, i) => {
          const y = PAD_T + innerH * (1 - ratio);
          return (
            <g key={i}>
              <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke="#e2e8f0" strokeWidth="1" />
              <text x={PAD_L - 4} y={y + 4} textAnchor="end" fontSize="9" fill="#94a3b8">
                {val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val.toFixed(0)}
              </text>
            </g>
          );
        })}
        {/* Bars */}
        {data.map((d, i) => {
          const val = Number(d[yKey]) || 0;
          const barH = (val / max) * innerH;
          const x = PAD_L + i * (innerW / data.length) + (innerW / data.length - barW) / 2;
          const y = PAD_T + innerH - barH;
          const color = colorField ? CHART_COLORS[i % CHART_COLORS.length] : CHART_COLORS[0];
          const label = String(d[xKey] ?? "").slice(0, 10);
          return (
            <g key={i}>
              <rect x={x} y={y} width={barW} height={barH} fill={color} rx={2} opacity={0.85}>
                <title>{d[xKey]}: {val.toLocaleString()}</title>
              </rect>
              <text x={x + barW / 2} y={H - PAD_B + 13} textAnchor="middle" fontSize="8" fill="#64748b">{label}</text>
              {barH > 14 && (
                <text x={x + barW / 2} y={y - 3} textAnchor="middle" fontSize="8" fill="#475569">
                  {val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val.toLocaleString()}
                </text>
              )}
            </g>
          );
        })}
        {/* Axes */}
        <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={PAD_T + innerH} stroke="#cbd5e1" strokeWidth="1.5" />
        <line x1={PAD_L} y1={PAD_T + innerH} x2={W - PAD_R} y2={PAD_T + innerH} stroke="#cbd5e1" strokeWidth="1.5" />
      </svg>
    </div>
  );
}

function ReportLineChart({ data, xKey, yKey, title, area }: {
  data: any[]; xKey: string; yKey: string; title?: string; area?: boolean;
}) {
  const W = 480, H = 200, PAD_L = 48, PAD_B = 40, PAD_T = 28, PAD_R = 8;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const vals = data.map((d) => Number(d[yKey]) || 0);
  const max = Math.max(...vals, 1);
  const min = Math.min(...vals, 0);
  const range = max - min || 1;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({ ratio: t, val: min + range * t }));

  const pts = data.map((d, i) => {
    const val = Number(d[yKey]) || 0;
    const x = PAD_L + (i / (data.length - 1 || 1)) * innerW;
    const y = PAD_T + innerH - ((val - min) / range) * innerH;
    return { x, y, val, label: String(d[xKey] ?? "").slice(0, 8) };
  });

  const linePath = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const areaPath = area && pts.length
    ? `${linePath} L${pts[pts.length - 1].x},${PAD_T + innerH} L${pts[0].x},${PAD_T + innerH} Z`
    : "";

  return (
    <div className="report-chart">
      {title && <div className="report-chart-title">{title}</div>}
      <svg viewBox={`0 0 ${W} ${H}`} className="report-chart-svg" aria-label={title}>
        {ticks.map(({ ratio, val }, i) => {
          const y = PAD_T + innerH * (1 - ratio);
          return (
            <g key={i}>
              <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke="#e2e8f0" strokeWidth="1" />
              <text x={PAD_L - 4} y={y + 4} textAnchor="end" fontSize="9" fill="#94a3b8">
                {val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val.toFixed(0)}
              </text>
            </g>
          );
        })}
        {area && areaPath && (
          <path d={areaPath} fill={CHART_COLORS[0]} opacity={0.15} />
        )}
        <path d={linePath} fill="none" stroke={CHART_COLORS[0]} strokeWidth="2" strokeLinejoin="round" />
        {pts.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={3} fill={CHART_COLORS[0]}>
              <title>{p.label}: {p.val.toLocaleString()}</title>
            </circle>
            {i % Math.ceil(data.length / 8) === 0 && (
              <text x={p.x} y={H - PAD_B + 13} textAnchor="middle" fontSize="8" fill="#64748b">{p.label}</text>
            )}
          </g>
        ))}
        <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={PAD_T + innerH} stroke="#cbd5e1" strokeWidth="1.5" />
        <line x1={PAD_L} y1={PAD_T + innerH} x2={W - PAD_R} y2={PAD_T + innerH} stroke="#cbd5e1" strokeWidth="1.5" />
      </svg>
    </div>
  );
}

function ReportPieChart({ data, labelField, valueField, title, donut }: {
  data: any[]; labelField: string; valueField: string; title?: string; donut?: boolean;
}) {
  const W = 320, H = 200, cx = 100, cy = H / 2, R = 80, r = donut ? 40 : 0;
  const total = data.reduce((s, d) => s + (Number(d[valueField]) || 0), 0) || 1;
  let angle = -Math.PI / 2;
  const slices = data.map((d, i) => {
    const val = Number(d[valueField]) || 0;
    const sweep = (val / total) * 2 * Math.PI;
    const startAngle = angle;
    angle += sweep;
    const endAngle = angle;
    const x1 = cx + R * Math.cos(startAngle), y1 = cy + R * Math.sin(startAngle);
    const x2 = cx + R * Math.cos(endAngle), y2 = cy + R * Math.sin(endAngle);
    const ix1 = cx + r * Math.cos(startAngle), iy1 = cy + r * Math.sin(startAngle);
    const ix2 = cx + r * Math.cos(endAngle), iy2 = cy + r * Math.sin(endAngle);
    const large = sweep > Math.PI ? 1 : 0;
    const path = donut
      ? `M${ix1},${iy1} A${r},${r} 0 ${large} 1 ${ix2},${iy2} L${x2},${y2} A${R},${R} 0 ${large} 0 ${x1},${y1} Z`
      : `M${cx},${cy} L${x1},${y1} A${R},${R} 0 ${large} 1 ${x2},${y2} Z`;
    return { path, color: CHART_COLORS[i % CHART_COLORS.length], label: String(d[labelField] ?? ""), val, pct: (val / total * 100).toFixed(1) };
  });

  return (
    <div className="report-chart">
      {title && <div className="report-chart-title">{title}</div>}
      <svg viewBox={`0 0 ${W} ${H}`} className="report-chart-svg" aria-label={title}>
        {slices.map((s, i) => (
          <path key={i} d={s.path} fill={s.color} stroke="#fff" strokeWidth="1.5" opacity={0.9}>
            <title>{s.label}: {s.val.toLocaleString()} ({s.pct}%)</title>
          </path>
        ))}
        {/* Legend */}
        {slices.slice(0, 8).map((s, i) => (
          <g key={i} transform={`translate(${cx + R + 16}, ${16 + i * 20})`}>
            <rect width="10" height="10" fill={s.color} rx="2" />
            <text x="14" y="9" fontSize="9" fill="#475569">{s.label.slice(0, 16)} {s.pct}%</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function renderInline(text: string): React.ReactNode {
  // Process: **bold**, *italic*, `code`, [link](url)
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Inline code: `text`
    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      parts.push(
        <code key={key++} className="message-inline-code">
          {codeMatch[1]}
        </code>
      );
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    // Links: [text](url)
    const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch) {
      const href = linkMatch[2];
      const label = linkMatch[1];
      if (href.startsWith("data:")) {
        // Data URLs can't be navigated — trigger blob download on click
        parts.push(
          <a
            key={key++}
            href="#"
            onClick={(e) => {
              e.preventDefault();
              try {
                const byteString = atob(href.split(",")[1] || "");
                const mimeMatch = href.match(/^data:([^;]+)/);
                const mime = mimeMatch ? mimeMatch[1] : "application/octet-stream";
                const ab = new Uint8Array(byteString.length);
                for (let i = 0; i < byteString.length; i++) ab[i] = byteString.charCodeAt(i);
                const blob = new Blob([ab], { type: mime });
                const blobUrl = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = blobUrl;
                // Derive filename from link label
                const ext = mime.split("/")[1] || "bin";
                a.download = label.replace(/[^a-zA-Z0-9\s-]/g, "").trim() + "." + ext;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(blobUrl);
              } catch (err) {
                console.error("Failed to download data URL:", err);
              }
            }}
            className="data-url-download"
          >
            {label}
          </a>
        );
      } else {
        parts.push(
          <a
            key={key++}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
          >
            {label}
          </a>
        );
      }
      remaining = remaining.slice(linkMatch[0].length);
      continue;
    }

    // Bold: **text**
    const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/);
    if (boldMatch) {
      parts.push(<strong key={key++}>{boldMatch[1]}</strong>);
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    // Italic: *text*
    const italicMatch = remaining.match(/^\*([^*]+)\*/);
    if (italicMatch) {
      parts.push(<em key={key++}>{italicMatch[1]}</em>);
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    // Regular character
    // Collect plain text until next special char
    const plainMatch = remaining.match(/^[^`*[]+/);
    if (plainMatch) {
      parts.push(<span key={key++}>{plainMatch[0]}</span>);
      remaining = remaining.slice(plainMatch[0].length);
    } else {
      // Single special char that didn't match a pattern
      parts.push(<span key={key++}>{remaining[0]}</span>);
      remaining = remaining.slice(1);
    }
  }

  return <>{parts}</>;
}
