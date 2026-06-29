/**
 * Integration test for loadDelimitedRaw — the live-Postgres raw COPY path.
 *
 * Gated on DATABASE_URL (set in CI's quality job); skipped on a plain `npm test`.
 * Run locally with:
 *   DATABASE_URL=postgres://postgres:postgres@localhost:5433/abn npm test
 *
 * Proves the deadlock guard end-to-end: a rectangular file COPYs into the raw
 * table, and a ragged file rejects *before* the COPY (via validateFieldCounts)
 * so the postgres@3 server-side-COPY-error deadlock is never reached — the load
 * fails fast and leaves zero rows, rather than hanging.
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
});
