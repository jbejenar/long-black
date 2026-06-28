/**
 * Unit tests for sources.ts — ABN source config (the pure selection logic;
 * download/extract are exercised by the real-data smoke).
 */

import { describe, it, expect } from "vitest";
import { ABN_PACKAGE_ID, SPLIT_PREFIX, selectAbnZips } from "../../src/sources.js";
import type { CkanResource } from "crema";

const RESOURCES: CkanResource[] = [
  { name: "Bulk Extract Schema", format: "XML", url: "https://x/bulkextract.xsd" },
  { name: "Readme", format: "PDF", url: "https://x/readme.pdf" },
  { name: "Part 1", format: "ZIP", url: "https://x/public_split_1_10.zip" },
  { name: "Part 2", format: "zip", url: "https://x/public_split_11_20.zip" },
  { name: "Resource List", format: "CSV", url: "https://x/resources.csv" },
];

describe("sources", () => {
  it("uses the stable abn-bulk-extract package id", () => {
    expect(ABN_PACKAGE_ID).toBe("abn-bulk-extract");
    expect(SPLIT_PREFIX).toBe("long-black");
  });

  it("selects exactly the two ZIP parts", () => {
    const zips = selectAbnZips(RESOURCES);
    expect(zips.map((z) => z.url)).toEqual([
      "https://x/public_split_1_10.zip",
      "https://x/public_split_11_20.zip",
    ]);
  });
});
