/**
 * long-black — Excel-only enrichment sources (ATO Corporate Tax Transparency and
 * R&D Tax Incentive). Both are single annual `.xlsx` files on data.gov.au keyed on
 * the entity's ABN; the loader picks the LATEST income-year resource, reads the
 * ABN-bearing sheet (src/load-xlsx.ts), maps + routes each row, and bulk-COPYs into
 * the typed staging table. This is the XLSX analogue of the CSV `enrich.ts` seam —
 * separate because these need workbook parsing, not a COPY-from-file.
 *
 * Corporate Tax Transparency is ABN-only (the key column is literally "ABN", all
 * 11-digit → tax_transparency.abn). R&D uses an "ABN/ACN" column, so its ~1.5% of
 * 9-digit ACN rows are routed to `acn` and matched via abn.asic_number in the flatten
 * (the same type-guarded two-path used by the ASIC AFS/credit sources) rather than
 * dropped. verify-on-first-load (2026-07): CTT sheet "Income tax details" cols
 * `Name, ABN, Total income $, Taxable income $, Tax payable $, Income year` (taxable/
 * tax blank when ≤0); R&D sheet "<year> Report" cols `Company name, ABN/ACN, Total R&D
 * expenditure … $, Total amended R&D expenditure … $, Income Year`.
 */

import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { resolve } from "node:path";
import postgres from "postgres";
import { ckanResources, downloadFile, type CkanResource } from "crema";
import { readAbnXlsx, headerIndex, cellDigits, cellNumber, type XlsxTable } from "./load-xlsx.js";

export interface XlsxSource {
  key: "tax_transparency" | "rd_tax_incentive";
  label: string;
  packageId: string;
  /** Lower-cased substring identifying the annual data resources within the package. */
  resourceMatch: string;
  /** Completeness floor — a load below this is treated as a failed/incomplete source. */
  minRows: number;
}

export const XLSX_SOURCES: XlsxSource[] = [
  {
    key: "tax_transparency",
    label: "ATO Corporate Tax Transparency",
    packageId: "corporate-transparency",
    resourceMatch: "report of entity tax information",
    minRows: 2_000, // real: ~4,200 entities/yr (>$100M income)
  },
  {
    key: "rd_tax_incentive",
    label: "ATO R&D Tax Incentive",
    packageId: "research-and-development-tax-incentive",
    resourceMatch: "research and development",
    minRows: 5_000, // real: ~13,000 companies/yr
  },
];

/** Leading `YYYY-YY` income year in a resource name (e.g. "2023-24 Report …"), or -1. */
function resourceYear(name: string): number {
  const m = /(\d{4})-\d{2}/.exec(name ?? "");
  return m ? Number(m[1]) : -1;
}

/**
 * Pick the LATEST-income-year `.xlsx` resource whose name matches the source. Unlike
 * the CSV sources we select by recency, not size — each year is its own resource in
 * one package and we always want the most recent report.
 */
export function selectLatestXlsxResource(
  resources: CkanResource[],
  match: string,
): CkanResource | undefined {
  const candidates = resources.filter(
    (r) =>
      (r.url ?? "").toLowerCase().endsWith(".xlsx") &&
      `${r.name ?? ""}`.toLowerCase().includes(match.toLowerCase()),
  );
  return candidates.reduce<CkanResource | undefined>(
    (best, r) =>
      best === undefined || resourceYear(r.name ?? "") > resourceYear(best.name ?? "") ? r : best,
    undefined,
  );
}

/** Discover → download the latest-year XLSX into dataDir. Returns the local path. */
export async function downloadXlsxSource(source: XlsxSource, dataDir: string): Promise<string> {
  const resources = await ckanResources(source.packageId);
  const resource = selectLatestXlsxResource(resources, source.resourceMatch);
  if (!resource?.url) {
    throw new Error(
      `no .xlsx resource matching "${source.resourceMatch}" in "${source.packageId}"`,
    );
  }
  const dest = resolve(dataDir, `${source.key}.xlsx`);
  await downloadFile(resource.url, dest);
  return dest;
}

/** Find a header column by exact name, else the first including all `contains` terms. */
function findCol(hix: Map<string, number>, exact: string, contains: string[] = []): number {
  const e = hix.get(exact.toLowerCase());
  if (e !== undefined) return e;
  for (const [k, i] of hix) {
    if (contains.every((c) => k.includes(c.toLowerCase()))) return i;
  }
  throw new Error(`column not found: "${exact}"`);
}

/** Route a raw ABN/ACN cell to [abn|null, acn|null] (11-digit ABN, else 9-padded ACN). */
function abnAcn(cell: unknown): { abn: string | null; acn: string | null } {
  const d = cellDigits(cell);
  if (d.length === 11) return { abn: d, acn: null };
  if (d.length >= 6 && d.length <= 9) return { abn: null, acn: d.padStart(9, "0") };
  return { abn: null, acn: null };
}

const N = (v: number | null): string => (v === null ? "\\N" : String(v));
const S = (v: string | null): string => (v === null ? "\\N" : v);

/** A monetary cell that is null unless it parses to a POSITIVE number (blank/≤0 → null). */
function positiveOrNull(cell: unknown): number | null {
  const n = cellNumber(cell);
  return n !== null && n > 0 ? n : null;
}

/** The non-amended "total R&D expenditure …" column (throws if absent — see Bug-1). */
function findRdCol(hix: Map<string, number>): number {
  for (const [k, i] of hix) {
    if (k.includes("total r&d expenditure") && !k.includes("amended")) return i;
  }
  throw new Error(`R&D expenditure column ("total r&d expenditure", non-amended) not found`);
}

/**
 * Resolve + validate every column ONCE (each `findCol`/`findRdCol` throws if a
 * required column is missing — so header/format drift fails the load rather than
 * silently emitting hollow rows), then return the COPY column list and a per-row
 * mapper over already-parsed cell arrays. Pure — testable without a DB or file.
 */
export function mapXlsxRows(
  source: XlsxSource,
  table: XlsxTable,
): { columns: string; lines: string[] } {
  const hix = headerIndex(table.header);
  const lines: string[] = [];
  if (source.key === "tax_transparency") {
    const abnC = findCol(hix, "abn");
    const yearC = findCol(hix, "income year");
    const totalC = findCol(hix, "total income $", ["total income"]);
    const taxableC = findCol(hix, "taxable income $", ["taxable income"]);
    const payableC = findCol(hix, "tax payable $", ["tax payable"]);
    for (const row of table.rows) {
      const abn = cellDigits(row[abnC]);
      const total = cellNumber(row[totalC]);
      if (abn.length !== 11 || total === null) continue; // ABN-only; totalIncome required
      const year = String(row[yearC] ?? "").trim();
      // taxableIncome / taxPayable are null when the ATO reports ≤0 (documented contract).
      lines.push(
        `${abn}\t${S(year || null)}\t${N(total)}\t${N(positiveOrNull(row[taxableC]))}\t${N(positiveOrNull(row[payableC]))}\n`,
      );
    }
    return { columns: "abn, income_year, total_income, taxable_income, tax_payable", lines };
  }
  // rd_tax_incentive
  const keyC = findCol(hix, "abn/acn", ["abn"]);
  const yearC = findCol(hix, "income year");
  const rdC = findRdCol(hix);
  for (const row of table.rows) {
    const { abn, acn } = abnAcn(row[keyC]);
    if (abn === null && acn === null) continue;
    const year = String(row[yearC] ?? "").trim();
    lines.push(`${S(abn)}\t${S(acn)}\t${S(year || null)}\t${N(cellNumber(row[rdC]))}\n`);
  }
  return { columns: "abn, acn, income_year, total_rd_expenditure", lines };
}

/**
 * Parse `file` and bulk-load into `abn_<schemaVersion>.<source.key>` (created by
 * staging-schema.sql). Returns the row count inserted. COPY mirrors the gov-spend /
 * load-csv writable pattern (single reserved connection).
 */
export async function loadXlsxSource(options: {
  connectionString: string;
  schemaVersion: string;
  source: XlsxSource;
  file: string;
}): Promise<number> {
  const { connectionString, schemaVersion, source, file } = options;
  const schema = `abn_${schemaVersion}`;
  const table = await readAbnXlsx(file);
  const { columns, lines } = mapXlsxRows(source, table); // throws on missing required column

  const sql = postgres(connectionString, { max: 1, max_lifetime: null });
  try {
    await sql.unsafe(`TRUNCATE TABLE ${schema}.${source.key}`); // no cursor needed — DDL-like, returns no rows
    if (lines.length > 0) {
      const reserved = await sql.reserve();
      const copy = `COPY ${schema}.${source.key} (${columns}) FROM STDIN WITH (FORMAT text, NULL '\\N')`;
      const writable = await reserved.unsafe(copy).writable();
      await pipeline(Readable.from(lines), writable);
      reserved.release();
    }
    return lines.length;
  } finally {
    await sql.end();
  }
}
