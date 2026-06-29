/**
 * Integration test for the enrichment loaders — the live-Postgres path from a
 * real-header sample CSV through COPY + normalize into the typed staging table.
 *
 * Gated on DATABASE_URL (set in CI's quality job); skipped on a plain `npm test`.
 *   DATABASE_URL=postgres://postgres:postgres@localhost:5433/abn npm test
 *
 * Proves, against the actual file shapes confirmed on data.gov.au:
 *   - ASIC company: only current-name rows load (1 row per ABN), DRGD→Deregistered,
 *     unknown codes pass through raw, no-ABN rows are skipped.
 *   - ASIC business names: literal `"`/`\` survive, leading spaces are trimmed,
 *     1:N holds (two names for one ABN), bad-ABN rows are skipped.
 *   - ACNC: status is the constant 'Registered', subtype projects the priority
 *     purpose (PBI over education), embedded commas survive CSV quoting, NULLs
 *     flow, bad-ABN rows are skipped.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { ENRICHMENT_SOURCES, loadEnrichmentSource } from "../../src/enrich.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIX = resolve(__dirname, "../../fixtures");
const SQL = resolve(__dirname, "../../sql");
const DB = process.env.DATABASE_URL;
const SV = "00000000"; // test schema abn_00000000

const byKey = Object.fromEntries(ENRICHMENT_SOURCES.map((s) => [s.key, s]));

describe.skipIf(!DB)("enrichment load (live COPY + normalize)", () => {
  const sql = postgres(DB as string, { max: 1 });

  beforeAll(async () => {
    const schema = readFileSync(resolve(SQL, "staging-schema.sql"), "utf-8").replace(
      /__SCHEMA_VERSION__/g,
      SV,
    );
    await sql.unsafe(`DROP SCHEMA IF EXISTS abn_${SV} CASCADE`); // no cursor needed — test setup
    await sql.unsafe(schema); // no cursor needed — DDL setup
    for (const key of ["asic_company", "asic_business_name", "acnc_charity"] as const) {
      await loadEnrichmentSource({
        connectionString: DB as string,
        schemaVersion: SV,
        source: byKey[key],
        file: resolve(FIX, fileFor(key)),
      });
    }
  }, 60_000);

  afterAll(async () => {
    await sql.unsafe(`DROP SCHEMA IF EXISTS abn_${SV} CASCADE`); // no cursor needed — teardown
    await sql.end();
  });

  function fileFor(key: string): string {
    return {
      asic_company: "sample-asic-company.csv",
      asic_business_name: "sample-asic-business-names.csv",
      acnc_charity: "sample-acnc.csv",
    }[key] as string;
  }

  async function query<T>(text: string): Promise<T[]> {
    return (await sql.unsafe(text)) as unknown as T[]; // no cursor needed — bounded fixture assertion
  }

  it("ASIC company: current rows only, status expansion, no-ABN skipped", async () => {
    type Row = {
      abn: string;
      company_name: string;
      status: string;
      reg: string | null;
      dereg: string | null;
    };
    const rows = await query<Row>(
      `SELECT abn, company_name, status, registration_date::text AS reg,
              deregistration_date::text AS dereg
       FROM abn_${SV}.asic_company ORDER BY abn`,
    );
    expect(rows.map((r) => r.abn)).toEqual(["51000000761", "51000000999", "51000001846"]);
    const by = Object.fromEntries(rows.map((r) => [r.abn, r]));
    expect(by["51000000761"]).toMatchObject({
      company_name: "ACME PRIVATE PTY LTD", // the current (Y) row, not the former name
      status: "Registered", // REGD expanded
      reg: "2001-06-15",
      dereg: null,
    });
    expect(by["51000001846"]).toMatchObject({ status: "Deregistered", dereg: "2024-05-01" });
    expect(by["51000000999"]).toMatchObject({ status: "EXAD" }); // unknown code passes through raw
  });

  it("ASIC business names: literal quotes/backslash, trimmed, 1:N, bad ABN skipped", async () => {
    type Row = { abn: string; business_name: string };
    const rows = await query<Row>(
      `SELECT abn, business_name FROM abn_${SV}.asic_business_name ORDER BY abn, business_name`,
    );
    expect(rows).toHaveLength(4);
    const names = rows.map((r) => r.business_name);
    expect(names).toContain("ACME BRANDS"); // leading spaces trimmed
    expect(names).toContain('MANY NAMES "QUOTED" CONSULTING'); // literal quotes preserved
    expect(names).toContain("C:\\PATH BRAND"); // literal backslash preserved
    // 1:N — both names for 51000001571 present.
    expect(rows.filter((r) => r.abn === "51000001571")).toHaveLength(2);
    // bad ABN (123) skipped.
    expect(rows.some((r) => r.abn.trim() === "123")).toBe(false);
  });

  it("ACNC: constant status, subtype priority, embedded comma, NULLs, bad ABN skipped", async () => {
    type Row = {
      abn: string;
      charity_name: string;
      status: string;
      size: string | null;
      subtype: string | null;
      reg: string | null;
    };
    const rows = await query<Row>(
      `SELECT abn, charity_name, status, size, subtype, registration_date::text AS reg
       FROM abn_${SV}.acnc_charity ORDER BY abn`,
    );
    expect(rows.map((r) => r.abn)).toEqual(["51000000810", "51000000923", "51000009999"]);
    const by = Object.fromEntries(rows.map((r) => [r.abn, r]));
    // PBI wins over Advancing_Education (priority order).
    expect(by["51000000810"]).toMatchObject({
      charity_name: "THE SMITH FAMILY, INC", // embedded comma survived CSV quoting
      status: "Registered",
      subtype: "Public Benevolent Institution",
    });
    expect(by["51000000923"]).toMatchObject({
      subtype: "Advancing education",
      size: "Medium",
      reg: "2012-06-01",
    });
    // no purpose flags, no dates → NULL subtype / size / registration_date.
    expect(by["51000009999"]).toMatchObject({ subtype: null, size: null, reg: null });
  });
});
