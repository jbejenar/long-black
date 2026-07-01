/**
 * Unit tests for parquet-output.ts — the ABN Parquet schema + row mapper, and a
 * round-trip of the committed fixture NDJSON through crema's convertToParquet.
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { ParquetReader } from "@dsnp/parquetjs";
import { convertToParquet } from "crema";
import { abnParquetRow, ABN_PARQUET_SCHEMA } from "../../src/parquet-output.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(__dirname, "../../fixtures/expected-output.ndjson");

const dirs: string[] = [];
function tmpDir(): string {
  const d = mkdtempSync(join(tmpdir(), "long-black-parquet-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("abnParquetRow", () => {
  it("maps scalars natively, arrays to JSON, and omits null scalars", () => {
    const row = abnParquetRow({
      _id: "51000000761",
      _version: "2026.06.28",
      abnStatus: "ACT",
      entityTypeCode: "PRV",
      gstRegistered: true,
      entityName: null, // null scalar → omitted
      businessNames: ["A", "B"],
      dgr: [],
      registeredBusinessNames: [{ name: "X", status: "Registered" }],
      company: null,
      charity: null,
    });
    expect(row._id).toBe("51000000761");
    expect(row.gstRegistered).toBe(true);
    expect("entityName" in row).toBe(false); // omitted (null)
    expect(row.businessNames).toBe('["A","B"]');
    expect(row.dgr).toBe("[]");
    expect(row.registeredBusinessNames).toBe('[{"name":"X","status":"Registered"}]');
    expect("company" in row).toBe(false); // null nested → omitted
  });

  it("serializes a present nested object to JSON", () => {
    const row = abnParquetRow({
      _id: "51000000761",
      _version: "v",
      abnStatus: "ACT",
      entityTypeCode: "PRV",
      gstRegistered: false,
      company: { acn: "000000761", name: "ACME PRIVATE PTY LTD" },
    });
    expect(JSON.parse(String(row.company))).toEqual({
      acn: "000000761",
      name: "ACME PRIVATE PTY LTD",
    });
  });
});

describe("convertToParquet on the fixture", () => {
  it("round-trips every fixture document through Parquet", async () => {
    const out = join(tmpDir(), "fixture.parquet");
    const expected = readFileSync(FIXTURE, "utf-8")
      .split("\n")
      .filter((l) => l.trim()).length;

    const { count } = await convertToParquet({
      inputPath: FIXTURE,
      outputPath: out,
      schema: ABN_PARQUET_SCHEMA,
      mapRow: abnParquetRow,
    });
    expect(count).toBe(expected);

    const reader = await ParquetReader.openFile(out);
    const cursor = reader.getCursor();
    const rows: Record<string, unknown>[] = [];
    let rec: unknown;
    while ((rec = await cursor.next())) rows.push(rec as Record<string, unknown>);
    await reader.close();

    expect(rows).toHaveLength(expected);
    for (const r of rows) {
      expect(typeof r._id).toBe("string");
      expect(typeof r.gstRegistered).toBe("boolean");
      expect(typeof r.isActive).toBe("boolean"); // derived scalar carried natively
      // Arrays / always-present objects → valid JSON.
      expect(Array.isArray(JSON.parse(String(r.businessNames)))).toBe(true);
      expect(Array.isArray(JSON.parse(String(r.registeredBusinessNames)))).toBe(true);
      expect(Array.isArray(JSON.parse(String(r.bannedDisqualified)))).toBe(true);
      const flags = JSON.parse(String(r.flags));
      expect(typeof flags.hasGovContracts).toBe("boolean");
    }
    // The 0.9.0+ fields must actually appear for the fixtures that carry them.
    expect(rows.some((r) => r.govSpend != null)).toBe(true);
    expect(rows.some((r) => r.financialServicesLicence != null)).toBe(true);
    expect(rows.some((r) => r.ageYears != null)).toBe(true);
  });
});
