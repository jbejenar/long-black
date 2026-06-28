/**
 * Unit tests for load-csv.ts — the delimited-line parser + header sniff.
 * (loadDelimitedRaw streams into Postgres COPY; exercised on real-data load.)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDelimitedLine, sniffHeader } from "../../src/load-csv.js";

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
