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
}

/**
 * Stream a delimited file into an all-text raw table via a single COPY (Postgres
 * parses the delimiter). The caller then runs the per-source normalize SQL.
 *
 * The raw table must have exactly as many columns as the file (build it from
 * `sniffHeader`): COPY rejects a row with the wrong field count. Deliberate
 * limitation to know about when wiring real ASIC/ACNC loads (P3, verify-on-
 * first-load): postgres@3 stashes a *server-side* COPY row error without
 * erroring the writable stream, so a malformed row mid-file deadlocks the COPY
 * rather than rejecting — confirm column shape up front (or pre-validate field
 * counts) to avoid it. The catch below force-closes (`timeout: 0`) so the
 * client-side cases this *can* surface — a read error or a dropped connection —
 * reject promptly instead of hanging on a graceful drain.
 */
export async function loadDelimitedRaw(options: LoadDelimitedOptions): Promise<void> {
  const { connectionString, file, rawTable, delimiter, hasHeader = true } = options;
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
