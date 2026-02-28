/**
 * Report Export Library — converts markdown/text reports into binary formats.
 *
 * Supports: PDF, Excel (XLSX), Word (DOCX), PowerPoint (PPTX).
 * All libraries are pure TypeScript — no native dependencies, works in Bun.
 *
 * PDF generation uses pdf-lib (pure TypeScript, zero browser globals).
 * Tables are rendered via a custom PdfTableRenderer with:
 *   - Branded header rows, alternating row stripes
 *   - Auto-calculated column widths, right-aligned numbers
 *   - Word wrap, cell padding, page-break awareness
 *
 * Generated files are stored in S3 (object storage) and returned as
 * presigned download URLs with configurable expiry.
 *
 * Branding (company name, logo, colors) is pulled from business_settings
 * and applied to headers/footers/title slides automatically.
 */

import { PDFDocument, StandardFonts, rgb, PageSizes } from "pdf-lib";
import type { PDFPage, PDFFont } from "pdf-lib";
import ExcelJS from "exceljs";
import PptxGenJS from "pptxgenjs";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  BorderStyle,
  WidthType,
  AlignmentType,
  Header,
  Footer,
  PageNumber,
  ImageRun,
} from "docx";
import * as objectStorage from "@services/object-storage";
import { getAllSettings, getReportSettings } from "@services/settings";
import type { ReportSettings } from "@services/settings";
import { renderCharts, toPptxChartData } from "@lib/charts";
import type { ChartSpec, RenderedChart } from "@lib/charts";

// ── Types ──────────────────────────────────────────────────

export type ExportFormat = "pdf" | "xlsx" | "docx" | "pptx";

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

/**
 * Strip LLM-generated metadata lines from markdown content.
 * The PDF template renders its own title page with title, date, company name,
 * so we remove the LLM's duplicate metadata to avoid it appearing on content pages.
 *
 * Strips: h1 headings, "Prepared for:", "Date:", standalone "---" dividers,
 * and any leading whitespace after removal.
 */
function stripLlmMetadata(content: string): string {
  const lines = content.split("\n");
  const cleaned: string[] = [];
  let foundFirstH2 = false;

  for (const line of lines) {
    // Skip h1 headings (LLM-generated report title — duplicate of title page)
    if (/^#\s+/.test(line) && !foundFirstH2) continue;
    // Skip "Prepared for:" lines
    if (/^\*{0,2}Prepared\s+for:/i.test(line)) continue;
    // Skip "Date:" lines at the top
    if (/^\*{0,2}Date:/i.test(line) && !foundFirstH2) continue;
    // Skip standalone horizontal rules before first content
    if (/^---+\s*$/.test(line) && !foundFirstH2) continue;
    // Track when we hit the first ## heading (real content starts)
    if (/^##\s+/.test(line)) foundFirstH2 = true;
    cleaned.push(line);
  }

  // Remove leading blank lines
  while (cleaned.length > 0 && cleaned[0].trim() === "") cleaned.shift();
  return cleaned.join("\n");
}

/**
 * Parse a hex color to RGB components.
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}

// ── PDF Table Renderer ─────────────────────────────────────

interface TableStyle {
  headerBg: { r: number; g: number; b: number };
  headerText: { r: number; g: number; b: number };
  stripeBg: { r: number; g: number; b: number };
  borderColor: { r: number; g: number; b: number };
  textColor: { r: number; g: number; b: number };
  fontSize: number;
  headerFontSize: number;
  cellPaddingX: number;
  cellPaddingY: number;
  borderWidth: number;
}

const DEFAULT_TABLE_STYLE: Omit<TableStyle, "headerBg"> = {
  headerText: { r: 1, g: 1, b: 1 },
  stripeBg: { r: 0.96, g: 0.97, b: 0.98 },
  borderColor: { r: 0.85, g: 0.87, b: 0.9 },
  textColor: { r: 0.24, g: 0.24, b: 0.24 },
  fontSize: 8.5,
  headerFontSize: 9,
  cellPaddingX: 6,
  cellPaddingY: 4,
  borderWidth: 0.4,
};

/**
 * Detect if a string looks like a number/currency for right-alignment.
 */
function isNumericCell(text: string): boolean {
  const cleaned = text.replace(/[$€£¥,\s%]/g, "").trim();
  return cleaned.length > 0 && !isNaN(Number(cleaned));
}

/**
 * Word-wrap text to fit within a given width.
 * Returns an array of lines.
 */
function wrapText(text: string, maxWidth: number, font: PDFFont, fontSize: number): string[] {
  if (!text || text.trim().length === 0) return [""];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const testWidth = font.widthOfTextAtSize(testLine, fontSize);
    if (testWidth > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines.length > 0 ? lines : [""];
}

/**
 * Calculate optimal column widths based on content.
 * Distributes space proportionally with min/max constraints.
 */
function calculateColumnWidths(
  headers: string[],
  rows: string[][],
  totalWidth: number,
  font: PDFFont,
  boldFont: PDFFont,
  style: TableStyle
): number[] {
  const colCount = headers.length;
  const padding = style.cellPaddingX * 2;

  // Measure natural width of each column
  const naturalWidths = headers.map((h, colIdx) => {
    let maxW = boldFont.widthOfTextAtSize(h, style.headerFontSize) + padding;
    for (const row of rows) {
      const cell = row[colIdx] ?? "";
      const cellW = font.widthOfTextAtSize(cell, style.fontSize) + padding;
      maxW = Math.max(maxW, cellW);
    }
    return maxW;
  });

  const totalNatural = naturalWidths.reduce((a, b) => a + b, 0);

  if (totalNatural <= totalWidth) {
    // Fits — distribute remaining space proportionally
    const extra = totalWidth - totalNatural;
    return naturalWidths.map((w) => w + (extra * w) / totalNatural);
  }

  // Doesn't fit — constrain proportionally, with min width
  const minColWidth = 40;
  return naturalWidths.map((w) =>
    Math.max(minColWidth, (w / totalNatural) * totalWidth)
  );
}

/**
 * Draw an elegant table on PDF pages with full borderlines.
 * Includes vertical column separators, outer frame, header accent.
 * Returns the Y position after the table (or on a new page).
 */
async function drawTable(
  doc: PDFDocument,
  page: PDFPage,
  y: number,
  headers: string[],
  rows: string[][],
  font: PDFFont,
  boldFont: PDFFont,
  style: TableStyle,
  margin: number,
  contentWidth: number,
  addPageFn: () => PDFPage
): Promise<{ page: PDFPage; y: number }> {
  let currentPage = page;
  let currentY = y;
  const pageHeight = currentPage.getHeight();
  const bottomMargin = 40;

  const colWidths = calculateColumnWidths(headers, rows, contentWidth, font, boldFont, style);

  // Track per-page segments for correct outer border drawing
  // Each segment: { page, topY, bottomY } — the vertical span of the table on that page
  const pageSegments: Array<{ page: PDFPage; topY: number; bottomY: number }> = [];
  let currentSegmentTop = currentY;

  // ── Draw header row ──
  const headerLineHeight = style.headerFontSize + style.cellPaddingY * 2;

  // Check if we have room for at least header + 2 rows
  if (currentY - headerLineHeight * 3 < bottomMargin) {
    currentPage = addPageFn();
    currentY = pageHeight - 50;
  }

  // Header background
  currentPage.drawRectangle({
    x: margin,
    y: currentY - headerLineHeight,
    width: contentWidth,
    height: headerLineHeight,
    color: rgb(style.headerBg.r, style.headerBg.g, style.headerBg.b),
  });

  // Header text
  let xOffset = margin;
  for (let i = 0; i < headers.length; i++) {
    const text = headers[i] ?? "";
    const textWidth = boldFont.widthOfTextAtSize(text, style.headerFontSize);
    const cellX = isNumericCell(text)
      ? xOffset + colWidths[i] - style.cellPaddingX - textWidth
      : xOffset + style.cellPaddingX;

    currentPage.drawText(text, {
      x: cellX,
      y: currentY - headerLineHeight + style.cellPaddingY + 1,
      size: style.headerFontSize,
      font: boldFont,
      color: rgb(style.headerText.r, style.headerText.g, style.headerText.b),
    });
    xOffset += colWidths[i];
  }

  // Header vertical column separators (subtle white lines for separation within colored header)
  let colDivX = margin;
  for (let ci = 0; ci < headers.length - 1; ci++) {
    colDivX += colWidths[ci];
    currentPage.drawLine({
      start: { x: colDivX, y: currentY },
      end: { x: colDivX, y: currentY - headerLineHeight },
      thickness: 0.5,
      color: rgb(1, 1, 1), // White separator inside colored header
    });
  }

  // Header bottom border (accent line)
  currentPage.drawLine({
    start: { x: margin, y: currentY - headerLineHeight },
    end: { x: margin + contentWidth, y: currentY - headerLineHeight },
    thickness: 1.2,
    color: rgb(style.headerBg.r, style.headerBg.g, style.headerBg.b),
  });

  currentY -= headerLineHeight;

  // ── Draw data rows ──
  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx];

    // Calculate row height (accounting for word wrap)
    let maxLines = 1;
    const cellLines: string[][] = [];
    for (let colIdx = 0; colIdx < headers.length; colIdx++) {
      const cellText = row[colIdx] ?? "";
      const availWidth = colWidths[colIdx] - style.cellPaddingX * 2;
      const lines = wrapText(cellText, availWidth, font, style.fontSize);
      cellLines.push(lines);
      maxLines = Math.max(maxLines, lines.length);
    }

    const lineHeight = style.fontSize + 2;
    const rowHeight = maxLines * lineHeight + style.cellPaddingY * 2;

    // Page break check
    if (currentY - rowHeight < bottomMargin) {
      // Close out the current page segment before breaking
      pageSegments.push({ page: currentPage, topY: currentSegmentTop, bottomY: currentY });

      currentPage = addPageFn();
      currentY = pageHeight - 50;
      currentSegmentTop = currentY; // Start tracking new segment

      // Re-draw header on new page
      currentPage.drawRectangle({
        x: margin,
        y: currentY - headerLineHeight,
        width: contentWidth,
        height: headerLineHeight,
        color: rgb(style.headerBg.r, style.headerBg.g, style.headerBg.b),
      });
      xOffset = margin;
      for (let i = 0; i < headers.length; i++) {
        const text = headers[i] ?? "";
        currentPage.drawText(text, {
          x: xOffset + style.cellPaddingX,
          y: currentY - headerLineHeight + style.cellPaddingY + 1,
          size: style.headerFontSize,
          font: boldFont,
          color: rgb(style.headerText.r, style.headerText.g, style.headerText.b),
        });
        xOffset += colWidths[i];
      }

      // Vertical separators in re-drawn header
      let newColDivX = margin;
      for (let ci = 0; ci < headers.length - 1; ci++) {
        newColDivX += colWidths[ci];
        currentPage.drawLine({
          start: { x: newColDivX, y: currentY },
          end: { x: newColDivX, y: currentY - headerLineHeight },
          thickness: 0.5,
          color: rgb(1, 1, 1),
        });
      }

      // Header bottom accent line
      currentPage.drawLine({
        start: { x: margin, y: currentY - headerLineHeight },
        end: { x: margin + contentWidth, y: currentY - headerLineHeight },
        thickness: 1.2,
        color: rgb(style.headerBg.r, style.headerBg.g, style.headerBg.b),
      });

      currentY -= headerLineHeight;
    }

    // Alternating stripe
    if (rowIdx % 2 === 1) {
      currentPage.drawRectangle({
        x: margin,
        y: currentY - rowHeight,
        width: contentWidth,
        height: rowHeight,
        color: rgb(style.stripeBg.r, style.stripeBg.g, style.stripeBg.b),
      });
    }

    // Cell text
    xOffset = margin;
    for (let colIdx = 0; colIdx < headers.length; colIdx++) {
      const lines = cellLines[colIdx];
      const isNumeric = lines.length === 1 && isNumericCell(lines[0]);

      for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const text = lines[lineIdx];
        const textWidth = font.widthOfTextAtSize(text, style.fontSize);
        const cellX = isNumeric
          ? xOffset + colWidths[colIdx] - style.cellPaddingX - textWidth
          : xOffset + style.cellPaddingX;

        currentPage.drawText(text, {
          x: cellX,
          y: currentY - style.cellPaddingY - (lineIdx + 1) * lineHeight + 2,
          size: style.fontSize,
          font,
          color: rgb(style.textColor.r, style.textColor.g, style.textColor.b),
        });
      }
      xOffset += colWidths[colIdx];
    }

    // Subtle row separator
    currentPage.drawLine({
      start: { x: margin, y: currentY - rowHeight },
      end: { x: margin + contentWidth, y: currentY - rowHeight },
      thickness: style.borderWidth,
      color: rgb(style.borderColor.r, style.borderColor.g, style.borderColor.b),
    });

    // Vertical column separators for this row
    let colX = margin;
    for (let colIdx = 0; colIdx < headers.length - 1; colIdx++) {
      colX += colWidths[colIdx];
      currentPage.drawLine({
        start: { x: colX, y: currentY },
        end: { x: colX, y: currentY - rowHeight },
        thickness: style.borderWidth * 0.8,
        color: rgb(style.borderColor.r, style.borderColor.g, style.borderColor.b),
      });
    }

    currentY -= rowHeight;
  }

  // ── Table outer frame (drawn per-page to avoid cross-page border artifacts) ──
  const tableBottom = currentY;

  // Close out the last page segment
  pageSegments.push({ page: currentPage, topY: currentSegmentTop, bottomY: tableBottom });

  // Draw borders on each page that this table occupies
  for (let si = 0; si < pageSegments.length; si++) {
    const seg = pageSegments[si];
    const isFirst = si === 0;
    const isLast = si === pageSegments.length - 1;
    const borderColor = rgb(style.headerBg.r, style.headerBg.g, style.headerBg.b);

    // Left border
    seg.page.drawLine({
      start: { x: margin, y: seg.topY },
      end: { x: margin, y: seg.bottomY },
      thickness: 0.6,
      color: borderColor,
    });

    // Right border
    seg.page.drawLine({
      start: { x: margin + contentWidth, y: seg.topY },
      end: { x: margin + contentWidth, y: seg.bottomY },
      thickness: 0.6,
      color: borderColor,
    });

    // Top border (only on first page)
    if (isFirst) {
      seg.page.drawLine({
        start: { x: margin, y: seg.topY },
        end: { x: margin + contentWidth, y: seg.topY },
        thickness: 1.0,
        color: borderColor,
      });
    }

    // Bottom border (only on last page — accent line)
    if (isLast) {
      seg.page.drawLine({
        start: { x: margin, y: seg.bottomY },
        end: { x: margin + contentWidth, y: seg.bottomY },
        thickness: 1.0,
        color: borderColor,
      });
    }
  }

  return { page: currentPage, y: tableBottom - 8 };
}

// ── PDF Export (pdf-lib — pure TypeScript) ──────────────────

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

async function exportPdf(input: ExportInput, branding: Branding, charts: RenderedChart[] = [], reportCfg?: ReportSettings): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
  const italicFont = await doc.embedFont(StandardFonts.HelveticaOblique);

  const [pageW, pageH] = PageSizes.A4;
  const margin = 50;
  const contentWidth = pageW - margin * 2;
  const color = hexToRgb(branding.primaryColor);
  const brandRgb = { r: color.r / 255, g: color.g / 255, b: color.b / 255 };

  const tableStyle: TableStyle = {
    ...DEFAULT_TABLE_STYLE,
    headerBg: brandRgb,
  };

  // Report layout settings (defaults if not provided)
  const showTitlePage = reportCfg?.titlePage ?? true;
  const showTocPage = reportCfg?.tocPage ?? true;
  const showReferences = reportCfg?.referencesPage ?? true;
  const showConfidential = reportCfg?.confidentialFooter ?? true;

  // Track pages for footer numbering
  const allPages: PDFPage[] = [];
  let titlePageIndex = -1; // Index of the title page in allPages (-1 if no title page)

  const addPage = (): PDFPage => {
    const page = doc.addPage(PageSizes.A4);
    allPages.push(page);
    return page;
  };

  // ── Title Page (conditional) ──
  const logoData = await fetchLogoImage(branding.logoUrl);

  if (showTitlePage) {
    const titlePage = addPage();
    titlePageIndex = allPages.length - 1;

    // Brand header bar
    titlePage.drawRectangle({
      x: 0,
      y: pageH - 130,
      width: pageW,
      height: 130,
      color: rgb(brandRgb.r, brandRgb.g, brandRgb.b),
    });

    // Company logo (right-aligned in header bar)
    if (logoData) {
      try {
        const logoImage =
          logoData.format === "png"
            ? await doc.embedPng(logoData.bytes)
            : await doc.embedJpg(logoData.bytes);

        const maxH = 90;
        const maxW = 160;
        const origW = logoImage.width;
        const origH = logoImage.height;
        const scale = Math.min(maxW / origW, maxH / origH, 1);
        const drawW = origW * scale;
        const drawH = origH * scale;

        const logoX = pageW - margin - drawW;
        const logoY = pageH - 130 + (130 - drawH) / 2;

        titlePage.drawImage(logoImage, {
          x: logoX,
          y: logoY,
          width: drawW,
          height: drawH,
        });
      } catch {
        // Logo embed failed — skip silently
      }
    }

    // Company name in header bar
    titlePage.drawText(branding.companyName, {
      x: margin,
      y: pageH - 60,
      size: 28,
      font: boldFont,
      color: rgb(1, 1, 1),
    });

    // Tagline
    if (branding.tagline) {
      titlePage.drawText(branding.tagline, {
        x: margin,
        y: pageH - 85,
        size: 11,
        font: italicFont,
        color: rgb(0.9, 0.9, 0.9),
      });
    }

    // Report title
    titlePage.drawText(input.title, {
      x: margin,
      y: pageH - 180,
      size: 24,
      font: boldFont,
      color: rgb(0.15, 0.15, 0.15),
    });

    // Subtitle
    if (input.subtitle) {
      titlePage.drawText(input.subtitle, {
        x: margin,
        y: pageH - 210,
        size: 13,
        font,
        color: rgb(0.45, 0.45, 0.45),
      });
    }

    // Prepared for
    titlePage.drawText(`Prepared for: ${branding.companyName}`, {
      x: margin,
      y: pageH - 240,
      size: 10,
      font: boldFont,
      color: rgb(0.35, 0.35, 0.35),
    });

    // Date
    const dateStr = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    titlePage.drawText(`Date: ${dateStr}`, {
      x: margin,
      y: pageH - 256,
      size: 10,
      font,
      color: rgb(0.6, 0.6, 0.6),
    });

    // Prepared by
    if (input.preparedBy) {
      titlePage.drawText(`Prepared by: ${input.preparedBy}`, {
        x: margin,
        y: pageH - 272,
        size: 10,
        font,
        color: rgb(0.6, 0.6, 0.6),
      });
    }

    // Separator line at bottom
    titlePage.drawLine({
      start: { x: margin, y: 40 },
      end: { x: pageW - margin, y: 40 },
      thickness: 0.8,
      color: rgb(brandRgb.r, brandRgb.g, brandRgb.b),
    });
    if (showConfidential) {
      titlePage.drawText(`${branding.companyName} — Confidential`, {
        x: margin,
        y: 26,
        size: 8,
        font,
        color: rgb(0.6, 0.6, 0.6),
      });
    }
  }

  // ── Parse content (strip LLM metadata before parsing) ──
  const cleanedContent = stripLlmMetadata(input.content);
  const sections = parseMarkdown(cleanedContent);

  // ── Table of Contents (conditional) ──
  // After TOC items, if there's room, continue content on the same page
  let currentPage: PDFPage;
  let y: number;

  if (showTocPage) {
    const tocPage = addPage();
    let tocY = pageH - 60;

    tocPage.drawText("Table of Contents", {
      x: margin,
      y: tocY,
      size: 18,
      font: boldFont,
      color: rgb(brandRgb.r, brandRgb.g, brandRgb.b),
    });
    tocY -= 6;
    tocPage.drawLine({
      start: { x: margin, y: tocY },
      end: { x: pageW - margin, y: tocY },
      thickness: 0.6,
      color: rgb(brandRgb.r, brandRgb.g, brandRgb.b),
    });
    tocY -= 20;

    let tocNum = 1;
    for (const section of sections) {
      if (section.heading && section.level === 2) {
        tocPage.drawText(`${tocNum}. ${section.heading}`, {
          x: margin + 10,
          y: tocY,
          size: 11,
          font,
          color: rgb(0.25, 0.25, 0.25),
        });
        tocNum++;
        tocY -= 18;
        if (tocY < 60) break;
      }
    }

    // Continue content on this page if enough room (> 250px remaining)
    if (tocY > 250) {
      currentPage = tocPage;
      y = tocY - 30; // Small gap between TOC and content
    } else {
      currentPage = addPage();
      y = pageH - 50;
    }
  } else {
    // No TOC — start content on a fresh page
    currentPage = addPage();
    y = pageH - 50;
  }
  const bottomMargin = 45;
  let tableCounter = 0; // For "Table N:" captions
  let chartCounter = 0; // For "Figure N:" captions

  const ensureSpace = (needed: number): void => {
    if (y - needed < bottomMargin) {
      currentPage = addPage();
      y = pageH - 50;
    }
  };

  for (const section of sections) {
    // Skip References section in main loop — rendered separately with special formatting at the end
    if (showReferences && section.heading && /references?/i.test(section.heading)) {
      continue;
    }

    // Section heading
    if (section.heading) {
      const headingSize = section.level === 2 ? 16 : 13;
      ensureSpace(headingSize + 20);

      currentPage.drawText(section.heading, {
        x: margin,
        y,
        size: headingSize,
        font: boldFont,
        color: rgb(brandRgb.r, brandRgb.g, brandRgb.b),
      });
      y -= headingSize + 2;

      if (section.level === 2) {
        currentPage.drawLine({
          start: { x: margin, y },
          end: { x: pageW - margin, y },
          thickness: 0.5,
          color: rgb(brandRgb.r, brandRgb.g, brandRgb.b),
        });
        y -= 10;
      } else {
        y -= 6;
      }
    }

    // Extract ALL tables in this section (handles multiple tables per section)
    const tables = extractTables(section.lines);
    for (const table of tables) {
      tableCounter++;
      // Ensure room for title + header + at least 3 data rows (avoids orphaned table title)
      const headerH = tableStyle.headerFontSize + tableStyle.cellPaddingY * 2;
      const minRowsH = 3 * (tableStyle.fontSize + tableStyle.cellPaddingY * 2 + 2);
      ensureSpace(14 + headerH + minRowsH); // title(14) + header + 3 rows

      // ── Table title (bold, brand color, above the table) ──
      const tableTitle = section.heading
        ? `${section.heading}`
        : `Data Summary`;
      currentPage.drawText(tableTitle, {
        x: margin,
        y,
        size: 10,
        font: boldFont,
        color: rgb(brandRgb.r, brandRgb.g, brandRgb.b),
      });
      y -= 14;

      const result = await drawTable(
        doc,
        currentPage,
        y,
        table.headers,
        table.rows,
        font,
        boldFont,
        tableStyle,
        margin,
        contentWidth,
        addPage
      );
      currentPage = result.page;
      y = result.y;

      // ── Table caption/subtitle (italic, centered, below the table) ──
      const captionText = `Table ${tableCounter}: ${tableTitle}`;
      const captionWidth = italicFont.widthOfTextAtSize(captionText, 8);
      const captionX = margin + (contentWidth - captionWidth) / 2;
      ensureSpace(14);
      currentPage.drawText(captionText, {
        x: captionX,
        y,
        size: 8,
        font: italicFont,
        color: rgb(0.5, 0.5, 0.5),
      });
      y -= 18; // spacing after caption
    }

    // Text content (skip table lines)
    const textLines = section.lines.filter(
      (l) => !l.trim().startsWith("|") && l.trim().length > 0
    );

    for (const line of textLines) {
      const clean = stripMd(line);
      if (!clean) continue;

      ensureSpace(14);

      const isBold = /\*\*/.test(line);
      const fontSize = isBold ? 10 : 9;
      const usedFont = isBold ? boldFont : font;

      // Word wrap the text
      const wrapped = wrapText(clean, contentWidth, usedFont, fontSize);

      for (const wLine of wrapped) {
        ensureSpace(fontSize + 4);
        currentPage.drawText(wLine, {
          x: margin,
          y,
          size: fontSize,
          font: usedFont,
          color: rgb(0.24, 0.24, 0.24),
        });
        y -= fontSize + 3;
      }
      y -= 2;
    }

    y -= 6; // Section spacing
  }

  // ── Embed chart images with titles, borders, and captions ──
  if (charts.length > 0) {
    for (const chart of charts) {
      chartCounter++;

      // Each chart gets its own space — title + image + caption
      const maxWidth = contentWidth - 20; // 10px padding on each side
      const scale = Math.min(maxWidth / chart.width, 1);
      const drawW = chart.width * scale;
      const drawH = chart.height * scale;
      const totalNeeded = drawH + 60; // title + image + caption + spacing

      ensureSpace(totalNeeded);

      // ── Chart title (bold, brand color, above) ──
      currentPage.drawText(chart.title, {
        x: margin,
        y,
        size: 12,
        font: boldFont,
        color: rgb(brandRgb.r, brandRgb.g, brandRgb.b),
      });
      y -= 8;

      // Thin accent line under title
      currentPage.drawLine({
        start: { x: margin, y },
        end: { x: margin + contentWidth, y },
        thickness: 0.5,
        color: rgb(brandRgb.r, brandRgb.g, brandRgb.b),
      });
      y -= 10;

      // Embed chart PNG with border frame
      try {
        const chartImage = await doc.embedPng(chart.png);
        const imgX = margin + (contentWidth - drawW) / 2; // Center the image

        // Light border around chart image
        currentPage.drawRectangle({
          x: imgX - 4,
          y: y - drawH - 4,
          width: drawW + 8,
          height: drawH + 8,
          borderColor: rgb(tableStyle.borderColor.r, tableStyle.borderColor.g, tableStyle.borderColor.b),
          borderWidth: 0.6,
          color: rgb(1, 1, 1), // White background behind chart
        });

        currentPage.drawImage(chartImage, {
          x: imgX,
          y: y - drawH,
          width: drawW,
          height: drawH,
        });
        y -= drawH + 10;

        // ── Figure caption (italic, centered, below) ──
        const figCaption = `Figure ${chartCounter}: ${chart.title}`;
        const figCaptionW = italicFont.widthOfTextAtSize(figCaption, 8);
        const figCaptionX = margin + (contentWidth - figCaptionW) / 2;
        currentPage.drawText(figCaption, {
          x: figCaptionX,
          y,
          size: 8,
          font: italicFont,
          color: rgb(0.5, 0.5, 0.5),
        });
        y -= 20;
      } catch (imgErr) {
        // Chart image embedding failed — skip silently
        console.error("[pdf-export] Failed to embed chart image:", imgErr);
      }
    }
  }

  // ── References section (if enabled and present in content) ──
  const referencesSection = showReferences
    ? sections.find((s) => s.heading?.toLowerCase().includes("reference"))
    : null;
  if (referencesSection && referencesSection.lines.some((l) => l.trim().length > 0)) {
    ensureSpace(40);

    // References heading
    currentPage.drawText("References", {
      x: margin,
      y,
      size: 14,
      font: boldFont,
      color: rgb(brandRgb.r, brandRgb.g, brandRgb.b),
    });
    y -= 6;
    currentPage.drawLine({
      start: { x: margin, y },
      end: { x: pageW - margin, y },
      thickness: 0.5,
      color: rgb(brandRgb.r, brandRgb.g, brandRgb.b),
    });
    y -= 14;

    let refNum = 1;
    for (const line of referencesSection.lines) {
      const clean = stripMd(line).trim();
      if (!clean) continue;

      ensureSpace(14);

      // Format as numbered references with hanging indent
      const refPrefix = clean.match(/^\d+[\.\)]/) ? "" : `[${refNum}] `;
      const refText = `${refPrefix}${clean}`;
      const wrapped = wrapText(refText, contentWidth - 15, font, 8);
      for (let li = 0; li < wrapped.length; li++) {
        ensureSpace(11);
        currentPage.drawText(wrapped[li], {
          x: margin + (li === 0 ? 0 : 15), // Hanging indent
          y,
          size: 8,
          font,
          color: rgb(0.4, 0.4, 0.4),
        });
        y -= 10;
      }
      refNum++;
    }
    y -= 8;
  }

  // ── Remove trailing empty pages ──
  // ensureSpace() may have created a new page at the end that has no content.
  // An empty content page has y near pageH-50 (the starting Y after addPage).
  // If the last page has y > pageH - 80 (i.e. nothing or almost nothing drawn), remove it.
  // Never remove title page (index 0), TOC (index 1), or pages with table/chart content.
  if (allPages.length > 3 && y > pageH - 80) {
    doc.removePage(doc.getPageCount() - 1);
    allPages.pop();
    currentPage = allPages[allPages.length - 1];
  }

  // ── Page footers (applied to all pages after generation) ──
  for (let i = 0; i < allPages.length; i++) {
    const pg = allPages[i];
    const isTitlePage = i === titlePageIndex;

    // Title page already has its own footer styling — skip separator + company name
    if (!isTitlePage) {
      // Separator line
      pg.drawLine({
        start: { x: margin, y: 30 },
        end: { x: pageW - margin, y: 30 },
        thickness: 0.4,
        color: rgb(brandRgb.r, brandRgb.g, brandRgb.b),
      });
      // Company name
      pg.drawText(branding.companyName, {
        x: margin,
        y: 18,
        size: 7,
        font,
        color: rgb(0.6, 0.6, 0.6),
      });
    }
    // Page number (on all pages including title)
    const pageLabel = `Page ${i + 1} of ${allPages.length}`;
    const pageLabelWidth = font.widthOfTextAtSize(pageLabel, 7);
    pg.drawText(pageLabel, {
      x: pageW - margin - pageLabelWidth,
      y: 18,
      size: 7,
      font,
      color: rgb(0.6, 0.6, 0.6),
    });
  }

  const pdfBytes = await doc.save();
  return Buffer.from(pdfBytes);
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

  // Auto-width columns
  summary.columns.forEach((col: Partial<ExcelJS.Column>) => {
    col.width = 25;
  });

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

    // Auto-width
    dataSheet.columns.forEach((col: Partial<ExcelJS.Column>) => {
      col.width = 20;
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ── Word Export ────────────────────────────────────────────

async function exportDocx(input: ExportInput, branding: Branding, charts: RenderedChart[] = []): Promise<Buffer> {
  const color = branding.primaryColor.replace("#", "");
  const sections = parseMarkdown(input.content);

  const children: Paragraph[] = [];

  // Company logo (if available)
  const docxLogo = await fetchLogoImage(branding.logoUrl);
  if (docxLogo) {
    try {
      children.push(
        new Paragraph({
          children: [
            new ImageRun({
              data: docxLogo.bytes,
              transformation: { width: 140, height: 60 },
              type: docxLogo.format === "png" ? "png" : "jpg",
            }),
          ],
          spacing: { after: 200 },
        })
      );
    } catch {
      // Logo embed failed — skip silently
    }
  }

  // Title
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: branding.companyName,
          bold: true,
          size: 40,
          color: color,
          font: "Calibri",
        }),
      ],
      spacing: { after: 100 },
    })
  );

  if (branding.tagline) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: branding.tagline, size: 22, color: "888888", italics: true }),
        ],
        spacing: { after: 200 },
      })
    );
  }

  // Report title
  children.push(
    new Paragraph({
      children: [new TextRun({ text: input.title, bold: true, size: 36, color: "333333" })],
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 100 },
    })
  );

  if (input.subtitle) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: input.subtitle, size: 24, color: "666666" })],
        spacing: { after: 100 },
      })
    );
  }

  // Date
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `Generated: ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`,
          size: 18,
          color: "AAAAAA",
        }),
      ],
      spacing: { after: 100 },
    })
  );

  // Prepared by
  if (input.preparedBy) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `Prepared by: ${input.preparedBy}`,
            size: 18,
            color: "888888",
          }),
        ],
        spacing: { after: 400 },
      })
    );
  } else {
    children.push(new Paragraph({ spacing: { after: 300 } }));
  }

  // Horizontal rule
  children.push(
    new Paragraph({
      border: { bottom: { color: color, style: BorderStyle.SINGLE, size: 6, space: 1 } },
      spacing: { after: 300 },
    })
  );

  // ── Table of Contents ──
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: "Table of Contents",
          bold: true,
          size: 28,
          color: color,
        }),
      ],
      spacing: { before: 200, after: 200 },
    })
  );
  let tocNum = 1;
  for (const section of sections) {
    if (section.heading && section.level === 2) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `${tocNum}. ${section.heading}`,
              size: 22,
              color: "444444",
            }),
          ],
          spacing: { after: 60 },
        })
      );
      tocNum++;
    }
  }

  // Separator after TOC
  children.push(
    new Paragraph({
      border: { bottom: { color: "CCCCCC", style: BorderStyle.SINGLE, size: 3, space: 1 } },
      spacing: { after: 400 },
    })
  );

  // Content sections
  for (const section of sections) {
    if (section.heading) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: section.heading,
              bold: true,
              size: section.level === 2 ? 28 : 24,
              color: color,
            }),
          ],
          heading: section.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
          spacing: { before: 300, after: 100 },
        })
      );
    }

    // Tables (handles multiple tables per section)
    const sectionTables = extractTables(section.lines);
    for (const table of sectionTables) {
      children.push(new Paragraph({ spacing: { before: 100 } }));
      children.push(new Paragraph({ spacing: { after: 100 } }));
    }

    // Text content
    const textLines = section.lines.filter(
      (l) => !l.trim().startsWith("|") && l.trim().length > 0
    );

    for (const line of textLines) {
      const clean = stripMd(line);
      if (!clean) continue;

      const isBullet = clean.startsWith("• ");
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: isBullet ? clean.substring(2) : clean,
              size: 20,
              color: "444444",
            }),
          ],
          bullet: isBullet ? { level: 0 } : undefined,
          spacing: { after: 60 },
        })
      );
    }
  }

  // Build tables separately and add to doc sections
  const docTables: Table[] = [];
  for (const section of sections) {
    const tables = extractTables(section.lines);
    for (const table of tables) {
      docTables.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              children: table.headers.map(
                (h) =>
                  new TableCell({
                    children: [
                      new Paragraph({
                        children: [
                          new TextRun({ text: h, bold: true, color: "FFFFFF", size: 18 }),
                        ],
                        alignment: AlignmentType.CENTER,
                      }),
                    ],
                    shading: { fill: color, type: "clear", color: color },
                  })
              ),
            }),
            ...table.rows.map(
              (row, rowIdx) =>
                new TableRow({
                  children: row.map(
                    (cell) =>
                      new TableCell({
                        children: [
                          new Paragraph({
                            children: [new TextRun({ text: cell, size: 18 })],
                          }),
                        ],
                        shading:
                          rowIdx % 2 === 1
                            ? { fill: "F5F7FA", type: "clear", color: "F5F7FA" }
                            : undefined,
                      })
                  ),
                })
            ),
          ],
        })
      );
    }
  }

  // ── Chart images ──
  const chartParagraphs: Paragraph[] = [];
  if (charts.length > 0) {
    for (const chart of charts) {
      // Chart title
      chartParagraphs.push(
        new Paragraph({
          children: [
            new TextRun({ text: chart.title, bold: true, size: 26, color: color }),
          ],
          spacing: { before: 400, after: 120 },
        })
      );
      // Chart image
      try {
        const drawW = Math.min(chart.width, 600);
        const scale = drawW / chart.width;
        const drawH = Math.round(chart.height * scale);
        chartParagraphs.push(
          new Paragraph({
            children: [
              new ImageRun({
                data: Buffer.from(chart.png) as any,
                transformation: { width: drawW, height: drawH },
                type: "png",
              } as any),
            ],
            spacing: { after: 200 },
          })
        );
      } catch {
        // Chart image failed — skip
      }
    }
  }

  const doc = new Document({
    creator: branding.companyName,
    title: input.title,
    description: input.subtitle ?? "",
    sections: [
      {
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: branding.companyName,
                    bold: true,
                    size: 16,
                    color: color,
                  }),
                ],
                alignment: AlignmentType.LEFT,
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: `${branding.companyName} — Confidential    |    Page `,
                    size: 14,
                    color: "AAAAAA",
                  }),
                  new TextRun({
                    children: [PageNumber.CURRENT],
                    size: 14,
                    color: "AAAAAA",
                  }),
                ],
                alignment: AlignmentType.CENTER,
              }),
            ],
          }),
        },
        children: [...children, ...chartParagraphs, ...docTables],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
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
            data: `image/png;base64,${b64}`,
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
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

const EXTENSIONS: Record<ExportFormat, string> = {
  pdf: "pdf",
  xlsx: "xlsx",
  docx: "docx",
  pptx: "pptx",
};

// ── Chart block extraction ─────────────────────────────────

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
 * Export a report to a binary format, store in S3, and return a download URL.
 *
 * @param input - Report content, title, and desired format
 * @returns ExportResult with download URL, filename, and metadata
 */
export async function exportReport(input: ExportInput): Promise<ExportResult> {
  const branding = await loadBranding();
  const reportCfg = await getReportSettings();

  // ── Extract chart specs from markdown ```chart blocks + input.charts ──
  const { content: cleanContent, charts: extractedCharts } = extractChartBlocks(input.content);
  let allChartSpecs = [...extractedCharts, ...(input.charts ?? [])];

  // Respect report settings: disable charts or limit count/data points
  if (!reportCfg.chartsEnabled) {
    allChartSpecs = [];
  } else {
    // Limit number of charts
    if (allChartSpecs.length > reportCfg.maxCharts) {
      allChartSpecs = allChartSpecs.slice(0, reportCfg.maxCharts);
    }
    // Limit data points per chart
    for (const spec of allChartSpecs) {
      if (spec.data && spec.data.length > reportCfg.maxChartDataPoints) {
        spec.data = spec.data.slice(0, reportCfg.maxChartDataPoints);
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

  // Use cleaned content (chart blocks removed) for markdown parsing
  const exportInput = { ...input, content: cleanContent };

  // Generate the binary buffer
  let buffer: Buffer;
  switch (input.format) {
    case "pdf":
      buffer = await exportPdf(exportInput, branding, renderedCharts, reportCfg);
      break;
    case "xlsx":
      buffer = await exportXlsx(exportInput, branding, renderedCharts);
      break;
    case "docx":
      buffer = await exportDocx(exportInput, branding, renderedCharts);
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
  { value: "docx", label: "Word Document", icon: "📝", ext: ".docx" },
  { value: "pptx", label: "PowerPoint Presentation", icon: "📽️", ext: ".pptx" },
];
