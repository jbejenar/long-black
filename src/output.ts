/**
 * long-black — output stage.
 *
 * Splits the all-ABN NDJSON into per-state files (state → `other`), gzips each,
 * and writes metadata.json (per-state counts + per-source provenance + the
 * CC-BY attribution the licence requires). All three primitives come from crema.
 */

import { resolve } from "node:path";
import { split, compress, writeMetadata, type SourceInfo } from "crema";
import { SPLIT_PREFIX } from "./sources.js";

/** The four public sources, with their CC-BY attribution (licence requirement). */
export const ABN_SOURCES: SourceInfo[] = [
  {
    name: "ABR ABN Bulk Extract",
    url: "https://data.gov.au/data/dataset/abn-bulk-extract",
    licence: "CC-BY 3.0 AU",
    attribution: "© Commonwealth of Australia (Australian Business Register)",
  },
  {
    name: "ASIC Company Dataset",
    url: "https://data.gov.au/data/dataset/asic-companies",
    licence: "CC-BY 3.0 AU",
    attribution: "© Australian Securities and Investments Commission",
  },
  {
    name: "ASIC Business Names Dataset",
    url: "https://data.gov.au/data/dataset/asic-business-names",
    licence: "CC-BY 3.0 AU",
    attribution: "© Australian Securities and Investments Commission",
  },
  {
    name: "ACNC Registered Charities",
    url: "https://data.gov.au/data/dataset/acnc-register",
    licence: "CC-BY 3.0 AU",
    attribution: "© Australian Charities and Not-for-profits Commission",
  },
];

/** Normalize a document's state to a split/metadata key (matches crema split). */
export function stateKey(doc: Record<string, unknown>): string {
  const raw = doc.state;
  if (raw == null) return "other";
  const s = String(raw).trim();
  return s === "" ? "other" : s.toLowerCase();
}

export interface OutputOptions {
  ndjsonPath: string;
  outputDir: string;
  version: string;
  schemaVersion: string;
  /** Per-source extract dates, keyed by source name. */
  sourceDates?: Record<string, string>;
}

export interface OutputResult {
  gzFiles: string[];
  metadataPath: string;
  counts: Record<string, number>;
}

/** Split → gzip → metadata. Returns the gzipped per-state files + metadata path. */
export async function runOutput(options: OutputOptions): Promise<OutputResult> {
  const { ndjsonPath, outputDir, version, schemaVersion, sourceDates } = options;

  const splitResult = await split({
    inputPath: ndjsonPath,
    outputDir,
    version,
    prefix: SPLIT_PREFIX,
  });

  const gzFiles: string[] = [];
  for (const file of splitResult.outputFiles) {
    const gz = `${file}.gz`;
    await compress({ inputPath: file, outputPath: gz });
    gzFiles.push(gz);
  }

  const sources: SourceInfo[] = ABN_SOURCES.map((s) =>
    sourceDates?.[s.name] ? { ...s, extractDate: sourceDates[s.name] } : s,
  );

  const metadataPath = resolve(outputDir, "metadata.json");
  await writeMetadata({
    ndjsonPath,
    outputPath: metadataPath,
    version,
    schemaVersion,
    keyFn: stateKey,
    outputFiles: gzFiles.map((f) => f.split("/").pop() ?? f),
    sources,
  });

  return { gzFiles, metadataPath, counts: splitResult.counts };
}
