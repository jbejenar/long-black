/**
 * long-black — CLI orchestrator.
 *
 * Thin wiring over crema: flatten Postgres → NDJSON via streamFlatten (with the
 * ABN compose + schema injected), then verify the output via crema's harness
 * with the ABN-domain checks. Version-format derivation (date → 8-digit schema
 * suffix) is domain and stays here — crema only substitutes __SCHEMA_VERSION__.
 *
 *   node dist/cli.js [outputPath]
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { streamFlatten, verify } from "crema";
import { AbnDocumentSchema } from "./schema.js";
import { composeAbnDocument } from "./compose.js";
import { abnChecks } from "./verify-checks.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SQL_PATH = resolve(__dirname, "..", "sql", "abn_full.sql");

/** Frozen fixture version + local DB URL — shared by the sub-CLIs. */
export const DEFAULT_VERSION = "2026.06.28";
export const DEFAULT_DB_URL = "postgres://postgres:postgres@localhost:5433/abn";

/** Date version "2026.06.28" → 8-digit schema suffix "20260628". */
export function deriveSchemaVersion(version: string): string {
  const digits = version.replace(/\D/g, "");
  if (!/^\d{8}$/.test(digits)) {
    throw new Error(`Invalid version "${version}": expected YYYY.MM.DD, got "${digits}"`);
  }
  return digits;
}

export async function run(options: {
  connectionString: string;
  version: string;
  outputPath: string;
}): Promise<{ count: number; errors: number; ok: boolean }> {
  const { connectionString, version, outputPath } = options;
  const schemaVersion = deriveSchemaVersion(version);
  const query = readFileSync(SQL_PATH, "utf-8");

  const { count, errors } = await streamFlatten({
    connectionString,
    query,
    schemaVersion,
    compose: (row) => composeAbnDocument(row, version),
    schema: AbnDocumentSchema,
    outputPath,
  });
  console.log(
    `[flatten] ${count} documents written, ${errors} composition error(s) → ${outputPath}`,
  );

  const report = await verify({
    ndjsonPath: outputPath,
    schema: AbnDocumentSchema,
    checks: abnChecks,
    // abn_full.sql emits `ORDER BY abn`, so _ids arrive ascending — let the
    // harness check uniqueness by adjacency (O(1) memory). Required at the real
    // ~20M-doc scale: a Set of every _id both exceeds V8's ~16.7M entry cap and
    // blows the memory budget. The harness's default lexicographic order check is
    // correct here because ABNs are fixed-width 11-digit strings, so lexicographic
    // order equals numeric order (no idComparator needed).
    idsSorted: true,
  });
  if (report.ok) {
    console.log(`[verify] PASS — ${report.validCount} valid, 0 issues`);
  } else {
    console.error(
      `[verify] FAIL — schema:${report.schemaFailures} dup:${report.duplicateIds} ` +
        `checks:${JSON.stringify(report.checkFailures)}`,
    );
    for (const issue of report.issues.slice(0, 10)) {
      console.error(`  line ${issue.line} [${issue.check}] ${issue.id ?? "?"}: ${issue.message}`);
    }
  }

  return { count, errors, ok: report.ok && errors === 0 };
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL ?? DEFAULT_DB_URL;
  const version = process.env.LONG_BLACK_VERSION ?? DEFAULT_VERSION;
  const outputPath = process.argv[2] ?? "output/fixture.ndjson";

  const { ok } = await run({ connectionString, version, outputPath });
  if (!ok) process.exit(3);
}

const thisFile = fileURLToPath(import.meta.url);
const entryFile = process.argv[1] ? resolve(process.argv[1]) : "";
if (thisFile === entryFile) {
  main().catch((err) => {
    console.error("[long-black] Fatal:", err);
    process.exit(3);
  });
}
