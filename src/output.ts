/**
 * long-black — output stage.
 *
 * Splits the all-ABN NDJSON into per-state files (state → `other`), gzips each,
 * and writes metadata.json (per-state counts + per-source provenance + the
 * CC-BY attribution the licence requires). All three primitives come from crema.
 */

import { resolve } from "node:path";
import { split, compress, writeMetadata, convertToParquet, type SourceInfo } from "crema";
import { SPLIT_PREFIX } from "./sources.js";
import { ABN_PARQUET_SCHEMA, abnParquetRow } from "./parquet-output.js";

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
  /** Also emit an all-ABN `<prefix>-<version>.parquet` alongside the per-state gz. */
  parquet?: boolean;
}

export interface OutputResult {
  gzFiles: string[];
  metadataPath: string;
  counts: Record<string, number>;
  /** Path to the Parquet file, when `parquet` was requested. */
  parquetPath?: string;
}

/** Split → gzip → metadata (+ optional Parquet). Returns the output artifacts. */
export async function runOutput(options: OutputOptions): Promise<OutputResult> {
  const { ndjsonPath, outputDir, version, schemaVersion, sourceDates, parquet } = options;

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

  // Optional Parquet of the full (all-ABN) dataset — one columnar file consumers
  // can filter by the `state` column, complementing the per-state NDJSON.
  let parquetPath: string | undefined;
  if (parquet) {
    parquetPath = resolve(outputDir, `${SPLIT_PREFIX}-${version}.parquet`);
    await convertToParquet({
      inputPath: ndjsonPath,
      outputPath: parquetPath,
      schema: ABN_PARQUET_SCHEMA,
      mapRow: abnParquetRow,
    });
  }

  const metadataPath = resolve(outputDir, "metadata.json");
  await writeMetadata({
    ndjsonPath,
    outputPath: metadataPath,
    version,
    schemaVersion,
    keyFn: stateKey,
    outputFiles: [
      ...gzFiles.map((f) => f.split("/").pop() ?? f),
      ...(parquetPath ? [parquetPath.split("/").pop() ?? parquetPath] : []),
    ],
    sources,
  });

  return { gzFiles, metadataPath, counts: splitResult.counts, parquetPath };
}
