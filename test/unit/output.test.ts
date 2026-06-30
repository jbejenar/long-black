/**
 * Unit tests for output.ts — split + gzip + metadata.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runOutput, stateKey, ABN_SOURCES } from "../../src/output.js";

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

    // metadata.json: counts + all nine CC-BY sources + an extract date
    const meta = JSON.parse(readFileSync(result.metadataPath, "utf-8"));
    expect(meta.totalCount).toBe(4);
    expect(meta.counts).toEqual({ vic: 2, nsw: 1, other: 1 });
    expect(meta.sources).toHaveLength(9);
    expect(meta.sources.every((s: { licence: string }) => s.licence === "CC-BY 3.0 AU")).toBe(true);
    expect(meta.sources[0].extractDate).toBe("2026-06-25");
  });

  it("itemizes all nine datasets with CC-BY 3.0 AU attribution", () => {
    expect(ABN_SOURCES).toHaveLength(9);
    expect(ABN_SOURCES.every((s) => s.attribution?.startsWith("©"))).toBe(true);
    // AusTender's dataset licence is CC-BY 3.0 AU (not 4.0) — same as the others.
    expect(ABN_SOURCES.every((s) => s.licence === "CC-BY 3.0 AU")).toBe(true);
    // No duplicate dataset names / URLs.
    expect(new Set(ABN_SOURCES.map((s) => s.name)).size).toBe(9);
    expect(new Set(ABN_SOURCES.map((s) => s.url)).size).toBe(9);
  });
});
