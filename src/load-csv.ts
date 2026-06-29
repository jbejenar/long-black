/**
 * long-black — generic delimited (CSV/TSV) → Postgres loader for enrichment.
 *
 * The ASIC Company / Business Names files are tab-delimited despite the `.csv`
 * extension; ACNC is comma. Rather than re-parse in JS, we COPY the file
 * straight into an all-`text` raw table (Postgres does the parsing — robust),
 * then a per-source `INSERT … SELECT` normalizes into the typed staging table.
 *
 * The exact column layouts are a verify-on-first-load item — `sniffHeader`
 * reads the header so the normalize SQL can be confirmed against the real file.
 */

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { pipeline } from "node:stream/promises";
import postgres from "postgres";

/**
 * Parse one delimited line into fields.
 *
 * With `quoting` (default) `"` is honored as an RFC-4180 field quote (embedded
 * delimiters, `""` escapes) — correct for the ACNC comma CSV. With `quoting`
 * false the line is split on the delimiter only and `"` is a literal character —
 * required for the ASIC tab files, which are pure TSV: a tab never appears
 * inside a value, but `"` and `\` DO (5500+ literal quotes in a 600 KB Business
 * Names sample), so honoring quotes there would mis-split names and trip the
 * unterminated-quote guard. This mirrors the COPY the loader runs (`FORMAT csv`
 * with `QUOTE '"'` vs a never-occurring control byte) so the pre-flight
 * field-count check sees exactly what Postgres will.
 */
export function parseDelimitedLine(line: string, delimiter: string, quoting = true): string[] {
  if (!quoting) return line.split(delimiter);
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      fields.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

/**
 * Read + parse the header row of a delimited file. `createInterface` strips the
 * trailing `\r` of a CRLF line (the ASIC files are CRLF), so the last column
 * name arrives clean — matching how Postgres COPY recognizes CRLF terminators.
 */
export async function sniffHeader(
  file: string,
  delimiter: string,
  quoting = true,
): Promise<string[]> {
  const rl = createInterface({
    input: createReadStream(file, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });
  try {
    for await (const line of rl) {
      if (line.trim()) return parseDelimitedLine(line, delimiter, quoting);
    }
    return [];
  } finally {
    rl.close();
  }
}

/**
 * Sanitize a raw header label into a safe, lowercase snake_case SQL identifier:
 * drop a leading BOM, lowercase, collapse every run of non-alphanumerics to a
 * single `_`, trim leading/trailing `_`, and prefix `_` if the result is empty
 * or starts with a digit. Deterministic so the generated raw-table DDL and the
 * hand-written normalize SQL agree on column names. Identifiers are still
 * double-quoted at use sites because sanitized names can collide with SQL
 * keywords (ASIC's `Type`/`Class` → `type`/`class`).
 */
export function sanitizeColumnName(raw: string): string {
  const s = raw
    .replace(/﻿/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return s === "" || /^[0-9]/.test(s) ? `_${s}` : s;
}

/**
 * Build the `CREATE UNLOGGED TABLE` DDL for an all-`text` raw staging table with
 * one column per sniffed header field (sanitized + double-quoted). Built from the
 * REAL file header so the column count always matches the file — the invariant
 * `loadDelimitedRaw` relies on to keep the COPY off the postgres@3 deadlock path.
 * Duplicate sanitized names (e.g. two headers that collapse to the same token)
 * are a hard error rather than a silently-dropped column.
 */
export function buildRawTableDdl(rawTable: string, headerColumns: string[]): string {
  const names = headerColumns.map(sanitizeColumnName);
  const seen = new Set<string>();
  for (const n of names) {
    if (seen.has(n)) {
      throw new Error(`duplicate sanitized column name "${n}" building raw table ${rawTable}`);
    }
    seen.add(n);
  }
  const cols = names.map((n) => `  "${n}" text`).join(",\n");
  return `CREATE UNLOGGED TABLE ${rawTable} (\n${cols}\n)`;
}

/**
 * Quote-balanced ⇔ an even number of `"` seen so far. A field-opening quote and
 * its closing quote are one each; an escaped `""` is a pair — so any complete
 * record has an even count, and an odd count means a quoted field is still open
 * (its value runs onto the next physical line).
 */
function quoteBalanced(text: string): boolean {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') count++;
  }
  return count % 2 === 0;
}

/**
 * Stream complete CSV/TSV records from a file. A record can span multiple
 * physical lines when a quoted field contains a newline (RFC-4180), so physical
 * lines are accumulated until the quotes balance before a record is emitted —
 * matching how Postgres COPY CSV parses the same bytes. Yields each record's
 * fields plus the 1-based physical line where it started. Constant memory bar a
 * single (pathologically large) quoted field.
 *
 * Throws on an **unterminated quoted field** (the input ends while a quote is
 * still open). That is the one shape Postgres COPY CSV rejects on the quoting
 * dimension — "unterminated CSV quoted field" — and it maps exactly to an odd
 * total quote count in the logical record (verified against live COPY: any
 * even-parity record is accepted, including mid-field quotes and data after a
 * closing quote; any odd-parity record errors). `quoteBalanced` is that parity
 * test, so a non-empty accumulator at EOF is precisely an unterminated field.
 * Rejecting here (rather than yielding a truncated record that could still pass
 * the field-count checks) keeps the malformed bytes from reaching COPY and
 * deadlocking.
 */
export async function* readDelimitedRecords(
  file: string,
  delimiter: string,
  quoting = true,
): AsyncGenerator<{ fields: string[]; line: number }> {
  const rl = createInterface({
    input: createReadStream(file, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });
  try {
    // Non-quoting mode (TSV): `"` is literal and a field never spans lines, so
    // each physical line is exactly one record — no accumulation, no
    // unterminated-quote class to reject.
    if (!quoting) {
      let lineNo = 0;
      for await (const physical of rl) {
        lineNo++;
        yield { fields: parseDelimitedLine(physical, delimiter, false), line: lineNo };
      }
      return;
    }
    let pending = "";
    let startLine = 0;
    let lineNo = 0;
    for await (const physical of rl) {
      lineNo++;
      if (pending === "") {
        pending = physical;
        startLine = lineNo;
      } else {
        pending += "\n" + physical;
      }
      if (quoteBalanced(pending)) {
        yield { fields: parseDelimitedLine(pending, delimiter, true), line: startLine };
        pending = "";
      }
    }
    // EOF with a non-empty accumulator ⇒ the final record never closed its quote
    // (odd total quote count). COPY rejects exactly this; reject it here too,
    // before any byte reaches the COPY.
    if (pending !== "") {
      throw new Error(`unterminated quoted field in ${file} starting at line ${startLine}`);
    }
  } finally {
    rl.close();
  }
}

/**
 * Pre-flight guard against the postgres@3 COPY deadlock: a row whose field count
 * differs from the header makes the *server-side* COPY error WITHOUT erroring the
 * writable, hanging the load. Stream the file once and reject on the first
 * field-count mismatch (reporting its line number) so a malformed file fails
 * fast — before any byte reaches the COPY. The first record (the header, which
 * the raw table's columns are built from) sets the expected width. Returns that
 * width (column count); an empty file returns 0.
 *
 * Records come from `readDelimitedRecords`, which additionally throws on an
 * unterminated quoted field — the other shape COPY rejects server-side — so both
 * COPY-error classes are caught here before the COPY opens.
 */
export async function validateFieldCounts(
  file: string,
  delimiter: string,
  quoting = true,
): Promise<number> {
  let expected = -1;
  for await (const { fields, line } of readDelimitedRecords(file, delimiter, quoting)) {
    if (expected === -1) {
      expected = fields.length;
      continue;
    }
    if (fields.length !== expected) {
      throw new Error(
        `field-count mismatch in ${file} at line ${line}: ` +
          `expected ${expected} (from header), got ${fields.length}`,
      );
    }
  }
  return expected === -1 ? 0 : expected;
}

export interface LoadDelimitedOptions {
  connectionString: string;
  /** Delimited file path. */
  file: string;
  /** Fully-qualified raw table (all-text columns), e.g. `abn_20260628.raw_asic_company`. */
  rawTable: string;
  /** Field delimiter (e.g. "\t" for ASIC, "," for ACNC). */
  delimiter: string;
  /**
   * Honor `"` as an RFC-4180 field quote (default true — the ACNC comma CSV). Set
   * false for the ASIC tab files (pure TSV with literal `"`/`\` in values): the
   * COPY then runs with its QUOTE set to a control byte that never appears, so no
   * field is ever treated as quoted, and the pre-flight parser splits on the
   * delimiter alone — the two stay in lock-step.
   */
  quoting?: boolean;
  /** Whether the file has a header row to skip. Default true. */
  hasHeader?: boolean;
  /**
   * Pre-validate the file before the COPY (default true): every row has the same
   * field count, AND that count matches the COPY target table's column count.
   * Guards the postgres@3 server-side-COPY-error deadlock; only disable if the
   * file was already validated against the target upstream.
   */
  validate?: boolean;
}

/**
 * Stream a delimited file into an all-text raw table via a single COPY (Postgres
 * parses the delimiter). The caller then runs the per-source normalize SQL.
 *
 * The raw table must have exactly as many columns as the file (build it from
 * `sniffHeader`): COPY rejects a row with the wrong field count. That failure is
 * load-bearing here because postgres@3 stashes a *server-side* COPY row error
 * without erroring the writable stream — a malformed row mid-file would deadlock
 * the COPY rather than reject. Two checks run *before* any byte reaches the COPY,
 * so the deadlock is unreachable: `validateFieldCounts` (single streaming pass)
 * proves the file is internally rectangular, and the file's width is then
 * compared against the COPY target's *actual* column count — because a
 * rectangular file with the wrong width (or a `hasHeader: false` file whose rows
 * are uniformly the wrong width) is internally consistent yet would still trip
 * the server-side COPY error. The catch still force-closes (`timeout: 0`) so the
 * remaining client-side cases — a read error or a dropped connection — reject
 * promptly instead of hanging on a graceful drain.
 */
export async function loadDelimitedRaw(options: LoadDelimitedOptions): Promise<void> {
  const {
    connectionString,
    file,
    rawTable,
    delimiter,
    quoting = true,
    hasHeader = true,
    validate = true,
  } = options;
  // Fail fast on a ragged file before opening the COPY (see above).
  const fileWidth = validate ? await validateFieldCounts(file, delimiter, quoting) : -1;
  const sql = postgres(connectionString, { max: 1, max_lifetime: null });
  try {
    // Closes the remaining deadlock path: a rectangular file whose width does not
    // match the COPY target. `to_regclass` resolves a (possibly schema-qualified /
    // quoted) name the same way COPY will, honouring search_path; rawTable is a
    // bound *parameter*, never interpolated, so this is injection-safe. An empty
    // file (0 records → no COPY rows) can't deadlock, so it skips the width check.
    if (validate && fileWidth > 0) {
      const cols = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n
        FROM pg_attribute
        WHERE attrelid = to_regclass(${rawTable}::text)
          AND attnum > 0
          AND NOT attisdropped`;
      const targetWidth = cols[0]?.n ?? 0;
      if (targetWidth === 0) {
        throw new Error(`COPY target ${rawTable} does not exist or has no columns`);
      }
      if (fileWidth !== targetWidth) {
        throw new Error(
          `column-count mismatch: ${file} has ${fileWidth} field(s) but COPY target ` +
            `${rawTable} has ${targetWidth} column(s) — fix the raw table DDL ` +
            `(built from sniffHeader) or the file before loading`,
        );
      }
    }
    const reserved = await sql.reserve();
    const header = hasHeader ? "HEADER true" : "HEADER false";
    // quoting=false ⇒ QUOTE set to a control byte (0x01) that cannot appear in
    // registry text, which disables CSV quoting without leaving `FORMAT csv`: `"`
    // and `\` stay literal, there is no `\.`-as-end-of-data hazard (that is
    // `FORMAT text` only), CRLF is still recognized, and HEADER/NULL still work.
    const quote = quoting ? `QUOTE '"'` : `QUOTE E'\\x01'`;
    const copy = `COPY ${rawTable} FROM STDIN WITH (FORMAT csv, DELIMITER E'${delimiter === "\t" ? "\\t" : delimiter}', ${header}, ${quote}, NULL '')`;
    const writable = await reserved.unsafe(copy).writable();
    // One pipeline finalizes the COPY on success and propagates client-side
    // errors with backpressure handled automatically.
    await pipeline(createReadStream(file), writable);
    reserved.release();
    await sql.end();
  } catch (err) {
    await sql.end({ timeout: 0 }).catch(() => {});
    throw err;
  }
}
