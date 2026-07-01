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

const ZERO: CoverageFloors = {
  company: 0,
  charity: 0,
  charityFinancials: 0,
  registeredBusinessNames: 0,
  financialServicesLicence: 0,
  creditLicence: 0,
  bannedDisqualified: 0,
  govSpend: 0,
  govGrants: 0,
  taxTransparency: 0,
  rdTaxIncentive: 0,
  afsAuthorisedRep: 0,
  creditRep: 0,
  wgeaReporter: 0,
  smsfAuditor: 0,
};

// A document with all enrichment present.
const full = {
  _id: "51824753556",
  company: { acn: "000000019", name: "X" },
  charity: { name: "Y", status: "Registered", financials: { totalRevenue: 100 } },
  registeredBusinessNames: [{ name: "Z" }],
  financialServicesLicence: { number: "240001" },
  creditLicence: { number: "390001" },
  bannedDisqualified: [{ type: "AFS banning" }],
  govSpend: { totalValueAud: 1000, contractCount: 1 },
  govGrants: { totalValueAud: 500, grantCount: 1 },
  taxTransparency: { incomeYear: "2023-24", totalIncome: 100 },
  rdTaxIncentive: { incomeYear: "2022-23", totalRdExpenditure: 50 },
  afsAuthorisedRep: { number: "R1" },
  creditRep: { number: "CR1" },
  wgeaReporter: { primaryAbn: "51000000761", primaryOrganisation: "ACME GROUP" },
  smsfAuditor: { number: "100261694", status: "Registered" },
  businessNames: ["B"],
  dgr: [{ name: "D", statusFromDate: "2020-01-01" }],
};
// A bare ABR-only document — no enrichment.
const bare = {
  _id: "12345678901",
  company: null,
  charity: null,
  registeredBusinessNames: [],
  financialServicesLicence: null,
  creditLicence: null,
  bannedDisqualified: [],
  govSpend: null,
  govGrants: null,
  taxTransparency: null,
  rdTaxIncentive: null,
  afsAuthorisedRep: null,
  creditRep: null,
  wgeaReporter: null,
  smsfAuditor: null,
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
    const cov = await checkEnrichmentCoverage(path, ZERO);
    expect(cov.total).toBe(3);
    expect(cov.company).toBe(2);
    expect(cov.charity).toBe(2);
    expect(cov.charityFinancials).toBe(2);
    expect(cov.registeredBusinessNames).toBe(2);
    expect(cov.financialServicesLicence).toBe(2);
    expect(cov.creditLicence).toBe(2);
    expect(cov.bannedDisqualified).toBe(2);
    expect(cov.govSpend).toBe(2);
    expect(cov.govGrants).toBe(2);
    expect(cov.taxTransparency).toBe(2);
    expect(cov.rdTaxIncentive).toBe(2);
    expect(cov.afsAuthorisedRep).toBe(2);
    expect(cov.creditRep).toBe(2);
    expect(cov.wgeaReporter).toBe(2);
    expect(cov.smsfAuditor).toBe(2);
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
    // No charity anywhere → both charity AND charity.financials coverage 0 < floor 1.
    const path = ndjson([{ ...full, charity: null }, { ...bare }]);
    const cov = await checkEnrichmentCoverage(path, FIXTURE_COVERAGE_FLOORS);
    expect(cov.ok).toBe(false);
    expect(cov.shortfalls).toEqual([
      "charity: 0 < required 1",
      "charityFinancials: 0 < required 1",
    ]);
  });

  it("FAILS for charity.financials even when the charity itself is present", async () => {
    // A registered charity with no AIS filed → charity ok, charityFinancials short.
    const noAis = { ...full, charity: { name: "Y", status: "Registered", financials: null } };
    const cov = await checkEnrichmentCoverage(ndjson([noAis, noAis]), FIXTURE_COVERAGE_FLOORS);
    expect(cov.charity).toBe(2);
    expect(cov.charityFinancials).toBe(0);
    expect(cov.ok).toBe(false);
    expect(cov.shortfalls).toEqual(["charityFinancials: 0 < required 1"]);
  });

  it("reports every source below its floor", async () => {
    const floors: CoverageFloors = {
      company: 5,
      charity: 5,
      charityFinancials: 5,
      registeredBusinessNames: 5,
      financialServicesLicence: 5,
      creditLicence: 5,
      bannedDisqualified: 5,
      govSpend: 5,
      govGrants: 5,
      taxTransparency: 5,
      rdTaxIncentive: 5,
      afsAuthorisedRep: 5,
      creditRep: 5,
      wgeaReporter: 5,
      smsfAuditor: 5,
    };
    const cov = await checkEnrichmentCoverage(ndjson([full, bare]), floors);
    expect(cov.ok).toBe(false);
    expect(cov.shortfalls).toHaveLength(15);
  });
});
