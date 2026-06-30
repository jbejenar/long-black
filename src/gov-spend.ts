/**
 * long-black — AusTender government-contract spend loader.
 *
 * Source: the Open Contracting Partnership's bulk mirror of AusTender's OCDS data
 * (https://data.open-contracting.org/en/publication/19) — `full.jsonl.gz`, ~251 MB,
 * **updated monthly**, one compiled OCDS release per contract (`ocid`). This is the
 * only CURRENT bulk feed: the data.gov.au mirror is frozen at 2013/2018 and the
 * tenders.gov.au API is a ~25-40k-call paginated crawl with no published rate limits.
 *
 * Unlike the CSV sources this needs aggregation, not a COPY-from-file: stream the
 * gzip line by line (constant memory bar the per-ABN map), and for each release
 * attribute the contract's value to every supplier party that carries an `AU-ABN`
 * identifier, accumulating per-ABN totals. Values are summed in **integer cents** so
 * the total is exact and order-deterministic (float summation would drift and break
 * the byte-for-byte baseline). The aggregate is bulk-inserted into `gov_spend`, which
 * the flatten joins 1:0..1 into the `govSpend` object.
 *
 * verify-on-first-load (2025 slice, 73,914 contracts): one release per ocid (no
 * amendments to dedupe — but a defensive ocid guard is kept), value always on
 * `contract.value.amount`, `contract.dateSigned` always present, 91% of suppliers
 * carry an AU-ABN, ~1% of contracts list >1 supplier.
 */

import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { resolve } from "node:path";
import postgres from "postgres";
import { downloadFile } from "crema";

/** The OCP Data Registry bulk file — all history, one compiled release per ocid. */
export const GOV_SPEND_URL =
  "https://data.open-contracting.org/en/publication/19/download?name=full.jsonl.gz";

/** Per-ABN running aggregate. Money is kept in integer cents for exactness. */
interface SpendAccumulator {
  cents: number;
  contractCount: number;
  firstDate: string | null;
  lastDate: string | null;
}

/** The typed row written to `gov_spend` (money as a 2-dp dollar string for numeric). */
export interface GovSpendRow {
  abn: string;
  totalValueAud: string;
  contractCount: number;
  firstContractDate: string | null;
  lastContractDate: string | null;
}

/** Load diagnostics — surfaced so an incomplete/wrong source can't ship silently. */
export interface GovSpendStats {
  releases: number;
  withSupplierAbn: number;
  withValue: number;
  withDate: number;
  distinctAbns: number;
}

interface OcdsParty {
  roles?: string[];
  identifier?: { scheme?: string; id?: string };
  additionalIdentifiers?: { scheme?: string; id?: string }[];
}
interface OcdsRelease {
  ocid?: string;
  parties?: OcdsParty[];
  contracts?: { value?: { amount?: string | number }; dateSigned?: string }[];
}

/** 11-digit ABN if `value` reduces to exactly 11 digits, else null. */
function abn11(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const digits = String(value).replace(/\D/g, "");
  return digits.length === 11 ? digits : null;
}

/**
 * Pull the distinct supplier ABNs, the summed contract value (in cents), and the
 * earliest `dateSigned` from one OCDS release. A party is a supplier when its roles
 * include `supplier`; its ABN may sit on `identifier` or `additionalIdentifiers`
 * under scheme `AU-ABN`. Foreign suppliers (no ABN) yield no ABNs and are skipped.
 */
export function extractRelease(release: OcdsRelease): {
  abns: string[];
  cents: number;
  date: string | null;
} {
  const abns = new Set<string>();
  for (const party of release.parties ?? []) {
    if (!(party.roles ?? []).includes("supplier")) continue;
    const candidates = [
      party.identifier?.scheme === "AU-ABN" ? party.identifier.id : null,
      ...(party.additionalIdentifiers ?? []).filter((i) => i.scheme === "AU-ABN").map((i) => i.id),
    ];
    for (const c of candidates) {
      const a = abn11(c);
      if (a !== null) abns.add(a);
    }
  }

  let cents = 0;
  let date: string | null = null;
  for (const contract of release.contracts ?? []) {
    const amount = contract.value?.amount;
    if (amount !== null && amount !== undefined) {
      const n = Number(amount);
      if (Number.isFinite(n)) cents += Math.round(n * 100);
    }
    const signed = contract.dateSigned;
    if (typeof signed === "string" && signed.length >= 10) {
      const d = signed.slice(0, 10);
      if (date === null || d < date) date = d;
    }
  }
  return { abns: [...abns], cents, date };
}

/** A parsed line is OCDS iff it's an object with a `releases[]` array or an `ocid`. */
function ocdsReleases(parsed: unknown): OcdsRelease[] | null {
  if (typeof parsed !== "object" || parsed === null) return null;
  const pkg = parsed as { releases?: unknown; ocid?: unknown };
  if (Array.isArray(pkg.releases)) return pkg.releases as OcdsRelease[];
  if (typeof pkg.ocid === "string") return [parsed as OcdsRelease];
  return null;
}

/**
 * Stream `file` (a gzipped JSONL of OCDS release packages) and aggregate contract
 * spend per supplier ABN. Each ocid is counted once (a defensive guard — the OCP
 * compiled file is already one-release-per-ocid). The contract's full value is
 * attributed to every listed supplier ABN (≈1% of contracts list more than one).
 *
 * **Fail-fast on bad source data** (the data must be complete before shipping): a
 * malformed JSON line or a line that isn't a recognizable OCDS shape THROWS (with
 * its line number) rather than being skipped — a truncated/corrupt/wrong download
 * must not silently yield a plausible-but-incomplete aggregate that still clears the
 * floor. Returns the per-ABN map plus diagnostic counters; an empty file (0
 * releases) also throws.
 */
export async function aggregateGovSpend(
  file: string,
): Promise<{ agg: Map<string, SpendAccumulator>; stats: GovSpendStats }> {
  const agg = new Map<string, SpendAccumulator>();
  const seenOcids = new Set<string>();
  const stats: GovSpendStats = {
    releases: 0,
    withSupplierAbn: 0,
    withValue: 0,
    withDate: 0,
    distinctAbns: 0,
  };
  const rl = createInterface({
    input: createReadStream(file).pipe(createGunzip()),
    crlfDelay: Infinity,
  });
  let lineNo = 0;
  for await (const line of rl) {
    lineNo += 1;
    if (line.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      throw new Error(`malformed JSON at line ${lineNo} of ${file}: ${(err as Error).message}`);
    }
    const releases = ocdsReleases(parsed);
    if (releases === null) {
      throw new Error(`line ${lineNo} of ${file} is not a recognizable OCDS release/package`);
    }
    for (const release of releases) {
      const ocid = release.ocid;
      if (typeof ocid === "string") {
        if (seenOcids.has(ocid)) continue;
        seenOcids.add(ocid);
      }
      stats.releases += 1;
      const { abns, cents, date } = extractRelease(release);
      if (abns.length > 0) stats.withSupplierAbn += 1;
      if (cents > 0) stats.withValue += 1;
      if (date !== null) stats.withDate += 1;
      for (const abn of abns) {
        const cur = agg.get(abn) ?? { cents: 0, contractCount: 0, firstDate: null, lastDate: null };
        cur.cents += cents;
        cur.contractCount += 1;
        if (date !== null) {
          if (cur.firstDate === null || date < cur.firstDate) cur.firstDate = date;
          if (cur.lastDate === null || date > cur.lastDate) cur.lastDate = date;
        }
        agg.set(abn, cur);
      }
    }
  }
  if (stats.releases === 0) {
    throw new Error(`no OCDS releases found in ${file} (empty or wrong file?)`);
  }
  stats.distinctAbns = agg.size;
  return { agg, stats };
}

/** Convert the in-memory aggregate into typed rows (cents → 2-dp dollar string). */
export function aggregateToRows(agg: Map<string, SpendAccumulator>): GovSpendRow[] {
  const rows: GovSpendRow[] = [];
  for (const [abn, a] of agg) {
    rows.push({
      abn,
      totalValueAud: (a.cents / 100).toFixed(2),
      contractCount: a.contractCount,
      firstContractDate: a.firstDate,
      lastContractDate: a.lastDate,
    });
  }
  return rows;
}

/** One COPY text line (`\t`-delimited, `\N` for null) for a gov_spend row. */
function copyLine(r: GovSpendRow): string {
  const date = (d: string | null) => (d === null ? "\\N" : d);
  return `${r.abn}\t${r.totalValueAud}\t${r.contractCount}\t${date(r.firstContractDate)}\t${date(r.lastContractDate)}\n`;
}

/** Discover → download the bulk file into `dataDir`. Returns the local path. */
export async function downloadGovSpend(dataDir: string): Promise<string> {
  const dest = resolve(dataDir, "gov_spend.jsonl.gz");
  await downloadFile(GOV_SPEND_URL, dest);
  return dest;
}

/**
 * Aggregate `file` and bulk-load the result into `abn_<schemaVersion>.gov_spend`
 * (created by staging-schema.sql). Returns the number of distinct supplier ABNs
 * loaded. The COPY mirrors load-csv's writable pattern (single reserved connection).
 */
export async function loadGovSpend(options: {
  connectionString: string;
  schemaVersion: string;
  file: string;
}): Promise<number> {
  const { connectionString, schemaVersion, file } = options;
  const schema = `abn_${schemaVersion}`;
  const { agg, stats } = await aggregateGovSpend(file);
  const rows = aggregateToRows(agg);
  console.error(
    `[gov-spend] ${stats.releases} releases → ${stats.distinctAbns} ABNs ` +
      `(${stats.withSupplierAbn} with a supplier ABN, ${stats.withValue} with a value, ` +
      `${stats.withDate} with a signed date)`,
  );

  const sql = postgres(connectionString, { max: 1, max_lifetime: null });
  try {
    await sql.unsafe(`TRUNCATE TABLE ${schema}.gov_spend`); // no cursor needed — DDL-like, returns no rows
    if (rows.length > 0) {
      const reserved = await sql.reserve();
      const copy =
        `COPY ${schema}.gov_spend ` +
        `(abn, total_value_aud, contract_count, first_contract_date, last_contract_date) ` +
        `FROM STDIN WITH (FORMAT text, NULL '\\N')`;
      const writable = await reserved.unsafe(copy).writable();
      await pipeline(Readable.from(rows.map(copyLine)), writable);
      reserved.release();
    }
    return rows.length;
  } finally {
    await sql.end();
  }
}
