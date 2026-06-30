/**
 * Unit tests for gov-spend.ts — the OCDS extraction + aggregation logic (the parts
 * that don't need a live download): supplier-ABN pulling, integer-cent summation,
 * earliest dateSigned, ocid de-dup, and multi-supplier attribution.
 */

import { describe, it, expect, afterEach } from "vitest";
import { gzipSync } from "node:zlib";
import { writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractRelease, aggregateToRows, aggregateGovSpend } from "../../src/gov-spend.js";

describe("extractRelease", () => {
  it("pulls the supplier ABN (additionalIdentifiers AU-ABN), value in cents, earliest date", () => {
    const r = extractRelease({
      ocid: "ocds-1",
      parties: [
        {
          roles: ["supplier"],
          additionalIdentifiers: [{ scheme: "AU-ABN", id: "51000000761" }],
        },
        {
          roles: ["procuringEntity"],
          additionalIdentifiers: [{ scheme: "AU-ABN", id: "62950639680" }],
        },
      ],
      contracts: [
        { value: { amount: "1000.50" }, dateSigned: "2024-09-01T00:00:00Z" },
        { value: { amount: "500.00" }, dateSigned: "2018-03-15T00:00:00Z" },
      ],
    });
    expect(r.abns).toEqual(["51000000761"]); // only the supplier, not the procuring entity
    expect(r.cents).toBe(150050); // 1000.50 + 500.00
    expect(r.date).toBe("2018-03-15"); // earliest dateSigned
  });

  it("reads an ABN from the primary identifier too, and ignores non-AU-ABN schemes", () => {
    const r = extractRelease({
      parties: [
        {
          roles: ["supplier"],
          identifier: { scheme: "AU-ABN", id: "51 000 000 793" }, // spaces stripped
          additionalIdentifiers: [{ scheme: "GB-COH", id: "12345678" }],
        },
      ],
      contracts: [{ value: { amount: "200" } }],
    });
    expect(r.abns).toEqual(["51000000793"]);
    expect(r.cents).toBe(20000);
    expect(r.date).toBeNull();
  });

  it("yields no ABN for a foreign supplier (no AU-ABN)", () => {
    const r = extractRelease({
      parties: [{ roles: ["supplier"], additionalIdentifiers: [] }],
      contracts: [{ value: { amount: "999" } }],
    });
    expect(r.abns).toEqual([]);
  });

  it("returns each supplier once for a multi-supplier contract", () => {
    const r = extractRelease({
      parties: [
        { roles: ["supplier"], additionalIdentifiers: [{ scheme: "AU-ABN", id: "51000000761" }] },
        { roles: ["supplier"], additionalIdentifiers: [{ scheme: "AU-ABN", id: "51000000793" }] },
        // duplicate ABN on the same release must not double-count within the release
        { roles: ["supplier"], additionalIdentifiers: [{ scheme: "AU-ABN", id: "51000000761" }] },
      ],
      contracts: [{ value: { amount: "100" } }],
    });
    expect(r.abns.sort()).toEqual(["51000000761", "51000000793"]);
  });
});

describe("aggregateToRows", () => {
  it("formats cents as a 2-dp dollar string", () => {
    const rows = aggregateToRows(
      new Map([
        [
          "51000000761",
          { cents: 150050, contractCount: 2, firstDate: "2018-03-15", lastDate: "2024-09-01" },
        ],
      ]),
    );
    expect(rows[0]).toEqual({
      abn: "51000000761",
      totalValueAud: "1500.50",
      contractCount: 2,
      firstContractDate: "2018-03-15",
      lastContractDate: "2024-09-01",
    });
  });
});

describe("aggregateGovSpend (gzip stream)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function writeJsonlGz(lines: object[]): string {
    const d = mkdtempSync(join(tmpdir(), "lb-gov-"));
    dirs.push(d);
    const p = join(d, "gov.jsonl.gz");
    writeFileSync(p, gzipSync(Buffer.from(lines.map((l) => JSON.stringify(l)).join("\n") + "\n")));
    return p;
  }

  it("aggregates per ABN across releases, de-dupes ocids, sums and tracks date range", async () => {
    const rel = (ocid: string, abn: string, amount: string, date: string) => ({
      ocid,
      parties: [{ roles: ["supplier"], additionalIdentifiers: [{ scheme: "AU-ABN", id: abn }] }],
      contracts: [{ value: { amount }, dateSigned: date }],
    });
    const file = writeJsonlGz([
      rel("a", "51000000761", "1000.00", "2020-01-01"),
      rel("b", "51000000761", "500.50", "2022-06-01"),
      rel("b", "51000000761", "9999.00", "2023-01-01"), // duplicate ocid 'b' → skipped
      rel("c", "51000000793", "250000.00", "2021-11-20"),
    ]);
    const { agg, stats } = await aggregateGovSpend(file);
    const rows = aggregateToRows(agg).sort((a, b) => a.abn.localeCompare(b.abn));
    expect(rows).toEqual([
      {
        abn: "51000000761",
        totalValueAud: "1500.50",
        contractCount: 2,
        firstContractDate: "2020-01-01",
        lastContractDate: "2022-06-01",
      },
      {
        abn: "51000000793",
        totalValueAud: "250000.00",
        contractCount: 1,
        firstContractDate: "2021-11-20",
        lastContractDate: "2021-11-20",
      },
    ]);
    expect(stats).toEqual({
      releases: 3, // 4 lines, one is a duplicate ocid
      withSupplierAbn: 3,
      withValue: 3,
      withDate: 3,
      distinctAbns: 2,
    });
  });

  it("THROWS on a malformed JSON line (no silent skip)", async () => {
    const d = mkdtempSync(join(tmpdir(), "lb-gov-"));
    dirs.push(d);
    const p = join(d, "bad.jsonl.gz");
    writeFileSync(p, gzipSync(Buffer.from('{"ocid":"a","parties":[]}\n{ this is not json\n')));
    await expect(aggregateGovSpend(p)).rejects.toThrow(/malformed JSON at line 2/);
  });

  it("THROWS on a non-OCDS line (wrong file)", async () => {
    const file = writeJsonlGz([{ hello: "world" }]);
    await expect(aggregateGovSpend(file)).rejects.toThrow(/not a recognizable OCDS/);
  });

  it("THROWS on an empty file (no releases)", async () => {
    const d = mkdtempSync(join(tmpdir(), "lb-gov-"));
    dirs.push(d);
    const p = join(d, "empty.jsonl.gz");
    writeFileSync(p, gzipSync(Buffer.from("\n")));
    await expect(aggregateGovSpend(p)).rejects.toThrow(/no OCDS releases/);
  });
});
