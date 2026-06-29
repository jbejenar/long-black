/**
 * long-black — release catalogue branding + generator.
 *
 * The ABN domain layer for crema's generic catalogue engine: branding (name,
 * tagline, the "businesses" noun, the per-state key pattern, data-source footer,
 * coffee-toned accent) + a thin wrapper that fetches the repo's releases and
 * writes the static HTML page. Each monthly release is independent (no patch
 * grouping), so the default `noGrouping` is used.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fetchReleases, processReleases, generateHTML, type CatalogueBranding } from "crema";

export const ABN_BRANDING: CatalogueBranding = {
  name: "long-black",
  tagline: "Australian businesses. Joined, flattened, and served.",
  noun: "businesses",
  keyLabel: "State",
  // Matches the per-state rows in a release body, e.g. "| NSW | 1,234 |". The
  // bucket set is exhaustive: the ABR StateEnum is closed (8 states/territories
  // + AAT, the Australian Antarctic Territory), and `stateKey` folds only
  // null/empty state into `other` — AAT keeps its own bucket, so it must be
  // listed here or its count would be silently dropped from the catalogue.
  keyPattern: /\|\s*(NSW|VIC|QLD|SA|WA|TAS|NT|ACT|AAT|OTHER)\s*\|\s*([0-9,]+)\s*\|/gi,
  schemaDocPath: "docs/DOCUMENT-SCHEMA.md",
  schemaLineDescription: "Each NDJSON line is one ABN document.",
  dataSourceHtml:
    'Data sourced from the <a href="https://data.gov.au/data/dataset/abn-bulk-extract" style="color: var(--accent);">ABR</a>, ' +
    "ASIC, and ACNC under Creative Commons Attribution 3.0 AU.",
  outputFormatsHtml:
    "Output formats: NDJSON (<code>.ndjson.gz</code>, per state) and Parquet (all ABNs).",
  // "long black" coffee tones.
  accent: { light: "#6f4e37", dark: "#caa472" },
};

/** Fetch releases for `repo` and write the catalogue HTML to `outPath`. */
export async function runCatalogue(options: {
  repo: string;
  outPath: string;
  token?: string;
  now: string;
}): Promise<{ releases: number }> {
  const { repo, outPath, token, now } = options;
  const ghReleases = await fetchReleases(repo, { token, userAgent: "long-black-catalogue" });
  const releases = processReleases(ghReleases, ABN_BRANDING);
  const html = generateHTML(repo, releases, ABN_BRANDING, now);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, html, "utf-8");
  return { releases: releases.length };
}
