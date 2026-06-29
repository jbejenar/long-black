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

/** Parse one delimited line into fields, honoring RFC-4180 double-quoted fields. */
export function parseDelimitedLine(line: string, delimiter: string): string[] {
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

/** Read + parse the header row of a delimited file. */
export async function sniffHeader(file: string, delimiter: string): Promise<string[]> {
  const rl = createInterface({ input: createReadStream(file, { encoding: "utf-8" }) });
  try {
    for await (const line of rl) {
      if (line.trim()) return parseDelimitedLine(line, delimiter);
    }
    return [];
  } finally {
    rl.close();
  }
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
 */
export async function* readDelimitedRecords(
  file: string,
  delimiter: string,
): AsyncGenerator<{ fields: string[]; line: number }> {
  const rl = createInterface({
    input: createReadStream(file, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });
  try {
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
        yield { fields: parseDelimitedLine(pending, delimiter), line: startLine };
        pending = "";
      }
    }
    // Trailing record with an unterminated quote — surface it (Postgres errors on it too).
    if (pending !== "") {
      yield { fields: parseDelimitedLine(pending, delimiter), line: startLine };
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
 */
export async function validateFieldCounts(file: string, delimiter: string): Promise<number> {
  let expected = -1;
  for await (const { fields, line } of readDelimitedRecords(file, delimiter)) {
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
  /** Whether the file has a header row to skip. Default true. */
  hasHeader?: boolean;
  /**
   * Pre-validate that every row's field count matches the header before the
   * COPY (default true). Guards the postgres@3 server-side-COPY-error deadlock;
   * only disable if the file was validated upstream.
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
 * the COPY rather than reject. `validateFieldCounts` runs first (single
 * streaming pass) and rejects on the first mismatch *before* any byte reaches
 * the COPY, so the deadlock is unreachable; the COPY then only sees a file it
 * has already proven rectangular. The catch still force-closes (`timeout: 0`) so
 * the remaining client-side cases — a read error or a dropped connection —
 * reject promptly instead of hanging on a graceful drain.
 */
export async function loadDelimitedRaw(options: LoadDelimitedOptions): Promise<void> {
  const {
    connectionString,
    file,
    rawTable,
    delimiter,
    hasHeader = true,
    validate = true,
  } = options;
  // Fail fast on a ragged file before opening the COPY (see above).
  if (validate) await validateFieldCounts(file, delimiter);
  const sql = postgres(connectionString, { max: 1, max_lifetime: null });
  try {
    const reserved = await sql.reserve();
    const header = hasHeader ? "HEADER true" : "HEADER false";
    const copy = `COPY ${rawTable} FROM STDIN WITH (FORMAT csv, DELIMITER E'${delimiter === "\t" ? "\\t" : delimiter}', ${header}, QUOTE '"', NULL '')`;
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
