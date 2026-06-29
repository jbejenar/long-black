/**
 * Integration test for loadAbnFiles — the live-Postgres COPY path.
 *
 * Gated on DATABASE_URL: it runs in CI's `quality` job (a postgres:16 service is
 * up on 5433) and is skipped on a plain `npm test` with no database, so the unit
 * suite stays Postgres-free. Run locally with:
 *
 *   DATABASE_URL=postgres://postgres:postgres@localhost:5433/abn npm test
 *
 * The headline assertion is the regression guard for PR #3, Bug 1: loading more
 * than ten independent XML files must NOT emit MaxListenersExceededWarning. The
 * old shape re-piped each file into the *same* COPY writable with `{ end: false }`,
 * and `pipeline` re-attaches error/close/finish/end listeners to its destination
 * on every call without removing them from a deliberately-kept-open destination —
 * so listeners accumulated per file and a >10-file load tripped the warning. The
 * single-pipeline rewrite (one `pipeline(csvLines(...), writable)` for the whole
 * load) cannot, by construction. This test fails if that ever regresses.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { loadAbnFiles, parseAbrXmlString } from "../../src/load.js";

const DB = process.env.DATABASE_URL;
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "../..");
const SAMPLE = resolve(REPO, "fixtures/sample-abr.xml");
const SCHEMA_VERSION = "copytest";
const TABLE = `abn_${SCHEMA_VERSION}.abn`;
const FILE_COUNT = 15; // > Node's default 10-listener limit

const recordsPerFile = parseAbrXmlString(readFileSync(SAMPLE, "utf-8")).length;

describe.skipIf(!DB)("loadAbnFiles (live COPY)", () => {
  const sql = postgres(DB as string, { max: 1 });
  const goodFiles: string[] = [];
  let badFile = "";
  let tmp = "";

  async function rowCount(): Promise<number> {
    const r = await sql.unsafe(`SELECT count(*)::int AS n FROM ${TABLE}`); // no cursor needed — single-row count
    return (r[0] as { n: number }).n;
  }

  beforeAll(async () => {
    const ddl = readFileSync(resolve(REPO, "sql/staging-schema.sql"), "utf-8").replaceAll(
      "__SCHEMA_VERSION__",
      SCHEMA_VERSION,
    );
    await sql.unsafe(`DROP SCHEMA IF EXISTS abn_${SCHEMA_VERSION} CASCADE`); // no cursor needed — DDL setup
    await sql.unsafe(ddl); // no cursor needed — DDL setup

    tmp = mkdtempSync(join(tmpdir(), "long-black-copy-"));
    const xml = readFileSync(SAMPLE);
    for (let i = 0; i < FILE_COUNT; i++) {
      const p = join(tmp, `abr-${i}.xml`);
      writeFileSync(p, xml);
      goodFiles.push(p);
    }
    badFile = join(tmp, "bad.xml");
    writeFileSync(badFile, '<Transfer><ABR><ABN status="ACT">11<UNCLOSED');
  });

  afterAll(async () => {
    await sql.unsafe(`DROP SCHEMA IF EXISTS abn_${SCHEMA_VERSION} CASCADE`); // no cursor needed — DDL teardown
    await sql.end();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it("loads >10 files via one pipeline with no MaxListenersExceededWarning", async () => {
    await sql.unsafe(`TRUNCATE ${TABLE}`); // no cursor needed — fixture reset

    const warnings: string[] = [];
    const onWarning = (w: Error): void => {
      warnings.push(w.name);
    };
    process.on("warning", onWarning);
    let count: number;
    try {
      ({ count } = await loadAbnFiles({
        connectionString: DB as string,
        schemaVersion: SCHEMA_VERSION,
        files: goodFiles,
      }));
    } finally {
      process.off("warning", onWarning);
    }

    const expected = recordsPerFile * FILE_COUNT;
    expect(count).toBe(expected);
    expect(await rowCount()).toBe(expected);
    expect(warnings.filter((n) => n === "MaxListenersExceededWarning")).toEqual([]);
  }, 20_000);

  it("rejects promptly and rolls back the whole COPY when a file is malformed", async () => {
    await sql.unsafe(`TRUNCATE ${TABLE}`); // no cursor needed — fixture reset

    // A good file's rows are written before the bad file throws; force-closing
    // the wedged COPY connection must roll the transaction back to zero rows.
    await expect(
      loadAbnFiles({
        connectionString: DB as string,
        schemaVersion: SCHEMA_VERSION,
        files: [goodFiles[0], badFile, goodFiles[1]],
      }),
    ).rejects.toThrow();

    expect(await rowCount()).toBe(0);
  }, 20_000);
});
