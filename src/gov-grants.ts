/**
 * long-black — GrantConnect grant-awards loader (the grants complement to the
 * AusTender contracts in gov-spend.ts). Aggregates every Australian Government grant
 * AWARD per recipient ABN: total value, grant count, first/last publish date.
 *
 * grants.gov.au is a server-rendered app behind a CloudFront request-fingerprint
 * filter (a full modern-browser header set is required, or it 403s) and its bulk
 * "Grant Award Published" report needs a free registered account. So this loader:
 *   1. logs in — GET `/` for the anti-forgery token + cookies, POST
 *      `/RegisteredUser/Login` (token + Email + Password) → session cookie (UR_L);
 *   2. downloads the report by date range —
 *      GET `/Reports/GaPublishedDownload?DateType=Publish Date&DateStart&DateEnd`
 *      → an XLSX (32 cols incl. Recipient ABN + Value (AUD)); the report caps at
 *      50,000 rows, so a capped range is bisected until every chunk is complete;
 *   3. sums value per recipient ABN in integer cents (exact, order-independent).
 *
 * Credentials come from GRANTCONNECT_USERNAME / GRANTCONNECT_PASSWORD (repo secrets
 * in CI) — never committed. Everything runs headless (plain fetch + cookie jar),
 * verified end-to-end. CC-BY 3.0 AU (© Commonwealth of Australia, Dept of Finance).
 */

import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";
import postgres from "postgres";
import ExcelJS from "exceljs";

const BASE = "https://www.grants.gov.au";
/** A full modern-Chrome header set — the CloudFront filter 403s a minimal UA. */
const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-AU,en;q=0.9",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Upgrade-Insecure-Requests": "1",
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Grant Awards mandatory-reporting start (grants.gov.au states 31 Dec 2017). */
const HISTORY_START = "2017-12-01";
const REPORT_CAP = 50_000; // the report returns at most this many rows per request

export interface GovGrantsAggregate {
  abn: string;
  totalValueCents: bigint;
  grantCount: number;
  firstPublishDate: string | null; // YYYY-MM-DD
  lastPublishDate: string | null;
}

interface GrantRow {
  abn: string;
  valueCents: bigint;
  publishDate: string | null;
}

/** Minimal cookie jar: accumulate Set-Cookie name=value pairs across requests. */
class CookieJar {
  private jar = new Map<string, string>();
  absorb(res: Response): void {
    // undici exposes multiple Set-Cookie via getSetCookie()
    const headers = res.headers as Headers & { getSetCookie?: () => string[] };
    const cookies = headers.getSetCookie?.() ?? [];
    for (const c of cookies) {
      const [pair] = c.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) this.jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
  header(): string {
    return [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${String(d).padStart(2, "0")}-${MONTHS[m - 1]}-${y}`;
}

/** Log in and return a cookie jar carrying the authenticated session (UR_L). */
export async function loginGrantConnect(username: string, password: string): Promise<CookieJar> {
  const jar = new CookieJar();
  const home = await fetch(`${BASE}/`, { headers: BROWSER_HEADERS });
  if (!home.ok) throw new Error(`GrantConnect GET / failed: ${home.status} (CloudFront filter?)`);
  jar.absorb(home);
  const html = await home.text();
  const m = /name="__RequestVerificationToken"[^>]*value="([^"]+)"/i.exec(html);
  if (!m) throw new Error("GrantConnect: anti-forgery token not found on home page");
  const body = new URLSearchParams({
    __RequestVerificationToken: m[1],
    ReturnUrl: "/",
    Email: username,
    Password: password,
  });
  const login = await fetch(`${BASE}/RegisteredUser/Login`, {
    method: "POST",
    redirect: "manual",
    headers: {
      ...BROWSER_HEADERS,
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: BASE,
      Referer: `${BASE}/`,
      Cookie: jar.header(),
    },
    body,
  });
  jar.absorb(login);
  // A successful login redirects (302); a re-served 200 login page means bad creds.
  if (login.status !== 302 && login.status !== 303) {
    throw new Error(`GrantConnect login failed (status ${login.status}) — check credentials`);
  }
  if (!jar.header().includes("UR_L")) {
    throw new Error("GrantConnect login did not set a session cookie (UR_L)");
  }
  return jar;
}

/** Download the Grant Award Published XLSX for a publish-date range. */
async function downloadGaXlsx(jar: CookieJar, startIso: string, endIso: string): Promise<Buffer> {
  const qs = new URLSearchParams({
    AgencyStatus: "0",
    DateType: "Publish Date",
    DateStart: fmtDate(startIso),
    DateEnd: fmtDate(endIso),
  });
  const res = await fetch(`${BASE}/Reports/GaPublishedDownload?${qs}`, {
    headers: { ...BROWSER_HEADERS, Accept: "*/*", Cookie: jar.header() },
  });
  if (!res.ok)
    throw new Error(`GrantConnect download ${startIso}..${endIso} failed: ${res.status}`);
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("spreadsheet")) {
    throw new Error(`GrantConnect download returned ${ct}, not XLSX (session expired?)`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/** Parse a Grant Award Published XLSX → rows (ABN, value cents, publish date). */
export function parseGaXlsx(buf: Buffer): Promise<GrantRow[]> {
  // exceljs's load() Buffer typing is stricter than @types/node's generic Buffer.
  return new ExcelJS.Workbook().xlsx.load(buf as unknown as ArrayBuffer).then((wb) => {
    const ws = wb.worksheets[0];
    if (!ws) return [];
    const cell = (row: ExcelJS.Row, i: number): unknown => {
      const v = (row.values as unknown[])[i];
      if (v && typeof v === "object") {
        const o = v as { text?: unknown; result?: unknown };
        return o.text ?? o.result ?? v;
      }
      return v;
    };
    // Find the data header row (a preamble of title + criteria precedes it).
    let hdr = -1;
    const idx: Record<string, number> = {};
    for (let i = 1; i <= 40 && hdr < 0; i++) {
      const row = ws.getRow(i);
      // Build a name→col map for this row; the data header is the row that has both
      // "Recipient ABN" and a "Value…" column (a title + criteria block precedes it).
      const map: Record<string, number> = {};
      let hasAbn = false,
        hasValue = false;
      (row.values as unknown[]).forEach((_v, col) => {
        const name = String(cell(row, col) ?? "")
          .trim()
          .toLowerCase();
        if (name) map[name] = col;
        if (name === "recipient abn") hasAbn = true;
        if (/^value/.test(name)) hasValue = true;
      });
      if (hasAbn && hasValue) {
        hdr = i;
        Object.assign(idx, map);
      }
    }
    if (hdr < 0)
      throw new Error("GrantConnect XLSX: data header (Recipient ABN + Value) not found");
    const abnCol = idx["recipient abn"];
    const valueCol = Object.entries(idx).find(([k]) => k.startsWith("value"))?.[1];
    const dateCol = idx["publish date"];
    if (!abnCol || !valueCol) throw new Error("GrantConnect XLSX: ABN/Value column missing");

    const rows: GrantRow[] = [];
    for (let i = hdr + 1; i <= ws.rowCount; i++) {
      const row = ws.getRow(i);
      const abn = String(cell(row, abnCol) ?? "").replace(/\D/g, "");
      if (abn.length !== 11) continue; // recipient with no ABN (individual) → can't join
      const rawVal = String(cell(row, valueCol) ?? "").replace(/[,$\s]/g, "");
      const val = Number(rawVal);
      if (!Number.isFinite(val)) continue;
      const cents = BigInt(Math.round(val * 100));
      const dv = dateCol ? cell(row, dateCol) : null;
      let publishDate: string | null = null;
      if (dv instanceof Date) publishDate = dv.toISOString().slice(0, 10);
      else if (dv) {
        const d = new Date(String(dv));
        if (!Number.isNaN(d.getTime())) publishDate = d.toISOString().slice(0, 10);
      }
      rows.push({ abn, valueCents: cents, publishDate });
    }
    return rows;
  });
}

/** Collect every grant-award row across a date range, bisecting any 50k-capped chunk. */
async function collectRange(
  jar: CookieJar,
  startIso: string,
  endIso: string,
  out: GrantRow[],
  log: (m: string) => void,
): Promise<void> {
  const buf = await downloadGaXlsx(jar, startIso, endIso);
  const rows = await parseGaXlsx(buf);
  if (rows.length >= REPORT_CAP && startIso < endIso) {
    // Capped — the range has ≥50k awards; split in half by date and recurse.
    const mid = new Date((Date.parse(startIso) + Date.parse(endIso)) / 2)
      .toISOString()
      .slice(0, 10);
    log(`  ${startIso}..${endIso}: capped at ${rows.length}, bisecting at ${mid}`);
    const next = new Date(Date.parse(mid) + 86400000).toISOString().slice(0, 10);
    await collectRange(jar, startIso, mid, out, log);
    await collectRange(jar, next, endIso, out, log);
  } else {
    log(`  ${startIso}..${endIso}: ${rows.length} awards`);
    out.push(...rows);
  }
}

/** Aggregate grant rows per recipient ABN (value summed in integer cents). */
export function aggregateGovGrants(rows: GrantRow[]): GovGrantsAggregate[] {
  const byAbn = new Map<string, GovGrantsAggregate>();
  for (const r of rows) {
    let a = byAbn.get(r.abn);
    if (!a) {
      a = {
        abn: r.abn,
        totalValueCents: 0n,
        grantCount: 0,
        firstPublishDate: null,
        lastPublishDate: null,
      };
      byAbn.set(r.abn, a);
    }
    a.totalValueCents += r.valueCents;
    a.grantCount += 1;
    if (r.publishDate) {
      if (a.firstPublishDate === null || r.publishDate < a.firstPublishDate)
        a.firstPublishDate = r.publishDate;
      if (a.lastPublishDate === null || r.publishDate > a.lastPublishDate)
        a.lastPublishDate = r.publishDate;
    }
  }
  return [...byAbn.values()].sort((x, y) => (x.abn < y.abn ? -1 : 1));
}

/**
 * Log in, download all grant awards from HISTORY_START to `endIso` (the build date),
 * aggregate per ABN, and write the aggregate to `dataDir/gov_grants.jsonl` (one line
 * per ABN). Returns the aggregate + stats.
 */
export async function downloadGovGrants(options: {
  dataDir: string;
  username: string;
  password: string;
  endIso: string;
  log?: (m: string) => void;
}): Promise<{ aggregate: GovGrantsAggregate[]; totalRows: number }> {
  const log = options.log ?? (() => {});
  log("GrantConnect: logging in…");
  const jar = await loginGrantConnect(options.username, options.password);
  log("GrantConnect: downloading grant awards by year…");
  const rows: GrantRow[] = [];
  // Chunk by calendar year (≈33k/yr, under the 50k cap; capped chunks self-bisect).
  const startYear = Number(HISTORY_START.slice(0, 4));
  const endYear = Number(options.endIso.slice(0, 4));
  for (let y = startYear; y <= endYear; y++) {
    const s = y === startYear ? HISTORY_START : `${y}-01-01`;
    const e = y === endYear ? options.endIso : `${y}-12-31`;
    await collectRange(jar, s, e, rows, log);
  }
  const aggregate = aggregateGovGrants(rows);
  const out = resolve(options.dataDir, "gov_grants.jsonl");
  writeFileSync(
    out,
    aggregate
      .map((a) =>
        JSON.stringify({
          abn: a.abn,
          totalValueCents: a.totalValueCents.toString(),
          grantCount: a.grantCount,
          firstPublishDate: a.firstPublishDate,
          lastPublishDate: a.lastPublishDate,
        }),
      )
      .join("\n") + "\n",
  );
  log(`GrantConnect: ${rows.length} awards → ${aggregate.length} recipient ABNs → ${out}`);
  return { aggregate, totalRows: rows.length };
}

/** cents (bigint) → a "12345.67" AUD string for the numeric column. */
function centsToAud(cents: bigint): string {
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  const whole = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, "0");
  return `${neg ? "-" : ""}${whole}.${frac}`;
}

/** Bulk-load the per-ABN aggregate into abn_<schemaVersion>.gov_grants. */
export async function loadGovGrants(options: {
  connectionString: string;
  schemaVersion: string;
  aggregate: GovGrantsAggregate[];
}): Promise<number> {
  const schema = `abn_${options.schemaVersion}`;
  const sql = postgres(options.connectionString, { max: 1, max_lifetime: null });
  try {
    await sql.unsafe(`TRUNCATE TABLE ${schema}.gov_grants`); // no cursor needed — DDL-like, returns no rows
    if (options.aggregate.length === 0) return 0;
    const lines = options.aggregate.map(
      (a) =>
        `${a.abn}\t${centsToAud(a.totalValueCents)}\t${a.grantCount}\t` +
        `${a.firstPublishDate ?? "\\N"}\t${a.lastPublishDate ?? "\\N"}\n`,
    );
    const reserved = await sql.reserve();
    const copy =
      `COPY ${schema}.gov_grants (abn, total_value_aud, grant_count, first_grant_date, last_grant_date) ` +
      `FROM STDIN WITH (FORMAT text, NULL '\\N')`;
    const writable = await reserved.unsafe(copy).writable();
    await pipeline(Readable.from(lines), writable);
    reserved.release();
    return options.aggregate.length;
  } finally {
    await sql.end();
  }
}
