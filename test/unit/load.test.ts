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
import { csvLines, parseAbrXmlString, type AbnStagingRow } from "../../src/load.js";

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

  // The COPY loader's error-propagation (reject, never hang) relies on saxes
  // *throwing* on malformed input rather than only emitting an error event. If a
  // saxes upgrade ever changed that, loadAbnFiles would silently swallow the
  // error and the pipeline could hang — so pin the throw here.
  it("throws on malformed XML (so the load pipeline rejects rather than hangs)", () => {
    expect(() => parseAbrXmlString("<Transfer><ABR><ABN>11<UNCLOSED")).toThrow();
  });
});

describe("csvLines (multi-file COPY source)", () => {
  const expectedAbns = rows.map((r) => r.abn);

  async function collect(files: string[]): Promise<{ lines: string[]; rowCalls: number }> {
    const lines: string[] = [];
    let rowCalls = 0;
    for await (const line of csvLines(files, () => rowCalls++)) lines.push(line);
    return { lines, rowCalls };
  }

  // The whole point of the single-pipeline refactor: many independent XML
  // documents (each its own `<?xml?>`/`<Transfer>` root) flow through one source
  // by giving *each file* its own parser. Feeding >10 files here is also the
  // structural guard for the listener leak (PR #3, Bug 1) — loadAbnFiles wraps
  // exactly this generator in one `pipeline`, so there is no per-file writable
  // re-pipe to accumulate listeners. (The live-Postgres no-warning assertion is
  // in test/integration/load-copy.test.ts.)
  it("concatenates many files in order, each parsed independently", async () => {
    const files = Array.from({ length: 12 }, () => SAMPLE);
    const { lines, rowCalls } = await collect(files);

    expect(lines.length).toBe(rows.length * 12);
    expect(rowCalls).toBe(rows.length * 12);

    // Every emitted line is a CSV row whose first field is the ABN, and the
    // 5-ABN sequence repeats once per file — proving file boundaries reset state.
    const abnsInOrder = lines.map((l) => l.split(",")[0]);
    const expectedSequence = Array.from({ length: 12 }, () => expectedAbns).flat();
    expect(abnsInOrder).toEqual(expectedSequence);
  });

  it("yields nothing for an empty file list", async () => {
    const { lines, rowCalls } = await collect([]);
    expect(lines).toEqual([]);
    expect(rowCalls).toBe(0);
  });
});
