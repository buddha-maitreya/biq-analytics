/**
 * Report Export Library — converts markdown/text reports into binary formats.
 *
 * Supports: PDF, Excel (XLSX), PowerPoint (PPTX).
 * All libraries are pure TypeScript — no native dependencies, works in Bun.
 *
 * PDF generation uses @react-pdf/renderer (JSX templates, Yoga flexbox layout,
 * WASM-based rendering — magazine-quality output with zero native dependencies).
 * See pdf-engine.tsx and pdf-templates/ for the rendering pipeline.
 *
 * Generated files are stored in S3 (object storage) and returned as
 * presigned download URLs with configurable expiry.
 *
 * Branding (company name, logo, colors) is pulled from business_settings
 * and applied to headers/footers/title slides automatically.
 */

import ExcelJS from "exceljs";
import PptxGenJS from "pptxgenjs";
import * as objectStorage from "@services/object-storage";
import { getAllSettings, getReportSettings } from "@services/settings";
import type { ReportSettings } from "@services/settings";
import { renderCharts, toPptxChartData } from "@lib/charts";
import type { ChartSpec, RenderedChart } from "@lib/charts";
import { renderPdf, type ChartImage } from "@lib/pdf-engine";

// ── Types ──────────────────────────────────────────────────

export type ExportFormat = "pdf" | "xlsx" | "pptx";

/** A pre-rendered chart image (e.g. from Python analytics sandbox). */
export interface PreRenderedImage {
  /** Chart title */
  title: string;
  /** Base64-encoded image data (PNG) */
  data: string;
  /** Image width in pixels (default: 800) */
  width?: number;
  /** Image height in pixels (default: 500) */
  height?: number;
}

export interface ExportInput {
  /** The report content (markdown or plain text) */
  content: string;
  /** Report title */
  title: string;
  /** Output format */
  format: ExportFormat;
  /** Optional subtitle / report type label */
  subtitle?: string;
  /** Optional structured data for Excel/tables (array of objects) */
  tableData?: Record<string, unknown>[];
  /** Name of the person who prepared the report (logged-in user) */
  preparedBy?: string;
  /** Optional chart specifications to render and embed in the export */
  charts?: ChartSpec[];
  /**
   * Pre-rendered chart images (e.g. matplotlib PNGs from Python analytics).
   * These bypass Vega-Lite rendering and are embedded directly as images.
   * Merged with Vega-Lite charts — pre-rendered images appear AFTER Vega-Lite charts.
   */
  preRenderedImages?: PreRenderedImage[];
}

export interface ExportResult {
  /** Presigned download URL (expires in 1 hour) */
  downloadUrl: string;
  /** S3 storage key */
  storageKey: string;
  /** File size in bytes */
  sizeBytes: number;
  /** Original filename */
  filename: string;
  /** MIME type */
  contentType: string;
  /** Format used */
  format: ExportFormat;
}

interface Branding {
  companyName: string;
  logoUrl: string;
  primaryColor: string;
  tagline: string;
}

// ── S3 namespace ───────────────────────────────────────────

const exportStorage = objectStorage.namespace("report-exports");

// ── Temp export cache (fallback when S3 is unavailable) ────
/** In-memory cache for exports when S3 isn't available. Entries expire after 1 hour. */
interface TempExport {
  buffer: Buffer;
  contentType: string;
  filename: string;
  expiresAt: number;
}
export const tempExportCache = new Map<string, TempExport>();

function cleanTempCache() {
  const now = Date.now();
  for (const [key, val] of tempExportCache) {
    if (val.expiresAt < now) tempExportCache.delete(key);
  }
}

// ── Branding loader ────────────────────────────────────────

async function loadBranding(): Promise<Branding> {
  const settings = await getAllSettings();
  return {
    companyName: settings.businessName || "Business IQ",
    logoUrl: settings.businessLogoUrl || "",
    primaryColor: settings.primaryColor || "#3b82f6",
    tagline: settings.businessTagline || "",
  };
}

// ── Markdown parsing helpers ───────────────────────────────

interface ParsedSection {
  heading: string;
  level: number;
  lines: string[];
}

/**
 * Parse markdown content into structured sections.
 * Splits on ## and ### headers, preserving content under each.
 */
function parseMarkdown(content: string): ParsedSection[] {
  const lines = content.split("\n");
  const sections: ParsedSection[] = [];
  let current: ParsedSection = { heading: "", level: 0, lines: [] };

  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+)/);
    const h3 = line.match(/^###\s+(.+)/);

    if (h2) {
      if (current.heading || current.lines.length > 0) sections.push(current);
      current = { heading: h2[1].trim(), level: 2, lines: [] };
    } else if (h3) {
      if (current.heading || current.lines.length > 0) sections.push(current);
      current = { heading: h3[1].trim(), level: 3, lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.heading || current.lines.length > 0) sections.push(current);
  return sections;
}

/**
 * Parse a single pipe-delimited line into cell values.
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
 * Extract ALL markdown tables from lines.
 * Handles multiple tables within a single section by detecting
 * header+separator boundaries.
 */
function extractTables(lines: string[]): { headers: string[]; rows: string[][] }[] {
  const tables: { headers: string[]; rows: string[][] }[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();
    // Look for a table header: a pipe-line followed by a separator line
    if (line.startsWith("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const headers = parseTableLine(lines[i]);
      i += 2; // Skip header + separator
      const rows: string[][] = [];
      // Collect data rows until we hit a non-pipe line or a new separator (new table)
      while (i < lines.length) {
        const rowLine = lines[i].trim();
        if (!rowLine.startsWith("|")) break;
        // If this line is followed by a separator, it's a new table header — stop
        if (i + 1 < lines.length && isTableSeparator(lines[i + 1])) break;
        // Skip standalone separators between tables
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
 * Legacy single-table extraction (backwards compat).
 */
function extractTable(lines: string[]): { headers: string[]; rows: string[][] } | null {
  const tables = extractTables(lines);
  return tables.length > 0 ? tables[0] : null;
}

/**
 * Strip markdown formatting for plain text rendering.
 */
function stripMd(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/^[-*]\s+/gm, "• ")
    .replace(/^\d+\.\s+/gm, (m) => m)
    .trim();
}

// ── Logo Fetch (shared by PPTX) ───────────────────────────

/**
 * Fetch a logo image from a URL and return raw bytes + detected format.
 * Returns null if the URL is empty, unreachable, or the format is unsupported.
 */
async function fetchLogoImage(
  url: string
): Promise<{ bytes: Uint8Array; format: "png" | "jpg" } | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length < 8) return null;

    // Detect format from content-type or magic bytes
    if (ct.includes("png") || (buf[0] === 0x89 && buf[1] === 0x50)) {
      return { bytes: buf, format: "png" };
    }
    if (ct.includes("jpeg") || ct.includes("jpg") || (buf[0] === 0xff && buf[1] === 0xd8)) {
      return { bytes: buf, format: "jpg" };
    }
    // SVG / WebP / other unsupported formats — skip silently
    return null;
  } catch {
    // Network error, timeout, etc. — non-critical, skip logo
    return null;
  }
}

// ── Excel Export ───────────────────────────────────────────

async function exportXlsx(input: ExportInput, branding: Branding, charts: RenderedChart[] = []): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = branding.companyName;
  workbook.created = new Date();

  const color = branding.primaryColor.replace("#", "");

  // ── Summary sheet ──
  const summary = workbook.addWorksheet("Report Summary", {
    properties: { tabColor: { argb: color } },
  });

  // Title row
  summary.mergeCells("A1:F1");
  const titleCell = summary.getCell("A1");
  titleCell.value = `${branding.companyName} — ${input.title}`;
  titleCell.font = { size: 18, bold: true, color: { argb: "FF" + color } };
  titleCell.alignment = { horizontal: "left" };

  // Subtitle
  if (input.subtitle) {
    summary.mergeCells("A2:F2");
    const subCell = summary.getCell("A2");
    subCell.value = input.subtitle;
    subCell.font = { size: 12, color: { argb: "FF888888" } };
  }

  // Date
  summary.mergeCells("A3:F3");
  const dateCell = summary.getCell("A3");
  dateCell.value = `Generated: ${new Date().toLocaleDateString()}`;
  dateCell.font = { size: 10, color: { argb: "FFAAAAAA" } };

  // Prepared by
  if (input.preparedBy) {
    summary.mergeCells("A4:F4");
    const prepCell = summary.getCell("A4");
    prepCell.value = `Prepared by: ${input.preparedBy}`;
    prepCell.font = { size: 10, color: { argb: "FF888888" } };
  }

  // Content as rows (each section as a block)
  const sections = parseMarkdown(input.content);
  let row = 6;

  for (const section of sections) {
    if (section.heading) {
      summary.mergeCells(`A${row}:F${row}`);
      const headCell = summary.getCell(`A${row}`);
      headCell.value = section.heading;
      headCell.font = {
        size: section.level === 2 ? 14 : 12,
        bold: true,
        color: { argb: "FF" + color },
      };
      row++;
    }

    // Check for table data in this section (handles multiple tables)
    const tables = extractTables(section.lines);
    for (const table of tables) {
      // Header row
      table.headers.forEach((h, col) => {
        const cell = summary.getCell(row, col + 1);
        cell.value = h;
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + color } };
        cell.border = {
          bottom: { style: "thin", color: { argb: "FF" + color } },
        };
      });
      row++;

      // Data rows
      for (const dataRow of table.rows) {
        dataRow.forEach((val, col) => {
          const cell = summary.getCell(row, col + 1);
          // Try to parse numbers
          const num = Number(val.replace(/[,$%]/g, ""));
          cell.value = isNaN(num) || val.trim() === "" ? val : num;
          if (row % 2 === 0) {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F7FA" } };
          }
        });
        row++;
      }
      row++; // spacing after table
    }

    // Text content
    const textLines = section.lines.filter(
      (l) => !l.trim().startsWith("|") && l.trim().length > 0
    );
    for (const line of textLines) {
      const clean = stripMd(line);
      if (!clean) continue;
      summary.mergeCells(`A${row}:F${row}`);
      const cell = summary.getCell(`A${row}`);
      cell.value = clean;
      cell.font = { size: 10 };
      cell.alignment = { wrapText: true };
      row++;
    }
    row++; // section spacing
  }

  // Auto-size columns based on content (max 50, min 12)
  summary.columns.forEach((col: Partial<ExcelJS.Column>, idx: number) => {
    let maxLen = 12;
    summary.getColumn(idx + 1).eachCell({ includeEmpty: false }, (cell) => {
      const val = cell.value != null ? String(cell.value) : "";
      if (val.length > maxLen) maxLen = val.length;
    });
    col.width = Math.min(maxLen + 4, 50);
  });

  // Freeze the title/header rows so data scrolls under them
  summary.views = [{ state: "frozen", xSplit: 0, ySplit: 5 }];

  // ── Charts sheet (if chart images available) ──
  if (charts.length > 0) {
    const chartSheet = workbook.addWorksheet("Charts", {
      properties: { tabColor: { argb: color } },
    });
    let chartRow = 1;
    for (const chart of charts) {
      // Title row
      chartSheet.mergeCells(`A${chartRow}:H${chartRow}`);
      const titleCell = chartSheet.getCell(`A${chartRow}`);
      titleCell.value = chart.title;
      titleCell.font = { bold: true, size: 13, color: { argb: "FF" + color } };
      chartRow++;

      // Embed chart image
      try {
        const imgId = workbook.addImage({ buffer: Buffer.from(chart.png) as any, extension: "png" });
        chartSheet.addImage(imgId, {
          tl: { col: 0, row: chartRow - 1 } as any,
          ext: { width: Math.min(chart.width, 700), height: Math.min(chart.height, 400) },
        });
        chartRow += Math.ceil(Math.min(chart.height, 400) / 20) + 2;
      } catch {
        // Chart image failed — skip
      }
    }
  }

  // ── Data sheet (if structured data provided) ──
  if (input.tableData && input.tableData.length > 0) {
    const dataSheet = workbook.addWorksheet("Data", {
      properties: { tabColor: { argb: color } },
    });

    const headers = Object.keys(input.tableData[0]);

    // Header row
    headers.forEach((h, idx) => {
      const cell = dataSheet.getCell(1, idx + 1);
      cell.value = h;
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + color } };
    });

    // Data rows
    input.tableData.forEach((record, rowIdx) => {
      headers.forEach((h, colIdx) => {
        const cell = dataSheet.getCell(rowIdx + 2, colIdx + 1);
        const val = record[h];
        cell.value = typeof val === "number" ? val : String(val ?? "");
        if (rowIdx % 2 === 1) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F7FA" } };
        }
      });
    });

    // Auto-size columns
    dataSheet.columns.forEach((col: Partial<ExcelJS.Column>, idx: number) => {
      let maxLen = 10;
      dataSheet.getColumn(idx + 1).eachCell({ includeEmpty: false }, (cell) => {
        const val = cell.value != null ? String(cell.value) : "";
        if (val.length > maxLen) maxLen = val.length;
      });
      col.width = Math.min(maxLen + 4, 50);
    });

    // Freeze header row
    dataSheet.views = [{ state: "frozen", xSplit: 0, ySplit: 1 }];
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ── PowerPoint Export ──────────────────────────────────────

async function exportPptx(input: ExportInput, branding: Branding, charts: RenderedChart[] = [], chartSpecs: ChartSpec[] = []): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.author = branding.companyName;
  pptx.title = input.title;
  pptx.company = branding.companyName;

  const color = branding.primaryColor;
  const sections = parseMarkdown(input.content);

  // ── Title slide ──
  const titleSlide = pptx.addSlide();
  titleSlide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: "100%",
    h: "100%",
    fill: { color: color.replace("#", "") },
  });

  titleSlide.addText(branding.companyName, {
    x: 0.5,
    y: 0.5,
    w: 9,
    h: 0.8,
    fontSize: 16,
    color: "FFFFFF",
    bold: true,
    fontFace: "Calibri",
  });

  // Company logo (top-right corner of title slide)
  const pptxLogo = await fetchLogoImage(branding.logoUrl);
  if (pptxLogo) {
    try {
      const b64 = Buffer.from(pptxLogo.bytes).toString("base64");
      const mimeType = pptxLogo.format === "png" ? "image/png" : "image/jpeg";
      titleSlide.addImage({
        data: `data:${mimeType};base64,${b64}`,
        x: 7.5,
        y: 0.3,
        w: 1.8,
        h: 1.0,
        sizing: { type: "contain", w: 1.8, h: 1.0 },
      });
    } catch {
      // Logo embed failed — skip silently
    }
  }

  titleSlide.addText(input.title, {
    x: 0.5,
    y: 2.0,
    w: 9,
    h: 1.5,
    fontSize: 36,
    color: "FFFFFF",
    bold: true,
    fontFace: "Calibri",
  });

  if (input.subtitle) {
    titleSlide.addText(input.subtitle, {
      x: 0.5,
      y: 3.5,
      w: 9,
      h: 0.6,
      fontSize: 18,
      color: "DDDDDD",
      fontFace: "Calibri",
    });
  }

  titleSlide.addText(
    `Generated: ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`,
    {
      x: 0.5,
      y: 4.2,
      w: 9,
      h: 0.4,
      fontSize: 12,
      color: "CCCCCC",
      fontFace: "Calibri",
    }
  );

  if (input.preparedBy) {
    titleSlide.addText(`Prepared by: ${input.preparedBy}`, {
      x: 0.5,
      y: 4.6,
      w: 9,
      h: 0.4,
      fontSize: 12,
      color: "CCCCCC",
      fontFace: "Calibri",
    });
  }

  if (branding.tagline) {
    titleSlide.addText(branding.tagline, {
      x: 0.5,
      y: 5.0,
      w: 9,
      h: 0.4,
      fontSize: 11,
      color: "BBBBBB",
      italic: true,
      fontFace: "Calibri",
    });
  }

  // ── Table of Contents slide ──
  const tocSlide = pptx.addSlide();
  tocSlide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: "100%",
    h: 0.8,
    fill: { color: color.replace("#", "") },
  });
  tocSlide.addText("Table of Contents", {
    x: 0.3,
    y: 0.15,
    w: 6,
    h: 0.5,
    fontSize: 14,
    color: "FFFFFF",
    bold: true,
    fontFace: "Calibri",
  });
  const tocItems = sections
    .filter((s) => s.heading && s.level === 2)
    .map((s, i) => ({
      text: `${i + 1}. ${s.heading}`,
      options: { fontSize: 14, color: "444444" as const, fontFace: "Calibri" as const, bullet: false as const, breakLine: true as const },
    }));
  if (tocItems.length > 0) {
    tocSlide.addText(tocItems, {
      x: 0.7,
      y: 1.2,
      w: 8.5,
      h: 4.0,
      valign: "top",
      fontSize: 14,
    });
  }
  tocSlide.addText(`${branding.companyName} — Confidential`, {
    x: 0.3,
    y: 5.2,
    w: 5,
    h: 0.3,
    fontSize: 8,
    color: "AAAAAA",
    fontFace: "Calibri",
  });

  // ── Content slides ── (one per section)
  for (const section of sections) {
    if (!section.heading && section.lines.every((l) => !l.trim())) continue;

    const slide = pptx.addSlide();

    // Header bar
    slide.addShape(pptx.ShapeType.rect, {
      x: 0,
      y: 0,
      w: "100%",
      h: 0.8,
      fill: { color: color.replace("#", "") },
    });

    slide.addText(branding.companyName, {
      x: 0.3,
      y: 0.15,
      w: 4,
      h: 0.5,
      fontSize: 11,
      color: "FFFFFF",
      bold: true,
      fontFace: "Calibri",
    });

    // Section heading
    if (section.heading) {
      slide.addText(section.heading, {
        x: 0.5,
        y: 1.0,
        w: 9,
        h: 0.6,
        fontSize: section.level === 2 ? 24 : 20,
        color: color.replace("#", ""),
        bold: true,
        fontFace: "Calibri",
      });
    }

    // Check for tables
    const tables = extractTables(section.lines);
    const table = tables.length > 0 ? tables[0] : null;
    let tableYEnd = 1.8; // Track where tables end for text positioning

    for (let ti = 0; ti < tables.length; ti++) {
      const tbl = tables[ti];
      const tblY = 1.8 + ti * 2.2; // Stack tables vertically
      const tableRows: PptxGenJS.TableRow[] = [
        // Header
        tbl.headers.map((h) => ({
          text: h,
          options: {
            bold: true,
            color: "FFFFFF",
            fill: { color: color.replace("#", "") },
            fontSize: 10,
            fontFace: "Calibri",
          },
        })),
        // Data
        ...tbl.rows.map((row, rowIdx) =>
          row.map((cell) => ({
            text: cell,
            options: {
              fontSize: 9,
              fontFace: "Calibri",
              fill: rowIdx % 2 === 1 ? { color: "F5F7FA" } : undefined,
            },
          }))
        ),
      ];

      slide.addTable(tableRows, {
        x: 0.5,
        y: tblY,
        w: 9,
        fontSize: 9,
        border: { type: "solid", pt: 0.5, color: "DDDDDD" },
      });
      tableYEnd = tblY + Math.min(tbl.rows.length * 0.3, 2.0) + 0.5;
    }

    // Text content (below heading or table)
    const textLines = section.lines
      .filter((l) => !l.trim().startsWith("|") && l.trim().length > 0)
      .map((l) => stripMd(l))
      .filter(Boolean);

    if (textLines.length > 0) {
      const yPos = table ? tableYEnd : 1.8;
      const bulletText = textLines.map((line) => ({
        text: line,
        options: {
          fontSize: 12,
          color: "444444",
          fontFace: "Calibri" as const,
          bullet: line.startsWith("• ") ? true : false,
          breakLine: true,
        },
      }));

      slide.addText(bulletText, {
        x: 0.5,
        y: yPos,
        w: 9,
        h: 3.5,
        valign: "top",
        fontSize: 12,
      });
    }

    // Footer
    slide.addText(`${branding.companyName} — Confidential`, {
      x: 0.3,
      y: 5.2,
      w: 5,
      h: 0.3,
      fontSize: 8,
      color: "AAAAAA",
      fontFace: "Calibri",
    });
  }

  // ── Chart slides ──
  if (charts.length > 0 || chartSpecs.length > 0) {
    // Map of native PptxGenJS chart types
    const nativeChartTypes: Record<string, string> = {
      bar: "bar",
      line: "line",
      area: "area",
      pie: "pie",
      donut: "doughnut",
      scatter: "scatter",
      grouped_bar: "bar",
      stacked_bar: "bar",
    };

    for (let i = 0; i < Math.max(charts.length, chartSpecs.length); i++) {
      const chart = charts[i];
      const spec = chartSpecs[i];

      const chartSlide = pptx.addSlide();

      // Slide title bar
      chartSlide.addShape("rect" as any, {
        x: 0, y: 0, w: "100%", h: 0.5,
        fill: { color: color.replace("#", "") },
      });
      chartSlide.addText(chart?.title ?? spec?.title ?? "Chart", {
        x: 0.5, y: 0.05, w: 9, h: 0.4,
        fontSize: 16, bold: true, color: "FFFFFF", fontFace: "Calibri",
      });

      // Try native PPTX chart first (editable in PowerPoint)
      if (spec && nativeChartTypes[spec.type]) {
        try {
          const pptxData = toPptxChartData(spec);
          if (!pptxData) throw new Error("Unsupported chart type for native PPTX");
          const pptxChartType = nativeChartTypes[spec.type]?.toUpperCase();
          chartSlide.addChart(
            pptxChartType as any,
            pptxData.data as any,
            {
              x: 0.5, y: 0.7, w: 9, h: 4.5,
              showTitle: false,
              showValue: (pptxData.options?.showValue as boolean) ?? false,
              showLegend: (pptxData.options?.showLegend as boolean) ?? true,
              legendPos: "b",
              ...(pptxData.options?.barDir ? { barDir: pptxData.options.barDir as string } : {}),
              ...(pptxData.options?.barGrouping ? { barGrouping: pptxData.options.barGrouping as string } : {}),
            }
          );
          // Footer
          chartSlide.addText(`${branding.companyName} — Confidential`, {
            x: 0.3, y: 5.2, w: 5, h: 0.3, fontSize: 8, color: "AAAAAA", fontFace: "Calibri",
          });
          continue; // Native chart added successfully
        } catch {
          // Fall through to image fallback
        }
      }

      // Fallback: embed chart as PNG image
      if (chart) {
        try {
          const b64 = chart.png.toString("base64");
          chartSlide.addImage({
            data: `data:image/png;base64,${b64}`,
            x: 0.5, y: 0.7, w: 9, h: 4.5,
            sizing: { type: "contain", w: 9, h: 4.5 },
          });
        } catch {
          chartSlide.addText("Chart could not be rendered", {
            x: 1, y: 2.5, w: 8, h: 1, fontSize: 14, color: "999999", align: "center",
          });
        }
      }

      // Footer
      chartSlide.addText(`${branding.companyName} — Confidential`, {
        x: 0.3, y: 5.2, w: 5, h: 0.3, fontSize: 8, color: "AAAAAA", fontFace: "Calibri",
      });
    }
  }

  // Generate as base64 and convert
  const output = await pptx.write({ outputType: "base64" });
  return Buffer.from(output as string, "base64");
}

// ── Main export function ───────────────────────────────────

const CONTENT_TYPES: Record<ExportFormat, string> = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

const EXTENSIONS: Record<ExportFormat, string> = {
  pdf: "pdf",
  xlsx: "xlsx",
  pptx: "pptx",
};

// ── Chart block extraction ─────────────────────────────────

/**
 * Extract ```chart blocks while tracking which ## / ### section each chart
 * belongs to. Line-by-line parse preserves heading context so charts can be
 * placed inline in the PDF immediately after the section they describe.
 *
 * Returns:
 *   content       — markdown with chart blocks removed
 *   chartPositions — ordered list of { sectionHeading, spec } pairs
 */
function extractChartBlocksWithSectionPositions(content: string): {
  content: string;
  chartPositions: Array<{ sectionHeading: string; spec: ChartSpec }>;
} {
  const lines = content.split("\n");
  const cleanedLines: string[] = [];
  const chartPositions: Array<{ sectionHeading: string; spec: ChartSpec }> = [];
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
          chartPositions.push({ sectionHeading: currentHeading, spec });
        }
      } catch { /* skip invalid JSON */ }
      blockLines = [];
    } else if (inBlock) {
      blockLines.push(line);
    } else {
      cleanedLines.push(line);
    }
  }

  return { content: cleanedLines.join("\n").trim(), chartPositions };
}

/**
 * Extract ```chart JSON code blocks from markdown content.
 * Returns cleaned content (blocks removed) and parsed chart specs.
 *
 * Expected format in markdown:
 * ```chart
 * { "type": "bar", "title": "Revenue by Product", "data": [...], "xField": "product", "yField": "revenue" }
 * ```
 */
function extractChartBlocks(content: string): { content: string; charts: ChartSpec[] } {
  const charts: ChartSpec[] = [];
  const cleaned = content.replace(
    /```chart\s*\n([\s\S]*?)```/gi,
    (_match, jsonBlock: string) => {
      try {
        const spec = JSON.parse(jsonBlock.trim()) as ChartSpec;
        if (spec.type && spec.data && Array.isArray(spec.data)) {
          charts.push(spec);
        }
      } catch {
        // Invalid JSON — skip this block
      }
      return ""; // Remove the chart block from content
    }
  );
  return { content: cleaned.trim(), charts };
}

/**
 * Public wrapper for extractChartBlocks — used by the Python-first chart
 * pipeline to extract chart specs from markdown BEFORE calling exportReport(),
 * so they can be rendered via Python/matplotlib instead of Vega-Lite.
 */
export function extractChartBlocksFromContent(content: string): { content: string; charts: ChartSpec[] } {
  return extractChartBlocks(content);
}

/**
 * Export a report to a binary format, store in S3, and return a download URL.
 *
 * @param input - Report content, title, and desired format
 * @returns ExportResult with download URL, filename, and metadata
 */
export async function exportReport(input: ExportInput): Promise<ExportResult> {
  const branding = await loadBranding();
  const reportCfg = await getReportSettings();

  // ── Extract chart specs from markdown ```chart blocks + input.charts ──
  // Use section-aware extraction so charts can be placed inline in PDF.
  const { content: cleanContent, chartPositions } = extractChartBlocksWithSectionPositions(input.content);
  const extractedCharts = chartPositions.map((cp) => cp.spec);
  let allChartSpecs = [...extractedCharts, ...(input.charts ?? [])];

  // Respect report settings: disable charts or limit count/data points
  if (!reportCfg.chartsEnabled) {
    allChartSpecs = [];
  } else {
    // Limit number of charts
    if (allChartSpecs.length > reportCfg.maxCharts) {
      allChartSpecs = allChartSpecs.slice(0, reportCfg.maxCharts);
    }
    // Limit data points per chart — skip for temporal (time-series) charts
    // since slicing a daily trend series drops the most recent/extreme data points
    for (const spec of allChartSpecs) {
      if (spec.data && spec.data.length > reportCfg.maxChartDataPoints) {
        const t = spec.type.toLowerCase().replace(/[_\s-]+/g, "");
        const isTimeSeries = t === "line" || t === "area";
        if (!isTimeSeries) {
          spec.data = spec.data.slice(0, reportCfg.maxChartDataPoints);
        }
      }
    }
  }

  // ── Pre-render Vega-Lite charts to PNG/SVG ──
  let renderedCharts: RenderedChart[] = [];
  if (allChartSpecs.length > 0) {
    try {
      renderedCharts = await renderCharts(allChartSpecs, {
        brandColor: branding.primaryColor,
      });
    } catch (err) {
      console.error("[report-export] Chart rendering failed, continuing without charts:", err);
    }
  }
  // Record how many Vega-Lite renders we have BEFORE adding pre-rendered images.
  // This count is used to build chartsBySection: only Vega-Lite charts came
  // from content and have section-position metadata; pre-rendered images don't.
  const vegaLiteCount = renderedCharts.length;

  // ── Merge pre-rendered images (e.g. from Python analytics) ──
  if (input.preRenderedImages && input.preRenderedImages.length > 0) {
    for (const img of input.preRenderedImages) {
      try {
        const pngBuffer = Buffer.from(img.data, "base64");
        renderedCharts.push({
          png: pngBuffer,
          svg: "", // Pre-rendered — no SVG available
          title: img.title,
          width: img.width ?? 800,
          height: img.height ?? 500,
        });
      } catch (err) {
        console.error(`[report-export] Failed to decode pre-rendered image "${img.title}":`, err);
      }
    }
  }

  // ── Build section → chart map for inline PDF placement ──
  // Maps each section heading to the RenderedChart(s) that should appear
  // immediately after it. Only covers Vega-Lite charts extracted from the
  // markdown content — pre-rendered images have no section context and
  // remain as orphan charts rendered in the fallback section.
  const chartsBySection = new Map<string, RenderedChart[]>();
  // Use the count of content-extracted charts (first N chart positions,
  // capped by vegaLiteCount which may be < chartPositions.length if some
  // specs were dropped by maxCharts or failed to render).
  const positionedCount = Math.min(chartPositions.length, vegaLiteCount);
  for (let i = 0; i < positionedCount; i++) {
    const heading = chartPositions[i].sectionHeading;
    const existing = chartsBySection.get(heading) ?? [];
    existing.push(renderedCharts[i]);
    chartsBySection.set(heading, existing);
  }

  // Use cleaned content (chart blocks removed) for markdown parsing
  const exportInput = { ...input, content: cleanContent };

  // Generate the binary buffer
  let buffer: Buffer;
  switch (input.format) {
    case "pdf": {
      // Convert section→RenderedChart map to section→ChartImage for renderPdf.
      // chartsBySection was built above from the original content's chart positions —
      // we pass it pre-built so renderPdf doesn't need to re-parse already-cleaned content.
      const pdfChartsBySection = new Map<string, ChartImage[]>();
      for (const [heading, rcs] of chartsBySection.entries()) {
        pdfChartsBySection.set(heading, rcs.map((rc) => ({
          title: rc.title,
          data: Buffer.from(rc.png).toString("base64"),
          width: rc.width,
          height: rc.height,
        })));
      }
      // Orphan charts: Vega-Lite renders beyond the positioned count +
      // any pre-rendered images (already appended to renderedCharts above).
      const pdfOrphanCharts: ChartImage[] = renderedCharts.slice(positionedCount).map((rc) => ({
        title: rc.title,
        data: Buffer.from(rc.png).toString("base64"),
        width: rc.width,
        height: rc.height,
      }));
      buffer = await renderPdf({
        content: exportInput.content,
        title: input.title,
        subtitle: input.subtitle,
        preparedBy: input.preparedBy,
        chartsBySection: pdfChartsBySection,
        orphanCharts: pdfOrphanCharts,
      });
      break;
    }
    case "xlsx":
      buffer = await exportXlsx(exportInput, branding, renderedCharts);
      break;
    case "pptx":
      buffer = await exportPptx(exportInput, branding, renderedCharts, allChartSpecs);
      break;
    default:
      throw new Error(`Unsupported export format: ${input.format}`);
  }

  // Generate filename
  const sanitizedTitle = input.title
    .replace(/[^a-zA-Z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase()
    .substring(0, 60);
  const timestamp = new Date().toISOString().split("T")[0];
  const filename = `${sanitizedTitle}-${timestamp}.${EXTENSIONS[input.format]}`;
  const contentType = CONTENT_TYPES[input.format];
  const sizeBytes = buffer.length;

  // Try S3 storage; fall back to base64 data URL if S3 is unavailable or fails
  let downloadUrl: string;
  let storageKey = "";

  if (objectStorage.isAvailable()) {
    try {
      storageKey = `${timestamp}/${filename}`;
      await exportStorage.put(storageKey, buffer, {
        contentType,
        meta: {
          title: input.title,
          format: input.format,
          generatedAt: new Date().toISOString(),
          companyName: branding.companyName,
        },
      });
      downloadUrl = exportStorage.presign(storageKey, { expiresIn: 3600 });
    } catch (s3Err) {
      // S3 configured but operation failed — fall back to temp cache + API URL
      console.error("[report-export] S3 storage failed, using temp cache:", s3Err);
      const exportId = crypto.randomUUID();
      tempExportCache.set(exportId, { buffer, contentType, filename, expiresAt: Date.now() + 3_600_000 });
      cleanTempCache();
      downloadUrl = `/api/reports/download-temp/${exportId}`;
      storageKey = "";
    }
  } else {
    // S3 not configured — use temp cache + API URL
    const exportId = crypto.randomUUID();
    tempExportCache.set(exportId, { buffer, contentType, filename, expiresAt: Date.now() + 3_600_000 });
    cleanTempCache();
    downloadUrl = `/api/reports/download-temp/${exportId}`;
  }

  return {
    downloadUrl,
    storageKey: storageKey ? `report-exports/${storageKey}` : "",
    sizeBytes,
    filename,
    contentType,
    format: input.format,
  };
}

/** List all supported export formats */
export const EXPORT_FORMATS: { value: ExportFormat; label: string; icon: string; ext: string }[] = [
  { value: "pdf", label: "PDF Document", icon: "📄", ext: ".pdf" },
  { value: "xlsx", label: "Excel Spreadsheet", icon: "📊", ext: ".xlsx" },
  { value: "pptx", label: "PowerPoint Presentation", icon: "📽️", ext: ".pptx" },
];
