/**
 * long-black — output CLI: split + gzip + metadata for a flattened NDJSON file.
 *
 *   LONG_BLACK_VERSION=2026.06.25 node dist/output-cli.js <ndjson> [outDir]
 */

import { resolve } from "node:path";
import { runOutput } from "./output.js";
import { VERSION as SCHEMA_VERSION } from "./index.js";
import { DEFAULT_VERSION } from "./cli.js";

export interface OutputArgs {
  ndjsonPath: string;
  outputDir: string;
}

/**
 * Parse output-cli argv. output-cli takes NO flags (Parquet was removed), so any
 * `--option` is a usage error — a stale `--parquet` caller must fail loudly rather
 * than silently producing NDJSON only and looking like it worked.
 */
export function parseOutputArgs(args: string[]): OutputArgs {
  const flags = args.filter((a) => a.startsWith("--"));
  if (flags.includes("--parquet")) {
    throw new Error(
      "--parquet is no longer supported: Parquet output was removed (NDJSON only). See CHANGELOG.",
    );
  }
  if (flags.length > 0) {
    throw new Error(
      `unknown flag(s): ${flags.join(", ")} — usage: output-cli.js <ndjson> [outDir]`,
    );
  }
  const positional = args.filter((a) => !a.startsWith("--"));
  const ndjsonPath = positional[0];
  if (!ndjsonPath) {
    throw new Error("usage: output-cli.js <ndjson> [outDir]");
  }
  return { ndjsonPath, outputDir: positional[1] ?? "output" };
}

async function main(): Promise<void> {
  let parsed: OutputArgs;
  try {
    parsed = parseOutputArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`[output] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }
  const version = process.env.LONG_BLACK_VERSION ?? DEFAULT_VERSION;
  const result = await runOutput({
    ndjsonPath: parsed.ndjsonPath,
    outputDir: parsed.outputDir,
    version,
    schemaVersion: SCHEMA_VERSION,
  });
  console.log(
    `[output] ${result.gzFiles.length} per-state .ndjson.gz + metadata.json → ${parsed.outputDir}`,
  );
}

// Only run when invoked directly (so tests can import parseOutputArgs).
const isEntry = process.argv[1] != null && resolve(process.argv[1]).endsWith("output-cli.js");
if (isEntry) {
  main().catch((err) => {
    console.error("[output] Fatal:", err);
    process.exit(2);
  });
}
