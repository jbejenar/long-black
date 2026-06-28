/**
 * long-black — load CLI: stream ABR XML file(s) into the abn staging table.
 *
 *   node dist/load-cli.js <file.xml> [<file.xml> ...]
 *
 * The schema must already exist (sql/staging-schema.sql); run abn-finalize.sql
 * after to add the PK. Used by the real-data build and the small-scale load
 * integration.
 */

import { loadAbnFiles } from "./load.js";
import { deriveSchemaVersion } from "./cli.js";

const DEFAULT_DB_URL = "postgres://postgres:postgres@localhost:5433/abn";
const DEFAULT_VERSION = "2026.06.28";

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL ?? DEFAULT_DB_URL;
  const version = process.env.LONG_BLACK_VERSION ?? DEFAULT_VERSION;
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error("[load] usage: load-cli.js <file.xml> [...]");
    process.exit(2);
  }
  const { count } = await loadAbnFiles({
    connectionString,
    schemaVersion: deriveSchemaVersion(version),
    files,
  });
  console.log(`[load] ${count} ABR records loaded from ${files.length} file(s)`);
}

main().catch((err) => {
  console.error("[load] Fatal:", err);
  process.exit(2);
});
