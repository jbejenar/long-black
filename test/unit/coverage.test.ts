/**
 * Unit tests for the enrichment coverage gate (src/coverage.ts) — the
 * "data must be complete before shipping" check.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkEnrichmentCoverage,
  FIXTURE_COVERAGE_FLOORS,
  type CoverageFloors,
} from "../../src/coverage.js";

let dir: string;
function ndjson(lines: object[]): string {
  const p = join(dir, `cov-${lines.length}-${Math.round(lines[0] ? 1 : 0)}.ndjson`);
  writeFileSync(p, lines.map((l) => JSON.stringify(l)).join("\n") + "\n", "utf-8");
  return p;
}

// A document with all enrichment present.
const full = {
  _id: "51824753556",
  company: { acn: "000000019", name: "X" },
  charity: { name: "Y", status: "Registered" },
  registeredBusinessNames: [{ name: "Z" }],
  businessNames: ["B"],
  dgr: [{ name: "D", statusFromDate: "2020-01-01" }],
};
// A bare ABR-only document — no enrichment.
const bare = {
  _id: "12345678901",
  company: null,
  charity: null,
  registeredBusinessNames: [],
  businessNames: [],
  dgr: [],
};

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "lb-cov-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("checkEnrichmentCoverage", () => {
  it("tallies coverage across the stream", async () => {
    const path = ndjson([full, bare, { ...full, _id: "a" }]);
    const cov = await checkEnrichmentCoverage(path, {
      company: 0,
      charity: 0,
      registeredBusinessNames: 0,
    });
    expect(cov.total).toBe(3);
    expect(cov.company).toBe(2);
    expect(cov.charity).toBe(2);
    expect(cov.registeredBusinessNames).toBe(2);
    expect(cov.businessNames).toBe(2);
    expect(cov.dgr).toBe(2);
    expect(cov.ok).toBe(true);
  });

  it("passes the fixture floors when each source populates at least one doc", async () => {
    const path = ndjson([full, bare, bare]);
    const cov = await checkEnrichmentCoverage(path, FIXTURE_COVERAGE_FLOORS);
    expect(cov.ok).toBe(true);
    expect(cov.shortfalls).toEqual([]);
  });

  it("FAILS with a shortfall when a source is entirely missing", async () => {
    // No charity anywhere → charity coverage 0 < floor 1.
    const path = ndjson([{ ...full, charity: null }, { ...bare }]);
    const cov = await checkEnrichmentCoverage(path, FIXTURE_COVERAGE_FLOORS);
    expect(cov.ok).toBe(false);
    expect(cov.shortfalls).toEqual(["charity: 0 < required 1"]);
  });

  it("reports every source below its floor", async () => {
    const floors: CoverageFloors = { company: 5, charity: 5, registeredBusinessNames: 5 };
    const cov = await checkEnrichmentCoverage(ndjson([full, bare]), floors);
    expect(cov.ok).toBe(false);
    expect(cov.shortfalls).toHaveLength(3);
  });
});
