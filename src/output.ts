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

/**
 * Every public dataset joined into a document, itemized with its CC-BY attribution
 * (a licence requirement). Most are **CC-BY 3.0 AU**; the ATO R&D Tax Incentive
 * dataset's data.gov.au record is **CC-BY 2.5 AU** (verified). AusTender is CC-BY
 * 3.0 AU too — the OCP Data Registry is only the access route for the bulk file; the
 * dataset licence is the source's. Listed per-dataset (not per-publisher) so
 * `metadata.json` `sources[]` fully accounts for what each release is derived from.
 */
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
    name: "ASIC AFS Licensees",
    url: "https://data.gov.au/data/dataset/asic-afs-licensee",
    licence: "CC-BY 3.0 AU",
    attribution: "© Australian Securities and Investments Commission",
  },
  {
    name: "ASIC Credit Licensees",
    url: "https://data.gov.au/data/dataset/asic-credit-licensee",
    licence: "CC-BY 3.0 AU",
    attribution: "© Australian Securities and Investments Commission",
  },
  {
    name: "ASIC Banned & Disqualified Organisations",
    url: "https://data.gov.au/data/dataset/asic-banned-disqualified-org",
    licence: "CC-BY 3.0 AU",
    attribution: "© Australian Securities and Investments Commission",
  },
  {
    name: "ACNC Registered Charities",
    url: "https://data.gov.au/data/dataset/acnc-register",
    licence: "CC-BY 3.0 AU",
    attribution: "© Australian Charities and Not-for-profits Commission",
  },
  {
    name: "ACNC Annual Information Statement",
    url: "https://data.gov.au/data/dataset/acnc-2024-annual-information-statement-ais-data",
    licence: "CC-BY 3.0 AU",
    attribution: "© Australian Charities and Not-for-profits Commission",
  },
  {
    name: "AusTender Contract Notices (OCDS)",
    url: "https://data.open-contracting.org/en/publication/19",
    licence: "CC-BY 3.0 AU",
    attribution: "© Commonwealth of Australia (Department of Finance / AusTender)",
  },
  {
    name: "GrantConnect Grant Awards",
    url: "https://www.grants.gov.au/",
    licence: "CC-BY 3.0 AU",
    attribution: "© Commonwealth of Australia (Department of Finance / GrantConnect)",
  },
  {
    name: "ATO Corporate Tax Transparency",
    url: "https://data.gov.au/data/dataset/corporate-transparency",
    licence: "CC-BY 3.0 AU",
    attribution: "© Commonwealth of Australia (Australian Taxation Office)",
  },
  {
    name: "ATO R&D Tax Incentive",
    url: "https://data.gov.au/data/dataset/research-and-development-tax-incentive",
    // This dataset's data.gov.au record is CC-BY 2.5 Australia (not 3.0) — verified.
    licence: "CC-BY 2.5 AU",
    attribution: "© Commonwealth of Australia (Australian Taxation Office)",
  },
  {
    name: "ASIC AFS Authorised Representatives",
    url: "https://data.gov.au/data/dataset/asic-afs-authorised-representative",
    licence: "CC-BY 3.0 AU",
    attribution: "© Australian Securities and Investments Commission",
  },
  {
    name: "ASIC Credit Representatives",
    url: "https://data.gov.au/data/dataset/asic-credit-representative",
    licence: "CC-BY 3.0 AU",
    attribution: "© Australian Securities and Investments Commission",
  },
  {
    name: "WGEA Reporting Organisations",
    url: "https://data.gov.au/data/dataset/wgea-dataset",
    licence: "CC-BY 3.0 AU",
    attribution: "© Commonwealth of Australia (Workplace Gender Equality Agency)",
  },
  {
    name: "ASIC SMSF Auditors",
    url: "https://data.gov.au/data/dataset/asic-smsf",
    licence: "CC-BY 3.0 AU",
    attribution: "© Australian Securities and Investments Commission",
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
