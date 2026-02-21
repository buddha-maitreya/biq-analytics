/**
 * Report Export Library — converts markdown/text reports into binary formats.
 *
 * Supports: PDF, Excel (XLSX), Word (DOCX), PowerPoint (PPTX).
 * All libraries are pure JavaScript — no native dependencies, works in Bun.
 *
 * Generated files are stored in S3 (object storage) and returned as
 * presigned download URLs with configurable expiry.
 *
 * Branding (company name, logo, colors) is pulled from business_settings
 * and applied to headers/footers/title slides automatically.
 */

import { jsPDF } from "jspdf";
import "jspdf-autotable";
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

// ── PDF Export ──────────────────────────────────────────────

async function exportPdf(input: ExportInput, branding: Branding): Promise<Buffer> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 20;
  const contentWidth = pageWidth - margin * 2;
  const color = hexToRgb(branding.primaryColor);

  // ── Title page ──
  // Header bar
  doc.setFillColor(color.r, color.g, color.b);
  doc.rect(0, 0, pageWidth, 50, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(28);
  doc.text(branding.companyName, margin, 30);

  if (branding.tagline) {
    doc.setFontSize(11);
    doc.text(branding.tagline, margin, 40);
  }

  // Report title
  doc.setTextColor(40, 40, 40);
  doc.setFontSize(22);
  doc.text(input.title, margin, 75);

  if (input.subtitle) {
    doc.setFontSize(13);
    doc.setTextColor(120, 120, 120);
    doc.text(input.subtitle, margin, 87);
  }

  // Date
  doc.setFontSize(10);
  doc.setTextColor(150, 150, 150);
  doc.text(`Generated: ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`, margin, 100);

  // Prepared by
  if (input.preparedBy) {
    doc.text(`Prepared by: ${input.preparedBy}`, margin, 107);
  }

  // Footer line
  doc.setDrawColor(color.r, color.g, color.b);
  doc.setLineWidth(0.5);
  doc.line(margin, pageHeight - 15, pageWidth - margin, pageHeight - 15);
  doc.setFontSize(8);
  doc.setTextColor(150, 150, 150);
  doc.text(`${branding.companyName} — Confidential`, margin, pageHeight - 10);

  // ── Content pages ──
  const sections = parseMarkdown(input.content);

  // ── Table of Contents page ──
  doc.addPage();
  doc.setTextColor(color.r, color.g, color.b);
  doc.setFontSize(18);
  doc.text("Table of Contents", margin, 25);
  doc.setDrawColor(color.r, color.g, color.b);
  doc.setLineWidth(0.3);
  doc.line(margin, 28, pageWidth - margin, 28);

  let tocY = 38;
  let tocIndex = 1;
  for (const section of sections) {
    if (section.heading && section.level === 2) {
      doc.setTextColor(60, 60, 60);
      doc.setFontSize(11);
      doc.text(`${tocIndex}. ${section.heading}`, margin + 4, tocY);
      tocIndex++;
      tocY += 7;
      if (tocY > pageHeight - 30) break; // prevent overflow
    }
  }

  // Page footer on TOC page
  doc.setDrawColor(color.r, color.g, color.b);
  doc.setLineWidth(0.3);
  doc.line(margin, pageHeight - 15, pageWidth - margin, pageHeight - 15);
  doc.setFontSize(8);
  doc.setTextColor(150, 150, 150);
  doc.text(`${branding.companyName}`, margin, pageHeight - 10);
  doc.text(`Page ${doc.getNumberOfPages()}`, pageWidth - margin - 15, pageHeight - 10);

  let y = 20; // start position on new page

  const addPage = () => {
    doc.addPage();
    y = 20;
    // Page footer
    doc.setDrawColor(color.r, color.g, color.b);
    doc.setLineWidth(0.3);
    doc.line(margin, pageHeight - 15, pageWidth - margin, pageHeight - 15);
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text(`${branding.companyName}`, margin, pageHeight - 10);
    doc.text(`Page ${doc.getNumberOfPages()}`, pageWidth - margin - 15, pageHeight - 10);
  };

  addPage(); // First content page

  for (const section of sections) {
    // Check if we need a new page
    if (y > pageHeight - 40) addPage();

    // Section heading
    if (section.heading) {
      doc.setTextColor(color.r, color.g, color.b);
      doc.setFontSize(section.level === 2 ? 16 : 13);
      doc.text(section.heading, margin, y);
      y += section.level === 2 ? 10 : 8;

      if (section.level === 2) {
        doc.setDrawColor(color.r, color.g, color.b);
        doc.setLineWidth(0.3);
        doc.line(margin, y - 2, pageWidth - margin, y - 2);
        y += 4;
      }
    }

    // Check for tables in this section
    const table = extractTable(section.lines);
    if (table) {
      // Render table using autoTable
      (doc as any).autoTable({
        startY: y,
        head: [table.headers],
        body: table.rows,
        margin: { left: margin, right: margin },
        headStyles: {
          fillColor: [color.r, color.g, color.b],
          textColor: [255, 255, 255],
          fontSize: 9,
          fontStyle: "bold",
        },
        bodyStyles: { fontSize: 8, textColor: [60, 60, 60] },
        alternateRowStyles: { fillColor: [245, 247, 250] },
        tableWidth: contentWidth,
      });
      y = (doc as any).lastAutoTable.finalY + 8;
    }

    // Non-table content
    const textLines = section.lines.filter(
      (l) => !l.trim().startsWith("|") && l.trim().length > 0
    );

    for (const line of textLines) {
      if (y > pageHeight - 25) addPage();

      const clean = stripMd(line);
      if (!clean) continue;

      doc.setTextColor(60, 60, 60);

      // Bold lines (was **bold**)
      const isBold = /\*\*/.test(line);
      doc.setFontSize(isBold ? 10 : 9);

      // Word wrap
      const wrapped = doc.splitTextToSize(clean, contentWidth);
      doc.text(wrapped, margin, y);
      y += wrapped.length * 5 + 2;
    }

    y += 4; // Section spacing
  }

  return Buffer.from(doc.output("arraybuffer"));
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

  // Store in S3
  const storageKey = `${timestamp}/${filename}`;
  const contentType = CONTENT_TYPES[input.format];

  const { sizeBytes } = await exportStorage.put(storageKey, buffer, {
    contentType,
    meta: {
      title: input.title,
      format: input.format,
      generatedAt: new Date().toISOString(),
      companyName: branding.companyName,
    },
  });

  // Generate presigned download URL (1 hour expiry)
  const downloadUrl = exportStorage.presign(storageKey, { expiresIn: 3600 });

  return {
    downloadUrl,
    storageKey: `report-exports/${storageKey}`,
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
