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
import { selectLatestXlsxResource, mapXlsxRows, XLSX_SOURCES } from "../../src/xlsx-sources.js";
import type { CkanResource } from "crema";
import type { XlsxTable } from "../../src/load-xlsx.js";

const CTT = XLSX_SOURCES.find((s) => s.key === "tax_transparency")!;
const RD = XLSX_SOURCES.find((s) => s.key === "rd_tax_incentive")!;

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

describe("mapXlsxRows — Corporate Tax Transparency", () => {
  const table = (rows: unknown[][]): XlsxTable => ({
    sheetName: "Income tax details",
    header: ["Name", "ABN", "Total income $", "Taxable income $", "Tax payable $", "Income year"],
    rows,
  });

  it("normalizes zero/negative/blank taxable & payable to null; keeps positive", () => {
    const { columns, lines } = mapXlsxRows(
      CTT,
      table([
        ["POS CO", 51000000793, 500000000, 45000000, 13500000, "2023-24"], // all positive
        ["ZERO CO", 51000000761, 120000000, 0, -5, "2023-24"], // ≤0 → null
        ["BLANK CO", 51000000842, 200000000, null, "", "2023-24"], // blank → null
      ]),
    );
    expect(columns).toBe("abn, income_year, total_income, taxable_income, tax_payable");
    expect(lines).toEqual([
      "51000000793\t2023-24\t500000000\t45000000\t13500000\n",
      "51000000761\t2023-24\t120000000\t\\N\t\\N\n",
      "51000000842\t2023-24\t200000000\t\\N\t\\N\n",
    ]);
  });

  it("skips a row with no total income (required) or a non-11-digit ABN", () => {
    const { lines } = mapXlsxRows(
      CTT,
      table([
        ["NO TOTAL", 51000000793, null, 1, 1, "2023-24"],
        ["BAD ABN", 123, 500000000, 1, 1, "2023-24"],
      ]),
    );
    expect(lines).toEqual([]);
  });

  it("throws if a required column is missing (format drift)", () => {
    const bad: XlsxTable = { sheetName: "x", header: ["Name", "ABN"], rows: [["X", 51000000793]] };
    expect(() => mapXlsxRows(CTT, bad)).toThrow(/column not found/);
  });
});

describe("mapXlsxRows — R&D Tax Incentive", () => {
  it("maps ABN and ACN rows; routes 9-digit ACN via padStart", () => {
    const { lines } = mapXlsxRows(RD, {
      sheetName: "2022-23 Report",
      header: ["Company name", "ABN/ACN", "Total R&D expenditure (…) $", "Income Year"],
      rows: [
        ["ABN CO", 95608464535, 449266, "2022-23"],
        ["ACN CO", 4000000, 70421, "2022-23"], // 7 digits → padStart to 9 → "004000000"
      ],
    });
    expect(lines).toEqual([
      "95608464535\t\\N\t2022-23\t449266\n",
      "\\N\t004000000\t2022-23\t70421\n",
    ]);
  });

  it("THROWS when only an 'amended' R&D column exists (Bug-1: no silent null)", () => {
    const amendedOnly: XlsxTable = {
      sheetName: "x",
      header: ["Company name", "ABN/ACN", "Total amended R&D expenditure (…) $", "Income Year"],
      rows: [["X", 95608464535, 1, "2022-23"]],
    };
    expect(() => mapXlsxRows(RD, amendedOnly)).toThrow(/R&D expenditure column/);
  });

  it("THROWS when the R&D expenditure column is missing entirely", () => {
    const missing: XlsxTable = {
      sheetName: "x",
      header: ["Company name", "ABN/ACN", "Income Year"],
      rows: [["X", 95608464535, "2022-23"]],
    };
    expect(() => mapXlsxRows(RD, missing)).toThrow(/R&D expenditure column/);
  });
});
