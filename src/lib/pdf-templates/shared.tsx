/**
 * PDF Report Template — Shared Styles & Layout Components
 *
 * Uses @react-pdf/renderer with Yoga flexbox layout engine.
 * All report templates import these shared components for consistent branding.
 *
 * Design: Magazine-quality enterprise reports with:
 *   - Multi-column layouts (flexbox)
 *   - Rich typography (bold/italic inline)
 *   - KPI cards with accent colors
 *   - Branded headers/footers on every page
 *   - Charts flowing inline with content
 *   - Professional table rendering with stripes + borders
 */

import React from "react";
import {
  Document,
  Page,
  View,
  Text,
  Image,
  StyleSheet,
  Font,
} from "@react-pdf/renderer";
import type { Style } from "@react-pdf/types";

// ── Types ──────────────────────────────────────────────────

export interface Branding {
  companyName: string;
  logoUrl: string;
  primaryColor: string;
  tagline: string;
}

export interface ReportMeta {
  title: string;
  subtitle?: string;
  preparedBy?: string;
  generatedAt: string;
  confidentialFooter: boolean;
}

export interface TableData {
  headers: string[];
  rows: string[][];
  caption?: string;
}

export interface ChartImage {
  title: string;
  /** Base64-encoded PNG */
  data: string;
  width?: number;
  height?: number;
}

export interface ParsedSection {
  heading: string;
  level: number;
  lines: string[];
  tables: TableData[];
  charts: ChartImage[];
}

// ── Color helpers ──────────────────────────────────────────

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}

/** Lighten a hex color by mixing with white. Factor 0-1 (0=original, 1=white). */
export function lighten(hex: string, factor: number): string {
  const { r, g, b } = hexToRgb(hex);
  const lr = Math.round(r + (255 - r) * factor);
  const lg = Math.round(g + (255 - g) * factor);
  const lb = Math.round(b + (255 - b) * factor);
  return `#${lr.toString(16).padStart(2, "0")}${lg.toString(16).padStart(2, "0")}${lb.toString(16).padStart(2, "0")}`;
}

/** Darken a hex color by mixing with black. Factor 0-1 (0=original, 1=black). */
export function darken(hex: string, factor: number): string {
  const { r, g, b } = hexToRgb(hex);
  const dr = Math.round(r * (1 - factor));
  const dg = Math.round(g * (1 - factor));
  const db = Math.round(b * (1 - factor));
  return `#${dr.toString(16).padStart(2, "0")}${dg.toString(16).padStart(2, "0")}${db.toString(16).padStart(2, "0")}`;
}

// ── Shared styles ──────────────────────────────────────────

export function createStyles(primaryColor: string) {
  const accent = primaryColor;
  const accentLight = lighten(primaryColor, 0.92);
  const accentMid = lighten(primaryColor, 0.7);

  return StyleSheet.create({
    // Page
    page: {
      paddingTop: 60,
      paddingBottom: 50,
      paddingHorizontal: 40,
      fontFamily: "Helvetica",
      fontSize: 9,
      color: "#1e293b",
      backgroundColor: "#ffffff",
    },

    // ── Title Page ──
    titlePage: {
      padding: 0,
      fontFamily: "Helvetica",
      backgroundColor: "#ffffff",
    },
    titleBanner: {
      height: 130,
      backgroundColor: accent,
      paddingHorizontal: 40,
      paddingTop: 30,
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    titleBannerText: {
      color: "#ffffff",
      fontSize: 26,
      fontFamily: "Helvetica-Bold",
    },
    titleLogo: {
      maxWidth: 120,
      maxHeight: 80,
    },
    titleBody: {
      paddingHorizontal: 40,
      paddingTop: 40,
    },
    titleMain: {
      fontSize: 28,
      fontFamily: "Helvetica-Bold",
      color: "#0f172a",
      marginBottom: 8,
    },
    titleSub: {
      fontSize: 14,
      color: "#64748b",
      marginBottom: 24,
    },
    titleMeta: {
      fontSize: 10,
      color: "#94a3b8",
      marginBottom: 4,
    },
    titleDivider: {
      height: 2,
      backgroundColor: accent,
      marginVertical: 20,
      width: 80,
    },

    // ── Headers & Footers ──
    headerBar: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      height: 3,
      backgroundColor: accent,
    },
    footer: {
      position: "absolute",
      bottom: 16,
      left: 40,
      right: 40,
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      borderTopWidth: 0.5,
      borderTopColor: "#e2e8f0",
      paddingTop: 6,
    },
    footerText: {
      fontSize: 7,
      color: "#94a3b8",
    },

    // ── Section headings ──
    h2: {
      fontSize: 16,
      fontFamily: "Helvetica-Bold",
      color: accent,
      marginTop: 18,
      marginBottom: 6,
      paddingBottom: 4,
      borderBottomWidth: 1,
      borderBottomColor: accentMid,
    },
    h3: {
      fontSize: 12,
      fontFamily: "Helvetica-Bold",
      color: "#334155",
      marginTop: 12,
      marginBottom: 4,
    },

    // ── Body text ──
    paragraph: {
      fontSize: 9,
      lineHeight: 1.5,
      color: "#334155",
      marginBottom: 4,
    },
    bold: {
      fontFamily: "Helvetica-Bold",
    },
    italic: {
      fontFamily: "Helvetica-Oblique",
    },
    bullet: {
      flexDirection: "row",
      marginBottom: 3,
      paddingLeft: 4,
    },
    bulletDot: {
      width: 14,
      fontSize: 9,
      color: accent,
      fontFamily: "Helvetica-Bold",
    },
    bulletText: {
      flex: 1,
      fontSize: 9,
      lineHeight: 1.5,
      color: "#334155",
    },

    // ── KPI Cards ──
    kpiRow: {
      flexDirection: "row",
      gap: 10,
      marginVertical: 10,
    },
    kpiCard: {
      flex: 1,
      backgroundColor: accentLight,
      borderRadius: 4,
      padding: 10,
      borderLeftWidth: 3,
      borderLeftColor: accent,
    },
    kpiValue: {
      fontSize: 18,
      fontFamily: "Helvetica-Bold",
      color: "#0f172a",
    },
    kpiLabel: {
      fontSize: 8,
      color: "#64748b",
      marginTop: 2,
    },
    kpiChange: {
      fontSize: 7,
      marginTop: 2,
    },

    // ── Tables ──
    table: {
      marginVertical: 8,
      borderWidth: 0.5,
      borderColor: "#e2e8f0",
      borderRadius: 2,
    },
    tableHeaderRow: {
      flexDirection: "row",
      backgroundColor: accent,
      minHeight: 22,
    },
    tableHeaderCell: {
      fontSize: 8,
      fontFamily: "Helvetica-Bold",
      color: "#ffffff",
      paddingVertical: 5,
      paddingHorizontal: 6,
      textAlign: "left",
    },
    tableRow: {
      flexDirection: "row",
      minHeight: 18,
      borderBottomWidth: 0.3,
      borderBottomColor: "#e2e8f0",
    },
    tableRowStripe: {
      backgroundColor: "#f8fafc",
    },
    tableCell: {
      fontSize: 8,
      color: "#334155",
      paddingVertical: 4,
      paddingHorizontal: 6,
    },
    tableCellNumeric: {
      textAlign: "right",
    },
    tableCaption: {
      fontSize: 7,
      color: "#94a3b8",
      textAlign: "center",
      fontFamily: "Helvetica-Oblique",
      marginTop: 4,
      marginBottom: 8,
    },

    // ── Charts ──
    chartContainer: {
      marginVertical: 10,
      alignItems: "center",
    },
    chartImage: {
      maxWidth: "100%",
      objectFit: "contain" as any,
    },
    chartCaption: {
      fontSize: 7,
      color: "#94a3b8",
      textAlign: "center",
      fontFamily: "Helvetica-Oblique",
      marginTop: 4,
    },

    // ── Two-column layout ──
    twoColumn: {
      flexDirection: "row",
      gap: 16,
    },
    column: {
      flex: 1,
    },
    columnWide: {
      flex: 2,
    },

    // ── TOC ──
    tocTitle: {
      fontSize: 18,
      fontFamily: "Helvetica-Bold",
      color: accent,
      marginBottom: 12,
    },
    tocItem: {
      fontSize: 11,
      color: "#334155",
      marginBottom: 6,
      paddingLeft: 8,
    },
    tocDivider: {
      height: 0.5,
      backgroundColor: accentMid,
      marginVertical: 16,
    },

    // ── Misc ──
    spacer: {
      height: 8,
    },
    divider: {
      height: 0.5,
      backgroundColor: "#e2e8f0",
      marginVertical: 8,
    },
    accentDivider: {
      height: 1,
      backgroundColor: accent,
      marginVertical: 10,
      width: 60,
    },
  });
}

// ── Shared layout components ───────────────────────────────

/** Branded page header bar (thin accent line at top) + footer */
export function PageShell({
  children,
  branding,
  meta,
  styles: s,
}: {
  children: React.ReactNode;
  branding: Branding;
  meta: ReportMeta;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <Page size="A4" style={s.page}>
      <View style={s.headerBar} fixed />
      {children}
      <View style={s.footer} fixed>
        <Text style={s.footerText}>
          {branding.companyName}
          {meta.confidentialFooter ? " — Confidential" : ""}
        </Text>
        <Text
          style={s.footerText}
          render={({ pageNumber, totalPages }) =>
            `Page ${pageNumber} of ${totalPages}`
          }
        />
      </View>
    </Page>
  );
}

/** Title / cover page */
export function TitlePage({
  branding,
  meta,
  styles: s,
}: {
  branding: Branding;
  meta: ReportMeta;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <Page size="A4" style={s.titlePage}>
      {/* Brand banner */}
      <View style={s.titleBanner}>
        <Text style={s.titleBannerText}>{branding.companyName}</Text>
        {branding.logoUrl ? (
          <Image src={branding.logoUrl} style={s.titleLogo} />
        ) : null}
      </View>

      {/* Body */}
      <View style={s.titleBody}>
        <Text style={s.titleMain}>{meta.title}</Text>
        {meta.subtitle ? (
          <Text style={s.titleSub}>{meta.subtitle}</Text>
        ) : null}

        <View style={s.titleDivider} />

        <Text style={s.titleMeta}>
          Prepared for: {branding.companyName}
        </Text>
        <Text style={s.titleMeta}>Date: {meta.generatedAt}</Text>
        {meta.preparedBy ? (
          <Text style={s.titleMeta}>Prepared by: {meta.preparedBy}</Text>
        ) : null}
        {branding.tagline ? (
          <Text style={{ ...s.titleMeta, fontFamily: "Helvetica-Oblique", marginTop: 12 }}>
            {branding.tagline}
          </Text>
        ) : null}
      </View>

      {/* Footer */}
      <View style={s.footer}>
        <Text style={s.footerText}>
          {branding.companyName}
          {meta.confidentialFooter ? " — Confidential" : ""}
        </Text>
      </View>
    </Page>
  );
}

/** Table of Contents page */
export function TocPage({
  sections,
  branding,
  meta,
  styles: s,
}: {
  sections: ParsedSection[];
  branding: Branding;
  meta: ReportMeta;
  styles: ReturnType<typeof createStyles>;
}) {
  const h2s = sections.filter((sec) => sec.heading && sec.level === 2);
  if (h2s.length === 0) return null;

  return (
    <PageShell branding={branding} meta={meta} styles={s}>
      <Text style={s.tocTitle}>Table of Contents</Text>
      <View style={s.tocDivider} />
      {h2s.map((sec, i) => (
        <Text key={i} style={s.tocItem}>
          {i + 1}. {sec.heading}
        </Text>
      ))}
    </PageShell>
  );
}

// ── Data rendering components ──────────────────────────────

/** KPI card row (up to 4 cards) */
export function KpiRow({
  items,
  styles: s,
}: {
  items: Array<{ value: string; label: string; change?: string; positive?: boolean }>;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={s.kpiRow}>
      {items.map((item, i) => (
        <View key={i} style={s.kpiCard}>
          <Text style={s.kpiValue}>{item.value}</Text>
          <Text style={s.kpiLabel}>{item.label}</Text>
          {item.change ? (
            <Text
              style={{
                ...s.kpiChange,
                color: item.positive ? "#16a34a" : "#dc2626",
              }}
            >
              {item.positive ? "▲" : "▼"} {item.change}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

/** Detect if a cell value looks numeric (for right-alignment) */
function isNumeric(text: string): boolean {
  const cleaned = text.replace(/[$€£¥,\s%KES]/gi, "").trim();
  return cleaned.length > 0 && !isNaN(Number(cleaned));
}

/** Calculate relative column widths based on content, normalised to sum to 100% */
function calcColumnWidths(headers: string[], rows: string[][]): string[] {
  // Measure max character length per column (header or any data cell)
  const maxLens = headers.map((h, i) => {
    let max = h.length;
    for (const row of rows) {
      const cell = row[i] ?? "";
      if (cell.length > max) max = cell.length;
    }
    return max;
  });
  const total = maxLens.reduce((a, b) => a + b, 0) || 1;
  // Clamp each column to 8–45% of available width
  const clamped = maxLens.map((len) =>
    Math.max(8, Math.min(45, Math.round((len / total) * 100)))
  );
  // Normalise so columns always sum to exactly 100%
  const clampedTotal = clamped.reduce((a, b) => a + b, 0);
  const scale = 100 / clampedTotal;
  return clamped.map((p) => `${Math.round(p * scale)}%`);
}

/** Formatted data table */
export function DataTable({
  data,
  styles: s,
  tableIndex,
}: {
  data: TableData;
  styles: ReturnType<typeof createStyles>;
  tableIndex?: number;
}) {
  const widths = calcColumnWidths(data.headers, data.rows);

  return (
    <View style={s.table}>
      {/* Header row */}
      <View style={s.tableHeaderRow}>
        {data.headers.map((h, i) => (
          <Text
            key={i}
            style={{
              ...s.tableHeaderCell,
              width: widths[i],
              textAlign: isNumeric(h) ? "right" : "left",
            }}
          >
            {h}
          </Text>
        ))}
      </View>

      {/* Data rows */}
      {data.rows.map((row, rowIdx) => (
        <View
          key={rowIdx}
          style={[s.tableRow, rowIdx % 2 === 1 ? s.tableRowStripe : {}]}
        >
          {row.map((cell, cellIdx) => (
            <Text
              key={cellIdx}
              style={{
                ...s.tableCell,
                width: widths[cellIdx] || "auto",
                ...(isNumeric(cell) ? s.tableCellNumeric : {}),
              }}
            >
              {cell}
            </Text>
          ))}
        </View>
      ))}

      {/* Caption */}
      {data.caption ? (
        <Text style={s.tableCaption}>{data.caption}</Text>
      ) : tableIndex != null ? (
        <Text style={s.tableCaption}>
          Table {tableIndex}: {data.headers.slice(0, 3).join(", ")}...
        </Text>
      ) : null}
    </View>
  );
}

/** Embedded chart image */
export function ChartFigure({
  chart,
  figureIndex,
  styles: s,
}: {
  chart: ChartImage;
  figureIndex?: number;
  styles: ReturnType<typeof createStyles>;
}) {
  const src = chart.data.startsWith("data:")
    ? chart.data
    : `data:image/png;base64,${chart.data}`;

  return (
    <View style={s.chartContainer} wrap={false}>
      <Image
        src={src}
        style={{
          ...s.chartImage,
          width: Math.min(chart.width ?? 500, 500),
          height: Math.min(chart.height ?? 300, 300),
        }}
      />
      <Text style={s.chartCaption}>
        {figureIndex != null ? `Figure ${figureIndex}: ` : ""}
        {chart.title}
      </Text>
    </View>
  );
}

// ── Markdown content rendering ─────────────────────────────

/**
 * Render a text line with inline bold/italic spans.
 * Splits on **bold** and *italic* markers.
 */
export function RichText({
  text,
  styles: s,
  style,
}: {
  text: string;
  styles: ReturnType<typeof createStyles>;
  style?: Style;
}) {
  // Split on **bold** and *italic* markers
  const parts: Array<{ text: string; bold?: boolean; italic?: boolean }> = [];
  let remaining = text;

  while (remaining.length > 0) {
    // Bold
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
    if (boldMatch && boldMatch.index !== undefined) {
      if (boldMatch.index > 0) {
        parts.push({ text: remaining.substring(0, boldMatch.index) });
      }
      parts.push({ text: boldMatch[1], bold: true });
      remaining = remaining.substring(boldMatch.index + boldMatch[0].length);
      continue;
    }
    // Italic
    const italicMatch = remaining.match(/\*(.+?)\*/);
    if (italicMatch && italicMatch.index !== undefined) {
      if (italicMatch.index > 0) {
        parts.push({ text: remaining.substring(0, italicMatch.index) });
      }
      parts.push({ text: italicMatch[1], italic: true });
      remaining = remaining.substring(italicMatch.index + italicMatch[0].length);
      continue;
    }
    // Plain text
    parts.push({ text: remaining });
    break;
  }

  return (
    <Text style={style ? [s.paragraph, style] : s.paragraph}>
      {parts.map((part, i) => (
        <Text
          key={i}
          style={[
            part.bold ? s.bold : {},
            part.italic ? s.italic : {},
          ]}
        >
          {part.text}
        </Text>
      ))}
    </Text>
  );
}

/** Render a bullet point with accent-colored dot */
export function BulletItem({
  text,
  styles: s,
}: {
  text: string;
  styles: ReturnType<typeof createStyles>;
}) {
  const content = text.replace(/^[•\-*]\s*/, "");
  return (
    <View style={s.bullet}>
      <Text style={s.bulletDot}>•</Text>
      <RichText text={content} styles={s} style={s.bulletText} />
    </View>
  );
}

/**
 * Render a full section (heading + text + tables + charts).
 * Handles mixed content intelligently.
 */
export function Section({
  section,
  branding,
  styles: s,
  tableStartIndex,
  chartStartIndex,
}: {
  section: ParsedSection;
  branding: Branding;
  styles: ReturnType<typeof createStyles>;
  tableStartIndex: number;
  chartStartIndex: number;
}) {
  // Filter out table lines from text content
  const textLines = section.lines.filter(
    (l) => !l.trim().startsWith("|") && l.trim().length > 0
  );

  return (
    <View>
      {/* Section heading */}
      {section.heading ? (
        <Text style={section.level === 2 ? s.h2 : s.h3}>
          {section.heading}
        </Text>
      ) : null}

      {/* Text content */}
      {textLines.map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return null;

        // Bullet points
        if (/^[•\-*]\s+/.test(trimmed)) {
          return <BulletItem key={`t-${i}`} text={trimmed} styles={s} />;
        }

        // Numbered lists
        if (/^\d+[\.\)]\s+/.test(trimmed)) {
          return (
            <View key={`t-${i}`} style={s.bullet}>
              <Text style={{ ...s.bulletDot, width: 18 }}>
                {trimmed.match(/^\d+/)?.[0]}.
              </Text>
              <RichText
                text={trimmed.replace(/^\d+[\.\)]\s+/, "")}
                styles={s}
                style={s.bulletText}
              />
            </View>
          );
        }

        // Regular paragraph
        return <RichText key={`t-${i}`} text={trimmed} styles={s} />;
      })}

      {/* Tables */}
      {section.tables.map((table, i) => (
        <DataTable
          key={`tbl-${i}`}
          data={table}
          styles={s}
          tableIndex={tableStartIndex + i + 1}
        />
      ))}

      {/* Inline charts */}
      {section.charts.map((chart, i) => (
        <ChartFigure
          key={`ch-${i}`}
          chart={chart}
          figureIndex={chartStartIndex + i + 1}
          styles={s}
        />
      ))}
    </View>
  );
}
