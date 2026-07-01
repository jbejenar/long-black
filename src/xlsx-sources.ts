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
import { readAbnXlsx, headerIndex, cellDigits, cellNumber } from "./load-xlsx.js";

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

/** Build the COPY column list + a tab-delimited row line for each source. */
function copyPlan(source: XlsxSource): {
  columns: string;
  line: (hix: Map<string, number>, row: unknown[]) => string | null;
} {
  if (source.key === "tax_transparency") {
    return {
      columns: "abn, income_year, total_income, taxable_income, tax_payable",
      line: (hix, row) => {
        const abn = cellDigits(row[findCol(hix, "abn")]);
        if (abn.length !== 11) return null; // CTT is ABN-only; skip a malformed key
        const year = String(row[findCol(hix, "income year")] ?? "").trim();
        const total = cellNumber(row[findCol(hix, "total income $", ["total income"])]);
        const taxable = cellNumber(row[findCol(hix, "taxable income $", ["taxable income"])]);
        const payable = cellNumber(row[findCol(hix, "tax payable $", ["tax payable"])]);
        return `${abn}\t${S(year || null)}\t${N(total)}\t${N(taxable)}\t${N(payable)}\n`;
      },
    };
  }
  // rd_tax_incentive
  return {
    columns: "abn, acn, income_year, total_rd_expenditure",
    line: (hix, row) => {
      const { abn, acn } = abnAcn(row[findCol(hix, "abn/acn", ["abn"])]);
      if (abn === null && acn === null) return null;
      const year = String(row[findCol(hix, "income year")] ?? "").trim();
      // The "total R&D expenditure …" column, not the "amended" one.
      let rdCol = -1;
      for (const [k, i] of hix) {
        if (k.includes("total r&d expenditure") && !k.includes("amended")) {
          rdCol = i;
          break;
        }
      }
      const rd = rdCol >= 0 ? cellNumber(row[rdCol]) : null;
      return `${S(abn)}\t${S(acn)}\t${S(year || null)}\t${N(rd)}\n`;
    },
  };
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
  const { header, rows } = await readAbnXlsx(file);
  const hix = headerIndex(header);
  const plan = copyPlan(source);

  const lines: string[] = [];
  for (const row of rows) {
    const line = plan.line(hix, row);
    if (line !== null) lines.push(line);
  }

  const sql = postgres(connectionString, { max: 1, max_lifetime: null });
  try {
    await sql.unsafe(`TRUNCATE TABLE ${schema}.${source.key}`); // no cursor needed — DDL-like, returns no rows
    if (lines.length > 0) {
      const reserved = await sql.reserve();
      const copy = `COPY ${schema}.${source.key} (${plan.columns}) FROM STDIN WITH (FORMAT text, NULL '\\N')`;
      const writable = await reserved.unsafe(copy).writable();
      await pipeline(Readable.from(lines), writable);
      reserved.release();
    }
    return lines.length;
  } finally {
    await sql.end();
  }
}
