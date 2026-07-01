/**
 * Unit tests for output.ts — split + gzip + metadata.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runOutput, stateKey, ABN_SOURCES } from "../../src/output.js";
import { ENRICHMENT_SOURCES } from "../../src/enrich.js";
import { XLSX_SOURCES } from "../../src/xlsx-sources.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = resolve(__dirname, "../../.tmp-test-output");

const DOCS = [
  { _id: "A1", state: "VIC" },
  { _id: "A2", state: "NSW" },
  { _id: "A3", state: "VIC" },
  { _id: "A4", state: null }, // → other
];

beforeAll(() => mkdirSync(TMP, { recursive: true }));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

describe("stateKey", () => {
  it("normalizes states and buckets null/empty to other", () => {
    expect(stateKey({ state: "VIC" })).toBe("vic");
    expect(stateKey({ state: null })).toBe("other");
    expect(stateKey({ state: "  " })).toBe("other");
    expect(stateKey({})).toBe("other");
  });
});

describe("runOutput", () => {
  it("splits per state, gzips each, and writes metadata with attribution", async () => {
    const ndjson = resolve(TMP, "all.ndjson");
    const outDir = resolve(TMP, "out");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(ndjson, DOCS.map((d) => JSON.stringify(d)).join("\n") + "\n");

    const result = await runOutput({
      ndjsonPath: ndjson,
      outputDir: outDir,
      version: "2026.06.28",
      schemaVersion: "0.4.0",
      sourceDates: { "ABR ABN Bulk Extract": "2026-06-25" },
    });

    expect(result.counts).toEqual({ vic: 2, nsw: 1, other: 1 });
    expect(result.gzFiles).toHaveLength(3);
    for (const gz of result.gzFiles) expect(existsSync(gz)).toBe(true);

    // a gz round-trips
    const vicGz = result.gzFiles.find((f) => f.includes("-vic."));
    const vic = gunzipSync(readFileSync(vicGz!)).toString("utf-8").trim().split("\n");
    expect(vic).toHaveLength(2);

    // metadata.json: counts + all sixteen CC-BY sources + an extract date
    const meta = JSON.parse(readFileSync(result.metadataPath, "utf-8"));
    expect(meta.totalCount).toBe(4);
    expect(meta.counts).toEqual({ vic: 2, nsw: 1, other: 1 });
    expect(meta.sources).toHaveLength(16);
    expect(meta.sources.every((s: { licence: string }) => /^CC-BY \d/.test(s.licence))).toBe(true);
    expect(meta.sources[0].extractDate).toBe("2026-06-25");
  });

  it("itemizes all sixteen datasets with a CC-BY attribution", () => {
    expect(ABN_SOURCES).toHaveLength(16);
    expect(ABN_SOURCES.every((s) => s.attribution?.startsWith("©"))).toBe(true);
    // All CC-BY (mostly 3.0 AU; the ATO R&D dataset is 2.5 AU — verified).
    expect(ABN_SOURCES.every((s) => /^CC-BY \d/.test(s.licence))).toBe(true);
    expect(ABN_SOURCES.some((s) => s.licence === "CC-BY 2.5 AU")).toBe(true);
    // No duplicate dataset names / URLs.
    expect(new Set(ABN_SOURCES.map((s) => s.name)).size).toBe(16);
    expect(new Set(ABN_SOURCES.map((s) => s.url)).size).toBe(16);
  });

  it("attributes every configured enrichment source in ABN_SOURCES (anti-drift)", () => {
    // Every data.gov.au-derived source (CSV via ENRICHMENT_SOURCES, XLSX via
    // XLSX_SOURCES) MUST have a matching ABN_SOURCES entry, so a future source
    // addition can't update the loader without also emitting its CC-BY attribution
    // in metadata.json. Each ABN_SOURCES url embeds the source's CKAN package id.
    const urls = ABN_SOURCES.map((s) => s.url);
    const packageIds = [
      ...ENRICHMENT_SOURCES.map((s) => s.packageId),
      ...XLSX_SOURCES.map((s) => s.packageId),
    ];
    for (const pkg of packageIds) {
      expect(
        urls.some((u) => u.includes(pkg)),
        `ABN_SOURCES missing attribution for "${pkg}"`,
      ).toBe(true);
    }
  });
});
