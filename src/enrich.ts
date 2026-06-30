/**
 * long-black — enrichment source loaders (ASIC Company, ASIC Business Names,
 * ACNC charities).
 *
 * Each source is a public data.gov.au CSV keyed on ABN. The mechanism is uniform
 * and config-driven: discover the data CSV by stable package id → download →
 * build an all-`text` raw table from the file's real header (sniffHeader +
 * buildRawTableDdl, so the column count always matches the file) → COPY into it
 * (load-csv.ts) → run the per-source normalize `INSERT … SELECT` that casts dates
 * and projects into the typed staging table → drop the raw table. The flatten
 * (abn_full.sql) then joins the typed tables in.
 *
 * Delimiter + quoting are confirmed against the real files (verify-on-first-load):
 * the ASIC files are pure TSV with LITERAL `"`/`\` in values (quoting off); ACNC
 * is a true comma CSV with quoted fields (quoting on).
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { ckanResources, downloadFile, type CkanResource } from "crema";
import { sniffHeader, buildRawTableDdl, loadDelimitedRaw } from "./load-csv.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SQL_DIR = resolve(__dirname, "..", "sql");

export interface EnrichmentSource {
  /** Staging table name — also the local raw-file basename. */
  key:
    | "asic_company"
    | "asic_business_name"
    | "acnc_charity"
    | "acnc_ais"
    | "asic_afs_licence"
    | "asic_credit_licence"
    | "asic_banned_disqualified";
  /** Human label for logs. */
  label: string;
  /** Stable data.gov.au package id. */
  packageId: string;
  /** Field delimiter ("\t" for ASIC, "," for ACNC). */
  delimiter: string;
  /** RFC-4180 quoting (ACNC) vs pure TSV with literal quotes (ASIC). */
  quoting: boolean;
  /** Lower-cased substring identifying the data CSV among a package's resources. */
  resourceMatch: string;
  /** Normalize SQL filename under sql/. */
  normalizeSqlFile: string;
  /**
   * Minimum typed rows a healthy load produces — a completeness floor. A load
   * landing fewer (an empty/truncated CSV, the wrong resource picked, a normalize
   * that dropped everything) is treated as a failure, not a silent success. Set
   * to ~a third of the real 2026.06.24 counts (company 2.34M, business names
   * 2.62M, charities 65k — see docs/PERFORMANCE.md), so normal drift never trips
   * it but a collapsed load does.
   */
  minRows: number;
}

export const ENRICHMENT_SOURCES: EnrichmentSource[] = [
  {
    key: "asic_company",
    label: "ASIC Company",
    packageId: "asic-companies",
    delimiter: "\t",
    quoting: false,
    resourceMatch: "company",
    normalizeSqlFile: "normalize-asic-company.sql",
    minRows: 1_000_000, // real 2026.06.24: 2,342,141
  },
  {
    key: "asic_business_name",
    label: "ASIC Business Names",
    packageId: "asic-business-names",
    delimiter: "\t",
    quoting: false,
    resourceMatch: "business_names",
    normalizeSqlFile: "normalize-asic-business-name.sql",
    minRows: 1_000_000, // real 2026.06.24: 2,618,824
  },
  {
    key: "acnc_charity",
    label: "ACNC charities",
    packageId: "acnc-register",
    delimiter: ",",
    quoting: true,
    resourceMatch: "datadotgov_main",
    normalizeSqlFile: "normalize-acnc-charity.sql",
    minRows: 20_000, // real 2026.06.24: 65,270
  },
  {
    key: "acnc_ais",
    label: "ACNC AIS financials",
    // Pinned to a known AIS year (a reproducible snapshot, like GNAF_VERSION) —
    // each year is its own CKAN package. Bump the year here (a one-line change)
    // when the next AIS is published; the year is recorded in metadata via the
    // source. The main data CSV is `datadotgov_ais24`; the package also ships
    // `_programs`/`_group_members` resources, but the main file is the largest CSV
    // so selectEnrichmentResource picks it.
    packageId: "acnc-2024-annual-information-statement-ais-data",
    delimiter: ",",
    quoting: true,
    resourceMatch: "datadotgov_ais24",
    normalizeSqlFile: "normalize-acnc-ais.sql",
    minRows: 20_000, // real 2024 AIS: 53,665 filers
  },
  {
    key: "asic_afs_licence",
    label: "ASIC AFS Licensee",
    packageId: "asic-afs-licensee",
    delimiter: ",", // the "- Current" CSV is a real comma CSV (quoted)
    quoting: true,
    resourceMatch: "current", // distinguishes the data CSV from "National Map"/"Help File"
    normalizeSqlFile: "normalize-asic-afs-licence.sql",
    minRows: 1_000,
  },
  {
    key: "asic_credit_licence",
    label: "ASIC Credit Licensee",
    packageId: "asic-credit-licensee",
    delimiter: ",",
    quoting: true,
    resourceMatch: "current",
    normalizeSqlFile: "normalize-asic-credit-licence.sql",
    minRows: 1_000,
  },
  {
    key: "asic_banned_disqualified",
    label: "ASIC Banned & Disqualified Orgs",
    packageId: "asic-banned-disqualified-org",
    delimiter: "\t", // the "- Current" .csv is tab-delimited (ASIC quirk)
    quoting: false,
    resourceMatch: "current",
    normalizeSqlFile: "normalize-asic-banned-disqualified.sql",
    // Tiny, volatile source: the "Current" banned-org register is ~15 rows (most
    // bannings are of persons, not orgs). Floor catches a 0-row/wrong-file load
    // without tripping on natural fluctuation. Real 2026.06.24: 15 rows.
    minRows: 5,
  },
];

/** A resource is a CSV if CKAN says so or its URL ends in `.csv`. */
function isCsv(r: CkanResource): boolean {
  return (r.format ?? "").toUpperCase() === "CSV" || (r.url ?? "").toLowerCase().endsWith(".csv");
}

/**
 * Pick a source's data CSV: among CSV resources whose name or URL contains the
 * match substring, take the largest (the data file dwarfs any data-dictionary
 * CSV; size falls back to 0 when CKAN omits it, and ties keep discovery order).
 */
export function selectEnrichmentResource(
  resources: CkanResource[],
  match: string,
): CkanResource | undefined {
  const candidates = resources.filter(
    (r) => isCsv(r) && `${r.name ?? ""} ${r.url ?? ""}`.toLowerCase().includes(match.toLowerCase()),
  );
  return candidates.reduce<CkanResource | undefined>(
    (best, r) => (best === undefined || (r.size ?? 0) > (best.size ?? 0) ? r : best),
    undefined,
  );
}

/** Discover → download a source's CSV into dataDir. Returns the local file path. */
export async function downloadEnrichmentSource(
  source: EnrichmentSource,
  dataDir: string,
): Promise<string> {
  const resources = await ckanResources(source.packageId);
  const resource = selectEnrichmentResource(resources, source.resourceMatch);
  if (!resource?.url) {
    throw new Error(
      `no CSV resource matching "${source.resourceMatch}" in package "${source.packageId}"`,
    );
  }
  const dest = resolve(dataDir, `${source.key}.csv`);
  await downloadFile(resource.url, dest);
  return dest;
}

/**
 * Load one enrichment source into its typed staging table. The schema
 * (`abn_<schemaVersion>`) and the empty typed table must already exist
 * (staging-schema.sql). Returns the row count inserted into the typed table.
 */
export async function loadEnrichmentSource(options: {
  connectionString: string;
  schemaVersion: string;
  source: EnrichmentSource;
  file: string;
}): Promise<number> {
  const { connectionString, schemaVersion, source, file } = options;
  const schema = `abn_${schemaVersion}`;
  const rawTable = `${schema}.raw_${source.key}`;

  const header = await sniffHeader(file, source.delimiter, source.quoting);
  if (header.length === 0) throw new Error(`empty header in ${file}`);
  const ddl = buildRawTableDdl(rawTable, header);

  // 1. (Re)create the raw table from the real header.
  const setup = postgres(connectionString, { max: 1, max_lifetime: null });
  try {
    await setup.unsafe(`DROP TABLE IF EXISTS ${rawTable}`); // no cursor needed — DDL
    await setup.unsafe(ddl); // no cursor needed — DDL (rawTable from sniffed header)
  } finally {
    await setup.end();
  }

  // 2. COPY the file into the raw table (its own connection; deadlock-guarded).
  await loadDelimitedRaw({
    connectionString,
    file,
    rawTable,
    delimiter: source.delimiter,
    quoting: source.quoting,
  });

  // 3. Normalize raw → typed, count, then drop the (large) raw table.
  const normalizeSql = readFileSync(resolve(SQL_DIR, source.normalizeSqlFile), "utf-8").replace(
    /__SCHEMA_VERSION__/g,
    schemaVersion,
  );
  const run = postgres(connectionString, { max: 1, max_lifetime: null });
  try {
    await run.unsafe(normalizeSql); // no cursor needed — INSERT…SELECT + CREATE INDEX, returns no rows
    const counted = await run.unsafe(`SELECT count(*)::int AS n FROM ${schema}.${source.key}`); // no cursor needed — single-row aggregate
    await run.unsafe(`DROP TABLE IF EXISTS ${rawTable}`); // no cursor needed — free the all-text raw table before flatten
    return (counted[0] as unknown as { n: number }).n;
  } finally {
    await run.end();
  }
}
