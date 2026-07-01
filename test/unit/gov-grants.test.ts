/**
 * Unit tests for the GrantConnect loader's pure logic (src/gov-grants.ts):
 * XLSX parsing (data header found beneath the criteria preamble; ABN-less rows
 * skipped; value → integer cents) and per-ABN aggregation. The network paths
 * (login + report download) are exercised live during the real build, not here.
 */

import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { parseGaXlsx, aggregateGovGrants } from "../../src/gov-grants.js";

/** Build a workbook shaped like a real "Grant Award Published" export. */
async function makeGaXlsx(dataRows: unknown[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Grant Award Published");
  ws.addRow(["Grant Award Published"]); // title
  ws.addRow([]);
  ws.addRow(["Criteria Summary"]);
  ws.addRow(["Date Range", "1-Jun-2026 to 7-Jun-2026"]);
  ws.addRow([]);
  // Data header (a subset of the real 32 cols — the parser locates by name).
  ws.addRow(["Agency", "GA ID", "Recipient Name", "Recipient ABN", "Publish Date", "Value (AUD)"]);
  for (const r of dataRows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("parseGaXlsx", () => {
  it("finds the header, extracts ABN/value/date, skips ABN-less rows, counts all awards", async () => {
    const { rows, rawCount } = await parseGaXlsx(
      await makeGaXlsx([
        ["Health", "GA1", "Goodwin Aged Care", "82 120 298 946", new Date("2026-06-03"), 43739.61],
        ["Finance", "GA2", "An Individual", "", new Date("2026-06-04"), 5000], // no ABN → skipped
        ["Arts", "GA3", "Big Co", "51 000 000 761", new Date("2026-06-05"), 12450],
      ]),
    );
    expect(rows).toHaveLength(2); // the ABN-less individual is dropped from the joinable rows
    // rawCount counts EVERY award (incl. the ABN-less one) — the cap check depends on it.
    expect(rawCount).toBe(3);
    expect(rows[0]).toEqual({
      abn: "82120298946",
      valueCents: 4373961n, // 43739.61 → exact integer cents
      publishDate: "2026-06-03",
    });
    expect(rows[1].abn).toBe("51000000761");
    expect(rows[1].valueCents).toBe(1245000n);
  });

  it("throws when the data header is absent (format drift)", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("x");
    ws.addRow(["Grant Award Published"]);
    ws.addRow(["Agency", "GA ID", "Recipient Name"]); // no ABN/Value columns
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    await expect(parseGaXlsx(buf)).rejects.toThrow(/data header/i);
  });
});

describe("aggregateGovGrants", () => {
  it("sums value in exact cents per ABN, counts, and tracks first/last date", () => {
    const agg = aggregateGovGrants([
      { abn: "51000000761", valueCents: 100_00n, publishDate: "2022-05-01" },
      { abn: "51000000761", valueCents: 250_50n, publishDate: "2020-01-15" }, // earlier
      { abn: "51000000761", valueCents: 1n, publishDate: "2024-12-31" }, // latest
      { abn: "11000000000", valueCents: 999n, publishDate: null },
    ]);
    expect(agg).toHaveLength(2);
    // sorted by ABN ascending
    expect(agg[0].abn).toBe("11000000000");
    const acme = agg.find((a) => a.abn === "51000000761")!;
    expect(acme.totalValueCents).toBe(35051n); // 10000 + 25050 + 1
    expect(acme.grantCount).toBe(3);
    expect(acme.firstPublishDate).toBe("2020-01-15");
    expect(acme.lastPublishDate).toBe("2024-12-31");
    // a null publish date leaves first/last null
    expect(agg[0].firstPublishDate).toBeNull();
  });

  it("returns an empty array for no rows", () => {
    expect(aggregateGovGrants([])).toEqual([]);
  });
});
