/**
 * Unit tests for load-csv.ts — the delimited-line parser + header sniff.
 * (loadDelimitedRaw streams into Postgres COPY; exercised on real-data load.)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseDelimitedLine,
  sniffHeader,
  readDelimitedRecords,
  validateFieldCounts,
} from "../../src/load-csv.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = resolve(__dirname, "../../.tmp-test-loadcsv");

beforeAll(() => mkdirSync(TMP, { recursive: true }));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

describe("parseDelimitedLine", () => {
  it("splits a simple comma line", () => {
    expect(parseDelimitedLine("a,b,c", ",")).toEqual(["a", "b", "c"]);
  });

  it("splits a tab line (ASIC files are tab-delimited despite .csv)", () => {
    expect(parseDelimitedLine("ABN\tNAME\tSTATUS", "\t")).toEqual(["ABN", "NAME", "STATUS"]);
  });

  it("honors quoted fields with embedded delimiters", () => {
    expect(parseDelimitedLine('1,"SMITH, JOHN & CO",VIC', ",")).toEqual([
      "1",
      "SMITH, JOHN & CO",
      "VIC",
    ]);
  });

  it("honors escaped double quotes", () => {
    expect(parseDelimitedLine('"JOE""S CAFE",x', ",")).toEqual(['JOE"S CAFE', "x"]);
  });

  it("keeps empty trailing fields", () => {
    expect(parseDelimitedLine("a,,", ",")).toEqual(["a", "", ""]);
  });
});

describe("sniffHeader", () => {
  it("reads and parses the header row", async () => {
    const file = resolve(TMP, "h.csv");
    writeFileSync(file, "ABN\tCompany Name\tStatus\n51000000761\tACME\tRegistered\n");
    expect(await sniffHeader(file, "\t")).toEqual(["ABN", "Company Name", "Status"]);
  });
});

async function collectRecords(
  file: string,
  delimiter: string,
): Promise<Array<{ fields: string[]; line: number }>> {
  const out: Array<{ fields: string[]; line: number }> = [];
  for await (const r of readDelimitedRecords(file, delimiter)) out.push(r);
  return out;
}

describe("readDelimitedRecords", () => {
  it("yields one record per line for simple rows", async () => {
    const f = resolve(TMP, "simple.tsv");
    writeFileSync(f, "ABN\tNAME\n1\tACME\n2\tBETA\n");
    const recs = await collectRecords(f, "\t");
    expect(recs.map((r) => r.fields)).toEqual([
      ["ABN", "NAME"],
      ["1", "ACME"],
      ["2", "BETA"],
    ]);
    expect(recs.map((r) => r.line)).toEqual([1, 2, 3]);
  });

  it("assembles a quoted field spanning newlines into one record (RFC-4180)", async () => {
    const f = resolve(TMP, "multiline.csv");
    writeFileSync(f, 'a,b\n1,"line1\nline2"\n3,ok\n');
    const recs = await collectRecords(f, ",");
    expect(recs.map((r) => r.fields)).toEqual([
      ["a", "b"],
      ["1", "line1\nline2"],
      ["3", "ok"],
    ]);
    // The multi-line record starts at physical line 2; "3,ok" is physical line 4.
    expect(recs.map((r) => r.line)).toEqual([1, 2, 4]);
  });

  it("throws on an unterminated quoted field at EOF (COPY rejects it too)", async () => {
    const f = resolve(TMP, "unterminated.csv");
    writeFileSync(f, 'a,b\n1,"never closed\n');
    await expect(collectRecords(f, ",")).rejects.toThrow(/unterminated quoted field.*line 2/);
  });
});

describe("validateFieldCounts (the COPY-deadlock guard)", () => {
  it("returns the column count for a rectangular file", async () => {
    const f = resolve(TMP, "rect.tsv");
    writeFileSync(f, "a\tb\tc\n1\t2\t3\n4\t5\t6\n");
    expect(await validateFieldCounts(f, "\t")).toBe(3);
  });

  it("passes a file whose quoted field contains the delimiter and a newline", async () => {
    const f = resolve(TMP, "ml-ok.csv");
    writeFileSync(f, 'a,b\n1,"x, y\nz"\n2,w\n');
    expect(await validateFieldCounts(f, ",")).toBe(2);
  });

  it("rejects a ragged row, reporting the line number (expected vs got)", async () => {
    const f = resolve(TMP, "ragged.tsv");
    // line 3 has 2 fields; header set the expected width to 3.
    writeFileSync(f, "a\tb\tc\n1\t2\t3\n4\t5\n");
    await expect(validateFieldCounts(f, "\t")).rejects.toThrow(/at line 3:.*expected 3.*got 2/);
  });

  it("rejects a row with too many fields", async () => {
    const f = resolve(TMP, "wide.csv");
    writeFileSync(f, "a,b\n1,2\n3,4,5\n");
    await expect(validateFieldCounts(f, ",")).rejects.toThrow(/expected 2.*got 3/);
  });

  it("returns 0 for an empty file", async () => {
    const f = resolve(TMP, "empty.csv");
    writeFileSync(f, "");
    expect(await validateFieldCounts(f, ",")).toBe(0);
  });

  it("rejects an unterminated quoted field (the other COPY-error class)", async () => {
    const f = resolve(TMP, "unterminated-vfc.csv");
    writeFileSync(f, 'a,b\n1,"oops\n');
    await expect(validateFieldCounts(f, ",")).rejects.toThrow(/unterminated quoted field/);
  });

  it("rejects a same-width malformed record that field counts alone would miss", async () => {
    const f = resolve(TMP, "samewidth-malformed.csv");
    // `1,"2` parses to 2 fields — the same width as the header — so the field-count
    // check passes, but the open quote is unterminated and COPY would reject it.
    writeFileSync(f, 'a,b\n1,"2\n');
    await expect(validateFieldCounts(f, ",")).rejects.toThrow(/unterminated quoted field/);
  });

  it("rejects a mid-field stray quote (odd parity ⇒ unterminated)", async () => {
    const f = resolve(TMP, "stray-quote.csv");
    // `x,y"z` has one quote (odd parity); live COPY rejects it as unterminated.
    writeFileSync(f, 'a,b\nx,y"z\n');
    await expect(validateFieldCounts(f, ",")).rejects.toThrow(/unterminated quoted field/);
  });
});
