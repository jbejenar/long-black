/**
 * long-black — output CLI: split + gzip + metadata (+ optional Parquet) for a
 * flattened NDJSON file.
 *
 *   LONG_BLACK_VERSION=2026.06.25 node dist/output-cli.js <ndjson> [outDir] [--parquet]
 */

import { runOutput } from "./output.js";
import { VERSION as SCHEMA_VERSION } from "./index.js";
import { DEFAULT_VERSION } from "./cli.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const parquet = args.includes("--parquet");
  const positional = args.filter((a) => !a.startsWith("--"));
  const ndjsonPath = positional[0];
  const outputDir = positional[1] ?? "output";
  const version = process.env.LONG_BLACK_VERSION ?? DEFAULT_VERSION;
  if (!ndjsonPath) {
    console.error("[output] usage: output-cli.js <ndjson> [outDir] [--parquet]");
    process.exit(2);
  }
  const result = await runOutput({
    ndjsonPath,
    outputDir,
    version,
    schemaVersion: SCHEMA_VERSION,
    parquet,
  });
  console.log(
    `[output] ${result.gzFiles.length} per-state .ndjson.gz + metadata.json` +
      `${result.parquetPath ? " + 1 .parquet" : ""} → ${outputDir}`,
  );
}

main().catch((err) => {
  console.error("[output] Fatal:", err);
  process.exit(2);
});
