/**
 * Unit tests for the XLSX enrichment path: the workbook reader (finds the
 * ABN-bearing sheet, skips the prose "Information" tab) and the latest-year
 * resource selector.
 */

import { describe, it, expect, afterEach } from "vitest";
import ExcelJS from "exceljs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readAbnXlsx, headerIndex, cellDigits, cellNumber } from "../../src/load-xlsx.js";
import { selectLatestXlsxResource } from "../../src/xlsx-sources.js";
import type { CkanResource } from "crema";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function writeWorkbook(sheets: { name: string; rows: unknown[][] }[]): Promise<string> {
  const d = mkdtempSync(join(tmpdir(), "lb-xlsx-"));
  dirs.push(d);
  const p = join(d, "book.xlsx");
  const wb = new ExcelJS.Workbook();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name);
    for (const r of s.rows) ws.addRow(r);
  }
  await wb.xlsx.writeFile(p);
  return p;
}

describe("readAbnXlsx", () => {
  it("finds the ABN-bearing data sheet, skipping the prose tab", async () => {
    const file = await writeWorkbook([
      {
        name: "Information",
        rows: [["Some explanatory preamble about the report"], ["More prose"]],
      },
      {
        name: "Income tax details",
        rows: [
          ["Name", "ABN", "Total income $"],
          ["BIG CO PTY LTD", 51000000793, 500000000],
          ["ACME PTY LTD", 51000000761, 120000000],
        ],
      },
    ]);
    const table = await readAbnXlsx(file);
    expect(table.sheetName).toBe("Income tax details");
    expect(table.header).toEqual(["Name", "ABN", "Total income $"]);
    expect(table.rows).toHaveLength(2);
    const hix = headerIndex(table.header);
    expect(cellDigits(table.rows[0][hix.get("abn")!])).toBe("51000000793");
    expect(cellNumber(table.rows[0][hix.get("total income $")!])).toBe(500000000);
  });

  it("handles an ABN/ACN header and a header not on row 1", async () => {
    const file = await writeWorkbook([
      {
        name: "2022-23 Report",
        rows: [
          ["Report of R&D entities"], // a descriptive row above the header
          ["Company name", "ABN/ACN", "Total R&D expenditure $"],
          ["INNOV PTY LTD", 95608464535, 449266],
        ],
      },
    ]);
    const table = await readAbnXlsx(file);
    expect(table.header).toEqual(["Company name", "ABN/ACN", "Total R&D expenditure $"]);
    expect(table.rows).toHaveLength(1);
  });

  it("throws when no ABN column exists (wrong file)", async () => {
    const file = await writeWorkbook([
      {
        name: "Sheet1",
        rows: [
          ["foo", "bar"],
          [1, 2],
        ],
      },
    ]);
    await expect(readAbnXlsx(file)).rejects.toThrow(/no ABN-bearing sheet/);
  });
});

describe("selectLatestXlsxResource", () => {
  const resources: CkanResource[] = [
    { name: "2021-22 Report of Entity Tax Information", url: "https://x/2021-22.xlsx" },
    { name: "2023-24 Report of Entity Tax Information", url: "https://x/2023-24.xlsx" },
    { name: "2022-23 Report of Entity Tax Information", url: "https://x/2022-23.xlsx" },
    { name: "Explanatory notes", url: "https://x/notes.pdf" },
  ];

  it("picks the latest income-year .xlsx matching the substring", () => {
    const r = selectLatestXlsxResource(resources, "report of entity tax information");
    expect(r?.url).toBe("https://x/2023-24.xlsx");
  });

  it("returns undefined when nothing matches", () => {
    expect(selectLatestXlsxResource(resources, "banana")).toBeUndefined();
  });
});
