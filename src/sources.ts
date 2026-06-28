/**
 * long-black — ABN data source config.
 *
 * The ABR ABN Bulk Extract on data.gov.au. Unlike flat-white's per-release
 * G-NAF dataset UUIDs, the ABN extract has a STABLE package id whose two ZIP
 * resources are refreshed in place — so discovery is by package id, no override
 * machinery needed.
 */

import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  ckanResources,
  selectResources,
  byFormat,
  downloadFile,
  extractZip,
  type CkanResource,
} from "crema";

/** Stable data.gov.au package id for the ABR ABN Bulk Extract. */
export const ABN_PACKAGE_ID = "abn-bulk-extract";

/** Output filename prefix for per-state split files. */
export const SPLIT_PREFIX = "long-black";

/**
 * Pick the two ZIP parts (`public_split_1_10.zip`, `public_split_11_20.zip`),
 * skipping the XSD schema, readme PDF, and resource-list CSV.
 */
export function selectAbnZips(resources: CkanResource[]): CkanResource[] {
  return selectResources(resources, byFormat("ZIP"));
}

/**
 * Discover → download → extract the ABN Bulk Extract. Returns the extracted
 * `*.xml` file paths (sorted) ready for load.ts.
 */
export async function downloadAbnExtract(dataDir: string): Promise<string[]> {
  const zips = selectAbnZips(await ckanResources(ABN_PACKAGE_ID));
  if (zips.length === 0) {
    throw new Error(`no ZIP resources found for package "${ABN_PACKAGE_ID}"`);
  }

  const xmlFiles: string[] = [];
  let part = 0;
  for (const zip of zips) {
    if (!zip.url) continue;
    part += 1;
    const zipPath = resolve(dataDir, `part-${part}.zip`);
    await downloadFile(zip.url, zipPath);
    const extractDir = resolve(dataDir, `part-${part}`);
    await extractZip(zipPath, extractDir);
    for (const file of readdirSync(extractDir)) {
      if (file.toLowerCase().endsWith(".xml")) xmlFiles.push(resolve(extractDir, file));
    }
  }
  return xmlFiles.sort();
}
