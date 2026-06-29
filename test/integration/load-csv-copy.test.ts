/**
 * Integration test for loadDelimitedRaw — the live-Postgres raw COPY path.
 *
 * Gated on DATABASE_URL (set in CI's quality job); skipped on a plain `npm test`.
 * Run locally with:
 *   DATABASE_URL=postgres://postgres:postgres@localhost:5433/abn npm test
 *
 * Proves the deadlock guard end-to-end: a rectangular file COPYs into the raw
 * table; a ragged file rejects *before* the COPY (via validateFieldCounts); and
 * a rectangular file whose width does not match the target table also rejects
 * before the COPY (via the target column-count check) — so the postgres@3
 * server-side-COPY-error deadlock is never reached on either malformed shape. The
 * load fails fast and leaves zero rows, rather than hanging.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import postgres from "postgres";
import { loadDelimitedRaw } from "../../src/load-csv.js";

const DB = process.env.DATABASE_URL;
const SCHEMA = "csvcopytest";
const RAW = `${SCHEMA}.raw_t`;

describe.skipIf(!DB)("loadDelimitedRaw (live COPY)", () => {
  const sql = postgres(DB as string, { max: 1 });
  let tmp = "";

  async function rowCount(): Promise<number> {
    const r = await sql.unsafe(`SELECT count(*)::int AS n FROM ${RAW}`); // no cursor needed — single-row count
    return (r[0] as { n: number }).n;
  }

  beforeAll(async () => {
    await sql.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`); // no cursor needed — DDL setup
    await sql.unsafe(`CREATE SCHEMA ${SCHEMA}`); // no cursor needed — DDL setup
    await sql.unsafe(`CREATE UNLOGGED TABLE ${RAW} (a text, b text, c text)`); // no cursor needed — DDL setup
    tmp = mkdtempSync(join(tmpdir(), "long-black-csv-"));
  });

  afterAll(async () => {
    await sql.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`); // no cursor needed — DDL teardown
    await sql.end();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it("loads a rectangular TSV into the raw table (header skipped)", async () => {
    await sql.unsafe(`TRUNCATE ${RAW}`); // no cursor needed — fixture reset
    const f = join(tmp, "ok.tsv");
    writeFileSync(f, "a\tb\tc\n1\t2\t3\nx\ty\tz\n");
    await loadDelimitedRaw({
      connectionString: DB as string,
      file: f,
      rawTable: RAW,
      delimiter: "\t",
    });
    expect(await rowCount()).toBe(2);
  });

  it("rejects a ragged file before the COPY (no deadlock) and loads nothing", async () => {
    await sql.unsafe(`TRUNCATE ${RAW}`); // no cursor needed — fixture reset
    const f = join(tmp, "bad.tsv");
    writeFileSync(f, "a\tb\tc\n1\t2\t3\n4\t5\n"); // line 3 is 2 fields, not 3
    await expect(
      loadDelimitedRaw({
        connectionString: DB as string,
        file: f,
        rawTable: RAW,
        delimiter: "\t",
      }),
    ).rejects.toThrow(/field-count mismatch/);
    expect(await rowCount()).toBe(0);
  }, 20_000);

  it("rejects a rectangular file whose width != the 3-column target (no deadlock)", async () => {
    await sql.unsafe(`TRUNCATE ${RAW}`); // no cursor needed — fixture reset
    const f = join(tmp, "wide.tsv");
    // Internally consistent (every row 4 fields) but the target table has 3
    // columns — the exact case validateFieldCounts alone could not catch.
    writeFileSync(f, "a\tb\tc\td\n1\t2\t3\t4\nw\tx\ty\tz\n");
    await expect(
      loadDelimitedRaw({
        connectionString: DB as string,
        file: f,
        rawTable: RAW,
        delimiter: "\t",
      }),
    ).rejects.toThrow(/column-count mismatch/);
    expect(await rowCount()).toBe(0);
  }, 20_000);

  it("rejects a headerless file whose uniform width != the target (no deadlock)", async () => {
    await sql.unsafe(`TRUNCATE ${RAW}`); // no cursor needed — fixture reset
    const f = join(tmp, "noheader-wide.tsv");
    // hasHeader:false → the first row is data, not a trustworthy schema ref; all
    // rows are 4 fields against the 3-column target, so it must reject before COPY.
    writeFileSync(f, "1\t2\t3\t4\n5\t6\t7\t8\n");
    await expect(
      loadDelimitedRaw({
        connectionString: DB as string,
        file: f,
        rawTable: RAW,
        delimiter: "\t",
        hasHeader: false,
      }),
    ).rejects.toThrow(/column-count mismatch/);
    expect(await rowCount()).toBe(0);
  }, 20_000);

  it("rejects an unterminated quoted field before the COPY (no deadlock)", async () => {
    await sql.unsafe(`TRUNCATE ${RAW}`); // no cursor needed — fixture reset
    const f = join(tmp, "unterminated.csv");
    // 3 fields each (matches the target width), but the last record's quote never
    // closes — COPY would reject "unterminated CSV quoted field" server-side and
    // deadlock. The quoting preflight must catch it first and load nothing.
    writeFileSync(f, 'a,b,c\n1,2,3\n4,5,"oops\n');
    await expect(
      loadDelimitedRaw({
        connectionString: DB as string,
        file: f,
        rawTable: RAW,
        delimiter: ",",
      }),
    ).rejects.toThrow(/unterminated quoted field/);
    expect(await rowCount()).toBe(0);
  }, 20_000);
});
