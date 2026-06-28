/**
 * Unit tests for load.ts — the ABR XML parser (drift guard).
 *
 * If the ABR XML structure changes, parsing sample-abr.xml stops matching these
 * expected staging rows → CI catches it. (The COPY loader is exercised against a
 * live Postgres in the load integration / real-data smoke.)
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAbrXmlString, type AbnStagingRow } from "../../src/load.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SAMPLE = resolve(__dirname, "../../fixtures/sample-abr.xml");

const rows = parseAbrXmlString(readFileSync(SAMPLE, "utf-8"));

function row(abn: string): AbnStagingRow {
  const r = rows.find((x) => x.abn === abn);
  if (!r) throw new Error(`no row for ${abn}`);
  return r;
}

describe("parseAbrXmlString", () => {
  it("parses all five ABR records", () => {
    expect(rows.map((r) => r.abn)).toEqual([
      "51000000680",
      "51000000761",
      "51000000923",
      "51000001765",
      "51000000955",
    ]);
  });

  it("individual with two given names → joined given_names + family_name", () => {
    expect(row("51000000680")).toEqual({
      abn: "51000000680",
      abn_status: "ACT",
      abn_status_from_date: "1999-03-01",
      entity_type_code: "IND",
      entity_type_text: "Individual/Sole Trader",
      entity_name: null,
      given_names: "JOHN PETER",
      family_name: "SMITH",
      asic_number: null,
      asic_number_type: null,
      gst_status: null,
      gst_status_from_date: null,
      address_state: "NSW",
      address_postcode: "2000",
      business_names: [],
      trading_names: [],
      other_names: [],
      dgr: [],
      record_last_updated: 20260601,
    });
  });

  it("company with MN name, ACN, GST, and a business name", () => {
    const r = row("51000000761");
    expect(r.entity_name).toBe("ACME PRIVATE PTY LTD");
    expect(r.asic_number).toBe("000000761");
    expect(r.asic_number_type).toBe("ACN");
    expect(r.gst_status).toBe("ACT");
    expect(r.gst_status_from_date).toBe("2001-07-01");
    expect(r.business_names).toEqual(["ACME"]);
    expect(r.address_state).toBe("VIC");
  });

  it("routes DGR and trading names correctly", () => {
    const r = row("51000000923");
    expect(r.dgr).toEqual([
      { statusFromDate: "2012-01-01", status: null, name: "GIVING CO DGR FUND" },
    ]);
    expect(r.trading_names).toEqual(["TRADE CO"]);
    expect(r.business_names).toEqual([]);
  });

  it("individual with only a family name leaves given_names null", () => {
    const r = row("51000001765");
    expect(r.given_names).toBeNull();
    expect(r.family_name).toBe("MONONYM");
    expect(r.entity_name).toBeNull();
  });

  it("multiple DGRs (in order), ARBN type, and empty State", () => {
    const r = row("51000000955");
    expect(r.asic_number_type).toBe("ARBN");
    expect(r.gst_status).toBeNull();
    expect(r.address_state).toBe(""); // empty element preserved; doc-side coerces to null
    expect(r.dgr).toEqual([
      { statusFromDate: "2011-01-01", status: null, name: "DGR FUND A" },
      { statusFromDate: "2013-06-01", status: null, name: "DGR FUND B" },
    ]);
  });
});
