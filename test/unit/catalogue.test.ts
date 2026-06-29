/**
 * Unit test for catalogue.ts — the ABN branding drives crema's catalogue engine
 * (body parsing + HTML) correctly for long-black's release-note format.
 */

import { describe, it, expect } from "vitest";
import { processReleases, generateHTML, type GitHubRelease } from "crema";
import { ABN_BRANDING } from "../../src/catalogue.js";

// This body mirrors the EXACT shape build.yml emits (jq-rendered plain numbers,
// a markdown header + separator row, and the `Schema: v…` line) — so the test
// is a real contract guard: if the release-notes format drifts from what
// ABN_BRANDING.keyPattern parses, this fails.
const release: GitHubRelease = {
  tag_name: "v2026.06.28",
  name: "v2026.06.28",
  published_at: "2026-06-28T10:00:00Z",
  html_url: "https://github.com/jbejenar/long-black/releases/tag/v2026.06.28",
  body: [
    "Australian Business (ABN) data — one NDJSON document per ABN, split per state.",
    "Source: ABR ABN Bulk Extract, extract 2026.06.28.",
    "",
    "**20295936** businesses.",
    "",
    "| State | Businesses |",
    "| --- | ---: |",
    "| NSW | 6500000 |",
    "| VIC | 5000000 |",
    "| AAT | 3 |",
    "| OTHER | 1000 |",
    "",
    "Schema: v0.7.0",
  ].join("\n"),
  assets: [
    { name: "long-black-2026.06.28-nsw.ndjson.gz", browser_download_url: "u1", size: 1_048_576 },
    { name: "long-black-2026.06.28.parquet", browser_download_url: "u2", size: 4_194_304 },
    { name: "manifest.json", browser_download_url: "u3", size: 512 },
  ],
  draft: false,
  prerelease: false,
};

describe("ABN_BRANDING via crema catalogue engine", () => {
  it("parses long-black's release body (businesses count + per-state table)", () => {
    const [r] = processReleases([release], ABN_BRANDING);
    expect(r.totalCount).toBe(20_295_936);
    expect(r.schemaVersion).toBe("0.7.0");
    // AAT (Australian Antarctic Territory) is its own bucket — stateKey only
    // folds null/empty into `other` — so the catalogue must parse it, not drop it.
    expect(r.keys).toEqual([
      { key: "NSW", count: 6_500_000 },
      { key: "VIC", count: 5_000_000 },
      { key: "AAT", count: 3 },
      { key: "OTHER", count: 1_000 },
    ]);
    // .ndjson.gz + .parquet are data assets; manifest.json is dropped by the filter.
    expect(r.assets.map((a) => a.name)).toEqual([
      "long-black-2026.06.28-nsw.ndjson.gz",
      "long-black-2026.06.28.parquet",
    ]);
  });

  it("renders long-black branding into the HTML", () => {
    const releases = processReleases([release], ABN_BRANDING);
    const html = generateHTML("jbejenar/long-black", releases, ABN_BRANDING, "2026-06-29");
    expect(html).toContain("<h1>long-black</h1>");
    expect(html).toContain("Australian businesses. Joined, flattened, and served.");
    expect(html).toContain("20,295,936 businesses");
    expect(html).toContain("docs/DOCUMENT-SCHEMA.md");
    expect(html).toContain("ABR"); // data-source footer
    expect(html).not.toContain("draft"); // no draft leakage
  });
});
