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
} from "docx";
import * as objectStorage from "@services/object-storage";
import { getAllSettings } from "@services/settings";

// ── Types ──────────────────────────────────────────────────

export type ExportFormat = "pdf" | "xlsx" | "docx" | "pptx";

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
 * Extract a markdown table from lines into header + rows.
 */
function extractTable(lines: string[]): { headers: string[]; rows: string[][] } | null {
  const tableLines = lines.filter((l) => l.trim().startsWith("|"));
  if (tableLines.length < 3) return null; // need header + separator + at least 1 row

  const parse = (line: string) =>
    line
      .split("|")
      .map((c) => c.trim())
      .filter((c) => c.length > 0 && !/^[-:]+$/.test(c));

  const headers = parse(tableLines[0]);
  // Skip separator line (tableLines[1])
  const rows = tableLines.slice(2).map(parse);
  return headers.length > 0 ? { headers, rows } : null;
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
 * Draw an elegant table on PDF pages.
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
      currentPage = addPageFn();
      currentY = pageHeight - 50;

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

    currentY -= rowHeight;
  }

  // Table bottom border (slightly thicker for closure)
  currentPage.drawLine({
    start: { x: margin, y: currentY },
    end: { x: margin + contentWidth, y: currentY },
    thickness: 0.8,
    color: rgb(style.headerBg.r, style.headerBg.g, style.headerBg.b),
  });

  // Left and right borders for the full table
  const tableTop = y;
  currentPage.drawLine({
    start: { x: margin, y: tableTop },
    end: { x: margin, y: currentY },
    thickness: style.borderWidth,
    color: rgb(style.borderColor.r, style.borderColor.g, style.borderColor.b),
  });
  currentPage.drawLine({
    start: { x: margin + contentWidth, y: tableTop },
    end: { x: margin + contentWidth, y: currentY },
    thickness: style.borderWidth,
    color: rgb(style.borderColor.r, style.borderColor.g, style.borderColor.b),
  });

  return { page: currentPage, y: currentY - 8 };
}

// ── PDF Export (pdf-lib — pure TypeScript) ──────────────────

async function exportPdf(input: ExportInput, branding: Branding): Promise<Buffer> {
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

  // Track pages for footer numbering
  const allPages: PDFPage[] = [];

  const addPage = (): PDFPage => {
    const page = doc.addPage(PageSizes.A4);
    allPages.push(page);
    return page;
  };

  // ── Title Page ──
  const titlePage = addPage();

  // Brand header bar
  titlePage.drawRectangle({
    x: 0,
    y: pageH - 130,
    width: pageW,
    height: 130,
    color: rgb(brandRgb.r, brandRgb.g, brandRgb.b),
  });

  // Company name
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

  // Date
  const dateStr = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  titlePage.drawText(`Generated: ${dateStr}`, {
    x: margin,
    y: pageH - 240,
    size: 10,
    font,
    color: rgb(0.6, 0.6, 0.6),
  });

  // Prepared by
  if (input.preparedBy) {
    titlePage.drawText(`Prepared by: ${input.preparedBy}`, {
      x: margin,
      y: pageH - 256,
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
  titlePage.drawText(`${branding.companyName} — Confidential`, {
    x: margin,
    y: 26,
    size: 8,
    font,
    color: rgb(0.6, 0.6, 0.6),
  });

  // ── Table of Contents Page ──
  const sections = parseMarkdown(input.content);
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

  // ── Content Pages ──
  let currentPage = addPage();
  let y = pageH - 50;
  const bottomMargin = 45;

  const ensureSpace = (needed: number): void => {
    if (y - needed < bottomMargin) {
      currentPage = addPage();
      y = pageH - 50;
    }
  };

  for (const section of sections) {
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

    // Check for table
    const table = extractTable(section.lines);
    if (table) {
      ensureSpace(60); // At least header + 2 rows must fit
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

  // ── Page footers (applied to all pages after generation) ──
  for (let i = 0; i < allPages.length; i++) {
    const pg = allPages[i];
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
    // Page number
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

async function exportXlsx(input: ExportInput, branding: Branding): Promise<Buffer> {
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

    // Check for table data in this section
    const table = extractTable(section.lines);
    if (table) {
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

async function exportDocx(input: ExportInput, branding: Branding): Promise<Buffer> {
  const color = branding.primaryColor.replace("#", "");
  const sections = parseMarkdown(input.content);

  const children: Paragraph[] = [];

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

    // Table
    const table = extractTable(section.lines);
    if (table) {
      const docTable = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          // Header
          new TableRow({
            children: table.headers.map(
              (h) =>
                new TableCell({
                  children: [
                    new Paragraph({
                      children: [
                        new TextRun({
                          text: h,
                          bold: true,
                          color: "FFFFFF",
                          size: 18,
                          font: "Calibri",
                        }),
                      ],
                      alignment: AlignmentType.CENTER,
                    }),
                  ],
                  shading: { fill: color, type: "clear", color: color },
                })
            ),
          }),
          // Data rows
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
      });
      children.push(new Paragraph({ spacing: { before: 100 } }));
      // Tables must be in sections, add via workaround
      children.push(new Paragraph({ spacing: { after: 100 } }));
      // We'll add the table to the doc directly below
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
    const table = extractTable(section.lines);
    if (table) {
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
        children: [...children, ...docTables],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  return Buffer.from(buffer);
}

// ── PowerPoint Export ──────────────────────────────────────

async function exportPptx(input: ExportInput, branding: Branding): Promise<Buffer> {
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

    // Check for table
    const table = extractTable(section.lines);
    if (table) {
      const tableRows: PptxGenJS.TableRow[] = [
        // Header
        table.headers.map((h) => ({
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
        ...table.rows.map((row, rowIdx) =>
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
        y: 1.8,
        w: 9,
        fontSize: 9,
        border: { type: "solid", pt: 0.5, color: "DDDDDD" },
      });
    }

    // Text content (below heading or table)
    const textLines = section.lines
      .filter((l) => !l.trim().startsWith("|") && l.trim().length > 0)
      .map((l) => stripMd(l))
      .filter(Boolean);

    if (textLines.length > 0) {
      const yPos = table ? 4.0 : 1.8;
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

/**
 * Export a report to a binary format, store in S3, and return a download URL.
 *
 * @param input - Report content, title, and desired format
 * @returns ExportResult with download URL, filename, and metadata
 */
export async function exportReport(input: ExportInput): Promise<ExportResult> {
  const branding = await loadBranding();

  // Generate the binary buffer
  let buffer: Buffer;
  switch (input.format) {
    case "pdf":
      buffer = await exportPdf(input, branding);
      break;
    case "xlsx":
      buffer = await exportXlsx(input, branding);
      break;
    case "docx":
      buffer = await exportDocx(input, branding);
      break;
    case "pptx":
      buffer = await exportPptx(input, branding);
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
      // S3 configured but operation failed — fall back to base64 data URL
      console.error("[report-export] S3 storage failed, falling back to data URL:", s3Err);
      downloadUrl = `data:${contentType};base64,${buffer.toString("base64")}`;
      storageKey = "";
    }
  } else {
    // S3 not configured — return base64 data URL
    downloadUrl = `data:${contentType};base64,${buffer.toString("base64")}`;
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
