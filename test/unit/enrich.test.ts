/**
 * Unit tests for enrich.ts — the pure resource-selection logic + source config.
 * (downloadEnrichmentSource / loadEnrichmentSource hit the network + live DB and
 * are covered by the integration test.)
 */

import { describe, it, expect } from "vitest";
import type { CkanResource } from "crema";
import { ENRICHMENT_SOURCES, selectEnrichmentResource } from "../../src/enrich.js";

describe("ENRICHMENT_SOURCES config", () => {
  it("covers the eleven enrichment sources with distinct staging tables", () => {
    expect(ENRICHMENT_SOURCES.map((s) => s.key).sort()).toEqual([
      "acnc_ais",
      "acnc_charity",
      "asic_afs_licence",
      "asic_afs_rep",
      "asic_banned_disqualified",
      "asic_business_name",
      "asic_company",
      "asic_credit_licence",
      "asic_credit_rep",
      "asic_smsf_auditor",
      "wgea_reporter",
    ]);
  });

  it("uses the right delimiter/quoting per source", () => {
    const byKey = Object.fromEntries(ENRICHMENT_SOURCES.map((s) => [s.key, s]));
    // Company/business-names + banned-org + AFS reps are tab-delimited (ASIC quirk).
    expect(byKey.asic_company).toMatchObject({ delimiter: "\t", quoting: false });
    expect(byKey.asic_business_name).toMatchObject({ delimiter: "\t", quoting: false });
    expect(byKey.asic_banned_disqualified).toMatchObject({ delimiter: "\t", quoting: false });
    expect(byKey.asic_afs_rep).toMatchObject({ delimiter: "\t", quoting: false });
    expect(byKey.asic_smsf_auditor).toMatchObject({ delimiter: "\t", quoting: false });
    // ACNC (register + AIS) + AFS/credit licences + credit reps are real comma CSVs.
    expect(byKey.acnc_charity).toMatchObject({ delimiter: ",", quoting: true });
    expect(byKey.acnc_ais).toMatchObject({ delimiter: ",", quoting: true });
    expect(byKey.asic_afs_licence).toMatchObject({ delimiter: ",", quoting: true });
    expect(byKey.asic_credit_licence).toMatchObject({ delimiter: ",", quoting: true });
    expect(byKey.asic_credit_rep).toMatchObject({ delimiter: ",", quoting: true });
    expect(byKey.wgea_reporter).toMatchObject({ delimiter: ",", quoting: true });
  });

  it("sets a positive completeness floor (minRows) below the real volume", () => {
    // Real 2026.06.24 counts: company 2.34M, business names 2.62M, charities 65k.
    const byKey = Object.fromEntries(ENRICHMENT_SOURCES.map((s) => [s.key, s]));
    expect(byKey.asic_company.minRows).toBeGreaterThan(0);
    expect(byKey.asic_company.minRows).toBeLessThan(2_342_141);
    expect(byKey.asic_business_name.minRows).toBeLessThan(2_618_824);
    expect(byKey.acnc_charity.minRows).toBeLessThan(65_270);
    for (const s of ENRICHMENT_SOURCES) expect(s.minRows).toBeGreaterThan(0);
  });
});

describe("selectEnrichmentResource", () => {
  const resources: CkanResource[] = [
    {
      name: "Company Data Dictionary",
      format: "CSV",
      url: "https://x/company_dict.csv",
      size: 5_000,
    },
    { name: "Company", format: "CSV", url: "https://x/company_202606.csv", size: 394_000_000 },
    { name: "Company ZIP", format: "ZIP", url: "https://x/company_202606.zip", size: 78_000_000 },
  ];

  it("picks the largest CSV matching the substring (the data file, not a dictionary)", () => {
    const r = selectEnrichmentResource(resources, "company");
    expect(r?.url).toBe("https://x/company_202606.csv");
  });

  it("ignores non-CSV resources even if they match", () => {
    const r = selectEnrichmentResource([resources[2]], "company");
    expect(r).toBeUndefined();
  });

  it("matches on URL when CKAN omits the format but the URL ends in .csv", () => {
    const r = selectEnrichmentResource(
      [{ url: "https://x/datadotgov_main.csv", size: 50_000_000 }],
      "datadotgov_main",
    );
    expect(r?.url).toBe("https://x/datadotgov_main.csv");
  });

  it("returns undefined when nothing matches", () => {
    expect(selectEnrichmentResource(resources, "charity")).toBeUndefined();
  });

  it("latest-year strategy picks the newest snapshot even when an older one is larger", () => {
    // WGEA-style: historical annual per-ABN snapshots. Size is NOT recency — the older
    // 2021 file is larger, but 2022 must win (regression guard for silent-stale loads).
    const snapshots: CkanResource[] = [
      {
        name: "2021 per abn",
        url: "https://x/2021_included_organisations_per_abn.csv",
        size: 9_000_000,
      },
      {
        name: "2022 per abn",
        url: "https://x/2022_included_organisations_per_abn.csv",
        size: 1_000_000,
      },
      { name: "specifications", url: "https://x/2022_specifications.xlsx", size: 50_000 }, // not a CSV
    ];
    const latest = selectEnrichmentResource(
      snapshots,
      "included_organisations_per_abn",
      "latest-year",
    );
    expect(latest?.url).toBe("https://x/2022_included_organisations_per_abn.csv");
    // The default (largest) strategy would wrongly pick the bigger 2021 file.
    const largest = selectEnrichmentResource(
      snapshots,
      "included_organisations_per_abn",
      "largest",
    );
    expect(largest?.url).toBe("https://x/2021_included_organisations_per_abn.csv");
  });
});
