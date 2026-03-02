/**
 * React-PDF Render Engine
 *
 * Replaces the pdf-lib manual positioning engine with @react-pdf/renderer.
 * Parses markdown report content into structured sections, then renders
 * via JSX templates with Yoga flexbox layout.
 *
 * Entry point: renderPdf(input, branding, charts, reportCfg) → Buffer
 */

import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { getAllSettings, getReportSettings } from "@services/settings";
import type { ChartSpec } from "@lib/charts";

import { GenericReport } from "./pdf-templates/generic-report";
import type {
  Branding,
  ReportMeta,
  ParsedSection,
  TableData,
  ChartImage,
} from "./pdf-templates/shared";

// Re-export types for external use
export type { Branding, ReportMeta, ParsedSection, TableData, ChartImage };

// ── Markdown Parsing ───────────────────────────────────────

/**
 * Parse a pipe-delimited markdown table line into cell values.
 */
function parseTableLine(line: string): string[] {
  return line
    .split("|")
    .map((c) => c.trim())
    .filter((c) => c.length > 0 && !/^[-:]+$/.test(c));
}

/**
 * Check if a line is a markdown table separator (e.g. |---|---|).
 */
function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return false;
  const cells = trimmed.split("|").filter((c) => c.trim().length > 0);
  return cells.every((c) => /^[-:]+$/.test(c.trim()));
}

/**
 * Extract ALL markdown tables from an array of lines.
 */
function extractTables(lines: string[]): TableData[] {
  const tables: TableData[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();
    if (line.startsWith("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const headers = parseTableLine(lines[i]);
      i += 2; // Skip header + separator
      const rows: string[][] = [];
      while (i < lines.length) {
        const rowLine = lines[i].trim();
        if (!rowLine.startsWith("|")) break;
        if (i + 1 < lines.length && isTableSeparator(lines[i + 1])) break;
        if (isTableSeparator(lines[i])) { i++; continue; }
        rows.push(parseTableLine(lines[i]));
        i++;
      }
      if (headers.length > 0 && rows.length > 0) {
        tables.push({ headers, rows });
      }
    } else {
      i++;
    }
  }
  return tables;
}

/**
 * Strip LLM-generated metadata lines (h1, "Prepared for:", "Date:")
 * since the template renders its own title page.
 */
function stripLlmMetadata(content: string): string {
  const lines = content.split("\n");
  const cleaned: string[] = [];
  let foundFirstH2 = false;

  for (const line of lines) {
    if (/^#\s+/.test(line) && !foundFirstH2) continue;
    if (/^\*{0,2}Prepared\s+for:/i.test(line)) continue;
    if (/^\*{0,2}Date:/i.test(line) && !foundFirstH2) continue;
    if (/^---+\s*$/.test(line) && !foundFirstH2) continue;
    if (/^##\s+/.test(line)) foundFirstH2 = true;
    cleaned.push(line);
  }

  while (cleaned.length > 0 && cleaned[0].trim() === "") cleaned.shift();
  return cleaned.join("\n");
}

/**
 * Parse markdown content into structured sections for the JSX template.
 * Each section gets its heading, text lines, extracted tables, and
 * any inline charts that were associated with that section.
 */
function parseMarkdownToSections(
  content: string,
  chartsBySection?: Map<string, ChartImage[]>
): ParsedSection[] {
  const cleaned = stripLlmMetadata(content);
  const lines = cleaned.split("\n");
  const sections: ParsedSection[] = [];
  let current: { heading: string; level: number; lines: string[] } = {
    heading: "",
    level: 0,
    lines: [],
  };

  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+)/);
    const h3 = line.match(/^###\s+(.+)/);

    if (h2) {
      if (current.heading || current.lines.length > 0) {
        sections.push(finishSection(current, chartsBySection));
      }
      current = { heading: h2[1].trim(), level: 2, lines: [] };
    } else if (h3) {
      if (current.heading || current.lines.length > 0) {
        sections.push(finishSection(current, chartsBySection));
      }
      current = { heading: h3[1].trim(), level: 3, lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.heading || current.lines.length > 0) {
    sections.push(finishSection(current, chartsBySection));
  }

  return sections;
}

function finishSection(
  raw: { heading: string; level: number; lines: string[] },
  chartsBySection?: Map<string, ChartImage[]>
): ParsedSection {
  return {
    heading: raw.heading,
    level: raw.level,
    lines: raw.lines,
    tables: extractTables(raw.lines),
    charts: chartsBySection?.get(raw.heading) ?? [],
  };
}

// ── Chart block extraction ─────────────────────────────────

/**
 * Extract ```chart JSON blocks from markdown, tracking which section
 * each chart belongs to. Returns cleaned content + section→chart map.
 */
export function extractChartBlocks(content: string): {
  content: string;
  chartsBySection: Map<string, ChartSpec[]>;
} {
  const lines = content.split("\n");
  const cleanedLines: string[] = [];
  const chartsBySection = new Map<string, ChartSpec[]>();
  let currentHeading = "";
  let inBlock = false;
  let blockLines: string[] = [];

  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+)/);
    const h3 = line.match(/^###\s+(.+)/);
    if (h2) currentHeading = h2[1].trim();
    else if (h3) currentHeading = h3[1].trim();

    if (!inBlock && /^```chart/i.test(line.trim())) {
      inBlock = true;
      blockLines = [];
    } else if (inBlock && line.trim() === "```") {
      inBlock = false;
      try {
        const spec = JSON.parse(blockLines.join("\n").trim()) as ChartSpec;
        if (spec.type && spec.data && Array.isArray(spec.data)) {
          const existing = chartsBySection.get(currentHeading) ?? [];
          existing.push(spec);
          chartsBySection.set(currentHeading, existing);
        }
      } catch { /* skip invalid JSON */ }
      blockLines = [];
    } else if (inBlock) {
      blockLines.push(line);
    } else {
      cleanedLines.push(line);
    }
  }

  return { content: cleanedLines.join("\n").trim(), chartsBySection };
}

// ── Branding loader ────────────────────────────────────────

export async function loadBranding(): Promise<Branding> {
  const settings = await getAllSettings();
  return {
    companyName: settings.businessName || "Business IQ",
    logoUrl: settings.businessLogoUrl || "",
    primaryColor: settings.primaryColor || "#3b82f6",
    tagline: settings.businessTagline || "",
  };
}

// ── Main render function ───────────────────────────────────

export interface PdfRenderInput {
  /** Report content (markdown, chart blocks already stripped by caller) */
  content: string;
  /** Report title */
  title: string;
  /** Optional subtitle */
  subtitle?: string;
  /** Name of preparer */
  preparedBy?: string;
  /**
   * Section heading → chart images for inline placement.
   * Built by the caller (report-export.ts) from chart position metadata + rendered PNGs.
   * Omit or pass an empty Map when charts are disabled.
   */
  chartsBySection?: Map<string, ChartImage[]>;
  /**
   * Charts not belonging to any section — rendered at end of report.
   * Includes unpositioned Vega-Lite renders and Python pre-rendered images.
   */
  orphanCharts?: ChartImage[];
}

/**
 * Render a report to PDF using @react-pdf/renderer.
 *
 * This is the primary PDF generation function. It:
 * 1. Loads branding from business_settings
 * 2. Parses markdown content into structured sections
 * 3. Maps charts to their respective sections
 * 4. Renders a JSX template with Yoga flexbox layout
 * 5. Returns a Buffer containing the PDF
 */
export async function renderPdf(input: PdfRenderInput): Promise<Buffer> {
  const [branding, reportCfg] = await Promise.all([loadBranding(), getReportSettings()]);

  // Content has chart blocks already stripped by the caller (report-export.ts).
  // Use the pre-built maps rather than re-parsing — re-parsing cleaned content
  // would find nothing and silently drop all section→chart associations.
  const chartImagesBySection = input.chartsBySection ?? new Map<string, ChartImage[]>();
  const orphanCharts = input.orphanCharts ?? [];

  const sections = parseMarkdownToSections(input.content, chartImagesBySection);

  const meta: ReportMeta = {
    title: input.title,
    subtitle: input.subtitle,
    preparedBy: input.preparedBy,
    generatedAt: new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
    confidentialFooter: reportCfg.confidentialFooter,
  };

  const buffer = await renderToBuffer(
    <GenericReport
      branding={branding}
      meta={meta}
      sections={sections}
      orphanCharts={orphanCharts}
      showTitlePage={reportCfg.titlePage}
      showToc={reportCfg.tocPage}
    />
  );

  return Buffer.from(buffer);
}
