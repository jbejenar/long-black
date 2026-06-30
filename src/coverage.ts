/**
 * long-black — enrichment coverage gate.
 *
 * "The data must be complete before shipping." A clean flatten + schema-valid
 * output is not enough: if an enrichment source silently failed to load (empty
 * table, wrong CSV picked, a broken join), every nested object would be `null`
 * and the documents would still validate. This streams the flattened NDJSON once
 * and asserts the enrichment objects actually populate at plausible volumes, so a
 * build that lost a source of truth fails the gate instead of shipping hollow
 * documents.
 *
 * Floors are absolute minimum document counts (not fractions): the failure mode
 * we guard against is coverage collapsing toward zero, and an absolute floor
 * catches that robustly without tripping on normal year-to-year drift. They sit
 * far below the real coverage measured on the 2026.06.24 extract (see
 * docs/PERFORMANCE.md) — they are a floor, not an expectation.
 */

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

export interface CoverageFloors {
  /** Min docs with a non-null `company` object (ASIC Company). */
  company: number;
  /** Min docs with a non-null `charity` object (ACNC). */
  charity: number;
  /** Min docs with ≥1 `registeredBusinessNames[]` entry (ASIC Business Names). */
  registeredBusinessNames: number;
  /** Min docs with a non-null `financialServicesLicence` (ASIC AFS). */
  financialServicesLicence: number;
  /** Min docs with a non-null `creditLicence` (ASIC Credit). */
  creditLicence: number;
  /** Min docs with ≥1 `bannedDisqualified[]` entry (ASIC Banned/Disqualified). */
  bannedDisqualified: number;
}

export interface CoverageResult {
  total: number;
  company: number;
  charity: number;
  registeredBusinessNames: number;
  financialServicesLicence: number;
  creditLicence: number;
  bannedDisqualified: number;
  /** ABR-owned arrays — reported for visibility, not gated (always present). */
  businessNames: number;
  dgr: number;
  ok: boolean;
  /** Human-readable shortfall messages, one per floor not met. */
  shortfalls: string[];
}

/**
 * Conservative absolute floors for the real (~20M-ABN) build. Set well below the
 * coverage observed on 2026.06.24 so normal drift never trips them, while a
 * source that loaded ~nothing does. Fixture builds use far smaller floors (see
 * runtime callers) — these defaults are for the production dataset.
 */
export const ABN_COVERAGE_FLOORS: CoverageFloors = {
  // Real 2026.06.24: see docs/PERFORMANCE.md. Floors ≈ a third of observed.
  company: 1_000_000,
  charity: 20_000,
  registeredBusinessNames: 1_000_000,
  // Regulated & risk sources are small populations; floors confirmed on the real
  // extract (see docs/PERFORMANCE.md) and set well below observed. The banned-org
  // register is tiny (~12 matched ABNs) and volatile, so its floor is just enough
  // to catch a 0-row/wrong-file failure, not a hard expectation.
  financialServicesLicence: 1_000, // real: 6,300
  creditLicence: 1_000, // real: 3,939
  bannedDisqualified: 5, // real: 12
};

/**
 * Floors for the ~20-ABN fixture build: prove every enrichment join still
 * populates at least one document (catches a broken join in the dev loop / CI),
 * without the production volumes. Matches fixtures/expected-output.ndjson, which
 * carries 3 companies, 2 charities, and 2 registered-business-name holders.
 */
export const FIXTURE_COVERAGE_FLOORS: CoverageFloors = {
  company: 1,
  charity: 1,
  registeredBusinessNames: 1,
  financialServicesLicence: 1,
  creditLicence: 1,
  bannedDisqualified: 1,
};

function isNonEmptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

/**
 * Stream `ndjsonPath` and tally enrichment coverage. Constant memory — one line
 * at a time, no accumulation. Floors of 0 disable a given gate (fixture use).
 */
export async function checkEnrichmentCoverage(
  ndjsonPath: string,
  floors: CoverageFloors,
): Promise<CoverageResult> {
  const result: CoverageResult = {
    total: 0,
    company: 0,
    charity: 0,
    registeredBusinessNames: 0,
    financialServicesLicence: 0,
    creditLicence: 0,
    bannedDisqualified: 0,
    businessNames: 0,
    dgr: 0,
    ok: true,
    shortfalls: [],
  };

  const rl = createInterface({
    input: createReadStream(ndjsonPath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (line.length === 0) continue;
    const doc = JSON.parse(line) as Record<string, unknown>;
    result.total += 1;
    if (doc.company != null) result.company += 1;
    if (doc.charity != null) result.charity += 1;
    if (isNonEmptyArray(doc.registeredBusinessNames)) result.registeredBusinessNames += 1;
    if (doc.financialServicesLicence != null) result.financialServicesLicence += 1;
    if (doc.creditLicence != null) result.creditLicence += 1;
    if (isNonEmptyArray(doc.bannedDisqualified)) result.bannedDisqualified += 1;
    if (isNonEmptyArray(doc.businessNames)) result.businessNames += 1;
    if (isNonEmptyArray(doc.dgr)) result.dgr += 1;
  }

  const gates: [keyof CoverageFloors, number, number][] = [
    ["company", result.company, floors.company],
    ["charity", result.charity, floors.charity],
    ["registeredBusinessNames", result.registeredBusinessNames, floors.registeredBusinessNames],
    ["financialServicesLicence", result.financialServicesLicence, floors.financialServicesLicence],
    ["creditLicence", result.creditLicence, floors.creditLicence],
    ["bannedDisqualified", result.bannedDisqualified, floors.bannedDisqualified],
  ];
  for (const [name, got, min] of gates) {
    if (got < min) {
      result.ok = false;
      result.shortfalls.push(`${name}: ${got} < required ${min}`);
    }
  }
  return result;
}
