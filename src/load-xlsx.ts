/**
 * long-black — XLSX table reader for the Excel-only enrichment sources (ATO
 * Corporate Tax Transparency, R&D Tax Incentive, and later the Aged Care Provider
 * Register). Those publishers ship a multi-tab workbook — an "Information"/prose tab
 * plus a data tab whose row 1 is the header — so this locates the ABN-bearing sheet
 * (the first worksheet whose header row contains an ABN column) and returns that
 * header plus the data rows as plain cell arrays. The files are small (<1 MB), so the
 * workbook is read fully into memory.
 */

import ExcelJS from "exceljs";

export interface XlsxTable {
  sheetName: string;
  header: string[];
  rows: unknown[][];
}

/** Header cells that mark the ABN-bearing row (case-insensitive, trimmed). */
const ABN_HEADER_TOKENS = new Set(["abn", "abn/acn"]);

/** Normalize an exceljs cell value (handles rich text / formula results / hyperlinks). */
function cellValue(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === "object") {
    const o = v as { result?: unknown; text?: unknown; richText?: { text: string }[] };
    if (o.result !== undefined) return o.result; // formula cell
    if (o.text !== undefined) return o.text; // hyperlink
    if (Array.isArray(o.richText)) return o.richText.map((t) => t.text).join(""); // rich text
  }
  return v;
}

/** exceljs Row (1-based `values`, index 0 is empty) → a 0-based plain-value array. */
function rowValues(row: ExcelJS.Row): unknown[] {
  const vals = row.values as unknown[];
  const out: unknown[] = [];
  for (let i = 1; i < vals.length; i++) out.push(cellValue(vals[i]));
  return out;
}

/**
 * Read the first worksheet whose header row (found within the first `maxScan` rows)
 * contains an ABN column, returning that header + all subsequent non-blank data
 * rows. Throws if no ABN-bearing sheet exists (wrong file / format drift) — fail-fast
 * so an unexpected workbook can't yield a silently-empty load.
 */
export async function readAbnXlsx(file: string, maxScan = 10): Promise<XlsxTable> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  for (const ws of wb.worksheets) {
    const scan = Math.min(maxScan, ws.rowCount);
    for (let r = 1; r <= scan; r++) {
      const cells = rowValues(ws.getRow(r));
      const isHeader = cells.some(
        (c) => typeof c === "string" && ABN_HEADER_TOKENS.has(c.trim().toLowerCase()),
      );
      if (!isHeader) continue;
      const header = cells.map((c) => (c === null || c === undefined ? "" : String(c).trim()));
      const rows: unknown[][] = [];
      for (let dr = r + 1; dr <= ws.rowCount; dr++) {
        const vals = rowValues(ws.getRow(dr));
        if (vals.every((v) => v === null || v === undefined || String(v).trim() === "")) continue;
        rows.push(vals);
      }
      return { sheetName: ws.name, header, rows };
    }
  }
  throw new Error(`no ABN-bearing sheet found in ${file}`);
}

/** header-name → column-index map (lowercased, trimmed) for row lookups. */
export function headerIndex(header: string[]): Map<string, number> {
  const m = new Map<string, number>();
  header.forEach((h, i) => {
    const key = h.trim().toLowerCase();
    if (!m.has(key)) m.set(key, i);
  });
  return m;
}

/** Reduce a cell to its digit string (ABN/ACN cells arrive as numbers or text). */
export function cellDigits(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).replace(/\D/g, "");
}

/** A cell → a finite number (whole-dollar amounts), or null when blank/non-numeric. */
export function cellNumber(v: unknown): number | null {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = Number(String(v).replace(/[,$\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}
