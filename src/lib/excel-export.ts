import ExcelJS from "exceljs";

export interface ExcelColumn {
  header: string;
  key: string;
  width?: number;
}

/**
 * Build a styled Excel (.xlsx) Buffer from an array of row objects.
 * Uses ExcelJS — server-side only.
 *
 * @param sheetName  Name of the worksheet tab
 * @param columns    Column definitions (header label, row key, optional width)
 * @param rows       Array of plain objects whose keys match column `key` values
 */
export async function buildExcelBuffer(
  sheetName: string,
  columns: ExcelColumn[],
  rows: Record<string, unknown>[]
): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Business IQ Enterprise";
  wb.created = new Date();

  const ws = wb.addWorksheet(sheetName);

  ws.columns = columns.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.width ?? 18,
  }));

  // ── Header row styling (dark-blue bg, white bold text) ──────────────
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1E3A5F" },
  };
  headerRow.alignment = { vertical: "middle", horizontal: "center" };
  headerRow.height = 22;

  // ── Data rows ────────────────────────────────────────────────────────
  ws.addRows(rows);

  // ── Borders + zebra striping (skip header row) ───────────────────────
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    row.eachCell((cell) => {
      cell.border = {
        top:    { style: "thin", color: { argb: "FFE2E8F0" } },
        bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
        left:   { style: "thin", color: { argb: "FFE2E8F0" } },
        right:  { style: "thin", color: { argb: "FFE2E8F0" } },
      };
      if (rowNumber % 2 === 0) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF8FAFC" },
        };
      }
    });
  });

  const buf = await wb.xlsx.writeBuffer();
  // ExcelJS returns a Buffer (Uint8Array subclass) in Bun/Node
  // Cast to satisfy strict ArrayBuffer generic constraint
  return buf as unknown as Uint8Array;
}
