/**
 * long-black — output CLI: split + gzip + metadata for a flattened NDJSON file.
 *
 *   LONG_BLACK_VERSION=2026.06.25 node dist/output-cli.js <ndjson> [outDir]
 */

import { runOutput } from "./output.js";
import { VERSION as SCHEMA_VERSION } from "./index.js";
import { DEFAULT_VERSION } from "./cli.js";

async function main(): Promise<void> {
  const ndjsonPath = process.argv[2];
  const outputDir = process.argv[3] ?? "output";
  const version = process.env.LONG_BLACK_VERSION ?? DEFAULT_VERSION;
  if (!ndjsonPath) {
    console.error("[output] usage: output-cli.js <ndjson> [outDir]");
    process.exit(2);
  }
  const result = await runOutput({ ndjsonPath, outputDir, version, schemaVersion: SCHEMA_VERSION });
  console.log(
    `[output] ${result.gzFiles.length} per-state .ndjson.gz + metadata.json → ${outputDir}`,
  );
}

main().catch((err) => {
  console.error("[output] Fatal:", err);
  process.exit(2);
});
